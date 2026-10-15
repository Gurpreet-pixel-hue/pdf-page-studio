"""Train the final head on all three journals and export the shipped files.
Usage: python tools/model/sections_export.py ALPHA [--scores-only]
Writes models/section-features.ort, models/section-head.json, tools/model/section_ref.json and, for the local
browser comparison, ~/Documents/page_crop_ground_truth/section_scores_ref.json.
--scores-only skips training and export and only rewrites the reference scores from the shipped head."""
import sys, os, json, subprocess, shutil, tempfile
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
import tensorflow as tf
from sklearn.linear_model import LogisticRegression
import sections_common as C

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def ref_input():
    """A fixed, reproducible test tensor shared with the browser parity scenario."""
    n = C.STRIP_H * C.STRIP_W * 3
    ramp = np.array([((i * 2654435761) % 2 ** 32) % 1000 / 1000.0 for i in range(n)], dtype=np.float32)
    return (ramp * 2.0 - 1.0).reshape(1, C.STRIP_H, C.STRIP_W, 3)


def write_reference_scores(net, journals):
    """Reference scores of the shipped model per journal page, for the local browser comparison (private, not committed)."""
    head = json.load(open(os.path.join(REPO, 'models/section-head.json')))
    w = np.array(head['w'], dtype=np.float32)
    scores = {}
    for name, j in journals.items():
        f = net.predict(C.preprocess(C.render_strips(j['pdf'])), verbose=0)
        scores[name] = (f @ w + head['b']).astype(float).round(4).tolist()
    out = os.path.expanduser('~/Documents/page_crop_ground_truth/section_scores_ref.json')
    json.dump(scores, open(out, 'w'))
    print('wrote', out)


def main():
    alpha = float(sys.argv[1])
    journals = C.load_journals()
    net = C.backbone(alpha)
    if '--scores-only' in sys.argv:
        write_reference_scores(net, journals)
        return
    X, y = [], []
    for name, j in journals.items():
        strips = C.render_strips(j['pdf'])
        f = net.predict(C.preprocess(strips), verbose=0)
        X.append(f)
        y.append([p in j['starts'] for p in range(1, len(strips) + 1)])
    X = np.vstack(X); y = np.concatenate(y).astype(int)
    head = LogisticRegression(C=0.1, max_iter=4000, class_weight='balanced').fit(X, y)
    json.dump({'w': head.coef_[0].astype(float).round(6).tolist(), 'b': float(head.intercept_[0]), 'cutoff': 1.5,
               'backbone': f'MobileNetV2 alpha={alpha} (ImageNet), input 192x576, pixel/127.5-1',
               'trained_on': sorted(journals)}, open(os.path.join(REPO, 'models/section-head.json'), 'w'))

    # backbone -> frozen graph -> ONNX -> ORT (Runtime optimisation: the minimal wasm has no fused ops)
    from tensorflow.python.framework.convert_to_constants import convert_variables_to_constants_v2
    import tf2onnx
    spec = tf.TensorSpec((1, C.STRIP_H, C.STRIP_W, 3), tf.float32, name='input')
    fn = tf.function(lambda t: net(t, training=False), input_signature=[spec])
    frozen = convert_variables_to_constants_v2(fn.get_concrete_function())
    tmp = tempfile.mkdtemp()
    onnx_path = os.path.join(tmp, 'section-features.onnx')
    tf2onnx.convert.from_graph_def(frozen.graph.as_graph_def(), input_names=[t.name for t in frozen.inputs],
                                   output_names=[t.name for t in frozen.outputs], opset=13, output_path=onnx_path)
    subprocess.check_call([sys.executable, '-m', 'onnxruntime.tools.convert_onnx_models_to_ort', tmp, '--optimization_style', 'Runtime'])
    ort_path = [p for p in os.listdir(tmp) if p.endswith('.ort')][0]
    shutil.copy(os.path.join(tmp, ort_path), os.path.join(REPO, 'models/section-features.ort'))

    x = ref_input()
    ref = net.predict(x, verbose=0)[0]
    json.dump({'first16': ref[:16].astype(float).tolist(), 'sum': float(ref.sum()), 'length': int(ref.shape[0])},
              open(os.path.join(REPO, 'tools/model/section_ref.json'), 'w'))
    print('size MB', os.path.getsize(os.path.join(REPO, 'models/section-features.ort')) / 1e6)
    write_reference_scores(net, journals)


if __name__ == '__main__':
    main()
