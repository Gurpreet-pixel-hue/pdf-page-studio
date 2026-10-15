// Section detector in a real browser: strip geometry, scoring mechanics with the shipped model, progress, cancel, bad files.
async function pdfWithPages(count, draw) {
  const doc = await PDFLib.PDFDocument.create();
  for (let i = 0; i < count; i++) {
    const page = doc.addPage([595, 842]);
    if (draw) draw(page, i);
  }
  return new File([await doc.save()], 'journal.pdf', { type: 'application/pdf' });
}

async function scenario() {
  // 1. The strip is the top 3%..20% of the page, 900 px wide.
  const marked = await pdfWithPages(1, (page) => page.drawRectangle({ x: 100, y: 842 * (1 - 0.09), width: 300, height: 842 * 0.03, color: PDFLib.rgb(0, 0, 0) }));
  const pdf = await pdfjsLib.getDocument({ data: await marked.arrayBuffer() }).promise;
  const strip = await SectionDetect.renderStrip(await pdf.getPage(1));
  const expectedHeight = Math.round((900 / 595) * 842 * 0.17);
  check('strip is 900 px wide and 17% of the page tall', strip.width === 900 && Math.abs(strip.height - expectedHeight) <= 1, `${strip.width}x${strip.height}, expected height ${expectedHeight}`);
  const ctx = strip.getContext('2d');
  const red = (y) => ctx.getImageData(300, y, 1, 1).data[0];
  const unit = strip.height / 0.17;   // strip pixels per page-height unit
  check('ink at 6%..9% of the page appears inside the strip', red(Math.round(unit * (0.075 - 0.03))) < 60, String(red(Math.round(unit * 0.045))));
  check('white above (4%) and below (12%) the ink', red(Math.round(unit * 0.01)) > 200 && red(Math.round(unit * 0.09)) > 200);
  pdf.destroy();

  // 2. Scoring with the shipped model: every page scored, thumbnails made, progress reported.
  const detector = SectionDetect.createSectionDetector();
  const journal = await pdfWithPages(6);
  const progress = [];
  const result = await detector.score(journal, { onProgress: (done, total) => progress.push([done, total]) });
  check('six pages scored', result.scores.length === 6 && result.pageCount === 6 && result.scores.every((s, i) => s.page === i + 1 && Number.isFinite(s.score)), JSON.stringify(result.scores.map((s) => +s.score.toFixed(2))));
  check('progress ends at 6 of 6', JSON.stringify(progress[progress.length - 1]) === '[6,6]' && progress.length === 6);
  check('a heading thumbnail per page', result.thumbs.length === 6 && result.thumbs.every((u) => /^blob:/.test(u)));
  const thumb = await loadImageFromUrl(result.thumbs[0]);
  check('thumbnail is 320 px wide', thumb.naturalWidth === 320, String(thumb.naturalWidth));
  check('blank pages are not flagged as headings', result.scores.every((s) => s.score <= PageFinder_cutoff()), JSON.stringify(result.scores.map((s) => +s.score.toFixed(2))));
  result.thumbs.forEach((u) => URL.revokeObjectURL(u));

  // 3. The model stays loaded: a second scan is quick.
  const t0 = performance.now();
  const second = await detector.score(await pdfWithPages(2));
  check('second scan reuses the loaded model (< 3 s)', performance.now() - t0 < 3000, Math.round(performance.now() - t0) + ' ms');
  second.thumbs.forEach((u) => URL.revokeObjectURL(u));

  // 4. Cancel mid-scan: rejects with AbortError and leaves nothing behind.
  const controller = new AbortController();
  let cancelled = null;
  try {
    await detector.score(await pdfWithPages(5), { signal: controller.signal, onProgress: (done) => { if (done === 2) controller.abort(); } });
  } catch (err) { cancelled = err; }
  check('cancelling rejects with AbortError', !!cancelled && cancelled.name === 'AbortError', cancelled && cancelled.message);

  // 5. Unreadable file: a plain-language error.
  let bad = null;
  try { await detector.score(new File([new Uint8Array([1, 2, 3, 4, 5])], 'x.pdf', { type: 'application/pdf' })); } catch (err) { bad = err; }
  check('an unreadable PDF gives a plain message', !!bad && /not a readable PDF/.test(bad.message), bad && bad.message);

  // 6. Model download failure is reported and can be retried.
  const broken = SectionDetect.createSectionDetector({ modelUrl: 'models/missing.ort' });
  let failed = null;
  try { await broken.score(await pdfWithPages(1)); } catch (err) { failed = err; }
  check('a missing model gives a download message', !!failed && /could not be downloaded/.test(failed.message), failed && failed.message);
  let again = null;
  try { await broken.score(await pdfWithPages(1)); } catch (err) { again = err; }
  check('a failed load is retried, not cached', !!again && /could not be downloaded/.test(again.message));
}

function PageFinder_cutoff() { return 1.5; }
