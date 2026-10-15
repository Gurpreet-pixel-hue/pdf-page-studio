// Split a PDF into parts: visual and typed split points, independent moves, join, page-level edits, export.
const cards = () => [...document.querySelectorAll('#page-grid .doc-card')];
const cardTitle = (c) => c.querySelector('.card-filename').textContent + ' | ' + c.querySelector('.card-dimensions').textContent;
const order = () => state.pages.map((p) => p.fileName.replace(/\.\w+$/, '') + (p.sourcePageIndex + 1)).join(' ');
const summary = () => document.getElementById('split-summary').textContent;

async function makePdf(name, pageCount) {
  const doc = await PDFLib.PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([300, 400]);
  return new File([await doc.save()], name, { type: 'application/pdf' });
}

async function scenario() {
  await handleFiles([await makePdf('A.pdf', 6), await makePdf('B.pdf', 2), await makePdf('C.pdf', 1)]);
  await handleFiles([await makeImageFile(300, 200, (ctx, w, h) => { ctx.fillStyle = '#468'; ctx.fillRect(0, 0, w, h); }, 'photo.jpg')]);
  setViewMode('documents');
  check('four documents', cards().length === 4, String(cards().length));
  const hasSplit = cards().map((c) => !!c.querySelector('.split-btn'));
  check('Split shows only on multi-page documents', JSON.stringify(hasSplit) === '[true,true,false,false]', JSON.stringify(hasSplit));

  // 1. Visual: the dialog opens with a sensible default and shows both parts.
  cards()[0].querySelector('.split-btn').click();
  await waitFor(() => SplitDialog.isOpen());
  check('strip has 6 pages and 5 cut points', document.querySelectorAll('#split-strip .split-page').length === 6 && document.querySelectorAll('#split-strip .split-gap').length === 5);
  check('default cut is in the middle', /pp\. 1–3 of 6/.test(summary()) && /pp\. 4–6 of 6/.test(summary()), summary());
  document.querySelector('#split-strip .split-gap[data-after="2"]').click();
  check('clicking a cut point updates the summary', /pp\. 1–2 of 6/.test(summary()) && /pp\. 3–6 of 6/.test(summary()), summary());
  check('typed field follows the click', document.getElementById('split-input').value === '2');
  check('selected cut point is marked', document.querySelector('#split-strip .split-gap[data-after="2"]').getAttribute('aria-pressed') === 'true');

  // 2. Typed: valid numbers move the cut, invalid ones disable Split.
  const input = document.getElementById('split-input');
  const type = (v) => { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); };
  const confirm = document.getElementById('split-apply-btn');
  type('4');
  check('typing moves the cut', /pp\. 1–4 of 6/.test(summary()) && document.querySelector('#split-strip .split-gap[data-after="4"]').getAttribute('aria-pressed') === 'true', summary());
  check('valid number leaves Split enabled', !confirm.disabled);
  for (const bad of ['0', '6', '9', '', '2.5', '-1']) { type(bad); check('"' + bad + '" disables Split', confirm.disabled); }

  // 3. Escape cancels without changing anything.
  type('3');
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('Escape closes the dialog', !SplitDialog.isOpen());
  check('cancel changes nothing', cards().length === 4 && !state.pages.some((p) => p.splitBefore));

  // 4. Confirm a typed split.
  cards()[0].querySelector('.split-btn').click();
  await waitFor(() => SplitDialog.isOpen());
  type('4');
  confirm.click();
  check('dialog closes on Split', !SplitDialog.isOpen());
  check('document becomes two parts', cards().length === 5, cards().map(cardTitle).join(' ; '));
  check('parts are labelled by page range', /pp\. 1–4 of 6/.test(cardTitle(cards()[0])) && /pp\. 5–6 of 6/.test(cardTitle(cards()[1])), cards().map(cardTitle).join(' ; '));
  check('page order is unchanged by splitting', order() === 'A1 A2 A3 A4 A5 A6 B1 B2 C1 photo1', order());
  check('first part can rejoin', !!cards()[0].querySelector('.join-btn') && !cards()[1].querySelector('.join-btn'));

  // 5. Parts move independently.
  cards()[1].querySelector('.move-left-btn').click();
  check('second part moves in front of the first', order() === 'A5 A6 A1 A2 A3 A4 B1 B2 C1 photo1', order());
  check('still two separate parts', cards().length === 5 && !cards().some((c) => c.querySelector('.join-btn')), cards().map(cardTitle).join(' ; '));
  cards()[0].querySelector('.move-right-btn').click();
  check('moved back', order() === 'A1 A2 A3 A4 A5 A6 B1 B2 C1 photo1', order());
  cards()[1].querySelector('.move-right-btn').click();
  check('a part can go behind another document', order() === 'A1 A2 A3 A4 B1 B2 A5 A6 C1 photo1', order());
  cards()[2].querySelector('.move-left-btn').click();
  check('and come back next to its first part', order() === 'A1 A2 A3 A4 A5 A6 B1 B2 C1 photo1', order());

  // 6. Pages view: removing or moving the first page of a part keeps the parts separate.
  setViewMode('pages');
  removePage(4); // A5
  setViewMode('documents');
  check('removing the first page of a part keeps two parts', cards().length === 5 && /p\. 6 of 6/.test(cardTitle(cards()[1])), cards().map(cardTitle).join(' ; '));
  setViewMode('pages');
  reorderPage(4, 8); // A6 to the end
  setViewMode('documents');
  check('moving the only page of a part keeps parts apart', cards().length === 5, cards().map(cardTitle).join(' ; '));

  // 7. Join: parts that are direct neighbours and in order come back as one document.
  await handleFiles([await makePdf('Z.pdf', 5)]);
  const z = DocGroups.groupPagesIntoDocuments(state.pages).slice(-1)[0];
  check('new document is one card', z.count === 5);
  state.pages = DocGroups.splitDocument(state.pages, DocGroups.groupPagesIntoDocuments(state.pages).length - 1, 2);
  renderPageGrid();
  const before = cards().length;
  const joinBtn = cards()[before - 2].querySelector('.join-btn');
  check('join button appears on the first part', !!joinBtn);
  joinBtn.click();
  check('join merges the parts', cards().length === before - 1 && /5 pages|All pages/.test(cardTitle(cards()[cards().length - 1])), cards().map(cardTitle).join(' ; '));

  // 8. A split document exports every page once.
  let exported = null;
  const realCreate = URL.createObjectURL;
  URL.createObjectURL = (blob) => { if (blob.type === 'application/pdf') exported = blob; return realCreate.call(URL, blob); };
  state.pages = DocGroups.splitDocument(state.pages, 0, 3);
  state.pages = DocGroups.moveDocument(state.pages, 1, 0);
  await exportMergedPdf();
  await waitFor(() => exported);
  URL.createObjectURL = realCreate;
  const out = await PDFLib.PDFDocument.load(await exported.arrayBuffer());
  check('export keeps all pages', out.getPageCount() === state.pages.length, out.getPageCount() + ' vs ' + state.pages.length);
}
