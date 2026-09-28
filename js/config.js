/**
 * Central tuning values: board geometry, palette, gravity curve, scoring, input
 * defaults. Everything that a designer might want to tweak lives here so the
 * gameplay modules stay free of magic numbers.
 */

/** Visible playfield width. */
export const COLS = 10;

/** Visible playfield height. */
export const ROWS = 20;

/**
 * Rows stored *above* the visible field. Pieces spawn in here, so a stack that
 * reaches the ceiling has somewhere to live before the game ends.
 */
export const BUFFER_ROWS = 2;

/** Total rows in the backing matrix. */
export const TOTAL_ROWS = ROWS + BUFFER_ROWS;

/** First matrix row that is actually drawn. */
export const VISIBLE_START = BUFFER_ROWS;

/** Neon palette. Index 0 is "empty" and is never drawn as a piece. */
export const COLORS = {
  I: '#22d3ee',
  O: '#facc15',
  T: '#a855f7',
  S: '#22c55e',
  Z: '#f43f5e',
  J: '#3b82f6',
  L: '#fb923c',
};

/** Background tints for the playfield. */
export const THEME = {
  void: '#05070e',
  grid: 'rgba(148, 197, 255, 0.07)',
  gridStrong: 'rgba(148, 197, 255, 0.14)',
  wall: 'rgba(148, 197, 255, 0.22)',
  ghost: 'rgba(226, 240, 255, 0.14)',
  flash: '#ffffff',
};

/** Fastest legal descent: one row per animation frame. */
export const MIN_GRAVITY_MS = 1000 / 60;

/**
 * Guideline gravity curve, returning the milliseconds between natural downward
 * steps at a given level.
 *
 * The guideline formula is `Time = (0.8 - (level - 1) * 0.007) ^ (level - 1)`
 * seconds, which runs from 1s per row at level 1 down to under a millisecond by
 * level 20. Past level 13 the curve is faster than the display can show, so it
 * is floored at one row per frame — the same ceiling real implementations hit.
 */
export function gravityMs(level) {
  const l = Math.max(1, level);
  const seconds = Math.pow(0.8 - (l - 1) * 0.007, l - 1);
  return Math.max(seconds * 1000, MIN_GRAVITY_MS);
}

/** Lines needed to advance one level. */
export const LINES_PER_LEVEL = 10;

/** Base score by number of lines cleared, multiplied by level. */
export const LINE_SCORES = { 1: 100, 2: 300, 3: 500, 4: 800 };

/** Perfect-clear bonus by lines cleared, multiplied by level. */
export const PERFECT_CLEAR_SCORES = { 1: 800, 2: 1200, 3: 1800, 4: 2000 };

/** Points per cell dropped. */
export const SOFT_DROP_POINTS = 1;
export const HARD_DROP_POINTS = 2;

/** Combo bonus is `COMBO_POINTS * comboCount * level`. */
export const COMBO_POINTS = 50;

/** Consecutive tetrises multiply the line-clear score. */
export const BACK_TO_BACK_MULTIPLIER = 1.5;

/** Grace period on landing before the piece locks, in ms. */
export const LOCK_DELAY_MS = 500;

/** How many times the lock delay may be refreshed by moving/rotating. */
export const MAX_LOCK_RESETS = 15;

/** Soft drop repeats this fast while the down key is held. */
export const SOFT_DROP_INTERVAL_MS = 25;

/** Total length of the line-clear flash + collapse animation. */
export const CLEAR_ANIMATION_MS = 260;

export const DEFAULT_SETTINGS = {
  sound: false,
  ghost: true,
  grid: true,
  das: 150,
  arr: 33,
  keybindings: {
    left: 'ArrowLeft',
    right: 'ArrowRight',
    softDrop: 'ArrowDown',
    rotateCW: 'ArrowUp',
    rotateCCW: 'KeyZ',
    rotate180: 'KeyA',
    hardDrop: 'Space',
    pause: 'KeyP',
  },
};

/** Human-readable labels for the rebindable actions. */
export const ACTION_LABELS = {
  left: 'Move left',
  right: 'Move right',
  softDrop: 'Soft drop',
  rotateCW: 'Rotate CW',
  rotateCCW: 'Rotate CCW',
  rotate180: 'Rotate 180',
  hardDrop: 'Hard drop',
  pause: 'Pause',
};

