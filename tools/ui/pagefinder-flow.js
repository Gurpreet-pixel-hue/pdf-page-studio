// The finder dialog: open from the landing page, choose files, scan with progress, cancel, errors, reset.
const $ = (id) => document.getElementById(id);
const isOpen = () => $('finder-modal').classList.contains('active');
const visibleStep = () => ['choose', 'scan', 'result'].find((s) => !$('finder-step-' + s).hidden);
const setFile = (input, file) => { const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); };

async function makePdf(name, pageCount) {
  const doc = await PDFLib.PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([595, 842]);
  return new File([await doc.save()], name, { type: 'application/pdf' });
}
async function thumbUrl(label) {
  const c = document.createElement('canvas'); c.width = 320; c.height = 100;
  const g = c.getContext('2d'); g.fillStyle = '#f5f2eb'; g.fillRect(0, 0, 320, 100); g.fillStyle = '#222'; g.font = '30px sans-serif'; g.fillText(label, 20, 60);
  return new Promise((r) => c.toBlob((b) => r(URL.createObjectURL(b)), 'image/png'));
}
/** A fake detector: `high` lists the heading pages; everything else scores low. */
function fakeDetector({ pages, high, delay = 0, fail = null }) {
  return {
    async score(file, { onProgress, signal } = {}) {
      if (fail) throw new Error(fail);
      const scores = [], thumbs = [];
      for (let p = 1; p <= pages; p++) {
        if (signal && signal.aborted) throw Object.assign(new Error('Scan cancelled.'), { name: 'AbortError' });
        if (delay) await sleep(delay);
        scores.push({ page: p, score: high.includes(p) ? 4 + p / 100 : -3 - p / 100 });
        thumbs.push(await thumbUrl('page ' + p));
        if (onProgress) onProgress(p, pages);
      }
      return { scores, thumbs, pageCount: pages };
    }
  };
}

async function scenario() {
  // 1. The button is on the landing page and opens the dialog at the choose step.
  check('landing page has the Find page numbers button', !!$('finder-open-btn') && /Find page numbers/.test($('finder-open-btn').textContent));
  $('finder-open-btn').click();
  await waitFor(isOpen);
  check('dialog opens on the choose step', visibleStep() === 'choose');
  check('Start is disabled until a PDF is chosen', $('finder-start-btn').disabled);
  check('the optional photo is explained as optional', /optional/i.test(document.querySelector('label[for="finder-index-input"]').textContent + $('finder-step-choose').textContent));

  // 2. Only PDFs are accepted as the journal.
  setFile($('finder-pdf-input'), new File([new Uint8Array([1, 2, 3])], 'notes.txt', { type: 'text/plain' }));
  check('a non-PDF is refused with a message', !$('finder-choose-error').hidden && /PDF/.test($('finder-choose-error').textContent) && $('finder-start-btn').disabled, $('finder-choose-error').textContent);
  const journal = await makePdf('Lab journal.pdf', 8);
  setFile($('finder-pdf-input'), journal);
  check('a PDF is accepted and its name shown', $('finder-pdf-name').textContent === 'Lab journal.pdf' && !$('finder-start-btn').disabled && $('finder-choose-error').hidden);

  // 3. Scanning shows progress and ends on the result step.
  PageFinderUI.setDetector(fakeDetector({ pages: 8, high: [1, 3, 6], delay: 20 }));
  $('finder-start-btn').click();
  await waitFor(() => visibleStep() === 'scan');
  check('scan step shows progress text', /Checking page|Preparing/.test($('finder-scan-text').textContent), $('finder-scan-text').textContent);
  await waitFor(() => visibleStep() === 'result', 20000);
  check('scan ends on the result step', visibleStep() === 'result');
  check('three sections found', $('finder-rows').querySelectorAll('.finder-row').length === 3, String($('finder-rows').querySelectorAll('.finder-row').length));
  $('finder-back-btn').click();
  check('Back returns to the choose step and keeps the PDF', visibleStep() === 'choose' && $('finder-pdf-name').textContent === 'Lab journal.pdf');

  // 4. Cancel mid-scan: back to choose, no error, no result.
  PageFinderUI.setDetector(fakeDetector({ pages: 40, high: [1], delay: 30 }));
  $('finder-start-btn').click();
  await waitFor(() => visibleStep() === 'scan');
  await sleep(150);
  $('finder-scan-cancel-btn').click();
  await waitFor(() => visibleStep() === 'choose', 5000);
  check('cancel returns to the choose step without an error', visibleStep() === 'choose' && $('finder-choose-error').hidden);
  await sleep(300);
  check('and nothing keeps running afterwards', visibleStep() === 'choose');

  // 5. A failing scan shows its message on the choose step and can be retried.
  PageFinderUI.setDetector(fakeDetector({ pages: 3, high: [1], fail: 'This PDF is password protected, so its pages cannot be read.' }));
  $('finder-start-btn').click();
  await waitFor(() => visibleStep() === 'choose' && !$('finder-choose-error').hidden, 5000);
  check('the error is shown in plain words', /password protected/.test($('finder-choose-error').textContent), $('finder-choose-error').textContent);
  PageFinderUI.setDetector(fakeDetector({ pages: 3, high: [1] }));
  $('finder-start-btn').click();
  await waitFor(() => visibleStep() === 'result', 10000);
  check('a retry works and clears the error', visibleStep() === 'result' && $('finder-choose-error').hidden);

  // 6. Escape closes; reopening starts fresh.
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  $('finder-modal').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(100);
  check('Escape closes the dialog', !isOpen());
  $('finder-open-btn').click();
  await waitFor(isOpen);
  check('reopening starts on the choose step with nothing chosen', visibleStep() === 'choose' && $('finder-pdf-name').textContent === 'No PDF chosen' && $('finder-start-btn').disabled);

  // 7. A PDF already added to the page can be used without choosing it again.
  PageFinderUI.close();
  await handleFiles([await makePdf('Already added.pdf', 4)]);
  PageFinderUI.open();
  await waitFor(isOpen);
  check('already-added PDFs are offered', !$('finder-existing').hidden && [...$('finder-existing').options].some((o) => o.textContent === 'Already added.pdf'), [...$('finder-existing').options].map((o) => o.textContent).join());
  $('finder-existing').value = [...$('finder-existing').options].find((o) => o.textContent === 'Already added.pdf').value;
  $('finder-existing').dispatchEvent(new Event('change', { bubbles: true }));
  check('choosing one enables Start and shows its name', !$('finder-start-btn').disabled && $('finder-pdf-name').textContent === 'Already added.pdf');

  // 8. The optional contents photo: accepted, named, removable. (Reading it is covered in Task 6.)
  const photo = new File([new Uint8Array([137, 80, 78, 71])], 'contents.png', { type: 'image/png' });
  setFile($('finder-index-input'), photo);
  check('the photo is named and can be removed', $('finder-index-name').textContent === 'contents.png' && !$('finder-index-clear').hidden);
  $('finder-index-clear').click();
  check('removing the photo resets it', $('finder-index-name').textContent === 'None' && $('finder-index-clear').hidden);
  PageFinderUI.close();
}
