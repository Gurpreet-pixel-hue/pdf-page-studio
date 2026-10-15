/**
 * PDF Page Studio - Export name dialog
 * Asks what the downloaded PDF should be called. ask() resolves with a clean
 * file name ending in .pdf, or null when the user cancels.
 */
(function () {
  let ui = null;
  let session = null; // { resolve, opener }

  function build() {
    if (ui) return ui;
    ui = {
      modal: document.getElementById('export-name-modal'),
      backdrop: document.getElementById('export-name-backdrop'),
      input: document.getElementById('export-name-input'),
      preview: document.getElementById('export-name-preview'),
      confirm: document.getElementById('export-name-confirm-btn'),
      cancel: document.getElementById('export-name-cancel-btn'),
      close: document.getElementById('export-name-close-btn')
    };
    ui.input.addEventListener('input', render);
    ui.confirm.addEventListener('click', confirm);
    ui.cancel.addEventListener('click', () => finish(null));
    ui.close.addEventListener('click', () => finish(null));
    ui.backdrop.addEventListener('click', () => finish(null));
    ui.modal.addEventListener('keydown', onKeydown);
    return ui;
  }

  const hasName = () => ui.input.value.trim() !== '';

  function render() {
    ui.preview.textContent = hasName() ? FileName.cleanPdfName(ui.input.value) : '';
    ui.confirm.disabled = !hasName();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      finish(null);
      return;
    }
    if (e.key === 'Enter' && e.target === ui.input) {
      e.preventDefault();
      confirm();
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

  function confirm() {
    if (!session || !hasName()) return;
    finish(FileName.cleanPdfName(ui.input.value));
  }

  function finish(result) {
    if (!session) return;
    const { resolve, opener } = session;
    session = null;
    ui.modal.classList.remove('active');
    document.body.style.overflow = '';
    if (opener && typeof opener.focus === 'function') opener.focus();
    resolve(result);
  }

  /** ask({ defaultName }) -> Promise<string | null> */
  function ask(options) {
    build();
    if (session) finish(null);
    return new Promise((resolve) => {
      session = { resolve, opener: document.activeElement };
      ui.input.value = FileName.baseName(options && options.defaultName);
      render();
      ui.modal.classList.add('active');
      document.body.style.overflow = 'hidden';
      ui.input.focus();
      ui.input.select();
    });
  }

  window.ExportNameDialog = { ask, isOpen: () => !!session };
}());
