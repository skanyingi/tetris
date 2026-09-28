import { CLEAR_ANIMATION_MS, COLS, ROWS, THEME, VISIBLE_START } from './config.js';
import { cellsOf } from './pieces.js';
import { CELL_COLORS, CELL_VALUE } from './game.js';

/** Fraction of the clear animation spent on the white flash. */
const FLASH_SHARE = 0.55;

/** Colour of a piece type, from the shared cell-value map. */
const colorOf = (type) => CELL_COLORS[CELL_VALUE[type]];

/** Traces a rounded rectangle. Hand-rolled for browsers without roundRect. */
function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Shortest spin-up path so a fixed frame budget always looks the same. */
function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

export class Renderer {
  constructor(canvas, { reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.cell = 0;
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.particles = [];
    this.shake = 0;
    this.time = 0;
    this.reducedMotion = reducedMotion;
    this.game = null;
    this.collapse = 0;
    this.flash = false;
  }

  /**
   * Matches the backing store to the element's CSS box and the device pixel
   * ratio, so the field stays sharp on high-density displays and after a resize
   * or zoom change.
   *
   * The cell size is taken from whichever dimension is tighter and the field is
   * centred, so a distorted box letterboxes instead of drawing off the canvas.
   */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width * this.dpr);
    const height = Math.round(rect.height * this.dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.width = rect.width;
    this.height = rect.height;
    this.cell = Math.min(rect.width / COLS, rect.height / ROWS);
    this.offsetX = (rect.width - COLS * this.cell) / 2;
    this.offsetY = (rect.height - ROWS * this.cell) / 2;
  }

  /** Converts a matrix row to its drawn row, honouring the clear animation. */
  #visualRow(row) {
    if (this.collapse === 0) return row - VISIBLE_START;
    let clearedBelow = 0;
    for (const cleared of this.game.pendingRows) {
      if (cleared > row) clearedBelow++;
    }
    // Rows above a cleared row slide down to close the gap, ending exactly
    // where the real mutation will place them.
    return row - VISIBLE_START + clearedBelow * this.collapse;
  }

  /** A filled block with a beveled, faintly lit face. */
  #drawBlock(col, row, color, { alpha = 1, glow = 0, inset = 0.06 } = {}) {
    const size = this.cell;
    const x = this.offsetX + col * size;
    const y = this.offsetY + row * size;
    const pad = size * inset;
    const ctx = this.ctx;
    const w = size - pad * 2;
    const h = size - pad * 2;

    ctx.globalAlpha = alpha;
    if (glow > 0) {
      ctx.shadowColor = color;
      ctx.shadowBlur = glow;
    }
    ctx.fillStyle = color;
    roundedRect(ctx, x + pad, y + pad, w, h, size * 0.16);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Cheap bevel: a light inner edge top-left, a dark one bottom-right. This
    // gives the blocks depth without a per-cell shadow blur.
    const lip = Math.max(1, size * 0.09);
    ctx.globalAlpha = alpha * 0.5;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillRect(x + pad + lip, y + pad + lip, w - lip * 2, lip);
    ctx.fillRect(x + pad + lip, y + pad + lip, lip, h - lip * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
    ctx.fillRect(x + pad + lip, y + pad + h - lip * 2, w - lip * 2, lip);
    ctx.fillRect(x + pad + w - lip * 2, y + pad + lip, lip, h - lip * 2);
    ctx.globalAlpha = 1;
  }

  /** A hollow outline marking where the piece will land. */
  #drawGhost(col, row) {
    const size = this.cell;
    const pad = size * 0.08;
    const x = this.offsetX + col * size;
    const y = this.offsetY + row * size;
    const ctx = this.ctx;
    ctx.globalAlpha = 1;
    ctx.fillStyle = THEME.ghost;
    roundedRect(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, size * 0.16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(226, 240, 255, 0.4)';
    ctx.lineWidth = Math.max(1, size * 0.05);
    ctx.stroke();
  }

  #drawBackdrop() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const size = this.cell;
    const left = this.offsetX;
    const top = this.offsetY;
    const fieldW = COLS * size;
    const fieldH = ROWS * size;

    ctx.fillStyle = THEME.void;
    ctx.fillRect(0, 0, w, h);

    if (this.game?.settings.grid !== false) {
      ctx.strokeStyle = THEME.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 1; x < COLS; x++) {
        const px = Math.round(left + x * size) + 0.5;
        ctx.moveTo(px, top);
        ctx.lineTo(px, top + fieldH);
      }
      for (let y = 1; y < ROWS; y++) {
        const py = Math.round(top + y * size) + 0.5;
        ctx.moveTo(left, py);
        ctx.lineTo(left + fieldW, py);
      }
      ctx.stroke();
    }

    // Bright wall around the well, so the play area reads as a container.
    ctx.strokeStyle = THEME.wall;
    ctx.lineWidth = 2;
    ctx.strokeRect(left + 1, top + 1, fieldW - 2, fieldH - 2);
  }

  #drawCells() {
    const { board } = this.game;
    for (let row = 0; row < board.rows; row++) {
      const visual = this.#visualRow(row);
      // Skip rows scrolled out of view or about to be removed.
      if (visual < -1 || visual > ROWS) continue;
      for (let col = 0; col < COLS; col++) {
        const value = board.cells[row * COLS + col];
        if (value === 0) continue;
        this.#drawBlock(col, visual, CELL_COLORS[value]);
      }
    }
    this.ctx.globalAlpha = 1;
  }

  /** The white contraction that sells a line clear. */
  #drawClearFlash() {
    if (!this.flash) return;
    const ctx = this.ctx;
    const size = this.cell;
    const fieldW = COLS * size;
    // The bar contracts over the collapse phase; at the very start it is full
    // width and fully white.
    const scale = 1 - this.collapse * 0.98;
    const barWidth = fieldW * scale;
    const centre = this.offsetX + fieldW / 2;
    for (const row of this.game.pendingRows) {
      const visual = this.#visualRow(row);
      if (visual < -1 || visual > ROWS) continue;
      const y = this.offsetY + visual * size;
      ctx.save();
      ctx.shadowColor = THEME.flash;
      ctx.shadowBlur = size * 0.8;
      ctx.fillStyle = THEME.flash;
      ctx.globalAlpha = 1 - this.collapse * 0.5;
      ctx.fillRect(centre - barWidth / 2, y + size * 0.08, barWidth, size * 0.84);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  #drawActive() {
    const game = this.game;
    if (!game.active || game.isClearing()) return;
    const color = colorOf(game.active.type);

    if (game.settings.ghost !== false) {
      const ghostY = game.ghostY();
      if (ghostY !== game.active.y) {
        const ghost = { ...game.active, y: ghostY };
        for (const [x, y] of cellsOf(ghost)) {
          if (y < VISIBLE_START) continue;
          this.#drawGhost(x, y - VISIBLE_START);
        }
      }
    }

    const glow = this.reducedMotion ? 0 : this.cell * 0.55;
    for (const [x, y] of game.activeCells()) {
      if (y < VISIBLE_START) continue;
      this.#drawBlock(x, y - VISIBLE_START, color, { glow });
    }
  }

  // ----------------------------------------------------------- particles ---

  /** Scatters sparks in cell coordinates, from a row or a cell list. */
  #burst(cells, color, count) {
    if (this.reducedMotion) return;
    for (let i = 0; i < count; i++) {
      const [cx, cy] = cells[i % cells.length];
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 7;
      this.particles.push({
        x: cx + 0.5,
        y: cy + 0.5,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5,
        life: 0.45 + Math.random() * 0.5,
        age: 0,
        size: 0.06 + Math.random() * 0.12,
        color,
      });
    }
  }

  addShake(amount) {
    if (this.reducedMotion) return;
    this.shake = Math.min(14, this.shake + amount);
  }

  /** Fans sparks out from the bottom edge of a hard-dropped piece. */
  hardDrop(cells, color, distance) {
    if (!cells?.length) return;
    const lowest = new Map();
    for (const [x, y] of cells) {
      if (!lowest.has(x) || y > lowest.get(x)) lowest.set(x, y);
    }
    this.#burst(
      [...lowest.entries()].map(([x, y]) => [x, y - VISIBLE_START]),
      color,
      8 + Math.min(24, distance * 2),
    );
    this.addShake(2 + Math.min(5, distance * 0.25));
  }

  /** Shakes a locked piece's resting row. */
  lock(cells, color) {
    this.#burst(
      cells.map(([x, y]) => [x, y - VISIBLE_START]),
      color,
      4,
    );
    this.addShake(1);
  }

  lineClear(rows) {
    const cells = [];
    for (const row of rows) {
      for (let x = 0; x < COLS; x++) cells.push([x, row - VISIBLE_START]);
    }
    this.#burst(cells, THEME.flash, 10 * rows.length);
    this.addShake(3 + rows.length * 1.5);
  }

  #updateParticles(dt) {
    const seconds = dt / 1000;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += seconds;
      if (p.age >= p.life) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * seconds;
      p.y += p.vy * seconds;
      p.vy += 16 * seconds; // gravity, in cells per second squared
    }
  }

  #drawParticles() {
    if (this.particles.length === 0) return;
    const ctx = this.ctx;
    const size = this.cell;
    for (const p of this.particles) {
      const t = p.age / p.life;
      const half = p.size * size;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = p.color;
      ctx.fillRect(
        this.offsetX + p.x * size - half,
        this.offsetY + p.y * size - half,
        half * 2,
        half * 2,
      );
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- loop ---

  render(game, dt) {
    this.game = game;

    if (this.canvas.width === 0) this.resize();

    // Derive the clear animation's two phases from the game's countdown. The
    // renderer never mutates state, so pausing simply freezes the effect.
    const clearing = game.isClearing();
    const progress = clearing ? 1 - game.clearTimer / CLEAR_ANIMATION_MS : 0;
    this.flash = clearing && progress < FLASH_SHARE;
    const raw = clearing ? (progress - FLASH_SHARE) / (1 - FLASH_SHARE) : 0;
    this.collapse = clearing ? easeOutCubic(Math.min(1, Math.max(0, raw))) : 0;

    this.#updateParticles(dt);
    this.time += dt / 1000;
    this.shake *= Math.exp(-dt / 110);
    if (this.shake < 0.05) this.shake = 0;

    const ctx = this.ctx;
    // Base transform puts drawing in CSS pixels; the shake is layered on top so
    // it moves the playfield but not the backdrop behind it.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.#drawBackdrop();

    ctx.save();
    if (this.shake > 0) {
      // Offsets come from a running clock rather than a random call, so the
      // shake settles instead of buzzing.
      ctx.translate(
        Math.sin(this.time * 130) * this.shake,
        Math.cos(this.time * 170) * this.shake,
      );
    }
    this.#drawCells();
    this.#drawActive();
    this.#drawClearFlash();
    this.#drawParticles();
    ctx.restore();
  }
}
