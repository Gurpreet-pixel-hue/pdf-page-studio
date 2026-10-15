/**
 * Verification for the Documents-view grouping helpers (doc-groups.js).
 * Run: node test_doc_groups.js
 */

const assert = require('assert');
const { groupPagesIntoDocuments, moveDocument, removeDocument } = require('./doc-groups.js');

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

console.log('doc-groups: all assertions passed');
