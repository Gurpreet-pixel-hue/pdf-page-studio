const assert = require('assert');
const PageDetect = require('./page-detect.js');

// --- preprocessRGBA: ImageNet-normalised NHWC floats, alpha dropped
{
  const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 7, 0, 128, 255, 0]);
  const out = PageDetect.preprocessRGBA(rgba, 2);
  assert.strictEqual(out.length, 2 * 2 * 3);
  assert.ok(out instanceof Float32Array);
  const close = (a, b) => Math.abs(a - b) < 1e-5;
  assert.ok(close(out[0], (1 - 0.485) / 0.229) && close(out[1], (1 - 0.456) / 0.224) && close(out[2], (1 - 0.406) / 0.225), 'white pixel R,G,B');
  assert.ok(close(out[3], -0.485 / 0.229), 'black pixel R');
  assert.ok(close(out[6], (1 - 0.485) / 0.229) && close(out[7], -0.456 / 0.224), 'red pixel ignores alpha');
  assert.ok(close(out[10], (128 / 255 - 0.456) / 0.224), 'last pixel G');
}
assert.throws(() => PageDetect.preprocessRGBA(new Uint8ClampedArray(7), 2), /RGBA buffer/);

// --- decodeOutput: model coords are TL,TR,BR,BL normalised
{
  const good = PageDetect.decodeOutput([0.1, 0.1, 0.9, 0.12, 0.88, 0.9, 0.12, 0.92], 2.0);
  assert.deepStrictEqual(good.quad, [[0.1, 0.1], [0.9, 0.12], [0.88, 0.9], [0.12, 0.92]]);
  assert.ok(Math.abs(good.confidence - 1 / (1 + Math.exp(-2))) < 1e-9, 'confidence = sigmoid(logit)');
}
{
  const clipped = PageDetect.decodeOutput([-0.05, 0, 1.2, 0, 1, 1.1, 0, 1], 0);
  assert.deepStrictEqual(clipped.quad, [[0, 0], [1, 0], [1, 1], [0, 1]], 'coords clip to the frame');
  assert.strictEqual(clipped.confidence, 0.5);
}
{
  const bowtie = PageDetect.decodeOutput([0.1, 0.1, 0.9, 0.9, 0.9, 0.1, 0.1, 0.9], 5);
  assert.ok(bowtie.quad !== null, 'a crossed quad is repaired by reordering');
  assert.ok(PageDetect.CropGeometry.isValidQuad(bowtie.quad));
}
{
  const tiny = PageDetect.decodeOutput([0.5, 0.5, 0.51, 0.5, 0.51, 0.51, 0.5, 0.51], 8);
  assert.strictEqual(tiny.quad, null, 'a speck is not a page');
  assert.strictEqual(tiny.confidence, 0);
}
{
  const nan = PageDetect.decodeOutput([NaN, 0, 1, 0, 1, 1, 0, 1], 3);
  assert.strictEqual(nan.quad, null); assert.strictEqual(nan.confidence, 0);
  assert.strictEqual(PageDetect.decodeOutput([0, 0, 1, 0, 1, 1, 0, 1], NaN).confidence, 0, 'non-finite score gives 0');
  assert.strictEqual(PageDetect.decodeOutput([0, 0, 1], 1).quad, null, 'wrong length');
}
// --- downscaleSteps: never shrink by more than half per step, so the result does not depend on the browser's resize quality
{
  assert.deepStrictEqual(PageDetect.downscaleSteps(2000, 1500, 256), [[1000, 750], [500, 375], [256, 256]]);
  assert.deepStrictEqual(PageDetect.downscaleSteps(400, 300, 256), [[256, 256]], 'under 2x needs one step');
  assert.deepStrictEqual(PageDetect.downscaleSteps(256, 256, 256), [], 'already the right size');
  const steps = PageDetect.downscaleSteps(5712, 3213, 256);
  let [w, h] = [5712, 3213];
  steps.slice(0, -1).forEach(([sw, sh]) => { assert.ok(sw >= w / 2 - 1 && sh >= h / 2 - 1); [w, h] = [sw, sh]; });
  assert.deepStrictEqual(steps[steps.length - 1], [256, 256]);
}
console.log('page-detect: all assertions passed');
