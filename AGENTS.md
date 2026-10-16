# PDF Page Studio — Engineering & Design Specification

## Overview
- Application: High-performance visual PDF organizer, page reordering suite, and document assembler.
- Public Live URL: `https://gurpreet-pixel-hue.github.io/pdf-page-studio/`
- GitHub Repository: `https://github.com/Gurpreet-pixel-hue/pdf-page-studio`
- Deployment Platform: GitHub Pages (SSL-encrypted, automated via `.github/workflows/deploy.yml`)
- Zero Server Dependency: 100% in-browser client-side execution via WebAssembly & Web Workers. Zero telemetry leakage, 100% private. Zero local port footprint.

---

## Directory Structure
```
pdf-page-studio/
├── .github/
│   └── workflows/
│       └── deploy.yml            # Automated GitHub Pages CI/CD pipeline
├── assets/
│   ├── app_icon.png              # Source 1024x1024 app icon
│   ├── icon-192.png              # PWA manifest 192x192 icon
│   ├── icon-512.png              # PWA manifest 512x512 icon
│   └── icons.iconset/            # macOS ICNS iconset bundle
├── app.js                        # Core application logic, PDF-Lib compiler, drag-drop, watermarking, filters
├── doc-groups.js                 # Pure helpers deriving the Documents view from state.pages (browser + node)
├── crop-geometry.js              # Pure quad maths: ordering, validity, IoU, homography, perspective warp (browser + node)
├── image-normalize.js            # Pure photo helpers: EXIF orientation, HEIC detection, size caps, direct-embed rule
├── crop-state.js                 # Pure rules for Auto Crop targets and how a detection is recorded on a page
├── crop-editor.js                # Manual four-corner crop modal (drag, loupe, keyboard, focus trap)
├── file-name.js                  # Pure: turns typed text into a safe .pdf file name (illegal characters, reserved names, length) (browser + node)
├── page-finder.js                # Pure logic for Find page numbers: picking sections, numbering, labels, typed result (browser + node)
├── section-detect.js             # Renders each PDF page's top strip, runs the section model, scores pages (browser; pure helpers testable)
├── index-scan.js                 # Reads a photographed contents table: ruled columns, entry count, entry rows (RGBA analysis)
├── page-finder-ui.js             # The Find page numbers dialog: choose, scan, result, picker, warnings, copy
├── export-name-dialog.js         # 'Name your PDF' dialog shown by Export: prefilled, live preview, Esc cancels, Enter exports
├── split-dialog.js               # Split dialog: tap between thumbnails or type a page number to choose the cut
├── page-detect.js                # Corner-model pre/post-processing and the lazy ONNX Runtime Web detector
├── models/
│   ├── doccorner-ft.ort          # Fine-tuned page corner model (1.98 MB, ORT format)
│   ├── section-features.ort      # MobileNetV2 features of a page's top strip for Find page numbers (8.9 MB, ORT format)
│   ├── section-head.json         # Logistic-regression head for the section model (weights, bias, cut-off)
│   └── MODEL_CARD.md             # Data, metrics with baselines, limits, licences, how to retrain
├── vendor/ort/                   # onnxruntime-web 1.23.2 JS + a minimal 1.5 MB wasm (see its README)
├── tools/
│   ├── ui-check.js, ui-harness.js, ui/   # Headless Chrome scenario runner (Node 22+) and scenarios
│   └── model/                    # Fine-tune, ONNX export and reference scripts (need the private ground truth)
├── index.html                    # Semantic HTML5 layout, PWA meta, mobile dock, settings drawer, modals
├── styles.css                    # Warm creamy alabaster design system, spring animations, responsive queries
├── manifest.json                 # Web App Manifest for PWA installation (iOS/Android/macOS)
├── launch.sh                     # Zero-port launcher script for macOS / Linux
├── create_macos_app.py           # Native macOS Application bundle generator with custom ICNS
├── test_merge.js                 # Automated headless node verification test suite
├── test_doc_groups.js            # Unit tests for Documents-view grouping, move and remove helpers
├── test_crop_geometry.js, test_image_normalize.js, test_crop_state.js, test_page_detect.js   # Unit tests for the crop modules
├── docs/device-test-checklist.md # Real-device checks (iPhone Safari/Chrome, Android) for photo upload and crop
└── .gitignore                    # Git ignore configuration (AGENTS.md is strictly tracked)
```

---

## Architecture & Features

### 1. Universal Device Responsiveness
- **Desktop**: Full grid view with drag-and-drop handles, top toolbar telemetry, slide-out configuration drawer.
- **iPad / Tablet** (`max-width: 1024px`): Adaptive 3-4 column grid, touch-friendly handles.
- **Mobile** (`max-width: 768px` & `420px`):
  - Clean 2-column mobile card grid.
  - Thumb-friendly fixed bottom bar dock (`.mobile-bottom-bar`) with iOS safe-area insets (`env(safe-area-inset-bottom)`).
  - Device-agnostic micro-copy: "Choose Photos & Files" (eliminated "on Mac" references).
  - Full-screen slide-up settings drawer.

### 2. Built-in Unique Selling Points (USPs)
1. **USP 1 — Direct Mobile Camera Document Scanner**:
   - `<input type="file" capture="environment">` integrated for 1-tap physical paper scanning directly into the document queue.
2. **USP 2 — Dynamic Page Number Watermarking**:
   - In-engine PDF-Lib page numbering with configurable formats (`Page X of Y` or `X / Y`) drawn at 16pt margin using standard Helvetica fonts.
3. **USP 3 — Document Scan Enhancer (B&W Photocopy Mode)**:
   - Client-side canvas pixel transformation using luminance thresholding ($Y = 0.299R + 0.587G + 0.114B$) to remove yellow indoor cast, desk shadows, and improve text readability.
4. **USP 4 — Progressive Web App (PWA) Standalone**:
   - `manifest.json`, mobile meta viewport, apple-touch-icons for 1-tap "Add to Home Screen" on iOS & Android.

### 3. Cross-Device Launcher & Asset Cache Invalidation
- **Quick App Launcher (`#btn-install-app`, `#drawer-install-btn`)**: Universal button enabling 1-click home screen / dock icon installation:
  - **Android & Desktop Chrome/Edge**: Native W3C PWA install prompt (`beforeinstallprompt`).
  - **iPhone & iPad (iOS/iPadOS Safari)**: Illustrated 3-step guide for Safari Share $\rightarrow$ Add to Home Screen.
  - **Mac Desktop**: Safari Add to Dock + 1-click download of native `.webloc` shortcut file.
- **Pristine Header**: Header typography kept clean and uncluttered (`PDF PAGE STUDIO`), eliminating version numbers from the visual brand row.
- **Version Query Strings**: `styles.css?v=2.9.1`, `app.js?v=2.9.1`, `doc-groups.js?v=2.9.1`, `page-detect.js?v=2.9.1`, `split-dialog.js?v=2.9.1`, `export-name-dialog.js?v=2.9.1`, `page-finder.js?v=2.9.1`, `page-finder-ui.js?v=2.9.1`, `section-detect.js?v=2.9.1`, `index-scan.js?v=2.9.1`, `file-name.js?v=2.9.1`, `manifest.json?v=2.9.1` ensure immediate CDN and local browser cache bypass.
- **Start over (title link)**: the `PDF PAGE STUDIO` brand (`#brand-home`, an `<a href="./">` with an accessible name and focus ring) restarts the app, mainly so phones have a way out. `startOver()` in `app.js` asks for confirmation only when pages are loaded, refetches the page's own scripts, styles and manifest with `cache: 'reload'` (4 s cap, failures ignored), then `location.replace`s to `?fresh=<timestamp>`; on load the param is stripped with `history.replaceState`. It deliberately does not touch localStorage, IndexedDB or Cache Storage: the site has none of its own and the `github.io` origin is shared with other projects. Scenario: `tools/ui/startover.js` (the real navigation is not exercised, only its inputs).
- **Cache-Control Meta Directives**: `<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">` forces dynamic revalidation of the HTML document shell.

### 4. Documents View & Pages View
- **Documents view (default)**: one card per source file, so multi-PDF uploads can be reordered or removed as whole documents. Each card shows the first page as a stacked-sheets thumbnail, a page-count badge, left/right arrows, delete, and "view pages".
- **Pages view**: the per-page grid, for moving individual pages between documents. Toggle via the `Documents | Pages` segmented control (`#view-docs-btn`, `#view-pages-btn`) in the grid toolbar; the choice persists for the session (`state.viewMode`).
- **Single source of truth**: both views edit `state.pages`. A document is a run of consecutive pages sharing the same `sourceFile` object (identity, not filename). Pulling a page from file A into the middle of file B splits both into separate cards with range labels such as `pp. 1–2 of 5`, so the Documents view always mirrors the real export order.
- **Logic location**: `doc-groups.js` exports `groupPagesIntoDocuments`, `moveDocument`, `removeDocument` (pure, non-mutating, unit-tested in `test_doc_groups.js`). DOM rendering lives in `app.js` (`createDocumentCardElement`, `renderPageGrid`).
- **Splitting a PDF into parts**: a multi-page document card has a Split button (scissors) that opens `SplitDialog` (`split-dialog.js`) with a thumbnail strip (a cut point between every pair of pages) and three modes in a tab bar. Every mode produces a list of part sizes that `DocGroups.splitDocumentInto` applies:
  - **One cut** (default): tap a cut point or type "Split after page N" (whole number 1 to count - 1); two parts.
  - **Fixed range**: "Pages in each part" n (`DocGroups.fixedSizes`): a 10-page PDF with n = 2 becomes five 2-page parts; the last part takes what is left (n = 3 gives 3, 3, 3, 1).
  - **Custom range**: type `1-8, 9-10, 11-13` (`DocGroups.parsePageRanges`). Commas, semicolons, spaces and en dashes are fine; a single page is a range of one; ranges can be typed in any order but may not overlap. Pages not listed are never dropped: each unlisted stretch becomes a part of its own and the summary says so. Backwards ranges, pages past the end, overlaps and "the whole document as one range" show a specific error and disable Split.
  - The strip marks every cut of the current mode; clicking a cut point in another mode switches to One cut there. A live summary lists the parts (`Part A: pp. 1–2 of 10. Part B: …`, shortened after six). Enter confirms, Esc cancels, arrow keys move between tabs, focus stays inside the dialog.
- **Cut model**: a page flagged `splitBefore: true` starts a new document even when the page before it is from the same file (`DocGroups.groupPagesIntoDocuments`). `DocGroups.splitDocument` flags BOTH parts' first pages (a single flag on part B would let part B merge back into part A once it is moved in front of it). Parts are ordinary document cards, so the existing arrows and drag-and-drop move them independently; a part can be split again. `canJoinNext` is true only when the next card is the same file's direct continuation (flagged, next source page number), which shows a Join button (`DocGroups.joinDocuments`).
- **Page-level edits keep cuts honest**: Pages-view move, swap and remove go through `DocGroups.movePage` / `removePage`, which hand a moved or removed part-start flag to the next page of the same file, so edits never silently merge two parts. Export is unchanged: it follows `state.pages` order. Cuts live in memory only.
- **Tests**: `test_doc_groups.js` (pure logic) and `npm run ui-check -- tools/ui/split.js` (single cut: dialog, typed and visual cuts, invalid input, moves, join, page-level edits, export page count) and `tools/ui/split-ranges.js` (fixed and custom modes, errors, summaries, apply, join).
- **Steady grid while editing (`renderPageGrid`)**: every edit re-renders the grid, but a render keeps what the user already sees. Cards carry a `data-key` (`p:<page id>` in Pages view, `d:<first page id>` in Documents view). Thumbnail `<img>` elements are cached per key (`thumbCache`) and reused when the image is unchanged, so nothing is re-decoded or flashes blank. Only cards whose key was not on screen play the `cardWaterfall` entrance animation (everything animates on a view switch); other cards get `animation: none`. Cards that changed place glide there with a Web Animations FLIP (280 ms, skipped under `prefers-reduced-motion`). The grid keeps a `min-height` while it is rebuilt and the scroll position of the scrolling ancestor (the page body) is restored. Drag and drop and the arrow buttons all go through this one path. Scenario: `tools/ui/smooth.js`.
- **Thumbnails are blob URLs, not base64**: `canvasToObjectUrl` (toBlob + `URL.createObjectURL`) builds `thumbnailDataUrl` (the 2000 px working copy; name kept for existing callers), `cardThumbUrl` (long edge 520 px, shown on grid cards) and `previewUrl` (cropped preview). `pageThumbSrc` is the card image, `pageFullSrc` the lightbox image. The old data URLs put up to ~0.5 MB of text per card into the HTML on every render (16.6 M characters for 30 real photos). `releasePageUrls` revokes a page's blob URLs when it is removed, cleared or re-cropped. PDF page thumbnails are blob URLs too.
- **Ingest** (`handleFiles`): files go through a pool of `INGEST_CONCURRENCY` (1) workers; results are placed by file position and `originalIndex` is assigned afterwards, so upload order is kept. A broken file is skipped with a toast. Measured on a Mac in headless Chrome: about 225 ms per 18 MP photo, dominated by decoding the full-size JPEG; blob URLs did not change that (they fix render cost and memory), and 2 concurrent files gave no speed-up while doubling peak memory, so concurrency stays 1 until timed on a phone. A faster `createImageBitmap(resize)` decode measured ~40% quicker on desktop but orientation and resize support differ on iOS Safari, so it is not enabled. Scenario: `tools/ui/ingest-speed.js`.
- **Export asks for a file name**: both Export buttons call `startExport()` (not `exportMergedPdf` directly). `ExportNameDialog.ask({ defaultName })` shows the last name without `.pdf`, selected, with a live "Saved as ..." preview built by `FileName.cleanPdfName` (illegal characters `\ / : * ? " < > |` become hyphens, a typed `.pdf` is never doubled, leading dots and Windows reserved names are fixed, long names are capped). Empty names disable Export; Esc, Cancel and the backdrop export nothing. The confirmed name is stored in `state.settings.filename` and the Options drawer field, so it is the default next time. `exportMergedPdf({ fileName })` still works directly. Tests: `test_file_name.js`, `tools/ui/exportname.js`.
- **Header at every window width**: the full desktop header needs about 1270 px. Between 769 and 1320 px the secondary buttons become icon-only (each has a `title` and `aria-label`; Export keeps its label), below 980 px the subtitle is hidden and the bar wraps onto a second row, so no control is ever pushed off-screen. Phones (<= 768 px) use the bottom dock. Test: run `tools/ui/responsive.js` at several widths (`for w in 1600 1280 1100 900 800 770 700 390; do UI_CHECK_VIEWPORT=${w}x720 npm run ui-check -- tools/ui/responsive.js; done`).
- **PDF opening is hardened**: every `pdfjsLib.getDocument` call (`parsePdfFile` in `app.js`, `SectionDetect.score`) passes `isEvalSupported: false`. The vendored pdf.js is 3.11.174, which is affected by CVE-2024-4367 (a crafted PDF can run script through a malicious font unless eval is off; fixed upstream in 4.2.67). Any new code that opens a PDF must do the same. Test: `tools/ui/pdfjs-safe.js` (spies on `getDocument`, and checks a text PDF still renders).
- **Version**: assets are cache-busted with `?v=2.9.1`.

### 5. Photo Crop (manual editor and Auto Crop)
- **Image pages only.** PDF pages never get a Crop button, and the Auto Crop button is hidden unless at least one image page exists (`CropState.countCroppable`). In a mixed upload it acts on image pages only. Label: `Auto Crop (N)`.
- **Ingestion** (`parseImageFile`): EXIF orientation is applied by decoding through an image element, and a working copy (long edge <= 2000 px, `WORKING_MAX_EDGE`) is used for thumbnails, the editor and detection. The full-resolution `fullBlob` is kept for export. **HEIC is not decoded**: iOS (Safari and Chrome) converts to JPEG at pick time, so the file input's `accept` list omits HEIC; a HEIC file that still reaches the page (desktop drag and drop) adds no page and shows a toast explaining what to do. `heic2any` was removed because it fails on current iPhone HEIC files.
- **Data**: each image page has `cropQuad` (normalised TL, TR, BR, BL), `cropState` (`none|auto|manual|needs-review`), `cropConfidence`, `previewUrl`.
- **Export**: `embedImagePage` embeds original bytes only when nothing changes (`ImageNormalize.canEmbedOriginalDirectly`); otherwise `renderImagePageCanvas` applies orientation, a pure-JS perspective warp (`CropGeometry.warpPerspective`), then rotation. Canvases are capped at `MAX_EXPORT_PIXELS` (12,000,000).
- **Editor** (`crop-editor.js`): four draggable corners, loupe, arrow-key nudging, Esc, focus trap. Apply is disabled for non-convex or tiny quads. It starts from the stored crop, else a 10% inset.
- **Auto Crop** (`runAutoCrop`, `page-detect.js`): a small corner model (`models/doccorner-ft.ort`) run with ONNX Runtime Web on the 2000 px working copy (shrunk by repeated halving so Safari and Chrome resize alike), on the main thread, loaded on first click (about 3.5 MB: model plus 1.5 MB wasm; about 25 ms per photo). The detection becomes the crop (`auto`, shown with an Auto badge) when `confidence >= 0.6`; weaker or invalid results are left uncropped and flagged `needs-review`. A page whose detection throws is left unchanged; if every page fails the toast says Auto Crop is unavailable.
- **What `cropConfidence` means**: the model's "a page is present" score. It does NOT predict whether the crop is exact (the CV run did not record per-photo scores), so a wrong crop can still be marked `auto`; the user edits it with Crop.
- **Measured quality** (`models/MODEL_CARD.md`): 5-fold CV on the owner's 41 pile photos, each scored by a model that never saw it: 35/41 usable (85%, 95% CI 72-93%), IoU 0.936 against the manual crops, versus 22/41 (54%) pretrained and IoU 0.744 for a fixed 10% inset. "Usable" = at most 1% of the page ink cut off, at least 90% of the manual crop covered, at most 10% outside it. The 90% goal was **not reached**. All 41 photos share one desk and lighting; other setups are unmeasured (an external Mendeley test of 153 photos without piles gives IoU 0.897 versus 0.870 pretrained). The classical OpenCV detector was tried first (IoU 0.686, worse than a fixed inset) and dropped.
- **Tests**: `npm test` (pure modules, including `test_page_detect.js`); `npm run ui-check -- tools/ui/<scenario>.js` for `smoke`, `ingest`, `export`, `editor`, `detect`, `autocrop`. `detect.js` checks browser output against Python reference quads when `UI_CHECK_FIXTURES` has `ref_quads.json` and photos.

### 6. Find Page Numbers
- **Entry point**: the "Find page numbers" button on the landing page opens `PageFinderUI` (a modal): choose the journal PDF (or a PDF already added) and optionally a photo of the handwritten contents page, scan, then a typed result: `Experiment 1 – page 3`, one row per section with a heading thumbnail, an editable name, a page button that opens a picker, and an "Unsure" / "Not in this PDF" / "Page not found" status.
- **Finding heading pages**: `SectionDetect` renders only the top strip (rows 3%-20%) of each page with pdf.js, runs a MobileNetV2 feature model (`models/section-features.ort`, about 8.9 MB, fetched once on the first scan and then cached, run by the vendored minimal ONNX Runtime) and a logistic head (`models/section-head.json`). Nothing is uploaded. About 230-300 ms per page on a Mac in headless Chrome (phone speed unmeasured). Heading text cannot be read (tesseract.js 0/12, TrOCR 0/23 numbers on the real journals), so labels are typed from counts.
- **Choosing sections** (`PageFinder.pickSections`): with a contents photo, the best N pages (N = entries), never a page scoring at or below `DEFAULT_FLOOR` (-0.5), so an entry is left "Page not found" instead of being filled with a page that looks nothing like a heading (printed code pages can still score above the floor; they are marked "Unsure"). Without one, pages above `DEFAULT_CUTOFF` (1.5) plus the next ten as one-tap candidates. Both numbers are tuned on three journals; see `models/MODEL_CARD.md` for the held-out table.
- **Contents photo** (`index-scan.js`, optional): the page is found with the Auto Crop detector, flattened, and the entry count is read from the numerals in the first column. On the three real contents pages it counted 0 of 3 (tilted, pale lines), so the entries field is always shown when a photo is chosen and the user types the count; it works on a drawn table. Entry crops are labels only.
- **Numbering**: `front = first heading page - 1`. The app asks how to count: as in this PDF, or N extra pages in front (certificate, index, others; 0-20). Pre-answer: `front >= 2` as in this PDF, `0` add 2, `1` the user decides (Copy waits). The copied text states the rule.
- **Names**: "Experiment 1..N-A", "Assignment 1..A" with A (assignments at the end, default 2) editable, and every name editable by typing. A manual page choice changes only its own entry; "Not in this PDF" moves the later entries up.
- **Warnings** (never blocking): fewer clear headings than entries, two clear headings in a row, a page used by two entries, an unreadable contents photo, an unanswered counting question.
- **Tests**: `test_page_finder.js`, `test_section_detect.js`, `test_index_scan.js`; scenarios `tools/ui/section-model.js`, `section-detect.js`, `index-scan.js`, `pagefinder-flow.js`, `pagefinder.js`; local-only `tools/ui/pagefinder-real.js` and `index-scan-real.js` (personal journals via `UI_CHECK_FIXTURES`). Model gate and export: `tools/model/sections_*.py`.

---

## Anti-Vibecoding & Aesthetic Guidelines
- **Aesthetic**: Warm Creamy Alabaster & Editorial Luxury (`#faf8f5` canvas, `#f5f2eb` elevated surfaces, `#e5dfd3` borders, `#2d2621` deep espresso typography, `#c25e3e` terracotta accent).
- **Zero Emojis**: Emojis are strictly banned from UI elements, buttons, badges, and headers. Purposeful SVG glyphs and typography badges are used exclusively.
- **Spring Physics**: Dynamic micro-interactions powered by cubic-bezier spring easing: `cubic-bezier(0.175, 0.885, 0.32, 1.275)`.
- **Zero Local Ports**: No local background HTTP servers run after deployment; cloud CDN serves all traffic.

---

## Verification & Quality Assurance Commands
- Syntax Validation: `node --check app.js`
- Test Suite (Page insertion, reordering, rotation, deletion, watermarking): `node test_merge.js`
- All unit suites: `npm test`
- Browser scenarios: `npm run ui-check -- tools/ui/<scenario>.js` (Node 22+, Chrome; serves on a random local port for the run only)
- Real-device checks: `docs/device-test-checklist.md`
- Page finder on the real journals (local, private data): `UI_CHECK_FIXTURES=<folder> npm run ui-check -- tools/ui/pagefinder-real.js 900000`
- Cloud CDN Health Check: `curl -sI https://gurpreet-pixel-hue.github.io/pdf-page-studio/ | head -n 5`
- Port Check (Must show no open processes): `lsof -iTCP:8000 -iTCP:3000 -iTCP:5173 -iTCP:8080`

---

## Git Workflow & Conventions
- Commits must use clean conventional commits: `feat: ...`, `fix: ...`, `chore: ...`.
- Strictly no AI attribution or bots (`Co-authored-by`, `[bot]`).
- `CLAUDE.md` is strictly read-only. Antigravity never modifies `CLAUDE.md`.
- `AGENTS.md` is maintained continuously on every code modification.
