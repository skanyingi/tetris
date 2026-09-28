import {
  BACK_TO_BACK_MULTIPLIER,
  CLEAR_ANIMATION_MS,
  COLORS,
  COMBO_POINTS,
  HARD_DROP_POINTS,
  LINES_PER_LEVEL,
  LINE_SCORES,
  LOCK_DELAY_MS,
  MAX_LOCK_RESETS,
  PERFECT_CLEAR_SCORES,
  SOFT_DROP_INTERVAL_MS,
  SOFT_DROP_POINTS,
  gravityMs,
} from './config.js';
import { SHAPES, TYPES, cellsOf, kicksFor } from './pieces.js';
import { Board } from './board.js';

/** Cell values are 1-based so 0 can mean "empty". */
export const CELL_VALUE = { I: 1, O: 2, T: 3, S: 4, Z: 5, J: 6, L: 7 };

/** Upper bound on gravity steps per frame, so a long stall cannot flood. */
const MAX_GRAVITY_CATCHUP = 20;

/** Reverse lookup so the renderer can colour a cell value. */
export const CELL_COLORS = [null, ...Object.values(COLORS)];

/** Pieces are dealt in bags of seven so droughts are bounded. */
class SevenBag {
  constructor() {
    this.queue = [];
  }

  /** Peeks the nth upcoming piece without consuming anything. */
  peek(n) {
    while (this.queue.length <= n) this.#refill();
    return this.queue[n];
  }

  shift() {
    this.peek(0);
    return this.queue.shift();
  }

  #refill() {
    const bag = [...TYPES];
    // Fisher-Yates. Math.random is plenty here: piece order is a gameplay
    // convenience, not a security concern.
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    this.queue.push(...bag);
  }
}

export class Game {
  /**
   * @param {(event: {type: string, [key: string]: unknown}) => void} onEvent
   *   Sink for audio and presentation events. The game itself never touches
   *   the DOM, which keeps it trivially testable.
   */
  constructor(onEvent = () => {}) {
    this.onEvent = onEvent;
    this.board = new Board();
    this.bag = new SevenBag();
    this.settings = { ghost: true };
    this.reset();
    this.state = 'ready';
  }

  reset() {
    this.active = null;
    this.softDropping = false;
    this.gravityAcc = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.clearTimer = 0;
    this.pendingRows = [];
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.combo = -1;
    this.backToBack = false;
    this.playedMs = 0;
    this.stats = { singles: 0, doubles: 0, triples: 0, tetrises: 0, pieces: 0 };
  }

  /** Applies persisted settings that affect gameplay or presentation. */
  applySettings(settings) {
    this.settings = {
      ghost: settings.ghost !== false,
      grid: settings.grid !== false,
    };
  }

  /** Milliseconds between downward steps, honouring soft drop. */
  gravityInterval() {
    const natural = gravityMs(this.level);
    return this.softDropping ? Math.min(natural, SOFT_DROP_INTERVAL_MS) : natural;
  }

  newGame() {
    this.board.clear();
    this.bag = new SevenBag();
    this.reset();
    this.state = 'playing';
    this.#spawn();
  }

  /** Returns to the idle menu state without clearing the board. */
  toMenu() {
    this.state = 'ready';
    this.active = null;
    this.softDropping = false;
  }

  /**
   * Fills the lower half of the board with a plausible-looking stack so the
   * menu screen is not sitting in front of an empty grid. Purely cosmetic.
   */
  seedAttract() {
    this.board.clear();
    const { cols, rows } = this.board;
    for (let y = Math.floor(rows / 2); y < rows; y++) {
      // Ragged skyline, thickening toward the floor.
      const chance = 0.35 + 0.5 * ((y - rows / 2) / (rows / 2));
      for (let x = 0; x < cols; x++) {
        if (Math.random() < chance) this.board.set(x, y, 1 + Math.floor(Math.random() * 7));
      }
    }
    // Punch a few holes so it reads as a game in progress, not a solid mass.
    for (let i = 0; i < 8; i++) {
      this.board.set(
        Math.floor(Math.random() * cols),
        Math.floor(rows / 2) + Math.floor(Math.random() * (rows / 2)),
        0,
      );
    }
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.softDropping = false;
    this.onEvent({ type: 'pause' });
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    // Drop the accumulated wall-clock time so the piece does not lurch.
    this.gravityAcc = 0;
    this.onEvent({ type: 'resume' });
  }

  togglePause() {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  // ---------------------------------------------------------------- input ---

  /** Holding down enables fast repeated descent until released. */
  setSoftDrop(active) {
    this.softDropping = active && this.canAct();
  }

  move(dx) {
    if (!this.canAct()) return false;
    const moved = { ...this.active, x: this.active.x + dx };
    if (this.board.collides(moved)) return false;
    this.active = moved;
    this.#onPieceMoved();
    this.onEvent({ type: 'move' });
    return true;
  }

  /**
   * Rotates the active piece one step in `direction` (+1 clockwise, -1
   * counter-clockwise, 2 for 180), trying each SRS kick in order until the
   * piece lands somewhere legal. Returns true when the rotation succeeded.
   */
  rotate(direction) {
    if (!this.canAct()) return false;
    const from = this.active.rotation;
    const to = (((from + direction) % 4) + 4) % 4;
    if (to === from) return false;

    // A 180 turn is expressed as two quarter steps so the kick table can map
    // it, but it is applied in one move.
    const candidates = kicksFor(this.active.type, from, to) || [[0, 0]];
    for (const [dx, dy] of candidates) {
      // Kick tables are published with +Y up; this board's Y axis points down.
      const candidate = {
        ...this.active,
        x: this.active.x + dx,
        y: this.active.y - dy,
        rotation: to,
      };
      if (!this.board.collides(candidate)) {
        this.active = candidate;
        this.#onPieceMoved();
        this.onEvent({ type: 'rotate' });
        return true;
      }
    }
    this.onEvent({ type: 'rotateBlocked' });
    return false;
  }

  /** Drops straight to the resting row and scores the distance. */
  hardDrop() {
    if (!this.canAct()) return false;
    let distance = 0;
    while (!this.board.collides({ ...this.active, y: this.active.y + 1 })) {
      this.active = { ...this.active, y: this.active.y + 1 };
      distance++;
    }
    this.score += distance * HARD_DROP_POINTS;
    this.onEvent({
      type: 'hardDrop',
      distance,
      cells: cellsOf(this.active),
      pieceType: this.active.type,
    });
    this.lockPiece();
    return true;
  }

  // ----------------------------------------------------------------- loop ---

  /**
   * Advances the game by `dt` milliseconds.
   *
   * Gravity runs on an accumulator rather than its own timer, so the descent
   * speed is independent of frame rate and leftover time carries between
   * frames instead of being thrown away.
   */
  update(dt) {
    if (this.state !== 'playing') return;
    this.playedMs += dt;

    if (this.isClearing()) {
      this.clearTimer -= dt;
      if (this.clearTimer <= 0) this.#finishLineClear();
      return;
    }
    if (!this.active) return;

    const interval = this.gravityInterval();
    this.gravityAcc += dt;
    let steps = 0;
    while (this.gravityAcc >= interval && steps < MAX_GRAVITY_CATCHUP) {
      this.gravityAcc -= interval;
      steps++;
      if (!this.#gravityStep()) break;
    }
    // If we exhausted the catch-up budget the tab was likely backgrounded;
    // discard the backlog instead of fast-forwarding the whole board.
    if (steps >= MAX_GRAVITY_CATCHUP) this.gravityAcc = 0;

    if (this.board.isGrounded(this.active)) {
      this.lockTimer += dt;
      // The lock delay gives the player a moment to slide or rotate a piece
      // into a better slot once it has landed.
      if (this.lockTimer >= LOCK_DELAY_MS) this.lockPiece();
    } else {
      this.lockTimer = 0;
      this.lockResets = 0;
    }
  }

  // -------------------------------------------------------------- helpers ---

  isClearing() {
    return this.pendingRows.length > 0;
  }

  canAct() {
    return this.state === 'playing' && this.active !== null && !this.isClearing();
  }

  /** Board Y where the active piece would come to rest. */
  ghostY() {
    if (!this.active) return 0;
    let y = this.active.y;
    while (!this.board.collides({ ...this.active, y: y + 1 })) y++;
    return y;
  }

  /** Cells of the active piece, for rendering. */
  activeCells() {
    return this.active ? cellsOf(this.active) : [];
  }

  /**
   * Moving or rotating refreshes the lock delay so the player can keep
   * adjusting, but the budget is finite so a piece can never be held forever.
   */
  #onPieceMoved() {
    this.gravityAcc = 0;
    if (this.lockResets < MAX_LOCK_RESETS) {
      this.lockTimer = 0;
      this.lockResets++;
    }
  }

  #gravityStep() {
    if (this.board.collides({ ...this.active, y: this.active.y + 1 })) {
      this.softDropping = false;
      return false;
    }
    this.active = { ...this.active, y: this.active.y + 1 };
    if (this.softDropping) this.score += SOFT_DROP_POINTS;
    return true;
  }

  #placeAt(type) {
    const shape = SHAPES[type];
    return { type, rotation: 0, x: shape.spawnX, y: shape.spawnY };
  }

  /**
   * Deals the next piece. Returns false when it has nowhere to go, which is
   * the "block out" game-over condition.
   */
  #spawn() {
    const piece = this.#placeAt(this.bag.shift());
    this.active = piece;
    this.gravityAcc = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.stats.pieces++;
    if (this.board.collides(piece)) {
      this.#endGame('blockOut');
      return false;
    }
    return true;
  }

  lockPiece() {
    if (!this.active || this.isClearing()) return;
    const piece = this.active;
    this.board.lock(piece, CELL_VALUE[piece.type]);
    this.onEvent({
      type: 'lock',
      cells: cellsOf(piece),
      pieceType: piece.type,
    });

    // Lock out: the piece came to rest entirely inside the spawn buffer.
    if (this.board.isEntirelyAboveField(piece)) {
      this.#endGame('lockOut');
      return;
    }

    this.active = null;
    this.softDropping = false;

    const rows = this.board.fullRows();
    if (rows.length > 0) {
      this.pendingRows = rows;
      this.clearTimer = CLEAR_ANIMATION_MS;
      this.onEvent({ type: 'clearStart', rows, count: rows.length });
    } else {
      // A lock with no clear ends any combo streak.
      this.combo = -1;
      this.onEvent({ type: 'combo', value: 0 });
      this.#spawn();
    }
  }

  /**
   * Applies the pending clear, awards score, then deals the next piece. The
   * board has already been shown mid-animation by this point, so the mutation
   * lines up with what the player watched.
   */
  #finishLineClear() {
    const rows = this.pendingRows;
    const count = rows.length;
    this.pendingRows = [];
    this.clearTimer = 0;

    this.board.clearRows(rows);
    this.lines += count;
    this.combo++;

    const previousLevel = this.level;
    this.level = Math.floor(this.lines / LINES_PER_LEVEL) + 1;

    // A "difficult" clear in single-player Tetris is a tetris and nothing else,
    // so the bonus needs a tetris on both sides: the streak is armed only by a
    // tetris, and a clear of any other size ends it.
    const backToBack = this.backToBack && count === 4;
    this.backToBack = count === 4;

    let gained = (LINE_SCORES[count] || 0) * this.level;
    if (backToBack) gained = Math.floor(gained * BACK_TO_BACK_MULTIPLIER);
    // The first clear of a chain has combo 0 and scores nothing extra.
    if (this.combo > 0) gained += COMBO_POINTS * this.combo * this.level;

    if (this.board.isEmpty()) {
      gained += (PERFECT_CLEAR_SCORES[count] || 0) * this.level;
    }
    const perfectClear = this.board.isEmpty();

    this.score += gained;
    this.#recordClearStat(count);
    this.onEvent({ type: 'combo', value: Math.max(0, this.combo) });

    this.onEvent({
      type: 'clear',
      count,
      gained,
      combo: Math.max(0, this.combo),
      backToBack,
      perfectClear,
      rows,
    });

    if (this.level > previousLevel) {
      this.onEvent({ type: 'levelUp', level: this.level });
    }

    this.#spawn();
  }

  #recordClearStat(count) {
    if (count === 1) this.stats.singles++;
    else if (count === 2) this.stats.doubles++;
    else if (count === 3) this.stats.triples++;
    else if (count === 4) this.stats.tetrises++;
  }

  #endGame(reason) {
    this.state = 'gameover';
    this.active = null;
    this.softDropping = false;
    this.onEvent({ type: 'gameOver', reason, summary: this.summary() });
  }

  /** Snapshot for the game-over screen. */
  summary() {
    return {
      score: this.score,
      lines: this.lines,
      level: this.level,
      pieces: this.stats.pieces,
      singles: this.stats.singles,
      doubles: this.stats.doubles,
      triples: this.stats.triples,
      tetrises: this.stats.tetrises,
      durationMs: Math.round(this.playedMs),
    };
  }
}
