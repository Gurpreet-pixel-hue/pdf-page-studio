import sys, json, numpy as np, tensorflow as tf
sys.path.insert(0, 'repo')
from model import create_model, create_inference_model
import tf2onnx, onnxruntime as ort
cfg = json.load(open('repo/checkpoints/mobilenetv2_256_best/config.json'))
m = create_model(backbone=cfg['backbone'], alpha=cfg['alpha'], backbone_minimalistic=cfg.get('backbone_minimalistic', False),
    backbone_include_preprocessing=cfg.get('backbone_include_preprocessing', False), backbone_weights=None,
    fpn_ch=cfg['fpn_ch'], simcc_ch=cfg['simcc_ch'], img_size=cfg['img_size'], num_bins=cfg['num_bins'], tau=cfg['tau'])
m.load_weights('ft_final.weights.h5')
inf = create_inference_model(m)
S = cfg['img_size']
x = np.random.RandomState(0).rand(1, S, S, 3).astype(np.float32)
ref = [np.asarray(o) for o in inf(x, training=False)]
@tf.function(input_signature=[tf.TensorSpec((1, S, S, 3), tf.float32, name='input')])
def f(t): return inf(t, training=False)
from tensorflow.python.framework.convert_to_constants import convert_variables_to_constants_v2
cf = f.get_concrete_function()
frozen = convert_variables_to_constants_v2(cf)
gd = frozen.graph.as_graph_def()
ins = [t.name for t in frozen.inputs]; outs = [t.name for t in frozen.outputs]
print('frozen io', ins, outs)
tf2onnx.convert.from_graph_def(gd, input_names=ins, output_names=outs, opset=13, output_path='ft_final.onnx')
s = ort.InferenceSession('ft_final.onnx')
out = s.run(None, {s.get_inputs()[0].name: x})
print('inputs', [(i.name, i.shape) for i in s.get_inputs()], 'outputs', [(o.name, o.shape) for o in s.get_outputs()])
for r, o in zip(ref, out): print('max abs diff', float(np.abs(r - o).max()))
import onnx; ops = sorted({n.op_type for n in onnx.load('ft_final.onnx').graph.node}); print('ops', ops)
