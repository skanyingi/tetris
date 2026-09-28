/**
 * Tetromino definitions and the Super Rotation System (SRS) kick tables.
 *
 * Rotation states are stored as cell offsets inside the piece's bounding box,
 * with state 0 = spawn, 1 = right (CW), 2 = 180, 3 = left (CCW). Storing real
 * coordinates per state — rather than rotating matrices at runtime — keeps the
 * rotation path cheap and makes each state directly inspectable.
 *
 * The spawn offset places the piece so it matches guideline behaviour: the main
 * body of a piece appears on the first visible row, with its "nose" in the
 * buffer above.
 */

export const SHAPES = {
  I: {
    size: 4,
    spawnX: 3,
    spawnY: 1,
    states: [
      [[0, 1], [1, 1], [2, 1], [3, 1]],
      [[2, 0], [2, 1], [2, 2], [2, 3]],
      [[0, 2], [1, 2], [2, 2], [3, 2]],
      [[1, 0], [1, 1], [1, 2], [1, 3]],
    ],
  },
  O: {
    size: 2,
    spawnX: 4,
    spawnY: 2,
    // The O piece is rotationally symmetric: it has four nominal states that
    // are geometrically identical, and it never uses kick offsets.
    states: [
      [[0, 0], [1, 0], [0, 1], [1, 1]],
      [[0, 0], [1, 0], [0, 1], [1, 1]],
      [[0, 0], [1, 0], [0, 1], [1, 1]],
      [[0, 0], [1, 0], [0, 1], [1, 1]],
    ],
  },
  T: {
    size: 3,
    spawnX: 3,
    spawnY: 1,
    states: [
      [[1, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [1, 1], [2, 1], [1, 2]],
      [[0, 1], [1, 1], [2, 1], [1, 2]],
      [[1, 0], [0, 1], [1, 1], [1, 2]],
    ],
  },
  S: {
    size: 3,
    spawnX: 3,
    spawnY: 1,
    states: [
      [[1, 0], [2, 0], [0, 1], [1, 1]],
      [[1, 0], [1, 1], [2, 1], [2, 2]],
      [[1, 1], [2, 1], [0, 2], [1, 2]],
      [[0, 0], [0, 1], [1, 1], [1, 2]],
    ],
  },
  Z: {
    size: 3,
    spawnX: 3,
    spawnY: 1,
    states: [
      [[0, 0], [1, 0], [1, 1], [2, 1]],
      [[2, 0], [1, 1], [2, 1], [1, 2]],
      [[0, 1], [1, 1], [1, 2], [2, 2]],
      [[1, 0], [0, 1], [1, 1], [0, 2]],
    ],
  },
  J: {
    size: 3,
    spawnX: 3,
    spawnY: 1,
    states: [
      [[0, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [2, 0], [1, 1], [1, 2]],
      [[0, 1], [1, 1], [2, 1], [2, 2]],
      [[1, 0], [1, 1], [0, 2], [1, 2]],
    ],
  },
  L: {
    size: 3,
    spawnX: 3,
    spawnY: 1,
    states: [
      [[2, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [1, 1], [1, 2], [2, 2]],
      [[0, 1], [1, 1], [2, 1], [0, 2]],
      [[0, 0], [1, 0], [1, 1], [1, 2]],
    ],
  },
};

/** Order used by the 7-bag randomiser. */
export const TYPES = Object.keys(SHAPES);

/**
 * SRS wall-kick offsets, published with +Y pointing *up*. Our board's Y points
 * *down*, so `rotate()` negates the dy component when it applies these.
 *
 * Each entry is keyed by "from>to" and holds up to 5 candidate offsets that are
 * tried in order until one lands the piece without a collision. The first
 * offset is always (0, 0), so a rotation with room to turn never shifts.
 */
export const KICKS_JLSTZ = {
  '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};

/** The I piece uses its own kick table because it is flush with the walls. */
export const KICKS_I = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

/**
 * Offsets for the optional 180 rotation. The published SRS tables only cover
 * quarter turns, so 0<->2 and 1<->3 use this community-standard extension: try
 * a small vertical lift and horizontal nudges. Same +Y up convention as above.
 */
export const KICKS_180 = {
  '0>2': [[0, 0], [0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0]],
  '2>0': [[0, 0], [0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0]],
  '1>3': [[0, 0], [0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0]],
  '3>1': [[0, 0], [0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0]],
};

/**
 * Returns the kick candidates for a rotation, or `null` when the rotation needs
 * none (the O piece, or a no-op).
 */
export function kicksFor(type, from, to) {
  if (from === to) return null;
  const delta = (((to - from) % 4) + 4) % 4;
  if (delta === 2) return KICKS_180[`${from}>${to}`] || null;
  if (type === 'O') return null;
  const table = type === 'I' ? KICKS_I : KICKS_JLSTZ;
  return table[`${from}>${to}`] || null;
}

/** Absolute cells of a piece: bounding-box offsets plus its board position. */
export function cellsOf(piece) {
  const shape = SHAPES[piece.type];
  return shape.states[piece.rotation].map(([cx, cy]) => [piece.x + cx, piece.y + cy]);
}
