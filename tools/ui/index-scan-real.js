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
