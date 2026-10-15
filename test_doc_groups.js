/**
 * Verification for the Documents-view grouping helpers (doc-groups.js).
 * Run: node test_doc_groups.js
 */

const assert = require('assert');
const { groupPagesIntoDocuments, moveDocument, removeDocument, splitDocument, splitDocumentInto, fixedSizes, parsePageRanges, joinDocuments, movePage, removePage } = require('./doc-groups.js');

const fileA = { name: 'A.pdf' };
const fileB = { name: 'B.pdf' };
const fileB2 = { name: 'B.pdf' }; // different upload, same display name
const img1 = { name: 'scan.png' };
const img2 = { name: 'scan.png' };

function pdfPage(file, pageIndex, total) {
  return { sourceType: 'pdf', sourceFile: file, fileName: file.name, sourcePageIndex: pageIndex, sourceTotalPages: total };
}
function imgPage(file) {
  return { sourceType: 'image', sourceFile: file, fileName: file.name, sourcePageIndex: 0, sourceTotalPages: 1 };
}
const labels = (pages) => pages.map(p => `${p.fileName}:${p.sourcePageIndex}`);

// --- groupPagesIntoDocuments ---
{
  assert.deepStrictEqual(groupPagesIntoDocuments([]), [], 'empty input gives no groups');
}
{
  const pages = [pdfPage(fileA, 0, 3), pdfPage(fileA, 1, 3), pdfPage(fileA, 2, 3)];
  const g = groupPagesIntoDocuments(pages);
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].start, 0);
  assert.strictEqual(g[0].end, 3);
  assert.strictEqual(g[0].count, 3);
  assert.strictEqual(g[0].partial, false);
  assert.strictEqual(g[0].rangeLabel, '3 pages');
  assert.strictEqual(g[0].firstPage, pages[0]);
}
{
  const pages = [pdfPage(fileA, 0, 1)];
  assert.strictEqual(groupPagesIntoDocuments(pages)[0].rangeLabel, '1 page');
}
{
  const pages = [pdfPage(fileA, 0, 2), pdfPage(fileA, 1, 2), pdfPage(fileB, 0, 3), pdfPage(fileB, 1, 3), pdfPage(fileB, 2, 3)];
  const g = groupPagesIntoDocuments(pages);
  assert.deepStrictEqual(g.map(d => [d.fileName, d.start, d.end]), [['A.pdf', 0, 2], ['B.pdf', 2, 5]]);
}
{
  // Same display name but distinct uploads stay separate documents
  const pages = [pdfPage(fileB, 0, 1), pdfPage(fileB2, 0, 1)];
  assert.strictEqual(groupPagesIntoDocuments(pages).length, 2);
}
{
  // A page of A pulled into the middle of B splits both around it
  const pages = [pdfPage(fileA, 0, 3), pdfPage(fileB, 0, 2), pdfPage(fileA, 1, 3), pdfPage(fileB, 1, 2), pdfPage(fileA, 2, 3)];
  const g = groupPagesIntoDocuments(pages);
  assert.strictEqual(g.length, 5);
  assert.strictEqual(g[0].partial, true);
  assert.strictEqual(g[0].rangeLabel, 'p. 1 of 3');
}
{
  // Partial contiguous run reports a page range
  const pages = [pdfPage(fileA, 0, 5), pdfPage(fileA, 1, 5), pdfPage(fileB, 0, 1), pdfPage(fileA, 2, 5), pdfPage(fileA, 3, 5), pdfPage(fileA, 4, 5)];
  const g = groupPagesIntoDocuments(pages);
  assert.strictEqual(g[0].rangeLabel, 'pp. 1–2 of 5');
  assert.strictEqual(g[2].rangeLabel, 'pp. 3–5 of 5');
  assert.strictEqual(g[2].partial, true);
}
{
  // Non-contiguous / reordered pages inside one run
  const pages = [pdfPage(fileA, 2, 5), pdfPage(fileA, 0, 5)];
  assert.strictEqual(groupPagesIntoDocuments(pages)[0].rangeLabel, '2 of 5 pages');
}
{
  // Each image upload is its own one-page document, even back to back
  const pages = [imgPage(img1), imgPage(img2)];
  const g = groupPagesIntoDocuments(pages);
  assert.strictEqual(g.length, 2);
  assert.strictEqual(g[0].rangeLabel, '1 page');
  assert.strictEqual(g[0].partial, false);
}

// --- moveDocument ---
function threeDocs() {
  return [pdfPage(fileA, 0, 2), pdfPage(fileA, 1, 2), pdfPage(fileB, 0, 1), imgPage(img1)];
}
{
  const pages = threeDocs();
  const out = moveDocument(pages, 0, 2); // A to the end
  assert.deepStrictEqual(labels(out), ['B.pdf:0', 'scan.png:0', 'A.pdf:0', 'A.pdf:1']);
  assert.strictEqual(pages.length, 4);
  assert.deepStrictEqual(labels(pages), ['A.pdf:0', 'A.pdf:1', 'B.pdf:0', 'scan.png:0'], 'input is not mutated');
}
{
  const out = moveDocument(threeDocs(), 2, 0); // image to the front
  assert.deepStrictEqual(labels(out), ['scan.png:0', 'A.pdf:0', 'A.pdf:1', 'B.pdf:0']);
}
{
  const pages = threeDocs();
  assert.deepStrictEqual(labels(moveDocument(pages, 1, 1)), labels(pages), 'same index is a no-op');
  assert.deepStrictEqual(labels(moveDocument(pages, -1, 1)), labels(pages), 'out-of-range is a no-op');
  assert.deepStrictEqual(labels(moveDocument(pages, 0, 9)), labels(pages), 'out-of-range is a no-op');
}

// --- removeDocument ---
{
  const pages = threeDocs();
  const out = removeDocument(pages, 0);
  assert.deepStrictEqual(labels(out), ['B.pdf:0', 'scan.png:0']);
  assert.strictEqual(pages.length, 4, 'input is not mutated');
  assert.deepStrictEqual(labels(removeDocument(pages, 7)), labels(pages), 'out-of-range is a no-op');
}

// --- splitDocument / joinDocuments: a PDF can be cut into parts that move independently ---
const fiveA = () => [0, 1, 2, 3, 4].map(i => pdfPage(fileA, i, 5));
{
  const pages = fiveA();
  const out = splitDocument(pages, 0, 2);
  const g = groupPagesIntoDocuments(out);
  assert.deepStrictEqual(g.map(d => [d.start, d.end, d.rangeLabel]), [[0, 2, 'pp. 1–2 of 5'], [2, 5, 'pp. 3–5 of 5']]);
  assert.ok(g.every(d => d.partial), 'both parts are partial documents');
  assert.strictEqual(pages.some(p => p.splitBefore), false, 'input pages are not mutated');
  assert.strictEqual(out[1], pages[1], 'pages other than the two part starts keep their identity');
  assert.ok(out[0].splitBefore && out[2].splitBefore, 'both parts are marked as starting a document');
  assert.deepStrictEqual(labels(out), labels(pages), 'a split does not reorder anything');
}
{
  // parts move independently: part B to the front
  const parts = splitDocument(fiveA(), 0, 2);
  const moved = moveDocument(parts, 1, 0);
  assert.deepStrictEqual(labels(moved), ['A.pdf:2', 'A.pdf:3', 'A.pdf:4', 'A.pdf:0', 'A.pdf:1']);
  assert.deepStrictEqual(groupPagesIntoDocuments(moved).map(d => d.rangeLabel), ['pp. 3–5 of 5', 'pp. 1–2 of 5']);
}
{
  // a part can be split again, giving three parts
  const twice = splitDocument(splitDocument(fiveA(), 0, 2), 1, 1);
  assert.deepStrictEqual(groupPagesIntoDocuments(twice).map(d => d.rangeLabel), ['pp. 1–2 of 5', 'p. 3 of 5', 'pp. 4–5 of 5']);
}
{
  // other documents around the split are left alone
  const pages = [pdfPage(fileB, 0, 1), ...fiveA(), imgPage(img1)];
  const out = splitDocument(pages, 1, 3);
  assert.deepStrictEqual(groupPagesIntoDocuments(out).map(d => [d.fileName, d.count]), [['B.pdf', 1], ['A.pdf', 3], ['A.pdf', 2], ['scan.png', 1]]);
}
{
  const pages = fiveA();
  for (const [g, n] of [[0, 0], [0, 5], [0, 6], [0, -1], [0, 1.5], [1, 2], [-1, 2], [0, NaN]]) {
    const out = splitDocument(pages, g, n);
    assert.deepStrictEqual(groupPagesIntoDocuments(out).length, 1, `split (${g}, ${n}) is a no-op`);
  }
  assert.strictEqual(groupPagesIntoDocuments(splitDocument([imgPage(img1)], 0, 1)).length, 1, 'a single page cannot be split');
}
{
  const parts = splitDocument(fiveA(), 0, 2);
  const g = groupPagesIntoDocuments(parts);
  assert.deepStrictEqual(g.map(d => d.canJoinNext), [true, false], 'a part can rejoin the part that continues it');
  const joined = joinDocuments(parts, 0);
  const jg = groupPagesIntoDocuments(joined);
  assert.strictEqual(jg.length, 1);
  assert.strictEqual(jg[0].rangeLabel, '5 pages');
  assert.strictEqual(parts[2].splitBefore, true, 'input is not mutated');
  assert.strictEqual(joined[2].splitBefore, undefined, 'joining clears the cut');
}
{
  // not joinable when the neighbour is not the direct continuation
  const parts = splitDocument(fiveA(), 0, 2);
  const swapped = moveDocument(parts, 1, 0); // B then A
  assert.deepStrictEqual(groupPagesIntoDocuments(swapped).map(d => d.canJoinNext), [false, false]);
  assert.strictEqual(groupPagesIntoDocuments(joinDocuments(swapped, 0)).length, 2, 'join is a no-op when not a continuation');
  const three = splitDocument(splitDocument(fiveA(), 0, 2), 1, 1);
  const gaps = moveDocument(three, 1, 2); // A1-2, A4-5, A3
  assert.deepStrictEqual(groupPagesIntoDocuments(gaps).map(d => d.canJoinNext), [false, false, false]);
  const other = [...splitDocument(fiveA(), 0, 2).slice(0, 2), pdfPage(fileB, 0, 1), ...splitDocument(fiveA(), 0, 2).slice(2)];
  assert.deepStrictEqual(groupPagesIntoDocuments(other).map(d => d.canJoinNext), [false, false, false], 'a different file in between blocks joining');
  assert.strictEqual(groupPagesIntoDocuments(joinDocuments(fiveA(), 0)).length, 1, 'joining an unsplit document is a no-op');
  assert.strictEqual(groupPagesIntoDocuments(joinDocuments(parts, 5)).length, 2, 'out-of-range join is a no-op');
}

// --- movePage / removePage keep a cut where the part really begins ---
{
  const parts = splitDocument(fiveA(), 0, 2); // a0 a1 | a2* a3 a4
  const out = movePage(parts, 2, 4); // the first page of part B moves to the end
  assert.deepStrictEqual(labels(out), ['A.pdf:0', 'A.pdf:1', 'A.pdf:3', 'A.pdf:4', 'A.pdf:2']);
  assert.deepStrictEqual(groupPagesIntoDocuments(out).map(d => d.count), [2, 3], 'the cut moves to the next page, parts stay separate');
  assert.strictEqual(out[4].splitBefore, undefined, 'the moved page does not carry the cut');
  assert.strictEqual(parts[2].splitBefore, true, 'input is not mutated');
}
{
  const parts = splitDocument(fiveA(), 0, 2);
  const out = removePage(parts, 2);
  assert.deepStrictEqual(labels(out), ['A.pdf:0', 'A.pdf:1', 'A.pdf:3', 'A.pdf:4']);
  assert.deepStrictEqual(groupPagesIntoDocuments(out).map(d => d.count), [2, 2], 'removing the first page of a part keeps the parts separate');
  const lastFlagged = [pdfPage(fileA, 0, 2), { ...pdfPage(fileA, 1, 2), splitBefore: true }, pdfPage(fileB, 0, 1)];
  assert.deepStrictEqual(groupPagesIntoDocuments(removePage(lastFlagged, 1)).map(d => d.fileName), ['A.pdf', 'B.pdf']);
}
{
  const pages = fiveA();
  const out = movePage(pages, 0, 3);
  assert.deepStrictEqual(labels(out), ['A.pdf:1', 'A.pdf:2', 'A.pdf:3', 'A.pdf:0', 'A.pdf:4']);
  assert.strictEqual(out[3], pages[0], 'pages without a cut are not copied');
  assert.deepStrictEqual(labels(movePage(pages, 2, 2)), labels(pages), 'same index is a no-op');
  assert.deepStrictEqual(labels(movePage(pages, -1, 2)), labels(pages), 'out-of-range is a no-op');
  assert.deepStrictEqual(labels(removePage(pages, 9)), labels(pages), 'out-of-range remove is a no-op');
  assert.strictEqual(pages.length, 5, 'input is not mutated');
}

// --- fixedSizes: every n pages, the last part takes what is left ---
{
  assert.deepStrictEqual(fixedSizes(10, 2), [2, 2, 2, 2, 2]);
  assert.deepStrictEqual(fixedSizes(10, 3), [3, 3, 3, 1]);
  assert.deepStrictEqual(fixedSizes(10, 1), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.deepStrictEqual(fixedSizes(10, 9), [9, 1]);
  for (const bad of [0, -2, 10, 11, 2.5, NaN, '2']) assert.strictEqual(fixedSizes(10, bad), null, `n=${bad} is not a split`);
  assert.strictEqual(fixedSizes(1, 1), null, 'a single page cannot be split');
}

// --- parsePageRanges: "1-8, 9-10, 11-13" ---
{
  const ok = parsePageRanges('1-8,9-10,11-13', 13);
  assert.strictEqual(ok.error, null);
  assert.deepStrictEqual(ok.parts.map(p => [p.from, p.to, !!p.implicit]), [[1, 8, false], [9, 10, false], [11, 13, false]]);
  assert.deepStrictEqual(ok.sizes, [8, 2, 3]);
  assert.deepStrictEqual(parsePageRanges(' 1 - 8 ;  9–10  11-13 ', 13).sizes, [8, 2, 3], 'spaces, semicolons, en dashes are fine');
  assert.deepStrictEqual(parsePageRanges('1-3,4,5-6', 6).sizes, [3, 1, 2], 'a single page is a range of one');
  // pages not listed are kept, never dropped: they become their own parts
  const gaps = parsePageRanges('3-5', 8);
  assert.deepStrictEqual(gaps.parts.map(p => [p.from, p.to, !!p.implicit]), [[1, 2, true], [3, 5, false], [6, 8, true]]);
  assert.deepStrictEqual(parsePageRanges('1-8', 10).sizes, [8, 2], 'an unlisted tail becomes a part');
  assert.deepStrictEqual(parsePageRanges('9-10,1-8', 10).sizes, [8, 2], 'ranges are taken in page order');
  const errors = [
    ['', 13, /enter/i],
    ['abc', 13, /abc/],
    ['1-', 13, /1-/],
    ['5-3', 13, /backwards/i],
    ['0-3', 13, /page 0|0/],
    ['1-20', 13, /20.*13|13/],
    ['1-5,5-8', 13, /more than one/i],
    ['1-5,3-8', 13, /more than one/i],
    ['1-13', 13, /whole document/i],
    ['1.5-3', 13, /1\.5/]
  ];
  for (const [text, count, pattern] of errors) {
    const r = parsePageRanges(text, count);
    assert.ok(r.error && pattern.test(r.error), `"${text}" gives a helpful error, got: ${r.error}`);
    assert.strictEqual(r.sizes, null);
  }
}

// --- splitDocumentInto: any number of parts at once ---
{
  const ten = () => Array.from({ length: 10 }, (_, i) => pdfPage(fileA, i, 10));
  const pages = ten();
  const out = splitDocumentInto(pages, 0, [2, 2, 2, 2, 2]);
  assert.deepStrictEqual(groupPagesIntoDocuments(out).map(d => d.rangeLabel), ['pp. 1–2 of 10', 'pp. 3–4 of 10', 'pp. 5–6 of 10', 'pp. 7–8 of 10', 'pp. 9–10 of 10']);
  assert.deepStrictEqual(labels(out), labels(pages), 'order is unchanged');
  assert.strictEqual(pages.some(p => p.splitBefore), false, 'input is not mutated');
  assert.strictEqual(out[1], pages[1], 'pages that do not start a part keep their identity');
  assert.deepStrictEqual(groupPagesIntoDocuments(out).map(d => d.canJoinNext), [true, true, true, true, false]);
  // other documents are untouched and group indexes refer to documents
  const mixed = [pdfPage(fileB, 0, 1), ...ten(), imgPage(img1)];
  const m = splitDocumentInto(mixed, 1, [8, 2]);
  assert.deepStrictEqual(groupPagesIntoDocuments(m).map(d => [d.fileName, d.count]), [['B.pdf', 1], ['A.pdf', 8], ['A.pdf', 2], ['scan.png', 1]]);
  // invalid size lists are no-ops
  for (const sizes of [null, [], [10], [5, 4], [5, 6], [0, 10], [5, 5, 0], [2.5, 7.5], [-1, 11], 'x']) {
    assert.strictEqual(groupPagesIntoDocuments(splitDocumentInto(ten(), 0, sizes)).length, 1, `sizes ${JSON.stringify(sizes)} are a no-op`);
  }
  assert.strictEqual(groupPagesIntoDocuments(splitDocumentInto(ten(), 3, [5, 5])).length, 1, 'bad document index is a no-op');
  // splitting an already split part again works, and the pieces export in order
  const twice = splitDocumentInto(splitDocumentInto(ten(), 0, [4, 6]), 1, [3, 3]);
  assert.deepStrictEqual(groupPagesIntoDocuments(twice).map(d => d.rangeLabel), ['pp. 1–4 of 10', 'pp. 5–7 of 10', 'pp. 8–10 of 10']);
  // the two-part helper is the same thing
  assert.deepStrictEqual(labels(splitDocument(ten(), 0, 3)), labels(splitDocumentInto(ten(), 0, [3, 7])));
  assert.deepStrictEqual(groupPagesIntoDocuments(splitDocument(ten(), 0, 3)).map(d => d.count), [3, 7]);
}

console.log('doc-groups: all assertions passed');
