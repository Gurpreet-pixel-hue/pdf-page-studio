// Smoke test: the app loads and ingests a synthetic photo.
async function scenario() {
  check('app globals present', typeof handleFiles === 'function' && typeof state === 'object');
  const file = await makeImageFile(400, 300, (ctx, w, h) => { ctx.fillStyle = '#334'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#eee'; ctx.fillRect(60, 40, 280, 220); }, 'smoke.jpg');
  await handleFiles([file]);
  check('one page added', state.pages.length === 1, 'pages=' + state.pages.length);
  check('page is an image', state.pages[0] && state.pages[0].sourceType === 'image');
}
