/**
 * PDF Page Studio - Crop geometry helpers
 * Pure quad math and a perspective warp. Quads are four [x, y] points in
 * TL, TR, BR, BL order. Detection and the editor use normalised (0..1)
 * coordinates; the warp takes pixel coordinates.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CropGeometry = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const FULL_QUAD = [[0, 0], [1, 0], [1, 1], [0, 1]];

  function fullQuad() {
    return FULL_QUAD.map(p => p.slice());
  }

  /** Order four points as TL, TR, BR, BL. */
  function orderQuad(points) {
    const sums = points.map(([x, y]) => x + y);
    const diffs = points.map(([x, y]) => y - x);
    return [
      points[sums.indexOf(Math.min(...sums))],
      points[diffs.indexOf(Math.min(...diffs))],
      points[sums.indexOf(Math.max(...sums))],
      points[diffs.indexOf(Math.max(...diffs))]
    ];
  }

  /** Signed polygon area (positive when counter-clockwise in a y-up frame). */
  function polygonArea(poly) {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      a += x1 * y2 - x2 * y1;
    }
    return a / 2;
  }

  function counterClockwise(poly) {
    return polygonArea(poly) < 0 ? poly.slice().reverse() : poly;
  }

  /** Sutherland-Hodgman clip of one convex polygon by another. */
  function clipConvex(subject, clipper) {
    let output = counterClockwise(subject);
    const clip = counterClockwise(clipper);
    for (let i = 0; i < clip.length; i++) {
      const a = clip[i];
      const b = clip[(i + 1) % clip.length];
      const input = output;
      output = [];
      const inside = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
      const cross = (p, q) => {
        const a1 = q[1] - p[1], b1 = p[0] - q[0], c1 = a1 * p[0] + b1 * p[1];
        const a2 = b[1] - a[1], b2 = a[0] - b[0], c2 = a2 * a[0] + b2 * a[1];
        const det = a1 * b2 - a2 * b1;
        return [(b2 * c1 - b1 * c2) / det, (a1 * c2 - a2 * c1) / det];
      };
      for (let j = 0; j < input.length; j++) {
        const p = input[j];
        const q = input[(j + 1) % input.length];
        if (inside(q)) {
          if (!inside(p)) output.push(cross(p, q));
          output.push(q);
        } else if (inside(p)) {
          output.push(cross(p, q));
        }
      }
      if (output.length === 0) return [];
    }
    return output;
  }

  /** Intersection over union of two convex quads. */
  function quadIoU(a, b) {
    const inter = Math.abs(polygonArea(clipConvex(a, b)));
    const union = Math.abs(polygonArea(a)) + Math.abs(polygonArea(b)) - inter;
    return union > 0 ? inter / union : 0;
  }

  /** True when the quad is finite, convex, and covers at least minArea of the unit square. */
  function isValidQuad(quad, minArea) {
    if (!Array.isArray(quad) || quad.length !== 4) return false;
    if (!quad.every(p => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))) return false;
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = quad[i];
      const [x2, y2] = quad[(i + 1) % 4];
      const [x3, y3] = quad[(i + 2) % 4];
      const cross = (x2 - x1) * (y3 - y2) - (y2 - y1) * (x3 - x2);
      if (cross === 0) return false;
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return Math.abs(polygonArea(quad)) >= (minArea === undefined ? 0.02 : minArea);
  }

  function clamp01(v) {
    return Math.min(1, Math.max(0, v));
  }

  function clampQuad(quad) {
    return quad.map(([x, y]) => [clamp01(x), clamp01(y)]);
  }

  /** Output rectangle for a quad in pixel space: mean of opposite edge lengths. */
  function quadOutputSize(quadPx) {
    const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    const [tl, tr, br, bl] = quadPx;
    return {
      width: Math.max(1, Math.round((d(tl, tr) + d(bl, br)) / 2)),
      height: Math.max(1, Math.round((d(tl, bl) + d(tr, br)) / 2))
    };
  }

  /** Scale (width, height) down, never up, so that width * height <= maxPixels. */
  function capPixels(width, height, maxPixels) {
    const pixels = width * height;
    if (pixels <= maxPixels) return { width, height, scale: 1 };
    const scale = Math.sqrt(maxPixels / pixels);
    return {
      width: Math.max(1, Math.floor(width * scale)),
      height: Math.max(1, Math.floor(height * scale)),
      scale
    };
  }

  /** Solve the 3x3 homography H (h33 = 1) that maps each src[i] to dst[i]. */
  function solveHomography(src, dst) {
    const A = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i];
      const [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const n = 8;
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
      if (Math.abs(A[pivot][col]) < 1e-12) throw new Error('Degenerate quad');
      [A[col], A[pivot]] = [A[pivot], A[col]];
      [b[col], b[pivot]] = [b[pivot], b[col]];
      for (let r = col + 1; r < n; r++) {
        const f = A[r][col] / A[col][col];
        for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
        b[r] -= f * b[col];
      }
    }
    const h = new Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let s = b[r];
      for (let c = r + 1; c < n; c++) s -= A[r][c] * h[c];
      h[r] = s / A[r][r];
    }
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }

  /**
   * Perspective-correct the quad (pixel coordinates in src) into an
   * outWidth x outHeight RGBA image using bilinear sampling.
   * src: { width, height, data: Uint8ClampedArray | Uint8Array (RGBA) }.
   */
  function warpPerspective(src, quadPx, outWidth, outHeight) {
    const rect = [[0, 0], [outWidth, 0], [outWidth, outHeight], [0, outHeight]];
    const H = solveHomography(rect, quadPx);
    const out = new Uint8ClampedArray(outWidth * outHeight * 4);
    const { width: sw, height: sh, data } = src;

    for (let y = 0; y < outHeight; y++) {
      for (let x = 0; x < outWidth; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w = H[6] * px + H[7] * py + 1;
        const sx = (H[0] * px + H[1] * py + H[2]) / w - 0.5;
        const sy = (H[3] * px + H[4] * py + H[5]) / w - 0.5;
        const x0 = Math.max(0, Math.min(sw - 1, Math.floor(sx)));
        const y0 = Math.max(0, Math.min(sh - 1, Math.floor(sy)));
        const x1 = Math.min(sw - 1, x0 + 1);
        const y1 = Math.min(sh - 1, y0 + 1);
        const fx = Math.min(1, Math.max(0, sx - x0));
        const fy = Math.min(1, Math.max(0, sy - y0));
        const o = (y * outWidth + x) * 4;
        for (let c = 0; c < 4; c++) {
          const top = data[(y0 * sw + x0) * 4 + c] * (1 - fx) + data[(y0 * sw + x1) * 4 + c] * fx;
          const bottom = data[(y1 * sw + x0) * 4 + c] * (1 - fx) + data[(y1 * sw + x1) * 4 + c] * fx;
          out[o + c] = top * (1 - fy) + bottom * fy;
        }
      }
    }
    return { width: outWidth, height: outHeight, data: out };
  }

  return {
    fullQuad, orderQuad, polygonArea, quadIoU, isValidQuad, clampQuad,
    quadOutputSize, capPixels, solveHomography, warpPerspective
  };
}));
