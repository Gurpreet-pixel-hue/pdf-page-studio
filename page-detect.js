/**
 * PDF Page Studio - Page detector
 * Finds the four corners of the top sheet in a photo with a small corner
 * model (DocCornerNet, fine-tuned; see models/MODEL_CARD.md) run through
 * ONNX Runtime Web. The pure pre/post-processing is testable in Node; the
 * runtime part loads lazily on first use.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./crop-geometry.js'));
  } else {
    root.PageDetect = factory(root.CropGeometry);
  }
}(typeof self !== 'undefined' ? self : this, function (CropGeometry) {

  const INPUT_SIZE = 256;
  const MEAN = [0.485, 0.456, 0.406];
  const STD = [0.229, 0.224, 0.225];

  const DEFAULTS = {
    ortModule: 'vendor/ort/ort.wasm.min.mjs',
    wasmDir: 'vendor/ort/',
    modelUrl: 'models/doccorner-ft.ort'
  };

  /** RGBA bytes of a size x size image -> ImageNet-normalised NHWC floats. */
  function preprocessRGBA(rgba, size) {
    if (!rgba || rgba.length !== size * size * 4) throw new Error('preprocessRGBA: expected a ' + size + 'x' + size + ' RGBA buffer');
    const out = new Float32Array(size * size * 3);
    for (let i = 0, o = 0; i < rgba.length; i += 4, o += 3) {
      out[o] = (rgba[i] / 255 - MEAN[0]) / STD[0];
      out[o + 1] = (rgba[i + 1] / 255 - MEAN[1]) / STD[1];
      out[o + 2] = (rgba[i + 2] / 255 - MEAN[2]) / STD[2];
    }
    return out;
  }

  /**
   * Sizes to draw through when shrinking a source to size x size, each at most
   * half the previous one. Browsers resize large drops with different filters
   * (Safari's is coarser); halving keeps the result close to area averaging,
   * which is what the model was trained with.
   */
  function downscaleSteps(srcWidth, srcHeight, size) {
    const steps = [];
    let w = srcWidth, h = srcHeight;
    while (w > size * 2 || h > size * 2) {
      w = Math.max(size, Math.ceil(w / 2));
      h = Math.max(size, Math.ceil(h / 2));
      steps.push([w, h]);
    }
    if (w !== size || h !== size) steps.push([size, size]);
    return steps;
  }

  /**
   * Model output (8 normalised coords TL,TR,BR,BL and a "page present" logit)
   * -> { quad, confidence }. Confidence says a page was found, not that the
   * crop is exact. An unusable quad gives { quad: null, confidence: 0 }.
   */
  function decodeOutput(coords, scoreLogit) {
    const none = { quad: null, confidence: 0 };
    if (!coords || coords.length !== 8 || !Array.from(coords).every(Number.isFinite)) return none;
    let quad = [0, 1, 2, 3].map((i) => [Math.min(1, Math.max(0, coords[i * 2])), Math.min(1, Math.max(0, coords[i * 2 + 1]))]);
    if (!CropGeometry.isValidQuad(quad)) quad = CropGeometry.orderQuad(quad);
    if (!CropGeometry.isValidQuad(quad)) return none;
    if (!Number.isFinite(scoreLogit)) return none;
    return { quad, confidence: 1 / (1 + Math.exp(-scoreLogit)) };
  }

  /** Lazily-loaded detector. detect(drawable) -> { quad, confidence }. */
  function createDetector(options) {
    const cfg = Object.assign({}, DEFAULTS, options);
    let sessionPromise = null;
    let ort = null;

    function load() {
      if (!sessionPromise) {
        sessionPromise = (async () => {
          ort = await import(new URL(cfg.ortModule, document.baseURI).href);
          const dir = new URL(cfg.wasmDir, document.baseURI).href;
          ort.env.wasm.wasmPaths = { mjs: dir + 'ort-wasm-simd-threaded.mjs', wasm: dir + 'ort-wasm-simd-threaded.wasm' };
          ort.env.wasm.numThreads = 1;
          const response = await fetch(new URL(cfg.modelUrl, document.baseURI).href);
          if (!response.ok) throw new Error('model download failed (' + response.status + ')');
          const bytes = new Uint8Array(await response.arrayBuffer());
          return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
        })();
        sessionPromise.catch(() => { sessionPromise = null; });
      }
      return sessionPromise;
    }

    async function detect(drawable) {
      const session = await load();
      let source = drawable;
      let width = drawable.naturalWidth || drawable.width;
      let height = drawable.naturalHeight || drawable.height;
      for (const [w, h] of downscaleSteps(width, height, INPUT_SIZE)) {
        const step = document.createElement('canvas');
        step.width = w;
        step.height = h;
        const stepCtx = step.getContext('2d', { willReadFrequently: true });
        stepCtx.imageSmoothingEnabled = true;
        stepCtx.imageSmoothingQuality = 'high';
        stepCtx.drawImage(source, 0, 0, w, h);
        source = step;
      }
      if (source === drawable) { // already the model's size: still copy it onto a canvas to read the pixels
        const copy = document.createElement('canvas');
        copy.width = copy.height = INPUT_SIZE;
        copy.getContext('2d', { willReadFrequently: true }).drawImage(drawable, 0, 0);
        source = copy;
      }
      const ctx = source.getContext('2d', { willReadFrequently: true });
      const input = preprocessRGBA(ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data, INPUT_SIZE);
      const outputs = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, INPUT_SIZE, INPUT_SIZE, 3]) });
      const [coords, score] = session.outputNames.map((name) => outputs[name].data);
      return decodeOutput(coords, score[0]);
    }

    return { load, detect };
  }

  return { INPUT_SIZE, preprocessRGBA, downscaleSteps, decodeOutput, createDetector, CropGeometry };
}));
