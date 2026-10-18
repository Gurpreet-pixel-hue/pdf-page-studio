// Skip button and keyboard both end the opening sequence early and leave the page usable.
// Run with: UI_CHECK_QUERY=introcheck UI_CHECK_WEBGL=1 node tools/ui-check.js tools/ui/intro-skip.js 60000
const html = document.documentElement;

async function scenario() {
  await waitFor(() => document.getElementById('intro-gl') && window.THREE && window.gsap, 15000);
  await sleep(700);
  const btn = document.getElementById('intro-skip');
  check('a Skip button is offered', !!btn && /skip/i.test(btn.textContent));
  const t0 = performance.now();
  btn.click();
  await waitFor(() => !document.getElementById('intro'), 5000);
  const took = performance.now() - t0;
  check('Skip ends the sequence quickly', took < 1500, Math.round(took) + 'ms');
  check('the page is unlocked after skipping', document.querySelector('.app-container').inert === false && html.style.overflow === '');
  check('the landing page is there', getComputedStyle(document.getElementById('empty-state')).display !== 'none');
}
