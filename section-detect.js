/**
 * PDF Page Studio - Section detector
 * Scores every page of a journal PDF for "a section starts here": renders the top
 * strip of each page with pdf.js, runs a small image model (MobileNetV2 features)
 * through ONNX Runtime Web, and applies a logistic-regression head. The pure helpers
 * are unit-tested in Node; the rest needs a browser.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SectionDetect = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const STRIP = { top: 0.03, bottom: 0.20, width: 576, height: 192, renderWidth: 900 };
  const THUMB_WIDTH = 320;
  const DEFAULTS = {
    ortModule: 'vendor/ort/ort.wasm.min.mjs',
    wasmDir: 'vendor/ort/',
    modelUrl: 'models/section-features.ort',
    headUrl: 'models/section-head.json'
  };

  /** RGBA bytes -> float32 RGB in -1..1 (MobileNetV2 preprocess_input), row-major. */
  function preprocessStrip(rgba, width, height) {
    if (!rgba || rgba.length !== width * height * 4) throw new Error('preprocessStrip: expected a ' + width + 'x' + height + ' RGBA buffer');
    const out = new Float32Array(width * height * 3);
    for (let i = 0, o = 0; i < rgba.length; i += 4, o += 3) {
      out[o] = rgba[i] / 127.5 - 1;
      out[o + 1] = rgba[i + 1] / 127.5 - 1;
      out[o + 2] = rgba[i + 2] / 127.5 - 1;
    }
    return out;
  }

  /** Logistic-regression decision value for one feature vector. */
  function scoreFeatures(features, head) {
    if (features.length !== head.w.length) throw new Error('scoreFeatures: feature length ' + features.length + ' does not match weights ' + head.w.length);
    let sum = head.b;
    for (let i = 0; i < features.length; i++) sum += features[i] * head.w[i];
    return sum;
  }

  /** The top STRIP.top..STRIP.bottom of a pdf.js page, rendered STRIP.renderWidth px wide. */
  async function renderStrip(page) {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: STRIP.renderWidth / base.width });
    const offset = Math.round(viewport.height * STRIP.top);
    const height = Math.max(1, Math.round(viewport.height * (STRIP.bottom - STRIP.top)));
    const canvas = document.createElement('canvas');
    canvas.width = STRIP.renderWidth;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, transform: [1, 0, 0, 1, 0, -offset] }).promise;
    return canvas;
  }

  function canvasToUrl(canvas, quality) {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/jpeg', quality)), 'image/jpeg', quality);
    });
  }

  function friendlyPdfError(err) {
    const name = err && err.name;
    if (name === 'PasswordException') return new Error('This PDF is password protected, so its pages cannot be read.');
    if (name === 'InvalidPDFException' || name === 'FormatError' || name === 'MissingPDFException') return new Error('This file is not a readable PDF.');
    return err instanceof Error ? err : new Error(String(err));
  }

  const abortError = () => Object.assign(new Error('Scan cancelled.'), { name: 'AbortError' });

  function createSectionDetector(options) {
    const cfg = Object.assign({}, DEFAULTS, options);
    let loading = null;
    let ort = null;

    function load() {
      if (!loading) {
        loading = (async () => {
          ort = await import(new URL(cfg.ortModule, document.baseURI).href);
          const dir = new URL(cfg.wasmDir, document.baseURI).href;
          ort.env.wasm.wasmPaths = { mjs: dir + 'ort-wasm-simd-threaded.mjs', wasm: dir + 'ort-wasm-simd-threaded.wasm' };
          ort.env.wasm.numThreads = 1;
          const [modelResponse, headResponse] = await Promise.all([
            fetch(new URL(cfg.modelUrl, document.baseURI).href),
            fetch(new URL(cfg.headUrl, document.baseURI).href)
          ]);
          if (!modelResponse.ok || !headResponse.ok) throw new Error('The page-finder model could not be downloaded. Check your connection and try again.');
          const head = await headResponse.json();
          const session = await ort.InferenceSession.create(new Uint8Array(await modelResponse.arrayBuffer()), { executionProviders: ['wasm'] });
          return { session, head };
        })();
        loading.catch(() => { loading = null; });
      }
      return loading;
    }

    async function scorePage(session, head, stripCanvas) {
      const input = document.createElement('canvas');
      input.width = STRIP.width;
      input.height = STRIP.height;
      const ctx = input.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(stripCanvas, 0, 0, STRIP.width, STRIP.height);
      const tensor = new ort.Tensor('float32', preprocessStrip(ctx.getImageData(0, 0, STRIP.width, STRIP.height).data, STRIP.width, STRIP.height), [1, STRIP.height, STRIP.width, 3]);
      const out = await session.run({ [session.inputNames[0]]: tensor });
      const score = scoreFeatures(out[session.outputNames[0]].data, head);
      if (!Number.isFinite(score)) throw new Error('The model returned an unusable score.');
      return score;
    }

    async function score(file, opts) {
      const { onProgress, signal } = opts || {};
      const { session, head } = await load();
      let pdf;
      try {
        // isEvalSupported: false closes CVE-2024-4367 (a crafted PDF running script in pdf.js < 4.2.67); see app.js
        pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
      } catch (err) {
        throw friendlyPdfError(err);
      }
      const thumbs = [];
      const scores = [];
      try {
        const total = pdf.numPages;
        if (total < 1) throw new Error('This PDF has no pages.');
        for (let n = 1; n <= total; n++) {
          if (signal && signal.aborted) throw abortError();
          const page = await pdf.getPage(n);
          let strip;
          try {
            strip = await renderStrip(page);
          } finally {
            page.cleanup();
          }
          scores.push({ page: n, score: await scorePage(session, head, strip) });
          const thumb = document.createElement('canvas');
          thumb.width = THUMB_WIDTH;
          thumb.height = Math.max(1, Math.round(strip.height * THUMB_WIDTH / strip.width));
          thumb.getContext('2d').drawImage(strip, 0, 0, thumb.width, thumb.height);
          thumbs.push(await canvasToUrl(thumb, 0.8));
          if (onProgress) onProgress(n, total);
        }
        return { scores, thumbs, pageCount: total };
      } catch (err) {
        thumbs.forEach((u) => URL.revokeObjectURL(u));
        throw err;
      } finally {
        pdf.destroy();
      }
    }

    return { load, score };
  }

  return { STRIP, preprocessStrip, scoreFeatures, renderStrip, createSectionDetector };
}));
