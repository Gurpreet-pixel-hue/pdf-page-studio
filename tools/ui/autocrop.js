// Auto Crop checks: visibility rules, clean sheet, no-page photo, manual untouched, idempotence, detector failure.
const btn = () => document.getElementById('auto-crop-btn');
const visible = () => getComputedStyle(btn()).display !== 'none';
const idle = () => !document.getElementById('processing-modal').classList.contains('active');

async function runAndWait() {
  btn().click();
  await sleep(300);
  return waitFor(idle, 120000);
}

async function scenario() {
  const pdfDoc = await PDFLib.PDFDocument.create();
  pdfDoc.addPage([300, 400]);
  const pdfFile = new File([await pdfDoc.save()], 'doc.pdf', { type: 'application/pdf' });

  // PDF-only upload: Auto Crop is not shown.
  await handleFiles([pdfFile]);
  check('PDF-only upload hides Auto Crop', !visible());

  // Mixed upload: shown, and counting image pages only.
  const sheetTruth = [[0.2, 0.15], [0.8, 0.15], [0.8, 0.85], [0.2, 0.85]];
  const cleanSheet = await makeImageFile(600, 800, (ctx, w, h) => {
    ctx.fillStyle = '#231e28'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ebebe6'; ctx.fillRect(120, 120, 360, 560);
    ctx.strokeStyle = '#9db0d6'; ctx.lineWidth = 2;
    for (let y = 170; y < 680; y += 34) { ctx.beginPath(); ctx.moveTo(120, y); ctx.lineTo(480, y); ctx.stroke(); }
  }, 'sheet.jpg');
  const noPage = await makeImageFile(600, 800, (ctx, w, h) => { ctx.fillStyle = '#231e28'; ctx.fillRect(0, 0, w, h); }, 'empty-desk.jpg');
  await handleFiles([cleanSheet, noPage]);
  check('mixed upload shows Auto Crop', visible());
  check('button counts image pages only', /\(2\)/.test(document.getElementById('auto-crop-label').textContent), document.getElementById('auto-crop-label').textContent);

  // Run it.
  check('first run finished', await runAndWait());
  const sheet = state.pages[1];
  const empty = state.pages[2];
  check('clean sheet is auto-cropped', sheet.cropState === 'auto' && CropGeometry.isValidQuad(sheet.cropQuad), `${sheet.cropState} conf=${sheet.cropConfidence.toFixed(2)}`);
  const iou = sheet.cropQuad ? CropGeometry.quadIoU(sheet.cropQuad, sheetTruth) : 0;
  check('clean sheet quad matches the drawn sheet (IoU >= 0.9)', iou >= 0.9, 'IoU ' + iou.toFixed(3));
  check('clean sheet has a cropped preview', typeof sheet.previewUrl === 'string');
  check('photo with no page is flagged for review and left uncropped', empty.cropState === 'needs-review' && empty.cropQuad === null, empty.cropState + ' conf=' + empty.cropConfidence);
  check('PDF page is untouched', state.pages[0].cropQuad === undefined && state.pages[0].cropState === undefined);

  // Badges on the cards.
  setViewMode('pages');
  check('auto badge renders', !!document.querySelector('#page-grid .crop-badge.auto'));
  check('review badge renders', !!document.querySelector('#page-grid .crop-badge.review'));

  // A review page opens the editor on the plain 10% inset.
  openCropEditor(2);
  await waitFor(() => CropEditor.isOpen());
  const h0 = document.querySelector('#crop-stage .crop-handle');
  check('review page opens the editor on the 10% inset', Math.abs(parseFloat(h0.style.left) / 100 - 0.1) < 0.001);
  CropEditor.close();

  // Manual crops are never overwritten; running again is idempotent.
  CropState.applyManualCrop(sheet, [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]]);
  const manualQuad = JSON.stringify(sheet.cropQuad);
  check('second run finished', await runAndWait());
  check('manual crop is untouched', sheet.cropState === 'manual' && JSON.stringify(sheet.cropQuad) === manualQuad);
  check('re-running leaves the review page flagged and uncropped', empty.cropState === 'needs-review' && empty.cropQuad === null);

  // Detector failure is reported, not silently turned into "needs review".
  CropState.resetCrop(empty);
  pageDetector = PageDetect.createDetector({ modelUrl: 'models/missing.ort' });
  check('failure run finished', await runAndWait());
  pageDetector = null;
  const toasts = [...document.querySelectorAll('#toast-container .toast')].map((t) => t.textContent).join(' | ');
  check('failure shows an unavailable message', /unavailable/i.test(toasts), toasts);
  check('failed page is left unchanged', empty.cropState === 'none', empty.cropState);

  // The detector recovers once the model is reachable again.
  check('run after recovery finished', await runAndWait());
  check('empty desk is flagged again after recovery', empty.cropState === 'needs-review', empty.cropState);
}
