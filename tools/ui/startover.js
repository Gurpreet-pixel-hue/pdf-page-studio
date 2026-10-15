// Clicking the title starts over: asks first when work would be lost, refreshes the assets, then reloads from a clean URL.
async function scenario() {
  const home = document.getElementById('brand-home');
  check('title is a link', !!home && home.tagName === 'A' && /PDF PAGE STUDIO/.test(home.textContent));
  check('title link has an accessible name', !!home && /start over/i.test(home.getAttribute('aria-label') || ''), home && home.getAttribute('aria-label'));

  const log = [];
  const fakeFetch = (url, options) => { log.push([String(url), options && options.cache]); return Promise.resolve({ ok: true }); };
  const run = (options) => startOver(Object.assign({ fetchFn: fakeFetch, reload: (url) => log.push(['RELOAD', url]) }, options));

  // 1. Nothing uploaded: no confirmation, goes straight to a fresh load.
  let asked = 0;
  await run({ confirmFn: () => { asked++; return true; } });
  check('empty app does not ask before restarting', asked === 0);
  const reload = log.find((l) => l[0] === 'RELOAD');
  check('reloads with a one-off cache-busting address', !!reload && /[?&]fresh=\d+/.test(reload[1]) && !/#/.test(reload[1]), reload && reload[1]);
  const assets = log.filter((l) => l[0] !== 'RELOAD');
  check('refetches the page scripts and styles bypassing the cache', assets.length >= 4 && assets.every((l) => l[1] === 'reload'), assets.length + ' assets');
  check('reload happens after the refetch', log.findIndex((l) => l[0] === 'RELOAD') === log.length - 1);

  // 2. Uploaded work: the user can back out and nothing changes.
  await handleFiles([await makeImageFile(300, 200, (ctx, w, h) => { ctx.fillStyle = '#468'; ctx.fillRect(0, 0, w, h); }, 'photo.jpg')]);
  log.length = 0;
  await run({ confirmFn: (message) => { asked++; log.push(['ASK', message]); return false; } });
  check('asks first when pages are loaded', asked === 1 && log[0][0] === 'ASK' && /clear|remove|lose/i.test(log[0][1]), log[0] && log[0][1]);
  check('declining keeps the pages and does not reload', state.pages.length === 1 && !log.some((l) => l[0] === 'RELOAD'));

  // 3. Confirming restarts.
  log.length = 0;
  await run({ confirmFn: () => true });
  check('confirming reloads', log.some((l) => l[0] === 'RELOAD'));

  // 4. A failing refetch (offline) still restarts the app.
  log.length = 0;
  await startOver({ confirmFn: () => true, fetchFn: () => Promise.reject(new Error('offline')), reload: (url) => log.push(['RELOAD', url]) });
  check('offline refetch failure still reloads', log.some((l) => l[0] === 'RELOAD'));

  // 5. The click handler is wired: a click on the link is intercepted (no navigation), then confirms.
  let navigated = false;
  window.addEventListener('beforeunload', () => { navigated = true; });
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  window.confirm = () => false;
  home.dispatchEvent(click);
  await sleep(200);
  check('click is intercepted and cancelling stays on the page', click.defaultPrevented && !navigated && state.pages.length === 1);
}
