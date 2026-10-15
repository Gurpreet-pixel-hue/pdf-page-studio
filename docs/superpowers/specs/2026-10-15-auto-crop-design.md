# Auto Crop for Photographed Pages: Design

Status: draft for review. Date: 2026-10-15. Scope: Phase 1 in detail, Phase 2 as a gated follow-up.

## Goal

A user photographs sheets with a phone, uploads them (gallery or camera, iPhone or Android), and gets clean edge-to-edge pages in the PDF without taking a perfect photo. When several sheets are stacked, only the top sheet is detected and cropped. Detection is automatic with a manual override on every page.

## Decisions already made

- Phased: Phase 1 is a classical-CV detector plus a manual crop editor. Phase 2 is an ML model, started only if the Phase 1 benchmark says it is needed.
- Everything runs in the browser. No uploads, no server (a core property of the app, see `AGENTS.md`).
- "Edge to edge, aligned" means perspective correction: find four corners, warp to a rectangle. An axis-aligned box is not enough.
- **Auto Crop applies to image pages only.** If every uploaded file is a PDF, the Auto Crop button is not shown, and PDF pages never get a per-page Crop button. In a mixed upload the button is shown and acts on the image pages only.
- No public dataset covers "stacked sheets, top one labelled". Evaluation and any fine-tuning use the user's own photos.

## Test data (already collected)

- 41 raw iPhone photos and the user's manual crops of them. Raw originals: `~/Documents/raw_photos` (HEIC). Crops: `~/Documents/cropped_photos`.
- Pairs and ground-truth corner quads: `~/Documents/page_crop_ground_truth/ground_truth.json` (`quad_norm` = TL, TR, BR, BL, normalised to the raw image). Derived by SIFT matching plus RANSAC homography. All 41 pairs unambiguous (weakest: 287 inliers vs 91 runner-up), median reprojection error 0.1 px, checked visually.
- Subject: lined notebook sheets with a letterhead, often stacked, on a dark patterned surface. The user's crop covers 49% to 80% of the frame.
- The photos are personal and must not be committed. The benchmark reads them from a path given on the command line.

## Design

### 1. Ingestion (all devices, gallery and camera)

On every image upload, before anything else:

1. **Decode.** Use the browser decoder. If it fails and the file is HEIC/HEIF (by type or extension), decode with a lazily loaded HEIC decoder. Needed because desktop Chrome and Firefox cannot open HEIC; iOS Safari normally converts HEIC to JPEG at upload, to be verified on a device.
2. **Apply EXIF orientation** (`createImageBitmap(..., { imageOrientation: 'from-image' })` or equivalent) so portrait camera photos are upright. This also covers the camera input (`capture="environment"`).
3. **Make a working copy** with the long edge at about 2000 px, used for detection, thumbnails and the editor. Keep the original `File` for export.
4. **Cap export canvases** to a safe pixel count (iOS Safari limits canvas area; the cap is a named constant, lowered if a canvas allocation fails).

The existing export path embeds JPEG bytes directly when no rotation or quality change applies. JPEG embedding ignores EXIF orientation, so camera photos may come out sideways today. This is unverified; step 2 removes the risk, and the direct-embed shortcut is only used for images that were already upright and uncropped.

### 2. Data model

Each image `PageItem` gains:

- `cropQuad`: four normalised corners (TL, TR, BR, BL) in working-copy space, or `null` for uncropped.
- `cropState`: `none | auto | manual | needs-review`.
- `cropConfidence`: 0 to 1, set by the detector.

Crops are non-destructive: reset clears `cropQuad`. Rotation (existing) is applied after the crop.

### 3. Detector (Phase 1, classical)

- Runs in a Web Worker so the UI stays responsive. OpenCV.js is fetched on first use, not at page load, and cached.
- Pipeline: downscale, grayscale and contrast normalise, edge detection, candidate quadrilaterals from contours, score each candidate, choose the best.
- **Stacked sheets:** score candidates by area, edge completeness, convexity and closeness to a rectangle, with a preference for the candidate that is fully inside the frame and has the strongest shadow-side edge. Lower sheets produce partially hidden, smaller or offset quads and should lose.
- **Output:** `cropQuad` and `cropConfidence`. Below a confidence threshold the page keeps the full frame, gets `needs-review`, and shows a badge. It is never silently mis-cropped.
- The detector is a pure module (`page-detect.js`) with no DOM access beyond the worker boundary, so the benchmark can run it in Node.

### 4. UI

- **Auto Crop button** in the toolbar (and mobile dock). Hidden when no image pages exist. Label shows the count, for example "Auto Crop (12)". Runs on image pages that are not `manual`, shows progress, and ends with a summary toast ("10 cropped, 2 need review").
- **Per-card Crop button** on image cards in the Pages view (and in the Documents view for single-image documents). Opens a modal editor: four draggable corner handles, a magnifier loupe while dragging, Reset, Cancel, Apply. Works with touch and mouse, keyboard-accessible handles, focus trap, Esc to close.
- A small state badge on cards: `auto`, `manual`, `needs review`.
- Visual style follows the existing design system (alabaster and terracotta, SVG icons, no emojis, `prefers-reduced-motion` honoured).

### 5. Export

When `cropQuad` is set, warp the original image at full resolution (capped per section 1) with a perspective transform into a rectangle whose width and height come from the quad's edge lengths. Rotation, scan-enhance and the A4 layout then run on the warped result exactly as they do for uncropped images.

### 6. Benchmark and testing

Defined before running anything, so the metric is not chosen after seeing results.

- **Primary metric:** quad IoU between predicted and ground-truth quad (polygon intersection over union) on the 41 photos.
- **Reported:** mean and median IoU, the fraction of pages with IoU at or above 0.90 and at or above 0.95, the 95% interval for those fractions (Wilson), and mean corner error as a fraction of the image diagonal.
- **Baselines shown beside the detector:** (a) the full-frame quad, (b) a fixed centre crop at the median ground-truth area. A detector that barely beats these is not working.
- **Error analysis:** list and view every page below 0.90 IoU, grouped by cause (stack confusion, low contrast, partial occlusion).
- **Gate for Phase 2:** if fewer than 85% of pages reach IoU 0.90, Phase 2 starts before the feature is promoted as reliable. The Phase 1 editor and `needs-review` flow ship regardless.
- **Other tests:** unit tests for quad ordering, polygon IoU and the perspective-size calculation (Node); headless Chrome checks of the UI flow (button visibility for PDF-only vs mixed uploads, editor apply and reset, export dimensions); `npm test` extended to include them.
- **Real devices:** an iPhone and an Android checklist (gallery pick, camera capture, portrait and landscape, a HEIC original) that the user runs, since headless desktop Chrome cannot cover it.

## Phase 2 (gated, outline only)

- Start from a pretrained browser-capable corner or segmentation model (candidates from the research: the `scanic-ml` DocCornerNet model, DocAligner; unread model cards and licences must be checked), run through ONNX Runtime Web, with the same quad post-processing and confidence flow as Phase 1.
- Datasets to consider for pretraining, licences to be verified: DocCornerDataset (Hugging Face), RWMD-Extended, MIDV-500/2020. None contains the stacked top-sheet case, so fine-tuning needs more of the user's photos, labelled with the Phase 1 editor.
- The 41 current photos are held out as the test set and are not trained on. Splits are by photo session, not by random photo, to avoid near-duplicate leakage.
- A model card (intended use, data, metrics with intervals, failure modes) is required before it ships.

## Out of scope

- Auto-cropping PDF pages.
- Dewarping curved or crumpled pages (only perspective correction).
- Server-side processing of any kind.
- Multi-page splitting of one photo containing several separate sheets.

## Files expected to change

- New: `page-detect.js` (detector), `crop-geometry.js` (quad math, shared and unit-tested), `crop-worker.js`, `crop-editor` markup and styles, `test_crop_geometry.js`, `bench_detector.js`.
- Changed: `app.js` (ingestion normalisation, Auto Crop and Crop wiring, export warp), `index.html`, `styles.css`, `package.json`, `AGENTS.md`.
