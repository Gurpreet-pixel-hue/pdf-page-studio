/**
 * Browser-side helpers for UI scenarios (injected by tools/ui-check.js).
 * A scenario file defines `async function scenario() { ... }` and calls check().
 */
window.__log = [];
window.__done = false;

window.check = (name, ok, detail) => {
  window.__log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
};
window.note = (text) => window.__log.push(`INFO  ${text}`);
window.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

window.waitFor = async (predicate, timeoutMs = 30000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await window.sleep(100);
  }
  return false;
};

/** Draw onto a canvas and return it as a File. draw(ctx, width, height). */
window.makeImageFile = (width, height, draw, name, type = 'image/jpeg') => new Promise((resolve) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  canvas.toBlob((blob) => resolve(new File([blob], name, { type })), type, 0.92);
});

/** Fetch a fixture served from UI_CHECK_FIXTURES, or null when it is absent. */
window.fetchFixture = async (name, type) => {
  const response = await fetch('/__fixture/' + encodeURIComponent(name));
  if (!response.ok) return null;
  return new File([await response.blob()], name, { type: type || '' });
};

window.confirm = () => true; // never block on native dialogs

window.addEventListener('load', async () => {
  try {
    await scenario();
  } catch (err) {
    window.check('scenario threw', false, (err && err.stack) || String(err));
  }
  window.__done = true;
});
