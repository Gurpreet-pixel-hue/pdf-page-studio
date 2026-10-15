# Find Page Numbers (journal index numbering): Design

Status: draft for review. Date: 2026-10-15. Scope: one feature, built in the browser with no uploads.

## Goal

A student has a scanned lab journal (a PDF of photographed pages) and a handwritten contents page. They need to know which page each experiment and assignment starts on, so they can write the numbers into the contents page. The user uploads the journal PDF, optionally a photo of the contents page, and gets a typed result:

```
Experiment 1 – page 3
Experiment 2 – page 5
...
Assignment 2 – page 34
```

The result can be wrong in ways the user cannot see by looking at one number, so the screen shows evidence for every number and lets the user correct it in one tap.

## Decisions already made (from the user)

- A **Find page numbers** button on the landing page starts the flow.
- **Without an index** the app still finds the section start pages by their uniform handwritten heading ("Experiment No. N", "Assignment No. N"). **Uploading the contents-page photo is optional and makes the result more accurate.**
- The user can choose how pages are counted: **count extra front pages** (certificate, index, anything else) on top of the PDF's own page count, or **use the PDF's page numbers as they are**. The app asks; it does not assume.
- If the PDF lacks the certificate and index, numbers are normally shifted by 2. If the app cannot tell whether they are present, it asks.
- The result uses **typed text** ("Experiment 1 – page 3").
- Everything runs on the user's device (see `AGENTS.md`: no uploads).

## Evidence that shapes the design (measured on the user's three journals)

Journals: CN (41 pages, certificate + index at pages 1–2), DWM (36 pages, no certificate or index), WMC (72 pages, no certificate or index). All pages are photographs, so the PDFs have no text layer. All three are the same student's notebooks on the same college paper, so other layouts are unproven. True start pages were read by eye (they are the ground truth and are not committed).

| Journal | True start pages |
|---|---|
| CN | 3, 5, 8, 10, 12, 16, 18, 20, 22, 24, 26, 34 |
| DWM | 1, 3, 5, 7, 10, 13, 15, 16, 17, 20, 26 |
| WMC | 1, 7, 10, 18, 23, 35, 42, 49, 54, 59, 68 |

1. **Reading the heading text is not feasible.** tesseract.js read 0 of 12 headings on CN. TrOCR (small, handwritten) with a clean crop of the heading line read 0 of 23 numbers and 3 of 23 word types correctly. So the app cannot print "Experiment 6" from the page.
2. **Recognising a heading page works across notebooks.** A MobileNetV2 (ImageNet) feature vector of the top strip of each page (rows 3% to 20%, resized 576×192) plus logistic regression, trained on two journals and tested on the third, ranks the true start pages first: AUC 1.000 on CN and WMC, 0.996 on DWM. Picking the top N pages (N = number of true starts) was exact on CN (12/12) and WMC (11/11), and 10/11 on DWM when trained on the other two.
3. **The number of start pages cannot be chosen by one automatic cut-off.** Score distributions differ per journal (WMC has many mid-scoring printed code pages). `score > 1.5` gave no wrong pages on any journal but missed 1 (CN), 3 (DWM), 0 (WMC); `score > 0` flagged 31 pages on WMC where only 11 are true starts. This cut-off was picked after seeing these three journals, so it is a tuned default, not a held-out result.
4. **The index count removes that problem.** Given the number of entries N, taking the top N is exact on CN and WMC (see 2).
5. **Printed "EXPERIMENT NO. N" code pages in WMC are not starts** (pages 4, 13, 27, 39, 52, 57). They ranked 14th to 56th of 72, below every true start.
6. **The classifier cannot tell "Assignment" from "Experiment"** (top-2 assignment guess wrong on all three). So typed names come from counts, not from the page.
7. **No single score threshold works for all three journals, but a floor does.** Held-out scores: CN true starts >= 1.33 and the best non-start -0.58; DWM lowest true start -0.78 (a duplicate page) and best non-start -0.75; WMC true starts >= 1.71 and best non-start 1.20. So the best-N pick is only trusted above a floor of -0.5, where no non-heading page was found.
8. **A journal can contain fewer sections than its index.** DWM's index lists 13 entries (11 experiments, 2 assignments) but the PDF has headings for Experiments 1–8 (pages 16 and 17 both say "Experiment No. 8", a duplicate photo) and the two assignments; Experiments 9–11 are absent. Matching headings to entries purely by order would label Assignment 1 as Experiment 9.

## Design

### 1. Flow (a modal flow, same look as the split and export dialogs)

1. **Choose files.** Journal PDF (required; picks a file, or one of the PDFs already added). Contents-page photo (optional; JPEG/PNG/WebP, gallery or camera). A note says what the optional photo improves.
2. **Scan.** Progress bar with a Cancel button: "Checking page 12 of 72…". Nothing is stored.
3. **Result** (one screen):
   - A typed table, one row per section: label, page number (after the counting choice), and a thumbnail of that page's heading so the user can confirm at a glance. Tapping the page number opens a **page picker** (all candidate pages ranked, plus "not in this PDF").
   - **Counting question**, always visible and pre-answered (section 4).
   - **Names** (section 5).
   - Warnings (section 6).
   - **Copy** puts the typed lines on the clipboard. **Back** returns to step 1.

### 2. Finding heading pages (`section-detect.js`)

- Render only the top strip of each PDF page (pdf.js, page destroyed after use so memory stays flat on a 95 MB PDF), crop rows 3%–20%, resize to 576×192, normalise like ImageNet.
- Run a small image model in the browser through the ONNX Runtime Web build already vendored for Auto Crop (`vendor/ort`, minimal wasm). Multiply the 1280-d feature by the logistic-regression weights to get a score per page. The model, the weights and a model card ship in `models/`.
- Output: `{ page, score }` for every page, plus the page's top-strip thumbnail (a small blob) for the result screen.
- Model choice is a gated decision made in the plan's first task: candidates are MobileNetV2 1.0 (about 9 MB fp32, 2–3 MB quantised) and MobileNetV2 0.35 (about 1.4 MB). The smallest that keeps the leave-one-journal-out result (AUC ≥ 0.99 on each journal, top-N within one page of exact on each, no extra page above the 1.5 cut-off; the full-size baseline got 10/11 on DWM) and numerical parity with the Python reference (feature difference below 1e-3) ships. Model and runtime load lazily on first use; budget under 4 MB.
- **Deciding which pages are headings:**
  - **With an index:** the top N pages by score, where N is the number of entries, but never a page scoring at or below the floor (-0.5). If fewer than N pages qualify, the remaining entries say "Page not found" instead of being filled with pages that do not look like headings; marking an entry "not in this PDF" moves the later entries up.
  - **Without an index:** pages with `score > 1.5` are proposed as sections. The result screen shows "N more possible pages" (the next ten by score, with thumbnails) so a missed heading is one tap to add. The default errs toward missing a page over adding a wrong one.
- A page is never a section start twice: if two pages in a row both score above the cut-off the app keeps both candidates but shows "Two heading pages in a row (16, 17): check which is the start."

### 3. The optional contents-page photo (`index-scan.js`)

The photo provides the entry count and a crop of each entry for the user to recognise.

1. Find the page in the photo with the existing Auto Crop detector (or the user's manual crop in the existing crop editor) and warp it upright (`CropGeometry.warpPerspective`).
2. Estimate the entry count N from the Sr. No. column: locate the table's vertical rules, take the narrow first column, count the separate vertical ink groups (one handwritten number per entry). The estimate is shown in an editable stepper ("The contents page lists 13 entries"). The user's value always wins.
3. Where the row boundaries are found, each entry gets a crop of its handwriting for the result row. Where they are not, rows show only the entry number; nothing else depends on the crops.
4. Entry crops are used only as labels. They are never read as text.

This step has not been measured yet (the count estimator and row crops are untested on the three contents pages: CN raw photo and its crop, DWM raw photo, WMC clean scan, which has an "ASSIGNMENTS" divider row and a pre-filled page number). The plan measures it first and keeps the editable stepper as the fallback, so a failed estimate costs one correction, not the feature.

### 4. Counting extra pages

- `front = (first section page) − 1`, the number of pages before the first heading (certificate, index, other).
- The question reads: *Number pages: (•) as in this PDF  ( ) counting extra front pages: [2]*.
- Pre-answer: `front ≥ 2` (certificate and index are already in the PDF): "as in this PDF". `front = 0` (DWM, WMC): "counting extra front pages" with `2`. `front = 1`: no pre-answer, and the text says "1 page before the first heading, is that the certificate or the index?" until the user picks.
- With the extra-pages choice every page number is `pdf page + n`. The value of n is editable (0–20) so "any other additional pages" works. The result screen states the rule in words ("Page numbers include 2 pages in front of this PDF") so a copied list is never ambiguous.

### 5. Names

Typed labels cannot be read from the pages, so they come from counts the user can see and edit:

- Entry count N (index count, or the number of sections found).
- **"Assignments at the end: [A]"**, pre-filled with 2 (all three journals end with 2 assignments; the field is always visible and editable).
- Labels are "Experiment 1…N−A" then "Assignment 1…A". Each label can be edited by typing, so a user who wants the full title can type it.

### 6. Warnings and reconciliation (shown inline, never blocking)

- Index count differs from sections found ("Your contents page lists 13 entries but only 10 pages clearly look like headings"): the entries without a page say "Page not found" and the page picker offers "Not in this PDF". The user marks the entries that are missing from the PDF; the entries after them move up to the next heading pages. Each row shows the picture of its heading, so a wrong match is visible.
- Two clear heading pages in a row: one warning names the pair (unclear picks are not counted, so junk pages do not flood the screen).
- A section page with a low score (below the cut-off but chosen because the index needs N) is marked "unsure".
- Cancelled or failed scans (unreadable PDF, zero pages) show a plain message and no partial result.

### 7. Files and integration

New: `section-detect.js` (render strip, run model, score), `page-finder.js` (pure logic: picking sections, order mapping, numbering offsets, labels; Node-testable), `index-scan.js` (contents-page crop, count, row crops), `page-finder-ui.js` and a modal in `index.html`, `models/section-*.ort` + weights + a section in `models/MODEL_CARD.md`, `tools/model/sections_*.py` (feature export, training, leave-one-journal-out evaluation; they need the private PDFs and are documented, not run in CI). The landing page gets the button; the empty state keeps its layout. `AGENTS.md` gets a new section, versions bumped.

## Testing

- **Pure logic (`test_page_finder.js`, written first):** picking top N and by cut-off, ordering, ties, duplicate-in-a-row detection, offset arithmetic for every counting case (`front` 0, 1, 2, 3+, user-edited n), label generation for any N and A including A = 0 and A ≥ N, missing-entry reconciliation, page numbers never below 1.
- **Model gate (Python, private data):** leave-one-journal-out on CN, DWM, WMC: top-N exact on each, AUC ≥ 0.99, printed-heading pages not in the top N; plus parity of the browser features with Python (< 1e-3) on a sample of pages.
- **Browser scenarios (`tools/ui/pagefinder.js`):** synthetic journals built from generated pages: heading pages with a printed-looking heading, plain pages, a printed "EXPERIMENT NO." confuser. Covers the full flow, cancel, counting choices, name editing, copy output text, an unreadable PDF, and a 72-page scan finishing with progress. The three real journals are an optional local run through `UI_CHECK_FIXTURES`, like the existing photo scenarios, because they are personal.
- **Responsive/phone:** the modal flow checked at 390 px and 800 px (existing `responsive.js` pattern).

## Acceptance (on the three journals, local run)

1. With the correct entry count (CN 12, WMC 11) the proposed pages equal the true starts. DWM's index lists 13 entries but only 10 pages look like headings (Experiments 9–11 are not in the PDF; page 16 is a duplicate "Experiment No. 8" below the floor): the app shows the mismatch warning, entries 11–13 say "Page not found", and after the user marks Experiments 9–11 "Not in this PDF" the two assignments move up to their correct pages.
2. Without an index, no wrong page is proposed on any journal, and every true start page is among the proposed pages or the "more possible pages" list.
3. The counting question's pre-answer is "as in this PDF" for CN and "extra front pages: 2" for DWM and WMC.
4. The copied text for each journal reads as typed lines with the counting rule stated.

## Out of scope for this version

Reading heading text or numbers; telling experiments from assignments automatically; matching the contents photo to the PDF's page 2 as extra evidence; HEIC contents photos (same limit as the rest of the app); landscape or rotated journal pages; journals with a different heading layout than these three (the result screen is built so a miss is correctable, but accuracy there is unmeasured); saving results between visits.

## Risks

- Same student, same stationery in all three journals: the classifier may be weaker on other layouts. Mitigation: the correction UI, honest wording on the screen, and the acceptance numbers recorded in the model card.
- Scanning a 70-page PDF on a phone is slow. Mitigation: render only the top strip, progress and Cancel, no work before the user starts.
- Contents-page count and row crops are unmeasured (section 3). Mitigation: measure first, editable fallback.
- Typed labels depend on the user's assignment count; a wrong default is visible and editable.
