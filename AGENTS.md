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
├── split-dialog.js               # Split dialog: tap between thumbnails or type a page number to choose the cut
├── page-detect.js                # Corner-model pre/post-processing and the lazy ONNX Runtime Web detector
├── models/
│   ├── doccorner-ft.ort          # Fine-tuned page corner model (1.98 MB, ORT format)
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
- **Version Query Strings**: `styles.css?v=2.6.1`, `app.js?v=2.6.1`, `doc-groups.js?v=2.6.1`, `page-detect.js?v=2.6.1`, `split-dialog.js?v=2.6.1`, `manifest.json?v=2.6.1` ensure immediate CDN and local browser cache bypass.
- **Start over (title link)**: the `PDF PAGE STUDIO` brand (`#brand-home`, an `<a href="./">` with an accessible name and focus ring) restarts the app, mainly so phones have a way out. `startOver()` in `app.js` asks for confirmation only when pages are loaded, refetches the page's own scripts, styles and manifest with `cache: 'reload'` (4 s cap, failures ignored), then `location.replace`s to `?fresh=<timestamp>`; on load the param is stripped with `history.replaceState`. It deliberately does not touch localStorage, IndexedDB or Cache Storage: the site has none of its own and the `github.io` origin is shared with other projects. Scenario: `tools/ui/startover.js` (the real navigation is not exercised, only its inputs).
- **Cache-Control Meta Directives**: `<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">` forces dynamic revalidation of the HTML document shell.

### 4. Documents View & Pages View
- **Documents view (default)**: one card per source file, so multi-PDF uploads can be reordered or removed as whole documents. Each card shows the first page as a stacked-sheets thumbnail, a page-count badge, left/right arrows, delete, and "view pages".
- **Pages view**: the per-page grid, for moving individual pages between documents. Toggle via the `Documents | Pages` segmented control (`#view-docs-btn`, `#view-pages-btn`) in the grid toolbar; the choice persists for the session (`state.viewMode`).
- **Single source of truth**: both views edit `state.pages`. A document is a run of consecutive pages sharing the same `sourceFile` object (identity, not filename). Pulling a page from file A into the middle of file B splits both into separate cards with range labels such as `pp. 1–2 of 5`, so the Documents view always mirrors the real export order.
- **Logic location**: `doc-groups.js` exports `groupPagesIntoDocuments`, `moveDocument`, `removeDocument` (pure, non-mutating, unit-tested in `test_doc_groups.js`). DOM rendering lives in `app.js` (`createDocumentCardElement`, `renderPageGrid`).
- **Splitting a PDF into parts**: a multi-page document card has a Split button (scissors) that opens `SplitDialog` (`split-dialog.js`): a horizontal thumbnail strip with a cut point between every pair of pages, plus a typed "Split after page N" field. Both stay in sync, a live summary shows the two page ranges (`Part A: pp. 1–5 of 14. Part B: pp. 6–14 of 14.`), and Split is disabled for anything but a whole number from 1 to count - 1. Enter confirms, Esc cancels, focus stays inside the dialog.
- **Cut model**: a page flagged `splitBefore: true` starts a new document even when the page before it is from the same file (`DocGroups.groupPagesIntoDocuments`). `DocGroups.splitDocument` flags BOTH parts' first pages (a single flag on part B would let part B merge back into part A once it is moved in front of it). Parts are ordinary document cards, so the existing arrows and drag-and-drop move them independently; a part can be split again. `canJoinNext` is true only when the next card is the same file's direct continuation (flagged, next source page number), which shows a Join button (`DocGroups.joinDocuments`).
- **Page-level edits keep cuts honest**: Pages-view move, swap and remove go through `DocGroups.movePage` / `removePage`, which hand a moved or removed part-start flag to the next page of the same file, so edits never silently merge two parts. Export is unchanged: it follows `state.pages` order. Cuts live in memory only.
- **Tests**: `test_doc_groups.js` (pure logic) and `npm run ui-check -- tools/ui/split.js` (dialog, typed and visual cuts, invalid input, moves, join, page-level edits, export page count).
- **Version**: assets are cache-busted with `?v=2.6.1`.

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
- Cloud CDN Health Check: `curl -sI https://gurpreet-pixel-hue.github.io/pdf-page-studio/ | head -n 5`
- Port Check (Must show no open processes): `lsof -iTCP:8000 -iTCP:3000 -iTCP:5173 -iTCP:8080`

---

## Git Workflow & Conventions
- Commits must use clean conventional commits: `feat: ...`, `fix: ...`, `chore: ...`.
- Strictly no AI attribution or bots (`Co-authored-by`, `[bot]`).
- `CLAUDE.md` is strictly read-only. Antigravity never modifies `CLAUDE.md`.
- `AGENTS.md` is maintained continuously on every code modification.
