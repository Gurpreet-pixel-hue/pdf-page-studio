"""[v3: + Mendeley replay and external Mendeley test] Fine-tune DocCornerNet (mobilenetv2) on the user's 41 labelled pile photos.
Fixed BEFORE any held-out result was seen: base=mobilenetv2_256_best, AdamW-style Adam lr 1e-4 cosine->1e-6,
40 epochs x 8 augmented draws per training image, batch 8, loss = SimCC CE + 0.5*L1(coords), BatchNorm frozen,
5 folds of contiguous photo blocks (no early stopping on held-out data). Seeds are logged."""
import os, sys, json, math, random, time, argparse
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
sys.path.insert(0, 'repo'); sys.path.insert(0, '..')
import numpy as np, cv2, tensorflow as tf
from tensorflow import keras
from model import create_model
from losses import gaussian_1d_targets
import eval_content as E

WORK = '../proto/work'
MEAN = np.array([0.485, 0.456, 0.406], np.float32); STD = np.array([0.229, 0.224, 0.225], np.float32)
ap = argparse.ArgumentParser()
ap.add_argument('--base', default='mobilenetv2_256_best'); ap.add_argument('--folds', type=int, default=5)
ap.add_argument('--epochs', type=int, default=40); ap.add_argument('--draws', type=int, default=8)
ap.add_argument('--batch', type=int, default=8); ap.add_argument('--lr', type=float, default=1e-4)
ap.add_argument('--seed', type=int, default=0); ap.add_argument('--final', action='store_true', help='train on all 41 and save weights')
ap.add_argument('--out', default='ft_oof.json')
ap.add_argument('--rebg_p', type=float, default=0.0, help='probability a draw of a user photo gets a new background + lighting')
ap.add_argument('--replay_p', type=float, default=0.0, help='probability a draw is a public labelled document photo (replay)')
ap.add_argument('--mend_p', type=float, default=0.0, help='probability a draw is a Mendeley train photo')
ap.add_argument('--mend_eval', action='store_true', help='score each fold model on the 153 held-out Mendeley photos (never trained on)')
ap.add_argument('--preview', action='store_true', help='write a montage of augmented samples and exit')
ap.add_argument('--stress', action='store_true', help='also score held-out photos re-backgrounded with UNSEEN backgrounds')
args = ap.parse_args()
print('config', vars(args), flush=True)

cfg = json.load(open(f'repo/checkpoints/{args.base}/config.json'))
SIZE, BINS, TAU = cfg['img_size'], cfg['num_bins'], cfg['tau']
KW = dict(alpha=cfg['alpha'], fpn_ch=cfg['fpn_ch'], simcc_ch=cfg['simcc_ch'], img_size=SIZE, num_bins=BINS, tau=TAU,
          backbone=cfg['backbone'], backbone_weights=None)

# ---- data: squash each photo to a square once (the model's convention: coords are normalised in square space)
GT = E.GT
SRC = 2 * SIZE
imgs = []
for g in GT:
    im = cv2.cvtColor(cv2.imread(f"{WORK}/{g['raw']}"), cv2.COLOR_BGR2RGB)
    imgs.append(cv2.resize(im, (SRC, SRC), interpolation=cv2.INTER_AREA))
quads = [np.array(g['quad_norm'], np.float32) for g in GT]

# ---- pools: real backgrounds (COCO negatives from DocCornerDataset) and labelled public documents (replay)
import glob
bg_files = sorted(glob.glob('bgpool/*.jpg')); n_train_bg = int(len(bg_files) * 0.8)
BG_TRAIN = [cv2.cvtColor(cv2.imread(f), cv2.COLOR_BGR2RGB) for f in bg_files[:n_train_bg]]
BG_TEST = [cv2.cvtColor(cv2.imread(f), cv2.COLOR_BGR2RGB) for f in bg_files[n_train_bg:]]
replay_meta = json.load(open('replay/labels.json'))[:300]
REPLAY = [(cv2.resize(cv2.cvtColor(cv2.imread(r['file']), cv2.COLOR_BGR2RGB), (SRC, SRC), interpolation=cv2.INTER_AREA), np.array(r['quad'], np.float32)) for r in replay_meta]
_mend = json.load(open('mend_pool/labels.json'))
MEND_TRAIN = [(cv2.resize(cv2.cvtColor(cv2.imread(m['file']), cv2.COLOR_BGR2RGB), (SRC, SRC), interpolation=cv2.INTER_AREA), np.array(m['quad'], np.float32)) for m in _mend if m['split'] == 'train']
MEND_TEST = [(cv2.cvtColor(cv2.imread(m['file']), cv2.COLOR_BGR2RGB), np.array(m['quad'], np.float32)) for m in _mend if m['split'] == 'test']
print('mendeley train', len(MEND_TRAIN), 'test', len(MEND_TEST), flush=True)
print('pools: bg train', len(BG_TRAIN), 'bg test', len(BG_TEST), 'replay', len(REPLAY), flush=True)

def paper_mask(img):
    hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV); v = cv2.GaussianBlur(hsv[..., 2], (9, 9), 0)
    _, m = cv2.threshold(v, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    m = cv2.bitwise_and(m, ((hsv[..., 1] < 70) * 255).astype(np.uint8))
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)); m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, k); m = cv2.morphologyEx(m, cv2.MORPH_OPEN, k)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m)
    keep = np.zeros_like(m)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] > 0.004 * m.size: keep[lab == i] = 255
    return keep > 0
MASKS = [paper_mask(im) for im in imgs]

def procedural_bg(rng, size):
    kind = rng.integers(3); yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    base = rng.uniform(0.05, 0.9, 3).astype(np.float32)
    if kind == 0:                                   # plain surface with soft noise
        bg = np.ones((size, size, 3), np.float32) * base + cv2.GaussianBlur(rng.normal(0, 0.05, (size, size, 3)).astype(np.float32), (0, 0), 6)
    elif kind == 1:                                 # wood-like stripes
        ang = rng.uniform(0, np.pi); t = xx * np.cos(ang) + yy * np.sin(ang)
        stripes = 0.5 + 0.5 * np.sin(t * rng.uniform(20, 60) + 4 * cv2.GaussianBlur(rng.normal(0, 1, (size, size)).astype(np.float32), (0, 0), 12))
        bg = base[None, None] * (0.7 + 0.3 * stripes[..., None])
    else:                                           # gradient
        ang = rng.uniform(0, 2 * np.pi); t = (xx - 0.5) * np.cos(ang) + (yy - 0.5) * np.sin(ang) + 0.5
        bg = base[None, None] * (0.6 + 0.8 * t[..., None])
    return (np.clip(bg, 0, 1) * 255).astype(np.uint8)

def relight(img, rng):
    x = img.astype(np.float32) / 255.0
    x = x * np.array([rng.uniform(0.85, 1.15), 1.0, rng.uniform(0.85, 1.15)], np.float32)       # colour temperature
    h, w = x.shape[:2]; yy, xx = np.mgrid[0:h, 0:w].astype(np.float32); ang = rng.uniform(0, 2 * np.pi)
    ramp = ((xx / w - 0.5) * np.cos(ang) + (yy / h - 0.5) * np.sin(ang)) * rng.uniform(0, 0.5)    # uneven illumination
    d = np.sqrt(((xx / w - 0.5) ** 2 + (yy / h - 0.5) ** 2)); vig = 1 - rng.uniform(0, 0.35) * d
    x = x * (1 + ramp[..., None]) * vig[..., None] * rng.uniform(0.75, 1.15)
    return (np.clip(x, 0, 1) * 255).astype(np.uint8)

def rebackground(img, mask, pool, rng):
    size = img.shape[0]
    if rng.random() < 0.7 and pool:
        bg = pool[rng.integers(len(pool))]
        if rng.random() < 0.5: bg = bg[:, ::-1]
        c = rng.uniform(0.6, 1.0); o = rng.uniform(0, 1 - c, 2); b = bg.shape[0]
        bg = cv2.resize(bg[int(o[0] * b):int((o[0] + c) * b), int(o[1] * b):int((o[1] + c) * b)], (size, size), interpolation=cv2.INTER_AREA)
        bg = (np.clip(bg.astype(np.float32) * rng.uniform(0.6, 1.2, 3), 0, 255)).astype(np.uint8)
    else:
        bg = procedural_bg(rng, size)
    a = cv2.GaussianBlur(mask.astype(np.float32), (0, 0), 2.5)[..., None]
    shadow = cv2.GaussianBlur(np.roll(mask.astype(np.float32), (6, 6), (0, 1)), (0, 0), 10)[..., None]
    bgf = bg.astype(np.float32) * (1 - 0.4 * shadow * (1 - a))
    return relight(np.clip(a * img.astype(np.float32) + (1 - a) * bgf, 0, 255).astype(np.uint8), rng)


def augment(img, quad, rng):
    for _ in range(30):
        s = rng.uniform(0.85, 1.2); th = math.radians(rng.uniform(-6, 6)); t = rng.uniform(-0.07, 0.07, 2)
        c, sn = math.cos(th), math.sin(th)
        corners = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], np.float32)
        centred = (corners - 0.5) * s
        rot = np.stack([centred[:, 0] * c - centred[:, 1] * sn, centred[:, 0] * sn + centred[:, 1] * c], 1) + 0.5 + t
        dst = rot + rng.uniform(-0.03, 0.03, (4, 2))
        # H maps source-square coords -> output coords ; we want output = view of source, so use the inverse
        Hf = cv2.getPerspectiveTransform(corners * SRC, (dst).astype(np.float32) * SIZE)   # source -> output pixels
        q_out = cv2.perspectiveTransform(quad.reshape(-1, 1, 2) * SRC, Hf).reshape(4, 2) / SIZE
        if (q_out > 0.01).all() and (q_out < 0.99).all():
            out = cv2.warpPerspective(img, Hf, (SIZE, SIZE), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            break
    else:
        out = cv2.resize(img, (SIZE, SIZE), interpolation=cv2.INTER_AREA); q_out = quad.copy()
    x = out.astype(np.float32) / 255.0
    x = x * rng.uniform(0.8, 1.2) + rng.uniform(-0.08, 0.08)                      # contrast / brightness
    x = x * rng.uniform(0.93, 1.07, 3)                                           # per-channel gain
    x = np.clip(x, 0, 1) ** rng.uniform(0.8, 1.25)                               # gamma
    if rng.random() < 0.3: x = cv2.GaussianBlur(x, (0, 0), rng.uniform(0.3, 1.2))
    x = np.clip(x + rng.normal(0, rng.uniform(0, 0.02), x.shape), 0, 1)
    return (x - MEAN) / STD, q_out.reshape(8).astype(np.float32)

if args.preview:
    prng = np.random.default_rng(7); tiles = []
    for j in range(12):
        i = int(prng.integers(len(GT)))
        if j % 4 == 3: src, q = REPLAY[int(prng.integers(len(REPLAY)))]
        else: src, q = rebackground(imgs[i], MASKS[i], BG_TRAIN, prng), quads[i]
        x, qq = augment(src, q, prng)
        t = np.clip((x * STD + MEAN) * 255, 0, 255).astype(np.uint8).copy()
        cv2.polylines(t, [np.int32(qq.reshape(4, 2) * (SIZE - 1))], True, (0, 255, 0), 2); tiles.append(t)
    rows = [np.hstack(tiles[r * 6:(r + 1) * 6]) for r in range(2)]
    cv2.imwrite('aug_preview.jpg', cv2.cvtColor(np.vstack(rows), cv2.COLOR_RGB2BGR)); print('preview written'); sys.exit(0)

def quad_scores(P, T):
    mp, mt = E.mask(P), E.mask(T); i = float((mp & mt).sum()); ap, at = float(mp.sum()), float(mt.sum())
    return dict(iou=i / (ap + at - i + 1e-9), cov=i / (at + 1e-9), spill=1 - i / (ap + 1e-9))

def prep_eval(img):
    return (cv2.resize(img, (SIZE, SIZE), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0 - MEAN) / STD

def freeze_bn(model):
    n = 0
    for l in model._flatten_layers(include_self=False, recursive=True):
        if isinstance(l, keras.layers.BatchNormalization): l.trainable = False; n += 1
    return n

def train_one(train_idx, tag):
    random.seed(args.seed); np.random.seed(args.seed); tf.random.set_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    model = create_model(**KW); model.load_weights(f'repo/checkpoints/{args.base}/best_model.weights.h5')
    freeze_bn(model)
    steps_per_epoch = math.ceil(len(train_idx) * args.draws / args.batch); total = max(1, steps_per_epoch * args.epochs)
    lr = keras.optimizers.schedules.CosineDecay(args.lr, total, alpha=0.01)
    opt = keras.optimizers.Adam(lr)

    @tf.function
    def step(x, y):
        with tf.GradientTape() as tape:
            out = model(x, training=False)
            xs, ys = y[:, 0::2], y[:, 1::2]
            tx, ty = gaussian_1d_targets(xs, BINS, 3.0), gaussian_1d_targets(ys, BINS, 3.0)
            ce = lambda logits, t: -tf.reduce_mean(tf.reduce_sum(t * tf.nn.log_softmax(logits / TAU, axis=-1), axis=-1))
            loss = ce(out['simcc_x'], tx) + ce(out['simcc_y'], ty) + 0.5 * tf.reduce_mean(tf.abs(out['coords'] - y))
        grads = tape.gradient(loss, model.trainable_variables)
        opt.apply_gradients(zip(grads, model.trainable_variables))
        return loss

    t0 = time.time()
    for ep in range(args.epochs):
        idx = np.repeat(train_idx, args.draws); rng.shuffle(idx); losses = []
        for b in range(0, len(idx), args.batch):
            batch = []
            for i in idx[b:b + args.batch]:
                if rng.random() < args.mend_p:
                    rimg, rq = MEND_TRAIN[rng.integers(len(MEND_TRAIN))]; batch.append(augment(rimg, rq, rng))
                elif rng.random() < args.replay_p:
                    rimg, rq = REPLAY[rng.integers(len(REPLAY))]; batch.append(augment(rimg, rq, rng))
                elif rng.random() < args.rebg_p:
                    batch.append(augment(rebackground(imgs[i], MASKS[i], BG_TRAIN, rng), quads[i], rng))
                else:
                    batch.append(augment(imgs[i], quads[i], rng))
            losses.append(float(step(tf.constant(np.stack([a for a, _ in batch])), tf.constant(np.stack([q for _, q in batch])))))
        if ep % 10 == 0 or ep == args.epochs - 1: print(f'[{tag}] epoch {ep + 1}/{args.epochs} loss {np.mean(losses):.4f}  ({time.time() - t0:.0f}s)', flush=True)
    return model

def predict(model, idx):
    x = np.stack([prep_eval(imgs[i]) for i in idx])
    out = model(x, training=False)
    return {GT[i]['raw']: np.clip(c.reshape(4, 2), 0, 1).tolist() for i, c in zip(idx, out['coords'].numpy())}

if args.final:
    m = train_one(list(range(len(GT))), 'final'); m.save_weights('ft_final.weights.h5'); print('saved ft_final.weights.h5')
else:
    n = len(GT); order = sorted(range(n), key=lambda i: GT[i]['raw']); blocks = np.array_split(order, args.folds); oof = {}; stress = {}; mend_scores = []
    for k, test_idx in enumerate(blocks):
        train_idx = [i for i in order if i not in set(test_idx)]
        m = train_one(train_idx, f'fold{k + 1}/{args.folds}')
        oof.update(predict(m, list(test_idx)))
        if args.mend_eval:
            mx = np.stack([prep_eval(cv2.resize(im, (SRC, SRC), interpolation=cv2.INTER_AREA)) for im, _ in MEND_TEST])
            mc = m(mx, training=False)['coords'].numpy()
            for (im, q), c in zip(MEND_TEST, mc):
                P = np.clip(c.reshape(4, 2), 0, 1)
                mend_scores.append(quad_scores(P, q))
        if args.stress:
            srng = np.random.default_rng(1234 + k)
            sx = np.stack([prep_eval(rebackground(imgs[i], MASKS[i], BG_TEST, srng)) for i in test_idx])
            sout = m(sx, training=False)['coords'].numpy()
            for i, c in zip(test_idx, sout): stress[GT[i]['raw']] = np.clip(c.reshape(4, 2), 0, 1).tolist()
        sub = {GT[i]['raw']: oof[GT[i]['raw']] for i in test_idx}
        ms = [E.score(sub[GT[i]['raw']], GT[i]) for i in test_idx]
        print(f'fold {k + 1} held-out ({len(test_idx)} pages): IoU {np.mean([q["iou"] for q in ms]):.3f} content-kept {np.mean([q["kept"] for q in ms]):.3f} usable {sum(map(E.ok, ms))}/{len(ms)}', flush=True)
    json.dump(oof, open(args.out, 'w'))
    E.report('OUT-OF-FOLD  original photos', oof)
    if args.mend_eval and mend_scores:
        f = lambda k: np.mean([m_[k] for m_ in mend_scores])
        u = np.mean([(m_['iou'] >= 0.90) for m_ in mend_scores])
        print(f"OUT-OF-FOLD  external Mendeley test (153 photos x 5 fold models)  IoU {f('iou'):.3f}  cov {f('cov'):.3f}  spill {f('spill'):.3f}  IoU>=0.90 {100 * u:.0f}%")
    if args.stress:
        json.dump(stress, open(args.out.replace('.json', '_stress.json'), 'w'))
        E.report('OUT-OF-FOLD  unseen backgrounds', stress)
