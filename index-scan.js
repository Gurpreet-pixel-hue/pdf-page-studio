/**
 * PDF Page Studio - Contents page scan
 * Reads a photographed, upright contents table: finds the ruled columns, counts the
 * entries from the "Sr. No." column and returns a band for each entry. The analysis is
 * pure RGBA, so it is tested in Node on synthetic tables; analyseImage() is the browser glue.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.IndexScan = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const RULE_GAP = 4;          // a printed rule may break for a few pixels (handwriting crossing it)
  const MIN_RULE_FRACTION = 0.35;
  const MIN_NUMERAL_HEIGHT = 7;
  const NUMERAL_MERGE_GAP = 6;
  const ANALYSIS_WIDTH = 1000;  // the photo is warped to this width before analysis

  const isRule = (r, g, b) => b - r > 45 && b - g > 10 && b > 110;           // saturated table-line blue
  const isRed = (r, g, b) => r - b > 60 && r - g > 60;                       // the teacher's marks
  const isInk = (r, g, b) => !isRule(r, g, b) && !isRed(r, g, b) && (r + g + b) / 3 < 125; // dark pen, not a rule

  /** Longest run of `test` along a line, bridging gaps of up to RULE_GAP pixels. */
  function longestRun(length, test) {
    let best = 0, run = 0, gap = 0;
    for (let i = 0; i < length; i++) {
      if (test(i)) { run += 1 + gap; gap = 0; if (run > best) best = run; }
      else if (run > 0 && gap < RULE_GAP) gap++;
      else { run = 0; gap = 0; }
    }
    return best;
  }

  /** Merge neighbouring positions (a rule is a few pixels thick) into centres. */
  function groupCentres(positions, maxDistance) {
    const centres = [];
    let start = null, last = null;
    positions.forEach((p) => {
      if (start === null) { start = last = p; return; }
      if (p - last <= maxDistance) { last = p; return; }
      centres.push((start + last) / 2);
      start = last = p;
    });
    if (start !== null) centres.push((start + last) / 2);
    return centres;
  }

  function pixel(img, x, y) {
    const i = (y * img.width + x) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  }

  /** x of the long vertical table rules, left to right. */
  function verticalRules(img) {
    const hits = [];
    for (let x = 0; x < img.width; x++) {
      const run = longestRun(img.height, (y) => { const p = pixel(img, x, y); return isRule(p[0], p[1], p[2]); });
      if (run >= img.height * MIN_RULE_FRACTION) hits.push(x);
    }
    return groupCentres(hits, 3);
  }

  /** y of the long horizontal table rules between x0 and x1, top to bottom. */
  function horizontalRules(img, x0, x1) {
    const hits = [];
    for (let y = 0; y < img.height; y++) {
      const run = longestRun(x1 - x0, (i) => { const p = pixel(img, x0 + i, y); return isRule(p[0], p[1], p[2]); });
      if (run >= (x1 - x0) * 0.6) hits.push(y);
    }
    return groupCentres(hits, 3);
  }

  /**
   * Count the entries of a contents table from its first column (one handwritten
   * number per entry). confidence is 'low' when the table structure was not found; count is then 0.
   */
  function estimateEntries(img) {
    const low = (rules) => ({ count: 0, rows: [], rules: rules || [], headerBottom: 0, tableBottom: 0, confidence: 'low' });
    const rules = verticalRules(img);
    if (rules.length < 5) return low(rules);
    const x0 = rules[0], x1 = rules[rules.length - 1];
    const h = horizontalRules(img, Math.round(x0), Math.round(x1));
    if (h.length < 3) return low(rules);
    const headerBottom = h[1];
    const tableBottom = h[h.length - 1];
    const left = Math.round(rules[0]) + 5, right = Math.round(rules[1]) - 5;
    if (right - left < 8) return low(rules);

    const inkInRow = [];
    for (let y = Math.round(headerBottom) + 4; y < Math.round(tableBottom) - 1; y++) {
      let n = 0;
      for (let x = left; x < right; x++) { const p = pixel(img, x, y); if (isInk(p[0], p[1], p[2])) n++; }
      inkInRow.push([y, n]);
    }
    const rows = [];
    let cur = null;
    inkInRow.forEach(([y, n]) => {
      if (n >= 2) {
        if (cur && y - cur.y1 <= NUMERAL_MERGE_GAP) cur.y1 = y;
        else { if (cur) rows.push(cur); cur = { y0: y, y1: y }; }
      }
    });
    if (cur) rows.push(cur);
    const numerals = rows.filter((r) => r.y1 - r.y0 + 1 >= MIN_NUMERAL_HEIGHT);
    return { count: numerals.length, rows: numerals, rules, headerBottom, tableBottom, confidence: numerals.length > 0 ? 'ok' : 'low' };
  }

  /** A vertical band for each entry, from just above its number to just above the next one. */
  function entryBands(estimate) {
    const { rows, tableBottom } = estimate;
    if (rows.length === 0) return [];
    const avg = rows.reduce((a, r) => a + (r.y1 - r.y0 + 1), 0) / rows.length;
    return rows.map((r, i) => ({
      y0: Math.max(0, Math.round(r.y0 - 8)),
      y1: Math.round(i + 1 < rows.length ? rows[i + 1].y0 - 8 : Math.min(tableBottom, r.y1 + avg * 3))
    }));
  }

  /**
   * Browser glue. `source` is an upright picture of the contents page (the caller has already
   * cropped it, or the photo is a clean scan). It is scaled to ANALYSIS_WIDTH, analysed, and each
   * entry's handwriting cell (the second column) is cut out as a canvas.
   */
  async function analyseImage(source) {
    const sw = source.naturalWidth || source.width;
    const sh = source.naturalHeight || source.height;
    const canvas = document.createElement('canvas');
    canvas.width = ANALYSIS_WIDTH;
    canvas.height = Math.round(sh * ANALYSIS_WIDTH / sw);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const estimate = estimateEntries(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (estimate.confidence === 'low') {
      return { estimate, crops: [], warning: 'The table in this photo could not be read. Enter the number of entries yourself.' };
    }
    const x0 = Math.round(estimate.rules[1]) + 3;
    const x1 = Math.round(estimate.rules[2]) - 3;
    const crops = entryBands(estimate).map((band) => {
      const crop = document.createElement('canvas');
      crop.width = Math.max(1, x1 - x0);
      crop.height = Math.max(1, band.y1 - band.y0);
      crop.getContext('2d').drawImage(canvas, x0, band.y0, crop.width, crop.height, 0, 0, crop.width, crop.height);
      return crop;
    });
    return { estimate, crops, warning: null };
  }

  return { isRule, isRed, isInk, verticalRules, horizontalRules, estimateEntries, entryBands, analyseImage };
}));
