// Crop editor checks: open, drag, clamp, validate, apply, remove, keyboard, Escape, PDF has no button.
const modalEl = () => document.getElementById('crop-modal');
const handleEls = () => [...document.querySelectorAll('#crop-stage .crop-handle')];
const near = (a, b, tol) => Math.abs(a - b) <= tol;

function pointer(el, type, x, y) {
  el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true, cancelable: true }));
}
function stagePoint(fx, fy) {
  const r = document.getElementById('crop-stage').getBoundingClientRect();
  return [r.left + fx * r.width, r.top + fy * r.height];
}
function dragHandle(index, fx, fy) {
  const h = handleEls()[index];
  const [sx, sy] = [h.getBoundingClientRect().left + 14, h.getBoundingClientRect().top + 14];
  const [x, y] = stagePoint(fx, fy);
  pointer(h, 'pointerdown', sx, sy);
  pointer(h, 'pointermove', x, y);
  pointer(h, 'pointerup', x, y);
}
function handleFraction(index) {
  const h = handleEls()[index];
  return [parseFloat(h.style.left) / 100, parseFloat(h.style.top) / 100];
}

async function scenario() {
  const photo = await makeImageFile(800, 600, (ctx, w, h) => { ctx.fillStyle = '#222'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.fillRect(200, 150, 400, 300); }, 'sheet.jpg');
  const pdfDoc = await PDFLib.PDFDocument.create();
  pdfDoc.addPage([300, 400]);
  const pdfFile = new File([await pdfDoc.save()], 'doc.pdf', { type: 'application/pdf' });
  await handleFiles([photo, pdfFile]);
  setViewMode('pages');

  // PDF pages never get a Crop button; image pages do.
  const cards = [...document.querySelectorAll('#page-grid .page-card')];
  check('image page card has a Crop button', !!cards[0].querySelector('.crop-btn'));
  check('PDF page card has no Crop button', !cards[1].querySelector('.crop-btn'));

  // Open from the card button.
  cards[0].querySelector('.crop-btn').click();
  await waitFor(() => modalEl().classList.contains('active'));
  check('editor opens', modalEl().classList.contains('active'));
  check('four corner handles', handleEls().length === 4);
  await waitFor(() => document.getElementById('crop-image').naturalWidth > 0);
  const startTL = handleFraction(0);
  check('starts from the 10% inset', near(startTL[0], 0.1, 0.001) && near(startTL[1], 0.1, 0.001), startTL.join(','));
  check('Remove crop is hidden when there is no crop', document.getElementById('crop-remove-btn').style.display === 'none');

  // Drag a corner.
  dragHandle(0, 0.25, 0.25);
  const moved = handleFraction(0);
  check('dragging moves the corner', near(moved[0], 0.25, 0.01) && near(moved[1], 0.25, 0.01), moved.join(','));

  // Clamp outside the image.
  dragHandle(0, -0.4, -0.4);
  const clamped = handleFraction(0);
  check('corner is clamped to the image', clamped[0] === 0 && clamped[1] === 0, clamped.join(','));

  // Crossing corners disables Apply and explains why (Review Focus 4).
  dragHandle(0, 0.95, 0.95);
  check('crossed corners disable Apply', document.getElementById('crop-apply-btn').disabled === true);
  check('hint explains the problem', /cross|close together/i.test(document.getElementById('crop-hint').textContent));

  // Reset corners restores the starting quad.
  document.getElementById('crop-reset-btn').click();
  const reset = handleFraction(0);
  check('Reset corners restores the start', near(reset[0], 0.1, 0.001) && !document.getElementById('crop-apply-btn').disabled);

  // Keyboard nudge.
  const h1 = handleEls()[1];
  h1.focus();
  const before = handleFraction(1)[0];
  h1.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
  check('arrow key nudges a focused corner', handleFraction(1)[0] < before);

  // Fit the corners to the white rectangle, then apply.
  dragHandle(0, 0.25, 0.25); dragHandle(1, 0.75, 0.25); dragHandle(2, 0.75, 0.75); dragHandle(3, 0.25, 0.75);
  document.getElementById('crop-apply-btn').click();
  await waitFor(() => state.pages[0].cropState === 'manual' && state.pages[0].previewUrl);
  const item = state.pages[0];
  check('apply stores a manual crop', item.cropState === 'manual' && CropGeometry.isValidQuad(item.cropQuad));
  check('apply builds a cropped preview', typeof item.previewUrl === 'string' && item.previewUrl.startsWith('data:image'));
  check('editor closed after apply', !modalEl().classList.contains('active'));
  const badge = document.querySelector('#page-grid .page-card .crop-badge');
  check('card shows a MANUAL badge', !!badge && /manual/i.test(badge.textContent));
  const preview = await loadImageFromUrl(item.previewUrl);
  check('preview is the cropped region (about 4:3)', near(preview.naturalWidth / preview.naturalHeight, 4 / 3, 0.1), `${preview.naturalWidth}x${preview.naturalHeight}`);

  // Re-open: starts from the stored crop and offers Remove.
  document.querySelector('#page-grid .page-card .crop-btn').click();
  await waitFor(() => modalEl().classList.contains('active'));
  const reopened = handleFraction(0);
  check('re-open starts from the stored crop', near(reopened[0], item.cropQuad[0][0], 0.01));
  check('Remove crop is offered', document.getElementById('crop-remove-btn').style.display !== 'none');

  // Escape cancels without changing anything.
  const quadBefore = JSON.stringify(item.cropQuad);
  modalEl().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  check('Escape closes the editor', !modalEl().classList.contains('active'));
  check('Escape leaves the crop unchanged', JSON.stringify(item.cropQuad) === quadBefore);

  // Remove crop.
  document.querySelector('#page-grid .page-card .crop-btn').click();
  await waitFor(() => modalEl().classList.contains('active'));
  document.getElementById('crop-remove-btn').click();
  check('Remove crop clears the crop', item.cropState === 'none' && item.cropQuad === null && item.previewUrl === null);

  // A page that needs review starts from the plain inset, not from a guess.
  item.cropState = 'needs-review';
  document.querySelector('#page-grid .page-card .crop-btn').click();
  await waitFor(() => modalEl().classList.contains('active'));
  const review = handleFraction(0);
  check('a review page starts from the 10% inset', near(review[0], 0.1, 0.001) && near(review[1], 0.1, 0.001), review.join(','));
  CropEditor.close();

  // Documents view: a single-image document also offers Crop.
  setViewMode('documents');
  const docCards = [...document.querySelectorAll('#page-grid .doc-card')];
  check('single-image document card has a Crop button', !!docCards[0].querySelector('.crop-btn'));
  check('PDF document card has no Crop button', !docCards[1].querySelector('.crop-btn'));
}
