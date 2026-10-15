// Every control stays reachable at any window width. Run it at several sizes:
//   for w in 1600 1280 1100 900 800 770 700 390; do UI_CHECK_VIEWPORT=${w}x720 npm run ui-check -- tools/ui/responsive.js; done
const onScreen = (el) => {
  const r = el.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return false;
  if (r.left < -0.5 || r.right > innerWidth + 0.5 || r.top < -0.5) return false;
  const hit = document.elementFromPoint(r.left + r.width / 2, Math.min(r.top + r.height / 2, innerHeight - 1));
  return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
};
const shown = (el) => { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden'; };

async function scenario() {
  await handleFiles([await makeImageFile(300, 400, (ctx, w, h) => { ctx.fillStyle = '#9ac'; ctx.fillRect(0, 0, w, h); }, 'a.jpg')]);
  await sleep(500);
  const w = innerWidth;
  check(`[${w}px] page has no horizontal scroll`, document.documentElement.scrollWidth <= w, `scrollWidth ${document.documentElement.scrollWidth}`);

  const desktop = w > 768;
  const ids = desktop
    ? ['btn-install-app', 'sort-menu-btn', 'settings-toggle-btn', 'clear-all-btn', 'export-pdf-btn']
    : ['mobile-export-btn'];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    check(`[${w}px] #${id} is visible and on screen`, !!el && shown(el) && onScreen(el), el ? JSON.stringify(el.getBoundingClientRect().toJSON()) : 'missing');
  });
  if (desktop) {
    ['file-input', 'camera-input'].forEach((id) => {
      const label = document.querySelector(`label[for="${id}"].desktop-only-btn`);
      check(`[${w}px] "${id === 'file-input' ? 'Add Files' : 'Scan'}" is visible and on screen`, !!label && shown(label) && onScreen(label));
    });
    const telemetry = document.querySelector('.telemetry-bar');
    check(`[${w}px] page and document counters are not cut off`, !shown(telemetry) || onScreen(telemetry));
    // Icon-only buttons must still say what they do.
    const iconOnly = [...document.querySelectorAll('.top-actions .btn')].filter((b) => shown(b) && ![...b.querySelectorAll('span')].some(shown));
    const unnamed = iconOnly.filter((b) => !(b.getAttribute('aria-label') || b.title));
    check(`[${w}px] icon-only buttons have a name`, unnamed.length === 0, unnamed.map((b) => b.id || b.className).join());
  }
  // The control that matters most can actually be clicked.
  const exportBtn = document.getElementById(desktop ? 'export-pdf-btn' : 'mobile-export-btn');
  exportBtn.click();
  await sleep(200);
  const opened = !!document.getElementById('export-name-modal') && document.getElementById('export-name-modal').classList.contains('active');
  check(`[${w}px] Export is clickable`, opened);
  if (opened) document.getElementById('export-name-cancel-btn').click();
}
