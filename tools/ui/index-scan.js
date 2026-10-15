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
