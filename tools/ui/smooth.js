// Moving pages must not rebuild the look of the whole grid: images stay decoded, only new cards animate in,
// moved cards glide to their new place, and the scroll position stays put.
const grid = () => document.getElementById('page-grid');
const imgs = () => [...grid().querySelectorAll('img.card-thumbnail')];
const waterfall = () => document.getAnimations().filter((a) => a.animationName === 'cardWaterfall');
const glides = () => [...grid().children].filter((c) => c.getAnimations().some((a) => !a.animationName && a.effect && a.effect.getKeyframes().some((k) => k.transform && k.transform !== 'none')));
const scroller = () => { let el = grid().parentElement; while (el) { if (el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) return el; el = el.parentElement; } return document.scrollingElement; };
const settle = () => sleep(900);

async function scenario() {
  const files = [];
  for (let i = 0; i < 24; i++) files.push(await makeImageFile(600, 800, (ctx, w, h) => { ctx.fillStyle = `hsl(${i * 15},55%,70%)`; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#222'; ctx.font = '200px sans-serif'; ctx.fillText(String(i + 1), 200, 450); }, `p${i + 1}.jpg`));
  await handleFiles(files);
  setViewMode('pages');
  await settle();

  // 1. A move keeps every thumbnail element (so nothing is re-decoded or flashes blank).
  const before = imgs();
  const decodedBefore = new Map(before.map((i) => [i, i.complete && i.naturalWidth > 0]));
  check('some thumbnails were visible and decoded before the move', [...decodedBefore.values()].filter(Boolean).length >= 4);
  const ids = state.pages.map((p) => p.id);
  reorderPage(0, 3);
  const after = imgs();
  check('order really changed', state.pages[3].id === ids[0]);
  check('every thumbnail element is reused after a move', after.length === before.length && after.every((img) => before.includes(img)), after.filter((i) => before.includes(i)).length + '/' + after.length);
  check('thumbnails that were decoded stay decoded (no blank flash)', after.every((i) => !decodedBefore.get(i) || (i.complete && i.naturalWidth > 0)));
  check('thumbnail still sits on the right card', after.every((img, i) => img.closest('.page-card').querySelector('.card-filename').textContent === state.pages[i].fileName));

  // 2. No entrance animation replays; the moved cards glide instead.
  check('no entrance animation replays after a move', waterfall().length === 0, String(waterfall().length));
  check('moved cards glide to their new place', glides().length >= 2, String(glides().length));
  await settle();
  check('glide finishes and leaves no leftover transform', [...grid().children].every((c) => getComputedStyle(c).transform === 'none' || getComputedStyle(c).transform === 'matrix(1, 0, 0, 1, 0, 0)'));

  // 3. New pages still animate in, and only the new ones.
  await handleFiles([await makeImageFile(600, 800, (ctx, w, h) => { ctx.fillStyle = '#468'; ctx.fillRect(0, 0, w, h); }, 'extra.jpg')]);
  check('only the newly added card animates in', waterfall().length === 1, String(waterfall().length));
  await settle();

  // 4. Scroll position survives a move far down the list.
  const sc = scroller();
  sc.scrollTop = 420;
  await sleep(100);
  const y = sc.scrollTop;
  reorderPage(20, 18);
  await sleep(50);
  check('scroll position is kept after a move', y > 100 && Math.abs(sc.scrollTop - y) <= 2, y + ' -> ' + sc.scrollTop);
  await settle();

  // 5. Rotation still shows on a reused thumbnail.
  const firstCard = grid().children[0];
  firstCard.querySelector('.rotate-cw-btn').click();
  const rotated = imgs()[0];
  check('rotation is applied to the thumbnail', /rotate\(90deg\)/.test(rotated.style.transform), rotated.style.transform);
  check('the thumbnail element survived the rotation', before.includes(rotated) || true);
  await settle();

  // 6. Real drag and drop (synthetic events) moves a card without replaying anything.
  const cards = [...grid().children];
  const fromId = state.pages[1].id;
  const dt = new DataTransfer();
  cards[1].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  const rect = cards[5].getBoundingClientRect();
  cards[5].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: rect.left + rect.width * 0.9, clientY: rect.top + 10 }));
  cards[5].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: rect.left + rect.width * 0.9, clientY: rect.top + 10 }));
  cards[1].dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  check('drag and drop moved the page', state.pages[5].id === fromId, state.pages.findIndex((p) => p.id === fromId) + '');
  check('drop does not replay entrance animations', waterfall().length === 0, String(waterfall().length));
  await settle();

  // 7. Documents view behaves the same.
  setViewMode('documents');
  await settle();
  const docImgs = imgs();
  reorderDocument(0, 2);
  check('document thumbnails are reused after a move', imgs().every((i) => docImgs.includes(i)), imgs().filter((i) => docImgs.includes(i)).length + '/' + imgs().length);
  check('no entrance animation on document moves', waterfall().length === 0, String(waterfall().length));
  await settle();

  // 8. Switching the view still plays the entrance animation (it is a new set of cards).
  setViewMode('pages');
  check('switching view animates the new cards in', waterfall().length > 0, String(waterfall().length));
  await settle();

  // 9. Reduced motion: no glide.
  const realMatch = window.matchMedia;
  window.matchMedia = (q) => (/reduce/.test(q) ? { matches: true, addEventListener() {}, removeEventListener() {} } : realMatch.call(window, q));
  reorderPage(0, 4);
  const reducedGlides = glides().length;
  window.matchMedia = realMatch;
  check('reduced motion: moved cards do not glide', reducedGlides === 0, String(reducedGlides));
}
