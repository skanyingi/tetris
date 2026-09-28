import { ACTION_LABELS } from './config.js';
import { prettyKey } from './input.js';
import { isPersistent } from './storage.js';

const $ = (id) => document.getElementById(id);

/**
 * Owns everything on the page that is not the canvas: the HUD and the
 * modal screens. It reads game state but never mutates it —
 * every interaction is reported back through callbacks.
 */
export class UI {
  constructor(callbacks = {}) {
    this.cb = callbacks;
    this.el = {
      score: $('hud-score'),
      level: $('hud-level'),
      lines: $('hud-lines'),
      high: $('hud-high'),
      combo: $('hud-combo'),
      screens: {
        start: $('screen-start'),
        pause: $('screen-pause'),
        gameover: $('screen-gameover'),
        settings: $('screen-settings'),
      },
      announce: $('announce'),
      storageNote: $('storage-note'),
    };
    this.current = null;
    this.rebindCleanup = null;
    this.#wire();
    if (!isPersistent()) this.el.storageNote?.classList.remove('is-hidden');
  }

  // ------------------------------------------------------------------ wiring ---

  #wire() {
    // Several screens share the same actions, so nav buttons are wired by
    // behaviour rather than by id.
    const nav = {
      newgame: () => this.cb.onNewGame?.(),
      resume: () => this.cb.onResume?.(),
      pause: () => this.cb.onPauseToggle?.(),
      settings: () => this.show('settings'),
      close: () => this.close(),
      menu: () => this.cb.onMenu?.(),
    };
    for (const button of document.querySelectorAll('[data-nav]')) {
      button.addEventListener('click', () => nav[button.dataset.nav]?.());
    }
  }

  /** Live HUD readout. Called every frame; only touches the DOM on change. */
  setStats({ score, level, lines, highScore }) {
    this.#text(this.el.score, score);
    this.#text(this.el.level, level);
    this.#text(this.el.lines, lines);
    this.#text(this.el.high, highScore);
  }

  /** Shows a combo streak, or clears it when there is no streak. */
  setCombo(count) {
    if (!this.el.combo) return;
    this.el.combo.classList.toggle('is-visible', count > 0);
    this.#text(this.el.combo.querySelector('b'), count);
  }

  #text(node, value) {
    if (!node) return;
    const next = String(value);
    if (node.textContent !== next) node.textContent = next;
  }

  // ----------------------------------------------------------------- screens ---

  show(name) {
    for (const [key, node] of Object.entries(this.el.screens)) {
      if (!node) continue;
      node.classList.toggle('is-open', key === name);
    }
    this.current = name;
    // Move focus into the dialog so keyboard and screen-reader users land here.
    const dialog = this.el.screens[name];
    dialog?.querySelector('[data-autofocus], button, input')?.focus({ preventScroll: true });
  }

  close() {
    // Leaving the settings screen abandons any half-finished rebind capture.
    this.#cancelRebind();
    this.show(null);
  }

  isOpen() {
    return this.current !== null;
  }

  /** Fills in the game-over screen. */
  showGameOver(summary, { highScore, isRecord }) {
    this.#text($('final-score'), summary.score.toLocaleString());
    this.#text($('final-level'), summary.level);
    this.#text($('final-lines'), summary.lines);
    this.#text($('final-high'), highScore.toLocaleString());
    this.#text($('final-duration'), formatDuration(summary.durationMs));
    $('stat-pieces').textContent = summary.pieces;
    $('stat-singles').textContent = summary.singles;
    $('stat-doubles').textContent = summary.doubles;
    $('stat-triples').textContent = summary.triples;
    $('stat-tetrises').textContent = summary.tetrises;

    $('record-badge')?.classList.toggle('is-hidden', !isRecord);
    this.show('gameover');
  }

  // ---------------------------------------------------------------- settings ---

  /** Mirrors the settings object into the controls. */
  syncSettings(settings) {
    const set = (id, value) => {
      const node = $(id);
      if (node) node.checked = Boolean(value);
    };
    set('set-sound', settings.sound);
    set('set-ghost', settings.ghost);
    set('set-grid', settings.grid);

    const das = $('set-das');
    if (das) {
      das.value = String(settings.das);
      $('set-das-value').textContent = `${settings.das} ms`;
    }
    const arr = $('set-arr');
    if (arr) {
      arr.value = String(settings.arr);
      $('set-arr-value').textContent = `${settings.arr} ms`;
    }
    this.syncKeyBindings(settings);
  }

  /** Rebuilds the rebind rows from the current bindings. */
  syncKeyBindings(settings) {
    const list = $('keybinding-list');
    if (!list) return;
    list.replaceChildren();
    for (const [action, label] of Object.entries(ACTION_LABELS)) {
      const row = document.createElement('li');
      row.className = 'keybinding';

      const name = document.createElement('span');
      name.className = 'keybinding__name';
      name.textContent = label;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'keybinding__key';
      button.textContent = prettyKey(settings.keybindings[action]);
      button.setAttribute('aria-label', `Change key for ${label}`);

      button.addEventListener('click', () => {
        this.#listenForKey(action, button);
      });

      row.append(name, button);
      list.append(row);
    }
  }

  /** One-shot capture of the next key press for rebinding. */
  #listenForKey(action, button) {
    // Starting a new capture cancels the previous one, so a stray listener can
    // never sit there swallowing a keypress later.
    this.#cancelRebind();

    for (const node of document.querySelectorAll('.keybinding__key.is-listening')) {
      node.classList.remove('is-listening');
      node.textContent = node.dataset.label || '—';
    }

    const previous = button.textContent;
    button.dataset.label = previous;
    button.classList.add('is-listening');
    button.textContent = 'Press a key…';

    const finish = (code) => {
      button.classList.remove('is-listening');
      button.textContent = prettyKey(code);
      this.#cancelRebind();
      if (code) this.cb.onRebind?.(action, code);
    };

    const onKeyDown = (event) => {
      // Capture phase plus stopPropagation keeps the game from also acting on
      // the key being bound.
      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'Escape') {
        button.classList.remove('is-listening');
        button.textContent = previous;
        this.#cancelRebind();
      } else {
        finish(event.code);
      }
    };

    this.rebindCleanup = () => window.removeEventListener('keydown', onKeyDown, true);
    window.addEventListener('keydown', onKeyDown, true);
  }

  #cancelRebind() {
    this.rebindCleanup?.();
    this.rebindCleanup = null;
  }

  /** Announces a game event for assistive technology. */
  announce(message) {
    if (this.el.announce) this.el.announce.textContent = message;
  }
}

function formatDuration(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

