/**
 * PDF Page Studio - Image ingestion helpers
 * Pure functions: EXIF orientation parsing, HEIC detection, working-copy
 * sizing, and the decision whether an original file can be embedded as-is.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ImageNormalize = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  /**
   * Read the EXIF orientation (1-8) from JPEG bytes. Returns 1 when the
   * file is not a JPEG or carries no orientation tag.
   */
  function readJpegOrientation(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return 1;

    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xFF) return 1;
      const marker = bytes[offset + 1];
      if (marker === 0xDA || marker === 0xD9) return 1; // image data / end: no EXIF found
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (marker === 0xE1 && isExifHeader(bytes, offset + 4)) {
        return readOrientationFromTiff(bytes, offset + 10, offset + 2 + length);
      }
      offset += 2 + length;
    }
    return 1;
  }

  function isExifHeader(bytes, at) {
    return bytes[at] === 0x45 && bytes[at + 1] === 0x78 && bytes[at + 2] === 0x69 &&
      bytes[at + 3] === 0x66 && bytes[at + 4] === 0 && bytes[at + 5] === 0;
  }

  function readOrientationFromTiff(bytes, tiff, end) {
    if (tiff + 8 > end) return 1;
    const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
    const big = bytes[tiff] === 0x4D && bytes[tiff + 1] === 0x4D;
    if (!little && !big) return 1;
    const u16 = (at) => little ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1];
    const u32 = (at) => little
      ? (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
      : ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;

    const ifd = tiff + u32(tiff + 4);
    if (ifd + 2 > end) return 1;
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (entry + 12 > end) return 1;
      if (u16(entry) === 0x0112) {
        const value = u16(entry + 8);
        return value >= 1 && value <= 8 ? value : 1;
      }
    }
    return 1;
  }

  /** True for HEIC/HEIF files, by MIME type or extension (browsers often report an empty type). */
  function isHeicLike(file) {
    const type = (file.type || '').toLowerCase();
    if (type === 'image/heic' || type === 'image/heif' || type === 'image/heic-sequence' || type === 'image/heif-sequence') return true;
    return /\.(heic|heif)$/i.test(file.name || '');
  }

  /** Scale (width, height) so the long edge is at most maxEdge. Never upscales. */
  function fitWithin(width, height, maxEdge) {
    const longEdge = Math.max(width, height);
    if (longEdge <= maxEdge) return { width, height };
    const scale = maxEdge / longEdge;
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }

  /**
   * Decide whether the original file bytes can go into the PDF untouched.
   * Returns 'png', 'jpg', or null (must be re-rendered through a canvas).
   * A JPEG with a non-default EXIF orientation must be re-rendered, because
   * PDF embedding ignores EXIF and would show it sideways.
   */
  function canEmbedOriginalDirectly(opts) {
    if (opts.hasCrop || opts.rotation !== 0 || opts.quality !== 1.0 || opts.enhanceScans) return null;
    const name = (opts.fileName || '').toLowerCase();
    if (name.endsWith('.png')) return 'png';
    if (name.endsWith('.jpg') || name.endsWith('.jpeg')) {
      return (opts.jpegOrientation || 1) === 1 ? 'jpg' : null;
    }
    return null;
  }

  return { readJpegOrientation, isHeicLike, fitWithin, canEmbedOriginalDirectly };
}));
