const assert = require('assert');
const N = require('./image-normalize.js');

// Build a minimal JPEG header with an EXIF orientation tag
function jpegWithOrientation(value, endian) {
  const little = endian === 'II';
  const u16 = (v) => little ? [v & 255, v >> 8] : [v >> 8, v & 255];
  const u32 = (v) => little ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255] : [(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255];
  const tiff = [...(little ? [0x49, 0x49] : [0x4D, 0x4D]), ...u16(0x2A), ...u32(8),
    ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(value), 0, 0, ...u32(0)];
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = exif.length + 2;
  return new Uint8Array([0xFF, 0xD8, 0xFF, 0xE1, len >> 8, len & 255, ...exif, 0xFF, 0xDA, 0, 2]);
}

// readJpegOrientation
for (const endian of ['MM', 'II']) {
  for (let v = 1; v <= 8; v++) assert.strictEqual(N.readJpegOrientation(jpegWithOrientation(v, endian)), v, `${endian} ${v}`);
}
assert.strictEqual(N.readJpegOrientation(jpegWithOrientation(6, 'MM').buffer), 6, 'accepts ArrayBuffer');
assert.strictEqual(N.readJpegOrientation(jpegWithOrientation(9, 'MM')), 1, 'out-of-range value defaults to 1');
assert.strictEqual(N.readJpegOrientation(new Uint8Array([0x89, 0x50, 0x4E, 0x47])), 1, 'not a JPEG');
assert.strictEqual(N.readJpegOrientation(new Uint8Array([0xFF, 0xD8, 0xFF, 0xDA, 0, 2])), 1, 'no EXIF');
assert.strictEqual(N.readJpegOrientation(new Uint8Array(0)), 1, 'empty');
assert.strictEqual(N.readJpegOrientation(jpegWithOrientation(6, 'MM').slice(0, 20)), 1, 'truncated EXIF');
assert.strictEqual(N.readJpegOrientation(new Uint8Array([0xFF, 0xD8, 0xFF, 0xE1, 0, 1, 0xFF, 0xDA])), 1, 'malformed segment length < 2');
assert.strictEqual(N.readJpegOrientation(new Uint8Array([0xFF, 0xD8, 0xFF, 0xFF, ...jpegWithOrientation(6, 'MM').slice(2)])), 6, 'JPEG 0xFF fill bytes before marker');

// isHeicLike
assert.strictEqual(N.isHeicLike({ name: 'IMG_1.HEIC', type: '' }), true);
assert.strictEqual(N.isHeicLike({ name: 'photo', type: 'image/heif' }), true);
assert.strictEqual(N.isHeicLike({ name: 'a.heif' }), true);
assert.strictEqual(N.isHeicLike({ name: 'a.jpg', type: 'image/jpeg' }), false);
assert.strictEqual(N.isHeicLike({}), false);

// fitWithin
assert.deepStrictEqual(N.fitWithin(1000, 500, 2000), { width: 1000, height: 500 });
assert.deepStrictEqual(N.fitWithin(4000, 3000, 2000), { width: 2000, height: 1500 });
assert.deepStrictEqual(N.fitWithin(3000, 6000, 2000), { width: 1000, height: 2000 });

// canEmbedOriginalDirectly
const base = { fileName: 'a.jpg', rotation: 0, quality: 1.0, enhanceScans: false, hasCrop: false, jpegOrientation: 1 };
assert.strictEqual(N.canEmbedOriginalDirectly(base), 'jpg');
assert.strictEqual(N.canEmbedOriginalDirectly({ ...base, fileName: 'A.JPEG' }), 'jpg');
assert.strictEqual(N.canEmbedOriginalDirectly({ ...base, fileName: 'a.png' }), 'png');
assert.strictEqual(N.canEmbedOriginalDirectly({ ...base, jpegOrientation: 6 }), null, 'EXIF-rotated JPEG must be re-rendered');
assert.strictEqual(N.canEmbedOriginalDirectly({ ...base, hasCrop: true }), null);
assert.strictEqual(N.canEmbedOriginalDirectly({ ...base, rotation: 90 }), null);
assert.strictEqual(N.canEmbedOriginalDirectly({ ...base, quality: 0.85 }), null);
assert.strictEqual(N.canEmbedOriginalDirectly({ ...base, enhanceScans: true }), null);
assert.strictEqual(N.canEmbedOriginalDirectly({ ...base, fileName: 'a.heic' }), null);
assert.strictEqual(N.canEmbedOriginalDirectly({ ...base, fileName: 'a.webp' }), null);
console.log('image-normalize: all assertions passed');
