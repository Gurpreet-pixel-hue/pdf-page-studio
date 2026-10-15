const assert = require('assert');
const SD = require('./section-detect.js');

assert.deepStrictEqual(SD.STRIP, { top: 0.03, bottom: 0.20, width: 576, height: 192, renderWidth: 900 });

// preprocessStrip: RGB scaled to -1..1, alpha dropped, row-major
{
  const rgba = new Uint8ClampedArray([0, 255, 128, 255, 255, 0, 0, 7]); // two pixels
  const out = SD.preprocessStrip(rgba, 2, 1);
  assert.ok(out instanceof Float32Array);
  assert.strictEqual(out.length, 6);
  const close = (a, b) => Math.abs(a - b) < 1e-6;
  assert.ok(close(out[0], -1) && close(out[1], 1) && close(out[2], 128 / 127.5 - 1), 'first pixel');
  assert.ok(close(out[3], 1) && close(out[4], -1) && close(out[5], -1), 'second pixel ignores alpha');
}
assert.throws(() => SD.preprocessStrip(new Uint8ClampedArray(7), 2, 1), /RGBA/, 'wrong buffer size is an error');

// scoreFeatures: dot product plus bias
assert.strictEqual(SD.scoreFeatures([1, 2, 3], { w: [0.5, -1, 2], b: 0.25 }), 0.5 - 2 + 6 + 0.25);
assert.strictEqual(SD.scoreFeatures([], { w: [], b: 1.5 }), 1.5);
assert.throws(() => SD.scoreFeatures([1, 2], { w: [1], b: 0 }), /length/, 'feature and weight lengths must match');
assert.ok(Number.isNaN(SD.scoreFeatures([NaN], { w: [1], b: 0 })), 'NaN stays NaN so the caller can reject it');

console.log('section-detect: all assertions passed');
