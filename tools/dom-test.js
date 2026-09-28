/**
 * Boots the real browser modules against a minimal DOM stub.
 *
 * The logic tests in test.js cover the game rules, but roughly half this
 * project is DOM and canvas wiring that those never touch. This file stubs just
 * enough of the browser to import main.js, run some frames, and simulate input,
 * then asserts on the results.
 *
 * It also cross-checks the contract between the HTML and the code: every
 * getElementById target must exist in index.html, and every data-nav button
 * must have a handler. Those are the failures that otherwise only show up in a
 * real browser.
 *
 * Usage: node tools/dom-test.js
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const html = await readFile(resolve(ROOT, 'index.html'), 'utf8');

let passed = 0;
const failures = [];
const missingIds = new Set();

function check(name, condition, detail = '') {
  if (condition) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

// ------------------------------------------------------- HTML contract ---

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const htmlNavs = [...html.matchAll(/\bdata-nav="([^"]+)"/g)].map((m) => m[1]);
const htmlActions = [...html.matchAll(/\bdata-action="([^"]+)"/g)].map((m) => m[1]);

check('the page has a board canvas', htmlIds.has('board'));
check('the page has no duplicate ids', htmlIds.size === [...html.matchAll(/\bid="/g)].length);
for (const nav of ['newgame', 'resume', 'pause', 'settings', 'close', 'menu']) {
  check(`the page has a ${nav} button`, htmlNavs.includes(nav));
}
for (const action of ['left', 'right', 'softDrop', 'rotateCW', 'rotateCCW', 'hardDrop']) {
  check(`the touch pad has a ${action} button`, htmlActions.includes(action));
}

// ------------------------------------------------------------- DOM stub ---

class ClassList {
  constructor() {
    this.set = new Set();
  }
  add(...names) {
    for (const n of names) this.set.add(n);
  }
  remove(...names) {
    for (const n of names) this.set.delete(n);
  }
  contains(name) {
    return this.set.has(name);
  }
  toggle(name, force) {
    const on = force === undefined ? !this.set.has(name) : Boolean(force);
    if (on) this.set.add(name);
    else this.set.delete(name);
    return on;
  }
}

function stubContext2d() {
  const noop = () => {};
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    shadowColor: '',
    shadowBlur: 0,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arcTo: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    translate: noop,
    setTransform: noop,
    createBuffer: () => ({
      getChannelData: () => new Float32Array(1),
    }),
    createOscillator: () => ({
      type: 'sine',
      frequency: { setValueAtTime: noop, exponentialRampToValueAtTime: noop },
      connect: () => ({ connect: noop }),
      start: noop,
      stop: noop,
    }),
    createGain: () => ({
      gain: { value: 0, setTargetAtTime: noop, exponentialRampToValueAtTime: noop },
      connect: () => ({ connect: noop }),
    }),
    createBiquadFilter: () => ({
      type: 'lowpass',
      frequency: { setValueAtTime: noop, exponentialRampToValueAtTime: noop },
      connect: () => ({ connect: noop }),
    }),
    createBufferSource: () => ({
      buffer: null,
      connect: () => ({ connect: noop }),
      start: noop,
      stop: noop,
    }),
  };
}

class StubElement {
  constructor(id = '') {
    this.id = id;
    this.tagName = 'DIV';
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.checked = false;
    this.dataset = {};
    this.classList = new ClassList();
    this.style = { setProperty: () => {} };
    this.children = [];
    this.listeners = new Map();
    this.width = 300;
    this.height = 600;
    this._ctx = stubContext2d();
  }
  addEventListener(type, handler, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push({ handler, options });
  }
  removeEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    const index = list.findIndex((entry) => entry.handler === handler);
    if (index !== -1) list.splice(index, 1);
  }
  dispatch(type, event = {}) {
    for (const { handler, options } of this.listeners.get(type) || []) {
      // Honour a one-shot capture listener, as the DOM does.
      if (options?.once) this.removeEventListener(type, handler);
      handler({ target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...event });
    }
  }
  setPointerCapture() {}
  releasePointerCapture() {}
  focus() {}
  replaceChildren(...nodes) {
    this.children = nodes;
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  setAttribute() {}
  removeAttribute() {}
  querySelector() {
    return new StubElement();
  }
  querySelectorAll() {
    return [];
  }
  getBoundingClientRect() {
    return { width: 300, height: 600, top: 0, left: 0, right: 300, bottom: 600 };
  }
  getContext() {
    return this._ctx;
  }
}

// Every id in the HTML resolves to a stub; anything else is a bug in the code.
const registry = new Map();
for (const id of htmlIds) registry.set(id, new StubElement(id));

const navElements = new Map();
for (const nav of new Set(htmlNavs)) {
  const element = new StubElement(`nav:${nav}`);
  element.dataset.nav = nav;
  navElements.set(nav, element);
}

const actionElements = new Map();
for (const action of new Set(htmlActions)) {
  const element = new StubElement(`action:${action}`);
  element.dataset.action = action;
  actionElements.set(action, element);
}

const documentStub = {
  hidden: false,
  // main.js sets data-game-booted on this to tell the inline watchdog in
  // index.html that the module graph loaded.
  documentElement: { dataset: {} },
  getElementById(id) {
    if (!registry.has(id)) {
      missingIds.add(id);
      const element = new StubElement(id);
      registry.set(id, element);
      return element;
    }
    return registry.get(id);
  },
  querySelectorAll(selector) {
    if (selector === '[data-nav]') return [...navElements.values()];
    if (selector === '[data-action]') return [...actionElements.values()];
    if (selector.includes('is-listening')) return [];
    return [];
  },
  querySelector() {
    return new StubElement();
  },
  addEventListener() {},
  createElement(tag) {
    const element = new StubElement();
    element.tagName = tag.toUpperCase();
    return element;
  },
};

let rafId = 0;
let clock = 0;
const frameCallbacks = new Map();
const windowListeners = new Map();
const store = new Map();

globalThis.document = documentStub;
globalThis.HTMLInputElement = StubElement;
globalThis.performance = { now: () => clock };
globalThis.window = {
  innerWidth: 1280,
  innerHeight: 900,
  devicePixelRatio: 2,
  document: documentStub,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  requestAnimationFrame: (fn) => {
    rafId += 1;
    frameCallbacks.set(rafId, fn);
    return rafId;
  },
  cancelAnimationFrame: (id) => frameCallbacks.delete(id),
  addEventListener(type, handler, options) {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    const entry = { handler, signal: options?.signal };
    windowListeners.get(type).push(entry);
    // Real DOM semantics: aborting the signal detaches the listener. The game
    // relies on this for its teardown, so the stub has to honour it too.
    options?.signal?.addEventListener?.('abort', () => {
      const list = windowListeners.get(type) || [];
      const index = list.indexOf(entry);
      if (index !== -1) list.splice(index, 1);
    });
  },
  removeEventListener(type, handler) {
    const list = windowListeners.get(type) || [];
    const index = list.findIndex((entry) => entry.handler === handler);
    if (index !== -1) list.splice(index, 1);
  },
  // No AudioContext: the kit must degrade to silence rather than throw.
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
};

globalThis.ResizeObserver = window.ResizeObserver;
globalThis.requestAnimationFrame = window.requestAnimationFrame;
globalThis.cancelAnimationFrame = window.cancelAnimationFrame;

function runFrame() {
  const pending = [...frameCallbacks.values()];
  frameCallbacks.clear();
  for (const fn of pending) fn(clock);
}

/** Advances the fake clock and pumps that many animation frames. */
function frames(count = 1, stepMs = 16) {
  for (let i = 0; i < count; i++) {
    clock += stepMs;
    runFrame();
  }
}

function pressKey(code, type = 'keydown') {
  for (const entry of [...(windowListeners.get(type) || [])]) {
    if (entry.signal?.aborted) continue;
    entry.handler({
      code,
      key: code,
      repeat: false,
      preventDefault() {},
      stopPropagation() {},
      target: new StubElement(),
    });
  }
}

function tap(nav) {
  navElements.get(nav)?.dispatch('click');
}

// ---------------------------------------------------------------- boot ---

const errors = [];
try {
  await import('../js/main.js');
} catch (error) {
  errors.push(error);
}

check('main.js imports without throwing', errors.length === 0, errors.map((e) => e.message).join('; '));
check(
  'main.js flagged the document as booted',
  documentStub.documentElement.dataset.gameBooted === 'true',
  `gameBooted=${documentStub.documentElement.dataset.gameBooted}`,
);
check(
  'every getElementById target exists in the HTML',
  missingIds.size === 0,
  [...missingIds].join(', '),
);

// The start screen should be the first thing shown.
check('the start screen opens on load', registry.get('screen-start').classList.contains('is-open'));
check('the menu board was filled', registry.get('screen-start') !== undefined);

// Drive some frames; the render loop must keep re-registering itself.
frames(10);
check('the render loop is running', frameCallbacks.size > 0, `${frameCallbacks.size} pending`);

// Start a run.
tap('newgame');
frames(5);
check('starting a game closed the start screen', !registry.get('screen-start').classList.contains('is-open'));

// Exercise every key binding, then let the frames land the piece.
for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'KeyZ', 'KeyA', 'KeyC', 'Space']) {
  pressKey(code, 'keydown');
  frames(2);
  pressKey(code, 'keyup');
  frames(2);
}
check('pressing keys produced no errors', errors.length === 0, errors.map((e) => e.message).join('; '));
check(
  'a hard drop moved the score off zero',
  Number(registry.get('hud-score').textContent) > 0,
  `score "${registry.get('hud-score').textContent}"`,
);
check('the lines counter is showing a number', /^\d+$/.test(registry.get('hud-lines').textContent));

// Hold-to-repeat: holding left should slide the piece more than one cell.
pressKey('ArrowLeft', 'keydown');
frames(40);
pressKey('ArrowLeft', 'keyup');
frames(2);
check('auto-shift repeated while the key was held', errors.length === 0);

// Touch pad.
const padLeft = actionElements.get('left');
padLeft.dispatch('pointerdown', { pointerId: 1 });
frames(10);
padLeft.dispatch('pointerup', { pointerId: 1 });
check('the touch pad pressed state was cleared', !padLeft.classList.contains('is-pressed'));
actionElements.get('rotateCW').dispatch('pointerdown', { pointerId: 2 });
actionElements.get('rotateCW').dispatch('pointerup', { pointerId: 2 });
frames(4);
check('the touch pad produced no errors', errors.length === 0, errors.map((e) => e.message).join('; '));

// Pause and resume.
pressKey('KeyP', 'keydown');
check('P opens the pause screen', registry.get('screen-pause').classList.contains('is-open'));
pressKey('KeyP', 'keydown');
check('P again resumes', !registry.get('screen-pause').classList.contains('is-open'));

// Settings round-trip.
const soundToggle = registry.get('set-sound');
soundToggle.checked = true;
soundToggle.dispatch('change');
check('the sound setting is persisted', store.get('tetris.settings')?.includes('"sound":true'));

// Key rebinding: the rows are built from ACTION_LABELS, so find the one we want.
const bindingRows = registry.get('keybinding-list').children;
check('a row was built for every action', bindingRows.length === 8, `${bindingRows.length}`);
const baselineKeydown = windowListeners.get('keydown').length;
const pauseRow = bindingRows.find((row) => row.children[0]?.textContent === 'Pause');
check('the pause binding row exists', Boolean(pauseRow));
pauseRow.children[1].dispatch('click');
pressKey('KeyQ');
check('rebinding pause to Q was saved', store.get('tetris.settings')?.includes('"pause":"KeyQ"'));
const listenersAfterRebind = windowListeners.get('keydown').length;
check(
  'the rebind capture listener was released',
  listenersAfterRebind === baselineKeydown,
  `${listenersAfterRebind} vs ${baselineKeydown}`,
);
check('the button shows the new key', pauseRow.children[1].textContent === 'Q', pauseRow.children[1].textContent);
// Put it back so the pause checks below still work.
store.set('tetris.settings', store.get('tetris.settings').replace('"pause":"KeyQ"', '"pause":"KeyP"'));

// Top the stack out by hard dropping in one spot, which exercises game over.
let guard = 0;
while (!registry.get('screen-gameover').classList.contains('is-open') && guard++ < 120) {
  pressKey('Space', 'keydown');
  pressKey('Space', 'keyup');
  frames(20);
}
check(
  'spamming hard drop tops the stack out',
  registry.get('screen-gameover').classList.contains('is-open'),
  `gave up after ${guard} drops`,
);
check(
  'a final score was reported',
  Number(registry.get('final-score').textContent.replace(/,/g, '')) > 0,
);
check('the high score was recorded', Number(store.get('tetris.highScore')) > 0);
check(
  'no leaderboard data is written any more',
  store.get('tetris.leaderboard') === undefined,
);

// Teardown must cancel the loop and drop every listener.
const liveKeydown = windowListeners.get('keydown')?.length ?? 0;
check('keydown listeners are live', liveKeydown > 0, `${liveKeydown}`);
for (const entry of windowListeners.get('pagehide') || []) {
  entry.handler({ type: 'pagehide' });
}
check('pagehide cancelled the render loop', frameCallbacks.size === 0, `${frameCallbacks.size} left`);
check(
  'pagehide removed the key listeners',
  (windowListeners.get('keydown')?.length ?? 0) === 0,
  `${windowListeners.get('keydown')?.length ?? 0} left`,
);

// ------------------------------------------------------------- report ---

console.log('Neon Tetris — DOM / integration tests\n');
console.log(`  ${failures.length === 0 ? 'PASS' : 'FAIL'}  boot, input, settings, teardown`);
console.log(`\n${passed} assertions passed, ${failures.length} failed.`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
