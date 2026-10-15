// Page detector in a real browser: model + runtime load, a synthetic sheet is found,
// a failed model download is recoverable, and (optionally) real photos match the Python reference.
async function scenario() {
  const detector = PageDetect.createDetector();

  // 1. Synthetic sheet (rotated, ruled) on a dark patterned desk.
  const truth = [[0.18, 0.12], [0.80, 0.16], [0.76, 0.88], [0.14, 0.84]];
  const W = 900, H = 1200;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2a2420'; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 400; i++) { ctx.fillStyle = i % 2 ? '#3a322b' : '#1d1815'; ctx.fillRect((i * 97) % W, (i * 61) % H, 40, 6); }
  ctx.beginPath();
  truth.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
  ctx.closePath(); ctx.fillStyle = '#f4f1e8'; ctx.fill();
  ctx.save(); ctx.clip(); ctx.strokeStyle = '#8fa8d8'; ctx.lineWidth = 2;
  for (let y = 160; y < H; y += 38) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y + 30); ctx.stroke(); }
  ctx.restore();
  const started = performance.now();
  const found = await detector.detect(canvas);
  const first = Math.round(performance.now() - started);
  check('synthetic sheet is found', !!found.quad && found.confidence > 0.6, JSON.stringify(found));
  const iou = found.quad ? CropGeometry.quadIoU(found.quad, truth) : 0;
  check('synthetic sheet quad overlaps the truth (IoU >= 0.85)', iou >= 0.85, 'IoU ' + iou.toFixed(3) + ', first call ' + first + ' ms');
  const again = performance.now();
  await detector.detect(canvas);
  check('second call is fast (< 400 ms)', performance.now() - again < 400, Math.round(performance.now() - again) + ' ms');

  // 1b. Sources that need no, one, or several halvings all work, and small sources agree with large ones.
  const small = document.createElement('canvas'); small.width = small.height = 256;
  small.getContext('2d').drawImage(canvas, 0, 0, 256, 256);
  const fromSmall = await detector.detect(small);
  check('a source already 256x256 is detected', !!fromSmall.quad && CropGeometry.quadIoU(fromSmall.quad, truth) >= 0.85);
  const agree = found.quad && fromSmall.quad ? CropGeometry.quadIoU(found.quad, fromSmall.quad) : 0;
  check('large and small sources agree (IoU >= 0.95)', agree >= 0.95, 'IoU ' + agree.toFixed(3));

  // 2. A blank frame is not a page.
  const blank = document.createElement('canvas'); blank.width = blank.height = 300;
  blank.getContext('2d').fillStyle = '#222'; blank.getContext('2d').fillRect(0, 0, 300, 300);
  const none = await detector.detect(blank);
  check('blank frame has low confidence or no quad', !none.quad || none.confidence < 0.6, JSON.stringify(none));

  // 3. A failed model download rejects and can be retried.
  const broken = PageDetect.createDetector({ modelUrl: 'models/missing.ort' });
  let failed = false;
  try { await broken.detect(canvas); } catch (e) { failed = true; }
  check('missing model rejects', failed);
  let failedAgain = false;
  try { await broken.detect(canvas); } catch (e) { failedAgain = true; }
  check('a failed load is retried, not cached', failedAgain);

  // 4. Optional parity with the Python reference on real photos (needs UI_CHECK_FIXTURES with ref_quads.json).
  const refResponse = await fetch('/__fixture/ref_quads.json');
  if (!refResponse.ok) { check('SKIP real-photo parity (no UI_CHECK_FIXTURES/ref_quads.json)', true); return; }
  const ref = await refResponse.json();
  const diffs = [];
  for (const name of Object.keys(ref)) {
    const img = await loadImageFromUrl('/__fixture/' + name);
    const out = await detector.detect(img);
    if (!out.quad) { diffs.push(1); continue; }
    diffs.push(Math.max(...out.quad.map((p, i) => Math.hypot(p[0] - ref[name][i][0], p[1] - ref[name][i][1]))));
  }
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  check('browser quads match the Python reference (' + diffs.length + ' photos, mean worst-corner gap < 0.01)', diffs.length > 0 && mean < 0.01, 'mean ' + mean.toFixed(4) + ', max ' + Math.max(...diffs).toFixed(4));
}
