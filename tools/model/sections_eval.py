"""Leave-one-journal-out evaluation of the section-start classifier for several backbones.
Usage: python tools/model/sections_eval.py [alpha ...]   (default: 0.35 0.5 0.75 1.0)
Reports, for each held-out journal: AUC, top-N correct (N = true starts), rank of the worst true start,
and the fixed-cutoff outcome (score > 1.5: missed / extra)."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
import sections_common as C

CUTOFF = 1.5


def features_for(alpha, journals):
    net = C.backbone(alpha)
    out = {}
    for name, j in journals.items():
        strips = C.render_strips(j['pdf'])
        out[name] = net.predict(C.preprocess(strips), verbose=0)
    return out


def main():
    alphas = [float(a) for a in sys.argv[1:]] or [0.35, 0.5, 0.75, 1.0]
    journals = C.load_journals()
    for alpha in alphas:
        feats = features_for(alpha, journals)
        print(f'--- MobileNetV2 alpha={alpha}')
        for held in journals:
            train = [k for k in journals if k != held]
            X = np.vstack([feats[k] for k in train])
            y = np.concatenate([[p in journals[k]['starts'] for p in range(1, len(feats[k]) + 1)] for k in train]).astype(int)
            model = LogisticRegression(C=0.1, max_iter=4000, class_weight='balanced').fit(X, y)
            s = model.decision_function(feats[held])
            truth = set(journals[held]['starts'])
            n = len(truth)
            order = np.argsort(-s)
            top = {int(i) + 1 for i in order[:n]}
            yh = np.array([p in truth for p in range(1, len(s) + 1)]).astype(int)
            rank = {int(i) + 1: r + 1 for r, i in enumerate(order)}
            flagged = {p + 1 for p in np.where(s > CUTOFF)[0]}
            print(f'{held}: AUC {roc_auc_score(yh, s):.3f} | top-{n} correct {len(top & truth)}/{n} | worst true start ranks {max(rank[p] for p in truth)} of {len(s)} | cutoff {CUTOFF}: missed {len(truth - flagged)}, extra {len(flagged - truth)}')


if __name__ == '__main__':
    main()
