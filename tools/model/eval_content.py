"""Content-aware scoring of predicted page quads.
PRE-REGISTERED (from the user's relaxed criterion; fixed before computing these numbers):
  usable = content_kept >= 0.99  AND  coverage >= 0.90  AND  spill <= 0.10
  content_kept = share of the page's ink pixels (ground_truth_content.json) inside the predicted quad
  coverage     = area(P ∩ G) / area(G)    (G = the user's manual crop)  -> "not too much of the top page cut off"
  spill        = 1 - area(P ∩ G) / area(P) -> "not much of the desk / other sheets inside the crop"
"""
import cv2, json, numpy as np, os, sys
GT = json.load(open(os.path.expanduser('~/Documents/page_crop_ground_truth/ground_truth_content.json')))
R = 1000  # rasterise quads at 1000px for areas
def mask(q, w=R, h=R):
    m = np.zeros((h, w), np.uint8); cv2.fillPoly(m, [np.int32(np.array(q) * [w - 1, h - 1])], 1); return m
def score(P, g):
    mp, mg = mask(P), mask(g['quad_norm'])
    inter = float((mp & mg).sum()); ap, ag = float(mp.sum()), float(mg.sum())
    pts = np.array(g['content_points_norm'], np.float32)
    P32 = np.float32(np.array(P) * [R - 1, R - 1]).reshape(-1, 1, 2)
    inside = sum(cv2.pointPolygonTest(P32, (float(x * (R - 1)), float(y * (R - 1))), False) >= 0 for x, y in pts[::4])
    kept = inside / len(pts[::4])
    return dict(kept=kept, cov=inter / ag, spill=1 - inter / max(ap, 1), iou=inter / (ap + ag - inter))
def ok(m): return m['kept'] >= 0.99 and m['cov'] >= 0.90 and m['spill'] <= 0.10
def grow(q, m):
    q = np.array(q); c = q.mean(0); return np.clip(c + (q - c) * (1 + m), 0, 1).tolist()
def wilson(k, n, z=1.96):
    p = k / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d; h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return max(0, c - h), min(1, c + h)
def report(name, quads):
    ms = [score(quads[g['raw']], g) for g in GT]; u = sum(map(ok, ms)); lo, hi = wilson(u, len(ms))
    f = lambda k: np.mean([m[k] for m in ms])
    print(f"{name:34s} kept {f('kept'):.3f} cov {f('cov'):.3f} spill {f('spill'):.3f} IoU {f('iou'):.3f}  usable {u}/{len(ms)} ({100*u/len(ms):.0f}%, CI {lo*100:.0f}-{hi*100:.0f}%)  content-intact {sum(m['kept']>=0.99 for m in ms)}/{len(ms)}")
    return ms
if __name__ == '__main__':
    preds = json.load(open('scanic/refine_preds.json'))
    full = {p['raw']: p['full'] for p in preds}
    report('zero-shot (2000px working copy)', full)
    for m in (0.02, 0.04, 0.06):
        report(f'zero-shot + margin {m}', {k: grow(v, m) for k, v in full.items()})
    inset = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]
    report('baseline: fixed 10% inset', {g['raw']: inset for g in GT})
