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
 * Ingest multiple files selected via file input or drag-drop
 */
async function handleFiles(fileList) {
  if (!fileList || fileList.length === 0) return;

  const files = Array.from(fileList);
  showProcessingModal('Ingesting Files', `Processing ${files.length} source file(s)...`, 10);

  let addedCount = 0;
  let fileIndex = 0;

  for (const file of files) {
    fileIndex++;
    const progress = Math.round((fileIndex / files.length) * 80);
    updateProcessingProgress(`Reading ${file.name}...`, progress);

    try {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const pdfPages = await parsePdfFile(file);
        for (const p of pdfPages) {
          state.pages.push(p);
          addedCount++;
        }
      } else if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name)) {
        const imagePage = await parseImageFile(file);
        state.pages.push(imagePage);
        addedCount++;
      } else {
        console.warn('Unsupported file format:', file.name);
      }
    } catch (err) {
      console.error('Error processing file:', file.name, err);
      showToast(`Failed to parse ${file.name}`, 'error');
    }
  }

  hideProcessingModal();

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

    const thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.85);

    const originalViewport = page.getViewport({ scale: 1.0 });

    pageItems.push({
      id: generateId(),
      sourceType: 'pdf',
      sourceFile: file,
      fileName: file.name,
      sourcePageIndex: pageNum - 1, // 0-based
      sourceTotalPages: numPages,
      originalIndex: state.fileCounter++,
      thumbnailDataUrl: thumbnailDataUrl,
      rotation: 0,
      width: originalViewport.width,
      height: originalViewport.height
    });
  }

  return pageItems;
}

/**
 * Load image file and generate thumbnail
 */
function parseImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        resolve({
          id: generateId(),
          sourceType: 'image',
          sourceFile: file,
          fileName: file.name,
          sourcePageIndex: 0,
          sourceTotalPages: 1,
          originalIndex: state.fileCounter++,
          thumbnailDataUrl: e.target.result,
          rotation: 0,
          width: img.naturalWidth || 800,
          height: img.naturalHeight || 600
        });
      };
      img.onerror = () => reject(new Error('Failed to load image: ' + file.name));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Failed to read file: ' + file.name));
    reader.readAsDataURL(file);
  });
}

/* ==========================================================================
   Grid Rendering & DOM Synchronization
   ========================================================================== */

/**
 * Synchronize the grid with state.pages
 */
function renderPageGrid() {
  const totalPages = state.pages.length;
  elements.statPageCount.textContent = totalPages;

  // Calculate unique source files
  const uniqueFiles = new Set(state.pages.map(p => p.fileName));
  elements.statFileCount.textContent = `${uniqueFiles.size} file${uniqueFiles.size === 1 ? '' : 's'}`;

  // Toggle View Containers
  if (totalPages === 0) {
    elements.emptyState.style.display = 'flex';
    elements.pageGridContainer.style.display = 'none';
    elements.exportPdfBtn.disabled = true;
    return;
  }

  elements.emptyState.style.display = 'none';
  elements.pageGridContainer.style.display = 'flex';
  elements.exportPdfBtn.disabled = false;

  // Clear existing cards
  elements.pageGrid.innerHTML = '';

  // Render each page card
  state.pages.forEach((pageItem, index) => {
    const card = createPageCardElement(pageItem, index, totalPages);
    elements.pageGrid.appendChild(card);
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
      <span class="source-type-tag" title="${escapeHtml(pageItem.fileName)}">${sourceLabel}</span>
    </div>

    <div class="card-thumbnail-viewport">
      <img src="${pageItem.thumbnailDataUrl}" 
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
  const item = state.pages.splice(fromIndex, 1)[0];
  state.pages.splice(toIndex, 0, item);
  renderPageGrid();
  showToast(`Moved Page ${fromIndex + 1} to Page ${toIndex + 1}`);
}

/**
 * Swap two adjacent pages
 */
function swapPages(indexA, indexB) {
  const temp = state.pages[indexA];
  state.pages[indexA] = state.pages[indexB];
  state.pages[indexB] = temp;
  renderPageGrid();
}

/**
 * Remove an individual page
 */
function removePage(index) {
  const removed = state.pages.splice(index, 1)[0];
  renderPageGrid();
  showToast(`Removed Page ${index + 1}`);
}

/**
 * Clear all pages
 */
function clearAll() {
  if (state.pages.length === 0) return;
  if (confirm('Are you sure you want to remove all uploaded pages?')) {
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
  elements.lightboxImage.src = item.thumbnailDataUrl;
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
    let fn = elements.settingFilename.value.trim();
    if (!fn.toLowerCase().endsWith('.pdf')) fn += '.pdf';
    state.settings.filename = fn;

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

async function exportMergedPdf() {
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
        const imageBytes = await getImageBytesWithRotationAndQuality(item, state.settings.quality);
        let embeddedImage;

        // Try embedding directly or fallback to PNG/JPEG
        if (item.fileName.toLowerCase().endsWith('.png') && item.rotation === 0 && state.settings.quality === 1.0 && !state.settings.enhanceScans) {
          try {
            embeddedImage = await mergedPdf.embedPng(imageBytes);
          } catch (e) {
            embeddedImage = await embedCanvasImage(mergedPdf, item);
          }
        } else if ((item.fileName.toLowerCase().endsWith('.jpg') || item.fileName.toLowerCase().endsWith('.jpeg')) && item.rotation === 0 && state.settings.quality === 1.0 && !state.settings.enhanceScans) {
          try {
            embeddedImage = await mergedPdf.embedJpg(imageBytes);
          } catch (e) {
            embeddedImage = await embedCanvasImage(mergedPdf, item);
          }
        } else {
          // Re-rendered through canvas with user's exact rotation applied + scan enhancement if enabled
          embeddedImage = await embedCanvasImage(mergedPdf, item);
        }

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
    a.download = state.settings.filename || 'Merged_Document.pdf';
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

/**
 * Render image to offscreen canvas applying user's rotation and embed into PDF
 */
async function embedCanvasImage(mergedPdf, item) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      const isRotated90or270 = item.rotation === 90 || item.rotation === 270;
      canvas.width = isRotated90or270 ? img.naturalHeight : img.naturalWidth;
      canvas.height = isRotated90or270 ? img.naturalWidth : img.naturalHeight;

      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((item.rotation * Math.PI) / 180);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      ctx.restore();

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

      canvas.toBlob(async (blob) => {
        try {
          const buffer = await blob.arrayBuffer();
          const embedded = await mergedPdf.embedJpg(buffer);
          resolve(embedded);
        } catch (err) {
          // If JPEG fails, try PNG
          canvas.toBlob(async (pngBlob) => {
            try {
              const pngBuf = await pngBlob.arrayBuffer();
              const pngEmbedded = await mergedPdf.embedPng(pngBuf);
              resolve(pngEmbedded);
            } catch (pngErr) {
              reject(pngErr);
            }
          }, 'image/png');
        }
      }, 'image/jpeg', state.settings.quality >= 1.0 ? 0.95 : state.settings.quality);
    };
    img.onerror = () => reject(new Error('Failed to load image for canvas embedding'));
    img.src = item.thumbnailDataUrl;
  });
}

/**
 * Return raw image file bytes
 */
async function getImageBytesWithRotationAndQuality(item, quality) {
  if (item.sourceFile) {
    return await item.sourceFile.arrayBuffer();
  }
  return null;
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
  elements.exportPdfBtn.addEventListener('click', exportMergedPdf);

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
    elements.mobileExportBtn.addEventListener('click', exportMergedPdf);
  }

  // Subsystems
  setupSortingListeners();
  setupSettingsListeners();
  setupLightboxListeners();

  // Initial State Render
  renderPageGrid();
}

// Start application once DOM is fully loaded
document.addEventListener('DOMContentLoaded', initializeApp);
