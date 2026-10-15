/**
 * PDF Page Studio - Split dialog
 * Choose where to cut a multi-page document: tap between two pages in a
 * thumbnail strip, or type the page number. The caller supplies the pages
 * to show and a preview(n) function that labels the two resulting parts.
 */
(function () {
  let ui = null;      // cached elements, built on first open
  let session = null; // { count, cut, onApply, preview, opener }

  function build() {
    if (ui) return ui;
    ui = {
      modal: document.getElementById('split-modal'),
      backdrop: document.getElementById('split-backdrop'),
      title: document.getElementById('split-title'),
      strip: document.getElementById('split-strip'),
      input: document.getElementById('split-input'),
      total: document.getElementById('split-total'),
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
    ui.input.addEventListener('input', onTyped);
    ui.strip.addEventListener('click', (e) => {
      const gap = e.target.closest('.split-gap');
      if (gap && session) choose(Number(gap.dataset.after), true);
    });
    return ui;
  }

  /** A whole number from 1 to count - 1, or null. */
  function parseCut(text, count) {
    if (!/^\d+$/.test(String(text).trim())) return null;
    const n = Number(text);
    return n >= 1 && n < count ? n : null;
  }

  function onTyped() {
    if (!session) return;
    const n = parseCut(ui.input.value, session.count);
    if (n === null) {
      session.cut = null;
      render(false);
    } else {
      choose(n, false);
    }
  }

  function choose(n, updateInput) {
    session.cut = n;
    render(updateInput);
  }

  function render(updateInput) {
    const { count, cut } = session;
    if (updateInput && cut !== null) ui.input.value = String(cut);
    ui.strip.querySelectorAll('.split-gap').forEach((gap) => {
      const selected = Number(gap.dataset.after) === cut;
      gap.setAttribute('aria-pressed', selected ? 'true' : 'false');
      gap.classList.toggle('selected', selected);
    });
    const selectedGap = ui.strip.querySelector('.split-gap.selected');
    if (selectedGap) ui.strip.scrollLeft = selectedGap.offsetLeft - ui.strip.clientWidth / 2;
    ui.apply.disabled = cut === null;
    ui.input.classList.toggle('invalid', cut === null);
    if (cut === null) {
      ui.summary.textContent = `Enter a page number from 1 to ${count - 1}.`;
      ui.summary.classList.add('crop-hint-error');
    } else {
      const [a, b] = session.preview(cut);
      ui.summary.textContent = `Part A: ${a}. Part B: ${b}.`;
      ui.summary.classList.remove('crop-hint-error');
    }
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
    if (e.key === 'Enter' && e.target === ui.input) {
      e.preventDefault();
      apply();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = [...ui.modal.querySelectorAll('button:not([disabled]), input')].filter((el) => el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function apply() {
    if (!session || session.cut === null) return;
    const { cut, onApply } = session;
    close();
    if (onApply) onApply(cut);
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
   * open({ title, pages, preview(n) -> [labelA, labelB], onApply(n) })
   * `pages` are the document's pages in order (at least two); n is how many
   * pages stay in the first part.
   */
  function open(options) {
    build();
    const count = options.pages.length;
    if (count < 2) return;
    session = { count, cut: Math.floor(count / 2), onApply: options.onApply, preview: options.preview, opener: document.activeElement };
    ui.title.textContent = options.title || 'Split document';
    ui.input.max = String(count - 1);
    ui.total.textContent = `of ${count}`;
    buildStrip(options.pages);
    ui.modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    render(true);
    ui.input.focus();
    ui.input.select();
  }

  window.SplitDialog = { open, close, isOpen: () => !!session };
}());
