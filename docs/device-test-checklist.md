# Device test checklist: photo upload and crop

Headless desktop Chrome cannot cover real phones, and nothing here has been run on one yet. Run this on a real iPhone (Safari and Chrome) and a real Android phone (Chrome) before relying on the feature. Use the deployed site or a local build.

## For each device and browser (iPhone Safari, iPhone Chrome, Android Chrome)

Do each upload both ways: **Add More / Choose from gallery** and **Scan (camera)**.

1. Pick 3 photos from the gallery: one portrait, one landscape, one taken sideways.
   - Expect: every page shows upright in the grid. None is rotated.
2. Tap Scan (camera) and take a photo of a sheet in portrait, then another in landscape.
   - Expect: both appear upright.
3. On an iPhone, pick a photo taken as HEIC (the default camera format).
   - Expect: it ingests without an error (iOS converts to JPEG during the pick).
4. First tap on Auto Crop on a phone connection.
   - Expect: a progress overlay (the model and runtime, about 3.5 MB, load once), then a toast such as "3 cropped, 1 need review". Check in the browser's network panel (Android Chrome remote debugging or Safari Web Inspector) that `models/doccorner-ft.ort`, `vendor/ort/ort-wasm-simd-threaded.wasm` and `.mjs` return 200 with a JavaScript content type for the `.mjs` files.
5. Look at the auto-cropped pages.
   - Expect: a clean single sheet, little of the sheet below it. A little of the top sheet's edge missing is acceptable; missing text is not. Note any page where text is cut off or a lower sheet shows.
6. Tap Crop on one page. Drag each corner with a finger; check the loupe shows above your finger and the corner stays put.
   - Expect: Apply stays disabled while corners cross; Apply works once they outline the page.
7. Export PDF with a mix of cropped and uncropped pages.
   - Expect: pages are upright; cropped pages are straight, edge to edge; no page is blank.
8. Upload only PDF files.
   - Expect: no Auto Crop button, and no Crop button on any page.
9. Upload a very large photo (a 12 MP or larger original, not a screenshot).
   - Expect: it ingests, crops and exports; no crash or blank page.

## Desktop (Chrome, Safari, Firefox)

1. Drag a HEIC file onto the page.
   - Expect: no page is added and a message tells you to pick it from the phone gallery or convert it to JPEG first.
2. Repeat steps 4 to 8 above with the mouse and keyboard (arrow keys nudge a focused corner, Esc closes the editor, Tab stays inside it).

Record any failure with the device, OS version, browser, and the photo's origin (camera or gallery).
