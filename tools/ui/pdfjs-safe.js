// Every PDF the app opens must use pdf.js with eval switched off (CVE-2024-4367: a crafted PDF can run script in pdf.js < 4.2.67
// when isEvalSupported is true). Spies on getDocument for the upload path and the page finder, then checks real PDFs still work.
async function scenario() {
  const calls = [];
  const realLib = window.pdfjsLib;
  // pdf.js exposes getDocument as a read-only property, so wrap the whole library object instead.
  window.pdfjsLib = new Proxy(realLib, { get(target, key) { if (key === 'getDocument') return (params) => { calls.push(params); return target.getDocument(params); }; return target[key]; } });

  const doc = await PDFLib.PDFDocument.create();
  doc.addPage([300, 400]); doc.addPage([300, 400]); doc.addPage([300, 400]);
  const file = new File([await doc.save()], 'three.pdf', { type: 'application/pdf' });

  await handleFiles([file]);
  check('uploading a PDF still adds its pages', state.pages.length === 3 && state.pages.every((p) => p.sourceType === 'pdf'), String(state.pages.length));
  check('the spy saw the upload path open the PDF', calls.length === 1, String(calls.length));
  check('the upload path opened the PDF with isEvalSupported: false', calls.length === 1 && calls[0].isEvalSupported === false, JSON.stringify(calls.map((c) => Object.keys(c).filter((k) => k !== 'data'))));

  const result = await SectionDetect.createSectionDetector().score(file);
  check('the page finder still scans a PDF', result.pageCount === 3 && result.scores.length === 3);
  check('the page finder opened the PDF with isEvalSupported: false', calls.length === 2 && calls[1].isEvalSupported === false);
  result.thumbs.forEach((u) => URL.revokeObjectURL(u));

  // A PDF with real text (an embedded font) must still render visibly with eval off.
  const textDoc = await PDFLib.PDFDocument.create();
  const font = await textDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
  textDoc.addPage([300, 200]).drawText('Experiment No. 1', { x: 20, y: 90, size: 28, font });
  state.pages = [];
  await handleFiles([new File([await textDoc.save()], 'text.pdf', { type: 'application/pdf' })]);
  const thumb = await loadImageFromUrl(state.pages[0].thumbnailDataUrl);
  const c = document.createElement('canvas'); c.width = thumb.naturalWidth; c.height = thumb.naturalHeight;
  c.getContext('2d').drawImage(thumb, 0, 0);
  const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let dark = 0; for (let i = 0; i < px.length; i += 4) if (px[i] < 100) dark++;
  check('a PDF with an embedded font still renders its text', dark > 200, dark + ' dark pixels');
  await handleFiles([file]);

  let exported = null; const realCreate = URL.createObjectURL;
  URL.createObjectURL = (b) => { if (b.type === 'application/pdf') exported = b; return realCreate.call(URL, b); };
  await exportMergedPdf({ fileName: 'x.pdf' }); await waitFor(() => exported, 30000);
  URL.createObjectURL = realCreate;
  check('merge and export still work', (await PDFLib.PDFDocument.load(await exported.arrayBuffer())).getPageCount() === 4, 'text page + three blank pages');
  window.pdfjsLib = realLib;
}
