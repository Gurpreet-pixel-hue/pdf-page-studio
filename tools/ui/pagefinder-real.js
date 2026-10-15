// Local only (personal journals). Prepare a folder and run:
//   UI_CHECK_FIXTURES=<folder> npm run ui-check -- tools/ui/pagefinder-real.js 900000
// The folder holds: cn.pdf, dwm.pdf, wmc.pdf (the journals), section_scores_ref.json (from sections_export.py),
// and optionally cn_index.jpg, dwm_index.jpg, wmc_index.png (photos or scans of the contents pages, upright or raw).
const JOURNALS = {
  CN:  { file: 'cn.pdf',  index: 'cn_index.jpg',  entries: 12, starts: [3, 5, 8, 10, 12, 16, 18, 20, 22, 24, 26, 34] },
  DWM: { file: 'dwm.pdf', index: 'dwm_index.jpg', entries: 13, starts: [1, 3, 5, 7, 10, 13, 15, 16, 17, 20, 26] },
  WMC: { file: 'wmc.pdf', index: 'wmc_index.png', entries: 11, starts: [1, 7, 10, 18, 23, 35, 42, 49, 54, 59, 68] }
};
const $ = (id) => document.getElementById(id);

async function fixture(name) {
  const response = await fetch('/__fixture/' + name);
  return response.ok ? new File([await response.blob()], name, { type: name.endsWith('.pdf') ? 'application/pdf' : name.endsWith('.png') ? 'image/png' : 'image/jpeg' }) : null;
}

async function scenario() {
  const refResponse = await fetch('/__fixture/section_scores_ref.json');
  const ref = refResponse.ok ? await refResponse.json() : null;
  if (!ref) check('SKIP python comparison (no section_scores_ref.json in UI_CHECK_FIXTURES)', true);
  const detector = SectionDetect.createSectionDetector();

  for (const [name, j] of Object.entries(JOURNALS)) {
    const file = await fixture(j.file);
    if (!file) { check(`SKIP ${name} (${j.file} not in UI_CHECK_FIXTURES)`, true); continue; }
    const started = performance.now();
    const out = await detector.score(file);
    const seconds = (performance.now() - started) / 1000;
    check(`INFO ${name}: ${out.pageCount} pages scanned in ${seconds.toFixed(1)} s (${(seconds / out.pageCount * 1000).toFixed(0)} ms per page)`, true);

    if (ref) {
      const diffs = out.scores.map((s, i) => Math.abs(s.score - ref[name][i]));
      const max = Math.max(...diffs);
      const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      check(`${name}: browser scores agree with Python (mean abs diff < 0.25)`, mean < 0.25, `mean ${mean.toFixed(3)}, max ${max.toFixed(3)}`);
      const top = (scores) => new Set(PageFinder.pickSections(scores, { entryCount: j.starts.length }).sections.map((s) => s.page));
      const pyTop = top(ref[name].map((score, i) => ({ page: i + 1, score })));
      const brTop = top(out.scores);
      check(`${name}: the browser picks the same top-${j.starts.length} pages as Python`, [...pyTop].every((p) => brTop.has(p)) && pyTop.size === brTop.size, `python ${[...pyTop].sort((a, b) => a - b)} | browser ${[...brTop].sort((a, b) => a - b)}`);
    }

    const withIndex = PageFinder.pickSections(out.scores, { entryCount: j.starts.length }).sections.map((s) => s.page);
    const hit = withIndex.filter((p) => j.starts.includes(p)).length;
    check(`INFO ${name}: with the true entry count (${j.starts.length}) ${hit} of ${j.starts.length} pages are right (in-sample)`, true);
    const without = PageFinder.pickSections(out.scores).sections.map((s) => s.page);
    const extra = without.filter((p) => !j.starts.includes(p));
    check(`${name}: with no index no wrong page is proposed (cut-off ${PageFinder.DEFAULT_CUTOFF})`, extra.length === 0, `proposed ${without.length}, wrong: ${extra}`);
    const front = PageFinder.frontPageCount(without.map((page) => ({ page })));
    check(`INFO ${name}: ${front} page(s) before the first proposed heading, counting pre-answer ${JSON.stringify(PageFinder.defaultCounting(front))}`, true);
    out.thumbs.forEach((u) => URL.revokeObjectURL(u));
  }

  // The whole dialog with the real model and the real contents reader on one journal.
  const cn = await fixture('cn.pdf');
  if (cn) {
    PageFinderUI.setDetector(null);
    PageFinderUI.setIndexAnalyser(null);
    PageFinderUI.open();
    await waitFor(() => PageFinderUI.isOpen());
    const input = $('finder-pdf-input');
    const dt = new DataTransfer(); dt.items.add(cn); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    $('finder-start-btn').click();
    await waitFor(() => !$('finder-step-result').hidden, 600000);
    const rows = [...$('finder-rows').querySelectorAll('.finder-row')];
    check(`CN dialog: ${rows.length} sections proposed with no index (the journal has 12)`, rows.length >= 10 && rows.length <= 14, String(rows.length));
    check('CN dialog: "as in this PDF" is pre-answered (certificate and index are in the PDF)', $('finder-count-as-is').checked);
    PageFinderUI.close();
  }

  // The contents photos through the real Auto Crop + IndexScan path.
  let right = 0, tried = 0;
  for (const [name, j] of Object.entries(JOURNALS)) {
    const photo = await fixture(j.index);
    if (!photo) { check(`SKIP ${name} contents photo (${j.index} not in UI_CHECK_FIXTURES)`, true); continue; }
    tried++;
    const result = await PageFinderUI.defaultAnalyseIndex(photo);
    const ok = result.count === j.entries;
    if (ok) right++;
    check(`INFO ${name} contents photo: counted ${result.count}, expected ${j.entries}, crops ${result.cropUrls.length}, warning: ${result.warning}`, true);
    result.cropUrls.forEach((u) => URL.revokeObjectURL(u));
  }
  if (tried) check(`INFO contents photos counted correctly: ${right} of ${tried}`, true);
}
