/**
 * Logic tests for the pure game modules. Runs on plain Node with no test
 * framework: `npm test`.
 *
 * The rotation states in pieces.js are hand-authored, so they are checked
 * against an independent geometric rotation rather than against themselves.
 * That is the check most likely to catch a real SRS mistake.
 */
import { Board } from '../js/board.js';
import {
  COLS,
  COMBO_POINTS,
  DEFAULT_SETTINGS,
  LINE_SCORES,
  MIN_GRAVITY_MS,
  PERFECT_CLEAR_SCORES,
  TOTAL_ROWS,
  VISIBLE_START,
  gravityMs,
} from '../js/config.js';
import { Game } from '../js/game.js';
import { KICKS_180, KICKS_I, KICKS_JLSTZ, SHAPES, TYPES, cellsOf, kicksFor } from '../js/pieces.js';

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function equal(name, actual, expected) {
  check(name, Object.is(actual, expected), `expected ${expected}, got ${actual}`);
}

function deepEqual(name, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  check(name, a === b, `expected ${b}, got ${a}`);
}

/** Sorted cell set, as a comparable string. */
const cellKey = (cells) => cells.map(([x, y]) => `${x},${y}`).sort().join(' ');

/** Rotates a cell set 90 degrees clockwise inside a size x size box. */
function rotateCW(cells, size) {
  return cells.map(([x, y]) => [size - 1 - y, x]);
}

// ------------------------------------------------------- piece definitions ---

function testShapes() {
  for (const type of TYPES) {
    const shape = SHAPES[type];
    check(`${type} exists`, Boolean(shape));
    equal(`${type} has 4 rotation states`, shape.states.length, 4);

    shape.states.forEach((state, i) => {
      equal(`${type} state ${i} has 4 cells`, state.length, 4);
      equal(
        `${type} state ${i} cells are distinct`,
        new Set(state.map((c) => c.join(','))).size,
        4,
      );
      for (const [x, y] of state) {
        check(
          `${type} state ${i} cell ${x},${y} inside box`,
          x >= 0 && x < shape.size && y >= 0 && y < shape.size,
        );
      }
    });

    // Each successive state must be the previous one turned a quarter turn.
    // This validates all 28 hand-written states against a derived one.
    for (let i = 0; i < 4; i++) {
      const expected = rotateCW(shape.states[i], shape.size);
      equal(
        `${type} state ${(i + 1) % 4} is state ${i} rotated clockwise`,
        cellKey(expected),
        cellKey(shape.states[(i + 1) % 4]),
      );
    }
  }
}

function testKickTables() {
  const keys = ['0>1', '1>0', '1>2', '2>1', '2>3', '3>2', '3>0', '0>3'];
  for (const [name, table] of [['JLSTZ', KICKS_JLSTZ], ['I', KICKS_I]]) {
    for (const k of keys) {
      const row = table[k];
      check(`${name} table has ${k}`, Array.isArray(row) && row.length === 5);
      check(`${name} ${k} starts at the origin`, row[0][0] === 0 && row[0][1] === 0);
      for (const [dx, dy] of row) {
        check(`${name} ${k} entry is a number pair`, Number.isFinite(dx) && Number.isFinite(dy));
      }
    }
  }

  for (const k of ['0>2', '2>0', '1>3', '3>1']) {
    check(`180 table has ${k}`, Array.isArray(KICKS_180[k]) && KICKS_180[k].length > 0);
  }

  equal('O never kicks', kicksFor('O', 0, 1), null);
  equal('I uses the I table', kicksFor('I', 0, 1), KICKS_I['0>1']);
  equal('T uses the JLSTZ table', kicksFor('T', 0, 1), KICKS_JLSTZ['0>1']);
  equal('0 to 2 is a 180 turn', kicksFor('T', 0, 2), KICKS_180['0>2']);
  equal('1 to 3 is a 180 turn', kicksFor('T', 1, 3), KICKS_180['1>3']);
  equal('2 to 0 is a 180 turn', kicksFor('T', 2, 0), KICKS_180['2>0']);
  equal('no kicks for a no-op', kicksFor('T', 2, 2), null);
}

// ----------------------------------------------------------------- board ---

function testBoard() {
  const board = new Board();
  equal('board has 22 rows', board.rows, TOTAL_ROWS);
  equal('board has 10 columns', board.cols, COLS);

  check(
    'piece off the left wall collides',
    board.collides({ type: 'O', rotation: 0, x: -1, y: 10 }),
  );
  check(
    'piece off the right wall collides',
    board.collides({ type: 'O', rotation: 0, x: COLS - 1, y: 10 }),
  );
  check(
    'piece inside the field is clear',
    !board.collides({ type: 'O', rotation: 0, x: 4, y: 10 }),
  );

  // The spawn buffer above the ceiling is legal ground.
  check(
    'piece in the spawn buffer is clear',
    !board.collides({ type: 'O', rotation: 0, x: 4, y: 0 }),
  );
  check(
    'piece below the floor collides',
    board.collides({ type: 'O', rotation: 0, x: 4, y: TOTAL_ROWS }),
  );

  board.set(3, 10, 1);
  check(
    'piece overlapping a locked cell collides',
    board.collides({ type: 'O', rotation: 0, x: 2, y: 10 }),
  );

  // Row clearing must preserve column order and the matrix height.
  const b2 = new Board();
  b2.set(0, 3, 7);
  b2.set(0, 4, 9);
  for (let x = 0; x < COLS; x++) b2.set(x, 5, 2);
  deepEqual('detects the single full row', b2.fullRows(), [5]);
  equal('clears one row', b2.clearRows([5]), 1);
  equal('matrix keeps its height', b2.rows, TOTAL_ROWS);
  equal('the row above fell one row', b2.cells[5 * COLS + 0], 9);
  equal('the row two above fell one row', b2.cells[4 * COLS + 0], 7);
  equal('the cleared row is empty', b2.cells[6 * COLS + 0], 0);
  equal('the top row is empty', b2.cells[0], 0);

  // Clearing several rows at once keeps every column aligned.
  const b3 = new Board();
  for (const y of [18, 20, 21]) {
    for (let x = 0; x < COLS; x++) b3.set(x, y, x + 1);
  }
  for (let x = 0; x < COLS - 1; x++) b3.set(x, 19, x + 1);
  equal('clears three rows at once', b3.clearRows([18, 20, 21]), 3);
  equal('matrix height unchanged after a multi clear', b3.rows, TOTAL_ROWS);
  // Row 19 was the only survivor, so it falls to the floor.
  equal('the surviving row fell to the bottom', b3.cells[21 * COLS + 3], 4);
  equal('its columns stayed aligned', b3.cells[21 * COLS + 8], 9);
  equal('cleared rows left empty space above', b3.cells[0], 0);

  // A board holding nothing but a completed set of rows must end up empty.
  const b4 = new Board();
  for (const y of [18, 19, 20, 21]) {
    for (let x = 1; x < COLS; x++) b4.set(x, y, 1);
  }
  b4.clearRows([18, 19, 20, 21]);
  check('a board of only cleared rows ends up empty', b4.isEmpty());
}

function testLockOut() {
  const board = new Board();
  check(
    'a piece entirely in the buffer is a lock out',
    board.isEntirelyAboveField({ type: 'T', rotation: 0, x: 3, y: 0 }),
  );
  check(
    'a piece straddling the ceiling is not a lock out',
    !board.isEntirelyAboveField({ type: 'T', rotation: 0, x: 3, y: 1 }),
  );
  check(
    'a piece in the field is not a lock out',
    !board.isEntirelyAboveField({ type: 'O', rotation: 0, x: 4, y: VISIBLE_START }),
  );
}

// -------------------------------------------------------------- gravity ---

function testGravity() {
  check('level 1 is one second per row', Math.abs(gravityMs(1) - 1000) < 1, `${gravityMs(1)}`);
  check('level 10 is about 64ms', Math.abs(gravityMs(10) - 64.15) < 0.5, `${gravityMs(10)}`);
  check('level 13 is about 18ms', Math.abs(gravityMs(13) - 18.15) < 0.5, `${gravityMs(13)}`);

  let previous = gravityMs(1);
  for (let level = 2; level <= 20; level++) {
    const current = gravityMs(level);
    check(`gravity never slows at level ${level}`, current <= previous, `${current} > ${previous}`);
    check(`gravity never hits zero at level ${level}`, current > 0);
    // The floor keeps the piece from descending faster than the screen redraws.
    check(`gravity respects the frame floor at level ${level}`, current >= MIN_GRAVITY_MS);
    previous = current;
  }
}

// ----------------------------------------------------------- game rules ---

/** Runs the line-clear animation out so scoring has been applied. */
function settle(game) {
  let guard = 0;
  while (game.isClearing() && guard++ < 500) game.update(16);
}

/** Fills the given rows in every column except one. */
function fillRowsExcept(game, rows, keep) {
  for (const y of rows) {
    for (let x = 0; x < COLS; x++) {
      if (x !== keep) game.board.set(x, y, 1);
    }
  }
}

/** Places a vertical I in `column` resting on `bottomRow`, and locks it. */
function dropVerticalI(game, column, bottomRow) {
  // I state 1 is a vertical bar in column 2 of its 4x4 box.
  game.active = { type: 'I', rotation: 1, x: column - 2, y: bottomRow - 3 };
  game.hardDrop();
}

/** Leaves one stray block so a clear is scored purely on its line count. */
function seedLeftover(game) {
  game.board.set(0, 4, 1);
}

function testLineClear() {
  const game = new Game();
  game.newGame();
  fillRowsExcept(game, [21], 0);
  dropVerticalI(game, 0, 21);
  settle(game);
  equal('a single line clears', game.lines, 1);
  equal('a single scores 100 at level 1', game.score, LINE_SCORES[1]);
  equal('stats record the single', game.stats.singles, 1);

  const tetris = new Game();
  tetris.newGame();
  seedLeftover(tetris);
  fillRowsExcept(tetris, [18, 19, 20, 21], 0);
  dropVerticalI(tetris, 0, 21);
  settle(tetris);
  equal('four lines clear', tetris.lines, 4);
  equal('a tetris scores 800 at level 1', tetris.score, LINE_SCORES[4]);
  equal('stats record the tetris', tetris.stats.tetrises, 1);
  check('back to back is armed after a tetris', tetris.backToBack);
}

function testPerfectClear() {
  const game = new Game();
  game.newGame();
  // Every row the vertical I will touch is waiting for column 0 and nothing
  // else, so clearing all four leaves the board empty.
  for (const y of [18, 19, 20, 21]) {
    for (let x = 1; x < COLS; x++) game.board.set(x, y, 1);
  }
  dropVerticalI(game, 0, 21);
  settle(game);
  equal('four lines cleared', game.lines, 4);
  check('the board ended up empty', game.board.isEmpty());
  equal(
    'a perfect clear tetris scores tetris plus the bonus',
    game.score,
    LINE_SCORES[4] + PERFECT_CLEAR_SCORES[4],
  );
}

function testBackToBack() {
  const game = new Game();
  game.newGame();
  seedLeftover(game);
  fillRowsExcept(game, [18, 19, 20, 21], 0);
  dropVerticalI(game, 0, 21);
  settle(game);
  equal('a lone tetris scores the base value with no bonus', game.score, LINE_SCORES[4]);

  // A second tetris immediately after is worth 1.5x, plus the first link of the
  // combo chain.
  seedLeftover(game);
  fillRowsExcept(game, [18, 19, 20, 21], 0);
  dropVerticalI(game, 0, 21);
  settle(game);
  equal(
    'a back-to-back tetris scores 1.5x plus the combo',
    game.score,
    LINE_SCORES[4] + Math.floor(LINE_SCORES[4] * 1.5) + COMBO_POINTS,
  );

  // A single-line clear ends the streak and pays the base rate.
  const beforeSingle = game.score;
  seedLeftover(game);
  fillRowsExcept(game, [21], 0);
  dropVerticalI(game, 0, 21);
  settle(game);
  check('a single after a tetris is not a back-to-back', !game.backToBack);
  equal(
    'the single pays the base rate with a combo link',
    game.score - beforeSingle,
    LINE_SCORES[1] + COMBO_POINTS * 2,
  );
}

function testLevelUp() {
  const game = new Game();
  game.newGame();
  // Ten rows pre-filled on the right. A horizontal I dropped on the left
  // completes exactly one row per drop, so ten drops is ten lines.
  const rows = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
  for (const y of rows) {
    for (let x = 4; x < COLS; x++) game.board.set(x, y, 1);
  }
  for (let i = 0; i < rows.length; i++) {
    game.active = { type: 'I', rotation: 0, x: 0, y: 0 };
    game.hardDrop();
    settle(game);
    equal(`drop ${i + 1} clears exactly one line`, game.lines, i + 1);
  }
  equal('ten lines reach level 2', game.level, 2);
  check('level 2 is faster than level 1', gravityMs(2) < gravityMs(1));
  check('the board is empty again', game.board.isEmpty());
}

function testBlockOut() {
  // Block out means the dealt piece has nowhere to go. With a one-column shaft
  // left open, no tetromino fits — the narrowest is the O at two columns.
  const board = new Board();
  for (let y = 0; y < TOTAL_ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (x !== 4) board.set(x, y, 1);
    }
  }
  for (const type of TYPES) {
    const { spawnX, spawnY } = SHAPES[type];
    check(
      `${type} collides with a blocked spawn area`,
      board.collides({ type, rotation: 0, x: spawnX, y: spawnY }),
    );
  }

  // The same condition reached through play: a piece that comes to rest with all
  // of its cells inside the spawn buffer is a lock out.
  const game = new Game();
  game.newGame();
  for (let x = 0; x < COLS; x++) game.board.set(x, VISIBLE_START, 1);
  game.active = { type: 'T', rotation: 0, x: 3, y: 0 };
  game.hardDrop();
  equal('locking entirely in the buffer ends the game', game.state, 'gameover');
  equal('the game over screen reports a summary', typeof game.summary().score, 'number');
}

function testRotationInPlay() {
  const game = new Game();
  game.newGame();
  // A flat floor means the rotation kicks actually matter.
  for (let x = 0; x < COLS; x++) game.board.set(x, 21, 1);
  game.active = { type: 'I', rotation: 0, x: 0, y: 0 };

  check('the I rotates off the left wall', game.rotate(1));
  equal('the I is now vertical', game.active.rotation, 1);
  check('the I was kicked clear of the wall', game.active.x >= -2);
  for (const [x] of cellsOf(game.active)) {
    check('the kicked I stays in the field', x >= 0 && x < COLS, `x=${x}`);
  }

  for (let i = 0; i < 3; i++) check('the I turns again', game.rotate(1));
  equal('four turns in total return to the spawn state', game.active.rotation, 0);

  game.active = { type: 'O', rotation: 0, x: 4, y: 18 };
  game.rotate(1);
  equal('the O stays a square', cellsOf(game.active).length, 4);
  equal('the O does not move when rotating', game.active.x, 4);

  // A rotation with no legal kick must be refused rather than teleporting the
  // piece somewhere the player did not ask for. A 4x2 pocket inside a full
  // board leaves no room for any of the five kicks.
  const wall = new Game();
  wall.newGame();
  for (let y = 0; y < TOTAL_ROWS; y++) {
    for (let x = 0; x < COLS; x++) wall.board.set(x, y, 1);
  }
  for (let y = 10; y <= 11; y++) {
    for (let x = 3; x <= 6; x++) wall.board.set(x, y, 0);
  }
  wall.active = { type: 'T', rotation: 0, x: 4, y: 10 };
  check('the T fits its pocket', !wall.board.collides(wall.active));
  check('a rotation with no legal kick is refused', !wall.rotate(1));
  equal('the refused rotation left the state alone', wall.active.rotation, 0);
  check(
    'the refused rotation did not move the piece',
    wall.active.x === 4 && wall.active.y === 10,
  );
}

function testComboReset() {
  const game = new Game();
  const seen = [];
  game.onEvent = (event) => {
    if (event.type === 'combo') seen.push(event.value);
  };
  game.newGame();
  // One clear, then a dry lock, then another clear.
  fillRowsExcept(game, [21], 0);
  dropVerticalI(game, 0, 21);
  settle(game);
  equal('the first clear reports no combo', seen.at(-1), 0);

  game.active = { type: 'O', rotation: 0, x: 0, y: 19 };
  game.lockPiece();
  equal('a dry lock reports combo zero', seen.at(-1), 0);
  equal('the internal counter reset', game.combo, -1);

  // A second clear starts a fresh chain, so it still reports no combo.
  fillRowsExcept(game, [TOTAL_ROWS - 1], 0);
  dropVerticalI(game, 0, TOTAL_ROWS - 1);
  settle(game);
  equal('the chain restarted from zero', seen.at(-1), 0);
}

function testSevenBag() {
  const game = new Game();
  const counts = Object.fromEntries(TYPES.map((t) => [t, 0]));
  const sequence = [];
  for (let i = 0; i < 70; i++) {
    const type = game.bag.shift();
    counts[type]++;
    sequence.push(type);
  }
  for (const type of TYPES) {
    equal(`${type} appears ten times in 70 pieces`, counts[type], 10);
  }
  for (let i = 0; i + 7 <= sequence.length; i += 7) {
    equal(
      `pieces ${i / 7 + 1} to ${i / 7 + 2} form a complete bag`,
      new Set(sequence.slice(i, i + 7)).size,
      7,
    );
  }
  equal('peek does not consume', game.bag.peek(0), game.bag.queue[0]);
}

function testSettings() {
  equal('defaults include the ghost piece', DEFAULT_SETTINGS.ghost, true);
  equal('defaults bind hard drop to space', DEFAULT_SETTINGS.keybindings.hardDrop, 'Space');
  equal('defaults bind 180 rotate to A', DEFAULT_SETTINGS.keybindings.rotate180, 'KeyA');
  equal('sound is off by default', DEFAULT_SETTINGS.sound, false);
}

// --------------------------------------------------------------- gameplay ---

/** Rates a landing position so the bot can choose a move. */
function evaluate(board, piece) {
  const base = cellsOf(piece);
  const at = (dy) => ({
    type: piece.type,
    rotation: piece.rotation,
    x: piece.x,
    y: piece.y + dy,
  });

  let landing = 0;
  while (!board.collides(at(landing + 1))) landing++;

  const test = new Board();
  test.cells.set(board.cells);
  for (const [x, y] of base) test.set(x, y + landing, 1);

  let lines = 0;
  for (let y = 0; y < test.rows; y++) {
    let full = true;
    for (let x = 0; x < COLS; x++) {
      if (test.cells[y * COLS + x] === 0) {
        full = false;
        break;
      }
    }
    if (full) lines++;
  }

  // A hole is an empty cell with at least one filled cell above it, so the
  // column is scanned from the top down.
  let holes = 0;
  for (let x = 0; x < COLS; x++) {
    let seenBlock = false;
    for (let y = 0; y < test.rows; y++) {
      if (test.cells[y * COLS + x] !== 0) seenBlock = true;
      else if (seenBlock) holes++;
    }
  }

  // Height sums each column's distance from the floor to its topmost cell, and
  // bumpiness is the total step between neighbouring columns.
  let height = 0;
  let bumpiness = 0;
  let previousTop = null;
  for (let x = 0; x < COLS; x++) {
    let top = test.rows;
    for (let y = 0; y < test.rows; y++) {
      if (test.cells[y * COLS + x] !== 0) {
        top = y;
        break;
      }
    }
    if (top < test.rows) height += test.rows - top;
    if (previousTop !== null) bumpiness += Math.abs(top - previousTop);
    previousTop = top;
  }

  // Standard piece-placement heuristic weights.
  return lines * 9.2 - holes * 8 - height * 0.51 - bumpiness * 0.2;
}

/**
 * Plays full runs with a greedy bot. This is the end-to-end smoke test: it
 * drives every system at once and proves the game always terminates cleanly.
 *
 * The piece order is random, so results vary between runs and the totals are
 * aggregated over several games rather than asserted on any single one.
 */
function testSimulatedRun(runs = 3) {
  const seen = new Set();
  const totals = { lines: 0, score: 0, pieces: 0, maxLevel: 1, tetrises: 0 };
  let scoreFell = false;

  for (let run = 0; run < runs; run++) {
    const game = new Game();
    let previousScore = 0;

    game.newGame();
    for (let piece = 0; piece < 4000 && game.state === 'playing'; piece++) {
      seen.add(game.active.type);
      let best = null;
      for (let rotation = 0; rotation < 4; rotation++) {
        for (let x = -3; x <= COLS; x++) {
          const candidate = { type: game.active.type, rotation, x, y: 2 };
          if (game.board.collides(candidate)) continue;
          const score = evaluate(game.board, candidate);
          if (!best || score > best.score) best = { candidate, score };
        }
      }
      // No legal placement at all means the board is unusable.
      if (!best) break;
      game.active = best.candidate;
      game.hardDrop();
      settle(game);
      if (game.score < previousScore) scoreFell = true;
      previousScore = game.score;
    }

    // A run ends either by topping out or by still being alive at the piece
    // budget. Both are valid; what matters is that the loop always terminates
    // and the game never wedges.
    equal(
      `run ${run + 1} ends cleanly`,
      game.state === 'gameover' || game.stats.pieces >= 4000,
      true,
    );
    totals.lines += game.lines;
    totals.score += game.score;
    totals.pieces += game.stats.pieces;
    totals.tetrises += game.stats.tetrises;
    totals.maxLevel = Math.max(totals.maxLevel, game.level);
  }

  check('score never goes down mid-run', !scoreFell);
  check('the bot cleared rows', totals.lines > 0, `${totals.lines} lines`);
  check('the bot levelled up', totals.maxLevel >= 2, `max level ${totals.maxLevel}`);
  check('the bot scored', totals.score > 0, `${totals.score} points`);
  equal('every piece type appeared', seen.size, 7);
  console.log(
    `      bot: ${totals.score.toLocaleString()} points over ${runs} runs, ` +
      `${totals.lines} lines, best level ${totals.maxLevel}, ` +
      `${totals.tetrises} tetrises, ${totals.pieces} pieces`,
  );
}

/** The menu backdrop must not disturb a real game. */
function testAttractMode() {
  const game = new Game();
  game.seedAttract();
  let filled = 0;
  for (const value of game.board.cells) if (value !== 0) filled++;
  check('the menu board has blocks in it', filled > 0);
  check('the menu board is not completely full', filled < COLS * TOTAL_ROWS);
  game.newGame();
  equal('starting a game clears the menu board', game.board.isEmpty(), true);
  equal('starting a game puts the game in play', game.state, 'playing');
}

// ----------------------------------------------------------------- runner ---

const suites = [
  ['piece definitions', testShapes],
  ['SRS kick tables', testKickTables],
  ['board', testBoard],
  ['lock out', testLockOut],
  ['gravity curve', testGravity],
  ['line clears', testLineClear],
  ['perfect clear', testPerfectClear],
  ['back to back', testBackToBack],
  ['level up', testLevelUp],
  ['block out', testBlockOut],
  ['rotation in play', testRotationInPlay],
  ['combo reset', testComboReset],
  ['7-bag randomiser', testSevenBag],
  ['settings defaults', testSettings],
  ['attract mode', testAttractMode],
  ['simulated run', testSimulatedRun],
];

console.log('Neon Tetris — logic tests\n');
for (const [name, fn] of suites) {
  const before = failures.length;
  try {
    fn();
  } catch (error) {
    failures.push(`${name} threw: ${error.message}`);
    if (process.env.VERBOSE) console.error(error.stack);
  }
  const added = failures.length - before;
  console.log(`  ${added === 0 ? 'PASS' : 'FAIL'}  ${name}${added ? `  (${added} failed)` : ''}`);
}

console.log(`\n${passed} assertions passed, ${failures.length} failed.`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
