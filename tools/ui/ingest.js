// Ingest checks: EXIF orientation, large photos, HEIC message.
function withExifOrientation(bytes, value) {
  const tiff = [0x4D, 0x4D, 0, 0x2A, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, value, 0, 0, 0, 0, 0, 0];
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = exif.length + 2;
  const app1 = [0xFF, 0xE1, len >> 8, len & 255, ...exif];
  const out = new Uint8Array(bytes.length + app1.length);
  out.set(bytes.slice(0, 2), 0);
  out.set(app1, 2);
  out.set(bytes.slice(2), 2 + app1.length);
  return out;
}

const paintRed = (ctx, w, h) => { ctx.fillStyle = '#c33'; ctx.fillRect(0, 0, w, h); };

async function scenario() {
  // 1. Camera photo: landscape pixels tagged EXIF orientation 6 must ingest upright.
  const plain = await makeImageFile(400, 200, paintRed, 'plain.jpg');
  const cameraBytes = withExifOrientation(new Uint8Array(await plain.arrayBuffer()), 6);
  await handleFiles([new File([cameraBytes], 'camera.jpg', { type: 'image/jpeg' })]);
  const cam = state.pages[0];
  check('EXIF 6 photo ingests upright (200x400)', cam && cam.width === 200 && cam.height === 400, cam && `${cam.width}x${cam.height}`);
  check('jpegOrientation is recorded', cam && cam.jpegOrientation === 6);
  check('full-resolution blob is kept', cam && cam.fullBlob instanceof Blob);
  check('crop fields start empty', cam && cam.cropQuad === null && cam.cropState === 'none' && cam.previewUrl === null);

  // 2. Large photo: original dimensions kept, working copy capped at 2000px.
  const big = await makeImageFile(5000, 3000, paintRed, 'big.jpg');
  await handleFiles([big]);
  const bigItem = state.pages[1];
  const working = await loadImageFromUrl(bigItem.thumbnailDataUrl);
  check('original dimensions are preserved', bigItem.width === 5000 && bigItem.height === 3000, `${bigItem.width}x${bigItem.height}`);
  check('working copy long edge <= 2000', Math.max(working.naturalWidth, working.naturalHeight) <= 2000, `${working.naturalWidth}x${working.naturalHeight}`);

  // 3. HEIC is not decoded here (iOS Safari converts to JPEG at upload): say what to do, add no page.
  const before = state.pages.length;
  await handleFiles([new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], 'photo.heic', { type: 'image/heic' })]);
  check('HEIC adds no page', state.pages.length === before, `pages=${state.pages.length}`);
  const toasts = [...document.querySelectorAll('#toast-container .toast')].map((t) => t.textContent).join(' | ');
  check('HEIC toast explains what to do', /HEIC.*(gallery|JPEG)/i.test(toasts), toasts);
}
