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
      rows: $('finder-rows'), back: $('finder-back-btn'), copy: $('finder-copy-btn')
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

  /** Result state starts here; Task 6 fills in the editing controls. */
  function initResult() {
    st.entryCount = st.indexInfo && st.indexInfo.count > 0 ? st.indexInfo.count : null;
  }

  /** Plain result: one row per section with its heading thumbnail. Replaced by the full version in Task 6. */
  function renderResult() {
    const picks = PageFinder.pickSections(st.scores, { entryCount: st.entryCount || undefined });
    ui.rows.innerHTML = '';
    picks.sections.forEach((section, i) => {
      const row = document.createElement('div');
      row.className = 'finder-row';
      row.dataset.index = String(i);
      const img = document.createElement('img');
      img.className = 'finder-thumb';
      img.src = st.thumbs[section.page - 1];
      img.alt = `Heading of page ${section.page}`;
      const text = document.createElement('span');
      text.className = 'finder-page-btn';
      text.textContent = `page ${section.page}`;
      row.append(img, text);
      ui.rows.appendChild(row);
    });
  }

  function onKeydown(e) {
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
    setIndexAnalyser(fn) { analyseIndex = fn; }
  };
}());
