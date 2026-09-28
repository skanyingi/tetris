/**
 * Keyboard and touch input, including delayed auto-shift (DAS) and auto-repeat
 * (ARR) so holding a direction slides the piece at a controlled rate.
 *
 * Every listener is registered through one AbortController. Calling `detach()`
 * aborts all of them at once, which is what makes teardown leak-free.
 */

const ARROWS = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
};

/** Reads a KeyboardEvent.code into something a person can read. */
export function prettyKey(code) {
  if (!code) return '—';
  if (ARROWS[code]) return ARROWS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const named = {
    Space: 'Space',
    ShiftLeft: 'L Shift',
    ShiftRight: 'R Shift',
    ControlLeft: 'L Ctrl',
    ControlRight: 'R Ctrl',
    Escape: 'Esc',
    Enter: 'Enter',
    Backspace: 'Bksp',
  };
  return named[code] || code;
}

export class Input {
  /**
   * @param {object} options
   * @param {import('./game.js').Game} options.game
   * @param {() => object} options.getSettings Re-read on every call so rebinding
   *   and DAS/ARR edits take effect immediately.
   * @param {() => void} options.onPauseToggle
   * @param {() => void} options.onGesture Called on any real user gesture, used
   *   to unlock the audio context.
   */
  constructor({ game, getSettings, onPauseToggle, onGesture }) {
    this.game = game;
    this.getSettings = getSettings;
    this.onPauseToggle = onPauseToggle;
    this.onGesture = onGesture;
    this.controller = new AbortController();
    this.held = new Set();
    this.shiftDir = 0;
    this.dasTimer = 0;
    this.arrTimer = 0;
    this.bound = false;
  }

  /** Builds a code -> action lookup from the current bindings. */
  #actionFor(code) {
    const { keybindings } = this.getSettings();
    for (const [action, bound] of Object.entries(keybindings)) {
      if (bound === code) return action;
    }
    return null;
  }

  attach() {
    if (this.bound) return;
    this.bound = true;
    const { signal } = this.controller;

    window.addEventListener(
      'keydown',
      (event) => {
        this.onGesture();
        // Let the browser keep its own shortcuts when a modifier is held.
        if (event.ctrlKey || event.metaKey || event.altKey) return;

        const action = this.#actionFor(event.code);
        if (!action) return;
        // Arrows and space scroll the page otherwise.
        event.preventDefault();
        if (event.repeat) return;
        if (action === 'pause') {
          this.onPauseToggle();
          return;
        }
        this.press(action);
      },
      { signal },
    );

    window.addEventListener(
      'keyup',
      (event) => {
        const action = this.#actionFor(event.code);
        if (action) this.release(action);
      },
      { signal },
    );

    // Releasing focus with a key down would otherwise leave the piece sliding.
    window.addEventListener('blur', () => this.releaseAll(), { signal });
  }

  /** Wires the on-screen touch pad. Safe to call before the DOM is ready. */
  attachTouchPad(root) {
    if (!root) return;
    const { signal } = this.controller;
    for (const button of root.querySelectorAll('[data-action]')) {
      const action = button.dataset.action;
      button.addEventListener(
        'pointerdown',
        (event) => {
          event.preventDefault();
          this.onGesture();
          button.setPointerCapture?.(event.pointerId);
          button.classList.add('is-pressed');
          this.press(action);
        },
        { signal },
      );
      const end = (event) => {
        event.preventDefault();
        button.classList.remove('is-pressed');
        this.release(action);
      };
      button.addEventListener('pointerup', end, { signal });
      button.addEventListener('pointercancel', end, { signal });
      button.addEventListener('lostpointercapture', () => {
        button.classList.remove('is-pressed');
        this.release(action);
      }, { signal });
      // A pointer that leaves the button must not leave the piece stuck.
      button.addEventListener('contextmenu', (event) => event.preventDefault(), { signal });
    }
  }

  detach() {
    this.controller.abort();
    this.bound = false;
    this.releaseAll();
  }

  press(action) {
    if (this.held.has(action)) return;
    this.held.add(action);
    if (action === 'left' || action === 'right') {
      // When both directions are held the most recent press wins.
      this.shiftDir = action === 'left' ? -1 : 1;
      this.dasTimer = 0;
      this.arrTimer = 0;
      this.game.move(this.shiftDir);
    } else if (action === 'softDrop') {
      this.game.setSoftDrop(true);
    } else if (action === 'rotateCW') {
      this.game.rotate(1);
    } else if (action === 'rotateCCW') {
      this.game.rotate(-1);
    } else if (action === 'rotate180') {
      this.game.rotate(2);
    } else if (action === 'hardDrop') {
      this.game.hardDrop();
    }
  }

  release(action) {
    if (!this.held.delete(action)) return;
    if (action === 'left' || action === 'right') {
      const other = action === 'left' ? 'right' : 'left';
      // Falling back to the still-held key avoids a dead gap in the slide.
      this.shiftDir = this.held.has(other) ? (other === 'left' ? -1 : 1) : 0;
      this.dasTimer = 0;
      this.arrTimer = 0;
    } else if (action === 'softDrop') {
      this.game.setSoftDrop(false);
    }
  }

  releaseAll() {
    for (const action of [...this.held]) this.release(action);
    this.held.clear();
    this.shiftDir = 0;
  }

  /** Drives DAS/ARR. Called once per frame from the main loop. */
  update(dt) {
    if (this.shiftDir === 0) return;
    const { das, arr } = this.getSettings();
    const delay = Math.max(0, das);
    this.dasTimer += dt;
    if (this.dasTimer < delay) return;

    // A zero ARR would spin forever; floor it at one frame.
    const interval = Math.max(1, arr);
    this.arrTimer += dt;
    let steps = 0;
    while (this.arrTimer >= interval && steps < 20) {
      this.arrTimer -= interval;
      steps++;
      if (!this.game.move(this.shiftDir)) break;
    }
    if (steps >= 20) this.arrTimer = 0;
  }
}
