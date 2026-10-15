/**
 * PDF Page Studio - Crop editor modal
 * Four draggable corners over the page image, with a magnifier loupe,
 * keyboard nudging, a focus trap and Escape to cancel. Validation uses
 * CropGeometry so the editor and the exporter agree on what a usable quad is.
 */
(function () {
  const INSET_QUAD = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]; // best fixed start measured on the 41 photos
  const CORNER_NAMES = ['top left', 'top right', 'bottom right', 'bottom left'];
  const DEFAULT_HINT = 'Drag the four corners onto the page edges. Arrow keys nudge a focused corner.';
  const INVALID_HINT = 'The corners cross or are too close together. Drag them back so they outline the page.';
  const LOUPE_SIZE = 112;
  const LOUPE_ZOOM = 3;
  const NUDGE = 0.005;
  const NUDGE_SHIFT = 0.02;

  let ui = null;      // cached elements, built on first open
  let session = null; // { quad, start, onApply, onRemove, dragging, opener }

  const copy = (quad) => quad.map((p) => p.slice());
  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  function build() {
    if (ui) return ui;
    ui = {
      modal: document.getElementById('crop-modal'),
      backdrop: document.getElementById('crop-backdrop'),
      stage: document.getElementById('crop-stage'),
      image: document.getElementById('crop-image'),
      polygon: document.getElementById('crop-polygon'),
      loupe: document.getElementById('crop-loupe'),
      hint: document.getElementById('crop-hint'),
      apply: document.getElementById('crop-apply-btn'),
      cancel: document.getElementById('crop-cancel-btn'),
      close: document.getElementById('crop-close-btn'),
      reset: document.getElementById('crop-reset-btn'),
      remove: document.getElementById('crop-remove-btn'),
      handles: []
    };

    for (let i = 0; i < 4; i++) {
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'crop-handle';
      handle.setAttribute('aria-label', `Crop corner: ${CORNER_NAMES[i]}`);
      ui.stage.appendChild(handle);
      ui.handles.push(handle);
      bindHandle(handle, i);
    }

    ui.apply.addEventListener('click', apply);
    ui.cancel.addEventListener('click', close);
    ui.close.addEventListener('click', close);
    ui.backdrop.addEventListener('click', close);
    ui.reset.addEventListener('click', () => {
      if (!session) return;
      session.quad = copy(session.start);
      render();
    });
    ui.remove.addEventListener('click', () => {
      const onRemove = session && session.onRemove;
      close();
      if (onRemove) onRemove();
    });
    ui.modal.addEventListener('keydown', onModalKeydown);
    return ui;
  }

  function pointFromEvent(e) {
    const rect = ui.stage.getBoundingClientRect();
    return [clamp01((e.clientX - rect.left) / rect.width), clamp01((e.clientY - rect.top) / rect.height)];
  }

  function bindHandle(handle, index) {
    handle.addEventListener('pointerdown', (e) => {
      if (!session) return;
      e.preventDefault();
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or already-released pointer */ }
      session.dragging = index;
      handle.classList.add('dragging');
      moveTo(index, pointFromEvent(e));
    });
    handle.addEventListener('pointermove', (e) => {
      if (session && session.dragging === index) moveTo(index, pointFromEvent(e));
    });
    const end = () => {
      if (!session || session.dragging !== index) return;
      session.dragging = null;
      handle.classList.remove('dragging');
      ui.loupe.classList.remove('visible');
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? NUDGE_SHIFT : NUDGE;
      const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!delta || !session) return;
      e.preventDefault();
      const [x, y] = session.quad[index];
      moveTo(index, [clamp01(x + delta[0]), clamp01(y + delta[1])], false);
    });
  }

  function moveTo(index, point, showLoupe = true) {
    session.quad[index] = point;
    render();
    if (showLoupe) drawLoupe(index);
  }

  function drawLoupe(index) {
    const img = ui.image;
    if (!img.naturalWidth) return;
    const [fx, fy] = session.quad[index];
    const displayWidth = img.clientWidth || img.naturalWidth;
    const source = (LOUPE_SIZE / LOUPE_ZOOM) * (img.naturalWidth / displayWidth);
    const ctx = ui.loupe.getContext('2d');
    ctx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
    ctx.drawImage(img, fx * img.naturalWidth - source / 2, fy * img.naturalHeight - source / 2, source, source, 0, 0, LOUPE_SIZE, LOUPE_SIZE);
    ctx.strokeStyle = 'rgba(194, 65, 12, 0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LOUPE_SIZE / 2, 0); ctx.lineTo(LOUPE_SIZE / 2, LOUPE_SIZE);
    ctx.moveTo(0, LOUPE_SIZE / 2); ctx.lineTo(LOUPE_SIZE, LOUPE_SIZE / 2);
    ctx.stroke();
    // Keep the loupe on the opposite side of the stage from the corner being dragged.
    ui.loupe.style.left = fx > 0.5 ? '8px' : `${Math.max(8, ui.stage.clientWidth - LOUPE_SIZE - 8)}px`;
    ui.loupe.classList.add('visible');
  }

  function render() {
    session.quad.forEach(([x, y], i) => {
      ui.handles[i].style.left = `${x * 100}%`;
      ui.handles[i].style.top = `${y * 100}%`;
    });
    ui.polygon.setAttribute('points', session.quad.map(([x, y]) => `${x * 100},${y * 100}`).join(' '));
    const valid = CropGeometry.isValidQuad(session.quad);
    ui.apply.disabled = !valid;
    ui.hint.textContent = valid ? DEFAULT_HINT : INVALID_HINT;
    ui.hint.classList.toggle('crop-hint-error', !valid);
  }

  function onModalKeydown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = [...ui.modal.querySelectorAll('button:not([disabled])')].filter((el) => el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function apply() {
    if (!session || !CropGeometry.isValidQuad(session.quad)) return;
    const { quad, onApply } = session;
    close();
    if (onApply) onApply(copy(quad));
  }

  function close() {
    if (!ui || !session) return;
    const opener = session.opener;
    session = null;
    ui.modal.classList.remove('active');
    ui.loupe.classList.remove('visible');
    document.body.style.overflow = '';
    if (opener && typeof opener.focus === 'function') opener.focus();
  }

  /**
   * open({ imageUrl, quad, canRemove, onApply(quad), onRemove() })
   * Starts from `quad`, else a 10% inset.
   */
  function open(options) {
    build();
    const start = copy(options.quad || INSET_QUAD);
    session = { quad: copy(start), start, onApply: options.onApply, onRemove: options.onRemove, dragging: null, opener: document.activeElement };
    ui.remove.style.display = options.canRemove ? '' : 'none';
    ui.image.onload = () => render();
    ui.image.src = options.imageUrl;
    ui.modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    render();
    ui.handles[0].focus();
  }

  window.CropEditor = { open, close, isOpen: () => !!session };
}());
