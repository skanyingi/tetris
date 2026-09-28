/**
 * Drives the real game in a real browser over the Chrome DevTools Protocol.
 *
 * The DOM stub proves the code runs; this proves the pixels are right. It
 * launches headless Edge, captures every console message and page error, plays
 * a scripted game, and writes screenshots for inspection.
 *
 * Uses Node 22's built-in WebSocket, so there is nothing to install.
 *
 * Usage: node tools/browser-test.js [url]
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_UNDER_TEST = process.argv[2] || 'http://localhost:4173/';
const EDGE = process.env.EDGE_PATH
  || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9333;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};

// ------------------------------------------------------------- CDP client ---

class CDP {
  constructor(url) {
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', () => reject(new Error('CDP socket failed')));
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const slot = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (!slot) return;
        if (message.error) slot.reject(new Error(message.error.message));
        else slot.resolve(message.result);
      } else {
        this.events.push(message);
      }
    });
  }

  send(method, params = {}) {
    this.id += 1;
    const id = this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} timed out`));
        }
      }, 20000);
    });
  }

  close() {
    this.ws.close();
  }
}

async function connect() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) {
        const client = new CDP(page.webSocketDebuggerUrl);
        // The handshake has to finish before any command is sent.
        await client.ready;
        return client;
      }
    } catch {
      // Browser not listening yet.
    }
    await sleep(250);
  }
  throw new Error('could not attach to the browser');
}

// --------------------------------------------------------------- scripting ---

/** Evaluates an expression in the page and returns its JSON value. */
async function evaluate(cdp, expression) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description || 'evaluate failed');
  }
  return result.value;
}

/** Dispatches a real key press through the browser's input pipeline. */
async function key(cdp, code, keyName, keyCode) {
  for (const type of ['keyDown', 'keyUp']) {
    await cdp.send('Input.dispatchKeyEvent', {
      type,
      code,
      key: keyName,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    });
    await sleep(30);
  }
}

const KEYS = {
  left: ['ArrowLeft', 'ArrowLeft', 37],
  right: ['ArrowRight', 'ArrowRight', 39],
  down: ['ArrowDown', 'ArrowDown', 40],
  up: ['ArrowUp', 'ArrowUp', 38],
  space: ['Space', ' ', 32],
  z: ['KeyZ', 'z', 90],
  a: ['KeyA', 'a', 65],
  c: ['KeyC', 'c', 67],
  p: ['KeyP', 'p', 80],
};

async function tapKey(cdp, name) {
  const [code, keyName, keyCode] = KEYS[name];
  await key(cdp, code, keyName, keyCode);
}

async function screenshot(cdp, path) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path, Buffer.from(data, 'base64'));
  return path;
}

// ------------------------------------------------------------------- main ---

const profile = await mkdtemp(join(tmpdir(), 'tetris-cdp-'));
const browser = spawn(
  EDGE,
  [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`,
    // Chrome rejects DevTools WebSocket handshakes carrying an unexpected
    // Origin header, which the built-in client does send.
    '--remote-allow-origins=*',
    '--window-size=1400,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let cdp;
try {
  cdp = await connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');

  await cdp.send('Page.navigate', { url: URL_UNDER_TEST });
  await sleep(2500);

  // --- the module graph must have loaded ---------------------------------
  const booted = await evaluate(cdp, 'document.documentElement.dataset.gameBooted');
  check('the module graph loaded', booted === 'true', `gameBooted=${booted}`);

  const noticeHidden = await evaluate(
    cdp,
    'document.getElementById("boot-failure").classList.contains("is-hidden")',
  );
  check('the boot-failure notice stays hidden', noticeHidden === true);

  const startOpen = await evaluate(
    cdp,
    'document.getElementById("screen-start").classList.contains("is-open")',
  );
  check('the start screen is open', startOpen === true);

  const nextGone = await evaluate(
    cdp,
    '!document.getElementById("next-list") && !document.getElementById("set-next")',
  );
  check('the next panel and its setting are really gone', nextGone === true);

  const boardSize = await evaluate(cdp, '(c => c.width + "x" + c.height)(document.getElementById("board"))');
  const [bw, bh] = boardSize.split('x').map(Number);
  check('the canvas has a real backing store', bw > 0 && bh > 0, boardSize);
  check('the canvas keeps the 1:2 field ratio', Math.abs(bh / bw - 2) < 0.05, boardSize);

  await screenshot(cdp, '/tmp/cdp-menu.png');

  // --- start a game ------------------------------------------------------
  await evaluate(cdp, 'document.querySelector(\'[data-nav="newgame"]\').click()');
  await sleep(400);
  const playing = await evaluate(cdp, 'document.getElementById("screen-start").classList.contains("is-open")');
  check('the start screen closed on play', playing === false);

  // Play a scripted opening: move, rotate, hard drop.
  await tapKey(cdp, 'left');
  await tapKey(cdp, 'right');
  await tapKey(cdp, 'up');
  await tapKey(cdp, 'a');
  await sleep(200);
  check(
    'the removed hold slot is really gone',
    await evaluate(cdp, '!document.getElementById("hold-canvas") && !document.getElementById("hold-panel")') === true,
  );
  check(
    'the removed leaderboard is really gone',
    await evaluate(
      cdp,
      '!document.getElementById("screen-leaderboard") && !document.querySelector(\'[data-nav="leaderboard"]\')',
    ) === true,
  );

  for (let i = 0; i < 6; i++) {
    await tapKey(cdp, 'left');
    await tapKey(cdp, 'up');
    await tapKey(cdp, 'space');
    await sleep(220);
  }

  const hud = await evaluate(
    cdp,
    `({
      score: document.getElementById('hud-score').textContent,
      lines: document.getElementById('hud-lines').textContent,
      level: document.getElementById('hud-level').textContent,
    })`,
  );
  check('hard drops scored', Number(hud.score) > 0, JSON.stringify(hud));
  check('the score is numeric', /^\d+$/.test(hud.score), hud.score);
  check('the level is numeric', /^\d+$/.test(hud.level), hud.level);

  await screenshot(cdp, '/tmp/cdp-play.png');

  // --- pause -------------------------------------------------------------
  await tapKey(cdp, 'p');
  await sleep(200);
  const paused = await evaluate(
    cdp,
    'document.getElementById("screen-pause").classList.contains("is-open")',
  );
  check('P pauses', paused === true);
  await tapKey(cdp, 'p');
  await sleep(200);
  const resumed = await evaluate(
    cdp,
    '!document.getElementById("screen-pause").classList.contains("is-open")',
  );
  check('P resumes', resumed === true);

  // --- settings round trip ----------------------------------------------
  await evaluate(cdp, 'document.querySelector(\'[data-nav="settings"]\').click()');
  await sleep(300);
  const hasClose = await evaluate(
    cdp,
    '!!document.querySelector("#screen-settings .modal__close")',
  );
  check('the settings dialog has a corner close button', hasClose === true);
  const closeLabel = await evaluate(
    cdp,
    'document.querySelector("#screen-settings .modal__close").getAttribute("aria-label")',
  );
  check('the close button is labelled for screen readers', !!closeLabel, String(closeLabel));

  const ghostOff = await evaluate(
    cdp,
    `(() => {
      const box = document.getElementById('set-ghost');
      box.checked = false;
      box.dispatchEvent(new Event('change', { bubbles: true }));
      return JSON.parse(localStorage.getItem('tetris.settings')).ghost;
    })()`,
  );
  check('turning the ghost off persists', ghostOff === false);

  // Close it with the new button, and confirm the dialog went away.
  await evaluate(cdp, 'document.querySelector("#screen-settings .modal__close").click()');
  await sleep(250);
  check(
    'the close button dismisses settings',
    await evaluate(
      cdp,
      '!document.getElementById("screen-settings").classList.contains("is-open")',
    ) === true,
  );

  // --- narrow viewport ---------------------------------------------------
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 780,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await sleep(600);
  const mobile = await evaluate(cdp, '(c => c.width + "x" + c.height)(document.getElementById("board"))');
  const [mw, mh] = mobile.split('x').map(Number);
  check('the board resizes on a phone viewport', mw > 0 && mh > 0, mobile);
  const padShown = await evaluate(
    cdp,
    'getComputedStyle(document.getElementById("touchpad")).display !== "none"',
  );
  check('the touch pad appears on a narrow viewport', padShown === true);
  const overflow = await evaluate(
    cdp,
    'document.documentElement.scrollWidth <= window.innerWidth + 1',
  );
  check('the phone layout does not scroll sideways', overflow === true, 'horizontal overflow');
  await screenshot(cdp, '/tmp/cdp-mobile.png');

  // --- console hygiene ---------------------------------------------------
  const problems = cdp.events.filter((e) => {
    if (e.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(e.params.type)) {
      return true;
    }
    if (e.method === 'Runtime.exceptionThrown') return true;
    if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') return true;
    return false;
  });
  const details = problems
    .map((e) => {
      if (e.method === 'Runtime.exceptionThrown') {
        return e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text;
      }
      if (e.method === 'Log.entryAdded') return `${e.params.entry.source}: ${e.params.entry.text}`;
      return (e.params.args || []).map((a) => a.value ?? a.description).join(' ');
    })
    .join(' | ');
  check('no console errors or warnings', problems.length === 0, details);

  await cdp.send('Emulation.clearDeviceMetricsOverride');
  console.log('\nscreenshots: /tmp/cdp-menu.png /tmp/cdp-play.png /tmp/cdp-mobile.png');
} catch (error) {
  failures.push(`harness threw: ${error.message}
${error.stack}`);
} finally {
  cdp?.close();
  browser.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

console.log('Neon Tetris — real browser tests\n');
console.log(`  ${failures.length === 0 ? 'PASS' : 'FAIL'}  ${URL_UNDER_TEST}`);
console.log(`\n${passed} assertions passed, ${failures.length} failed.`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
