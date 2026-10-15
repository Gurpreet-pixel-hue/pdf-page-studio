// The shipped feature model runs in the browser on the vendored minimal ONNX Runtime and matches the Python reference.
async function scenario() {
  const ort = await import('/vendor/ort/ort.wasm.min.mjs');
  ort.env.wasm.wasmPaths = { mjs: '/vendor/ort/ort-wasm-simd-threaded.mjs', wasm: '/vendor/ort/ort-wasm-simd-threaded.wasm' };
  ort.env.wasm.numThreads = 1;
  const ref = await (await fetch('/tools/model/section_ref.json')).json();
  const head = await (await fetch('/models/section-head.json')).json();
  check('head has 1280 weights and a cutoff', head.w.length === 1280 && typeof head.b === 'number' && head.cutoff === 1.5, String(head.w.length));

  const bytes = new Uint8Array(await (await fetch('/models/section-features.ort')).arrayBuffer());
  check('model file is within the size budget (< 10 MB)', bytes.length < 10e6, (bytes.length / 1e6).toFixed(2) + ' MB');
  const started = performance.now();
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  const input = new Float32Array(192 * 576 * 3);
  for (let i = 0; i < input.length; i++) input[i] = (((i * 2654435761) >>> 0) % 1000 / 1000) * 2 - 1;
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 192, 576, 3]) });
  const features = out[session.outputNames[0]].data;
  check('output is 1280 features', features.length === ref.length, String(features.length));
  const diff = Math.max(...ref.first16.map((v, i) => Math.abs(v - features[i])));
  check('first 16 features match Python (max abs diff < 1e-3)', diff < 1e-3, diff.toExponential(2));
  const sum = features.reduce((a, b) => a + b, 0);
  check('feature sum matches Python (relative diff < 1e-3)', Math.abs(sum - ref.sum) / Math.abs(ref.sum) < 1e-3, `${sum.toFixed(3)} vs ${ref.sum.toFixed(3)}`);
  check('one scan step is fast (< 1500 ms incl. load)', performance.now() - started < 1500, Math.round(performance.now() - started) + ' ms');
}
