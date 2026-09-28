import { ACTION_LABELS } from './config.js';
import { CELL_COLORS, CELL_VALUE, Game } from './game.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { AudioKit } from './audio.js';
import { UI } from './ui.js';
import * as store from './storage.js';

/** Longest frame delta the simulation will accept, in ms. */
const MAX_FRAME_MS = 100;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let settings = store.loadSettings();
let highScore = store.loadHighScore();

const pieceColor = (type) => CELL_COLORS[CELL_VALUE[type]] || CELL_COLORS[1];

// ------------------------------------------------------------------ wiring ---

const ui = new UI({
  onNewGame: startGame,
  onResume: () => {
    game.resume();
    ui.close();
  },
  onPauseToggle: togglePause,
  onMenu: showMenu,
  onRebind: rebind,
});

const audio = new AudioKit();
audio.setEnabled(settings.sound);

const game = new Game(handleEvent);
game.applySettings(settings);

const renderer = new Renderer(document.getElementById('board'), { reducedMotion });
const input = new Input({
  game,
  getSettings: () => settings,
  onPauseToggle: togglePause,
  onGesture: () => audio.unlock(),
});

// -------------------------------------------------------------- event sink ---

/** Routes one gameplay event to sound, visuals and announcements. */
function handleEvent(event) {
  audio.handle(event);

  switch (event.type) {
    case 'hardDrop':
      renderer.hardDrop(event.cells, pieceColor(event.pieceType), event.distance);
      break;
    case 'lock':
      renderer.lock(event.cells, pieceColor(event.pieceType));
      break;
    case 'clearStart':
      renderer.lineClear(event.rows);
      // The fanfare fires at the flash, not when the rows actually mutate.
      audio.handle({ type: 'clear', count: event.count });
      break;
    case 'combo':
      ui.setCombo(event.value);
      break;
    case 'clear':
      if (event.combo > 0) ui.announce(`Combo ${event.combo}`);
      if (event.count === 4) ui.announce('Tetris! Four lines.');
      else if (event.count > 0) ui.announce(`${event.count} lines cleared.`);
      break;
    case 'levelUp':
      ui.announce(`Level ${event.level}`);
      break;
    case 'gameOver':
      finishGame();
      break;
    default:
      break;
  }
}

// -------------------------------------------------------------- game flow ---

function startGame() {
  game.applySettings(settings);
  game.newGame();
  ui.setCombo(0);
  ui.close();
  renderer.resize();
  syncHud(true);
}

function togglePause() {
  // The pause key works both ways, so it is allowed through while the pause
  // screen is up. Any other modal, such as settings, still swallows it.
  if (ui.isOpen() && ui.current !== 'pause') return;
  if (game.state === 'playing') {
    game.pause();
    ui.show('pause');
  } else if (game.state === 'paused') {
    game.resume();
    ui.close();
  }
}

function showMenu() {
  game.seedAttract();
  ui.setCombo(0);
  ui.show('start');
}

function finishGame() {
  const summary = game.summary();
  const previousHigh = highScore;
  if (summary.score > highScore) {
    highScore = summary.score;
    store.saveHighScore(highScore);
  }
  ui.showGameOver(summary, {
    highScore,
    isRecord: summary.score > previousHigh,
  });
  ui.announce(`Game over. Final score ${summary.score}.`);
}

function rebind(action, code) {
  // One key, one action: clear any other action already using this code.
  for (const [other, bound] of Object.entries(settings.keybindings)) {
    if (bound === code && other !== action) settings.keybindings[other] = 'Unbound';
  }
  settings.keybindings[action] = code;
  store.saveSettings(settings);
  ui.syncKeyBindings(settings);
  ui.announce(`${ACTION_LABELS[action]} set to ${code.replace('Key', '')}`);
}

// ----------------------------------------------------------------- HUD sync ---

function syncHud(force = false) {
  ui.setStats({
    score: game.score,
    level: game.level,
    lines: game.lines,
    highScore,
  });
}

// -------------------------------------------------------------------- loop ---

let lastTime = performance.now();
let frameId = 0;

/**
 * One requestAnimationFrame loop drives everything. There are no intervals
 * anywhere in the game: gravity, DAS/ARR, lock delay and the clear animation
 * are all advanced from here, so there is a single thing to cancel on teardown.
 */
function tick(now) {
  frameId = requestAnimationFrame(tick);
  // Clamp the delta so a backgrounded tab does not resume with a huge jump.
  const dt = Math.min(now - lastTime, MAX_FRAME_MS);
  lastTime = now;

  input.update(dt);
  game.update(dt);
  renderer.render(game, dt);
  syncHud();
}

function startLoop() {
  if (frameId) return;
  lastTime = performance.now();
  frameId = requestAnimationFrame(tick);
}

function stopLoop() {
  if (!frameId) return;
  cancelAnimationFrame(frameId);
  frameId = 0;
}

// ------------------------------------------------------------------ events ---

function wireSettings() {
  const bind = (id, event, apply) => {
    document.getElementById(id)?.addEventListener(event, (e) => {
      apply(e.currentTarget);
      store.saveSettings(settings);
      game.applySettings(settings);
    });
  };

  bind('set-sound', 'change', (node) => {
    audio.unlock();
    settings.sound = node.checked;
    audio.setEnabled(settings.sound);
  });
  bind('set-ghost', 'change', (node) => {
    settings.ghost = node.checked;
  });
  bind('set-grid', 'change', (node) => {
    settings.grid = node.checked;
  });

  // Sliders update the label live and save on every step, but are not re-synced
  // from state mid-drag or the thumb would fight the pointer.
  const slider = (id, labelId, key) => {
    document.getElementById(id)?.addEventListener('input', (e) => {
      settings[key] = Number(e.currentTarget.value);
      const label = document.getElementById(labelId);
      if (label) label.textContent = `${settings[key]} ms`;
      store.saveSettings(settings);
    });
  };
  slider('set-das', 'set-das-value', 'das');
  slider('set-arr', 'set-arr-value', 'arr');
}

// Enter starts a run from the menu and restarts from the game-over screen, and
// Escape backs out of a dialog. Both live here rather than in Input because
// neither is a rebindable gameplay action.
document.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  if (event.target instanceof HTMLInputElement) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  if (event.code === 'Enter') {
    if (ui.current === 'start' || ui.current === 'gameover') {
      event.preventDefault();
      startGame();
    }
    return;
  }

  if (event.code === 'Escape') {
    // Pause and game over are excluded on purpose: the first has to stay
    // resumable, and the second is waiting on a decision about the score.
    if (ui.current === 'settings') {
      event.preventDefault();
      ui.close();
    }
  }
});

// A resize or a browser zoom changes the canvas box; ResizeObserver catches both.
const observer = new ResizeObserver(() => renderer.resize());
observer.observe(document.getElementById('board'));

window.addEventListener('pagehide', () => {
  stopLoop();
  input.detach();
  observer.disconnect();
});

// Losing the tab mid-run should not cost a life.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'playing') {
    game.pause();
    ui.show('pause');
  }
});

// ----------------------------------------------------------------- bootstrap ---

function boot() {
  wireSettings();
  ui.syncSettings(settings);
  input.attach();
  input.attachTouchPad(document.getElementById('touchpad'));

  // A pre-filled board sits behind the menu so the page does not open on an
  // empty grid.
  game.seedAttract();
  syncHud(true);
  ui.show('start');
  renderer.resize();
  startLoop();

  // Tells the inline watchdog in index.html that the module graph loaded. If it
  // never gets set, the browser refused the modules and the page explains why
  // instead of sitting there inert.
  document.documentElement.dataset.gameBooted = 'true';
}

boot();
