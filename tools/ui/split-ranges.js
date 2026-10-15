// Split dialog modes: fixed range (every n pages) and custom ranges (1-8, 9-10, ...), next to the single cut.
const cards = () => [...document.querySelectorAll('#page-grid .doc-card')];
const titles = () => cards().map((c) => c.querySelector('.card-dimensions').textContent);
const summary = () => document.getElementById('split-summary').textContent;
const confirmBtn = () => document.getElementById('split-apply-btn');
const mode = (m) => document.getElementById('split-mode-' + m);
const selectedGaps = () => document.querySelectorAll('#split-strip .split-gap.selected').length;
const typeInto = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };

async function makePdf(name, pageCount) {
  const doc = await PDFLib.PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([300, 400]);
  return new File([await doc.save()], name, { type: 'application/pdf' });
}
async function openSplit(docIndex) {
  cards()[docIndex].querySelector('.split-btn').click();
  await waitFor(() => SplitDialog.isOpen());
}

async function scenario() {
  await handleFiles([await makePdf('T.pdf', 10), await makePdf('U.pdf', 13)]);
  setViewMode('documents');

  // 1. Three modes, single cut is still the default.
  await openSplit(0);
  check('three modes are offered', !!mode('cut') && !!mode('fixed') && !!mode('custom'));
  check('single cut is the default mode', mode('cut').getAttribute('aria-selected') === 'true' && mode('fixed').getAttribute('aria-selected') === 'false');
  check('only the active mode shows its field', !document.getElementById('split-fixed-field').offsetParent && !document.getElementById('split-custom-field').offsetParent && !!document.getElementById('split-cut-field').offsetParent);

  // 2. Fixed range: every n pages.
  mode('fixed').click();
  check('fixed mode is selected and shows its field', mode('fixed').getAttribute('aria-selected') === 'true' && !!document.getElementById('split-fixed-field').offsetParent);
  typeInto('split-fixed-input', '2');
  check('every 2 pages gives 5 parts', /Part A: pp\. 1–2 of 10/.test(summary()) && /Part E: pp\. 9–10 of 10/.test(summary()), summary());
  check('all four cut points are marked', selectedGaps() === 4, String(selectedGaps()));
  typeInto('split-fixed-input', '3');
  check('every 3 pages leaves a shorter last part', /Part D: p\. 10 of 10/.test(summary()) && selectedGaps() === 3, summary());
  typeInto('split-fixed-input', '1');
  check('every page gives ten parts, summary is shortened', /and \d+ more/.test(summary()) && selectedGaps() === 9, summary());
  for (const bad of ['0', '10', '11', '', 'x', '2.5', '-1']) { typeInto('split-fixed-input', bad); check('fixed "' + bad + '" disables Split', confirmBtn().disabled); }
  check('invalid fixed value explains itself', /1.*9|whole number/i.test(summary()) && document.getElementById('split-summary').classList.contains('crop-hint-error'), summary());

  // 3. Apply fixed range 2: a 10-page PDF becomes five 2-page documents.
  typeInto('split-fixed-input', '2');
  confirmBtn().click();
  check('dialog closes', !SplitDialog.isOpen());
  const t = titles();
  check('five two-page documents plus the other PDF', cards().length === 6 && t.slice(0, 5).join('|') === 'pp. 1–2 of 10|pp. 3–4 of 10|pp. 5–6 of 10|pp. 7–8 of 10|pp. 9–10 of 10', t.join('|'));
  check('page order is unchanged', state.pages.slice(0, 10).every((p, i) => p.sourcePageIndex === i));

  // 4. Custom ranges.
  await openSplit(5); // U.pdf, 13 pages
  mode('custom').click();
  check('custom mode shows its field', !!document.getElementById('split-custom-field').offsetParent);
  typeInto('split-custom-input', '1-8,9-10,11-13');
  check('three custom parts are previewed', /Part A: pp\. 1–8 of 13/.test(summary()) && /Part B: pp\. 9–10 of 13/.test(summary()) && /Part C: pp\. 11–13 of 13/.test(summary()) && selectedGaps() === 2, summary());
  typeInto('split-custom-input', '1-5, 5-8');
  check('overlapping ranges are rejected', confirmBtn().disabled && /more than one range/i.test(summary()) && document.getElementById('split-summary').classList.contains('crop-hint-error'), summary());
  typeInto('split-custom-input', '1-20');
  check('a page beyond the end is rejected', confirmBtn().disabled && /13/.test(summary()), summary());
  typeInto('split-custom-input', '7-3');
  check('a backwards range is rejected', confirmBtn().disabled && /backwards/i.test(summary()), summary());
  typeInto('split-custom-input', '');
  check('empty input is rejected', confirmBtn().disabled);
  typeInto('split-custom-input', '1-13');
  check('the whole document as one range is rejected', confirmBtn().disabled && /whole document/i.test(summary()), summary());
  typeInto('split-custom-input', '3-5');
  check('unlisted pages are kept as their own parts and the summary says so', !confirmBtn().disabled && /Part A: pp\. 1–2 of 13/.test(summary()) && /Part C: pp\. 6–13 of 13/.test(summary()) && /not listed/i.test(summary()), summary());

  // 5. Clicking a cut point switches to a single cut there.
  document.querySelector('#split-strip .split-gap[data-after="9"]').click();
  check('clicking a cut point switches to single cut', mode('cut').getAttribute('aria-selected') === 'true' && document.getElementById('split-input').value === '9' && selectedGaps() === 1, summary());

  // 6. Escape cancels; the next open starts in single-cut mode again.
  mode('custom').click();
  typeInto('split-custom-input', '1-4,5-8');
  document.getElementById('split-custom-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('Escape closes without splitting', !SplitDialog.isOpen() && cards().length === 6);
  await openSplit(5);
  check('dialog reopens in single-cut mode', mode('cut').getAttribute('aria-selected') === 'true');

  // 7. Apply custom ranges, with Enter in the field.
  mode('custom').click();
  typeInto('split-custom-input', '1-8,9-10,11-13');
  document.getElementById('split-custom-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  check('Enter applies the custom ranges', !SplitDialog.isOpen() && cards().length === 8, String(cards().length));
  check('three U.pdf parts are labelled by range', titles().slice(5).join('|') === 'pp. 1–8 of 13|pp. 9–10 of 13|pp. 11–13 of 13', titles().join('|'));

  // 8. Parts of a range split move independently and join back.
  cards()[7].querySelector('.move-left-btn').click();
  check('last custom part moves up one place', titles().slice(5).join('|') === 'pp. 1–8 of 13|pp. 11–13 of 13|pp. 9–10 of 13', titles().join('|'));
  cards()[6].querySelector('.move-right-btn').click();
  const join = cards()[5].querySelector('.join-btn');
  check('neighbouring parts can be joined again', !!join);
  join.click();
  check('join merges the first two parts', titles().slice(5).join('|') === 'pp. 1–10 of 13|pp. 11–13 of 13', titles().join('|'));
}
