/**
 * PDF Page Studio - Find page numbers dialog
 * Choose a journal PDF (and optionally a photo of its contents page), scan it, and show where
 * each section starts. This file owns the dialog; the rules live in page-finder.js.
 */
(function () {
  const $ = (id) => document.getElementById(id);

  let ui = null;       // cached elements, built on first open
  let st = null;       // state of one open dialog
  let detector = null; // SectionDetect detector (replaceable in tests)
  let analyseIndex = null;

  function build() {
    if (ui) return ui;
    ui = {
      modal: $('finder-modal'), backdrop: $('finder-backdrop'), close: $('finder-close-btn'),
      steps: { choose: $('finder-step-choose'), scan: $('finder-step-scan'), result: $('finder-step-result') },
      pdfInput: $('finder-pdf-input'), pdfName: $('finder-pdf-name'), existing: $('finder-existing'),
      indexInput: $('finder-index-input'), indexName: $('finder-index-name'), indexClear: $('finder-index-clear'),
      chooseError: $('finder-choose-error'), chooseCancel: $('finder-choose-cancel-btn'), start: $('finder-start-btn'),
      scanText: $('finder-scan-text'), progress: $('finder-progress'), scanCancel: $('finder-scan-cancel-btn'),
      rows: $('finder-rows'), back: $('finder-back-btn'), copy: $('finder-copy-btn'),
      entriesField: $('finder-entries-field'), entriesInput: $('finder-entries-input'), assignInput: $('finder-assign-input'),
      warnings: $('finder-warnings'), chips: $('finder-chips'),
      countAsIs: $('finder-count-as-is'), countAdd: $('finder-count-add'), extra: $('finder-extra'), countNote: $('finder-count-note'),
      picker: $('finder-picker'), pickerTitle: $('finder-picker-title'), pickerList: $('finder-picker-list'),
      pickerOther: $('finder-picker-other'), pickerOtherBtn: $('finder-picker-other-btn'), pickerClose: $('finder-picker-close-btn'),
    };
    ui.close.addEventListener('click', close);
    ui.backdrop.addEventListener('click', close);
    ui.chooseCancel.addEventListener('click', close);
    ui.modal.addEventListener('keydown', onKeydown);
    ui.pdfInput.addEventListener('change', () => { if (ui.pdfInput.files[0]) choosePdf(ui.pdfInput.files[0]); ui.pdfInput.value = ''; });
    ui.existing.addEventListener('change', () => {
      if (ui.existing.value === '') return;
      const file = st.existingFiles[Number(ui.existing.value)];
      if (file) choosePdf(file);
    });
    ui.indexInput.addEventListener('change', () => { if (ui.indexInput.files[0]) chooseIndex(ui.indexInput.files[0]); ui.indexInput.value = ''; });
    ui.indexClear.addEventListener('click', () => chooseIndex(null));
    ui.start.addEventListener('click', start);
    ui.scanCancel.addEventListener('click', () => { if (st.controller) st.controller.abort(); });
    ui.back.addEventListener('click', () => { freeResult(); showStep('choose'); });
    ui.entriesInput.addEventListener('input', () => {
      const raw = ui.entriesInput.value.trim();
      if (raw === '') { st.entryCount = null; renderResult(); return; }   // cleared: back to the pages that clearly look like headings
      const n = Math.round(Number(raw));
      if (n >= 1 && n <= st.pageCount) { st.entryCount = n; renderResult(); }
    });
    ui.assignInput.addEventListener('input', () => {
      const n = Math.round(Number(ui.assignInput.value));
      st.assignments = Number.isFinite(n) ? Math.max(0, n) : PageFinder.DEFAULT_ASSIGNMENTS;
      renderResult();
    });
    ui.countAsIs.addEventListener('click', () => { st.counting = { mode: 'as-is', extra: st.counting.extra }; st.countingTouched = true; renderResult(); });
    ui.countAdd.addEventListener('click', () => { st.counting = { mode: 'add', extra: st.counting.extra > 0 ? st.counting.extra : 2 }; st.countingTouched = true; renderResult(); });
    ui.extra.addEventListener('input', () => {
      st.counting = { mode: 'add', extra: Number(ui.extra.value) };
      st.countingTouched = true;
      renderResult();
    });
    ui.copy.addEventListener('click', copyResult);
    ui.pickerClose.addEventListener('click', closePicker);
    ui.pickerOtherBtn.addEventListener('click', () => {
      const page = Number(ui.pickerOther.value);
      if (Number.isInteger(page) && page >= 1 && page <= st.pageCount) choosePickerPage(page);
    });
    return ui;
  }

  const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

  function showStep(name) {
    Object.keys(ui.steps).forEach((key) => { ui.steps[key].hidden = key !== name; });
  }

  function showChooseError(message) {
    ui.chooseError.textContent = message || '';
    ui.chooseError.hidden = !message;
  }

  function choosePdf(file) {
    if (!isPdf(file)) {
      st.pdfFile = null;
      ui.pdfName.textContent = 'No PDF chosen';
      ui.start.disabled = true;
      showChooseError('Please choose a PDF file. This is the scanned journal whose pages will be checked.');
      return;
    }
    st.pdfFile = file;
    ui.pdfName.textContent = file.name;
    ui.start.disabled = false;
    showChooseError('');
  }

  function chooseIndex(file) {
    st.indexFile = file;
    ui.indexName.textContent = file ? file.name : 'None';
    ui.indexClear.hidden = !file;
  }

  function fillExisting() {
    const seen = new Map();
    state.pages.forEach((p) => { if (p.sourceType === 'pdf' && !seen.has(p.sourceFile)) seen.set(p.sourceFile, p.fileName); });
    st.existingFiles = [...seen.keys()];
    ui.existing.innerHTML = '';
    if (st.existingFiles.length === 0) { ui.existing.hidden = true; return; }
    const placeholder = document.createElement('option');
    placeholder.textContent = 'Or use a PDF you already added…';
    placeholder.value = '';
    ui.existing.appendChild(placeholder);
    st.existingFiles.forEach((file, i) => {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = seen.get(file);
      ui.existing.appendChild(option);
    });
    ui.existing.hidden = false;
  }

  /** Free every blob URL made for the current result (heading thumbnails, entry crops). */
  function freeResult() {
    if (!st) return;
    (st.thumbs || []).forEach((u) => URL.revokeObjectURL(u));
    ((st.indexInfo && st.indexInfo.cropUrls) || []).forEach((u) => URL.revokeObjectURL(u));
    st.thumbs = null;
    st.indexInfo = null;
    st.scores = null;
  }

  function setProgress(fraction, text) {
    ui.progress.style.width = `${Math.round(fraction * 100)}%`;
    ui.scanText.textContent = text;
  }

  function getDetector() {
    if (!detector) detector = SectionDetect.createSectionDetector();
    return detector;
  }

  /** Default contents-page reader: find the page in the photo, flatten it, count the entries. */
  async function defaultAnalyseIndex(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImageFromUrl(url);
      let source = img;
      let warning = null;
      try {
        const found = await getPageDetector().detect(img);
        if (found.quad && found.confidence >= 0.6 && CropGeometry.isValidQuad(found.quad)) {
          const fit = ImageNormalize.fitWithin(img.naturalWidth, img.naturalHeight, 2000);
          const canvas = document.createElement('canvas');
          canvas.width = fit.width;
          canvas.height = fit.height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, fit.width, fit.height);
          const quadPx = found.quad.map(([x, y]) => [x * fit.width, y * fit.height]);
          const natural = CropGeometry.quadOutputSize(quadPx);
          const size = CropGeometry.capPixels(natural.width, natural.height, 1200000);
          const warped = CropGeometry.warpPerspective(ctx.getImageData(0, 0, fit.width, fit.height), quadPx, size.width, size.height);
          const out = document.createElement('canvas');
          out.width = warped.width;
          out.height = warped.height;
          out.getContext('2d').putImageData(new ImageData(warped.data, warped.width, warped.height), 0, 0);
          source = out;
        } else {
          warning = 'The page edges in the contents photo were not found, so the whole photo was used.';
        }
      } catch (err) {
        warning = 'The page edges in the contents photo could not be detected, so the whole photo was used.';
      }
      const result = await IndexScan.analyseImage(source);
      const cropUrls = await Promise.all(result.crops.map((c) => canvasToObjectUrl(c, 'image/jpeg', 0.8)));
      return { count: result.estimate.count, cropUrls, warning: result.warning || warning };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function start() {
    if (!st.pdfFile || st.running) return;
    const session = st;                       // the dialog may be closed while the scan runs
    session.running = true;
    session.controller = new AbortController();
    showChooseError('');
    freeResult();
    showStep('scan');
    setProgress(0, 'Preparing…');
    const cancelled = () => Object.assign(new Error('Scan cancelled.'), { name: 'AbortError' });
    try {
      if (session.indexFile) {
        setProgress(0, 'Reading your contents page…');
        session.indexInfo = await (analyseIndex || defaultAnalyseIndex)(session.indexFile);
        if (session.controller.signal.aborted) throw cancelled();
      }
      const out = await getDetector().score(session.pdfFile, {
        signal: session.controller.signal,
        onProgress: (done, total) => { if (st === session) setProgress(done / total, `Checking page ${done} of ${total}…`); }
      });
      if (st !== session) { out.thumbs.forEach((u) => URL.revokeObjectURL(u)); return; }
      session.scores = out.scores;
      session.thumbs = out.thumbs;
      session.pageCount = out.pageCount;
      initResult();
      showStep('result');
      renderResult();
    } catch (err) {
      if (st !== session) return;             // closed: nothing to show
      freeResult();
      showStep('choose');
      if (err && err.name !== 'AbortError') showChooseError(err.message || 'The scan failed. Please try again.');
    } finally {
      session.running = false;
      session.controller = null;
    }
  }

  function initResult() {
    st.entryCount = st.indexInfo && st.indexInfo.count > 0 ? st.indexInfo.count : null;
    st.assignments = PageFinder.DEFAULT_ASSIGNMENTS;
    st.labelEdits = new Map();     // entry index -> typed name
    st.missing = new Set();        // entries marked "not in this PDF" (the picker stores this as a null override)
    st.overrides = new Map();      // entry index -> page | null chosen by the user
    st.added = new Set();          // pages added from the candidate chips (no contents photo)
    st.removed = new Set();        // pages the user dropped (no contents photo)
    st.counting = { mode: 'as-is', extra: 0 };
    st.countingTouched = false;
    st.pickerEntry = null;
  }

  /** Everything the screen shows, computed from the scores and the user's choices. */
  function derive() {
    const picks = PageFinder.pickSections(st.scores, { entryCount: st.entryCount || undefined });
    let sections = picks.sections;
    if (!st.entryCount) {
      sections = sections.filter((s) => !st.removed.has(s.page))
        .concat(picks.more.filter((m) => st.added.has(m.page)).map((m) => ({ page: m.page, score: m.score, confident: false })))
        .sort((a, b) => a.page - b.page);
    }
    const n = st.entryCount || sections.length;
    const rows = PageFinder.assignEntries(n, sections.map((s) => s.page), st.missing, st.overrides);
    const auto = PageFinder.makeLabels(n, st.assignments);
    const labels = auto.map((text, i) => (st.labelEdits.has(i) ? st.labelEdits.get(i) : text));
    const pages = rows.filter((r) => r.page !== null).map((r) => r.page).sort((a, b) => a - b);
    const front = pages.length ? pages[0] - 1 : 0;
    if (!st.countingTouched) st.counting = PageFinder.defaultCounting(front);
    return { picks, sections, n, rows, labels, pages, front };
  }

  function warningTexts(d) {
    const out = [];
    if (!st.indexFile) out.push('No contents page was added, so only pages that clearly look like headings are listed. Add a contents-page photo for a more accurate result.');
    if (st.indexInfo && st.indexInfo.warning) out.push(st.indexInfo.warning);
    if (d.n === 0) out.push('No heading pages were found. Pick pages from the list of possible pages below.');
    if (st.entryCount) {
      const clear = d.sections.filter((s) => s.confident).length;
      if (clear < st.entryCount) {
        out.push(`Your contents page lists ${st.entryCount} entries but only ${clear} page${clear === 1 ? '' : 's'} clearly look like headings. Entries without a page say "Page not found", and weaker picks are marked "Unsure". Check each heading picture. If an experiment is not in this PDF, open its page number and choose "Not in this PDF": the entries after it move up.`);
      }
    }
    // Two clear headings in a row is unusual (a one-page experiment or a duplicate photo): say so once.
    const clearPages = new Set(d.sections.filter((s) => s.confident).map((s) => s.page));
    const pairs = PageFinder.adjacentPairs(d.pages.filter((p) => clearPages.has(p)));
    if (pairs.length) out.push(`Two heading pages in a row (${pairs.map(([x, y]) => `${x} and ${y}`).join(', ')}): check which one is the real start.`);
    PageFinder.duplicatePages(d.rows).forEach((page) => out.push(`Page ${page} is used for more than one entry. Change one of them.`));
    if (st.counting.mode === 'ask') out.push('There is 1 page before the first heading. Choose below whether it should be counted.');
    return out;
  }

  function renderResult() {
    const d = derive();
    const confident = new Map(d.sections.map((s) => [s.page, s.confident]));

    ui.entriesField.hidden = !st.indexFile;   // shown whenever a contents photo was chosen, so an unreadable photo can still be counted by hand
    ui.entriesInput.max = String(st.pageCount);
    ui.entriesInput.value = st.entryCount ? String(st.entryCount) : '';
    ui.assignInput.value = String(st.assignments);
    ui.assignInput.max = String(d.n);

    ui.warnings.innerHTML = '';
    warningTexts(d).forEach((text) => {
      const p = document.createElement('p');
      p.textContent = text;
      ui.warnings.appendChild(p);
    });

    ui.rows.innerHTML = '';
    d.rows.forEach((row) => {
      const el = document.createElement('div');
      el.className = 'finder-row';
      el.dataset.index = String(row.index);

      const thumb = document.createElement('img');
      thumb.className = 'finder-thumb';
      if (row.page !== null) { thumb.src = st.thumbs[row.page - 1]; thumb.alt = `Heading of page ${row.page}`; }
      else { thumb.alt = 'No page'; thumb.style.visibility = 'hidden'; }

      const main = document.createElement('div');
      main.className = 'finder-row-main';
      const name = document.createElement('input');
      name.type = 'text';
      name.className = 'finder-label';
      name.value = d.labels[row.index];
      name.setAttribute('aria-label', `Name of entry ${row.index + 1}`);
      name.addEventListener('input', () => st.labelEdits.set(row.index, name.value));
      main.appendChild(name);
      const crop = st.indexInfo && st.indexInfo.cropUrls && st.indexInfo.cropUrls[row.index];
      if (crop) {
        const box = document.createElement('div');
        box.className = 'finder-entry-crop';
        const cropImg = document.createElement('img');
        cropImg.src = crop;
        cropImg.alt = `Entry ${row.index + 1} from your contents page`;
        box.appendChild(cropImg);
        main.appendChild(box);
      }
      const status = document.createElement('span');
      status.className = 'finder-status';
      if (row.status === 'missing') status.textContent = 'Not in this PDF';
      else if (row.status === 'unknown') status.textContent = 'Page not found';
      else if (!row.manual && confident.get(row.page) === false) status.textContent = 'Unsure';
      if (status.textContent) main.appendChild(status);
      if (!st.entryCount) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'finder-remove btn btn-outline';
        remove.textContent = 'Remove';
        remove.addEventListener('click', () => { st.removed.add(row.page); st.added.delete(row.page); renderResult(); });
        main.appendChild(remove);
      }

      const pageButton = document.createElement('button');
      pageButton.type = 'button';
      pageButton.className = 'finder-page-btn';
      const shown = PageFinder.numberedPage(row.page, st.counting);
      pageButton.textContent = shown === null ? '—' : `page ${shown}`;
      pageButton.setAttribute('aria-label', `${d.labels[row.index]}: ${shown === null ? 'no page' : 'page ' + shown}. Change`);
      pageButton.addEventListener('click', () => openPicker(row.index));

      el.append(thumb, main, pageButton);
      ui.rows.appendChild(el);
    });

    ui.chips.innerHTML = '';
    if (!st.entryCount) {
      d.picks.more.filter((m) => !st.added.has(m.page)).forEach((m) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'finder-chip';
        chip.textContent = `+ page ${m.page}`;
        chip.title = 'Add this page as a section start';
        chip.addEventListener('click', () => { st.added.add(m.page); st.removed.delete(m.page); renderResult(); });
        ui.chips.appendChild(chip);
      });
    }

    ui.countAsIs.checked = st.counting.mode === 'as-is';
    ui.countAdd.checked = st.counting.mode === 'add';
    ui.extra.value = String(st.counting.extra);
    ui.countNote.textContent = st.counting.mode === 'ask' ? '' : PageFinder.describeCounting(st.counting);
    ui.copy.disabled = st.counting.mode === 'ask';
  }

  function copyResult() {
    const d = derive();
    const text = PageFinder.formatResult(d.rows, d.labels, st.counting);
    const done = () => showToast('Copied. Paste it wherever you need it.');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => showToast('Copy failed. Select the text and copy it by hand.', 'error'));
    } else {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); done(); } catch (err) { showToast('Copy failed.', 'error'); }
      document.body.removeChild(area);
    }
  }

  /* ---- page picker ---- */

  function openPicker(index) {
    const d = derive();
    st.pickerEntry = index;
    ui.pickerTitle.textContent = `Page for ${d.labels[index]}`;
    ui.pickerList.innerHTML = '';
    const option = (text, sub, thumb, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'finder-picker-option';
      if (thumb) { const img = document.createElement('img'); img.src = thumb; img.alt = ''; b.appendChild(img); }
      const strong = document.createElement('strong');
      strong.textContent = text;
      b.appendChild(strong);
      if (sub) { const s = document.createElement('span'); s.textContent = sub; b.appendChild(s); }
      b.addEventListener('click', onClick);
      ui.pickerList.appendChild(b);
    };
    option('Not in this PDF', 'This entry has no page here', null, () => choosePickerPage(null));
    option('Automatic', 'Use the suggested page', null, () => { st.overrides.delete(index); st.missing.delete(index); closePicker(); renderResult(); });
    PageFinder.rankPages(st.scores).slice(0, 24).forEach((p) => {
      option(`Page ${p.page}`, p.score > PageFinder.DEFAULT_CUTOFF ? 'Looks like a heading' : 'Less likely', st.thumbs[p.page - 1], () => choosePickerPage(p.page));
    });
    ui.pickerOther.value = '';
    ui.pickerOther.max = String(st.pageCount);
    ui.picker.hidden = false;
    ui.pickerList.querySelector('button').focus();
  }

  function choosePickerPage(page) {
    if (st.pickerEntry === null) return;
    st.overrides.set(st.pickerEntry, page);
    closePicker();
    renderResult();
  }

  function closePicker() {
    ui.picker.hidden = true;
    st.pickerEntry = null;
  }

  function onKeydown(e) {
    if (e.key === 'Escape' && ui.picker && !ui.picker.hidden) {
      e.stopPropagation();
      closePicker();
      return;
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = [...ui.modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select')].filter((el) => el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function open() {
    build();
    if (st && st.controller) st.controller.abort();
    freeResult();
    st = { pdfFile: null, indexFile: null, running: false, controller: null, existingFiles: [], opener: document.activeElement };
    ui.pdfName.textContent = 'No PDF chosen';
    chooseIndex(null);
    ui.start.disabled = true;
    showChooseError('');
    fillExisting();
    showStep('choose');
    ui.modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    ui.start.disabled = true;
    ui.pdfInput.focus();
  }

  function close() {
    if (!ui || !st) return;
    if (st.controller) st.controller.abort();
    freeResult();
    ui.modal.classList.remove('active');
    document.body.style.overflow = '';
    const opener = st.opener;
    st = null;
    if (opener && typeof opener.focus === 'function') opener.focus();
  }

  window.PageFinderUI = {
    open,
    close,
    isOpen: () => !!st && !!ui && ui.modal.classList.contains('active'),
    setDetector(d) { detector = d; },
    setIndexAnalyser(fn) { analyseIndex = fn; },
    defaultAnalyseIndex   // the real contents-page reader, used by the local acceptance scenario
  };
}());
