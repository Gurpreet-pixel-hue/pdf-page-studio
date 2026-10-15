# Page corner model (`doccorner-ft.ort`)

Finds the four corners of the top sheet in a photographed pile of paper, for Auto Crop.
1.98 MB, input 256x256 RGB (ImageNet-normalised, NHWC), outputs 8 normalised corner coordinates
(TL, TR, BR, BL) and one "page present" logit. Runs in the browser through ONNX Runtime Web
(about 25 ms per photo after a 32 ms one-off load, measured in headless desktop Chrome).

## Intended use
Suggest a crop for a phone photo of a sheet of paper (ruled notebook sheets, single pages or piles
with the page of interest on top). The user can always edit or redo the crop. Out of scope:
scanning anything other than paper pages, reading text, or any decision made without a person
looking at the result.

## Model
DocCornerNet (MobileNetV2 alpha 0.35 backbone, SimCC head), MIT, github.com/mapo80/DocCornerNet-CoordClass.
Starting point: the authors' `mobilenetv2_256_best` checkpoint. Fine-tuned here (TensorFlow 2.18.1 / Keras 3.12,
CPU) and converted: Keras -> ONNX (opset 13, checked against Keras to 5e-7) -> ORT format (Runtime optimisation
style; the Fixed style fuses ops that the minimal wasm does not have).

## Fine-tuning data
- 41 photos of the project owner's own notebook sheets on one dark patterned desk, with the owner's manual crops
  as labels (the only labelled piles; no public dataset labels only the top sheet of a pile). Not in this repository.
- The same photos with the desk replaced by real and synthetic backgrounds, with lighting and soft shadows varied
  (probability 0.7 per draw). Labels stay on the top sheet.
- 233 background photos taken from the negative set of `mapo80/DocCornerDataset` (COCO-derived, mixed licences, see below).
- 616 photos of the Mendeley "A New Image Dataset for Document Corner Localization" (CC BY 4.0,
  DOI 10.17632/x3nm4cxr83.1), sampled in 20% of draws. 153 further Mendeley photos were held out for testing.
  314 portrait or EXIF-rotated photos, 6 with out-of-frame labels and 5 tiny ones were skipped.

Recipe: Adam, lr 1e-4 cosine to 1e-6, 40 epochs x 8 augmented draws per photo, batch 8, loss = SimCC cross-entropy
+ 0.5 L1 on coordinates, BatchNorm frozen, seed 0 (one seed only, so no seed-to-seed variance is reported).

## Evaluation
5-fold cross-validation over contiguous photo blocks; every photo is scored only by a model that never saw it.
Pre-registered "usable" = no more than 1% of the page's ink cut off AND at least 90% of the owner's crop covered
AND at most 10% of the crop outside the owner's crop. Goal was 90% usable; it was **not reached**.

| model | usable (of 41) | IoU vs manual crop | usable on unseen backgrounds | Mendeley test IoU (153 photos) |
|---|---|---|---|---|
| fixed 10% inset | n/a | 0.744 | n/a | n/a |
| pretrained, no fine-tuning | 22 (54%, CI 39-68%) | 0.900 | 22 | 0.870 |
| fine-tuned, plain | 33 (80%) | 0.934 | 33 | n/a |
| + background swap | 34 (83%) | 0.935 | 34 | n/a |
| **+ Mendeley (shipped recipe)** | **35 (85%, CI 72-93%)** | **0.936** | **35** | **0.897** |

Differences between the fine-tuned variants are one or two photos and are not significant. Confidence intervals
are 95% binomial over 41 photos. The shipped weights are trained on all 41 photos, so their score on those photos is
not meaningful; the table above is the honest estimate. Browser and Python predictions of the shipped model differ by
a mean 0.005 of the frame (max 0.017) on the 41 photos, from different image-resize code.

## Limits
- All labelled piles share one desk, one lighting and one camera. Performance on other tables, other paper
  and other phones is unmeasured; the Mendeley result (no piles) is the only evidence outside that setup.
- About 15% of the owner's photos still crop slightly inside the sheet edge, cut off content, or include a sliver
  of a lower sheet. The "confidence" shown to the app is the page-present score; it does not predict these misses.
- Portrait/rotated photos were excluded from the Mendeley data, so that augmentation of orientation is untested.

## Licences and attribution
- Weights derive from DocCornerNet (MIT). Its checkpoint was trained on DocCornerDataset, whose parts have mixed
  licences (MIDV and SmartDoc are research-use; COCO CC BY 4.0). Check this before redistributing the weights
  commercially.
- Mendeley dataset: CC BY 4.0, cite DOI 10.17632/x3nm4cxr83.1.
- Weights were trained on the owner's private photos; the photos are not distributed.

## Reproduce
`tools/model/` has the fine-tune, export and reference scripts. They expect the (private) ground-truth files and
the pools described above in a working directory, so the data-preparation step is not one command.
`python finetune.py --seed 0 --final --epochs 40 --draws 8 --rebg_p 0.7 --mend_p 0.2`, then `export_onnx.py`, then
`python -m onnxruntime.tools.convert_onnx_models_to_ort <dir> --optimization_style Runtime`.
Owner: the project maintainer. Re-evaluate whenever the weights change.


---

# Section-start model (`section-features.ort` + `section-head.json`)

Finds the pages of a scanned lab journal where an experiment or assignment starts, for **Find page numbers**.
Input: the top strip (rows 3% to 20%) of one page, resized to 576x192, pixels scaled to -1..1 (MobileNetV2
`preprocess_input`). Output: 1280 features from MobileNetV2 alpha 1.0 (ImageNet weights, about 8.9 MB, fetched once
and then cached); `section-head.json` holds a logistic-regression head (`w`, `b`, `cutoff`) that turns them into one
score per page. Runs in the browser through the vendored minimal ONNX Runtime Web (output matches Python to 1.6e-5).

## Intended use
Suggest which pages begin a section so the user can write page numbers on a contents page. Always shown with the
heading picture of each page and correctable by the user. Out of scope: reading the heading text or number, telling
experiments from assignments, any journal layout other than lined paper with a handwritten "Experiment No. N" heading.

## Data
Three scanned journals by the same student on the same college stationery (CN 41 pages, DWM 36, WMC 72; 149 pages,
34 section starts, true starts read by eye). Personal; not distributed. The WMC journal also has printed
"EXPERIMENT NO. N" code pages that are not starts. The shipped head is trained on all three.

## Evaluation (leave-one-journal-out: the head is trained on two journals and scored on the third)
Cut-off 1.5 columns show pages missed / wrong pages proposed. "Top-N" is the number of true starts found when the app
takes the N best pages (N = true number of starts).

| backbone | CN AUC / top-N / cut-off | DWM AUC / top-N / cut-off | WMC AUC / top-N / cut-off |
|---|---|---|---|
| alpha 0.35 (1.5 MB) | 1.000 / 12 of 12 / 1 missed, 0 wrong | 0.989 / 10 of 11 / 4 missed, 0 wrong | 0.975 / 9 of 11 / 5 missed, 2 wrong |
| alpha 0.5 (3.2 MB) | 1.000 / 12 of 12 / 3 missed, 0 wrong | 0.985 / 10 of 11 / 5 missed, 0 wrong | 1.000 / 11 of 11 / 1 missed, 0 wrong |
| alpha 0.75 (5.9 MB) | 1.000 / 12 of 12 / 5 missed, 0 wrong | 0.960 / 9 of 11 / 4 missed, 0 wrong | 0.993 / 10 of 11 / 4 missed, 0 wrong |
| **alpha 1.0 (8.9 MB, shipped)** | **1.000 / 12 of 12 / 2 missed, 0 wrong** | **1.000 / 11 of 11 / 3 missed, 0 wrong** | **1.000 / 11 of 11 / 0 missed, 0 wrong** |

Only alpha 1.0 passed the gate (AUC at least 0.99 on each journal, top-N within one of exact, no wrong page above the
cut-off), so the model budget was raised from 4 MB to 10 MB. Smaller backbones are an option if download size matters
more than the DWM and WMC accuracy.

Score gaps of the shipped pipeline, held out: CN true starts at least 1.12, best non-start -1.05; DWM lowest true
starts -0.71 (a duplicate photo) and 0.06, best non-start -1.05; WMC true starts at least 1.62, best non-start 1.26.
No single threshold separates all three, which is why:
- with a contents page the app takes the best N pages but never one scoring at or below -0.5 (`DEFAULT_FLOOR`). The
  floor only guards against pages that look nothing like a heading: on WMC 24 printed code pages score between -0.5
  and 1.3 and are not screened out (they matter only if the entered count exceeds the real headings; they are then
  marked "Unsure");
- without a contents page it proposes pages above 1.5 (`DEFAULT_CUTOFF`: no wrong page on any journal, held out, but it
  missed 2 on CN and 3 on DWM) and lists the next ten pages for one-tap adding.
Both numbers were chosen after seeing these three journals; they are tuned defaults, not held-out results.

## Local end-to-end run (in-sample, tools/ui/pagefinder-real.js)
Headless Chrome on a Mac: CN 41 pages in 12.2 s (297 ms per page), DWM 36 pages in 8.2 s (226 ms), WMC 72 pages in
17.3 s (240 ms). Browser scores agree with Python (mean absolute difference 0.13 to 0.18, max 0.98) and the browser picks
the same top-N pages. These journals are in the training set, so the accuracy of this run is not an estimate; it shows
the browser pipeline matches Python. Phone speed is not measured.

## Limits
- One student, one stationery: other layouts are unmeasured.
- Adjacent duplicate photos of the same heading both score as headings.
- Contents-photo entry counting (`index-scan.js`): reads a drawn table but counted 0 of 3 real contents pages (tilted,
  paler lines); the app then says so and the user types the entry count. One adjustment pass (skew search, hue-based
  line detection) counted CN correctly in one variant but did not read DWM or WMC.
- The first scan downloads about 9 MB (model) once; the browser caches it.

## Reproduce
`tools/model/sections_eval.py` (evaluation), `tools/model/sections_export.py 1.0` (train head, export, reference files;
`--scores-only` rewrites only the local reference scores). They need the private PDFs and
`~/Documents/page_crop_ground_truth/journals.json`. Environment pinned in `tools/model/requirements-sections.txt`.
