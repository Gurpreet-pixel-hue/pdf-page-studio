// The result screen: typed lines, editing, picker, reconciliation warnings, counting choices, copy.
const $ = (id) => document.getElementById(id);
const rows = () => [...$('finder-rows').querySelectorAll('.finder-row')];
const label = (i) => rows()[i].querySelector('.finder-label').value;
const pageText = (i) => rows()[i].querySelector('.finder-page-btn').textContent.replace(/^page\s*/, '').trim();
const warnings = () => $('finder-warnings').textContent;
const setFile = (input, file) => { const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); };
const typeInto = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
let copied = null;
const pickerOption = (title) => [...$('finder-picker-list').querySelectorAll('.finder-picker-option')].find((b) => b.querySelector('strong').textContent === title);

async function makePdf(name, n) {
  const doc = await PDFLib.PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([595, 842]);
  return new File([await doc.save()], name, { type: 'application/pdf' });
}
async function thumbUrl(text) {
  const c = document.createElement('canvas'); c.width = 320; c.height = 100;
  const g = c.getContext('2d'); g.fillStyle = '#f5f2eb'; g.fillRect(0, 0, 320, 100); g.fillStyle = '#222'; g.font = '30px sans-serif'; g.fillText(text, 20, 60);
  return new Promise((r) => c.toBlob((b) => r(URL.createObjectURL(b)), 'image/png'));
}
/** `high` lists heading pages; `mid` lists pages with a middling score (above 0, below the cut-off). */
function fake({ pages, high, mid = [] }) {
  return { async score(file, { onProgress } = {}) {
    const scores = [], thumbs = [];
    for (let p = 1; p <= pages; p++) {
      scores.push({ page: p, score: high.includes(p) ? 4 + p / 100 : mid.includes(p) ? 0.5 + p / 1000 : -3 - p / 100 });
      thumbs.push(await thumbUrl('page ' + p));
      if (onProgress) onProgress(p, pages);
    }
    return { scores, thumbs, pageCount: pages };
  } };
}
async function run({ pages, high, mid, index }) {
  PageFinderUI.open();
  await waitFor(() => PageFinderUI.isOpen());
  setFile($('finder-pdf-input'), await makePdf('journal.pdf', pages));
  if (index) setFile($('finder-index-input'), new File([new Uint8Array([137, 80, 78, 71])], 'contents.png', { type: 'image/png' }));
  PageFinderUI.setDetector(fake({ pages, high, mid }));
  PageFinderUI.setIndexAnalyser(async () => index || { count: 0, cropUrls: [], warning: null });
  $('finder-start-btn').click();
  await waitFor(() => !$('finder-step-result').hidden, 20000);
}

async function scenario() {
  navigator.clipboard.writeText = async (text) => { copied = text; };

  // 1. No contents photo, two journals ends: proposed sections, typed labels, counting pre-answer.
  await run({ pages: 14, high: [3, 5, 8, 10, 12] });          // certificate + index in front (pages 1-2)
  check('five rows, one per heading page', rows().length === 5, String(rows().length));
  check('rows show the PDF page numbers when pages 1-2 are already in the PDF', [0, 1, 2, 3, 4].map(pageText).join() === '3,5,8,10,12', [0, 1, 2, 3, 4].map(pageText).join());
  check('typed labels: experiments then the last two as assignments', [0, 1, 2, 3, 4].map(label).join() === 'Experiment 1,Experiment 2,Experiment 3,Assignment 1,Assignment 2', [0, 1, 2, 3, 4].map(label).join());
  check('"as in this PDF" is pre-answered (2 pages in front)', $('finder-count-as-is').checked && !$('finder-count-add').checked);
  check('the counting sentence is shown', /Page numbers are the PDF page numbers/.test($('finder-count-note').textContent), $('finder-count-note').textContent);
  check('without a contents photo the entries field is hidden and a hint is shown', $('finder-entries-field').hidden && /contents-page photo/i.test(warnings()));
  check('every row has a heading thumbnail', rows().every((r) => /^blob:/.test(r.querySelector('.finder-thumb').src)));

  // 2. Copy: the typed lines and the counting sentence.
  $('finder-copy-btn').click();
  await sleep(100);
  check('copy puts the typed result on the clipboard', copied === ['Experiment 1 – page 3', 'Experiment 2 – page 5', 'Experiment 3 – page 8', 'Assignment 1 – page 10', 'Assignment 2 – page 12', '', 'Page numbers are the PDF page numbers.'].join('\n'), JSON.stringify(copied));

  // 3. Counting choices: add extra pages.
  $('finder-count-add').click();
  check('choosing "extra pages" shows page + 2', [0, 4].map(pageText).join() === '5,14', [0, 4].map(pageText).join());
  typeInto($('finder-extra'), '4');
  check('the extra pages value is editable', pageText(0) === '7' && /4 extra pages/.test($('finder-count-note').textContent), pageText(0) + ' / ' + $('finder-count-note').textContent);
  typeInto($('finder-extra'), '0');
  check('0 extra pages gives the PDF numbers', pageText(0) === '3');
  typeInto($('finder-extra'), '99');
  check('extra pages are limited to 20', pageText(0) === '23', pageText(0));
  $('finder-count-as-is').click();
  check('switching back restores the PDF numbers', pageText(0) === '3' && $('finder-count-as-is').checked);

  // 4. Names: assignments stepper and typing.
  typeInto($('finder-assign-input'), '1');
  check('one assignment: only the last row is an assignment', [0, 1, 2, 3, 4].map(label).join() === 'Experiment 1,Experiment 2,Experiment 3,Experiment 4,Assignment 1', [0, 1, 2, 3, 4].map(label).join());
  typeInto($('finder-assign-input'), '0');
  check('no assignments: all experiments', label(4) === 'Experiment 5');
  typeInto($('finder-assign-input'), '2');
  const nameField = rows()[2].querySelector('.finder-label');
  typeInto(nameField, 'Experiment 3: Hamming code');
  check('a name can be typed and is kept', label(2) === 'Experiment 3: Hamming code');
  $('finder-copy-btn').click();
  await sleep(50);
  check('the typed name appears in the copied text', /Experiment 3: Hamming code – page 8/.test(copied), copied);

  // 5. The page picker: choose another page, "not in this PDF", or any page number.
  rows()[1].querySelector('.finder-page-btn').click();
  await waitFor(() => !$('finder-picker').hidden);
  check('the picker lists pages with thumbnails and a "Not in this PDF" option', $('finder-picker-list').querySelectorAll('.finder-picker-option').length >= 8 && /Not in this PDF/.test($('finder-picker-list').textContent));
  pickerOption('Page 6').click();
  check('choosing page 6 sets that row (and the picker closes)', pageText(1) === '6' && $('finder-picker').hidden, pageText(1));
  rows()[1].querySelector('.finder-page-btn').click();
  await waitFor(() => !$('finder-picker').hidden);
  pickerOption('Not in this PDF').click();
  check('"Not in this PDF" marks the row and removes its page number', /not in this pdf/i.test(rows()[1].textContent) && pageText(1) === '—', rows()[1].textContent);
  check('the entries after it move up to the next sections', [2, 3, 4].map(pageText).join() === '5,8,10', [2, 3, 4].map(pageText).join());
  $('finder-copy-btn').click();
  await sleep(50);
  check('the copied text says "not in this PDF"', /Experiment 2 – not in this PDF/.test(copied), copied);
  rows()[1].querySelector('.finder-page-btn').click();
  await waitFor(() => !$('finder-picker').hidden);
  typeInto($('finder-picker-other'), '11');
  $('finder-picker-other-btn').click();
  check('any page number can be typed', pageText(1) === '11', pageText(1));
  rows()[1].querySelector('.finder-page-btn').click();
  await waitFor(() => !$('finder-picker').hidden);
  typeInto($('finder-picker-other'), '99');
  $('finder-picker-other-btn').click();
  check('a page beyond the PDF is refused and the picker stays open', !$('finder-picker').hidden && pageText(1) === '11');
  $('finder-picker-close-btn').click();
  check('the picker closes without a change', $('finder-picker').hidden && pageText(1) === '11');
  rows()[0].querySelector('.finder-page-btn').click();
  await waitFor(() => !$('finder-picker').hidden);
  pickerOption('Page 8').click();
  check('a page that two rows share is reported', /Page 8 is used for more than one entry/.test(warnings()), warnings());
  rows()[0].querySelector('.finder-page-btn').click();
  await waitFor(() => !$('finder-picker').hidden);
  pickerOption('Automatic').click();
  check('"Automatic" puts the suggested page back and clears the warning', pageText(0) === '3' && !/used for more than one/.test(warnings()), pageText(0));

  // 6. Remove a wrong section, add a missed one from the candidate chips (no contents photo).
  const before = rows().length;
  const chips = [...$('finder-chips').querySelectorAll('.finder-chip')];
  check('"more possible pages" are offered as chips', chips.length > 0 && chips.length <= 10, String(chips.length));
  chips[0].click();
  check('adding a chip adds a row', rows().length === before + 1);
  rows()[0].querySelector('.finder-remove').click();
  check('a row can be removed when there is no contents photo', rows().length === before);
  PageFinderUI.close();

  // 7. The contents photo, DWM-like: 13 entries but only 10 pages look like headings (pages 1 3 5 7 10 13 15 17 20 26).
  await run({ pages: 36, high: [1, 3, 5, 7, 10, 13, 15, 17, 20, 26], index: { count: 13, cropUrls: [], warning: null } });
  check('13 rows (the entry count) are shown', rows().length === 13, String(rows().length));
  check('the entries field shows 13', !$('finder-entries-field').hidden && $('finder-entries-input').value === '13');
  check('a mismatch warning explains the situation', /13 entries/.test(warnings()) && /only 10 pages/.test(warnings()) && /Not in this PDF/.test(warnings()), warnings());
  check('entries with no heading-like page say "Page not found" (no junk pages are used)', [10, 11, 12].every((i) => /Page not found/i.test(rows()[i].textContent)), [10, 11, 12].map((i) => rows()[i].textContent).join(' | '));
  check('the ten clear headings fill the first ten rows in order (shown +2: nothing is in front)', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(pageText).join() === '3,5,7,9,12,15,17,19,22,28', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(pageText).join());
  const pick = async (i, title) => { rows()[i].querySelector('.finder-page-btn').click(); await waitFor(() => !$('finder-picker').hidden); pickerOption(title).click(); };
  await pick(8, 'Not in this PDF'); await pick(9, 'Not in this PDF'); await pick(10, 'Not in this PDF');
  check('after marking Experiments 9-11 "not in this PDF" the assignments move up to their pages', pageText(11) === '22' && pageText(12) === '28', pageText(11) + ',' + pageText(12));
  check('and no entry is left without a page that should have one', ![11, 12].some((i) => /Page not found/i.test(rows()[i].textContent)));
  $('finder-copy-btn').click();
  await sleep(50);
  check('the copied list shows Experiments 9-11 as not in this PDF', /Experiment 9 – not in this PDF\nExperiment 10 – not in this PDF\nExperiment 11 – not in this PDF\nAssignment 1 – page 22\nAssignment 2 – page 28/.test(copied), copied);
  check('no more-pages chips when the contents photo fixed the count', $('finder-chips').children.length === 0);
  PageFinderUI.close();

  // 7a. A contents photo whose table could not be read: the user types the entry count.
  await run({ pages: 12, high: [2, 4, 6, 9], index: { count: 0, cropUrls: [], warning: 'The table in this photo could not be read. Enter the number of entries yourself.' } });
  check('an unreadable photo shows its warning', /could not be read/.test(warnings()), warnings());
  check('the entries field is visible and empty so the count can be typed', !$('finder-entries-field').hidden && $('finder-entries-input').value === '');
  check('until then the clear headings are listed (4 rows, remove buttons shown)', rows().length === 4 && !!rows()[0].querySelector('.finder-remove'), String(rows().length));
  typeInto($('finder-entries-input'), '3');
  check('typing 3 uses the three best pages and hides the remove buttons', rows().length === 3 && !rows()[0].querySelector('.finder-remove'), String(rows().length));
  typeInto($('finder-entries-input'), '');
  check('clearing the count returns to the clear headings', rows().length === 4);
  PageFinderUI.close();

  // 7b. Two clear headings in a row are flagged once.
  await run({ pages: 20, high: [4, 5, 9] });
  check('adjacent clear headings produce one warning', /Two heading pages in a row \(4 and 5\)/.test(warnings()) && (warnings().match(/Two heading pages in a row/g) || []).length === 1, warnings());
  PageFinderUI.close();

  // 8. Fewer entries than headings, then the stepper changes the count.
  await run({ pages: 12, high: [2, 4, 6, 8], index: { count: 3, cropUrls: [], warning: null } });
  check('three entries take the three best-scoring pages (shown in page order)', rows().length === 3 && [0, 1, 2].map(pageText).join() === '4,6,8', [0, 1, 2].map(pageText).join());
  typeInto($('finder-entries-input'), '4');
  check('changing the entry count to 4 adds the fourth heading', rows().length === 4 && pageText(3) === '8', rows().length + ' / ' + pageText(3));
  PageFinderUI.close();

  // 9. Review Focus 1: no heading pages at all.
  await run({ pages: 6, high: [] });
  check('no sections: a clear message and no rows', rows().length === 0 && /No heading pages were found/.test(warnings()), warnings());
  check('candidates are offered', $('finder-chips').querySelectorAll('.finder-chip').length === 6);
  $('finder-copy-btn').click();
  await sleep(50);
  check('copied text is "No sections found." plus the counting sentence', /^No sections found\./.test(copied), copied);
  PageFinderUI.close();

  // 10. Review Focus 5: one page in front is ambiguous; the user decides.
  await run({ pages: 10, high: [2, 4, 6] });
  check('one page in front: neither choice is pre-selected', !$('finder-count-as-is').checked && !$('finder-count-add').checked);
  check('and the screen asks', /1 page before the first heading/.test(warnings() + $('finder-count-note').textContent), warnings());
  check('Copy waits for the choice', $('finder-copy-btn').disabled);
  $('finder-count-add').click();
  check('choosing unlocks Copy and adds 1 page', !$('finder-copy-btn').disabled && pageText(0) === '3', pageText(0));
  PageFinderUI.close();

  // 11. Nothing in front (DWM, WMC): "extra pages: 2" is pre-answered.
  await run({ pages: 10, high: [1, 3, 5] });
  check('nothing in front: extra pages 2 is pre-selected', $('finder-count-add').checked && $('finder-extra').value === '2' && [0, 1, 2].map(pageText).join() === '3,5,7', [0, 1, 2].map(pageText).join());
  check('the sentence states the rule', /include 2 extra pages in front of this PDF/.test($('finder-count-note').textContent), $('finder-count-note').textContent);
  PageFinderUI.close();
}
