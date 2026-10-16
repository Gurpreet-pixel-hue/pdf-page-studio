/**
 * PDF Page Studio - Split dialog
 * Choose how to cut a multi-page document into parts. Three modes share one
 * dialog: one cut (tap between thumbnails or type a page number), fixed range
 * (every n pages) and custom ranges ("1-8, 9-10, 11-13"). Every mode produces a
 * list of part sizes. The caller supplies the pages to show and a
 * preview(sizes) function that labels the resulting parts.
 */
(function () {
  const MAX_LISTED_PARTS = 6;
  const MODES = ['cut', 'fixed', 'custom'];

  let ui = null;      // cached elements, built on first open
  let session = null; // { count, mode, cut, fixedText, customText, onApply, preview, opener }

  function build() {
    if (ui) return ui;
    ui = {
      modal: document.getElementById('split-modal'),
      backdrop: document.getElementById('split-backdrop'),
      title: document.getElementById('split-title'),
      hint: document.getElementById('split-hint'),
      strip: document.getElementById('split-strip'),
      tabs: MODES.map((m) => document.getElementById('split-mode-' + m)),
      fields: { cut: document.getElementById('split-cut-field'), fixed: document.getElementById('split-fixed-field'), custom: document.getElementById('split-custom-field') },
      inputs: { cut: document.getElementById('split-input'), fixed: document.getElementById('split-fixed-input'), custom: document.getElementById('split-custom-input') },
      total: document.getElementById('split-total'),
      fixedTotal: document.getElementById('split-fixed-total'),
      summary: document.getElementById('split-summary'),
      apply: document.getElementById('split-apply-btn'),
      cancel: document.getElementById('split-cancel-btn'),
      close: document.getElementById('split-close-btn')
    };
    ui.apply.addEventListener('click', apply);
    ui.cancel.addEventListener('click', close);
    ui.close.addEventListener('click', close);
    ui.backdrop.addEventListener('click', close);
    ui.modal.addEventListener('keydown', onKeydown);
    ui.tabs.forEach((tab) => tab.addEventListener('click', () => {
      if (session && tab.dataset.mode !== 'cut') session.visualTouched = false;
      setMode(tab.dataset.mode, true);
    }));
    MODES.forEach((m) => ui.inputs[m].addEventListener('input', () => {
      if (!session) return;
      if (m === 'cut') {
        session.cutText = ui.inputs.cut.value;
        session.visualTouched = true;
      }
      if (m === 'fixed') session.fixedText = ui.inputs.fixed.value;
      if (m === 'custom') session.customText = ui.inputs.custom.value;
      render();
    }));
    ui.strip.addEventListener('click', (e) => {
      const gap = e.target.closest('.split-gap');
      if (!gap || !session) return;
      const after = Number(gap.dataset.after);
      if (!Number.isFinite(after)) return;

      if (session.mode !== 'cut' || !session.visualTouched) {
        session.visualTouched = true;
        session.cutText = String(after);
        ui.inputs.cut.value = session.cutText;
        session.skipAutoScroll = true;
        setMode('cut', false);
        session.skipAutoScroll = false;
        return;
      }

      const parsed = parseCutPoints(session.cutText, session.count);
      const activeCuts = new Set(parsed.cuts || []);
      if (activeCuts.has(after)) {
        activeCuts.delete(after);
      } else {
        activeCuts.add(after);
      }
      const nextCuts = [...activeCuts].sort((a, b) => a - b);
      session.cutText = nextCuts.join(', ');
      ui.inputs.cut.value = session.cutText;
      session.skipAutoScroll = true;
      render();
      session.skipAutoScroll = false;
    });
    return ui;
  }

  /** A whole number from 1 to count - 1, or null. */
  function parseWhole(text, count) {
    if (!/^\d+$/.test(String(text).trim())) return null;
    const n = Number(text);
    return n >= 1 && n < count ? n : null;
  }

  /** Parse one or more cut points (1 to count - 1) separated by commas, semicolons, or spaces. */
  function parseCutPoints(text, count) {
    const raw = String(text || '').trim();
    if (!raw) {
      return {
        sizes: null,
        cuts: [],
        error: `Click between pages to select cut points, or enter page numbers from 1 to ${count - 1}.`
      };
    }
    const tokens = raw.split(/[\s,;]+/).filter(Boolean);
    const nums = [];
    for (const token of tokens) {
      const n = parseWhole(token, count);
      if (n === null) {
        return {
          sizes: null,
          cuts: [],
          error: `Enter page numbers from 1 to ${count - 1}.`
        };
      }
      nums.push(n);
    }
    const cuts = [...new Set(nums)].sort((a, b) => a - b);
    const sizes = [];
    let prev = 0;
    for (const c of cuts) {
      sizes.push(c - prev);
      prev = c;
    }
    sizes.push(count - prev);
    return { sizes, cuts };
  }

  /** What the current mode would do: { sizes, error, note }. sizes is null when it cannot split. */
  function current() {
    const { count, mode } = session;
    if (mode === 'cut') {
      return parseCutPoints(session.cutText, count);
    }
    if (mode === 'fixed') {
      const n = parseWhole(session.fixedText, count);
      return n === null
        ? { sizes: null, error: `Enter a whole number of pages from 1 to ${count - 1}.` }
        : { sizes: DocGroups.fixedSizes(count, n) };
    }
    const text = session.customText;
    const parsed = DocGroups.parsePageRanges(text, count);
    if (parsed.error) return { sizes: null, error: parsed.error, quiet: !String(text).trim() };
    const loose = parsed.parts.filter((p) => p.implicit).map((p) => (p.from === p.to ? `${p.from}` : `${p.from}–${p.to}`));
    return {
      sizes: parsed.sizes,
      note: loose.length ? `Pages ${loose.join(', ')} are not listed, so each stretch stays a part of its own.` : ''
    };
  }

  const letters = (i) => {
    let s = '';
    for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
    return s;
  };

  function setMode(mode, focusInput) {
    session.mode = mode;
    render();
    if (focusInput) {
      ui.inputs[mode].focus();
      if (ui.inputs[mode].select) ui.inputs[mode].select();
    }
  }

  function render() {
    const { count, mode } = session;
    ui.tabs.forEach((tab) => {
      const on = tab.dataset.mode === mode;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
    });
    MODES.forEach((m) => { ui.fields[m].hidden = m !== mode; });
    ui.inputs.cut.value = session.cutText;

    const { sizes, error, note, quiet } = current();
    session.sizes = sizes;

    const boundaries = new Set();
    if (sizes) sizes.reduce((sum, size, i) => { if (i < sizes.length - 1) boundaries.add(sum + size); return sum + size; }, 0);
    ui.strip.querySelectorAll('.split-gap').forEach((gap) => {
      const selected = boundaries.has(Number(gap.dataset.after));
      gap.setAttribute('aria-pressed', selected ? 'true' : 'false');
      gap.classList.toggle('selected', selected);
    });
    if (!session.skipAutoScroll) {
      const firstCut = ui.strip.querySelector('.split-gap.selected');
      if (firstCut) ui.strip.scrollLeft = firstCut.offsetLeft - ui.strip.clientWidth / 2;
    }

    ui.apply.disabled = !sizes;
    ui.inputs[mode].classList.toggle('invalid', !sizes && !quiet);
    ui.summary.classList.toggle('crop-hint-error', !sizes && !quiet);
    if (!sizes) {
      ui.summary.textContent = error;
      return;
    }
    const labels = session.preview(sizes);
    const shown = labels.length > MAX_LISTED_PARTS ? labels.slice(0, MAX_LISTED_PARTS - 1) : labels;
    let text = shown.map((label, i) => `Part ${letters(i)}: ${label}.`).join(' ');
    if (labels.length > shown.length) text += ` … and ${labels.length - shown.length} more parts.`;
    ui.summary.textContent = note ? `${text} ${note}` : text;
  }

  function buildStrip(pages) {
    ui.strip.innerHTML = '';
    pages.forEach((page, i) => {
      const cell = document.createElement('div');
      cell.className = 'split-page';
      const img = document.createElement('img');
      img.src = page.thumbnailDataUrl;
      img.alt = `Page ${i + 1}`;
      img.loading = 'lazy';
      img.draggable = false;
      img.style.transform = `rotate(${page.rotation || 0}deg)`;
      const label = document.createElement('span');
      label.textContent = String(i + 1);
      cell.append(img, label);
      ui.strip.appendChild(cell);
      if (i < pages.length - 1) {
        const gap = document.createElement('button');
        gap.type = 'button';
        gap.className = 'split-gap';
        gap.dataset.after = String(i + 1);
        gap.setAttribute('aria-label', `Cut after page ${i + 1}`);
        gap.setAttribute('aria-pressed', 'false');
        ui.strip.appendChild(gap);
      }
    });
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Enter' && MODES.some((m) => e.target === ui.inputs[m])) {
      e.preventDefault();
      apply();
      return;
    }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && ui.tabs.includes(e.target)) {
      e.preventDefault();
      const at = ui.tabs.indexOf(e.target);
      const next = ui.tabs[(at + (e.key === 'ArrowRight' ? 1 : MODES.length - 1)) % MODES.length];
      setMode(next.dataset.mode, false);
      next.focus();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = [...ui.modal.querySelectorAll('button:not([disabled]), input')].filter((el) => el.offsetParent !== null && el.tabIndex >= 0);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function apply() {
    if (!session || !session.sizes) return;
    const { sizes, onApply } = session;
    close();
    if (onApply) onApply(sizes.slice());
  }

  function close() {
    if (!ui || !session) return;
    const opener = session.opener;
    session = null;
    ui.modal.classList.remove('active');
    document.body.style.overflow = '';
    if (opener && typeof opener.focus === 'function') opener.focus();
  }

  /**
   * open({ title, pages, preview(sizes) -> [label per part], onApply(sizes) })
   * `pages` are the document's pages in order (at least two); `sizes` are the
   * page counts of the resulting parts, in order, adding up to pages.length.
   */
  function open(options) {
    build();
    const count = options.pages.length;
    if (count < 2) return;
    session = {
      count,
      mode: 'cut',
      cutText: String(Math.floor(count / 2)),
      fixedText: String(Math.min(2, count - 1)),
      customText: '',
      onApply: options.onApply,
      preview: options.preview,
      opener: document.activeElement
    };
    ui.title.textContent = options.title || 'Split document';
    ui.inputs.cut.max = String(count - 1);
    ui.inputs.fixed.max = String(count - 1);
    ui.inputs.fixed.value = session.fixedText;
    ui.inputs.custom.value = '';
    ui.total.textContent = `of ${count}`;
    ui.fixedTotal.textContent = `of ${count}`;
    buildStrip(options.pages);
    ui.modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    render();
    ui.inputs.cut.focus();
    ui.inputs.cut.select();
  }

  window.SplitDialog = { open, close, isOpen: () => !!session };
}());
