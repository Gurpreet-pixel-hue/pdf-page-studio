const assert = require('assert');
const S = require('./crop-state.js');
const pdf = () => ({ sourceType: 'pdf', cropState: 'none' });
const img = (state) => ({ sourceType: 'image', cropState: state || 'none', cropQuad: null, cropConfidence: 0 });

// PDF-only uploads: no Auto Crop
assert.strictEqual(S.countCroppable([pdf(), pdf()]), 0);
assert.strictEqual(S.countCroppable([]), 0);
// Mixed uploads: button shown, counts images only
assert.strictEqual(S.countCroppable([pdf(), img(), img(), pdf()]), 2);
assert.deepStrictEqual(S.autoCropTargets([pdf(), img(), img('manual'), img('auto'), img('needs-review')]), [1, 3, 4]);
assert.deepStrictEqual(S.autoCropTargets([pdf()]), []);

const quad = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]];
{
  const p = img();
  assert.strictEqual(S.applyDetection(p, { quad, confidence: 0.8 }), 'auto');
  assert.deepStrictEqual(p.cropQuad, quad);
}
{
  const p = img();
  assert.strictEqual(S.applyDetection(p, { quad, confidence: S.CONFIDENCE_THRESHOLD }), 'auto', 'threshold is inclusive');
  const q = img();
  assert.strictEqual(S.applyDetection(q, { quad, confidence: S.CONFIDENCE_THRESHOLD - 0.01 }), 'needs-review');
  assert.strictEqual(q.cropQuad, null, 'weak detection leaves the page uncropped');
  const r = img();
  assert.strictEqual(S.applyDetection(r, { quad: null, confidence: 0.9 }), 'needs-review', 'no quad is never auto');
  assert.strictEqual(r.cropQuad, null);
}
{
  const p = img('auto'); p.cropQuad = quad;
  S.applyManualCrop(p, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  assert.strictEqual(p.cropState, 'manual');
  S.resetCrop(p);
  assert.deepStrictEqual([p.cropState, p.cropQuad, p.cropConfidence], ['none', null, 0]);
}
{
  const pages = [img(), img(), pdf()];
  S.applyDetection(pages[0], { quad, confidence: 0.9 });
  S.applyDetection(pages[1], { quad, confidence: 0.1 });
  assert.deepStrictEqual(S.summarize(pages, [0, 1]), { cropped: 1, review: 1 });
}
console.log('crop-state: all assertions passed');
