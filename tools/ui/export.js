// Export checks: orientation, direct embed, perspective crop, rotation, large photo, invalid quad.
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

const near = (a, b, tol) => Math.abs(a - b) <= tol;

async function scenario() {
  const doc = await PDFLib.PDFDocument.create();

  // 1. EXIF-rotated camera JPEG exports upright (Review Focus 1).
  const plain = await makeImageFile(400, 200, (ctx, w, h) => { ctx.fillStyle = '#c33'; ctx.fillRect(0, 0, w, h); }, 'plain.jpg');
  const cameraBytes = withExifOrientation(new Uint8Array(await plain.arrayBuffer()), 6);
  await handleFiles([new File([cameraBytes], 'camera.jpg', { type: 'image/jpeg' })]);
  const camera = await embedImagePage(doc, state.pages[0]);
  check('EXIF-rotated JPEG exports portrait', camera.height > camera.width, `${camera.width}x${camera.height}`);

  // 2. An ordinary JPEG still takes the direct path and keeps its size.
  await handleFiles([plain]);
  const direct = await embedImagePage(doc, state.pages[1]);
  check('plain JPEG embeds at its own size', direct.width === 400 && direct.height === 200, `${direct.width}x${direct.height}`);

  // 3. Perspective crop: a 400x300 white rectangle on a dark 800x600 photo.
  const photo = await makeImageFile(800, 600, (ctx, w, h) => {
    ctx.fillStyle = '#222'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff'; ctx.fillRect(200, 150, 400, 300);
  }, 'sheet.jpg');
  await handleFiles([photo]);
  const sheet = state.pages[2];
  CropState.applyManualCrop(sheet, [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]]);
  const cropped = await embedImagePage(doc, sheet);
  check('crop exports at the quad size (400x300)', near(cropped.width, 400, 2) && near(cropped.height, 300, 2), `${cropped.width}x${cropped.height}`);
  const canvas = await renderImagePageCanvas(sheet);
  const px = canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
  const edge = canvas.getContext('2d').getImageData(2, 2, 1, 1).data;
  check('cropped page is white edge to edge', px[0] > 230 && edge[0] > 230, `centre=${px[0]} corner=${edge[0]}`);

  // 4. Rotation is applied after the crop.
  sheet.rotation = 90;
  const rotated = await embedImagePage(doc, sheet);
  check('rotation 90 swaps the cropped size (300x400)', near(rotated.width, 300, 2) && near(rotated.height, 400, 2), `${rotated.width}x${rotated.height}`);
  sheet.rotation = 0;

  // 5. An invalid stored quad is ignored, not exported as garbage (Review Focus 4).
  sheet.cropQuad = [[0, 0], [1, 1], [1, 0], [0, 1]];
  const ignored = await embedImagePage(doc, sheet);
  check('bow-tie quad falls back to the whole photo (800x600)', ignored.width === 800 && ignored.height === 600, `${ignored.width}x${ignored.height}`);
  sheet.cropQuad = null;

  // 6. A very large photo is capped to MAX_EXPORT_PIXELS (Review Focus 3).
  const huge = await makeImageFile(5000, 7000, (ctx, w, h) => { ctx.fillStyle = '#468'; ctx.fillRect(0, 0, w, h); }, 'huge.png', 'image/png');
  await handleFiles([huge]);
  const hugeItem = state.pages[3];
  CropState.applyManualCrop(hugeItem, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  const capped = await embedImagePage(doc, hugeItem);
  check('huge photo exports within the pixel cap', capped.width * capped.height <= MAX_EXPORT_PIXELS * 1.01, `${capped.width}x${capped.height}`);
  check('huge photo keeps its aspect ratio', near(capped.width / capped.height, 5000 / 7000, 0.01));

  // 7. The real export path still works end to end (camera photo + cropped sheet).
  let exported = null;
  const realCreate = URL.createObjectURL;
  URL.createObjectURL = (blob) => { if (blob.type === 'application/pdf') exported = blob; return realCreate.call(URL, blob); };
  CropState.applyManualCrop(sheet, [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]]);
  state.pages = [state.pages[0], sheet];
  await exportMergedPdf();
  await waitFor(() => exported);
  URL.createObjectURL = realCreate;
  const out = await PDFLib.PDFDocument.load(await exported.arrayBuffer());
  check('full export produces a 2-page PDF', out.getPageCount() === 2, `pages=${out.getPageCount()}`);
  const second = out.getPage(1).getSize();
  check('cropped page keeps a 4:3 shape on the A4 sheet', second.width > 0 && second.height > 0);
}
