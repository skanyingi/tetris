import { COLS, TOTAL_ROWS, VISIBLE_START } from './config.js';
import { cellsOf } from './pieces.js';

/**
 * The playfield matrix and everything that needs to know about occupancy.
 *
 * Cells live in a flat Uint8Array of `COLS * TOTAL_ROWS`. The value 0 means
 * empty; anything else is a 1-based index into PIECE_KEYS so the renderer can
 * look up a colour without a second lookup table.
 */
export class Board {
  constructor() {
    this.cols = COLS;
    this.rows = TOTAL_ROWS;
    this.cells = new Uint8Array(COLS * TOTAL_ROWS);
  }

  /** Empties the whole matrix, including the spawn buffer. */
  clear() {
    this.cells.fill(0);
  }

  /** Writes a cell, ignoring out-of-bounds writes. */
  set(x, y, value) {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return;
    this.cells[y * this.cols + x] = value;
  }

  /**
   * True when the piece would overlap a wall, the floor, or a locked cell.
   * Cells above the ceiling are allowed through — that is the spawn buffer, and
   * a piece may legitimately live there.
   */
  collides(piece) {
    for (const [x, y] of cellsOf(piece)) {
      if (x < 0 || x >= this.cols || y >= this.rows) return true;
      if (y >= 0 && this.cells[y * this.cols + x] !== 0) return true;
    }
    return false;
  }

  /** Writes the piece's cells into the matrix. */
  lock(piece, value) {
    for (const [x, y] of cellsOf(piece)) this.set(x, y, value);
  }

  /** True when the piece has nowhere left to go downward. */
  isGrounded(piece) {
    return this.collides({ ...piece, y: piece.y + 1 });
  }

  /** Row indices that are completely filled, in ascending order. */
  fullRows() {
    const rows = [];
    for (let y = 0; y < this.rows; y++) {
      let filled = true;
      for (let x = 0; x < this.cols; x++) {
        if (this.cells[y * this.cols + x] === 0) {
          filled = false;
          break;
        }
      }
      if (filled) rows.push(y);
    }
    return rows;
  }

  /**
   * Removes the given rows and drops everything above them down, preserving
   * column order. Returns the number of rows removed.
   */
  clearRows(rows) {
    if (rows.length === 0) return 0;
    const doomed = new Set(rows);
    // Survivors are packed to the bottom of a fresh matrix, whose top stays
    // zeroed, so the gap each removed row leaves is filled with empty space.
    const next = new Uint8Array(this.cols * this.rows);
    let write = rows.length * this.cols;
    for (let y = 0; y < this.rows; y++) {
      if (doomed.has(y)) continue;
      next.set(this.cells.subarray(y * this.cols, (y + 1) * this.cols), write);
      write += this.cols;
    }
    this.cells.set(next);
    return rows.length;
  }

  /** True when no cell is filled — used for the perfect-clear bonus. */
  isEmpty() {
    for (let i = 0; i < this.cells.length; i++) {
      if (this.cells[i] !== 0) return false;
    }
    return true;
  }

  /**
   * True when every cell of the piece sits inside the spawn buffer, which is
   * the "lock out" game-over condition.
   */
  isEntirelyAboveField(piece) {
    return cellsOf(piece).every(([, y]) => y < VISIBLE_START);
  }
}
