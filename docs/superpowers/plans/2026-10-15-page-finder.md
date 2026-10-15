# Find Page Numbers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Find page numbers" flow that scans a journal PDF, finds the page where each experiment or assignment starts, and returns typed lines ("Experiment 1 – page 3"), optionally using a photo of the handwritten contents page for accuracy.

**Architecture:** A small image model (MobileNetV2 features of each page's top strip, plus a logistic-regression head) scores every PDF page for "a section starts here". Pure logic in `page-finder.js` turns scores into sections, numbers and typed labels. A modal flow (`page-finder-ui.js`) lets the user confirm and correct everything. The optional contents photo gives the entry count and row crops through classical image analysis (`index-scan.js`). Nothing is uploaded.

**Tech Stack:** Vanilla JS (no build step), pdf.js (already vendored), ONNX Runtime Web with the minimal wasm already in `vendor/ort`, Python (TensorFlow, scikit-learn, PyMuPDF, tf2onnx) for the offline model work, headless Chrome UI scenarios (`tools/ui-check.js`).

**Spec:** `docs/superpowers/specs/2026-10-15-page-finder-design.md`

## Global Constraints

- Everything runs in the browser: no uploads, no server (`AGENTS.md`).
- Vanilla JS, no build step, no new CDN dependencies. New browser modules are UMD files loaded by `<script>` tags in `index.html`, the way `crop-state.js` and `doc-groups.js` are.
- Design system: warm alabaster and terracotta, SVG icons only, **no emojis**, spacing and radii from the existing CSS variables.
- Conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`). **No AI attribution and no `Co-authored-by` lines** in commits.
- `AGENTS.md` is updated with every code change. `CLAUDE.md` files are read-only.
- Never commit the user's personal files: the three journal PDFs, the contents-page photos, the ground-truth file. They live in iCloud Drive / the scratchpad; scripts read them from paths given on the command line.
- Model input scaling is MobileNetV2's `preprocess_input`: **pixel / 127.5 − 1** (range −1..1), NHWC, input 192 rows × 576 columns. It is not ImageNet mean/std.
- Strip geometry: rows 3% to 20% of the page height, full width, resized to 576×192.
- New or changed browser assets bump the version to 2.9.0 (query strings in `index.html`, `ASSET_VERSION` in `app.js`).
- Lazy loading: the section model, its head and the ONNX runtime are fetched only when the user starts a scan. Budget: under 10 MB for model + head (alpha 1.0 fp32 is about 9 MB; fetched once, then cached; runtime wasm is already vendored).

## Review Focus

1. A PDF with **no heading page at all** (all pages plain): the result must say nothing was found and offer the ranked candidates, not return an empty or crashing screen. (Task 2 test, Task 7 scenario.)
2. **More entries than heading pages found** (DWM: 13 entries, 10 headings): entries with no heading-like page say "Page not found" and can be set "not in this PDF"; no entry is filled with a page that does not look like a heading. (Task 2 test, Task 6 scenario.)
3. **Two clear heading pages in a row**: one visible warning names the pair, and both stay available in the page picker. (Task 2 test, Task 6 scenario.)
4. **Cancel mid-scan** and **an unreadable or password-protected PDF**: the dialog returns to the choose step with a plain message; no partial table, no stuck progress bar. (Task 3 test, Task 7 scenario.)
5. **Counting choices**: `front` of 0, 1 and 2+, and an edited extra-page value of 0 or 20: numbers are always `pdf page + extra`, never below 1, and the sentence under the table states the rule. (Task 2 test, Task 6 scenario.)

## File Structure

| File | Responsibility |
|---|---|
| `page-finder.js` (new) | Pure logic: ranking, picking sections, duplicates, front-page count, counting choices, labels, entry-to-page assignment, result text. Node-testable. |
| `test_page_finder.js` (new) | Unit tests for `page-finder.js`. |
| `section-detect.js` (new) | Browser: render each PDF page's top strip with pdf.js, run the feature model through ONNX Runtime Web, apply the logistic head, return scores and heading thumbnails. Also exports pure helpers (`preprocessStrip`, `scoreFeatures`). |
| `test_section_detect.js` (new) | Unit tests for the pure helpers. |
| `index-scan.js` (new) | Pure image analysis on RGBA data: table rules, entry count, entry row bands. Browser helper to warp the photo and crop entries. |
| `test_index_scan.js` (new) | Unit tests on synthetic tables. |
| `page-finder-ui.js` (new) | The modal flow: choose, scan, result, picker, warnings, copy. |
| `index.html` (modify) | Landing-page button, `#finder-modal` markup, script tags, version bump. |
| `styles.css` (modify) | Styles for the finder modal and rows. |
| `app.js` (modify) | Button wiring, `ASSET_VERSION`. |
| `models/section-features.ort`, `models/section-head.json` (new) | Shipped model files. |
| `models/MODEL_CARD.md` (modify) | Section model card: data, metrics, limits, retrain commands. |
| `tools/model/sections_common.py`, `sections_eval.py`, `sections_export.py` (new) | Offline feature extraction, leave-one-journal-out evaluation, export. |
| `tools/ui/section-model.js`, `pagefinder.js`, `pagefinder-real.js` (new) | Browser scenarios: model parity, full flow with a fake detector, optional local run on the real journals. |
| `docs/device-test-checklist.md`, `AGENTS.md`, `README.md` (modify) | Docs. |

---

### Task 1: Section model: evaluate backbones, export, prove browser parity

**Files:**
- Create: `tools/model/sections_common.py`, `tools/model/sections_eval.py`, `tools/model/sections_export.py`, `tools/model/requirements-sections.txt`
- Create: `models/section-features.ort`, `models/section-head.json`
- Create: `tools/ui/section-model.js`, `tools/model/section_ref.json`
- Modify: `models/MODEL_CARD.md`, `.gitignore` (ignore `.venv-sections/`)

**Interfaces:**
- Consumes: the three private journals and their true start pages (a local JSON file, step 1); `vendor/ort` runtime.
- Produces: `models/section-features.ort` (input `[1,192,576,3]` float32 in −1..1, first output `[1,1280]` features), `models/section-head.json` (`{ "w": [1280 numbers], "b": number, "cutoff": 1.5, "backbone": "...", "trained_on": [...] }`), and `tools/model/section_ref.json` (reference features for a fixed test input, used by the parity scenario).

This task is data dependent and runs locally, not in CI. Its output is committed model files plus recorded numbers.

- [ ] **Step 1: Create the private ground-truth file (not committed)**

Create `~/Documents/page_crop_ground_truth/journals.json` (private, outside the repo):

```json
{
  "CN":  { "pdf": "/Users/shridhartawate/Library/Mobile Documents/com~apple~CloudDocs/Merged_Document.pdf",
           "starts": [3, 5, 8, 10, 12, 16, 18, 20, 22, 24, 26, 34] },
  "DWM": { "pdf": "/Users/shridhartawate/Library/Mobile Documents/com~apple~CloudDocs/Dwm doc.pdf",
           "starts": [1, 3, 5, 7, 10, 13, 15, 16, 17, 20, 26] },
  "WMC": { "pdf": "/Users/shridhartawate/Library/Mobile Documents/com~apple~CloudDocs/Wmc doc.pdf",
           "starts": [1, 7, 10, 18, 23, 35, 42, 49, 54, 59, 68] }
}
```

Run: `python3 -c "import json,os;d=json.load(open(os.path.expanduser('~/Documents/page_crop_ground_truth/journals.json')));print({k:len(v['starts']) for k,v in d.items()})"`
Expected: `{'CN': 12, 'DWM': 11, 'WMC': 11}`

- [ ] **Step 2: Create the Python environment**

```bash
python3 -m venv .venv-sections
./.venv-sections/bin/pip install tensorflow==2.18.1 scikit-learn pymupdf opencv-python-headless tf2onnx==1.17.0 onnx==1.17.0 onnxruntime==1.23.2 "protobuf>=5.26,<6" numpy
./.venv-sections/bin/pip freeze | grep -iE "^(tensorflow|keras|scikit-learn|pymupdf|opencv-python-headless|tf2onnx|onnx|onnxruntime|protobuf|numpy)==" > tools/model/requirements-sections.txt
printf '\n# Section model environment\n.venv-sections/\n' >> .gitignore
```

Expected: `tools/model/requirements-sections.txt` lists pinned versions (record them, they are the reproducibility record).

- [ ] **Step 3: Write the shared feature code**

Create `tools/model/sections_common.py`:

```python
"""Shared code for the section-start model: strip rendering and MobileNetV2 features.

Strip = rows 3%..20% of the page, full width, rendered at 900 px wide, resized to 576x192.
Pixels are scaled with MobileNetV2's preprocess_input (pixel / 127.5 - 1).
"""
import json, os
import cv2, numpy as np
import pymupdf

STRIP_TOP, STRIP_BOTTOM = 0.03, 0.20
STRIP_W, STRIP_H = 576, 192
RENDER_W = 900


def render_strips(pdf_path):
    """Return a list of RGB uint8 arrays (STRIP_H x STRIP_W x 3), one per page."""
    doc = pymupdf.open(pdf_path)
    out = []
    for page in doc:
        scale = RENDER_W / page.rect.width
        pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale))
        img = np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w, pix.n)[:, :, :3]
        h = img.shape[0]
        strip = img[int(h * STRIP_TOP):int(h * STRIP_BOTTOM)]
        out.append(cv2.resize(strip, (STRIP_W, STRIP_H), interpolation=cv2.INTER_AREA))
    return out


def preprocess(strips):
    return np.stack([s.astype(np.float32) / 127.5 - 1.0 for s in strips])


def backbone(alpha):
    import tensorflow as tf
    return tf.keras.applications.MobileNetV2(
        include_top=False, weights='imagenet', alpha=alpha,
        input_shape=(STRIP_H, STRIP_W, 3), pooling='avg')


def load_journals(path=None):
    path = path or os.path.expanduser('~/Documents/page_crop_ground_truth/journals.json')
    return json.load(open(path))
```

Run: `./.venv-sections/bin/python -c "import sys; sys.path.insert(0,'tools/model'); import sections_common as c; s=c.render_strips(c.load_journals()['DWM']['pdf']); print(len(s), s[0].shape)"`
Expected: `36 (192, 576, 3)`

- [ ] **Step 4: Write the leave-one-journal-out evaluation**

Create `tools/model/sections_eval.py`:

```python
"""Leave-one-journal-out evaluation of the section-start classifier for several backbones.
Usage: python tools/model/sections_eval.py [alpha ...]   (default: 0.35 0.5 0.75 1.0)
Reports, for each held-out journal: AUC, top-N correct (N = true starts), rank of the worst true start,
and the fixed-cutoff outcome (score > 1.5: missed / extra)."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
import sections_common as C

CUTOFF = 1.5


def features_for(alpha, journals):
    net = C.backbone(alpha)
    out = {}
    for name, j in journals.items():
        strips = C.render_strips(j['pdf'])
        out[name] = net.predict(C.preprocess(strips), verbose=0)
    return out


def main():
    alphas = [float(a) for a in sys.argv[1:]] or [0.35, 0.5, 0.75, 1.0]
    journals = C.load_journals()
    for alpha in alphas:
        feats = features_for(alpha, journals)
        print(f'--- MobileNetV2 alpha={alpha}')
        for held in journals:
            train = [k for k in journals if k != held]
            X = np.vstack([feats[k] for k in train])
            y = np.concatenate([[p in journals[k]['starts'] for p in range(1, len(feats[k]) + 1)] for k in train]).astype(int)
            model = LogisticRegression(C=0.1, max_iter=4000, class_weight='balanced').fit(X, y)
            s = model.decision_function(feats[held])
            truth = set(journals[held]['starts'])
            n = len(truth)
            order = np.argsort(-s)
            top = {int(i) + 1 for i in order[:n]}
            yh = np.array([p in truth for p in range(1, len(s) + 1)]).astype(int)
            rank = {int(i) + 1: r + 1 for r, i in enumerate(order)}
            flagged = {p + 1 for p in np.where(s > CUTOFF)[0]}
            print(f'{held}: AUC {roc_auc_score(yh, s):.3f} | top-{n} correct {len(top & truth)}/{n} | worst true start ranks {max(rank[p] for p in truth)} of {len(s)} | cutoff {CUTOFF}: missed {len(truth - flagged)}, extra {len(flagged - truth)}')


if __name__ == '__main__':
    main()
```

- [ ] **Step 5: Run the evaluation and choose the backbone**

Run: `./.venv-sections/bin/python tools/model/sections_eval.py 2>&1 | grep -v Warning | tee /tmp/sections_eval.txt`

Gate (a backbone passes when all hold): AUC ≥ 0.99 on each held-out journal; top-N correct is at least N−1 on each (the full-size baseline got 10/11 on DWM); the fixed cutoff 1.5 leaves **zero extra pages** on each. Choose the smallest `alpha` that passes. Record the whole table in `models/MODEL_CARD.md` (Task 8) and note the chosen alpha here in the commit message of Step 9.
Expected: at least `alpha=1.0` passes (matches the earlier experiment: AUC 1.000 / 1.000 / 0.996, extras 0).

If no alpha under 1.0 passes, ship alpha 1.0 and add a quantisation step (below) to meet the size budget; if it still exceeds 4 MB, stop and ask the user whether a larger first-use download is acceptable.

- [ ] **Step 6: Write the export script (backbone to ORT, head to JSON)**

Create `tools/model/sections_export.py`:

```python
"""Train the final head on all three journals and export the shipped files.
Usage: python tools/model/sections_export.py ALPHA
Writes models/section-features.ort, models/section-head.json, tools/model/section_ref.json."""
import sys, os, json, subprocess, shutil, tempfile
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
import tensorflow as tf
from sklearn.linear_model import LogisticRegression
import sections_common as C

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def ref_input():
    """A fixed, reproducible test tensor shared with the browser parity scenario."""
    n = C.STRIP_H * C.STRIP_W * 3
    ramp = np.array([((i * 2654435761) % 2 ** 32) % 1000 / 1000.0 for i in range(n)], dtype=np.float32)
    return (ramp * 2.0 - 1.0).reshape(1, C.STRIP_H, C.STRIP_W, 3)


def main():
    alpha = float(sys.argv[1])
    journals = C.load_journals()
    net = C.backbone(alpha)
    X, y = [], []
    for name, j in journals.items():
        strips = C.render_strips(j['pdf'])
        f = net.predict(C.preprocess(strips), verbose=0)
        X.append(f)
        y.append([p in j['starts'] for p in range(1, len(strips) + 1)])
    X = np.vstack(X); y = np.concatenate(y).astype(int)
    head = LogisticRegression(C=0.1, max_iter=4000, class_weight='balanced').fit(X, y)
    json.dump({'w': head.coef_[0].astype(float).round(6).tolist(), 'b': float(head.intercept_[0]), 'cutoff': 1.5,
               'backbone': f'MobileNetV2 alpha={alpha} (ImageNet), input 192x576, pixel/127.5-1',
               'trained_on': sorted(journals)}, open(os.path.join(REPO, 'models/section-head.json'), 'w'))

    # backbone -> frozen graph -> ONNX -> ORT (Runtime optimisation: the minimal wasm has no fused ops)
    from tensorflow.python.framework.convert_to_constants import convert_variables_to_constants_v2
    import tf2onnx
    spec = tf.TensorSpec((1, C.STRIP_H, C.STRIP_W, 3), tf.float32, name='input')
    fn = tf.function(lambda t: net(t, training=False), input_signature=[spec])
    frozen = convert_variables_to_constants_v2(fn.get_concrete_function())
    tmp = tempfile.mkdtemp()
    onnx_path = os.path.join(tmp, 'section-features.onnx')
    tf2onnx.convert.from_graph_def(frozen.graph.as_graph_def(), input_names=[t.name for t in frozen.inputs],
                                   output_names=[t.name for t in frozen.outputs], opset=13, output_path=onnx_path)
    subprocess.check_call([sys.executable, '-m', 'onnxruntime.tools.convert_onnx_models_to_ort', tmp, '--optimization_style', 'Runtime'])
    ort_path = [p for p in os.listdir(tmp) if p.endswith('.ort')][0]
    shutil.copy(os.path.join(tmp, ort_path), os.path.join(REPO, 'models/section-features.ort'))

    x = ref_input()
    ref = net.predict(x, verbose=0)[0]
    json.dump({'first16': ref[:16].astype(float).tolist(), 'sum': float(ref.sum()), 'length': int(ref.shape[0])},
              open(os.path.join(REPO, 'tools/model/section_ref.json'), 'w'))
    print('size MB', os.path.getsize(os.path.join(REPO, 'models/section-features.ort')) / 1e6)


if __name__ == '__main__':
    main()
```

- [ ] **Step 7: Run the export**

Run: `./.venv-sections/bin/python tools/model/sections_export.py 1.0` (use the alpha chosen in Step 5)
Expected: prints `size MB` under 4 (alpha 0.35 about 1.5, alpha 1.0 about 9: if the chosen alpha prints over 4, follow the fallback in Step 5). The three files exist: `ls -la models/section-features.ort models/section-head.json tools/model/section_ref.json`.

- [ ] **Step 8: Write the browser parity scenario**

Create `tools/ui/section-model.js`:

```js
// The shipped feature model runs in the browser on the vendored minimal ONNX Runtime and matches the Python reference.
async function scenario() {
  const ort = await import('/vendor/ort/ort.wasm.min.mjs');
  ort.env.wasm.wasmPaths = { mjs: '/vendor/ort/ort-wasm-simd-threaded.mjs', wasm: '/vendor/ort/ort-wasm-simd-threaded.wasm' };
  ort.env.wasm.numThreads = 1;
  const ref = await (await fetch('/tools/model/section_ref.json')).json();
  const head = await (await fetch('/models/section-head.json')).json();
  check('head has 1280 weights and a cutoff', head.w.length === 1280 && typeof head.b === 'number' && head.cutoff === 1.5, String(head.w.length));

  const bytes = new Uint8Array(await (await fetch('/models/section-features.ort')).arrayBuffer());
  check('model file is within the size budget (< 10 MB)', bytes.length < 10e6, (bytes.length / 1e6).toFixed(2) + ' MB');
  const started = performance.now();
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  const input = new Float32Array(192 * 576 * 3);
  for (let i = 0; i < input.length; i++) input[i] = (((i * 2654435761) >>> 0) % 1000 / 1000) * 2 - 1;
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 192, 576, 3]) });
  const features = out[session.outputNames[0]].data;
  check('output is 1280 features', features.length === ref.length, String(features.length));
  const diff = Math.max(...ref.first16.map((v, i) => Math.abs(v - features[i])));
  check('first 16 features match Python (max abs diff < 1e-3)', diff < 1e-3, diff.toExponential(2));
  const sum = features.reduce((a, b) => a + b, 0);
  check('feature sum matches Python (relative diff < 1e-3)', Math.abs(sum - ref.sum) / Math.abs(ref.sum) < 1e-3, `${sum.toFixed(3)} vs ${ref.sum.toFixed(3)}`);
  check('one scan step is fast (< 1500 ms incl. load)', performance.now() - started < 1500, Math.round(performance.now() - started) + ' ms');
}
```

- [ ] **Step 9: Run it, record the numbers, commit**

Run: `npm run ui-check -- tools/ui/section-model.js`
Expected: all `PASS`. If the model fails to load with "Could not find an implementation for ..." the minimal wasm lacks an operator: re-export with a different optimisation style (`--optimization_style Fixed` and re-check), or, if still missing, use the stock runtime for this model only (`ort.wasm.min.mjs` with `ort-wasm-simd-threaded.{mjs,wasm}` from `onnxruntime-web@1.23.2`, +12 MB lazy) and record the ruling.

```bash
git add tools/model/sections_common.py tools/model/sections_eval.py tools/model/sections_export.py tools/model/requirements-sections.txt tools/model/section_ref.json models/section-features.ort models/section-head.json tools/ui/section-model.js .gitignore
git commit -m "feat: add section-start model and its browser parity check"
```

---

### Task 2: Pure page-finder logic

**Files:**
- Create: `page-finder.js`, `test_page_finder.js`
- Modify: `package.json` (`test` script)

**Interfaces:**
- Consumes: nothing (pure).
- Produces (all on `PageFinder`, UMD, also `module.exports`):
  - `DEFAULT_CUTOFF` (1.5), `DEFAULT_FLOOR` (-0.5), `MORE_CANDIDATES` (10), `DEFAULT_ASSIGNMENTS` (2), `MAX_EXTRA_PAGES` (20)
  - `rankPages(scores: {page, score}[]) -> {page, score}[]` (highest first, ties by lower page)
  - `pickSections(scores, { entryCount?: number, cutoff?: number, floor?: number }) -> { sections: {page, score, confident}[] (by page), more: {page, score}[] }` (with an entry count: the best N pages, but never a page scoring at or below `floor`, so an entry is left without a page rather than filled with a page that does not look like a heading)
  - `adjacentPairs(pages: number[]) -> [number, number][]`
  - `frontPageCount(sections) -> number`
  - `defaultCounting(front) -> { mode: 'as-is' | 'add' | 'ask', extra: number }`
  - `numberedPage(page | null, counting) -> number | null`
  - `describeCounting(counting) -> string`
  - `makeLabels(count, assignments) -> string[]`
  - `assignEntries(entryCount, sectionPages, missing: Set<number>, overrides: Map<number, number | null>) -> { index, page: number | null, status: 'ok' | 'missing' | 'unknown', manual: boolean }[]` (missing or `null`-override entries take no section and later entries move up; a page override changes only its own entry)
  - `duplicatePages(rows) -> number[]` (pages used by more than one entry)
  - `formatResult(rows, labels, counting) -> string`

- [ ] **Step 1: Write the failing test**

Create `test_page_finder.js`:

```js
const assert = require('assert');
const PF = require('./page-finder.js');

const scores = (pairs) => pairs.map(([page, score]) => ({ page, score }));
const pages = (list) => list.map((s) => s.page);

// --- rankPages ---
assert.deepStrictEqual(pages(PF.rankPages(scores([[1, 0.1], [2, 5], [3, 5], [4, -2]]))), [2, 3, 1, 4], 'highest first, ties by page');
assert.deepStrictEqual(PF.rankPages([]), []);

// --- pickSections without an entry count: cut-off only ---
{
  const s = scores([[1, 0.2], [2, 3.1], [3, 1.4], [4, 1.6], [5, -1], [6, 2.2]]);
  const r = PF.pickSections(s);
  assert.deepStrictEqual(pages(r.sections), [2, 4, 6], 'only scores above 1.5, in page order');
  assert.ok(r.sections.every((x) => x.confident));
  assert.deepStrictEqual(pages(r.more), [3, 1, 5], 'the rest are offered, best first');
  assert.deepStrictEqual(pages(PF.pickSections(s, { cutoff: 0 }).sections), [1, 2, 3, 4, 6]);
}
// nothing above the cut-off: no sections, candidates still offered
{
  const r = PF.pickSections(scores([[1, -3], [2, -1], [3, 0.4]]));
  assert.deepStrictEqual(r.sections, []);
  assert.deepStrictEqual(pages(r.more), [3, 2, 1]);
  assert.deepStrictEqual(PF.pickSections([]), { sections: [], more: [] });
}
// the candidate list is capped
{
  const many = scores(Array.from({ length: 40 }, (_, i) => [i + 1, -i]));
  assert.strictEqual(PF.pickSections(many).more.length, 10);
}
// --- pickSections with an entry count: top N, flagged when below the cut-off ---
{
  const s = scores([[1, 0.2], [2, 3.1], [3, 1.4], [4, 1.6], [5, -1], [6, 2.2]]);
  const r = PF.pickSections(s, { entryCount: 4 });
  assert.deepStrictEqual(pages(r.sections), [2, 3, 4, 6]);
  assert.deepStrictEqual(r.sections.map((x) => x.confident), [true, false, true, true], 'page 3 is chosen but below the cut-off');
  assert.deepStrictEqual(pages(r.more), [1, 5]);
  assert.strictEqual(PF.pickSections(s, { entryCount: 99, floor: -10 }).sections.length, 6, 'N is limited to the page count');
  assert.strictEqual(PF.pickSections(s, { entryCount: 99 }).sections.length, 5, 'and the floor still drops the page that is not heading-like');
  assert.deepStrictEqual(PF.pickSections(s, { entryCount: 0 }).sections.length, 3, 'a zero count falls back to the cut-off');
}
// the floor: an entry is never filled with a page that does not look like a heading at all
{
  const s = scores([[1, 0.2], [2, 3.1], [3, 1.4], [4, 1.6], [5, -1], [6, 2.2]]);
  const r = PF.pickSections(s, { entryCount: 6 });
  assert.deepStrictEqual(pages(r.sections), [1, 2, 3, 4, 6], 'page 5 (-1) is below the floor, so the sixth entry gets no page');
  assert.deepStrictEqual(pages(r.more), [5], 'but it is still offered as a candidate');
  assert.deepStrictEqual(pages(PF.pickSections(s, { entryCount: 6, floor: -2 }).sections), [1, 2, 3, 4, 5, 6], 'the floor can be changed');
  assert.strictEqual(PF.DEFAULT_FLOOR, -0.5);
  const flat = scores(Array.from({ length: 20 }, (_, i) => [i + 1, -3 - i / 100]));
  assert.deepStrictEqual(PF.pickSections(flat, { entryCount: 13 }).sections, [], 'a journal with no heading-like page fills nothing');
}

// --- adjacentPairs ---
assert.deepStrictEqual(PF.adjacentPairs([1, 3, 5, 7, 10, 13, 15, 16, 17, 20]), [[15, 16], [16, 17]]);
assert.deepStrictEqual(PF.adjacentPairs([17, 16, 3]), [[16, 17]], 'order of input does not matter');
assert.deepStrictEqual(PF.adjacentPairs([]), []);

// --- front pages and the counting choice ---
assert.strictEqual(PF.frontPageCount([{ page: 3 }, { page: 5 }]), 2);
assert.strictEqual(PF.frontPageCount([{ page: 1 }]), 0);
assert.strictEqual(PF.frontPageCount([]), 0);
assert.deepStrictEqual(PF.defaultCounting(2), { mode: 'as-is', extra: 0 }, 'certificate and index already in the PDF');
assert.deepStrictEqual(PF.defaultCounting(5), { mode: 'as-is', extra: 0 });
assert.deepStrictEqual(PF.defaultCounting(0), { mode: 'add', extra: 2 }, 'nothing in front: add certificate and index');
assert.deepStrictEqual(PF.defaultCounting(1), { mode: 'ask', extra: 1 }, 'one page in front: the user decides');

assert.strictEqual(PF.numberedPage(3, { mode: 'as-is', extra: 2 }), 3, 'as-is ignores extra');
assert.strictEqual(PF.numberedPage(3, { mode: 'add', extra: 2 }), 5);
assert.strictEqual(PF.numberedPage(3, { mode: 'ask', extra: 1 }), 3, 'undecided counts as the PDF numbers');
assert.strictEqual(PF.numberedPage(3, { mode: 'add', extra: 0 }), 3);
assert.strictEqual(PF.numberedPage(3, { mode: 'add', extra: 99 }), 23, 'extra is limited to 20');
assert.strictEqual(PF.numberedPage(3, { mode: 'add', extra: -4 }), 3, 'extra is never negative');
assert.strictEqual(PF.numberedPage(3, { mode: 'add', extra: 1.7 }), 5, 'extra is rounded to a whole number');
assert.strictEqual(PF.numberedPage(null, { mode: 'add', extra: 2 }), null);
assert.strictEqual(PF.describeCounting({ mode: 'add', extra: 2 }), 'Page numbers include 2 extra pages in front of this PDF.');
assert.strictEqual(PF.describeCounting({ mode: 'add', extra: 1 }), 'Page numbers include 1 extra page in front of this PDF.');
assert.strictEqual(PF.describeCounting({ mode: 'add', extra: 0 }), 'Page numbers are the PDF page numbers.');
assert.strictEqual(PF.describeCounting({ mode: 'as-is', extra: 2 }), 'Page numbers are the PDF page numbers.');

// --- labels ---
assert.deepStrictEqual(PF.makeLabels(4, 2), ['Experiment 1', 'Experiment 2', 'Assignment 1', 'Assignment 2']);
assert.deepStrictEqual(PF.makeLabels(3, 0), ['Experiment 1', 'Experiment 2', 'Experiment 3']);
assert.deepStrictEqual(PF.makeLabels(2, 5), ['Assignment 1', 'Assignment 2'], 'assignments are limited to the entry count');
assert.deepStrictEqual(PF.makeLabels(0, 2), []);
assert.deepStrictEqual(PF.makeLabels(3, undefined), ['Experiment 1', 'Assignment 1', 'Assignment 2'], 'default is 2 assignments');
assert.deepStrictEqual(PF.makeLabels(3, -1), ['Experiment 1', 'Experiment 2', 'Experiment 3']);
assert.strictEqual(PF.makeLabels(13, 2)[10], 'Experiment 11');
assert.strictEqual(PF.makeLabels(13, 2)[11], 'Assignment 1');

// --- assignEntries: order mapping, missing entries, manual overrides ---
{
  const rows = PF.assignEntries(3, [3, 5, 8], new Set(), new Map());
  assert.deepStrictEqual(rows.map((r) => [r.page, r.status]), [[3, 'ok'], [5, 'ok'], [8, 'ok']]);
  assert.ok(rows.every((r) => r.manual === false));
}
{ // DWM: 13 entries, 11 heading pages, Experiments 9-11 (indexes 8, 9, 10) are not in the PDF
  const found = [1, 3, 5, 7, 10, 13, 15, 16, 20, 26]; // 10 sections once the duplicate page 17 is dropped
  const rows = PF.assignEntries(13, found, new Set([8, 9, 10]), new Map());
  assert.deepStrictEqual(rows.map((r) => r.page), [1, 3, 5, 7, 10, 13, 15, 16, null, null, null, 20, 26]);
  assert.deepStrictEqual(rows.map((r) => r.status).slice(8, 11), ['missing', 'missing', 'missing']);
}
{ // fewer sections than entries: the trailing entries are unknown, never invented
  const rows = PF.assignEntries(4, [2, 6], new Set(), new Map());
  assert.deepStrictEqual(rows.map((r) => [r.page, r.status]), [[2, 'ok'], [6, 'ok'], [null, 'unknown'], [null, 'unknown']]);
}
{ // more sections than entries: the extra pages are simply not used
  assert.deepStrictEqual(PF.assignEntries(2, [2, 6, 9], new Set(), new Map()).map((r) => r.page), [2, 6]);
}
{ // a manual page choice changes only its own entry: the others keep their pages
  const rows = PF.assignEntries(3, [3, 5, 8], new Set(), new Map([[1, 6]]));
  assert.deepStrictEqual(rows.map((r) => r.page), [3, 6, 8]);
  assert.deepStrictEqual(rows.map((r) => r.manual), [false, true, false]);
}
{ // a manual choice that collides with an automatic one is kept as typed and reported by duplicatePages
  const rows = PF.assignEntries(3, [3, 5, 8], new Set(), new Map([[0, 5]]));
  assert.deepStrictEqual(rows.map((r) => r.page), [5, 5, 8]);
  assert.deepStrictEqual(PF.duplicatePages(rows), [5]);
}
{ // a manual "not in this PDF" frees its slot, like a missing entry: later entries move up
  const rows = PF.assignEntries(3, [3, 5, 8], new Set(), new Map([[1, null]]));
  assert.deepStrictEqual(rows.map((r) => [r.page, r.status]), [[3, 'ok'], [null, 'missing'], [5, 'ok']]);
  assert.strictEqual(rows[1].manual, true);
}
{ // a manual page for an entry that has no section left is still honoured
  const rows = PF.assignEntries(3, [3], new Set(), new Map([[2, 9]]));
  assert.deepStrictEqual(rows.map((r) => [r.page, r.status]), [[3, 'ok'], [null, 'unknown'], [9, 'ok']]);
}
assert.deepStrictEqual(PF.duplicatePages([{ page: 5 }, { page: 5 }, { page: null }, { page: 8 }, { page: 8 }, { page: 8 }]), [5, 8]);
assert.deepStrictEqual(PF.duplicatePages([{ page: 1 }, { page: null }]), []);
assert.deepStrictEqual(PF.assignEntries(0, [3], new Set(), new Map()), []);
assert.deepStrictEqual(PF.assignEntries(2, [], new Set(), new Map()).map((r) => r.status), ['unknown', 'unknown']);

// --- formatResult ---
{
  const labels = PF.makeLabels(4, 2);
  const rows = [{ index: 0, page: 3, status: 'ok' }, { index: 1, page: 5, status: 'ok' }, { index: 2, page: null, status: 'missing' }, { index: 3, page: null, status: 'unknown' }];
  const text = PF.formatResult(rows, labels, { mode: 'add', extra: 2 });
  assert.strictEqual(text, ['Experiment 1 – page 5', 'Experiment 2 – page 7', 'Assignment 1 – not in this PDF', 'Assignment 2 – page not found', '', 'Page numbers include 2 extra pages in front of this PDF.'].join('\n'));
  assert.strictEqual(PF.formatResult(rows.slice(0, 1), labels, { mode: 'as-is', extra: 0 }), 'Experiment 1 – page 3\n\nPage numbers are the PDF page numbers.');
  assert.strictEqual(PF.formatResult([], [], { mode: 'as-is', extra: 0 }), 'No sections found.');
}

console.log('page-finder: all assertions passed');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node test_page_finder.js`
Expected: FAIL with `Cannot find module './page-finder.js'`.

- [ ] **Step 3: Write the implementation**

Create `page-finder.js`:

```js
/**
 * PDF Page Studio - Page finder logic
 * Pure rules for turning per-page "a section starts here" scores into sections,
 * page numbers and typed lines. No DOM, so it is unit-tested in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PageFinder = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const DEFAULT_CUTOFF = 1.5;
  const DEFAULT_FLOOR = -0.5;   // measured: a page scoring below this was never a heading, except one duplicate page
  const MORE_CANDIDATES = 10;
  const DEFAULT_ASSIGNMENTS = 2;
  const MAX_EXTRA_PAGES = 20;

  /** Highest score first; equal scores keep the lower page first. */
  function rankPages(scores) {
    return scores.slice().sort((a, b) => b.score - a.score || a.page - b.page);
  }

  /**
   * Choose the section start pages.
   * With an entry count N: the N best pages, but never a page at or below `floor`: an entry is left
   * without a page rather than filled with a page that does not look like a heading at all.
   * Without: every page above the cut-off. `confident` says a chosen page is above the cut-off.
   * `more` lists the best of the rest.
   */
  function pickSections(scores, options) {
    const opts = options || {};
    const cutoff = opts.cutoff === undefined ? DEFAULT_CUTOFF : opts.cutoff;
    const floor = opts.floor === undefined ? DEFAULT_FLOOR : opts.floor;
    const ranked = rankPages(scores);
    const n = Number.isInteger(opts.entryCount) && opts.entryCount > 0 ? Math.min(opts.entryCount, ranked.length) : null;
    const chosen = n !== null ? ranked.slice(0, n).filter((p) => p.score > floor) : ranked.filter((p) => p.score > cutoff);
    const sections = chosen
      .map((p) => ({ page: p.page, score: p.score, confident: p.score > cutoff }))
      .sort((a, b) => a.page - b.page);
    const taken = new Set(sections.map((s) => s.page));
    const more = ranked.filter((p) => !taken.has(p.page)).slice(0, MORE_CANDIDATES).map((p) => ({ page: p.page, score: p.score }));
    return { sections, more };
  }

  /** Pairs of heading pages that follow each other, such as [16, 17]. */
  function adjacentPairs(pages) {
    const sorted = pages.slice().sort((a, b) => a - b);
    const pairs = [];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === sorted[i - 1] + 1) pairs.push([sorted[i - 1], sorted[i]]);
    }
    return pairs;
  }

  /** Pages before the first heading: certificate, index, anything else. */
  function frontPageCount(sections) {
    return sections.length ? Math.max(0, sections[0].page - 1) : 0;
  }

  /** The pre-answer to "how should pages be counted?". One page in front is ambiguous, so the user decides. */
  function defaultCounting(front) {
    if (front >= 2) return { mode: 'as-is', extra: 0 };
    if (front === 0) return { mode: 'add', extra: 2 };
    return { mode: 'ask', extra: 1 };
  }

  const clampExtra = (n) => Math.min(MAX_EXTRA_PAGES, Math.max(0, Math.round(Number(n) || 0)));

  /** The number to print for a PDF page under the chosen counting. */
  function numberedPage(page, counting) {
    if (page === null || page === undefined) return null;
    return page + (counting.mode === 'add' ? clampExtra(counting.extra) : 0);
  }

  /** A sentence that says how the numbers were counted, so a copied list is never ambiguous. */
  function describeCounting(counting) {
    const extra = counting.mode === 'add' ? clampExtra(counting.extra) : 0;
    if (extra > 0) return `Page numbers include ${extra} extra page${extra === 1 ? '' : 's'} in front of this PDF.`;
    return 'Page numbers are the PDF page numbers.';
  }

  /** "Experiment 1..n-a" then "Assignment 1..a". */
  function makeLabels(count, assignments) {
    const a = Math.min(Math.max(Number.isInteger(assignments) ? assignments : DEFAULT_ASSIGNMENTS, 0), count);
    const labels = [];
    for (let i = 1; i <= count - a; i++) labels.push(`Experiment ${i}`);
    for (let j = 1; j <= a; j++) labels.push(`Assignment ${j}`);
    return labels;
  }

  /**
   * Give each entry a page. Entries marked missing (or set to "not in this PDF") take no section,
   * so the entries after them move up to the next section. Every other entry takes the next section
   * in order. A manual page choice changes only that entry and never shifts the others. Entries
   * with no section left are 'unknown', never filled with a guess.
   */
  function assignEntries(entryCount, sectionPages, missing, overrides) {
    let next = 0;
    const rows = [];
    for (let i = 0; i < entryCount; i++) {
      const hasOverride = overrides.has(i);
      const override = hasOverride ? overrides.get(i) : undefined;
      if (missing.has(i) || override === null) {
        rows.push({ index: i, page: null, status: 'missing', manual: override === null });
        continue;
      }
      const auto = next < sectionPages.length ? sectionPages[next++] : null;
      if (hasOverride) rows.push({ index: i, page: override, status: 'ok', manual: true });
      else if (auto !== null) rows.push({ index: i, page: auto, status: 'ok', manual: false });
      else rows.push({ index: i, page: null, status: 'unknown', manual: false });
    }
    return rows;
  }

  /** Pages that more than one entry points at (a manual choice can collide with an automatic one). */
  function duplicatePages(rows) {
    const seen = new Map();
    rows.forEach((r) => { if (r.page !== null) seen.set(r.page, (seen.get(r.page) || 0) + 1); });
    return [...seen.entries()].filter(([, n]) => n > 1).map(([page]) => page).sort((a, b) => a - b);
  }

  /** The typed result, one line per entry, then the counting sentence. */
  function formatResult(rows, labels, counting) {
    if (rows.length === 0) return 'No sections found.';
    const lines = rows.map((r) => {
      const label = labels[r.index];
      if (r.page === null) return `${label} – ${r.status === 'missing' ? 'not in this PDF' : 'page not found'}`;
      return `${label} – page ${numberedPage(r.page, counting)}`;
    });
    return `${lines.join('\n')}\n\n${describeCounting(counting)}`;
  }

  return {
    DEFAULT_CUTOFF, DEFAULT_FLOOR, MORE_CANDIDATES, DEFAULT_ASSIGNMENTS, MAX_EXTRA_PAGES,
    rankPages, pickSections, adjacentPairs, frontPageCount, defaultCounting,
    numberedPage, describeCounting, makeLabels, assignEntries, duplicatePages, formatResult
  };
}));
```

- [ ] **Step 4: Run the test**

Run: `node test_page_finder.js`
Expected: `page-finder: all assertions passed`.

- [ ] **Step 5: Add to `npm test` and commit**

Edit `package.json`, appending ` && node test_page_finder.js` to the `test` script.

Run: `npm test`
Expected: every suite prints "all assertions passed".

```bash
git add page-finder.js test_page_finder.js package.json
git commit -m "feat: add page finder logic for sections, numbering and labels"
```

---
### Task 3: Section detector (render strips, run the model, score pages)

**Files:**
- Create: `section-detect.js`, `test_section_detect.js`, `tools/ui/section-detect.js`
- Modify: `index.html` (script tag), `package.json` (`test` script)

**Interfaces:**
- Consumes: `models/section-features.ort`, `models/section-head.json`, `vendor/ort/*` (Task 1); `pdfjsLib` global.
- Produces (on `SectionDetect`, UMD):
  - `STRIP = { top: 0.03, bottom: 0.20, width: 576, height: 192, renderWidth: 900 }`
  - `preprocessStrip(rgba: Uint8ClampedArray, width, height) -> Float32Array` (`pixel / 127.5 - 1`, RGB, row-major, alpha dropped)
  - `scoreFeatures(features: ArrayLike<number>, head: { w: number[], b: number }) -> number`
  - `renderStrip(pdfPage) -> Promise<HTMLCanvasElement>` (900 px wide, the top 3% to 20% of the page)
  - `createSectionDetector(options?) -> { load(): Promise, score(file: File, { onProgress?(done, total), signal?: AbortSignal }): Promise<{ scores: {page, score}[], thumbs: string[], pageCount: number }> }`. `thumbs[i]` is a blob URL of page i+1's heading strip (the caller revokes them). Errors: `name === 'AbortError'` for cancel; plain-language `message` for an unreadable, password-protected or empty PDF.

- [ ] **Step 1: Write the failing unit test**

Create `test_section_detect.js`:

```js
const assert = require('assert');
const SD = require('./section-detect.js');

assert.deepStrictEqual(SD.STRIP, { top: 0.03, bottom: 0.20, width: 576, height: 192, renderWidth: 900 });

// preprocessStrip: RGB scaled to -1..1, alpha dropped, row-major
{
  const rgba = new Uint8ClampedArray([0, 255, 128, 255, 255, 0, 0, 7]); // two pixels
  const out = SD.preprocessStrip(rgba, 2, 1);
  assert.ok(out instanceof Float32Array);
  assert.strictEqual(out.length, 6);
  const close = (a, b) => Math.abs(a - b) < 1e-6;
  assert.ok(close(out[0], -1) && close(out[1], 1) && close(out[2], 128 / 127.5 - 1), 'first pixel');
  assert.ok(close(out[3], 1) && close(out[4], -1) && close(out[5], -1), 'second pixel ignores alpha');
}
assert.throws(() => SD.preprocessStrip(new Uint8ClampedArray(7), 2, 1), /RGBA/, 'wrong buffer size is an error');

// scoreFeatures: dot product plus bias
assert.strictEqual(SD.scoreFeatures([1, 2, 3], { w: [0.5, -1, 2], b: 0.25 }), 0.5 - 2 + 6 + 0.25);
assert.strictEqual(SD.scoreFeatures([], { w: [], b: 1.5 }), 1.5);
assert.throws(() => SD.scoreFeatures([1, 2], { w: [1], b: 0 }), /length/, 'feature and weight lengths must match');
assert.ok(Number.isNaN(SD.scoreFeatures([NaN], { w: [1], b: 0 })), 'NaN stays NaN so the caller can reject it');

console.log('section-detect: all assertions passed');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node test_section_detect.js`
Expected: FAIL with `Cannot find module './section-detect.js'`.

- [ ] **Step 3: Write the implementation**

Create `section-detect.js`:

```js
/**
 * PDF Page Studio - Section detector
 * Scores every page of a journal PDF for "a section starts here": renders the top
 * strip of each page with pdf.js, runs a small image model (MobileNetV2 features)
 * through ONNX Runtime Web, and applies a logistic-regression head. The pure helpers
 * are unit-tested in Node; the rest needs a browser.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SectionDetect = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const STRIP = { top: 0.03, bottom: 0.20, width: 576, height: 192, renderWidth: 900 };
  const THUMB_WIDTH = 320;
  const DEFAULTS = {
    ortModule: 'vendor/ort/ort.wasm.min.mjs',
    wasmDir: 'vendor/ort/',
    modelUrl: 'models/section-features.ort',
    headUrl: 'models/section-head.json'
  };

  /** RGBA bytes -> float32 RGB in -1..1 (MobileNetV2 preprocess_input), row-major. */
  function preprocessStrip(rgba, width, height) {
    if (!rgba || rgba.length !== width * height * 4) throw new Error('preprocessStrip: expected a ' + width + 'x' + height + ' RGBA buffer');
    const out = new Float32Array(width * height * 3);
    for (let i = 0, o = 0; i < rgba.length; i += 4, o += 3) {
      out[o] = rgba[i] / 127.5 - 1;
      out[o + 1] = rgba[i + 1] / 127.5 - 1;
      out[o + 2] = rgba[i + 2] / 127.5 - 1;
    }
    return out;
  }

  /** Logistic-regression decision value for one feature vector. */
  function scoreFeatures(features, head) {
    if (features.length !== head.w.length) throw new Error('scoreFeatures: feature length ' + features.length + ' does not match weights ' + head.w.length);
    let sum = head.b;
    for (let i = 0; i < features.length; i++) sum += features[i] * head.w[i];
    return sum;
  }

  /** The top STRIP.top..STRIP.bottom of a pdf.js page, rendered STRIP.renderWidth px wide. */
  async function renderStrip(page) {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: STRIP.renderWidth / base.width });
    const offset = Math.round(viewport.height * STRIP.top);
    const height = Math.max(1, Math.round(viewport.height * (STRIP.bottom - STRIP.top)));
    const canvas = document.createElement('canvas');
    canvas.width = STRIP.renderWidth;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, transform: [1, 0, 0, 1, 0, -offset] }).promise;
    return canvas;
  }

  function canvasToUrl(canvas, quality) {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/jpeg', quality)), 'image/jpeg', quality);
    });
  }

  function friendlyPdfError(err) {
    const name = err && err.name;
    if (name === 'PasswordException') return new Error('This PDF is password protected, so its pages cannot be read.');
    if (name === 'InvalidPDFException' || name === 'FormatError' || name === 'MissingPDFException') return new Error('This file is not a readable PDF.');
    return err instanceof Error ? err : new Error(String(err));
  }

  const abortError = () => Object.assign(new Error('Scan cancelled.'), { name: 'AbortError' });

  function createSectionDetector(options) {
    const cfg = Object.assign({}, DEFAULTS, options);
    let loading = null;
    let ort = null;

    function load() {
      if (!loading) {
        loading = (async () => {
          ort = await import(new URL(cfg.ortModule, document.baseURI).href);
          const dir = new URL(cfg.wasmDir, document.baseURI).href;
          ort.env.wasm.wasmPaths = { mjs: dir + 'ort-wasm-simd-threaded.mjs', wasm: dir + 'ort-wasm-simd-threaded.wasm' };
          ort.env.wasm.numThreads = 1;
          const [modelResponse, headResponse] = await Promise.all([
            fetch(new URL(cfg.modelUrl, document.baseURI).href),
            fetch(new URL(cfg.headUrl, document.baseURI).href)
          ]);
          if (!modelResponse.ok || !headResponse.ok) throw new Error('The page-finder model could not be downloaded. Check your connection and try again.');
          const head = await headResponse.json();
          const session = await ort.InferenceSession.create(new Uint8Array(await modelResponse.arrayBuffer()), { executionProviders: ['wasm'] });
          return { session, head };
        })();
        loading.catch(() => { loading = null; });
      }
      return loading;
    }

    async function scorePage(session, head, stripCanvas) {
      const input = document.createElement('canvas');
      input.width = STRIP.width;
      input.height = STRIP.height;
      const ctx = input.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(stripCanvas, 0, 0, STRIP.width, STRIP.height);
      const tensor = new ort.Tensor('float32', preprocessStrip(ctx.getImageData(0, 0, STRIP.width, STRIP.height).data, STRIP.width, STRIP.height), [1, STRIP.height, STRIP.width, 3]);
      const out = await session.run({ [session.inputNames[0]]: tensor });
      const score = scoreFeatures(out[session.outputNames[0]].data, head);
      if (!Number.isFinite(score)) throw new Error('The model returned an unusable score.');
      return score;
    }

    async function score(file, opts) {
      const { onProgress, signal } = opts || {};
      const { session, head } = await load();
      let pdf;
      try {
        pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      } catch (err) {
        throw friendlyPdfError(err);
      }
      const thumbs = [];
      const scores = [];
      try {
        const total = pdf.numPages;
        if (total < 1) throw new Error('This PDF has no pages.');
        for (let n = 1; n <= total; n++) {
          if (signal && signal.aborted) throw abortError();
          const page = await pdf.getPage(n);
          let strip;
          try {
            strip = await renderStrip(page);
          } finally {
            page.cleanup();
          }
          scores.push({ page: n, score: await scorePage(session, head, strip) });
          const thumb = document.createElement('canvas');
          thumb.width = THUMB_WIDTH;
          thumb.height = Math.max(1, Math.round(strip.height * THUMB_WIDTH / strip.width));
          thumb.getContext('2d').drawImage(strip, 0, 0, thumb.width, thumb.height);
          thumbs.push(await canvasToUrl(thumb, 0.8));
          if (onProgress) onProgress(n, total);
        }
        return { scores, thumbs, pageCount: total };
      } catch (err) {
        thumbs.forEach((u) => URL.revokeObjectURL(u));
        throw err;
      } finally {
        pdf.destroy();
      }
    }

    return { load, score };
  }

  return { STRIP, preprocessStrip, scoreFeatures, renderStrip, createSectionDetector };
}));
```

- [ ] **Step 4: Run the unit test, add it to `npm test`**

Run: `node test_section_detect.js`
Expected: `section-detect: all assertions passed`.

Edit `package.json`, appending ` && node test_section_detect.js` to the `test` script. Run `npm test`. Expected: all suites pass.

- [ ] **Step 5: Add the script tag**

In `index.html`, immediately before `<script src="export-name-dialog.js?v=2.8.0"></script>` add `<script src="section-detect.js?v=2.8.0"></script>` (versions are bumped together in Task 8).

- [ ] **Step 6: Write the browser scenario**

Create `tools/ui/section-detect.js`:

```js
// Section detector in a real browser: strip geometry, scoring mechanics with the shipped model, progress, cancel, bad files.
async function pdfWithPages(count, draw) {
  const doc = await PDFLib.PDFDocument.create();
  for (let i = 0; i < count; i++) {
    const page = doc.addPage([595, 842]);
    if (draw) draw(page, i);
  }
  return new File([await doc.save()], 'journal.pdf', { type: 'application/pdf' });
}

async function scenario() {
  // 1. The strip is the top 3%..20% of the page, 900 px wide.
  const marked = await pdfWithPages(1, (page) => page.drawRectangle({ x: 100, y: 842 * (1 - 0.09), width: 300, height: 842 * 0.03, color: PDFLib.rgb(0, 0, 0) }));
  const pdf = await pdfjsLib.getDocument({ data: await marked.arrayBuffer() }).promise;
  const strip = await SectionDetect.renderStrip(await pdf.getPage(1));
  const expectedHeight = Math.round((900 / 595) * 842 * 0.17);
  check('strip is 900 px wide and 17% of the page tall', strip.width === 900 && Math.abs(strip.height - expectedHeight) <= 1, `${strip.width}x${strip.height}, expected height ${expectedHeight}`);
  const ctx = strip.getContext('2d');
  const red = (y) => ctx.getImageData(300, y, 1, 1).data[0];
  const unit = strip.height / 0.17;   // strip pixels per page-height unit
  check('ink at 6%..9% of the page appears inside the strip', red(Math.round(unit * (0.075 - 0.03))) < 60, String(red(Math.round(unit * 0.045))));
  check('white above (4%) and below (12%) the ink', red(Math.round(unit * 0.01)) > 200 && red(Math.round(unit * 0.09)) > 200);
  pdf.destroy();

  // 2. Scoring with the shipped model: every page scored, thumbnails made, progress reported.
  const detector = SectionDetect.createSectionDetector();
  const journal = await pdfWithPages(6);
  const progress = [];
  const result = await detector.score(journal, { onProgress: (done, total) => progress.push([done, total]) });
  check('six pages scored', result.scores.length === 6 && result.pageCount === 6 && result.scores.every((s, i) => s.page === i + 1 && Number.isFinite(s.score)), JSON.stringify(result.scores.map((s) => +s.score.toFixed(2))));
  check('progress ends at 6 of 6', JSON.stringify(progress[progress.length - 1]) === '[6,6]' && progress.length === 6);
  check('a heading thumbnail per page', result.thumbs.length === 6 && result.thumbs.every((u) => /^blob:/.test(u)));
  const thumb = await loadImageFromUrl(result.thumbs[0]);
  check('thumbnail is 320 px wide', thumb.naturalWidth === 320, String(thumb.naturalWidth));
  check('blank pages are not flagged as headings', result.scores.every((s) => s.score <= PageFinder_cutoff()), JSON.stringify(result.scores.map((s) => +s.score.toFixed(2))));
  result.thumbs.forEach((u) => URL.revokeObjectURL(u));

  // 3. The model stays loaded: a second scan is quick.
  const t0 = performance.now();
  const second = await detector.score(await pdfWithPages(2));
  check('second scan reuses the loaded model (< 3 s)', performance.now() - t0 < 3000, Math.round(performance.now() - t0) + ' ms');
  second.thumbs.forEach((u) => URL.revokeObjectURL(u));

  // 4. Cancel mid-scan: rejects with AbortError and leaves nothing behind.
  const controller = new AbortController();
  let cancelled = null;
  try {
    await detector.score(await pdfWithPages(5), { signal: controller.signal, onProgress: (done) => { if (done === 2) controller.abort(); } });
  } catch (err) { cancelled = err; }
  check('cancelling rejects with AbortError', !!cancelled && cancelled.name === 'AbortError', cancelled && cancelled.message);

  // 5. Unreadable file: a plain-language error.
  let bad = null;
  try { await detector.score(new File([new Uint8Array([1, 2, 3, 4, 5])], 'x.pdf', { type: 'application/pdf' })); } catch (err) { bad = err; }
  check('an unreadable PDF gives a plain message', !!bad && /not a readable PDF/.test(bad.message), bad && bad.message);

  // 6. Model download failure is reported and can be retried.
  const broken = SectionDetect.createSectionDetector({ modelUrl: 'models/missing.ort' });
  let failed = null;
  try { await broken.score(await pdfWithPages(1)); } catch (err) { failed = err; }
  check('a missing model gives a download message', !!failed && /could not be downloaded/.test(failed.message), failed && failed.message);
  let again = null;
  try { await broken.score(await pdfWithPages(1)); } catch (err) { again = err; }
  check('a failed load is retried, not cached', !!again && /could not be downloaded/.test(again.message));
}

function PageFinder_cutoff() { return 1.5; }
```

- [ ] **Step 7: Run it**

Run: `npm run ui-check -- tools/ui/section-detect.js 120000`
Expected: all `PASS`. If `strip is 900 px wide...` fails on height by more than 1 px, check pdf.js's `transform` option is honoured by the vendored version (`pdfjsLib.version`); if not, render the full page to a canvas and crop with `drawImage` instead (same output, slower), and record that as a ruling.

- [ ] **Step 8: Commit**

```bash
git add section-detect.js test_section_detect.js tools/ui/section-detect.js index.html package.json
git commit -m "feat: add section detector that scores each journal page"
```

---

### Task 4: Contents-page scan (entry count and entry bands)

**Files:**
- Create: `index-scan.js`, `test_index_scan.js`, `tools/ui/index-scan.js`, `tools/ui/index-scan-real.js`
- Modify: `index.html` (script tag), `package.json` (`test` script)

**Interfaces:**
- Consumes: `CropGeometry.warpPerspective`, `PageDetect.createDetector` (existing Auto Crop modules), for the browser helper only.
- Produces (on `IndexScan`, UMD):
  - `isRule(r,g,b)`, `isRed(r,g,b)`, `isInk(r,g,b)` (pixel classes)
  - `verticalRules(img) -> number[]` (x of long vertical table rules), `horizontalRules(img, x0, x1) -> number[]`
  - `estimateEntries(img: { width, height, data: RGBA }) -> { count, rows: {y0, y1}[], rules, headerBottom, tableBottom, confidence: 'ok' | 'low' }`
  - `entryBands(estimate) -> { y0, y1 }[]`
  - Browser only: `analyseImage(source: HTMLImageElement | HTMLCanvasElement, options?) -> Promise<{ estimate, crops: HTMLCanvasElement[], warning: string | null }>`; crops are each entry's handwriting cell, or `[]` when the table was not found.

- [ ] **Step 1: Write the failing test**

Create `test_index_scan.js`:

```js
const assert = require('assert');
const IS = require('./index-scan.js');

// A synthetic contents table: white page, saturated-blue rules, dark numerals in the first column.
function table({ width = 800, height = 1100, entries = [420, 500, 640, 700, 820], extras = true } = {}) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const set = (x, y, c) => { const i = (y * width + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; };
  const BLUE = [40, 110, 190], INK = [35, 35, 45], RED = [200, 40, 40];
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, c); };
  const xs = [60, 130, 520, 600, 680, 760];
  xs.forEach((x) => rect(x - 1, 300, x + 2, 1000, BLUE));
  rect(60, 299, 762, 302, BLUE);          // table top
  rect(60, 379, 762, 382, BLUE);          // header bottom
  for (let y = 420; y <= 1000; y += 40) rect(60, y, 762, y + 2, BLUE);
  entries.forEach((y) => { rect(88, y, 96, y + 20, INK); rect(100, y, 108, y + 20, INK); }); // a two-digit number
  if (extras) {
    rect(540, 430, 580, 450, INK);        // handwriting in the page column
    rect(70, 560, 120, 566, RED);         // a red mark in the first column
    rect(150, 430, 500, 450, INK);        // the entry text
    for (let i = 0; i < 12; i++) rect(70 + i, 305 + i, 74 + i, 309 + i, INK); // "SR. NO." header ink above the entries
  }
  return { width, height, data };
}

// pixel classes
assert.ok(IS.isRule(40, 110, 190) && !IS.isRule(35, 35, 45) && !IS.isRule(255, 255, 255));
assert.ok(IS.isInk(35, 35, 45) && !IS.isInk(40, 110, 190) && !IS.isInk(200, 40, 40) && !IS.isInk(240, 240, 240));
assert.ok(IS.isRed(200, 40, 40) && !IS.isRed(35, 35, 45));

// rules
{
  const t = table();
  const v = IS.verticalRules(t);
  assert.strictEqual(v.length, 6, 'six vertical rules');
  assert.deepStrictEqual(v.map(Math.round), [60, 130, 520, 600, 680, 760]);
  const h = IS.horizontalRules(t, 60, 760);
  assert.ok(h.length >= 3 && Math.abs(h[0] - 300) <= 2 && Math.abs(h[1] - 380) <= 2, 'top and header-bottom rules found: ' + h.slice(0, 3));
}

// entry count: numerals only count, red marks / page column / header ink do not
{
  const e = IS.estimateEntries(table());
  assert.strictEqual(e.confidence, 'ok');
  assert.strictEqual(e.count, 5, 'five entries');
  assert.deepStrictEqual(e.rows.map((r) => Math.round(r.y0 / 10) * 10), [420, 500, 640, 700, 820]);
  const bands = IS.entryBands(e);
  assert.strictEqual(bands.length, 5);
  assert.ok(bands.every((b, i) => b.y1 > b.y0 && (i === 0 || b.y0 >= bands[i - 1].y1 - 1)), 'bands are ordered and do not overlap');
  assert.ok(bands[0].y0 <= 420 && bands[0].y1 > 440, 'a band covers its numeral');
}
assert.strictEqual(IS.estimateEntries(table({ entries: [420, 460, 500, 540, 580, 620, 660, 700, 740, 780, 820, 860, 900] })).count, 13, '13 entries (DWM-sized)');
assert.strictEqual(IS.estimateEntries(table({ entries: [] })).count, 0);
assert.strictEqual(IS.estimateEntries(table({ entries: [] })).confidence, 'low');

// not a table: low confidence, never a crash
{
  const blank = { width: 300, height: 300, data: new Uint8ClampedArray(300 * 300 * 4).fill(255) };
  const e = IS.estimateEntries(blank);
  assert.strictEqual(e.count, 0); assert.strictEqual(e.confidence, 'low'); assert.deepStrictEqual(IS.entryBands(e), []);
  const noise = { width: 200, height: 200, data: new Uint8ClampedArray(200 * 200 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7919) % 256)) };
  assert.strictEqual(IS.estimateEntries(noise).confidence, 'low');
}
console.log('index-scan: all assertions passed');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node test_index_scan.js`
Expected: FAIL with `Cannot find module './index-scan.js'`.

- [ ] **Step 3: Write the implementation**

Create `index-scan.js`:

```js
/**
 * PDF Page Studio - Contents page scan
 * Reads a photographed, upright contents table: finds the ruled columns, counts the
 * entries from the "Sr. No." column and returns a band for each entry. The analysis is
 * pure RGBA, so it is tested in Node on synthetic tables; analyseImage() is the browser glue.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.IndexScan = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const RULE_GAP = 4;          // a printed rule may break for a few pixels (handwriting crossing it)
  const MIN_RULE_FRACTION = 0.35;
  const MIN_NUMERAL_HEIGHT = 7;
  const NUMERAL_MERGE_GAP = 6;
  const ANALYSIS_WIDTH = 1000;  // the photo is warped to this width before analysis

  const isRule = (r, g, b) => b - r > 45 && b - g > 10 && b > 110;           // saturated table-line blue
  const isRed = (r, g, b) => r - b > 60 && r - g > 60;                       // the teacher's marks
  const isInk = (r, g, b) => !isRule(r, g, b) && !isRed(r, g, b) && (r + g + b) / 3 < 125; // dark pen, not a rule

  /** Longest run of `test` along a line, bridging gaps of up to RULE_GAP pixels. */
  function longestRun(length, test) {
    let best = 0, run = 0, gap = 0;
    for (let i = 0; i < length; i++) {
      if (test(i)) { run += 1 + gap; gap = 0; if (run > best) best = run; }
      else if (run > 0 && gap < RULE_GAP) gap++;
      else { run = 0; gap = 0; }
    }
    return best;
  }

  /** Merge neighbouring positions (a rule is a few pixels thick) into centres. */
  function groupCentres(positions, maxDistance) {
    const centres = [];
    let start = null, last = null;
    positions.forEach((p) => {
      if (start === null) { start = last = p; return; }
      if (p - last <= maxDistance) { last = p; return; }
      centres.push((start + last) / 2);
      start = last = p;
    });
    if (start !== null) centres.push((start + last) / 2);
    return centres;
  }

  function pixel(img, x, y) {
    const i = (y * img.width + x) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  }

  /** x of the long vertical table rules, left to right. */
  function verticalRules(img) {
    const hits = [];
    for (let x = 0; x < img.width; x++) {
      const run = longestRun(img.height, (y) => { const p = pixel(img, x, y); return isRule(p[0], p[1], p[2]); });
      if (run >= img.height * MIN_RULE_FRACTION) hits.push(x);
    }
    return groupCentres(hits, 3);
  }

  /** y of the long horizontal table rules between x0 and x1, top to bottom. */
  function horizontalRules(img, x0, x1) {
    const hits = [];
    for (let y = 0; y < img.height; y++) {
      const run = longestRun(x1 - x0, (i) => { const p = pixel(img, x0 + i, y); return isRule(p[0], p[1], p[2]); });
      if (run >= (x1 - x0) * 0.6) hits.push(y);
    }
    return groupCentres(hits, 3);
  }

  /**
   * Count the entries of a contents table from its first column (one handwritten
   * number per entry). confidence is 'low' when the table structure was not found; count is then 0.
   */
  function estimateEntries(img) {
    const low = (rules) => ({ count: 0, rows: [], rules: rules || [], headerBottom: 0, tableBottom: 0, confidence: 'low' });
    const rules = verticalRules(img);
    if (rules.length < 5) return low(rules);
    const x0 = rules[0], x1 = rules[rules.length - 1];
    const h = horizontalRules(img, Math.round(x0), Math.round(x1));
    if (h.length < 3) return low(rules);
    const headerBottom = h[1];
    const tableBottom = h[h.length - 1];
    const left = Math.round(rules[0]) + 5, right = Math.round(rules[1]) - 5;
    if (right - left < 8) return low(rules);

    const inkInRow = [];
    for (let y = Math.round(headerBottom) + 4; y < Math.round(tableBottom) - 1; y++) {
      let n = 0;
      for (let x = left; x < right; x++) { const p = pixel(img, x, y); if (isInk(p[0], p[1], p[2])) n++; }
      inkInRow.push([y, n]);
    }
    const rows = [];
    let cur = null;
    inkInRow.forEach(([y, n]) => {
      if (n >= 2) {
        if (cur && y - cur.y1 <= NUMERAL_MERGE_GAP) cur.y1 = y;
        else { if (cur) rows.push(cur); cur = { y0: y, y1: y }; }
      }
    });
    if (cur) rows.push(cur);
    const numerals = rows.filter((r) => r.y1 - r.y0 + 1 >= MIN_NUMERAL_HEIGHT);
    return { count: numerals.length, rows: numerals, rules, headerBottom, tableBottom, confidence: numerals.length > 0 ? 'ok' : 'low' };
  }

  /** A vertical band for each entry, from just above its number to just above the next one. */
  function entryBands(estimate) {
    const { rows, tableBottom } = estimate;
    if (rows.length === 0) return [];
    const avg = rows.reduce((a, r) => a + (r.y1 - r.y0 + 1), 0) / rows.length;
    return rows.map((r, i) => ({
      y0: Math.max(0, Math.round(r.y0 - 8)),
      y1: Math.round(i + 1 < rows.length ? rows[i + 1].y0 - 8 : Math.min(tableBottom, r.y1 + avg * 3))
    }));
  }

  /**
   * Browser glue. `source` is an upright picture of the contents page (the caller has already
   * cropped it, or the photo is a clean scan). It is scaled to ANALYSIS_WIDTH, analysed, and each
   * entry's handwriting cell (the second column) is cut out as a canvas.
   */
  async function analyseImage(source) {
    const sw = source.naturalWidth || source.width;
    const sh = source.naturalHeight || source.height;
    const canvas = document.createElement('canvas');
    canvas.width = ANALYSIS_WIDTH;
    canvas.height = Math.round(sh * ANALYSIS_WIDTH / sw);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const estimate = estimateEntries(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (estimate.confidence === 'low') {
      return { estimate, crops: [], warning: 'The table in this photo could not be read. Enter the number of entries yourself.' };
    }
    const x0 = Math.round(estimate.rules[1]) + 3;
    const x1 = Math.round(estimate.rules[2]) - 3;
    const crops = entryBands(estimate).map((band) => {
      const crop = document.createElement('canvas');
      crop.width = Math.max(1, x1 - x0);
      crop.height = Math.max(1, band.y1 - band.y0);
      crop.getContext('2d').drawImage(canvas, x0, band.y0, crop.width, crop.height, 0, 0, crop.width, crop.height);
      return crop;
    });
    return { estimate, crops, warning: null };
  }

  return { isRule, isRed, isInk, verticalRules, horizontalRules, estimateEntries, entryBands, analyseImage };
}));
```

- [ ] **Step 4: Run the unit test, add it to `npm test`**

Run: `node test_index_scan.js`
Expected: `index-scan: all assertions passed`.

Edit `package.json`, appending ` && node test_index_scan.js` to the `test` script. Run `npm test`. Expected: all suites pass.

- [ ] **Step 5: Add the script tag**

In `index.html`, immediately before `<script src="export-name-dialog.js?v=2.8.0"></script>` add `<script src="index-scan.js?v=2.8.0"></script>`.

- [ ] **Step 6: Write the browser scenario (synthetic table, glue code)**

Create `tools/ui/index-scan.js`:

```js
// IndexScan.analyseImage in a real browser on a drawn contents table.
function drawTable(entryYs) {
  const canvas = document.createElement('canvas');
  canvas.width = 800; canvas.height = 1100;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 800, 1100);
  ctx.strokeStyle = '#2870be'; ctx.lineWidth = 3;
  [60, 130, 520, 600, 680, 760].forEach((x) => { ctx.beginPath(); ctx.moveTo(x, 300); ctx.lineTo(x, 1000); ctx.stroke(); });
  [300, 380, ...Array.from({ length: 16 }, (_, i) => 420 + i * 40)].forEach((y) => { ctx.beginPath(); ctx.moveTo(60, y); ctx.lineTo(760, y); ctx.stroke(); });
  ctx.fillStyle = '#23232d'; ctx.font = 'bold 26px sans-serif';
  entryYs.forEach((y, i) => { ctx.fillText(String(i + 1), 84, y + 22); ctx.fillText('entry ' + (i + 1), 150, y + 22); });
  return canvas;
}

async function scenario() {
  const ys = [420, 500, 580, 700, 780, 860];
  const result = await IndexScan.analyseImage(drawTable(ys));
  check('six entries counted', result.estimate.count === 6 && result.estimate.confidence === 'ok', JSON.stringify({ count: result.estimate.count, confidence: result.estimate.confidence }));
  check('a crop for each entry', result.crops.length === 6 && result.warning === null);
  check('crops are the handwriting column (about 482 px wide at the 1000 px analysis size)', result.crops.every((c) => Math.abs(c.width - 482) <= 8), result.crops.map((c) => c.width).join());
  check('a crop contains ink', result.crops.every((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) if (d[i] < 100) return true; return false; }));

  // a scaled-down photo of the same table still reads
  const big = drawTable(ys);
  const small = document.createElement('canvas'); small.width = 400; small.height = 550;
  small.getContext('2d').drawImage(big, 0, 0, 400, 550);
  const scaled = await IndexScan.analyseImage(small);
  check('a half-size picture is still read (6 entries)', scaled.estimate.count === 6, String(scaled.estimate.count));

  // not a table: a warning, no crops, no crash
  const blank = document.createElement('canvas'); blank.width = 500; blank.height = 700;
  blank.getContext('2d').fillStyle = '#fff'; blank.getContext('2d').fillRect(0, 0, 500, 700);
  const none = await IndexScan.analyseImage(blank);
  check('a blank picture gives a warning and no crops', none.estimate.confidence === 'low' && none.crops.length === 0 && /could not be read/.test(none.warning), none.warning);
}
```

Run: `npm run ui-check -- tools/ui/index-scan.js 90000`
Expected: all `PASS`.

- [ ] **Step 7: Measure on the three real contents pages (local, private data)**

Prepare upright images locally (not committed): the CN contents page cropped with the existing ground-truth quad (`~/Documents/cropped_photos/<crop of IMG_5933>`), the DWM index (`Dwm index.heic` converted with `sips -s format jpeg`, then cropped with Auto Crop in the app or `tools/ui/index-scan-real.js` below), and the WMC index (`Merged_Document-2.pdf`, one page, rendered to PNG). Put them in one folder as `cn.jpg`, `dwm.jpg`, `wmc.png`.

Create `tools/ui/index-scan-real.js`:

```js
// Local only: UI_CHECK_FIXTURES=<folder with cn.jpg, dwm.jpg, wmc.png> npm run ui-check -- tools/ui/index-scan-real.js
const EXPECTED = { 'cn.jpg': 12, 'dwm.jpg': 13, 'wmc.png': 11 };
async function scenario() {
  let right = 0;
  for (const [name, count] of Object.entries(EXPECTED)) {
    const response = await fetch('/__fixture/' + name);
    if (!response.ok) { check('SKIP ' + name + ' (not in UI_CHECK_FIXTURES)', true); continue; }
    const img = await loadImageFromUrl(URL.createObjectURL(await response.blob()));
    const result = await IndexScan.analyseImage(img);
    const ok = result.estimate.count === count;
    if (ok) right++;
    check(`INFO ${name}: counted ${result.estimate.count}, expected ${count}, confidence ${result.estimate.confidence}, crops ${result.crops.length}`, true);
    check(`${name} entry count is right`, ok);
  }
  check('INFO real contents pages counted correctly: ' + right + ' of 3', true);
}
```

Run it. **Gate:** if at least 2 of 3 are counted right, keep the estimator as the default. If fewer, do not tune thresholds blindly: print the rule positions and the detected rows for the failing image (`console.log(JSON.stringify(result.estimate))` through a `check('INFO ...')` line), adjust `isRule` / `isInk` or the column choice against the evidence, and re-run. If still below 2 of 3 after one adjustment pass, ship the editable count as the primary control (Task 5 already makes it editable) and record "estimate unreliable on photos" in the model card; the feature still works because the count is user-confirmed.

- [ ] **Step 8: Commit**

```bash
git add index-scan.js test_index_scan.js tools/ui/index-scan.js tools/ui/index-scan-real.js index.html package.json
git commit -m "feat: read the entry count and entry rows from a contents-page photo"
```

---
### Task 5: The finder dialog: landing button, choose step, scan step

**Files:**
- Create: `page-finder-ui.js`, `tools/ui/pagefinder-flow.js`
- Modify: `index.html` (landing button, `#finder-modal`, script tags), `styles.css`, `app.js` (`getPageDetector`, button wiring)

**Interfaces:**
- Consumes: `PageFinder` (Task 2), `SectionDetect.createSectionDetector` (Task 3), `IndexScan.analyseImage` (Task 4), existing `PageDetect`, `CropGeometry`, `ImageNormalize`, `loadImageFromUrl`, `canvasToObjectUrl`, `showToast`, `state.pages`.
- Produces: `PageFinderUI.open()`, `.close()`, `.isOpen()`, test hooks `.setDetector(detector)` and `.setIndexAnalyser(fn)`; `getPageDetector()` in `app.js` (one shared Auto Crop detector). Element ids used by every later task and test:
  `finder-open-btn`, `finder-modal`, `finder-backdrop`, `finder-close-btn`, `finder-step-choose`, `finder-pdf-input`, `finder-pdf-name`, `finder-existing`, `finder-index-input`, `finder-index-name`, `finder-index-clear`, `finder-choose-error`, `finder-choose-cancel-btn`, `finder-start-btn`, `finder-step-scan`, `finder-scan-text`, `finder-progress`, `finder-scan-cancel-btn`, `finder-step-result`, `finder-entries-field`, `finder-entries-input`, `finder-assign-input`, `finder-warnings`, `finder-rows`, `finder-chips`, `finder-count-as-is`, `finder-count-add`, `finder-extra`, `finder-count-note`, `finder-back-btn`, `finder-copy-btn`, `finder-picker`, `finder-picker-title`, `finder-picker-list`, `finder-picker-other`, `finder-picker-other-btn`, `finder-picker-close-btn`.
  The detector contract used by the dialog: `detector.score(file, { onProgress(done, total), signal }) -> Promise<{ scores, thumbs, pageCount }>`. The index analyser contract: `analyser(file) -> Promise<{ count: number, cropUrls: string[], warning: string | null }>`.

- [ ] **Step 1: Write the failing scenario**

Create `tools/ui/pagefinder-flow.js`:

```js
// The finder dialog: open from the landing page, choose files, scan with progress, cancel, errors, reset.
const $ = (id) => document.getElementById(id);
const isOpen = () => $('finder-modal').classList.contains('active');
const visibleStep = () => ['choose', 'scan', 'result'].find((s) => !$('finder-step-' + s).hidden);
const setFile = (input, file) => { const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); };

async function makePdf(name, pageCount) {
  const doc = await PDFLib.PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([595, 842]);
  return new File([await doc.save()], name, { type: 'application/pdf' });
}
async function thumbUrl(label) {
  const c = document.createElement('canvas'); c.width = 320; c.height = 100;
  const g = c.getContext('2d'); g.fillStyle = '#f5f2eb'; g.fillRect(0, 0, 320, 100); g.fillStyle = '#222'; g.font = '30px sans-serif'; g.fillText(label, 20, 60);
  return new Promise((r) => c.toBlob((b) => r(URL.createObjectURL(b)), 'image/png'));
}
/** A fake detector: `high` lists the heading pages; everything else scores low. */
function fakeDetector({ pages, high, delay = 0, fail = null }) {
  return {
    async score(file, { onProgress, signal } = {}) {
      if (fail) throw new Error(fail);
      const scores = [], thumbs = [];
      for (let p = 1; p <= pages; p++) {
        if (signal && signal.aborted) throw Object.assign(new Error('Scan cancelled.'), { name: 'AbortError' });
        if (delay) await sleep(delay);
        scores.push({ page: p, score: high.includes(p) ? 4 + p / 100 : -3 - p / 100 });
        thumbs.push(await thumbUrl('page ' + p));
        if (onProgress) onProgress(p, pages);
      }
      return { scores, thumbs, pageCount: pages };
    }
  };
}

async function scenario() {
  // 1. The button is on the landing page and opens the dialog at the choose step.
  check('landing page has the Find page numbers button', !!$('finder-open-btn') && /Find page numbers/.test($('finder-open-btn').textContent));
  $('finder-open-btn').click();
  await waitFor(isOpen);
  check('dialog opens on the choose step', visibleStep() === 'choose');
  check('Start is disabled until a PDF is chosen', $('finder-start-btn').disabled);
  check('the optional photo is explained as optional', /optional/i.test(document.querySelector('label[for="finder-index-input"]').textContent + $('finder-step-choose').textContent));

  // 2. Only PDFs are accepted as the journal.
  setFile($('finder-pdf-input'), new File([new Uint8Array([1, 2, 3])], 'notes.txt', { type: 'text/plain' }));
  check('a non-PDF is refused with a message', !$('finder-choose-error').hidden && /PDF/.test($('finder-choose-error').textContent) && $('finder-start-btn').disabled, $('finder-choose-error').textContent);
  const journal = await makePdf('Lab journal.pdf', 8);
  setFile($('finder-pdf-input'), journal);
  check('a PDF is accepted and its name shown', $('finder-pdf-name').textContent === 'Lab journal.pdf' && !$('finder-start-btn').disabled && $('finder-choose-error').hidden);

  // 3. Scanning shows progress and ends on the result step.
  PageFinderUI.setDetector(fakeDetector({ pages: 8, high: [1, 3, 6], delay: 20 }));
  $('finder-start-btn').click();
  await waitFor(() => visibleStep() === 'scan');
  check('scan step shows progress text', /Checking page|Preparing/.test($('finder-scan-text').textContent), $('finder-scan-text').textContent);
  await waitFor(() => visibleStep() === 'result', 20000);
  check('scan ends on the result step', visibleStep() === 'result');
  check('three sections found', $('finder-rows').querySelectorAll('.finder-row').length === 3, String($('finder-rows').querySelectorAll('.finder-row').length));
  $('finder-back-btn').click();
  check('Back returns to the choose step and keeps the PDF', visibleStep() === 'choose' && $('finder-pdf-name').textContent === 'Lab journal.pdf');

  // 4. Cancel mid-scan: back to choose, no error, no result.
  PageFinderUI.setDetector(fakeDetector({ pages: 40, high: [1], delay: 30 }));
  $('finder-start-btn').click();
  await waitFor(() => visibleStep() === 'scan');
  await sleep(150);
  $('finder-scan-cancel-btn').click();
  await waitFor(() => visibleStep() === 'choose', 5000);
  check('cancel returns to the choose step without an error', visibleStep() === 'choose' && $('finder-choose-error').hidden);
  await sleep(300);
  check('and nothing keeps running afterwards', visibleStep() === 'choose');

  // 5. A failing scan shows its message on the choose step and can be retried.
  PageFinderUI.setDetector(fakeDetector({ pages: 3, high: [1], fail: 'This PDF is password protected, so its pages cannot be read.' }));
  $('finder-start-btn').click();
  await waitFor(() => visibleStep() === 'choose' && !$('finder-choose-error').hidden, 5000);
  check('the error is shown in plain words', /password protected/.test($('finder-choose-error').textContent), $('finder-choose-error').textContent);
  PageFinderUI.setDetector(fakeDetector({ pages: 3, high: [1] }));
  $('finder-start-btn').click();
  await waitFor(() => visibleStep() === 'result', 10000);
  check('a retry works and clears the error', visibleStep() === 'result' && $('finder-choose-error').hidden);

  // 6. Escape closes; reopening starts fresh.
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  $('finder-modal').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(100);
  check('Escape closes the dialog', !isOpen());
  $('finder-open-btn').click();
  await waitFor(isOpen);
  check('reopening starts on the choose step with nothing chosen', visibleStep() === 'choose' && $('finder-pdf-name').textContent === 'No PDF chosen' && $('finder-start-btn').disabled);

  // 7. A PDF already added to the page can be used without choosing it again.
  PageFinderUI.close();
  await handleFiles([await makePdf('Already added.pdf', 4)]);
  PageFinderUI.open();
  await waitFor(isOpen);
  check('already-added PDFs are offered', !$('finder-existing').hidden && [...$('finder-existing').options].some((o) => o.textContent === 'Already added.pdf'), [...$('finder-existing').options].map((o) => o.textContent).join());
  $('finder-existing').value = [...$('finder-existing').options].find((o) => o.textContent === 'Already added.pdf').value;
  $('finder-existing').dispatchEvent(new Event('change', { bubbles: true }));
  check('choosing one enables Start and shows its name', !$('finder-start-btn').disabled && $('finder-pdf-name').textContent === 'Already added.pdf');

  // 8. The optional contents photo: accepted, named, removable. (Reading it is covered in Task 6.)
  const photo = new File([new Uint8Array([137, 80, 78, 71])], 'contents.png', { type: 'image/png' });
  setFile($('finder-index-input'), photo);
  check('the photo is named and can be removed', $('finder-index-name').textContent === 'contents.png' && !$('finder-index-clear').hidden);
  $('finder-index-clear').click();
  check('removing the photo resets it', $('finder-index-name').textContent === 'None' && $('finder-index-clear').hidden);
  PageFinderUI.close();
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run ui-check -- tools/ui/pagefinder-flow.js 90000`
Expected: FAIL (`landing page has the Find page numbers button` fails, then `scenario threw` on the missing dialog).

- [ ] **Step 3: Add the landing button, the modal markup and the script tags**

In `index.html`, inside `<div class="empty-actions">`, after the "Scan via Camera" label, add:

```html
            <button type="button" class="btn btn-outline btn-lg" id="finder-open-btn">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="10" y1="6" x2="21" y2="6"></line>
                <line x1="10" y1="12" x2="21" y2="12"></line>
                <line x1="10" y1="18" x2="21" y2="18"></line>
                <path d="M4 6h1v4"></path>
                <path d="M4 10h2"></path>
                <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"></path>
              </svg>
              <span>Find page numbers</span>
            </button>
```

Immediately before `<div class="processing-modal" id="processing-modal">` add the modal:

```html
    <!-- Find Page Numbers Modal -->
    <div class="crop-modal finder-modal" id="finder-modal" role="dialog" aria-modal="true" aria-labelledby="finder-title">
      <div class="crop-backdrop" id="finder-backdrop"></div>
      <div class="crop-panel finder-panel">
        <div class="crop-header">
          <h4 id="finder-title">Find page numbers</h4>
          <button type="button" class="lightbox-close-btn" id="finder-close-btn" title="Close (Esc)" aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <!-- Step 1: choose -->
        <div class="finder-step" id="finder-step-choose">
          <p class="crop-hint">Choose your scanned journal. Adding a photo of your contents page is optional, and makes the result more accurate.</p>
          <div class="finder-source">
            <label class="btn btn-outline" for="finder-pdf-input">Choose journal PDF</label>
            <input type="file" id="finder-pdf-input" accept="application/pdf,.pdf" class="sr-only">
            <span class="finder-file-name" id="finder-pdf-name">No PDF chosen</span>
          </div>
          <div class="finder-source">
            <select id="finder-existing" class="form-input" aria-label="Or use a PDF you already added" hidden></select>
          </div>
          <div class="finder-source">
            <label class="btn btn-outline" for="finder-index-input">Add contents page photo (optional)</label>
            <input type="file" id="finder-index-input" accept="image/png, image/jpeg, image/webp" class="sr-only">
            <span class="finder-file-name" id="finder-index-name">None</span>
            <button type="button" class="btn btn-outline" id="finder-index-clear" hidden>Remove</button>
          </div>
          <p class="split-summary crop-hint-error" id="finder-choose-error" role="alert" hidden></p>
          <div class="crop-footer">
            <span class="crop-spacer"></span>
            <button type="button" class="btn btn-outline" id="finder-choose-cancel-btn">Cancel</button>
            <button type="button" class="btn btn-primary" id="finder-start-btn" disabled>Start scan</button>
          </div>
        </div>

        <!-- Step 2: scan -->
        <div class="finder-step" id="finder-step-scan" hidden>
          <p class="crop-hint" id="finder-scan-text" role="status">Preparing…</p>
          <div class="progress-bar-container"><div class="progress-bar-fill" id="finder-progress"></div></div>
          <div class="crop-footer">
            <span class="crop-spacer"></span>
            <button type="button" class="btn btn-outline" id="finder-scan-cancel-btn">Cancel scan</button>
          </div>
        </div>

        <!-- Step 3: result -->
        <div class="finder-step" id="finder-step-result" hidden>
          <div class="finder-toolbar">
            <label class="split-field" id="finder-entries-field" for="finder-entries-input" hidden>Entries in the contents page
              <input type="number" id="finder-entries-input" inputmode="numeric" min="1" step="1">
            </label>
            <label class="split-field" for="finder-assign-input">Assignments at the end
              <input type="number" id="finder-assign-input" inputmode="numeric" min="0" step="1" value="2">
            </label>
          </div>
          <div class="finder-warnings" id="finder-warnings" role="status"></div>
          <div class="finder-rows" id="finder-rows"></div>
          <div class="finder-chips" id="finder-chips"></div>
          <fieldset class="finder-counting">
            <legend>How should pages be counted?</legend>
            <label class="finder-radio"><input type="radio" name="finder-counting" id="finder-count-as-is" value="as-is"> As they are in this PDF</label>
            <label class="finder-radio"><input type="radio" name="finder-counting" id="finder-count-add" value="add"> Count
              <input type="number" id="finder-extra" inputmode="numeric" min="0" max="20" step="1" value="2" aria-label="Number of extra pages in front">
              extra pages in front (certificate, index or others)</label>
          </fieldset>
          <p class="split-summary" id="finder-count-note" aria-live="polite"></p>
          <div class="crop-footer">
            <button type="button" class="btn btn-outline" id="finder-back-btn">Back</button>
            <span class="crop-spacer"></span>
            <button type="button" class="btn btn-primary" id="finder-copy-btn">Copy result</button>
          </div>
        </div>

        <!-- Page picker (opened from a result row) -->
        <div class="finder-picker" id="finder-picker" role="dialog" aria-modal="false" aria-labelledby="finder-picker-title" hidden>
          <div class="crop-header">
            <h4 id="finder-picker-title">Choose a page</h4>
            <button type="button" class="lightbox-close-btn" id="finder-picker-close-btn" aria-label="Close the page list">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
          <div class="finder-picker-list" id="finder-picker-list"></div>
          <label class="split-field" for="finder-picker-other">Another page
            <input type="number" id="finder-picker-other" inputmode="numeric" min="1" step="1">
            <button type="button" class="btn btn-outline" id="finder-picker-other-btn">Use this page</button>
          </label>
        </div>
      </div>
    </div>

```

After the existing `<script src="split-dialog.js..."></script>` line add (order matters: logic before UI):

```html
  <script src="page-finder.js?v=2.8.0"></script>
  <script src="page-finder-ui.js?v=2.8.0"></script>
```

- [ ] **Step 4: Add the shared detector accessor and button wiring in `app.js`**

Replace the body of `detectPage` so the Auto Crop detector is shared:

```js
/** One Auto Crop detector for the whole page: the model loads once, on first use. */
function getPageDetector() {
  if (!pageDetector) pageDetector = PageDetect.createDetector();
  return pageDetector;
}

/** The corner model is created on first use and loads only then. */
function detectPage(item) {
  return loadImageFromUrl(item.thumbnailDataUrl).then((img) => getPageDetector().detect(img));
}
```

(Replace the existing `detectPage` function, which currently creates `pageDetector` inline.) In `initializeApp`, next to the other toolbar listeners, add:

```js
  document.getElementById('finder-open-btn').addEventListener('click', () => PageFinderUI.open());
```

- [ ] **Step 5: Write `page-finder-ui.js` (choose and scan steps, plain result)**

Create `page-finder-ui.js`:

```js
/**
 * PDF Page Studio - Find page numbers dialog
 * Choose a journal PDF (and optionally a photo of its contents page), scan it, and show where
 * each section starts. This file owns the dialog; the rules live in page-finder.js.
 */
(function () {
  const $ = (id) => document.getElementById(id);

  let ui = null;       // cached elements, built on first open
  let st = null;       // state of one open dialog
  let detector = null; // SectionDetect detector (replaceable in tests)
  let analyseIndex = null;

  function build() {
    if (ui) return ui;
    ui = {
      modal: $('finder-modal'), backdrop: $('finder-backdrop'), close: $('finder-close-btn'),
      steps: { choose: $('finder-step-choose'), scan: $('finder-step-scan'), result: $('finder-step-result') },
      pdfInput: $('finder-pdf-input'), pdfName: $('finder-pdf-name'), existing: $('finder-existing'),
      indexInput: $('finder-index-input'), indexName: $('finder-index-name'), indexClear: $('finder-index-clear'),
      chooseError: $('finder-choose-error'), chooseCancel: $('finder-choose-cancel-btn'), start: $('finder-start-btn'),
      scanText: $('finder-scan-text'), progress: $('finder-progress'), scanCancel: $('finder-scan-cancel-btn'),
      rows: $('finder-rows'), back: $('finder-back-btn'), copy: $('finder-copy-btn')
    };
    ui.close.addEventListener('click', close);
    ui.backdrop.addEventListener('click', close);
    ui.chooseCancel.addEventListener('click', close);
    ui.modal.addEventListener('keydown', onKeydown);
    ui.pdfInput.addEventListener('change', () => { if (ui.pdfInput.files[0]) choosePdf(ui.pdfInput.files[0]); ui.pdfInput.value = ''; });
    ui.existing.addEventListener('change', () => {
      if (ui.existing.value === '') return;
      const file = st.existingFiles[Number(ui.existing.value)];
      if (file) choosePdf(file);
    });
    ui.indexInput.addEventListener('change', () => { if (ui.indexInput.files[0]) chooseIndex(ui.indexInput.files[0]); ui.indexInput.value = ''; });
    ui.indexClear.addEventListener('click', () => chooseIndex(null));
    ui.start.addEventListener('click', start);
    ui.scanCancel.addEventListener('click', () => { if (st.controller) st.controller.abort(); });
    ui.back.addEventListener('click', () => { freeResult(); showStep('choose'); });
    return ui;
  }

  const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

  function showStep(name) {
    Object.keys(ui.steps).forEach((key) => { ui.steps[key].hidden = key !== name; });
  }

  function showChooseError(message) {
    ui.chooseError.textContent = message || '';
    ui.chooseError.hidden = !message;
  }

  function choosePdf(file) {
    if (!isPdf(file)) {
      st.pdfFile = null;
      ui.pdfName.textContent = 'No PDF chosen';
      ui.start.disabled = true;
      showChooseError('Please choose a PDF file. This is the scanned journal whose pages will be checked.');
      return;
    }
    st.pdfFile = file;
    ui.pdfName.textContent = file.name;
    ui.start.disabled = false;
    showChooseError('');
  }

  function chooseIndex(file) {
    st.indexFile = file;
    ui.indexName.textContent = file ? file.name : 'None';
    ui.indexClear.hidden = !file;
  }

  function fillExisting() {
    const seen = new Map();
    state.pages.forEach((p) => { if (p.sourceType === 'pdf' && !seen.has(p.sourceFile)) seen.set(p.sourceFile, p.fileName); });
    st.existingFiles = [...seen.keys()];
    ui.existing.innerHTML = '';
    if (st.existingFiles.length === 0) { ui.existing.hidden = true; return; }
    const placeholder = document.createElement('option');
    placeholder.textContent = 'Or use a PDF you already added…';
    placeholder.value = '';
    ui.existing.appendChild(placeholder);
    st.existingFiles.forEach((file, i) => {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = seen.get(file);
      ui.existing.appendChild(option);
    });
    ui.existing.hidden = false;
  }

  /** Free every blob URL made for the current result (heading thumbnails, entry crops). */
  function freeResult() {
    if (!st) return;
    (st.thumbs || []).forEach((u) => URL.revokeObjectURL(u));
    ((st.indexInfo && st.indexInfo.cropUrls) || []).forEach((u) => URL.revokeObjectURL(u));
    st.thumbs = null;
    st.indexInfo = null;
    st.scores = null;
  }

  function setProgress(fraction, text) {
    ui.progress.style.width = `${Math.round(fraction * 100)}%`;
    ui.scanText.textContent = text;
  }

  function getDetector() {
    if (!detector) detector = SectionDetect.createSectionDetector();
    return detector;
  }

  /** Default contents-page reader: find the page in the photo, flatten it, count the entries. */
  async function defaultAnalyseIndex(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImageFromUrl(url);
      let source = img;
      let warning = null;
      try {
        const found = await getPageDetector().detect(img);
        if (found.quad && found.confidence >= 0.6 && CropGeometry.isValidQuad(found.quad)) {
          const fit = ImageNormalize.fitWithin(img.naturalWidth, img.naturalHeight, 2000);
          const canvas = document.createElement('canvas');
          canvas.width = fit.width;
          canvas.height = fit.height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, fit.width, fit.height);
          const quadPx = found.quad.map(([x, y]) => [x * fit.width, y * fit.height]);
          const natural = CropGeometry.quadOutputSize(quadPx);
          const size = CropGeometry.capPixels(natural.width, natural.height, 1200000);
          const warped = CropGeometry.warpPerspective(ctx.getImageData(0, 0, fit.width, fit.height), quadPx, size.width, size.height);
          const out = document.createElement('canvas');
          out.width = warped.width;
          out.height = warped.height;
          out.getContext('2d').putImageData(new ImageData(warped.data, warped.width, warped.height), 0, 0);
          source = out;
        } else {
          warning = 'The page edges in the contents photo were not found, so the whole photo was used.';
        }
      } catch (err) {
        warning = 'The page edges in the contents photo could not be detected, so the whole photo was used.';
      }
      const result = await IndexScan.analyseImage(source);
      const cropUrls = await Promise.all(result.crops.map((c) => canvasToObjectUrl(c, 'image/jpeg', 0.8)));
      return { count: result.estimate.count, cropUrls, warning: result.warning || warning };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function start() {
    if (!st.pdfFile || st.running) return;
    const session = st;                       // the dialog may be closed while the scan runs
    session.running = true;
    session.controller = new AbortController();
    showChooseError('');
    freeResult();
    showStep('scan');
    setProgress(0, 'Preparing…');
    const cancelled = () => Object.assign(new Error('Scan cancelled.'), { name: 'AbortError' });
    try {
      if (session.indexFile) {
        setProgress(0, 'Reading your contents page…');
        session.indexInfo = await (analyseIndex || defaultAnalyseIndex)(session.indexFile);
        if (session.controller.signal.aborted) throw cancelled();
      }
      const out = await getDetector().score(session.pdfFile, {
        signal: session.controller.signal,
        onProgress: (done, total) => { if (st === session) setProgress(done / total, `Checking page ${done} of ${total}…`); }
      });
      if (st !== session) { out.thumbs.forEach((u) => URL.revokeObjectURL(u)); return; }
      session.scores = out.scores;
      session.thumbs = out.thumbs;
      session.pageCount = out.pageCount;
      initResult();
      showStep('result');
      renderResult();
    } catch (err) {
      if (st !== session) return;             // closed: nothing to show
      freeResult();
      showStep('choose');
      if (err && err.name !== 'AbortError') showChooseError(err.message || 'The scan failed. Please try again.');
    } finally {
      session.running = false;
      session.controller = null;
    }
  }

  /** Result state starts here; Task 6 fills in the editing controls. */
  function initResult() {
    st.entryCount = st.indexInfo && st.indexInfo.count > 0 ? st.indexInfo.count : null;
  }

  /** Plain result: one row per section with its heading thumbnail. Replaced by the full version in Task 6. */
  function renderResult() {
    const picks = PageFinder.pickSections(st.scores, { entryCount: st.entryCount || undefined });
    ui.rows.innerHTML = '';
    picks.sections.forEach((section, i) => {
      const row = document.createElement('div');
      row.className = 'finder-row';
      row.dataset.index = String(i);
      const img = document.createElement('img');
      img.className = 'finder-thumb';
      img.src = st.thumbs[section.page - 1];
      img.alt = `Heading of page ${section.page}`;
      const text = document.createElement('span');
      text.className = 'finder-page-btn';
      text.textContent = `page ${section.page}`;
      row.append(img, text);
      ui.rows.appendChild(row);
    });
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = [...ui.modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select')].filter((el) => el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function open() {
    build();
    if (st && st.controller) st.controller.abort();
    freeResult();
    st = { pdfFile: null, indexFile: null, running: false, controller: null, existingFiles: [], opener: document.activeElement };
    ui.pdfName.textContent = 'No PDF chosen';
    chooseIndex(null);
    ui.start.disabled = true;
    showChooseError('');
    fillExisting();
    showStep('choose');
    ui.modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    ui.start.disabled = true;
    ui.pdfInput.focus();
  }

  function close() {
    if (!ui || !st) return;
    if (st.controller) st.controller.abort();
    freeResult();
    ui.modal.classList.remove('active');
    document.body.style.overflow = '';
    const opener = st.opener;
    st = null;
    if (opener && typeof opener.focus === 'function') opener.focus();
  }

  window.PageFinderUI = {
    open,
    close,
    isOpen: () => !!st && !!ui && ui.modal.classList.contains('active'),
    setDetector(d) { detector = d; },
    setIndexAnalyser(fn) { analyseIndex = fn; }
  };
}());
```

- [ ] **Step 6: Add the styles**

In `styles.css`, before the `@media (max-width: 768px) {\n  .crop-panel {` block, add:

```css
/* Find page numbers dialog */
.finder-panel {
  width: min(880px, 100%);
  max-height: calc(100vh - 32px);
  overflow-y: auto;
}

.finder-step[hidden],
.finder-picker[hidden],
.finder-source [hidden] {
  display: none;
}

.finder-step {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.finder-source {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.finder-file-name {
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  color: var(--text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.finder-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.finder-warnings {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.finder-warnings p {
  margin: 0;
  padding: 8px 10px;
  font-size: 13px;
  color: var(--text-primary);
  background-color: var(--bg-surface-hover);
  border-left: 3px solid var(--accent-terracotta);
  border-radius: var(--radius-xs);
}

.finder-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.finder-row {
  display: grid;
  grid-template-columns: 150px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 8px;
  background-color: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

.finder-thumb {
  width: 150px;
  height: auto;
  background-color: var(--bg-canvas);
  border-radius: var(--radius-xs);
}

.finder-row-main {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.finder-label {
  width: 100%;
  padding: 6px 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  background-color: var(--bg-surface);
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
}

.finder-label:hover,
.finder-label:focus-visible {
  border-color: var(--border-strong);
  outline: none;
}

.finder-entry-crop {
  max-height: 56px;
  overflow: hidden;
  border-radius: var(--radius-xs);
}

.finder-entry-crop img {
  width: 100%;
  height: auto;
}

.finder-page-btn {
  min-width: 84px;
  padding: 8px 12px;
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  text-align: center;
  background-color: var(--bg-surface-hover);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

button.finder-page-btn {
  cursor: pointer;
}

button.finder-page-btn:hover,
button.finder-page-btn:focus-visible {
  border-color: var(--accent-terracotta);
  outline: none;
}

.finder-status {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--accent-terracotta-hover);
}

.finder-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.finder-chip {
  padding: 6px 10px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-primary);
  cursor: pointer;
  background-color: var(--bg-surface);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
}

.finder-chip:hover,
.finder-chip:focus-visible {
  border-color: var(--accent-terracotta);
  outline: none;
}

.finder-counting {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

.finder-counting legend {
  padding: 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.finder-radio {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--text-primary);
}

.finder-radio input[type="number"] {
  width: 64px;
  padding: 4px 6px;
  font-family: var(--font-mono);
  color: var(--text-primary);
  background-color: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xs);
}

.finder-picker {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  overflow-y: auto;
  background-color: var(--bg-surface);
  border-radius: var(--radius-lg);
}

.finder-picker-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
}

.finder-picker-option {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  font-size: 13px;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  background-color: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

.finder-picker-option:hover,
.finder-picker-option:focus-visible {
  border-color: var(--accent-terracotta);
  outline: none;
}

.finder-picker-option img {
  width: 100%;
  height: auto;
  border-radius: var(--radius-xs);
}

@media (max-width: 768px) {
  .finder-row {
    grid-template-columns: 96px 1fr;
  }

  .finder-thumb {
    width: 96px;
  }

  .finder-row .finder-page-btn {
    grid-column: 1 / -1;
  }
}
```

- [ ] **Step 7: Run the checks**

Run: `node --check app.js && node --check page-finder-ui.js && npm test`
Expected: pass.

Run: `npm run ui-check -- tools/ui/pagefinder-flow.js 90000`
Expected: all `PASS`.

Run each earlier scenario once more: `for s in smoke ingest export editor detect autocrop split split-ranges startover smooth ingest-speed exportname; do npm run ui-check -- tools/ui/$s.js || break; done`
Expected: all `PASS` (the landing page gained a button, and `detectPage` was refactored).

- [ ] **Step 8: Commit**

```bash
git add page-finder-ui.js tools/ui/pagefinder-flow.js index.html styles.css app.js
git commit -m "feat: add the Find page numbers dialog with choose and scan steps"
```

---

### Task 6: The result screen: names, picker, warnings, counting, copy

**Files:**
- Modify: `page-finder-ui.js` (replace `initResult` and `renderResult`, add the functions below)
- Create: `tools/ui/pagefinder.js`

**Interfaces:**
- Consumes: Task 2 functions (`pickSections`, `assignEntries`, `makeLabels`, `adjacentPairs`, `frontPageCount`, `defaultCounting`, `describeCounting`, `formatResult`), the Task 5 element ids.
- Produces: the finished result screen: typed rows with heading thumbnail, editable name, page button opening the picker, status badges; entries and assignments steppers; warnings; "more possible pages" chips and row removal when there is no contents photo; counting radios with an extra-pages field; Copy.

- [ ] **Step 1: Write the failing scenario**

Create `tools/ui/pagefinder.js`:

```js
// The result screen: typed lines, editing, picker, reconciliation warnings, counting choices, copy.
const $ = (id) => document.getElementById(id);
const rows = () => [...$('finder-rows').querySelectorAll('.finder-row')];
const label = (i) => rows()[i].querySelector('.finder-label').value;
const pageText = (i) => rows()[i].querySelector('.finder-page-btn').textContent.replace(/^page\s*/, '').trim();
const warnings = () => $('finder-warnings').textContent;
const setFile = (input, file) => { const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); };
const typeInto = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
let copied = null;
const pickerOption = (title) => [...$('finder-picker-list').querySelectorAll('.finder-picker-option')].find((b) => b.querySelector('strong').textContent === title);

async function makePdf(name, n) {
  const doc = await PDFLib.PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([595, 842]);
  return new File([await doc.save()], name, { type: 'application/pdf' });
}
async function thumbUrl(text) {
  const c = document.createElement('canvas'); c.width = 320; c.height = 100;
  const g = c.getContext('2d'); g.fillStyle = '#f5f2eb'; g.fillRect(0, 0, 320, 100); g.fillStyle = '#222'; g.font = '30px sans-serif'; g.fillText(text, 20, 60);
  return new Promise((r) => c.toBlob((b) => r(URL.createObjectURL(b)), 'image/png'));
}
/** `high` lists heading pages; `mid` lists pages with a middling score (above 0, below the cut-off). */
function fake({ pages, high, mid = [] }) {
  return { async score(file, { onProgress } = {}) {
    const scores = [], thumbs = [];
    for (let p = 1; p <= pages; p++) {
      scores.push({ page: p, score: high.includes(p) ? 4 + p / 100 : mid.includes(p) ? 0.5 + p / 1000 : -3 - p / 100 });
      thumbs.push(await thumbUrl('page ' + p));
      if (onProgress) onProgress(p, pages);
    }
    return { scores, thumbs, pageCount: pages };
  } };
}
async function run({ pages, high, mid, index }) {
  PageFinderUI.open();
  await waitFor(() => PageFinderUI.isOpen());
  setFile($('finder-pdf-input'), await makePdf('journal.pdf', pages));
  if (index) setFile($('finder-index-input'), new File([new Uint8Array([137, 80, 78, 71])], 'contents.png', { type: 'image/png' }));
  PageFinderUI.setDetector(fake({ pages, high, mid }));
  PageFinderUI.setIndexAnalyser(async () => index || { count: 0, cropUrls: [], warning: null });
  $('finder-start-btn').click();
  await waitFor(() => !$('finder-step-result').hidden, 20000);
}

async function scenario() {
  navigator.clipboard.writeText = async (text) => { copied = text; };

  // 1. No contents photo, two journals ends: proposed sections, typed labels, counting pre-answer.
  await run({ pages: 14, high: [3, 5, 8, 10, 12] });          // certificate + index in front (pages 1-2)
  check('five rows, one per heading page', rows().length === 5, String(rows().length));
  check('rows show the PDF page numbers when pages 1-2 are already in the PDF', [0, 1, 2, 3, 4].map(pageText).join() === '3,5,8,10,12', [0, 1, 2, 3, 4].map(pageText).join());
  check('typed labels: experiments then the last two as assignments', [0, 1, 2, 3, 4].map(label).join() === 'Experiment 1,Experiment 2,Experiment 3,Assignment 1,Assignment 2', [0, 1, 2, 3, 4].map(label).join());
  check('"as in this PDF" is pre-answered (2 pages in front)', $('finder-count-as-is').checked && !$('finder-count-add').checked);
  check('the counting sentence is shown', /Page numbers are the PDF page numbers/.test($('finder-count-note').textContent), $('finder-count-note').textContent);
  check('without a contents photo the entries field is hidden and a hint is shown', $('finder-entries-field').hidden && /contents-page photo/i.test(warnings()));
  check('every row has a heading thumbnail', rows().every((r) => /^blob:/.test(r.querySelector('.finder-thumb').src)));

  // 2. Copy: the typed lines and the counting sentence.
  $('finder-copy-btn').click();
  await sleep(100);
  check('copy puts the typed result on the clipboard', copied === ['Experiment 1 – page 3', 'Experiment 2 – page 5', 'Experiment 3 – page 8', 'Assignment 1 – page 10', 'Assignment 2 – page 12', '', 'Page numbers are the PDF page numbers.'].join('\n'), JSON.stringify(copied));

  // 3. Counting choices: add extra pages.
  $('finder-count-add').click();
  check('choosing "extra pages" shows page + 2', [0, 4].map(pageText).join() === '5,14', [0, 4].map(pageText).join());
  typeInto($('finder-extra'), '4');
  check('the extra pages value is editable', pageText(0) === '7' && /4 extra pages/.test($('finder-count-note').textContent), pageText(0) + ' / ' + $('finder-count-note').textContent);
  typeInto($('finder-extra'), '0');
  check('0 extra pages gives the PDF numbers', pageText(0) === '3');
  typeInto($('finder-extra'), '99');
  check('extra pages are limited to 20', pageText(0) === '23', pageText(0));
  $('finder-count-as-is').click();
  check('switching back restores the PDF numbers', pageText(0) === '3' && $('finder-count-as-is').checked);

  // 4. Names: assignments stepper and typing.
  typeInto($('finder-assign-input'), '1');
  check('one assignment: only the last row is an assignment', [0, 1, 2, 3, 4].map(label).join() === 'Experiment 1,Experiment 2,Experiment 3,Experiment 4,Assignment 1', [0, 1, 2, 3, 4].map(label).join());
  typeInto($('finder-assign-input'), '0');
  check('no assignments: all experiments', label(4) === 'Experiment 5');
  typeInto($('finder-assign-input'), '2');
  const nameField = rows()[2].querySelector('.finder-label');
  typeInto(nameField, 'Experiment 3: Hamming code');
  check('a name can be typed and is kept', label(2) === 'Experiment 3: Hamming code');
  $('finder-copy-btn').click();
  await sleep(50);
  check('the typed name appears in the copied text', /Experiment 3: Hamming code – page 8/.test(copied), copied);

  // 5. The page picker: choose another page, "not in this PDF", or any page number.
  rows()[1].querySelector('.finder-page-btn').click();
  await waitFor(() => !$('finder-picker').hidden);
  check('the picker lists pages with thumbnails and a "Not in this PDF" option', $('finder-picker-list').querySelectorAll('.finder-picker-option').length >= 8 && /Not in this PDF/.test($('finder-picker-list').textContent));
  pickerOption('Page 6').click();
  check('choosing page 6 sets that row (and the picker closes)', pageText(1) === '6' && $('finder-picker').hidden, pageText(1));
  rows()[1].querySelector('.finder-page-btn').click();
  await waitFor(() => !$('finder-picker').hidden);
  pickerOption('Not in this PDF').click();
  check('"Not in this PDF" marks the row and removes its page number', /not in this pdf/i.test(rows()[1].textContent) && pageText(1) === '—', rows()[1].textContent);
  check('the entries after it move up to the next sections', [2, 3, 4].map(pageText).join() === '5,8,10', [2, 3, 4].map(pageText).join());
  $('finder-copy-btn').click();
  await sleep(50);
  check('the copied text says "not in this PDF"', /Experiment 2 – not in this PDF/.test(copied), copied);
  rows()[1].querySelector('.finder-page-btn').click();
  await waitFor(() => !$('finder-picker').hidden);
  typeInto($('finder-picker-other'), '11');
  $('finder-picker-other-btn').click();
  check('any page number can be typed', pageText(1) === '11', pageText(1));
  rows()[1].querySelector('.finder-page-btn').click();
  await waitFor(() => !$('finder-picker').hidden);
  typeInto($('finder-picker-other'), '99');
  $('finder-picker-other-btn').click();
  check('a page beyond the PDF is refused and the picker stays open', !$('finder-picker').hidden && pageText(1) === '11');
  $('finder-picker-close-btn').click();
  check('the picker closes without a change', $('finder-picker').hidden && pageText(1) === '11');
  rows()[0].querySelector('.finder-page-btn').click();
  await waitFor(() => !$('finder-picker').hidden);
  pickerOption('Page 8').click();
  check('a page that two rows share is reported', /Page 8 is used for more than one entry/.test(warnings()), warnings());
  rows()[0].querySelector('.finder-page-btn').click();
  await waitFor(() => !$('finder-picker').hidden);
  pickerOption('Automatic').click();
  check('"Automatic" puts the suggested page back and clears the warning', pageText(0) === '3' && !/used for more than one/.test(warnings()), pageText(0));

  // 6. Remove a wrong section, add a missed one from the candidate chips (no contents photo).
  const before = rows().length;
  const chips = [...$('finder-chips').querySelectorAll('.finder-chip')];
  check('"more possible pages" are offered as chips', chips.length > 0 && chips.length <= 10, String(chips.length));
  chips[0].click();
  check('adding a chip adds a row', rows().length === before + 1);
  rows()[0].querySelector('.finder-remove').click();
  check('a row can be removed when there is no contents photo', rows().length === before);
  PageFinderUI.close();

  // 7. The contents photo, DWM-like: 13 entries but only 10 pages look like headings (pages 1 3 5 7 10 13 15 17 20 26).
  await run({ pages: 36, high: [1, 3, 5, 7, 10, 13, 15, 17, 20, 26], index: { count: 13, cropUrls: [], warning: null } });
  check('13 rows (the entry count) are shown', rows().length === 13, String(rows().length));
  check('the entries field shows 13', !$('finder-entries-field').hidden && $('finder-entries-input').value === '13');
  check('a mismatch warning explains the situation', /13 entries/.test(warnings()) && /only 10 pages/.test(warnings()) && /Not in this PDF/.test(warnings()), warnings());
  check('entries with no heading-like page say "Page not found" (no junk pages are used)', [10, 11, 12].every((i) => /Page not found/i.test(rows()[i].textContent)), [10, 11, 12].map((i) => rows()[i].textContent).join(' | '));
  check('the ten clear headings fill the first ten rows in order (shown +2: nothing is in front)', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(pageText).join() === '3,5,7,9,12,15,17,19,22,28', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(pageText).join());
  const pick = async (i, title) => { rows()[i].querySelector('.finder-page-btn').click(); await waitFor(() => !$('finder-picker').hidden); pickerOption(title).click(); };
  await pick(8, 'Not in this PDF'); await pick(9, 'Not in this PDF'); await pick(10, 'Not in this PDF');
  check('after marking Experiments 9-11 "not in this PDF" the assignments move up to their pages', pageText(11) === '22' && pageText(12) === '28', pageText(11) + ',' + pageText(12));
  check('and no entry is left without a page that should have one', ![11, 12].some((i) => /Page not found/i.test(rows()[i].textContent)));
  $('finder-copy-btn').click();
  await sleep(50);
  check('the copied list shows Experiments 9-11 as not in this PDF', /Experiment 9 – not in this PDF\nExperiment 10 – not in this PDF\nExperiment 11 – not in this PDF\nAssignment 1 – page 22\nAssignment 2 – page 28/.test(copied), copied);
  check('no more-pages chips when the contents photo fixed the count', $('finder-chips').children.length === 0);
  PageFinderUI.close();

  // 7a. A contents photo whose table could not be read: the user types the entry count.
  await run({ pages: 12, high: [2, 4, 6, 9], index: { count: 0, cropUrls: [], warning: 'The table in this photo could not be read. Enter the number of entries yourself.' } });
  check('an unreadable photo shows its warning', /could not be read/.test(warnings()), warnings());
  check('the entries field is visible and empty so the count can be typed', !$('finder-entries-field').hidden && $('finder-entries-input').value === '');
  check('until then the clear headings are listed (4 rows, remove buttons shown)', rows().length === 4 && !!rows()[0].querySelector('.finder-remove'), String(rows().length));
  typeInto($('finder-entries-input'), '3');
  check('typing 3 uses the three best pages and hides the remove buttons', rows().length === 3 && !rows()[0].querySelector('.finder-remove'), String(rows().length));
  typeInto($('finder-entries-input'), '');
  check('clearing the count returns to the clear headings', rows().length === 4);
  PageFinderUI.close();

  // 7b. Two clear headings in a row are flagged once.
  await run({ pages: 20, high: [4, 5, 9] });
  check('adjacent clear headings produce one warning', /Two heading pages in a row \(4 and 5\)/.test(warnings()) && (warnings().match(/Two heading pages in a row/g) || []).length === 1, warnings());
  PageFinderUI.close();

  // 8. Fewer entries than headings, then the stepper changes the count.
  await run({ pages: 12, high: [2, 4, 6, 8], index: { count: 3, cropUrls: [], warning: null } });
  check('three entries take the three best-scoring pages (shown in page order)', rows().length === 3 && [0, 1, 2].map(pageText).join() === '4,6,8', [0, 1, 2].map(pageText).join());
  typeInto($('finder-entries-input'), '4');
  check('changing the entry count to 4 adds the fourth heading', rows().length === 4 && pageText(3) === '8', rows().length + ' / ' + pageText(3));
  PageFinderUI.close();

  // 9. Review Focus 1: no heading pages at all.
  await run({ pages: 6, high: [] });
  check('no sections: a clear message and no rows', rows().length === 0 && /No heading pages were found/.test(warnings()), warnings());
  check('candidates are offered', $('finder-chips').querySelectorAll('.finder-chip').length === 6);
  $('finder-copy-btn').click();
  await sleep(50);
  check('copied text is "No sections found." plus the counting sentence', /^No sections found\./.test(copied), copied);
  PageFinderUI.close();

  // 10. Review Focus 5: one page in front is ambiguous; the user decides.
  await run({ pages: 10, high: [2, 4, 6] });
  check('one page in front: neither choice is pre-selected', !$('finder-count-as-is').checked && !$('finder-count-add').checked);
  check('and the screen asks', /1 page before the first heading/.test(warnings() + $('finder-count-note').textContent), warnings());
  check('Copy waits for the choice', $('finder-copy-btn').disabled);
  $('finder-count-add').click();
  check('choosing unlocks Copy and adds 1 page', !$('finder-copy-btn').disabled && pageText(0) === '3', pageText(0));
  PageFinderUI.close();

  // 11. Nothing in front (DWM, WMC): "extra pages: 2" is pre-answered.
  await run({ pages: 10, high: [1, 3, 5] });
  check('nothing in front: extra pages 2 is pre-selected', $('finder-count-add').checked && $('finder-extra').value === '2' && [0, 1, 2].map(pageText).join() === '3,5,7', [0, 1, 2].map(pageText).join());
  check('the sentence states the rule', /include 2 extra pages in front of this PDF/.test($('finder-count-note').textContent), $('finder-count-note').textContent);
  PageFinderUI.close();
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run ui-check -- tools/ui/pagefinder.js 120000`
Expected: FAIL at the first checks (`rows show the PDF page numbers...`, the Task 5 placeholder shows `page 3` text without labels or controls).

- [ ] **Step 3: Replace `initResult` and `renderResult` and add the helpers**

In `page-finder-ui.js`, extend the cached element list in `build()` (inside the `ui = {...}` object add):

```js
      entriesField: $('finder-entries-field'), entriesInput: $('finder-entries-input'), assignInput: $('finder-assign-input'),
      warnings: $('finder-warnings'), chips: $('finder-chips'),
      countAsIs: $('finder-count-as-is'), countAdd: $('finder-count-add'), extra: $('finder-extra'), countNote: $('finder-count-note'),
      picker: $('finder-picker'), pickerTitle: $('finder-picker-title'), pickerList: $('finder-picker-list'),
      pickerOther: $('finder-picker-other'), pickerOtherBtn: $('finder-picker-other-btn'), pickerClose: $('finder-picker-close-btn'),
```

and, at the end of `build()` before `return ui;`, add the listeners:

```js
    ui.entriesInput.addEventListener('input', () => {
      const raw = ui.entriesInput.value.trim();
      if (raw === '') { st.entryCount = null; renderResult(); return; }   // cleared: back to the pages that clearly look like headings
      const n = Math.round(Number(raw));
      if (n >= 1 && n <= st.pageCount) { st.entryCount = n; renderResult(); }
    });
    ui.assignInput.addEventListener('input', () => {
      const n = Math.round(Number(ui.assignInput.value));
      st.assignments = Number.isFinite(n) ? Math.max(0, n) : PageFinder.DEFAULT_ASSIGNMENTS;
      renderResult();
    });
    ui.countAsIs.addEventListener('click', () => { st.counting = { mode: 'as-is', extra: st.counting.extra }; st.countingTouched = true; renderResult(); });
    ui.countAdd.addEventListener('click', () => { st.counting = { mode: 'add', extra: st.counting.extra > 0 ? st.counting.extra : 2 }; st.countingTouched = true; renderResult(); });
    ui.extra.addEventListener('input', () => {
      st.counting = { mode: 'add', extra: Number(ui.extra.value) };
      st.countingTouched = true;
      renderResult();
    });
    ui.copy.addEventListener('click', copyResult);
    ui.pickerClose.addEventListener('click', closePicker);
    ui.pickerOtherBtn.addEventListener('click', () => {
      const page = Number(ui.pickerOther.value);
      if (Number.isInteger(page) && page >= 1 && page <= st.pageCount) choosePickerPage(page);
    });
```

Replace `initResult` and `renderResult` (the Task 5 versions) with:

```js
  function initResult() {
    st.entryCount = st.indexInfo && st.indexInfo.count > 0 ? st.indexInfo.count : null;
    st.assignments = PageFinder.DEFAULT_ASSIGNMENTS;
    st.labelEdits = new Map();     // entry index -> typed name
    st.missing = new Set();        // entries marked "not in this PDF" (the picker stores this as a null override)
    st.overrides = new Map();      // entry index -> page | null chosen by the user
    st.added = new Set();          // pages added from the candidate chips (no contents photo)
    st.removed = new Set();        // pages the user dropped (no contents photo)
    st.counting = { mode: 'as-is', extra: 0 };
    st.countingTouched = false;
    st.pickerEntry = null;
  }

  /** Everything the screen shows, computed from the scores and the user's choices. */
  function derive() {
    const picks = PageFinder.pickSections(st.scores, { entryCount: st.entryCount || undefined });
    let sections = picks.sections;
    if (!st.entryCount) {
      sections = sections.filter((s) => !st.removed.has(s.page))
        .concat(picks.more.filter((m) => st.added.has(m.page)).map((m) => ({ page: m.page, score: m.score, confident: false })))
        .sort((a, b) => a.page - b.page);
    }
    const n = st.entryCount || sections.length;
    const rows = PageFinder.assignEntries(n, sections.map((s) => s.page), st.missing, st.overrides);
    const auto = PageFinder.makeLabels(n, st.assignments);
    const labels = auto.map((text, i) => (st.labelEdits.has(i) ? st.labelEdits.get(i) : text));
    const pages = rows.filter((r) => r.page !== null).map((r) => r.page).sort((a, b) => a - b);
    const front = pages.length ? pages[0] - 1 : 0;
    if (!st.countingTouched) st.counting = PageFinder.defaultCounting(front);
    return { picks, sections, n, rows, labels, pages, front };
  }

  function warningTexts(d) {
    const out = [];
    if (!st.indexFile) out.push('No contents page was added, so only pages that clearly look like headings are listed. Add a contents-page photo for a more accurate result.');
    if (st.indexInfo && st.indexInfo.warning) out.push(st.indexInfo.warning);
    if (d.n === 0) out.push('No heading pages were found. Pick pages from the list of possible pages below.');
    if (st.entryCount) {
      const clear = d.sections.filter((s) => s.confident).length;
      if (clear < st.entryCount) {
        out.push(`Your contents page lists ${st.entryCount} entries but only ${clear} page${clear === 1 ? '' : 's'} clearly look like headings. Entries without a page say "Page not found", and weaker picks are marked "Unsure". Check each heading picture. If an experiment is not in this PDF, open its page number and choose "Not in this PDF": the entries after it move up.`);
      }
    }
    // Two clear headings in a row is unusual (a one-page experiment or a duplicate photo): say so once.
    const clearPages = new Set(d.sections.filter((s) => s.confident).map((s) => s.page));
    const pairs = PageFinder.adjacentPairs(d.pages.filter((p) => clearPages.has(p)));
    if (pairs.length) out.push(`Two heading pages in a row (${pairs.map(([x, y]) => `${x} and ${y}`).join(', ')}): check which one is the real start.`);
    PageFinder.duplicatePages(d.rows).forEach((page) => out.push(`Page ${page} is used for more than one entry. Change one of them.`));
    if (st.counting.mode === 'ask') out.push('There is 1 page before the first heading. Choose below whether it should be counted.');
    return out;
  }

  function renderResult() {
    const d = derive();
    const confident = new Map(d.sections.map((s) => [s.page, s.confident]));

    ui.entriesField.hidden = !st.indexFile;   // shown whenever a contents photo was chosen, so an unreadable photo can still be counted by hand
    ui.entriesInput.max = String(st.pageCount);
    ui.entriesInput.value = st.entryCount ? String(st.entryCount) : '';
    ui.assignInput.value = String(st.assignments);
    ui.assignInput.max = String(d.n);

    ui.warnings.innerHTML = '';
    warningTexts(d).forEach((text) => {
      const p = document.createElement('p');
      p.textContent = text;
      ui.warnings.appendChild(p);
    });

    ui.rows.innerHTML = '';
    d.rows.forEach((row) => {
      const el = document.createElement('div');
      el.className = 'finder-row';
      el.dataset.index = String(row.index);

      const thumb = document.createElement('img');
      thumb.className = 'finder-thumb';
      if (row.page !== null) { thumb.src = st.thumbs[row.page - 1]; thumb.alt = `Heading of page ${row.page}`; }
      else { thumb.alt = 'No page'; thumb.style.visibility = 'hidden'; }

      const main = document.createElement('div');
      main.className = 'finder-row-main';
      const name = document.createElement('input');
      name.type = 'text';
      name.className = 'finder-label';
      name.value = d.labels[row.index];
      name.setAttribute('aria-label', `Name of entry ${row.index + 1}`);
      name.addEventListener('input', () => st.labelEdits.set(row.index, name.value));
      main.appendChild(name);
      const crop = st.indexInfo && st.indexInfo.cropUrls && st.indexInfo.cropUrls[row.index];
      if (crop) {
        const box = document.createElement('div');
        box.className = 'finder-entry-crop';
        const cropImg = document.createElement('img');
        cropImg.src = crop;
        cropImg.alt = `Entry ${row.index + 1} from your contents page`;
        box.appendChild(cropImg);
        main.appendChild(box);
      }
      const status = document.createElement('span');
      status.className = 'finder-status';
      if (row.status === 'missing') status.textContent = 'Not in this PDF';
      else if (row.status === 'unknown') status.textContent = 'Page not found';
      else if (!row.manual && confident.get(row.page) === false) status.textContent = 'Unsure';
      if (status.textContent) main.appendChild(status);
      if (!st.entryCount) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'finder-remove btn btn-outline';
        remove.textContent = 'Remove';
        remove.addEventListener('click', () => { st.removed.add(row.page); st.added.delete(row.page); renderResult(); });
        main.appendChild(remove);
      }

      const pageButton = document.createElement('button');
      pageButton.type = 'button';
      pageButton.className = 'finder-page-btn';
      const shown = PageFinder.numberedPage(row.page, st.counting);
      pageButton.textContent = shown === null ? '—' : `page ${shown}`;
      pageButton.setAttribute('aria-label', `${d.labels[row.index]}: ${shown === null ? 'no page' : 'page ' + shown}. Change`);
      pageButton.addEventListener('click', () => openPicker(row.index));

      el.append(thumb, main, pageButton);
      ui.rows.appendChild(el);
    });

    ui.chips.innerHTML = '';
    if (!st.entryCount) {
      d.picks.more.filter((m) => !st.added.has(m.page)).forEach((m) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'finder-chip';
        chip.textContent = `+ page ${m.page}`;
        chip.title = 'Add this page as a section start';
        chip.addEventListener('click', () => { st.added.add(m.page); st.removed.delete(m.page); renderResult(); });
        ui.chips.appendChild(chip);
      });
    }

    ui.countAsIs.checked = st.counting.mode === 'as-is';
    ui.countAdd.checked = st.counting.mode === 'add';
    ui.extra.value = String(st.counting.extra);
    ui.countNote.textContent = st.counting.mode === 'ask' ? '' : PageFinder.describeCounting(st.counting);
    ui.copy.disabled = st.counting.mode === 'ask';
  }

  function copyResult() {
    const d = derive();
    const text = PageFinder.formatResult(d.rows, d.labels, st.counting);
    const done = () => showToast('Copied. Paste it wherever you need it.');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => showToast('Copy failed. Select the text and copy it by hand.', 'error'));
    } else {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); done(); } catch (err) { showToast('Copy failed.', 'error'); }
      document.body.removeChild(area);
    }
  }

  /* ---- page picker ---- */

  function openPicker(index) {
    const d = derive();
    st.pickerEntry = index;
    ui.pickerTitle.textContent = `Page for ${d.labels[index]}`;
    ui.pickerList.innerHTML = '';
    const option = (text, sub, thumb, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'finder-picker-option';
      if (thumb) { const img = document.createElement('img'); img.src = thumb; img.alt = ''; b.appendChild(img); }
      const strong = document.createElement('strong');
      strong.textContent = text;
      b.appendChild(strong);
      if (sub) { const s = document.createElement('span'); s.textContent = sub; b.appendChild(s); }
      b.addEventListener('click', onClick);
      ui.pickerList.appendChild(b);
    };
    option('Not in this PDF', 'This entry has no page here', null, () => choosePickerPage(null));
    option('Automatic', 'Use the suggested page', null, () => { st.overrides.delete(index); st.missing.delete(index); closePicker(); renderResult(); });
    PageFinder.rankPages(st.scores).slice(0, 24).forEach((p) => {
      option(`Page ${p.page}`, p.score > PageFinder.DEFAULT_CUTOFF ? 'Looks like a heading' : 'Less likely', st.thumbs[p.page - 1], () => choosePickerPage(p.page));
    });
    ui.pickerOther.value = '';
    ui.pickerOther.max = String(st.pageCount);
    ui.picker.hidden = false;
    ui.pickerList.querySelector('button').focus();
  }

  function choosePickerPage(page) {
    if (st.pickerEntry === null) return;
    st.overrides.set(st.pickerEntry, page);
    closePicker();
    renderResult();
  }

  function closePicker() {
    ui.picker.hidden = true;
    st.pickerEntry = null;
  }
```

Also make Esc close the picker first: in `onKeydown`, before the existing `Escape` branch body:

```js
    if (e.key === 'Escape' && ui.picker && !ui.picker.hidden) {
      e.stopPropagation();
      closePicker();
      return;
    }
```

- [ ] **Step 4: Run the checks**

Run: `node --check page-finder-ui.js && npm test`
Expected: pass.

Run: `npm run ui-check -- tools/ui/pagefinder.js 120000`
Expected: all `PASS`. Two assertions in the scenario deliberately combine an action and a read (`($('finder-copy-btn').click(), copied)`); if either flakes because the clipboard stub runs asynchronously, add `await sleep(50)` before reading `copied`, as the neighbouring checks do.

Run: `npm run ui-check -- tools/ui/pagefinder-flow.js 90000`
Expected: all `PASS` (Task 5 scenario still passes with the fuller result).

Run at phone width: `UI_CHECK_VIEWPORT=390x844 npm run ui-check -- tools/ui/pagefinder.js 120000`
Expected: all `PASS`.

- [ ] **Step 5: Look at it**

Run: `UI_CHECK_VIEWPORT=1100x800 UI_CHECK_SHOT=/tmp/finder-desktop.png npm run ui-check -- tools/ui/pagefinder.js 120000`, then repeat with `UI_CHECK_VIEWPORT=390x844` and `/tmp/finder-phone.png`. Open both images. Check: the rows, thumbnails and page buttons are readable, nothing overflows horizontally, the warning boxes and the counting box are not cramped, and the dialog scrolls rather than clipping. Fix spacing in `styles.css` if not.

- [ ] **Step 6: Commit**

```bash
git add page-finder-ui.js tools/ui/pagefinder.js styles.css
git commit -m "feat: finish the page finder result screen with editing, picker and warnings"
```

---
### Task 7: End to end on the real journals (local acceptance)

**Files:**
- Modify: `tools/model/sections_export.py` (write the Python reference scores), `page-finder-ui.js` (expose the default contents reader for tests)
- Create: `tools/ui/pagefinder-real.js`

**Interfaces:**
- Consumes: everything from Tasks 1 to 6; the three private journals and contents photos.
- Produces: a local-only scenario that runs the real model on the real journals in headless Chrome and reports (a) whether the browser scores agree with Python's, (b) the proposed pages with and without an index, (c) the counting pre-answer and the copied text, (d) the contents-photo entry counts through the real `PageDetect` + `IndexScan` path. Also `PageFinderUI.defaultAnalyseIndex(file)`.

Important: the shipped head is trained on all three journals, so these runs are **in-sample**. They prove the browser pipeline matches Python and works end to end. The held-out accuracy claim comes only from Task 1's leave-one-journal-out table, and that is what the model card reports.

- [ ] **Step 1: Write the Python reference scores for the shipped model**

Append to `main()` in `tools/model/sections_export.py` (after the `section_ref.json` write):

```python
    # Reference scores of the shipped model per journal page, for the local browser comparison (private, not committed).
    scores = {}
    w = np.array(json.load(open(os.path.join(REPO, 'models/section-head.json')))['w'], dtype=np.float32)
    b = json.load(open(os.path.join(REPO, 'models/section-head.json')))['b']
    for name, j in journals.items():
        f = net.predict(C.preprocess(C.render_strips(j['pdf'])), verbose=0)
        scores[name] = (f @ w + b).astype(float).round(4).tolist()
    out = os.path.expanduser('~/Documents/page_crop_ground_truth/section_scores_ref.json')
    json.dump(scores, open(out, 'w'))
    print('wrote', out)
```

Run: `./.venv-sections/bin/python tools/model/sections_export.py 1.0` (the alpha chosen in Task 1).
Expected: prints `size MB ...` and `wrote /Users/.../section_scores_ref.json`.

- [ ] **Step 2: Expose the default contents reader to tests**

In `page-finder-ui.js`, extend the public object at the bottom:

```js
  window.PageFinderUI = {
    open,
    close,
    isOpen: () => !!st && !!ui && ui.modal.classList.contains('active'),
    setDetector(d) { detector = d; },
    setIndexAnalyser(fn) { analyseIndex = fn; },
    defaultAnalyseIndex   // the real contents-page reader, used by the local acceptance scenario
  };
```

- [ ] **Step 3: Write the local scenario**

Create `tools/ui/pagefinder-real.js`:

```js
// Local only (personal journals). Prepare a folder and run:
//   UI_CHECK_FIXTURES=<folder> npm run ui-check -- tools/ui/pagefinder-real.js 900000
// The folder holds: cn.pdf, dwm.pdf, wmc.pdf (the journals), section_scores_ref.json (from sections_export.py),
// and optionally cn_index.jpg, dwm_index.jpg, wmc_index.png (photos or scans of the contents pages, upright or raw).
const JOURNALS = {
  CN:  { file: 'cn.pdf',  index: 'cn_index.jpg',  entries: 12, starts: [3, 5, 8, 10, 12, 16, 18, 20, 22, 24, 26, 34] },
  DWM: { file: 'dwm.pdf', index: 'dwm_index.jpg', entries: 13, starts: [1, 3, 5, 7, 10, 13, 15, 16, 17, 20, 26] },
  WMC: { file: 'wmc.pdf', index: 'wmc_index.png', entries: 11, starts: [1, 7, 10, 18, 23, 35, 42, 49, 54, 59, 68] }
};
const $ = (id) => document.getElementById(id);

async function fixture(name) {
  const response = await fetch('/__fixture/' + name);
  return response.ok ? new File([await response.blob()], name, { type: name.endsWith('.pdf') ? 'application/pdf' : name.endsWith('.png') ? 'image/png' : 'image/jpeg' }) : null;
}

async function scenario() {
  const refResponse = await fetch('/__fixture/section_scores_ref.json');
  const ref = refResponse.ok ? await refResponse.json() : null;
  if (!ref) check('SKIP python comparison (no section_scores_ref.json in UI_CHECK_FIXTURES)', true);
  const detector = SectionDetect.createSectionDetector();

  for (const [name, j] of Object.entries(JOURNALS)) {
    const file = await fixture(j.file);
    if (!file) { check(`SKIP ${name} (${j.file} not in UI_CHECK_FIXTURES)`, true); continue; }
    const started = performance.now();
    const out = await detector.score(file);
    const seconds = (performance.now() - started) / 1000;
    check(`INFO ${name}: ${out.pageCount} pages scanned in ${seconds.toFixed(1)} s (${(seconds / out.pageCount * 1000).toFixed(0)} ms per page)`, true);

    if (ref) {
      const diffs = out.scores.map((s, i) => Math.abs(s.score - ref[name][i]));
      const max = Math.max(...diffs);
      const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      check(`${name}: browser scores agree with Python (mean abs diff < 0.25)`, mean < 0.25, `mean ${mean.toFixed(3)}, max ${max.toFixed(3)}`);
      const top = (scores) => new Set(PageFinder.pickSections(scores, { entryCount: j.starts.length }).sections.map((s) => s.page));
      const pyTop = top(ref[name].map((score, i) => ({ page: i + 1, score })));
      const brTop = top(out.scores);
      check(`${name}: the browser picks the same top-${j.starts.length} pages as Python`, [...pyTop].every((p) => brTop.has(p)) && pyTop.size === brTop.size, `python ${[...pyTop].sort((a, b) => a - b)} | browser ${[...brTop].sort((a, b) => a - b)}`);
    }

    const withIndex = PageFinder.pickSections(out.scores, { entryCount: j.starts.length }).sections.map((s) => s.page);
    const hit = withIndex.filter((p) => j.starts.includes(p)).length;
    check(`INFO ${name}: with the true entry count (${j.starts.length}) ${hit} of ${j.starts.length} pages are right (in-sample)`, true);
    const without = PageFinder.pickSections(out.scores).sections.map((s) => s.page);
    const extra = without.filter((p) => !j.starts.includes(p));
    check(`${name}: with no index no wrong page is proposed (cut-off ${PageFinder.DEFAULT_CUTOFF})`, extra.length === 0, `proposed ${without.length}, wrong: ${extra}`);
    const front = PageFinder.frontPageCount(without.map((page) => ({ page })));
    check(`INFO ${name}: ${front} page(s) before the first proposed heading, counting pre-answer ${JSON.stringify(PageFinder.defaultCounting(front))}`, true);
    out.thumbs.forEach((u) => URL.revokeObjectURL(u));
  }

  // The whole dialog with the real model and the real contents reader on one journal.
  const cn = await fixture('cn.pdf');
  if (cn) {
    PageFinderUI.setDetector(null);
    PageFinderUI.setIndexAnalyser(null);
    PageFinderUI.open();
    await waitFor(() => PageFinderUI.isOpen());
    const input = $('finder-pdf-input');
    const dt = new DataTransfer(); dt.items.add(cn); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    $('finder-start-btn').click();
    await waitFor(() => !$('finder-step-result').hidden, 600000);
    const rows = [...$('finder-rows').querySelectorAll('.finder-row')];
    check(`CN dialog: ${rows.length} sections proposed with no index (the journal has 12)`, rows.length >= 10 && rows.length <= 14, String(rows.length));
    check('CN dialog: "as in this PDF" is pre-answered (certificate and index are in the PDF)', $('finder-count-as-is').checked);
    PageFinderUI.close();
  }

  // The contents photos through the real Auto Crop + IndexScan path.
  let right = 0, tried = 0;
  for (const [name, j] of Object.entries(JOURNALS)) {
    const photo = await fixture(j.index);
    if (!photo) { check(`SKIP ${name} contents photo (${j.index} not in UI_CHECK_FIXTURES)`, true); continue; }
    tried++;
    const result = await PageFinderUI.defaultAnalyseIndex(photo);
    const ok = result.count === j.entries;
    if (ok) right++;
    check(`INFO ${name} contents photo: counted ${result.count}, expected ${j.entries}, crops ${result.cropUrls.length}, warning: ${result.warning}`, true);
    result.cropUrls.forEach((u) => URL.revokeObjectURL(u));
  }
  if (tried) check(`INFO contents photos counted correctly: ${right} of ${tried}`, true);
}
```

- [ ] **Step 4: Prepare the local fixtures and run**

Create a folder (for example `~/Documents/page_finder_fixtures`) with symlinks or copies: `cn.pdf` (`Merged_Document.pdf`), `dwm.pdf`, `wmc.pdf`, `section_scores_ref.json` (from `~/Documents/page_crop_ground_truth/`), and the contents photos: `cn_index.jpg` (the raw photo `IMG_5933`, converted from `~/Documents/raw_photos_jpeg`), `dwm_index.jpg` (`sips -s format jpeg "Dwm index.heic" --out dwm_index.jpg`), `wmc_index.png` (page 1 of `Merged_Document-2.pdf` rendered with PyMuPDF at 1.5x).

Run: `UI_CHECK_FIXTURES=~/Documents/page_finder_fixtures npm run ui-check -- tools/ui/pagefinder-real.js 900000`
Expected: every `PASS`; read the `INFO` lines and copy them into `models/MODEL_CARD.md` in Task 8 (scan seconds per page, in-sample hits, front-page counts, contents-photo counts).

Gate for the contents-photo counts: at least 2 of the 3 counted right means the estimator is the default. If fewer, Task 4 Step 7's rule applies: the editable entry count stays the primary control and the card says the photo estimate is unreliable. Either outcome ships; record which.

- [ ] **Step 5: Commit**

```bash
git add tools/model/sections_export.py page-finder-ui.js tools/ui/pagefinder-real.js
git commit -m "test: add a local end-to-end check of the page finder on the real journals"
```

---

### Task 8: Docs, versions and final verification

**Files:**
- Modify: `index.html`, `app.js` (version 2.9.0), `AGENTS.md`, `README.md`, `models/MODEL_CARD.md`, `docs/device-test-checklist.md`

- [ ] **Step 1: Bump the version to 2.9.0**

```bash
sed -i '' 's/?v=2\.8\.0/?v=2.9.0/g' index.html
sed -i '' "s/const ASSET_VERSION = '2.8.0';/const ASSET_VERSION = '2.9.0';/" app.js
grep -c "2.8.0" index.html app.js
```
Expected: `index.html:0` and `app.js:0`.

- [ ] **Step 2: Add the model card section**

Append to `models/MODEL_CARD.md`:

```markdown
---

# Section-start model (`section-features.ort` + `section-head.json`)

Finds the pages of a scanned lab journal where an experiment or assignment starts, for **Find page numbers**.
Input: the top strip (rows 3% to 20%) of one page, resized to 576x192, pixels scaled to -1..1 (MobileNetV2
`preprocess_input`). Output: 1280 features; `section-head.json` holds a logistic-regression head (`w`, `b`, `cutoff`)
that turns them into one score per page. Runs in the browser through the vendored ONNX Runtime Web.

## Intended use
Suggest which pages begin a section so the user can write page numbers on a contents page. Always shown with the
heading picture of each page and correctable by the user. Out of scope: reading the heading text or number, telling
experiments from assignments, any journal layout other than lined paper with a handwritten "Experiment No. N" heading.

## Data
Three scanned journals by the same student on the same college stationery (CN 41 pages, DWM 36, WMC 72; 119 pages,
34 section starts, true starts read by eye). Personal; not distributed. The WMC journal also has printed
"EXPERIMENT NO. N" code pages that are not starts.

## Evaluation (leave-one-journal-out: the head is trained on two journals and scored on the third)
<!-- paste the table printed by tools/model/sections_eval.py for the chosen backbone: AUC, top-N correct, worst true-start rank, extras at cutoff 1.5 -->

Score gaps (held-out): CN true starts >= 1.33 vs best non-start -0.58; DWM lowest true start -0.78 vs best non-start
-0.75; WMC true starts >= 1.71 vs best non-start 1.20. No single threshold separates all three, which is why:
- with a contents page the app takes the best N pages but never one scoring at or below -0.5 (`DEFAULT_FLOOR`);
- without one it proposes pages above 1.5 (`DEFAULT_CUTOFF`: no wrong page on any journal, but it missed 1 on CN and
  3 on DWM) and lists the next ten pages for one-tap adding.
Both numbers were chosen after seeing these three journals; they are tuned defaults, not held-out results.

## Limits
- One student, one stationery: other layouts are unmeasured.
- Adjacent duplicate photos of the same heading both score as headings.
- The shipped head is trained on all three journals, so scores on them are in-sample (browser/Python parity only).
- Contents-photo entry counting (`index-scan.js`): <!-- record the real-photo result of tools/ui/pagefinder-real.js -->

## Reproduce
`tools/model/sections_eval.py` (evaluation), `tools/model/sections_export.py ALPHA` (train head, export, reference
files). They need the private PDFs and `~/Documents/page_crop_ground_truth/journals.json`.
```

Then replace the two HTML comments with the real numbers from Task 1 Step 5 and Task 7 Step 4.

- [ ] **Step 3: Update `AGENTS.md`**

In the directory tree add (after `export-name-dialog.js`):

```
├── page-finder.js                # Pure logic for Find page numbers: picking sections, numbering, labels, typed result (browser + node)
├── section-detect.js             # Renders each PDF page's top strip, runs the section model, scores pages (browser; pure helpers testable)
├── index-scan.js                 # Reads a photographed contents table: ruled columns, entry count, entry rows (RGBA analysis)
├── page-finder-ui.js             # The Find page numbers dialog: choose, scan, result, picker, warnings, copy
```
and `models/section-features.ort`, `models/section-head.json` under `models/`. Add `page-finder.js`, `page-finder-ui.js`, `section-detect.js`, `index-scan.js` to the version query string list, and replace every `2.8.0` with `2.9.0`.

Add a new section before "Anti-Vibecoding & Aesthetic Guidelines":

```markdown
### 6. Find Page Numbers
- **Entry point**: the "Find page numbers" button on the landing page opens `PageFinderUI` (a modal): choose the journal PDF (or a PDF already added) and optionally a photo of the handwritten contents page, scan, then a typed result: `Experiment 1 – page 3`, one row per section with a heading thumbnail, an editable name, a page button that opens a picker, and an "Unsure" / "Not in this PDF" / "Page not found" status.
- **Finding heading pages**: `SectionDetect` renders only the top strip (rows 3%-20%) of each page with pdf.js, runs a MobileNetV2 feature model (`models/section-features.ort`, the vendored minimal ONNX Runtime) and a logistic head (`models/section-head.json`). Both load on first use. Nothing is uploaded. Heading text cannot be read (tesseract.js 0/12, TrOCR 0/23 numbers on the real journals), so labels are typed from counts.
- **Choosing sections** (`PageFinder.pickSections`): with a contents photo, the best N pages (N = entries), never a page scoring at or below `DEFAULT_FLOOR` (-0.5), so an entry is left "Page not found" instead of being filled with a page that does not look like a heading. Without one, pages above `DEFAULT_CUTOFF` (1.5) plus the next ten as one-tap candidates. Both numbers are tuned on three journals.
- **Contents photo** (`index-scan.js`, optional): the page is found with the Auto Crop detector, flattened, and the entry count comes from the numerals in the first column. The count is always editable. Entry crops are shown only as labels.
- **Numbering**: `front = first heading page - 1`. The app asks how to count: as in this PDF, or N extra pages in front (certificate, index, others; 0-20). Pre-answer: `front >= 2` as in this PDF, `0` add 2, `1` the user decides (Copy waits). The copied text states the rule.
- **Names**: "Experiment 1..N-A", "Assignment 1..A" with A (assignments at the end, default 2) editable, and every name editable by typing.
- **Warnings** (never blocking): fewer clear headings than entries, two clear headings in a row, a page used by two entries, an unreadable contents photo, an unanswered counting question.
- **Tests**: `test_page_finder.js`, `test_section_detect.js`, `test_index_scan.js`; scenarios `tools/ui/section-detect.js`, `index-scan.js`, `pagefinder-flow.js`, `pagefinder.js`; local-only `tools/ui/pagefinder-real.js` and `index-scan-real.js` (personal journals via `UI_CHECK_FIXTURES`). Model gate and export: `tools/model/sections_*.py`; results in `models/MODEL_CARD.md`.
```

Add to the commands list: `- Page finder on the real journals (local, private data): UI_CHECK_FIXTURES=<folder> npm run ui-check -- tools/ui/pagefinder-real.js 900000`.

- [ ] **Step 4: README and device checklist**

In `README.md` add a feature bullet: `- **Find Page Numbers**: scan a journal PDF and get the page where each experiment and assignment starts as typed lines ("Experiment 1 – page 3"), optionally using a photo of the handwritten contents page for accuracy. Runs on your device; measured on three journals.`

In `docs/device-test-checklist.md` add, under the per-device steps:

```markdown
10. Tap Find page numbers on the landing page, choose a long scanned journal PDF (60+ pages) and, optionally, a photo of its contents page.
    - Expect: a progress bar ("Checking page 12 of 72…") that keeps moving, the Cancel button works at any moment, and the result lists sections with heading pictures. Note the time for 70 pages and whether the browser reloads or runs out of memory.
11. On the result screen, change a page with the page button, set an entry to "Not in this PDF", switch the counting choice, and tap Copy result.
    - Expect: every change is reflected at once; Copy puts typed lines on the clipboard.
```

- [ ] **Step 5: Run everything**

```bash
node --check app.js && node --check page-finder-ui.js && node --check section-detect.js && node --check index-scan.js
npm test
for s in smoke ingest export editor detect autocrop split split-ranges startover smooth ingest-speed exportname section-detect index-scan pagefinder-flow pagefinder; do npm run ui-check -- tools/ui/$s.js 150000 || break; done
npm run ui-check -- tools/ui/section-model.js
for w in 1600 1280 1100 900 800 770 700 390; do UI_CHECK_VIEWPORT=${w}x720 npm run ui-check -- tools/ui/responsive.js || break; done
UI_CHECK_VIEWPORT=390x844 npm run ui-check -- tools/ui/pagefinder.js 120000
lsof -iTCP -sTCP:LISTEN -n -P | grep -c -E "node|Chrome"
git status --short
```
Expected: every check `PASS`; the leftover-process count is `0`; `git status` lists only this task's files. If the landing-page button makes the empty state too tall at a phone height, check `responsive.js` at 390 and shorten `empty-description` spacing rather than hiding the button.

- [ ] **Step 6: Commit**

```bash
git add index.html app.js AGENTS.md README.md models/MODEL_CARD.md docs/device-test-checklist.md
git commit -m "docs: document the page number finder and bump to 2.9.0"
```

---

## Final review (after Task 8)

Review the whole branch against the spec (`docs/superpowers/specs/2026-10-15-page-finder-design.md`) and the Review Focus list at the top. Then run the finishing steps: list every ruling made during execution, list deferred minors, and ask before merging or deploying (deploying publishes the model files trained on the user's journals; the model card records the data and licences).

Unproven and to be stated plainly in the final message: all three journals are one student's on one stationery; the no-index cut-off and the fill floor are tuned on them; real-phone behaviour (speed, memory on a 70-page scan) is not measured.
