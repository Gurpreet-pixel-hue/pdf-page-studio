const assert = require('assert');
const G = require('./crop-geometry.js');
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

// orderQuad
assert.deepStrictEqual(G.orderQuad([[1, 1], [0, 0], [0, 1], [1, 0]]), [[0, 0], [1, 0], [1, 1], [0, 1]]);
assert.deepStrictEqual(G.orderQuad([[0.9, 0.1], [0.1, 0.9], [0.1, 0.1], [0.9, 0.9]]), [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]);

// fullQuad returns a fresh copy
{ const q = G.fullQuad(); q[0][0] = 5; assert.strictEqual(G.fullQuad()[0][0], 0); }

// quadIoU
const unit = G.fullQuad();
near(G.quadIoU(unit, unit), 1);
near(G.quadIoU(unit, [[0, 0], [0.5, 0], [0.5, 1], [0, 1]]), 0.5);
near(G.quadIoU(unit, [[2, 2], [3, 2], [3, 3], [2, 3]]), 0);
near(G.quadIoU([[0, 0], [1, 0], [1, 1], [0, 1]], [[0, 0], [0, 1], [1, 1], [1, 0]]), 1); // winding independent

// isValidQuad
assert.strictEqual(G.isValidQuad(unit), true);
assert.strictEqual(G.isValidQuad([[0, 0], [1, 1], [1, 0], [0, 1]]), false, 'bow-tie is not convex');
assert.strictEqual(G.isValidQuad([[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1]]), false, 'too small');
assert.strictEqual(G.isValidQuad([[0, 0], [1, 0], [1, 1]]), false, 'three points');
assert.strictEqual(G.isValidQuad([[0, 0], [NaN, 0], [1, 1], [0, 1]]), false, 'NaN');
assert.strictEqual(G.isValidQuad([[0, 0], [1, 0], [2, 0], [0, 1]]), false, 'collinear corner');
assert.strictEqual(G.isValidQuad(null), false);

// clampQuad
assert.deepStrictEqual(G.clampQuad([[-0.2, 0.5], [1.3, 0.5], [1, 2], [0, -1]]), [[0, 0.5], [1, 0.5], [1, 1], [0, 0]]);

// quadOutputSize
assert.deepStrictEqual(G.quadOutputSize([[0, 0], [100, 0], [100, 50], [0, 50]]), { width: 100, height: 50 });
assert.deepStrictEqual(G.quadOutputSize([[0, 0], [100, 0], [120, 50], [-20, 50]]), { width: 120, height: 54 });
assert.deepStrictEqual(G.quadOutputSize([[5, 5], [5, 5], [5, 5], [5, 5]]), { width: 1, height: 1 });

// capPixels
assert.deepStrictEqual(G.capPixels(100, 100, 20000), { width: 100, height: 100, scale: 1 });
{ const r = G.capPixels(4000, 3000, 6000000); assert.ok(r.width * r.height <= 6000000); near(r.width / r.height, 4 / 3, 0.01); }

// solveHomography maps src corners to dst corners
{
  const src = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const dst = [[2, 1], [12, 3], [11, 14], [1, 9]];
  const h = G.solveHomography(src, dst);
  src.forEach(([x, y], i) => {
    const w = h[6] * x + h[7] * y + 1;
    near((h[0] * x + h[1] * y + h[2]) / w, dst[i][0], 1e-6);
    near((h[3] * x + h[4] * y + h[5]) / w, dst[i][1], 1e-6);
  });
}
assert.throws(() => G.solveHomography([[0, 0], [1, 0], [2, 0], [3, 0]], [[0, 0], [1, 0], [1, 1], [0, 1]]), /Degenerate/);

// warpPerspective: a 4x4 image with a distinct value per pixel
function makeImage(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4; data[o] = x * 10; data[o + 1] = y * 10; data[o + 2] = 7; data[o + 3] = 255;
  }
  return { width: w, height: h, data };
}
{
  // identity quad reproduces the image
  const img = makeImage(8, 6);
  const out = G.warpPerspective(img, [[0, 0], [8, 0], [8, 6], [0, 6]], 8, 6);
  assert.strictEqual(out.width, 8); assert.strictEqual(out.height, 6);
  for (let i = 0; i < img.data.length; i++) near(out.data[i], img.data[i], 1);
}
{
  // sub-rectangle crop: output top-left pixel samples near source (2,1)
  const img = makeImage(20, 20);
  const out = G.warpPerspective(img, [[2, 1], [12, 1], [12, 11], [2, 11]], 10, 10);
  near(out.data[0], 20, 1); near(out.data[1], 10, 1);
  const last = (9 * 10 + 9) * 4; near(out.data[last], 110, 1); near(out.data[last + 1], 100, 1);
  assert.strictEqual(out.data[3], 255, 'alpha preserved');
}
{
  // quad extending past the image is clamped, not a crash
  const img = makeImage(10, 10);
  const out = G.warpPerspective(img, [[-5, -5], [15, -5], [15, 15], [-5, 15]], 10, 10);
  assert.strictEqual(out.data.length, 400);
}
console.log('crop-geometry: all assertions passed');
