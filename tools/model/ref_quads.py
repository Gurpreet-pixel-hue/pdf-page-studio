import sys, json, glob, os, numpy as np, cv2, tensorflow as tf
sys.path.insert(0, 'repo')
from model import create_model
cfg = json.load(open('repo/checkpoints/mobilenetv2_256_best/config.json'))
m = create_model(backbone=cfg['backbone'], alpha=cfg['alpha'], backbone_minimalistic=False, backbone_include_preprocessing=False, backbone_weights=None,
    fpn_ch=cfg['fpn_ch'], simcc_ch=cfg['simcc_ch'], img_size=256, num_bins=cfg['num_bins'], tau=cfg['tau'])
m.load_weights('ft_final.weights.h5')
MEAN = np.array([0.485, 0.456, 0.406], np.float32); STD = np.array([0.229, 0.224, 0.225], np.float32)
res = {}
for p in sorted(glob.glob('../proto/work/*.jpg')):
    img = cv2.cvtColor(cv2.imread(p), cv2.COLOR_BGR2RGB)
    x = (cv2.resize(img, (256, 256), interpolation=cv2.INTER_AREA).astype(np.float32) / 255 - MEAN) / STD
    o = m(x[None], training=False)
    res[os.path.basename(p)] = np.clip(o['coords'].numpy().reshape(4, 2), 0, 1).tolist()
json.dump(res, open('../ref_quads.json', 'w')); print(len(res), 'quads')
