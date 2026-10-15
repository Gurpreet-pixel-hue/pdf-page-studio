/**
 * PDF Page Studio - Core Application Logic
 * Pure client-side PDF and Image assembly, visual reordering, and generation engine.
 */

// Initialize PDF.js Worker Configuration safely
if (typeof pdfjsLib !== 'undefined') {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  } catch (err) {
    console.warn('PDF.js worker setup fallback:', err);
  }
}

// Global State
const state = {
  pages: [], // Array of PageItem
  fileCounter: 0,
  draggedIndex: null,
  draggedDocIndex: null,
  viewMode: 'documents', // 'documents' (one card per source file) | 'pages' (one card per page)
  activeLightboxIndex: null,
  settings: {
    filename: 'Merged_Document.pdf',
    pageSize: 'a4', // 'a4' | 'original' | 'letter'
    orientation: 'auto', // 'auto' | 'portrait' | 'landscape'
    margin: 0, // points
    quality: 1.0, // 1.0 (lossless) or 0.85 (compressed)
    stampPageNumbers: false, // USP 2: Automatic page numbering
    stampFormat: 'full', // 'full' (Page 1 of N) or 'simple' (1 / N)
    enhanceScans: false // USP 3: Document Scan Enhancer (B&W Photocopy)
  }
};

const ASSET_VERSION = '2.8.0';
const WORKING_MAX_EDGE = 2000;      // longest side of the in-memory working copy
const MAX_EXPORT_PIXELS = 12000000; // canvas area cap: iOS Safari limits canvas size
const CARD_THUMB_EDGE = 520;        // longest side of the small thumbnail shown on grid cards
const INGEST_CONCURRENCY = 1;       // photos decoded at once. 2 gave no speed-up in desktop timing and doubles peak memory (an 18 MP photo decodes to ~70 MB), so it stays 1 until measured on a phone

// DOM Element Cache
const elements = {
  fileInput: document.getElementById('file-input'),
  cameraInput: document.getElementById('camera-input'),
  dropZoneOverlay: document.getElementById('global-drop-zone'),
  emptyState: document.getElementById('empty-state'),
  pageGridContainer: document.getElementById('page-grid-container'),
  pageGrid: document.getElementById('page-grid'),
  statPageCount: document.getElementById('stat-page-count'),
  statFileCount: document.getElementById('stat-file-count'),
  clearAllBtn: document.getElementById('clear-all-btn'),
  viewDocsBtn: document.getElementById('view-docs-btn'),
  viewPagesBtn: document.getElementById('view-pages-btn'),
  gridInstructionText: document.getElementById('grid-instruction-text'),
  autoCropBtn: document.getElementById('auto-crop-btn'),
  autoCropLabel: document.getElementById('auto-crop-label'),
  exportPdfBtn: document.getElementById('export-pdf-btn'),
  exportBtnText: document.getElementById('export-btn-text'),
  
  // Mobile Sticky Bottom Dock
  mobileSortBtn: document.getElementById('mobile-sort-btn'),
  mobileOptionsBtn: document.getElementById('mobile-options-btn'),
  mobileExportBtn: document.getElementById('mobile-export-btn'),

  // Sort Dropdown
  sortMenuBtn: document.getElementById('sort-menu-btn'),
  sortDropdown: document.getElementById('sort-dropdown'),
  sortUploadOrder: document.getElementById('sort-upload-order'),
  sortNameAsc: document.getElementById('sort-name-asc'),
  sortNameDesc: document.getElementById('sort-name-desc'),
  sortReverse: document.getElementById('sort-reverse'),

  // Settings Drawer
  settingsToggleBtn: document.getElementById('settings-toggle-btn'),
  settingsDrawer: document.getElementById('settings-drawer'),
  settingsBackdrop: document.getElementById('settings-backdrop'),
  settingsCloseBtn: document.getElementById('settings-close-btn'),
  settingsApplyBtn: document.getElementById('settings-apply-btn'),
  settingFilename: document.getElementById('setting-filename'),

  // USP 2 & 3 Controls
  settingStampPages: document.getElementById('setting-stamp-pages'),
  watermarkOptions: document.getElementById('watermark-options'),
  settingEnhanceScans: document.getElementById('setting-enhance-scans'),

  // Lightbox Modal
  lightboxModal: document.getElementById('lightbox-modal'),
  lightboxOverlay: document.getElementById('lightbox-overlay'),
  lightboxCloseBtn: document.getElementById('lightbox-close-btn'),
  lightboxImage: document.getElementById('lightbox-image'),
  lightboxPageBadge: document.getElementById('lightbox-page-badge'),
  lightboxFilename: document.getElementById('lightbox-filename'),
  lightboxMeta: document.getElementById('lightbox-meta'),
  lightboxPrevBtn: document.getElementById('lightbox-prev-btn'),
  lightboxNextBtn: document.getElementById('lightbox-next-btn'),

  // Processing Progress Modal
  processingModal: document.getElementById('processing-modal'),
  processingTitle: document.getElementById('processing-title'),
  processingStatus: document.getElementById('processing-status'),
  progressBarFill: document.getElementById('progress-bar-fill'),

  // Install & App Icon Modal
  btnInstallApp: document.getElementById('btn-install-app'),
  drawerInstallBtn: document.getElementById('drawer-install-btn'),
  installModal: document.getElementById('install-modal'),
  installCloseBtn: document.getElementById('install-close-btn'),
  installModalBackdrop: document.getElementById('install-modal-backdrop'),
  btnDownloadMacShortcut: document.getElementById('btn-download-mac-shortcut'),
  btnTriggerPwaInstall: document.getElementById('btn-trigger-pwa-install'),

  // Toast Container
  toastContainer: document.getElementById('toast-container')
};

/**
 * Unique ID generator
 */
function generateId() {
  return 'page_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
}

/**
 * Toast Notification Dispatcher
 */
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  elements.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.2s ease';
    setTimeout(() => toast.remove(), 200);
  }, 3200);
}

/* ==========================================================================
   File Ingestion & Parsing (Images & PDFs)
   ========================================================================== */

/**
 * Encode a canvas to a blob: URL. Much cheaper than toDataURL (no base64 string
 * to build, hold in memory and re-parse on every render). Falls back to a data
 * URL if the browser cannot make a blob.
 */
function canvasToObjectUrl(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : canvas.toDataURL(type, quality)), type, quality);
  });
}

/** Free the blob URLs of pages that are gone (data URLs and shared URLs are ignored safely). */
function releasePageUrls(items) {
  const urls = new Set();
  items.forEach((item) => [item.thumbnailDataUrl, item.cardThumbUrl, item.previewUrl].forEach((u) => { if (typeof u === 'string' && u.startsWith('blob:')) urls.add(u); }));
  urls.forEach((u) => URL.revokeObjectURL(u));
}

/**
 * Decode an image from a URL. Browsers apply EXIF orientation here, so
 * naturalWidth/naturalHeight describe the upright photo.
 */
function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image'));
    img.src = url;
  });
}

/** Decode a Blob. Call revoke() once the element is no longer needed. */
async function loadImageElement(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImageFromUrl(url);
    return { img, revoke: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/**
 * Ingest multiple files selected via file input or drag-drop
 */
async function handleFiles(fileList) {
  if (!fileList || fileList.length === 0) return;

  const files = Array.from(fileList);
  showProcessingModal('Ingesting Files', `Processing ${files.length} source file(s)...`, 10);

  // Pages for each file, kept by position so the upload order survives files finishing out of order.
  const results = new Array(files.length).fill(null);
  let nextFile = 0;
  let finished = 0;

  async function ingestOne(file) {
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) return parsePdfFile(file);
    if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name)) return [await parseImageFile(file)];
    console.warn('Unsupported file format:', file.name);
    return [];
  }

  async function worker() {
    while (nextFile < files.length) {
      const index = nextFile++;
      const file = files[index];
      updateProcessingProgress(`Reading ${file.name} (${Math.min(finished + 1, files.length)} of ${files.length})...`, 10 + Math.round((finished / files.length) * 80));
      try {
        results[index] = await ingestOne(file);
      } catch (err) {
        console.error('Error processing file:', file.name, err);
        showToast(err.userMessage || `Failed to parse ${file.name}`, 'error');
      }
      finished++;
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(INGEST_CONCURRENCY, files.length) }, worker));
  } finally {
    hideProcessingModal();
  }

  let addedCount = 0;
  results.forEach((pages) => {
    (pages || []).forEach((page) => {
      page.originalIndex = state.fileCounter++;
      state.pages.push(page);
      addedCount++;
    });
  });

  if (addedCount > 0) {
    renderPageGrid();
    showToast(`Added ${addedCount} page(s) successfully.`);
  }
}

/**
 * Extract pages from PDF using PDF.js and render thumbnails
 */
async function parsePdfFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;
  const pageItems = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.2 });
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: ctx,
      viewport: viewport
    }).promise;

    const thumbnailDataUrl = await canvasToObjectUrl(canvas, 'image/jpeg', 0.85);

    const originalViewport = page.getViewport({ scale: 1.0 });

    pageItems.push({
      id: generateId(),
      sourceType: 'pdf',
      sourceFile: file,
      fileName: file.name,
      sourcePageIndex: pageNum - 1, // 0-based
      sourceTotalPages: numPages,
      originalIndex: 0, // assigned in upload order by handleFiles
      thumbnailDataUrl: thumbnailDataUrl, // a blob: URL
      rotation: 0,
      width: originalViewport.width,
      height: originalViewport.height
    });
  }

  return pageItems;
}

/**
 * Load an image file: normalise orientation, and build a
 * working copy (long edge <= WORKING_MAX_EDGE) for thumbnails and detection.
 * The full-resolution Blob is kept for export.
 */
async function parseImageFile(file) {
  if (ImageNormalize.isHeicLike(file)) {
    // iOS Safari converts HEIC to JPEG when a photo is picked, so HEIC only arrives via drag-and-drop.
    throw Object.assign(new Error('HEIC is not supported in this browser'), {
      userMessage: `${file.name}: HEIC photos can't be opened here. Pick the photo from your phone's gallery (it converts to JPEG) or convert it to JPEG first.`
    });
  }
  const blob = file;
  const jpegOrientation = ImageNormalize.readJpegOrientation(await blob.slice(0, 131072).arrayBuffer());
  const { img, revoke } = await loadImageElement(blob);

  try {
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (!width || !height) throw new Error('Image has no pixels: ' + file.name);

    const work = ImageNormalize.fitWithin(width, height, WORKING_MAX_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = work.width;
    canvas.height = work.height;
    const ctx = canvas.getContext('2d');
    const keepsAlpha = /image\/(png|webp|gif)/.test(blob.type);
    if (!keepsAlpha) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, work.width, work.height);
    }
    ctx.drawImage(img, 0, 0, work.width, work.height);

    const type = keepsAlpha ? 'image/png' : 'image/jpeg';
    const thumbnailDataUrl = await canvasToObjectUrl(canvas, type, 0.9); // a blob: URL (name kept for existing callers)
    let cardThumbUrl = thumbnailDataUrl;
    if (Math.max(work.width, work.height) > CARD_THUMB_EDGE) {
      const small = ImageNormalize.fitWithin(work.width, work.height, CARD_THUMB_EDGE);
      const smallCanvas = document.createElement('canvas');
      smallCanvas.width = small.width;
      smallCanvas.height = small.height;
      const smallCtx = smallCanvas.getContext('2d');
      smallCtx.imageSmoothingQuality = 'high';
      smallCtx.drawImage(canvas, 0, 0, small.width, small.height);
      cardThumbUrl = await canvasToObjectUrl(smallCanvas, type, 0.85);
    }

    return {
      id: generateId(),
      sourceType: 'image',
      sourceFile: file,
      fullBlob: blob,
      fileName: file.name,
      sourcePageIndex: 0,
      sourceTotalPages: 1,
      originalIndex: 0, // assigned in upload order by handleFiles
      thumbnailDataUrl,
      cardThumbUrl,
      previewUrl: null,
      rotation: 0,
      width,
      height,
      jpegOrientation,
      cropQuad: null,
      cropState: 'none',
      cropConfidence: 0
    };
  } finally {
    revoke();
  }
}

/* ==========================================================================
   Grid Rendering & DOM Synchronization
   ========================================================================== */

/**
 * Synchronize the grid with state.pages
 */
/* ---- Grid rendering: keep what the user already sees --------------------------------
   Every edit re-renders the grid. Rebuilding every card from scratch made each move
   look like a page reload: all cards replayed their entrance animation, every image
   was re-decoded (blank flash) and the scroll position could jump. So a render keeps
   the thumbnail elements it already has, animates in only cards it has never shown,
   glides moved cards to their new place (FLIP), and restores the scroll position. */

const thumbCache = new Map();   // card key -> { img, src }: decoded thumbnail elements, reused across renders
let shownKeys = new Set();      // card keys currently on screen
let shownView = null;           // view the keys belong to

const prefersReducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

function getScrollParent(el) {
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return node;
  }
  return document.scrollingElement || document.documentElement;
}

/** Swap a freshly built card's thumbnail for the one already decoded for that card, when it shows the same image. */
function adoptThumbnail(card, key) {
  const fresh = card.querySelector('img.card-thumbnail');
  if (!fresh) return;
  const src = fresh.getAttribute('src');
  const hit = thumbCache.get(key);
  if (hit && hit.src === src) {
    hit.img.alt = fresh.alt;
    hit.img.style.transform = fresh.style.transform;
    fresh.replaceWith(hit.img);
  } else {
    thumbCache.set(key, { img: fresh, src });
  }
}

function renderPageGrid() {
  const totalPages = state.pages.length;
  elements.statPageCount.textContent = totalPages;

  // Calculate unique source files
  const uniqueFiles = new Set(state.pages.map(p => p.fileName));
  elements.statFileCount.textContent = `${uniqueFiles.size} file${uniqueFiles.size === 1 ? '' : 's'}`;
  syncAutoCropButton();

  // Toggle View Containers
  if (totalPages === 0) {
    elements.emptyState.style.display = 'flex';
    elements.pageGridContainer.style.display = 'none';
    elements.exportPdfBtn.disabled = true;
    thumbCache.clear();
    shownKeys = new Set();
    return;
  }

  elements.emptyState.style.display = 'none';
  elements.pageGridContainer.style.display = 'flex';
  elements.exportPdfBtn.disabled = false;

  syncViewToggle();

  const grid = elements.pageGrid;
  const view = state.viewMode;
  const sameView = view === shownView;

  // Where everything is now, and where the user is scrolled to.
  const scroller = getScrollParent(grid);
  const scrollTop = scroller.scrollTop;
  const firstRects = new Map();
  if (sameView) {
    [...grid.children].forEach((card) => { if (card.dataset.key) firstRects.set(card.dataset.key, card.getBoundingClientRect()); });
  }
  grid.style.minHeight = `${grid.offsetHeight}px`; // an emptied grid must not collapse and clamp the scroll position

  grid.innerHTML = '';
  const cards = [];
  if (view === 'documents') {
    const documents = DocGroups.groupPagesIntoDocuments(state.pages);
    documents.forEach((doc, docIndex) => {
      const card = createDocumentCardElement(doc, docIndex, documents.length);
      card.dataset.key = `d:${doc.firstPage.id}`;
      cards.push(card);
    });
  } else {
    state.pages.forEach((pageItem, index) => {
      const card = createPageCardElement(pageItem, index, totalPages);
      card.dataset.key = `p:${pageItem.id}`;
      cards.push(card);
    });
  }

  const keys = new Set(cards.map((card) => card.dataset.key));
  let entering = 0;
  cards.forEach((card) => {
    const key = card.dataset.key;
    adoptThumbnail(card, key);
    if (sameView && shownKeys.has(key)) {
      card.style.animation = 'none'; // already on screen: no entrance animation
    } else {
      card.style.animationDelay = `${Math.min(entering++ * 35, 450)}ms`;
    }
    grid.appendChild(card);
  });
  for (const key of [...thumbCache.keys()]) if (!keys.has(key)) thumbCache.delete(key);
  shownKeys = keys;
  shownView = view;

  grid.style.minHeight = '';
  scroller.scrollTop = scrollTop;

  // Glide cards that changed place from where they were to where they are.
  if (sameView && !prefersReducedMotion()) {
    cards.forEach((card) => {
      const before = firstRects.get(card.dataset.key);
      if (!before) return;
      const after = card.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      card.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration: 280, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
      );
    });
  }
}

/* ==========================================================================
   Crop: thumbnails, badges, editor wiring
   ========================================================================== */

const CROP_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"></path><path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"></path></svg>`;
const PREVIEW_MAX_PIXELS = 1200000;

/** The image to show for a page: the cropped preview when there is one. */
function pageThumbSrc(item) {
  return item.previewUrl || item.cardThumbUrl || item.thumbnailDataUrl;
}

/** The large image to show when a page is opened full size. */
function pageFullSrc(item) {
  return item.previewUrl || item.thumbnailDataUrl;
}

function cropBadgeHtml(item) {
  if (!CropState.isCroppable(item)) return '';
  if (item.cropState === 'auto') return '<span class="crop-badge auto" title="Cropped automatically">Auto</span>';
  if (item.cropState === 'manual') return '<span class="crop-badge manual" title="Cropped by you">Manual</span>';
  if (item.cropState === 'needs-review') return '<span class="crop-badge review" title="Edges unclear: check this page">Review</span>';
  return '';
}

function cropButtonHtml(item) {
  return CropState.isCroppable(item)
    ? `<button class="action-icon-btn crop-btn" title="Crop this page">${CROP_ICON}</button>`
    : '';
}

/** Rebuild the small cropped preview shown on cards and in the lightbox. */
async function refreshCropPreview(item) {
  if (!item.cropQuad || !CropGeometry.isValidQuad(item.cropQuad)) {
    releasePageUrls([{ previewUrl: item.previewUrl }]);
    item.previewUrl = null;
    return;
  }
  const img = await loadImageFromUrl(item.thumbnailDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const quadPx = item.cropQuad.map(([x, y]) => [x * canvas.width, y * canvas.height]);
  const natural = CropGeometry.quadOutputSize(quadPx);
  const size = CropGeometry.capPixels(natural.width, natural.height, PREVIEW_MAX_PIXELS);
  const warped = CropGeometry.warpPerspective(ctx.getImageData(0, 0, canvas.width, canvas.height), quadPx, size.width, size.height);
  const out = document.createElement('canvas');
  out.width = warped.width;
  out.height = warped.height;
  out.getContext('2d').putImageData(new ImageData(warped.data, warped.width, warped.height), 0, 0);
  const previous = item.previewUrl;
  item.previewUrl = await canvasToObjectUrl(out, 'image/jpeg', 0.85);
  if (previous) releasePageUrls([{ previewUrl: previous }]);
}

function openCropEditor(index) {
  const item = state.pages[index];
  if (!item || !CropState.isCroppable(item)) return;
  CropEditor.open({
    imageUrl: item.thumbnailDataUrl,
    quad: item.cropQuad,
    canRemove: !!item.cropQuad,
    onApply: async (quad) => {
      CropState.applyManualCrop(item, quad);
      await refreshCropPreview(item);
      renderPageGrid();
      showToast('Crop applied.');
    },
    onRemove: () => {
      CropState.resetCrop(item);
      releasePageUrls([{ previewUrl: item.previewUrl }]);
      item.previewUrl = null;
      renderPageGrid();
      showToast('Crop removed.');
    }
  });
}

/* ==========================================================================
   Documents View (one card per source file)
   ========================================================================== */

function syncViewToggle() {
  const docsMode = state.viewMode === 'documents';
  elements.viewDocsBtn.classList.toggle('active', docsMode);
  elements.viewDocsBtn.setAttribute('aria-pressed', String(docsMode));
  elements.viewPagesBtn.classList.toggle('active', !docsMode);
  elements.viewPagesBtn.setAttribute('aria-pressed', String(!docsMode));
  elements.pageGrid.classList.toggle('is-documents', docsMode);
  elements.gridInstructionText.textContent = docsMode
    ? 'Drag or tap arrows to reorder whole documents'
    : 'Drag or tap arrows to reorder • Numbers update in real-time';
}

function setViewMode(mode) {
  if (state.viewMode === mode) return;
  state.viewMode = mode;
  renderPageGrid();
}

/**
 * Switch to the page view and bring the first page of a document into view
 */
function showDocumentPages(startIndex) {
  state.viewMode = 'pages';
  renderPageGrid();
  const card = elements.pageGrid.querySelector(`.page-card[data-index="${startIndex}"]`);
  if (!card) return;
  card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  card.classList.add('flash');
  setTimeout(() => card.classList.remove('flash'), 1400);
}

function createDocumentCardElement(doc, docIndex, totalDocs) {
  const card = document.createElement('div');
  card.className = 'page-card doc-card';
  card.dataset.docIndex = docIndex;
  card.draggable = true;
  card.style.animationDelay = `${Math.min(docIndex * 35, 450)}ms`;

  const first = doc.firstPage;
  const typeLabel = doc.sourceType === 'pdf' ? 'PDF' : 'IMAGE';
  const pagesWord = doc.count === 1 ? 'page' : 'pages';
  const hasMany = doc.count > 1;
  const croppable = doc.count === 1 && CropState.isCroppable(first);
  // The thumbnail badge already shows the page count; the meta line only adds what it can't
  const detail = doc.partial
    ? doc.rangeLabel
    : (doc.sourceType === 'pdf' ? 'All pages' : `${Math.round(first.width)} × ${Math.round(first.height)} px`);

  card.innerHTML = `
    <div class="card-header">
      <span class="page-number-tag">DOC ${docIndex + 1}</span>
      <span class="header-tags">
        ${croppable ? cropBadgeHtml(first) : ''}
        <span class="source-type-tag">${typeLabel}</span>
      </span>
    </div>

    <div class="card-thumbnail-viewport doc-stack ${hasMany ? 'has-stack' : ''}">
      <img src="${pageThumbSrc(first)}"
           alt="First page of ${escapeHtml(doc.fileName)}"
           class="card-thumbnail"
           style="transform: rotate(${first.rotation}deg);"
           loading="lazy">
      <span class="doc-count-badge">${doc.count} ${pagesWord}</span>
    </div>

    <div class="card-meta">
      <div class="card-filename" title="${escapeHtml(doc.fileName)}">${escapeHtml(doc.fileName)}</div>
      <div class="card-dimensions">${detail}</div>
    </div>

    <div class="card-actions">
      <button class="action-icon-btn view-pages-btn" title="View pages of this document">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="7"></rect>
          <rect x="14" y="3" width="7" height="7"></rect>
          <rect x="3" y="14" width="7" height="7"></rect>
          <rect x="14" y="14" width="7" height="7"></rect>
        </svg>
      </button>

      ${croppable ? cropButtonHtml(first) : ''}

      ${hasMany ? `<button class="action-icon-btn split-btn" title="Split this document into two parts">${SPLIT_ICON}</button>` : ''}
      ${doc.canJoinNext ? `<button class="action-icon-btn join-btn" title="Join with the next part">${JOIN_ICON}</button>` : ''}

      <button class="action-icon-btn move-left-btn" title="Move document earlier" ${docIndex === 0 ? 'disabled style="opacity:0.3;cursor:default;"' : ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </button>

      <button class="action-icon-btn move-right-btn" title="Move document later" ${docIndex === totalDocs - 1 ? 'disabled style="opacity:0.3;cursor:default;"' : ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </button>

      <button class="action-icon-btn danger-btn delete-btn" title="Remove this document">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  `;

  card.querySelector('.card-thumbnail-viewport').addEventListener('click', () => showDocumentPages(doc.start));

  card.querySelector('.view-pages-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    showDocumentPages(doc.start);
  });

  const docCropBtn = card.querySelector('.crop-btn');
  if (docCropBtn) {
    docCropBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openCropEditor(doc.start);
    });
  }

  const splitBtn = card.querySelector('.split-btn');
  if (splitBtn) {
    splitBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSplitDialog(docIndex);
    });
  }

  const joinBtn = card.querySelector('.join-btn');
  if (joinBtn) {
    joinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      joinDocumentParts(docIndex);
    });
  }

  card.querySelector('.move-left-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (docIndex > 0) reorderDocument(docIndex, docIndex - 1);
  });

  card.querySelector('.move-right-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (docIndex < totalDocs - 1) reorderDocument(docIndex, docIndex + 1);
  });

  card.querySelector('.delete-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    removeDocumentAt(docIndex, doc);
  });

  setupDocCardDragEvents(card, docIndex);
  return card;
}

const SPLIT_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><line x1="20" y1="4" x2="8.12" y2="15.88"></line><line x1="14.47" y1="14.48" x2="20" y2="20"></line><line x1="8.12" y1="8.12" x2="12" y2="12"></line></svg>';
const JOIN_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"></circle><circle cx="6" cy="6" r="3"></circle><path d="M6 21V9a9 9 0 0 0 9 9"></path></svg>';

/** Ask where to cut a multi-page document, then split it into two parts that move independently. */
function openSplitDialog(docIndex) {
  const doc = DocGroups.groupPagesIntoDocuments(state.pages)[docIndex];
  if (!doc || doc.count < 2) return;
  const pages = state.pages.slice(doc.start, doc.end);
  SplitDialog.open({
    title: `Split ${doc.fileName}`,
    pages,
    preview: (sizes) => DocGroups.groupPagesIntoDocuments(DocGroups.splitDocumentInto(pages, 0, sizes)).map((part) => part.rangeLabel),
    onApply: (sizes) => {
      state.pages = DocGroups.splitDocumentInto(state.pages, docIndex, sizes);
      renderPageGrid();
      showToast(sizes.length === 2
        ? `Split ${doc.fileName} after page ${sizes[0]}. Move each part on its own.`
        : `Split ${doc.fileName} into ${sizes.length} parts. Move each part on its own.`);
    }
  });
}

/** Put a part back together with the part that continues it. */
function joinDocumentParts(docIndex) {
  const before = DocGroups.groupPagesIntoDocuments(state.pages)[docIndex];
  state.pages = DocGroups.joinDocuments(state.pages, docIndex);
  renderPageGrid();
  if (before) showToast(`Joined the parts of ${before.fileName}`);
}

function reorderDocument(fromIndex, toIndex) {
  state.pages = DocGroups.moveDocument(state.pages, fromIndex, toIndex);
  renderPageGrid();
  showToast(`Moved Document ${fromIndex + 1} to position ${toIndex + 1}`);
}

function removeDocumentAt(docIndex, doc) {
  if (doc.count > 1 && !confirm(`Remove "${doc.fileName}" (${doc.count} pages)?`)) return;
  releasePageUrls(state.pages.slice(doc.start, doc.end));
  state.pages = DocGroups.removeDocument(state.pages, docIndex);
  renderPageGrid();
  showToast(`Removed ${doc.fileName}`);
}

function setupDocCardDragEvents(card, docIndex) {
  card.addEventListener('dragstart', (e) => {
    state.draggedDocIndex = docIndex;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', docIndex);
  });

  card.addEventListener('dragend', () => {
    state.draggedDocIndex = null;
    card.classList.remove('dragging');
    clearAllDragOverClasses();
  });

  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (state.draggedDocIndex === null || state.draggedDocIndex === docIndex) return;

    const rect = card.getBoundingClientRect();
    clearAllDragOverClasses();
    card.classList.add(e.clientX < rect.left + rect.width / 2 ? 'drag-over-left' : 'drag-over-right');
  });

  card.addEventListener('dragleave', () => {
    card.classList.remove('drag-over-left', 'drag-over-right');
  });

  card.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearAllDragOverClasses();

    const fromIndex = state.draggedDocIndex;
    if (fromIndex === null || fromIndex === docIndex) return;
    reorderDocument(fromIndex, docIndex);
  });
}

/**
 * Construct individual page card HTML element with full event listeners
 */
function createPageCardElement(pageItem, index, totalPages) {
  const card = document.createElement('div');
  card.className = 'page-card';
  card.dataset.id = pageItem.id;
  card.dataset.index = index;
  card.draggable = true;
  card.style.animationDelay = `${Math.min(index * 35, 450)}ms`;

  // Source descriptor label
  const sourceLabel = pageItem.sourceType === 'pdf'
    ? `PDF (p. ${pageItem.sourcePageIndex + 1}/${pageItem.sourceTotalPages})`
    : 'IMAGE';

  card.innerHTML = `
    <div class="card-header">
      <span class="page-number-tag">PAGE ${index + 1}</span>
      <span class="header-tags">
        ${cropBadgeHtml(pageItem)}
        <span class="source-type-tag" title="${escapeHtml(pageItem.fileName)}">${sourceLabel}</span>
      </span>
    </div>

    <div class="card-thumbnail-viewport">
      <img src="${pageThumbSrc(pageItem)}" 
           alt="Page ${index + 1}" 
           class="card-thumbnail" 
           style="transform: rotate(${pageItem.rotation}deg);" 
           loading="lazy">
      <div class="card-zoom-overlay">
        <span class="card-zoom-btn">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          Zoom
        </span>
      </div>
    </div>

    <div class="card-meta">
      <div class="card-filename" title="${escapeHtml(pageItem.fileName)}">${escapeHtml(pageItem.fileName)}</div>
      <div class="card-dimensions">${Math.round(pageItem.width)} × ${Math.round(pageItem.height)} px</div>
    </div>

    <div class="card-actions">
      <button class="action-icon-btn rotate-ccw-btn" title="Rotate 90° Counter-Clockwise">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
          <path d="M3 3v5h5"></path>
        </svg>
      </button>

      <button class="action-icon-btn rotate-cw-btn" title="Rotate 90° Clockwise">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
          <path d="M21 3v5h-5"></path>
        </svg>
      </button>

      <button class="action-icon-btn move-left-btn" title="Move Left (Page ${index})" ${index === 0 ? 'disabled style="opacity:0.3;cursor:default;"' : ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </button>

      <button class="action-icon-btn move-right-btn" title="Move Right (Page ${index + 2})" ${index === totalPages - 1 ? 'disabled style="opacity:0.3;cursor:default;"' : ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </button>

      ${cropButtonHtml(pageItem)}

      <button class="action-icon-btn danger-btn delete-btn" title="Remove this page">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  `;

  // Attach Action Button Handlers
  const viewport = card.querySelector('.card-thumbnail-viewport');
  const rotateCcwBtn = card.querySelector('.rotate-ccw-btn');
  const rotateCwBtn = card.querySelector('.rotate-cw-btn');
  const moveLeftBtn = card.querySelector('.move-left-btn');
  const moveRightBtn = card.querySelector('.move-right-btn');
  const deleteBtn = card.querySelector('.delete-btn');
  const cropBtn = card.querySelector('.crop-btn');
  if (cropBtn) {
    cropBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openCropEditor(index);
    });
  }

  // Zoom / Lightbox
  viewport.addEventListener('click', () => openLightbox(index));

  // Rotate Counter-Clockwise
  rotateCcwBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    pageItem.rotation = (pageItem.rotation + 270) % 360;
    const thumb = card.querySelector('.card-thumbnail');
    thumb.style.transform = `rotate(${pageItem.rotation}deg)`;
  });

  // Rotate Clockwise
  rotateCwBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    pageItem.rotation = (pageItem.rotation + 90) % 360;
    const thumb = card.querySelector('.card-thumbnail');
    thumb.style.transform = `rotate(${pageItem.rotation}deg)`;
  });

  // Move Left
  moveLeftBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (index > 0) {
      swapPages(index, index - 1);
    }
  });

  // Move Right
  moveRightBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (index < state.pages.length - 1) {
      swapPages(index, index + 1);
    }
  });

  // Delete Page
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    removePage(index);
  });

  // Drag and Drop Events
  setupCardDragEvents(card, index);

  return card;
}

/**
 * HTML Escaper helper
 */
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
}

/* ==========================================================================
   Drag & Drop Grid Reordering Logic
   ========================================================================== */

function setupCardDragEvents(card, index) {
  card.addEventListener('dragstart', (e) => {
    state.draggedIndex = index;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index);
  });

  card.addEventListener('dragend', () => {
    state.draggedIndex = null;
    card.classList.remove('dragging');
    clearAllDragOverClasses();
  });

  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (state.draggedIndex === null || state.draggedIndex === index) return;

    const rect = card.getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;

    clearAllDragOverClasses();
    if (e.clientX < midpoint) {
      card.classList.add('drag-over-left');
    } else {
      card.classList.add('drag-over-right');
    }
  });

  card.addEventListener('dragleave', () => {
    card.classList.remove('drag-over-left', 'drag-over-right');
  });

  card.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearAllDragOverClasses();

    const fromIndex = state.draggedIndex;
    if (fromIndex === null || fromIndex === index) return;

    const rect = card.getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    let targetIndex = index;

    if (e.clientX >= midpoint && fromIndex < index) {
      // dropped on right half and coming from left
      targetIndex = index;
    } else if (e.clientX < midpoint && fromIndex > index) {
      // dropped on left half and coming from right
      targetIndex = index;
    }

    reorderPage(fromIndex, targetIndex);
  });
}

function clearAllDragOverClasses() {
  document.querySelectorAll('.page-card').forEach(c => {
    c.classList.remove('drag-over-left', 'drag-over-right');
  });
}

/**
 * Reorder page from one index to target index
 */
function reorderPage(fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
  state.pages = DocGroups.movePage(state.pages, fromIndex, toIndex);
  renderPageGrid();
  showToast(`Moved Page ${fromIndex + 1} to Page ${toIndex + 1}`);
}

/**
 * Swap two adjacent pages
 */
function swapPages(indexA, indexB) {
  state.pages = DocGroups.movePage(state.pages, indexA, indexB);
  renderPageGrid();
}

/**
 * Remove an individual page
 */
function removePage(index) {
  if (state.pages[index]) releasePageUrls([state.pages[index]]);
  state.pages = DocGroups.removePage(state.pages, index);
  renderPageGrid();
  showToast(`Removed Page ${index + 1}`);
}

/**
 * Clear all pages
 */
/**
 * Start over from the title: confirm if pages would be lost, refetch the
 * page's own scripts and styles past the HTTP cache, then reload from a
 * one-off address so the HTML is fresh too. (The site keeps no service worker
 * or Cache Storage of its own, and the origin is shared with other projects,
 * so those are left alone.) A failed or slow refetch never blocks the reload.
 */
async function startOver({ confirmFn = window.confirm.bind(window), fetchFn = window.fetch.bind(window), reload = (url) => window.location.replace(url) } = {}) {
  if (state.pages.length > 0 && !confirmFn('Start over? This clears all uploaded pages and reloads the site.')) return;
  const assets = [...document.querySelectorAll('script[src], link[rel="stylesheet"][href], link[rel="manifest"][href]')]
    .map((el) => el.src || el.href);
  const refetch = Promise.allSettled(assets.map((url) => fetchFn(url, { cache: 'reload' })));
  await Promise.race([refetch, new Promise((resolve) => setTimeout(resolve, 4000))]);
  const target = new URL(window.location.href);
  target.search = `?fresh=${Date.now()}`;
  target.hash = '';
  reload(target.href);
}

function clearAll() {
  if (state.pages.length === 0) return;
  if (confirm('Are you sure you want to remove all uploaded pages?')) {
    releasePageUrls(state.pages);
    state.pages = [];
    state.fileCounter = 0;
    renderPageGrid();
    showToast('All pages cleared.');
  }
}

/* ==========================================================================
   Sorting Operations
   ========================================================================== */

function setupSortingListeners() {
  elements.sortMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    elements.sortDropdown.classList.toggle('active');
  });

  document.addEventListener('click', () => {
    elements.sortDropdown.classList.remove('active');
  });

  // Reset to sequential upload order
  elements.sortUploadOrder.addEventListener('click', () => {
    state.pages.sort((a, b) => a.originalIndex - b.originalIndex);
    renderPageGrid();
    showToast('Reset to original upload order.');
  });

  // Sort by filename A to Z
  elements.sortNameAsc.addEventListener('click', () => {
    state.pages.sort((a, b) => {
      const nameCompare = a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' });
      if (nameCompare !== 0) return nameCompare;
      return a.sourcePageIndex - b.sourcePageIndex;
    });
    renderPageGrid();
    showToast('Sorted by filename (A to Z).');
  });

  // Sort by filename Z to A
  elements.sortNameDesc.addEventListener('click', () => {
    state.pages.sort((a, b) => {
      const nameCompare = b.fileName.localeCompare(a.fileName, undefined, { numeric: true, sensitivity: 'base' });
      if (nameCompare !== 0) return nameCompare;
      return b.sourcePageIndex - a.sourcePageIndex;
    });
    renderPageGrid();
    showToast('Sorted by filename (Z to A).');
  });

  // Reverse current order
  elements.sortReverse.addEventListener('click', () => {
    state.pages.reverse();
    renderPageGrid();
    showToast('Reversed page order.');
  });
}

/* ==========================================================================
   Lightbox / Full-Res Inspection Modal
   ========================================================================== */

function openLightbox(index) {
  if (index < 0 || index >= state.pages.length) return;
  state.activeLightboxIndex = index;
  const item = state.pages[index];

  elements.lightboxPageBadge.textContent = `PAGE ${index + 1} OF ${state.pages.length}`;
  elements.lightboxFilename.textContent = item.fileName;
  elements.lightboxMeta.textContent = `${Math.round(item.width)} × ${Math.round(item.height)} px • Rotation: ${item.rotation}°`;
  elements.lightboxImage.src = pageFullSrc(item);
  elements.lightboxImage.style.transform = `rotate(${item.rotation}deg)`;

  elements.lightboxPrevBtn.disabled = index === 0;
  elements.lightboxNextBtn.disabled = index === state.pages.length - 1;

  elements.lightboxModal.classList.add('active');
}

function closeLightbox() {
  elements.lightboxModal.classList.remove('active');
  state.activeLightboxIndex = null;
}

function setupLightboxListeners() {
  elements.lightboxCloseBtn.addEventListener('click', closeLightbox);
  elements.lightboxOverlay.addEventListener('click', closeLightbox);

  elements.lightboxPrevBtn.addEventListener('click', () => {
    if (state.activeLightboxIndex > 0) {
      openLightbox(state.activeLightboxIndex - 1);
    }
  });

  elements.lightboxNextBtn.addEventListener('click', () => {
    if (state.activeLightboxIndex < state.pages.length - 1) {
      openLightbox(state.activeLightboxIndex + 1);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!elements.lightboxModal.classList.contains('active')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft' && state.activeLightboxIndex > 0) openLightbox(state.activeLightboxIndex - 1);
    if (e.key === 'ArrowRight' && state.activeLightboxIndex < state.pages.length - 1) openLightbox(state.activeLightboxIndex + 1);
  });
}

/* ==========================================================================
   Settings Drawer Handlers
   ========================================================================== */

function setupSettingsListeners() {
  elements.settingsToggleBtn.addEventListener('click', () => {
    elements.settingsDrawer.classList.add('active');
    elements.settingsBackdrop.classList.add('active');
  });

  const closeSettings = () => {
    elements.settingsDrawer.classList.remove('active');
    elements.settingsBackdrop.classList.remove('active');
  };

  elements.settingsCloseBtn.addEventListener('click', closeSettings);
  elements.settingsBackdrop.addEventListener('click', closeSettings);
  elements.settingsApplyBtn.addEventListener('click', () => {
    // Read input values
    const fn = FileName.cleanPdfName(elements.settingFilename.value);
    state.settings.filename = fn;
    elements.settingFilename.value = fn;

    const selectedSize = document.querySelector('input[name="page-size"]:checked');
    if (selectedSize) state.settings.pageSize = selectedSize.value;

    closeSettings();
    showToast('Settings saved.');
  });

  // Orientation Buttons
  document.querySelectorAll('[data-orientation]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-orientation]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.settings.orientation = btn.dataset.orientation;
    });
  });

  // Margin Buttons
  document.querySelectorAll('[data-margin]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-margin]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.settings.margin = parseInt(btn.dataset.margin, 10);
    });
  });

  // Quality Buttons
  document.querySelectorAll('[data-quality]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-quality]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.settings.quality = parseFloat(btn.dataset.quality);
    });
  });

  // USP 2: Page Number Watermarking Toggle
  if (elements.settingStampPages) {
    elements.settingStampPages.addEventListener('change', (e) => {
      state.settings.stampPageNumbers = e.target.checked;
      if (elements.watermarkOptions) {
        elements.watermarkOptions.style.display = e.target.checked ? 'block' : 'none';
      }
    });
  }

  // Stamp Format Buttons
  document.querySelectorAll('[data-stamp-format]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-stamp-format]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.settings.stampFormat = btn.dataset.stampFormat;
    });
  });

  // USP 3: Scan Enhancer Toggle
  if (elements.settingEnhanceScans) {
    elements.settingEnhanceScans.addEventListener('change', (e) => {
      state.settings.enhanceScans = e.target.checked;
    });
  }
}

/* ==========================================================================
   Auto Crop
   ========================================================================== */

let pageDetector = null;

/** Show Auto Crop only when there is at least one photo (image page) to crop. */
function syncAutoCropButton() {
  const count = CropState.countCroppable(state.pages);
  elements.autoCropBtn.style.display = count > 0 ? '' : 'none';
  elements.autoCropLabel.textContent = `Auto Crop (${count})`;
}

/** One Auto Crop detector for the whole page: the model loads once, on first use. */
function getPageDetector() {
  if (!pageDetector) pageDetector = PageDetect.createDetector();
  return pageDetector;
}

/** The corner model is created on first use and loads only then. */
function detectPage(item) {
  return loadImageFromUrl(item.thumbnailDataUrl).then((img) => getPageDetector().detect(img));
}

async function runAutoCrop() {
  const targets = CropState.autoCropTargets(state.pages);
  if (targets.length === 0) {
    showToast('Nothing to crop: pages you cropped by hand are left alone.', 'error');
    return;
  }

  let failures = 0;
  showProcessingModal('Detecting Page Edges', 'Loading the detector...', 5);
  try {
    for (let n = 0; n < targets.length; n++) {
      const item = state.pages[targets[n]];
      updateProcessingProgress(`Checking ${item.fileName} (${n + 1} of ${targets.length})...`, 5 + Math.round(((n + 1) / targets.length) * 90));
      try {
        const result = await detectPage(item);
        CropState.applyDetection(item, result);
        await refreshCropPreview(item);
      } catch (err) {
        failures++;
        console.error('Auto crop failed for', item.fileName, err);
      }
    }
  } finally {
    hideProcessingModal();
  }

  renderPageGrid();

  if (failures === targets.length) {
    showToast('Auto Crop is unavailable right now. You can still crop each page by hand.', 'error');
    return;
  }
  const summary = CropState.summarize(state.pages, targets);
  const parts = [`${summary.cropped} cropped`];
  if (summary.review) parts.push(`${summary.review} need review`);
  if (failures) parts.push(`${failures} failed`);
  showToast(parts.join(', ') + '.', failures ? 'error' : 'success');
}

/* ==========================================================================
   Progress Modal Helper
   ========================================================================== */

function showProcessingModal(title, status, initialProgress = 0) {
  elements.processingTitle.textContent = title;
  elements.processingStatus.textContent = status;
  elements.progressBarFill.style.width = `${initialProgress}%`;
  elements.processingModal.classList.add('active');
}

function updateProcessingProgress(status, percent) {
  elements.processingStatus.textContent = status;
  elements.progressBarFill.style.width = `${percent}%`;
}

function hideProcessingModal() {
  elements.processingModal.classList.remove('active');
}

/* ==========================================================================
   PDF-Lib Generation & Merging Pipeline
   ========================================================================== */

/** Export button: ask what to call the file, then build and download the PDF. */
async function startExport() {
  if (state.pages.length === 0) {
    showToast('Please add images or PDFs before exporting.', 'error');
    return;
  }
  const fileName = await ExportNameDialog.ask({ defaultName: state.settings.filename });
  if (!fileName) return;
  state.settings.filename = fileName;
  elements.settingFilename.value = fileName;
  await exportMergedPdf({ fileName });
}

async function exportMergedPdf({ fileName } = {}) {
  if (state.pages.length === 0) {
    showToast('Please add images or PDFs before exporting.', 'error');
    return;
  }

  showProcessingModal('Assembling PDF Document', 'Initializing output engine...', 5);

  try {
    const { PDFDocument, degrees, rgb, StandardFonts } = PDFLib;
    const mergedPdf = await PDFDocument.create();

    const total = state.pages.length;
    let watermarkFont = null;
    if (state.settings.stampPageNumbers) {
      watermarkFont = await mergedPdf.embedFont(StandardFonts.Helvetica);
    }

    // Cache source PDFDocument instances to prevent re-parsing the same file multiple times
    const loadedSourcePdfs = new Map();

    for (let i = 0; i < total; i++) {
      const item = state.pages[i];
      const progressPercent = Math.round(((i + 1) / total) * 85);
      updateProcessingProgress(`Processing Page ${i + 1} of ${total} (${item.fileName})...`, progressPercent);

      let targetPage = null;

      if (item.sourceType === 'pdf') {
        // Handle PDF page
        let srcDoc = loadedSourcePdfs.get(item.sourceFile);
        if (!srcDoc) {
          const fileBytes = await item.sourceFile.arrayBuffer();
          srcDoc = await PDFDocument.load(fileBytes);
          loadedSourcePdfs.set(item.sourceFile, srcDoc);
        }

        const [copiedPage] = await mergedPdf.copyPages(srcDoc, [item.sourcePageIndex]);
        
        // Apply user rotation
        const nativeRot = copiedPage.getRotation().angle || 0;
        copiedPage.setRotation(degrees((nativeRot + item.rotation) % 360));

        targetPage = mergedPdf.addPage(copiedPage);

      } else if (item.sourceType === 'image') {
        // Handle image page
        const embeddedImage = await embedImagePage(mergedPdf, item);

        // Calculate page dimension
        const imgDims = embeddedImage.scale(1.0);
        const { pageWidth, pageHeight, renderWidth, renderHeight, x, y } = calculatePageLayout(imgDims, state.settings);

        targetPage = mergedPdf.addPage([pageWidth, pageHeight]);
        targetPage.drawImage(embeddedImage, {
          x: x,
          y: y,
          width: renderWidth,
          height: renderHeight
        });
      }

      // USP 2: Automatic Page Number Watermarking
      if (state.settings.stampPageNumbers && targetPage && watermarkFont) {
        const text = state.settings.stampFormat === 'simple'
          ? `${i + 1} / ${total}`
          : `Page ${i + 1} of ${total}`;
        const fontSize = 9;
        const textWidth = watermarkFont.widthOfTextAtSize(text, fontSize);
        const pageSize = targetPage.getSize();
        const textX = (pageSize.width - textWidth) / 2;
        const textY = 16; // 16pt from bottom edge
        targetPage.drawText(text, {
          x: textX,
          y: textY,
          size: fontSize,
          font: watermarkFont,
          color: rgb(0.3, 0.28, 0.26)
        });
      }
    }

    updateProcessingProgress('Finalizing document structure and encoding...', 95);
    const pdfBytes = await mergedPdf.save();

    // Trigger instant browser download
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = fileName || state.settings.filename || 'Merged_Document.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);

    hideProcessingModal();
    showToast(`PDF exported successfully (${total} pages).`);

  } catch (err) {
    console.error('PDF export failed:', err);
    hideProcessingModal();
    showToast('Failed to export PDF: ' + (err.message || 'Unknown error'), 'error');
  }
}

/** True when the page has a stored crop that is safe to apply. */
function hasUsableCrop(item) {
  return !!item.cropQuad && CropGeometry.isValidQuad(item.cropQuad);
}

/**
 * Render an image page to a canvas: orientation normalised, optional
 * perspective crop, then the user's rotation. Sizes are capped to
 * MAX_EXPORT_PIXELS so large phone photos stay within canvas limits.
 */
async function renderImagePageCanvas(item) {
  const { img, revoke } = await loadImageElement(item.fullBlob || item.sourceFile);
  try {
    const capped = CropGeometry.capPixels(img.naturalWidth, img.naturalHeight, MAX_EXPORT_PIXELS);
    let working = document.createElement('canvas');
    working.width = capped.width;
    working.height = capped.height;
    const workingCtx = working.getContext('2d', { willReadFrequently: true });
    if (!workingCtx) throw new Error('This photo is too large for this device to process.');
    workingCtx.drawImage(img, 0, 0, working.width, working.height);

    if (hasUsableCrop(item)) {
      const quadPx = item.cropQuad.map(([x, y]) => [x * working.width, y * working.height]);
      const natural = CropGeometry.quadOutputSize(quadPx);
      const size = CropGeometry.capPixels(natural.width, natural.height, MAX_EXPORT_PIXELS);
      const warped = CropGeometry.warpPerspective(
        workingCtx.getImageData(0, 0, working.width, working.height), quadPx, size.width, size.height
      );
      const cropped = document.createElement('canvas');
      cropped.width = warped.width;
      cropped.height = warped.height;
      cropped.getContext('2d').putImageData(new ImageData(warped.data, warped.width, warped.height), 0, 0);
      working = cropped;
    }

    const quarterTurn = item.rotation === 90 || item.rotation === 270;
    const out = document.createElement('canvas');
    out.width = quarterTurn ? working.height : working.width;
    out.height = quarterTurn ? working.width : working.height;
    const ctx = out.getContext('2d');
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate((item.rotation * Math.PI) / 180);
    ctx.drawImage(working, -working.width / 2, -working.height / 2);
    return out;
  } finally {
    revoke();
  }
}

/**
 * Re-render an image page through a canvas (crop, rotation, scan enhance)
 * and embed it into the PDF.
 */
async function embedCanvasImage(mergedPdf, item) {
  const canvas = await renderImagePageCanvas(item);
  const ctx = canvas.getContext('2d');

  // USP 3: High-Contrast Document Scan Enhancer (B&W Photocopy Mode)
  if (state.settings.enhanceScans) {
    try {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imgData.data;
      for (let p = 0; p < d.length; p += 4) {
        // Perceived luminance
        const lum = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
        // S-curve contrast boost to wipe yellow lighting and background phone shadows
        const enhanced = lum > 175 ? 255 : (lum < 65 ? 0 : Math.round((lum - 65) * (255 / 110)));
        d[p] = enhanced;
        d[p + 1] = enhanced;
        d[p + 2] = enhanced;
      }
      ctx.putImageData(imgData, 0, 0);
    } catch (e) {
      console.warn('Scan enhance filter skipped:', e);
    }
  }

  const jpegQuality = state.settings.quality >= 1.0 ? 0.95 : state.settings.quality;
  const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', jpegQuality));
  if (jpegBlob) {
    try {
      return await mergedPdf.embedJpg(await jpegBlob.arrayBuffer());
    } catch (err) {
      // fall through to PNG
    }
  }
  const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!pngBlob) throw new Error('Could not encode this page. The photo may be too large for this device.');
  return mergedPdf.embedPng(await pngBlob.arrayBuffer());
}

/**
 * Produce the embedded image for an image page. The original bytes go in
 * untouched only when nothing needs to change (no crop, rotation, quality
 * change, enhance, or EXIF rotation); otherwise the page is re-rendered.
 */
async function embedImagePage(mergedPdf, item) {
  const direct = ImageNormalize.canEmbedOriginalDirectly({
    fileName: item.fileName,
    rotation: item.rotation,
    quality: state.settings.quality,
    enhanceScans: state.settings.enhanceScans,
    hasCrop: hasUsableCrop(item),
    jpegOrientation: item.jpegOrientation
  });

  if (direct) {
    try {
      const bytes = await item.sourceFile.arrayBuffer();
      return direct === 'png' ? await mergedPdf.embedPng(bytes) : await mergedPdf.embedJpg(bytes);
    } catch (err) {
      // fall through to the canvas path
    }
  }
  return embedCanvasImage(mergedPdf, item);
}

/**
 * Calculate proportional layout for A4, Letter, or Original Dimensions
 */
function calculatePageLayout(imgDims, settings) {
  const margin = settings.margin || 0; // points
  let pageWidth, pageHeight;

  // Preset Dimensions in PDF Points (72 points = 1 inch)
  // A4: 595.28 x 841.89 points (210 x 297 mm)
  // US Letter: 612.00 x 792.00 points (8.5 x 11 in)
  if (settings.pageSize === 'original') {
    pageWidth = imgDims.width + margin * 2;
    pageHeight = imgDims.height + margin * 2;
    return {
      pageWidth,
      pageHeight,
      renderWidth: imgDims.width,
      renderHeight: imgDims.height,
      x: margin,
      y: margin
    };
  }

  const baseStandard = settings.pageSize === 'letter'
    ? { portrait: [612, 792], landscape: [792, 612] }
    : { portrait: [595.28, 841.89], landscape: [841.89, 595.28] };

  let isLandscape = false;
  if (settings.orientation === 'auto') {
    isLandscape = imgDims.width > imgDims.height;
  } else if (settings.orientation === 'landscape') {
    isLandscape = true;
  }

  const standardSize = isLandscape ? baseStandard.landscape : baseStandard.portrait;
  pageWidth = standardSize[0];
  pageHeight = standardSize[1];

  const printableWidth = pageWidth - margin * 2;
  const printableHeight = pageHeight - margin * 2;

  // Proportional fit (contain)
  const scale = Math.min(printableWidth / imgDims.width, printableHeight / imgDims.height);
  const renderWidth = imgDims.width * scale;
  const renderHeight = imgDims.height * scale;

  // Centering
  const x = margin + (printableWidth - renderWidth) / 2;
  const y = margin + (printableHeight - renderHeight) / 2;

  return {
    pageWidth,
    pageHeight,
    renderWidth,
    renderHeight,
    x,
    y
  };
}

/* ==========================================================================
   Global Event Initialization
   ========================================================================== */

function initializeApp() {
  // File input change
  elements.fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    elements.fileInput.value = ''; // reset so same files can be re-selected if needed
  });

  // Global Drag & Drop handling for files from Finder
  let dragCounter = 0;

  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    if (e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
      dragCounter++;
      elements.dropZoneOverlay.classList.add('active');
    }
  });

  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      elements.dropZoneOverlay.classList.remove('active');
    }
  });

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
      e.dataTransfer.dropEffect = 'copy';
    }
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    elements.dropZoneOverlay.classList.remove('active');

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  });

  // Action Buttons
  elements.clearAllBtn.addEventListener('click', clearAll);
  elements.exportPdfBtn.addEventListener('click', startExport);
  elements.viewDocsBtn.addEventListener('click', () => setViewMode('documents'));
  elements.viewPagesBtn.addEventListener('click', () => setViewMode('pages'));
  elements.autoCropBtn.addEventListener('click', runAutoCrop);
  document.getElementById('finder-open-btn').addEventListener('click', () => PageFinderUI.open());
  document.getElementById('brand-home').addEventListener('click', (e) => {
    e.preventDefault();
    startOver();
  });
  if (new URLSearchParams(window.location.search).has('fresh')) {
    window.history.replaceState(null, '', window.location.pathname); // tidy the one-off address after a fresh start
  }

  // Mobile Bottom Bar Actions
  if (elements.cameraInput) {
    elements.cameraInput.addEventListener('change', (e) => {
      handleFiles(e.target.files);
      elements.cameraInput.value = '';
    });
  }

  if (elements.mobileSortBtn) {
    elements.mobileSortBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      elements.sortDropdown.classList.toggle('active');
    });
  }

  if (elements.mobileOptionsBtn) {
    elements.mobileOptionsBtn.addEventListener('click', () => {
      elements.settingsDrawer.classList.add('active');
      elements.settingsBackdrop.classList.add('active');
    });
  }

  if (elements.mobileExportBtn) {
    elements.mobileExportBtn.addEventListener('click', startExport);
  }

  // Subsystems
  setupSortingListeners();
  setupSettingsListeners();
  setupLightboxListeners();
  setupInstallListeners();

  // Initial State Render
  renderPageGrid();
}

/* ==========================================================================
   Cross-Device App Launcher & PWA Installation System
   ========================================================================== */

let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (elements.btnInstallApp) {
    elements.btnInstallApp.classList.add('install-ready');
  }
});

function detectPlatform() {
  const ua = navigator.userAgent || navigator.vendor || window.opera || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isMac = /Macintosh|Mac OS X/.test(ua) && !isIOS;
  const isAndroid = /Android/.test(ua);
  return { isIOS, isMac, isAndroid };
}

function openInstallModal() {
  if (!elements.installModal) return;

  const platform = detectPlatform();
  const subtitle = document.getElementById('install-platform-subtitle');
  const guideIos = document.getElementById('guide-ios');
  const guideMac = document.getElementById('guide-mac');
  const guideGeneric = document.getElementById('guide-generic');

  if (guideIos) guideIos.style.display = 'none';
  if (guideMac) guideMac.style.display = 'none';
  if (guideGeneric) guideGeneric.style.display = 'none';

  if (platform.isIOS) {
    if (subtitle) subtitle.textContent = 'Add to iPhone / iPad Home Screen';
    if (guideIos) guideIos.style.display = 'block';
  } else if (platform.isMac) {
    if (subtitle) subtitle.textContent = 'Add to Mac Desktop or Dock';
    if (guideMac) guideMac.style.display = 'block';
  } else {
    if (subtitle) subtitle.textContent = 'Install App on this Device';
    if (guideGeneric) guideGeneric.style.display = 'block';
  }

  elements.installModal.classList.add('active');
}

function closeInstallModal() {
  if (elements.installModal) {
    elements.installModal.classList.remove('active');
  }
}

function downloadMacWebloc() {
  const targetUrl = 'https://gurpreet-pixel-hue.github.io/pdf-page-studio/';
  const weblocContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>URL</key>
    <string>${targetUrl}</string>
</dict>
</plist>`;

  const blob = new Blob([weblocContent], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'PDF Page Studio.webloc';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);

  showToast('Downloaded Mac shortcut! Drag it to your Desktop or Dock.');
}

async function triggerNativeInstall() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      showToast('PDF Page Studio installed to your device!');
      closeInstallModal();
    }
    deferredInstallPrompt = null;
  } else {
    openInstallModal();
  }
}

function setupInstallListeners() {
  if (elements.btnInstallApp) {
    elements.btnInstallApp.addEventListener('click', () => {
      if (deferredInstallPrompt) {
        triggerNativeInstall();
      } else {
        openInstallModal();
      }
    });
  }

  if (elements.drawerInstallBtn) {
    elements.drawerInstallBtn.addEventListener('click', () => {
      if (elements.settingsDrawer) {
        elements.settingsDrawer.classList.remove('active');
        elements.settingsBackdrop.classList.remove('active');
      }
      if (deferredInstallPrompt) {
        triggerNativeInstall();
      } else {
        openInstallModal();
      }
    });
  }

  if (elements.installCloseBtn) {
    elements.installCloseBtn.addEventListener('click', closeInstallModal);
  }

  if (elements.installModalBackdrop) {
    elements.installModalBackdrop.addEventListener('click', closeInstallModal);
  }

  if (elements.btnDownloadMacShortcut) {
    elements.btnDownloadMacShortcut.addEventListener('click', downloadMacWebloc);
  }

  if (elements.btnTriggerPwaInstall) {
    elements.btnTriggerPwaInstall.addEventListener('click', triggerNativeInstall);
  }

  // Handle Escape key to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && elements.installModal && elements.installModal.classList.contains('active')) {
      closeInstallModal();
    }
  });
}

// Start application once DOM is fully loaded
document.addEventListener('DOMContentLoaded', initializeApp);
