// The opening sequence plays on a normal visit, locks the page while it runs, and hands over cleanly.
// Run with: UI_CHECK_QUERY=introcheck UI_CHECK_WEBGL=1 node tools/ui-check.js tools/ui/intro.js 60000
const html = document.documentElement;
const app = () => document.querySelector('.app-container');

async function scenario() {
  const overlay = document.getElementById('intro');
  check('the opening overlay is on the page', !!overlay);
  check('it is showing, not skipped', overlay && getComputedStyle(overlay).display !== 'none' && !html.classList.contains('no-intro'));
  check('it covers the whole window', overlay && overlay.getBoundingClientRect().width >= innerWidth - 1 && overlay.getBoundingClientRect().height >= innerHeight - 1);
  check('the landing page is locked underneath', app().inert === true && html.style.overflow === 'hidden');

  await waitFor(() => document.getElementById('intro-gl') && document.getElementById('intro-gl').width > 0 && window.THREE && window.gsap, 15000);
  check('three.js and GSAP loaded from the site itself', !!window.THREE && !!window.gsap);
  await sleep(1500);
  const still = document.getElementById('intro');
  check('the sequence is running mid-way (not instantly dismissed)', !!still && !html.classList.contains('no-intro'));
  check('the photo is on screen mid-sequence', getComputedStyle(document.getElementById('intro-photo')).visibility === 'visible');

  await waitFor(() => !document.getElementById('intro'), 20000);
  check('the overlay removes itself when the sequence ends', !document.getElementById('intro'));
  check('the page is unlocked afterwards', app().inert === false && html.style.overflow === '');
  check('the landing page is intact', getComputedStyle(document.getElementById('empty-state')).display !== 'none' && !!document.querySelector('.top-bar'));
  await sleep(1200);
  check('landing entrance animation leaves no stray styles', !document.querySelector('.top-bar').style.transform && !document.querySelector('.main-workspace').style.opacity);

  // the app still works after the intro
  const f = await makeImageFile(300, 400, (ctx, w, h) => { ctx.fillStyle = '#468'; ctx.fillRect(0, 0, w, h); }, 'after-intro.jpg');
  await handleFiles([f]);
  check('adding a page works after the intro', state.pages.length === 1);
}
