/**
 * Run a UI scenario in headless Chrome and print its PASS/FAIL log.
 * Usage: node tools/ui-check.js tools/ui/<scenario>.js [timeoutMs]
 * Env:   CHROME (browser path), UI_CHECK_FIXTURES (dir served at /__fixture/),
 *        UI_CHECK_ROOT (app root, default: the repo root),
 *        UI_CHECK_SHOT (write a PNG screenshot of the final page state to this path)
 * Needs Node 22+ (global WebSocket). Serves the app on a random local port
 * for the run only, and closes everything when done.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = process.env.UI_CHECK_ROOT || path.resolve(__dirname, '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FIXTURES = process.env.UI_CHECK_FIXTURES || '';
const scenarioPath = process.argv[2];
const timeoutMs = Number(process.argv[3] || 90000);
if (!scenarioPath) { console.error('usage: node tools/ui-check.js <scenario.js> [timeoutMs]'); process.exit(2); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.mjs': 'text/javascript' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const send = (code, body, type) => { res.writeHead(code, { 'Content-Type': type || 'text/plain' }); res.end(body); };
  if (url.pathname === '/__harness.html') {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
      .replace('</body>', '<script src="/__ui-harness.js"></script><script src="/__scenario.js"></script></body>');
    return send(200, html, 'text/html');
  }
  if (url.pathname === '/__ui-harness.js') return send(200, fs.readFileSync(path.join(__dirname, 'ui-harness.js')), 'text/javascript');
  if (url.pathname === '/__scenario.js') return send(200, fs.readFileSync(path.resolve(scenarioPath)), 'text/javascript');
  if (url.pathname.startsWith('/__fixture/')) {
    const file = path.join(FIXTURES, path.basename(decodeURIComponent(url.pathname)));
    return FIXTURES && fs.existsSync(file) ? send(200, fs.readFileSync(file), 'application/octet-stream') : send(404, 'no fixture');
  }
  const file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(404, 'not found');
  return send(200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
}

(async () => {
  const server = http.createServer(handle);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const appPort = server.address().port;
  const debugPort = 9300 + Math.floor(Math.random() * 500);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-check-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let exitCode = 1;
  try {
    let targets = [];
    for (let i = 0; i < 60 && !targets.length; i++) {
      try { targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); } catch (e) { await sleep(200); }
    }
    const page = targets.find((t) => t.type === 'page');
    if (!page) throw new Error('Chrome did not start');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve) => (ws.onopen = resolve));
    let nextId = 0;
    const waiting = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
    const send = (method, params = {}) => new Promise((resolve) => { const id = ++nextId; waiting.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
    const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true }); return r.result && r.result.result && r.result.result.value; };

    await send('Page.enable');
    if (process.env.UI_CHECK_VIEWPORT) { const [w, h] = process.env.UI_CHECK_VIEWPORT.split('x').map(Number); await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 }); }
    await send('Page.navigate', { url: `http://127.0.0.1:${appPort}/__harness.html` });

    const start = Date.now();
    let log = null;
    while (Date.now() - start < timeoutMs) {
      await sleep(400);
      if (await evaluate('window.__done === true')) { log = await evaluate('window.__log.join("\\n")'); break; }
    }
    if (process.env.UI_CHECK_SHOT) {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(process.env.UI_CHECK_SHOT, Buffer.from(shot.result.data, 'base64'));
    }
    if (log === null) { console.log('FAIL  scenario did not finish within ' + timeoutMs + 'ms'); }
    else { console.log(log); exitCode = /^FAIL/m.test(log) || !/^PASS/m.test(log) ? 1 : 0; }
    ws.close();
  } catch (err) {
    console.log('FAIL  runner error: ' + err.message);
  } finally {
    chrome.kill();
    server.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    process.exit(exitCode);
  }
})();
