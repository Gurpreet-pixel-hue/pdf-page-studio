// Multi-gap visual split, direct individual PDF card download, and move by typed position (Documents + Pages views).
const docCards = () => [...document.querySelectorAll('#page-grid .doc-card')];
const pageCards = () => [...document.querySelectorAll('#page-grid .page-card')];
const cardLabel = (c) => c.querySelector('.card-filename').textContent + ' | ' + c.querySelector('.card-dimensions').textContent;
const summary = () => document.getElementById('split-summary').textContent;

async function makePdf(name, pageCount) {
  const doc = await PDFLib.PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([300 + i * 10, 400]);
    page.drawText(`${name} p${i + 1}`, { x: 40, y: 200, size: 18 });
  }
  return new File([await doc.save()], name, { type: 'application/pdf' });
}

function typePositionAndEnter(card, pos) {
  const input = card.querySelector('.move-pos-input');
  input.focus();
  input.value = String(pos);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

async function scenario() {
  await handleFiles([await makePdf('Alpha.pdf', 6), await makePdf('Beta.pdf', 3), await makePdf('Gamma.pdf', 2)]);
  setViewMode('documents');
  check('three initial documents', docCards().length === 3, String(docCards().length));

  // 1. Multi-gap visual split: click multiple gaps in the visual strip to split at all selected intervals
  docCards()[0].querySelector('.split-btn').click();
  await waitFor(() => SplitDialog.isOpen());

  const gap2 = document.querySelector('#split-strip .split-gap[data-after="2"]');
  const gap4 = document.querySelector('#split-strip .split-gap[data-after="4"]');
  const gap5 = document.querySelector('#split-strip .split-gap[data-after="5"]');

  gap2.click();
  check('first gap click selects gap 2', gap2.getAttribute('aria-pressed') === 'true' && document.getElementById('split-input').value === '2');

  gap4.click();
  check('second gap click adds gap 4 alongside gap 2',
    gap2.getAttribute('aria-pressed') === 'true' &&
    gap4.getAttribute('aria-pressed') === 'true' &&
    document.getElementById('split-input').value === '2, 4',
    document.getElementById('split-input').value
  );

  gap5.click();
  check('third gap click adds gap 5 (three selected gaps)',
    document.querySelectorAll('#split-strip .split-gap.selected').length === 3 &&
    document.getElementById('split-input').value === '2, 4, 5',
    document.getElementById('split-input').value
  );

  gap5.click();
  check('clicking an already-selected gap deselects it',
    gap5.getAttribute('aria-pressed') === 'false' &&
    document.querySelectorAll('#split-strip .split-gap.selected').length === 2 &&
    document.getElementById('split-input').value === '2, 4',
    document.getElementById('split-input').value
  );
  check('summary previews all three parts',
    /Part A: pp\. 1–2 of 6/.test(summary()) &&
    /Part B: pp\. 3–4 of 6/.test(summary()) &&
    /Part C: pp\. 5–6 of 6/.test(summary()),
    summary()
  );

  document.getElementById('split-apply-btn').click();
  check('dialog closes and splits Alpha.pdf into 3 parts', !SplitDialog.isOpen() && docCards().length === 5, docCards().map(cardLabel).join(' ; '));
  check('three Alpha.pdf parts match the selected intervals',
    /pp\. 1–2 of 6/.test(cardLabel(docCards()[0])) &&
    /pp\. 3–4 of 6/.test(cardLabel(docCards()[1])) &&
    /pp\. 5–6 of 6/.test(cardLabel(docCards()[2])),
    docCards().slice(0, 3).map(cardLabel).join(' ; ')
  );

  // 2. Direct download of an individual PDF card when selecting it
  docCards()[1].querySelector('.card-meta').click();
  check('clicking a PDF card selects it (.is-selected)', docCards()[1].classList.contains('is-selected'));

  let downloadedBlob = null;
  let downloadedName = null;
  const realCreateObjectURL = URL.createObjectURL;
  const origClick = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = (blob) => {
    if (blob && blob.type === 'application/pdf') downloadedBlob = blob;
    return realCreateObjectURL.call(URL, blob);
  };
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) downloadedName = this.download;
    return origClick.apply(this, arguments);
  };

  docCards()[1].querySelector('.doc-download-pill').click();
  await waitFor(() => downloadedBlob !== null);

  const partPdf = await PDFLib.PDFDocument.load(await downloadedBlob.arrayBuffer());
  check('selected PDF part downloads directly with its 2 pages', partPdf.getPageCount() === 2, String(partPdf.getPageCount()));
  check('downloaded part has a clean part filename', /^Alpha.*3.*4\.pdf$/i.test(downloadedName), String(downloadedName));

  // Also test direct download via the card action bar button on Beta.pdf (3 pages)
  downloadedBlob = null;
  downloadedName = null;
  docCards()[3].querySelector('.download-doc-btn').click();
  await waitFor(() => downloadedBlob !== null);
  URL.createObjectURL = realCreateObjectURL;
  HTMLAnchorElement.prototype.click = origClick;

  const betaPdf = await PDFLib.PDFDocument.load(await downloadedBlob.arrayBuffer());
  check('Beta.pdf card downloads directly with its 3 pages', betaPdf.getPageCount() === 3 && downloadedName === 'Beta.pdf', `${downloadedName} (${betaPdf.getPageCount()})`);

  // 3. Move by typed position in Documents view
  // Current doc order: [0] Alpha 1-2, [1] Alpha 3-4, [2] Alpha 5-6, [3] Beta, [4] Gamma
  typePositionAndEnter(docCards()[4], 1); // Move Gamma (pos 5) -> pos 1
  check('typing position 1 moves Gamma.pdf to the front', docCards()[0].querySelector('.card-filename').textContent === 'Gamma.pdf', docCards().map(cardLabel).join(' ; '));

  typePositionAndEnter(docCards()[0], 99); // Out-of-range position
  check('out-of-range position resets input and keeps order',
    docCards()[0].querySelector('.card-filename').textContent === 'Gamma.pdf' &&
    docCards()[0].querySelector('.move-pos-input').value === '1'
  );

  // 4. Move by typed position in Pages view
  setViewMode('pages');
  const firstPageId = state.pages[0].id;
  typePositionAndEnter(pageCards()[0], 6); // Move Page 1 -> Page 6
  check('typing position 6 in Pages view moves Page 1 to position 6', state.pages[5].id === firstPageId, `moved to index ${state.pages.findIndex((p) => p.id === firstPageId)}`);
}
