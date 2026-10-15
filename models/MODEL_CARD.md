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
