const assert = require('assert');
const PF = require('./page-finder.js');

const scores = (pairs) => pairs.map(([page, score]) => ({ page, score }));
const pages = (list) => list.map((s) => s.page);

// --- rankPages ---
assert.deepStrictEqual(pages(PF.rankPages(scores([[1, 0.1], [2, 5], [3, 5], [4, -2]]))), [2, 3, 1, 4], 'highest first, ties by page');
assert.deepStrictEqual(PF.rankPages([]), []);

// --- pickSections without an entry count: cut-off only ---
{
  const s = scores([[1, 0.2], [2, 3.1], [3, 1.4], [4, 1.6], [5, -1], [6, 2.2]]);
  const r = PF.pickSections(s);
  assert.deepStrictEqual(pages(r.sections), [2, 4, 6], 'only scores above 1.5, in page order');
  assert.ok(r.sections.every((x) => x.confident));
  assert.deepStrictEqual(pages(r.more), [3, 1, 5], 'the rest are offered, best first');
  assert.deepStrictEqual(pages(PF.pickSections(s, { cutoff: 0 }).sections), [1, 2, 3, 4, 6]);
}
// nothing above the cut-off: no sections, candidates still offered
{
  const r = PF.pickSections(scores([[1, -3], [2, -1], [3, 0.4]]));
  assert.deepStrictEqual(r.sections, []);
  assert.deepStrictEqual(pages(r.more), [3, 2, 1]);
  assert.deepStrictEqual(PF.pickSections([]), { sections: [], more: [] });
}
// the candidate list is capped
{
  const many = scores(Array.from({ length: 40 }, (_, i) => [i + 1, -i]));
  assert.strictEqual(PF.pickSections(many).more.length, 10);
}
// --- pickSections with an entry count: top N, flagged when below the cut-off ---
{
  const s = scores([[1, 0.2], [2, 3.1], [3, 1.4], [4, 1.6], [5, -1], [6, 2.2]]);
  const r = PF.pickSections(s, { entryCount: 4 });
  assert.deepStrictEqual(pages(r.sections), [2, 3, 4, 6]);
  assert.deepStrictEqual(r.sections.map((x) => x.confident), [true, false, true, true], 'page 3 is chosen but below the cut-off');
  assert.deepStrictEqual(pages(r.more), [1, 5]);
  assert.strictEqual(PF.pickSections(s, { entryCount: 99, floor: -10 }).sections.length, 6, 'N is limited to the page count');
  assert.strictEqual(PF.pickSections(s, { entryCount: 99 }).sections.length, 5, 'and the floor still drops the page that is not heading-like');
  assert.deepStrictEqual(PF.pickSections(s, { entryCount: 0 }).sections.length, 3, 'a zero count falls back to the cut-off');
}
// the floor: an entry is never filled with a page that does not look like a heading at all
{
  const s = scores([[1, 0.2], [2, 3.1], [3, 1.4], [4, 1.6], [5, -1], [6, 2.2]]);
  const r = PF.pickSections(s, { entryCount: 6 });
  assert.deepStrictEqual(pages(r.sections), [1, 2, 3, 4, 6], 'page 5 (-1) is below the floor, so the sixth entry gets no page');
  assert.deepStrictEqual(pages(r.more), [5], 'but it is still offered as a candidate');
  assert.deepStrictEqual(pages(PF.pickSections(s, { entryCount: 6, floor: -2 }).sections), [1, 2, 3, 4, 5, 6], 'the floor can be changed');
  assert.strictEqual(PF.DEFAULT_FLOOR, -0.5);
  const flat = scores(Array.from({ length: 20 }, (_, i) => [i + 1, -3 - i / 100]));
  assert.deepStrictEqual(PF.pickSections(flat, { entryCount: 13 }).sections, [], 'a journal with no heading-like page fills nothing');
}

// --- adjacentPairs ---
assert.deepStrictEqual(PF.adjacentPairs([1, 3, 5, 7, 10, 13, 15, 16, 17, 20]), [[15, 16], [16, 17]]);
assert.deepStrictEqual(PF.adjacentPairs([17, 16, 3]), [[16, 17]], 'order of input does not matter');
assert.deepStrictEqual(PF.adjacentPairs([]), []);

// --- front pages and the counting choice ---
assert.strictEqual(PF.frontPageCount([{ page: 3 }, { page: 5 }]), 2);
assert.strictEqual(PF.frontPageCount([{ page: 1 }]), 0);
assert.strictEqual(PF.frontPageCount([]), 0);
assert.deepStrictEqual(PF.defaultCounting(2), { mode: 'as-is', extra: 0 }, 'certificate and index already in the PDF');
assert.deepStrictEqual(PF.defaultCounting(5), { mode: 'as-is', extra: 0 });
assert.deepStrictEqual(PF.defaultCounting(0), { mode: 'add', extra: 2 }, 'nothing in front: add certificate and index');
assert.deepStrictEqual(PF.defaultCounting(1), { mode: 'ask', extra: 1 }, 'one page in front: the user decides');

assert.strictEqual(PF.numberedPage(3, { mode: 'as-is', extra: 2 }), 3, 'as-is ignores extra');
assert.strictEqual(PF.numberedPage(3, { mode: 'add', extra: 2 }), 5);
assert.strictEqual(PF.numberedPage(3, { mode: 'ask', extra: 1 }), 3, 'undecided counts as the PDF numbers');
assert.strictEqual(PF.numberedPage(3, { mode: 'add', extra: 0 }), 3);
assert.strictEqual(PF.numberedPage(3, { mode: 'add', extra: 99 }), 23, 'extra is limited to 20');
assert.strictEqual(PF.numberedPage(3, { mode: 'add', extra: -4 }), 3, 'extra is never negative');
assert.strictEqual(PF.numberedPage(3, { mode: 'add', extra: 1.7 }), 5, 'extra is rounded to a whole number');
assert.strictEqual(PF.numberedPage(null, { mode: 'add', extra: 2 }), null);
assert.strictEqual(PF.describeCounting({ mode: 'add', extra: 2 }), 'Page numbers include 2 extra pages in front of this PDF.');
assert.strictEqual(PF.describeCounting({ mode: 'add', extra: 1 }), 'Page numbers include 1 extra page in front of this PDF.');
assert.strictEqual(PF.describeCounting({ mode: 'add', extra: 0 }), 'Page numbers are the PDF page numbers.');
assert.strictEqual(PF.describeCounting({ mode: 'as-is', extra: 2 }), 'Page numbers are the PDF page numbers.');

// --- labels ---
assert.deepStrictEqual(PF.makeLabels(4, 2), ['Experiment 1', 'Experiment 2', 'Assignment 1', 'Assignment 2']);
assert.deepStrictEqual(PF.makeLabels(3, 0), ['Experiment 1', 'Experiment 2', 'Experiment 3']);
assert.deepStrictEqual(PF.makeLabels(2, 5), ['Assignment 1', 'Assignment 2'], 'assignments are limited to the entry count');
assert.deepStrictEqual(PF.makeLabels(0, 2), []);
assert.deepStrictEqual(PF.makeLabels(3, undefined), ['Experiment 1', 'Assignment 1', 'Assignment 2'], 'default is 2 assignments');
assert.deepStrictEqual(PF.makeLabels(3, -1), ['Experiment 1', 'Experiment 2', 'Experiment 3']);
assert.strictEqual(PF.makeLabels(13, 2)[10], 'Experiment 11');
assert.strictEqual(PF.makeLabels(13, 2)[11], 'Assignment 1');

// --- assignEntries: order mapping, missing entries, manual overrides ---
{
  const rows = PF.assignEntries(3, [3, 5, 8], new Set(), new Map());
  assert.deepStrictEqual(rows.map((r) => [r.page, r.status]), [[3, 'ok'], [5, 'ok'], [8, 'ok']]);
  assert.ok(rows.every((r) => r.manual === false));
}
{ // DWM: 13 entries, 11 heading pages, Experiments 9-11 (indexes 8, 9, 10) are not in the PDF
  const found = [1, 3, 5, 7, 10, 13, 15, 16, 20, 26]; // 10 sections once the duplicate page 17 is dropped
  const rows = PF.assignEntries(13, found, new Set([8, 9, 10]), new Map());
  assert.deepStrictEqual(rows.map((r) => r.page), [1, 3, 5, 7, 10, 13, 15, 16, null, null, null, 20, 26]);
  assert.deepStrictEqual(rows.map((r) => r.status).slice(8, 11), ['missing', 'missing', 'missing']);
}
{ // fewer sections than entries: the trailing entries are unknown, never invented
  const rows = PF.assignEntries(4, [2, 6], new Set(), new Map());
  assert.deepStrictEqual(rows.map((r) => [r.page, r.status]), [[2, 'ok'], [6, 'ok'], [null, 'unknown'], [null, 'unknown']]);
}
{ // more sections than entries: the extra pages are simply not used
  assert.deepStrictEqual(PF.assignEntries(2, [2, 6, 9], new Set(), new Map()).map((r) => r.page), [2, 6]);
}
{ // a manual page choice changes only its own entry: the others keep their pages
  const rows = PF.assignEntries(3, [3, 5, 8], new Set(), new Map([[1, 6]]));
  assert.deepStrictEqual(rows.map((r) => r.page), [3, 6, 8]);
  assert.deepStrictEqual(rows.map((r) => r.manual), [false, true, false]);
}
{ // a manual choice that collides with an automatic one is kept as typed and reported by duplicatePages
  const rows = PF.assignEntries(3, [3, 5, 8], new Set(), new Map([[0, 5]]));
  assert.deepStrictEqual(rows.map((r) => r.page), [5, 5, 8]);
  assert.deepStrictEqual(PF.duplicatePages(rows), [5]);
}
{ // a manual "not in this PDF" frees its slot, like a missing entry: later entries move up
  const rows = PF.assignEntries(3, [3, 5, 8], new Set(), new Map([[1, null]]));
  assert.deepStrictEqual(rows.map((r) => [r.page, r.status]), [[3, 'ok'], [null, 'missing'], [5, 'ok']]);
  assert.strictEqual(rows[1].manual, true);
}
{ // a manual page for an entry that has no section left is still honoured
  const rows = PF.assignEntries(3, [3], new Set(), new Map([[2, 9]]));
  assert.deepStrictEqual(rows.map((r) => [r.page, r.status]), [[3, 'ok'], [null, 'unknown'], [9, 'ok']]);
}
assert.deepStrictEqual(PF.duplicatePages([{ page: 5 }, { page: 5 }, { page: null }, { page: 8 }, { page: 8 }, { page: 8 }]), [5, 8]);
assert.deepStrictEqual(PF.duplicatePages([{ page: 1 }, { page: null }]), []);
assert.deepStrictEqual(PF.assignEntries(0, [3], new Set(), new Map()), []);
assert.deepStrictEqual(PF.assignEntries(2, [], new Set(), new Map()).map((r) => r.status), ['unknown', 'unknown']);

// --- formatResult ---
{
  const labels = PF.makeLabels(4, 2);
  const rows = [{ index: 0, page: 3, status: 'ok' }, { index: 1, page: 5, status: 'ok' }, { index: 2, page: null, status: 'missing' }, { index: 3, page: null, status: 'unknown' }];
  const text = PF.formatResult(rows, labels, { mode: 'add', extra: 2 });
  assert.strictEqual(text, ['Experiment 1 – page 5', 'Experiment 2 – page 7', 'Assignment 1 – not in this PDF', 'Assignment 2 – page not found', '', 'Page numbers include 2 extra pages in front of this PDF.'].join('\n'));
  assert.strictEqual(PF.formatResult(rows.slice(0, 1), labels, { mode: 'as-is', extra: 0 }), 'Experiment 1 – page 3\n\nPage numbers are the PDF page numbers.');
  assert.strictEqual(PF.formatResult([], [], { mode: 'as-is', extra: 0 }), 'No sections found.');
}

console.log('page-finder: all assertions passed');
