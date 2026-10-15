const assert = require('assert');
const IS = require('./index-scan.js');

// A synthetic contents table: white page, saturated-blue rules, dark numerals in the first column.
function table({ width = 800, height = 1100, entries = [420, 500, 640, 700, 820], extras = true } = {}) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const set = (x, y, c) => { const i = (y * width + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; };
  const BLUE = [40, 110, 190], INK = [35, 35, 45], RED = [200, 40, 40];
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, c); };
  const xs = [60, 130, 520, 600, 680, 760];
  xs.forEach((x) => rect(x - 1, 300, x + 2, 1000, BLUE));
  rect(60, 299, 762, 302, BLUE);          // table top
  rect(60, 379, 762, 382, BLUE);          // header bottom
  for (let y = 420; y <= 1000; y += 40) rect(60, y, 762, y + 2, BLUE);
  entries.forEach((y) => { rect(88, y, 96, y + 20, INK); rect(100, y, 108, y + 20, INK); }); // a two-digit number
  if (extras) {
    rect(540, 430, 580, 450, INK);        // handwriting in the page column
    rect(70, 560, 120, 566, RED);         // a red mark in the first column
    rect(150, 430, 500, 450, INK);        // the entry text
    for (let i = 0; i < 12; i++) rect(70 + i, 305 + i, 74 + i, 309 + i, INK); // "SR. NO." header ink above the entries
  }
  return { width, height, data };
}

// pixel classes
assert.ok(IS.isRule(40, 110, 190) && !IS.isRule(35, 35, 45) && !IS.isRule(255, 255, 255));
assert.ok(IS.isInk(35, 35, 45) && !IS.isInk(40, 110, 190) && !IS.isInk(200, 40, 40) && !IS.isInk(240, 240, 240));
assert.ok(IS.isRed(200, 40, 40) && !IS.isRed(35, 35, 45));

// rules
{
  const t = table();
  const v = IS.verticalRules(t);
  assert.strictEqual(v.length, 6, 'six vertical rules');
  assert.deepStrictEqual(v.map(Math.round), [60, 130, 520, 600, 680, 760]);
  const h = IS.horizontalRules(t, 60, 760);
  assert.ok(h.length >= 3 && Math.abs(h[0] - 300) <= 2 && Math.abs(h[1] - 380) <= 2, 'top and header-bottom rules found: ' + h.slice(0, 3));
}

// entry count: numerals only count, red marks / page column / header ink do not
{
  const e = IS.estimateEntries(table());
  assert.strictEqual(e.confidence, 'ok');
  assert.strictEqual(e.count, 5, 'five entries');
  assert.deepStrictEqual(e.rows.map((r) => Math.round(r.y0 / 10) * 10), [420, 500, 640, 700, 820]);
  const bands = IS.entryBands(e);
  assert.strictEqual(bands.length, 5);
  assert.ok(bands.every((b, i) => b.y1 > b.y0 && (i === 0 || b.y0 >= bands[i - 1].y1 - 1)), 'bands are ordered and do not overlap');
  assert.ok(bands[0].y0 <= 420 && bands[0].y1 > 440, 'a band covers its numeral');
}
assert.strictEqual(IS.estimateEntries(table({ entries: [420, 460, 500, 540, 580, 620, 660, 700, 740, 780, 820, 860, 900] })).count, 13, '13 entries (DWM-sized)');
assert.strictEqual(IS.estimateEntries(table({ entries: [] })).count, 0);
assert.strictEqual(IS.estimateEntries(table({ entries: [] })).confidence, 'low');

// not a table: low confidence, never a crash
{
  const blank = { width: 300, height: 300, data: new Uint8ClampedArray(300 * 300 * 4).fill(255) };
  const e = IS.estimateEntries(blank);
  assert.strictEqual(e.count, 0); assert.strictEqual(e.confidence, 'low'); assert.deepStrictEqual(IS.entryBands(e), []);
  const noise = { width: 200, height: 200, data: new Uint8ClampedArray(200 * 200 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7919) % 256)) };
  assert.strictEqual(IS.estimateEntries(noise).confidence, 'low');
}
console.log('index-scan: all assertions passed');
