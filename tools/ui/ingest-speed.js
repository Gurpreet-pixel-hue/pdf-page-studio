// Ingest stays light: thumbnails are blob URLs (not giant base64 strings), cards use a small thumbnail,
// files go through a bounded pool without losing their order, and removed pages free their memory.
const longEdge = async (url) => { const img = await loadImageFromUrl(url); return Math.max(img.naturalWidth, img.naturalHeight); };
const dead = async (url) => { try { await fetch(url); return false; } catch (e) { return true; } };
const paint = (color) => (ctx, w, h) => { ctx.fillStyle = color; ctx.fillRect(0, 0, w, h); };

async function scenario() {
  // 1. Thumbnails are blob URLs; the grid shows a small one, previews and the editor keep the big one.
  await handleFiles([await makeImageFile(4000, 3000, paint('#468'), 'big.jpg')]);
  const big = state.pages[0];
  check('working copy is a blob URL, not base64', /^blob:/.test(big.thumbnailDataUrl), big.thumbnailDataUrl.slice(0, 30));
  check('card thumbnail is a separate blob URL', /^blob:/.test(big.cardThumbUrl) && big.cardThumbUrl !== big.thumbnailDataUrl, String(big.cardThumbUrl).slice(0, 30));
  const wEdge = await longEdge(big.thumbnailDataUrl);
  const cEdge = await longEdge(big.cardThumbUrl);
  check('working copy keeps the 2000 px detail', wEdge === 2000, String(wEdge));
  check('card thumbnail is small (<= 520 px)', cEdge <= 520 && cEdge >= 400, String(cEdge));
  setViewMode('pages');
  check('the grid card shows the small thumbnail', document.querySelector('#page-grid img.card-thumbnail').getAttribute('src') === big.cardThumbUrl);
  document.querySelector('#page-grid .card-thumbnail-viewport').click();
  await sleep(200);
  check('the lightbox shows the full working copy', document.getElementById('lightbox-image').getAttribute('src') === big.thumbnailDataUrl || document.querySelector('.lightbox-image, #lightbox-image') !== null && document.querySelector('#lightbox-image').src === big.thumbnailDataUrl);
  const closeBtn = document.getElementById('lightbox-close-btn'); if (closeBtn) closeBtn.click();
  await sleep(100);

  // 2. A small image does not get a second copy.
  await handleFiles([await makeImageFile(300, 200, paint('#c63'), 'tiny.jpg')]);
  const tiny = state.pages[1];
  check('small image reuses one URL for card and working copy', tiny.cardThumbUrl === tiny.thumbnailDataUrl);

  // 3. PDF pages use blob URLs too.
  const pdf = await PDFLib.PDFDocument.create(); pdf.addPage([300, 400]); pdf.addPage([300, 400]);
  await handleFiles([new File([await pdf.save()], 'doc.pdf', { type: 'application/pdf' })]);
  check('PDF page thumbnails are blob URLs', state.pages.slice(2).every((p) => /^blob:/.test(p.thumbnailDataUrl)), state.pages[2].thumbnailDataUrl.slice(0, 30));
  check('PDF pages still render in the grid', [...document.querySelectorAll('#page-grid img.card-thumbnail')].slice(2).every((i) => i.getAttribute('src').startsWith('blob:')));

  // 4. Two files at a time, order preserved even when an early file is the slowest.
  state.pages = []; state.fileCounter = 0; renderPageGrid();
  const realParse = parseImageFile;
  let active = 0, peak = 0;
  parseImageFile = async (file) => { active++; peak = Math.max(peak, active); try { if (file.name === 'first-big.jpg') await sleep(500); return await realParse(file); } finally { active--; } };
  const files = [await makeImageFile(3000, 2000, paint('#111'), 'first-big.jpg')];
  for (let i = 2; i <= 6; i++) files.push(await makeImageFile(200, 300, paint('#' + i + i + i), `f${i}.jpg`));
  await handleFiles(files);
  parseImageFile = realParse;
  check('all six photos added', state.pages.length === 6, String(state.pages.length));
  check('upload order is kept', state.pages.map((p) => p.fileName).join() === files.map((f) => f.name).join(), state.pages.map((p) => p.fileName).join());
  check('original order numbers follow the upload order', state.pages.every((p, i) => p.originalIndex === i), state.pages.map((p) => p.originalIndex).join());
  check('files are processed INGEST_CONCURRENCY at a time, never more', peak === Math.min(INGEST_CONCURRENCY, files.length), 'peak ' + peak + ' of ' + INGEST_CONCURRENCY);

  // 5. One bad file does not stop the rest, and the others keep their order.
  state.pages = []; state.fileCounter = 0; renderPageGrid();
  const bad = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], 'broken.jpg', { type: 'image/jpeg' });
  const good = [await makeImageFile(200, 300, paint('#369'), 'g1.jpg'), await makeImageFile(200, 300, paint('#963'), 'g2.jpg')];
  await handleFiles([good[0], bad, good[1]]);
  check('a broken file is skipped, the others stay in order', state.pages.map((p) => p.fileName).join() === 'g1.jpg,g2.jpg', state.pages.map((p) => p.fileName).join());
  check('processing overlay is closed afterwards', !document.getElementById('processing-modal').classList.contains('active'));

  // 6. Removing pages frees their blobs.
  const doomed = state.pages[0];
  const urls = [doomed.thumbnailDataUrl, doomed.cardThumbUrl];
  removePage(0);
  await sleep(50);
  check('removing a page revokes its blob URLs', (await Promise.all(urls.map(dead))).every(Boolean));
  const keep = state.pages[0];
  check('other pages keep working', !(await dead(keep.thumbnailDataUrl)));
  const rest = state.pages.map((p) => p.thumbnailDataUrl);
  window.confirm = () => true;
  clearAll();
  await sleep(50);
  check('Clear all revokes everything', (await Promise.all(rest.map(dead))).every(Boolean));

  // 7. A new crop preview is a blob URL and replaces (revokes) the old one.
  await handleFiles([await makeImageFile(800, 600, paint('#468'), 'crop.jpg')]);
  const item = state.pages[0];
  CropState.applyManualCrop(item, [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]);
  await refreshCropPreview(item);
  const first = item.previewUrl;
  check('crop preview is a blob URL', /^blob:/.test(first), String(first).slice(0, 30));
  CropState.applyManualCrop(item, [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]]);
  await refreshCropPreview(item);
  check('re-cropping revokes the old preview', item.previewUrl !== first && await dead(first));
}
