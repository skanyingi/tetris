# Neon Tetris

A complete, dependency-free Tetris built with plain HTML, CSS and ES modules.
No framework, no build step, no backend — the whole thing is static files you can
drag onto a host.

![no build step required](https://img.shields.io/badge/build-none-22d3ee?style=flat-square)
![no dependencies](https://img.shields.io/badge/dependencies-0-a855f7?style=flat-square)

## Features

**Gameplay**

- 10×20 playfield over a 22-row matrix, with two hidden rows as a spawn buffer
- All 7 tetrominoes with real **Super Rotation System** kick tables, including
  the separate I-piece offsets and 180° rotation
- 7-bag randomiser, so droughts are bounded
- Ghost piece, toggleable
- 0.5s lock delay with the standard 15-move reset budget
- Line-clear animation: white flash, then the rows above slide into place
- Both top-out conditions — *block out* (nowhere to spawn) and *lock out* (the
  piece locked entirely inside the buffer)
- Guideline scoring: single/double/triple/tetris, combo, soft- and hard-drop
  bonus, back-to-back ×1.5, and perfect-clear bonuses
- Guideline gravity curve, floored at one row per frame

**Controls**

| Action | Key |
| --- | --- |
| Move | `←` `→` |
| Soft drop | `↓` |
| Hard drop | `Space` |
| Rotate clockwise | `↑` or `X` |
| Rotate counter-clockwise | `Z` |
| Rotate 180° | `A` |
| Pause | `P` |

Every binding is remappable in Settings. Auto-shift delay (DAS) and repeat rate
(ARR) are adjustable too, and take effect immediately. On-screen touch controls
appear automatically on touch devices and narrow screens.

**Persistence** — the high score and all settings are kept in `localStorage`. If storage is unavailable (private browsing,
locked-down webviews) the game falls back to in-memory state and says so in the
footer instead of failing.

**Presentation** — dark neon theme on a Canvas 2D renderer, particle bursts and
screen shake on clears, Web Audio sound effects synthesised in code (no audio
files), a live combo readout, and an ARIA live region for screen readers.
Respects `prefers-reduced-motion`.

## Running it locally

The game uses ES modules, so it needs a real HTTP origin — opening
`index.html` from the filesystem will not work.

```bash
npm run dev          # http://localhost:4173
```

There is nothing to install; `npm run dev` runs a ~40-line static file server
included in `tools/serve.js`. Any other static server works just as well:

```bash
python3 -m http.server 4173
npx serve .
```

## Tests

```bash
npm test             # both suites
npm run test:logic   # game rules, on plain Node
npm run test:dom     # boots the real modules against a DOM stub
```

`tools/test.js` covers the pure game logic. Notably, it checks all 28
hand-authored rotation states against an independent geometric rotation, so an
SRS mistake cannot hide. It also plays full games with a greedy bot.

`tools/dom-test.js` stubs enough of the browser to import `main.js`, run frames,
simulate key and touch input, and drive a run all the way to game over and into
the app. It also cross-checks that every element the code looks up by id
actually exists in `index.html`.

## Deploying

The output is the repository itself — there is no build step and no output
directory to configure.

**Vercel**

```bash
npm i -g vercel
vercel          # framework: Other, build command: leave empty, output: .
```

**Netlify**

```bash
npm i -g netlify-cli
netlify deploy --prod --dir .
```

Or just drag the folder onto either dashboard.

Do not set a build command — there is nothing to build.

## Project layout

```
index.html              markup, HUD, and the modal screens
css/
  base.css              tokens, page shell, responsive stage
  hud.css               top bar, stat readouts, side panels
  overlays.css          start / pause / game over / settings
  touch.css             on-screen touch pad
js/
  config.js             grid, palette, gravity curve, scoring, key defaults
  pieces.js             tetrominoes and the SRS kick tables
  board.js              matrix, collision, line detection, row removal
  game.js               state machine, gravity, scoring, top-out detection
  renderer.js           canvas loop, ghost, clear animation, particles
  input.js              keyboard and touch, DAS/ARR
  storage.js            localStorage with an in-memory fallback
  audio.js              synthesised Web Audio effects
  ui.js                 HUD updates, previews, modals, settings
  main.js               bootstrap and wiring
tools/
  serve.js              dev static server
  test.js               logic tests
  dom-test.js           integration tests
```

The dependency direction is one way: `ui`, `input`, `storage` and `audio` know
nothing about each other, and `main.js` is the only module that wires them
together. `game.js` in particular never touches the DOM — it emits events
(`clear`, `lock`, `levelUp`, `gameOver`) that `main.js` routes to sound and
animation. That is what makes the rules testable on plain Node.

## Notes on the implementation

**One loop, no timers.** Gravity, DAS/ARR, the lock delay and the line-clear
animation are all advanced from a single `requestAnimationFrame` loop with a
delta-time accumulator. There is not one `setInterval` in the project, so
teardown is a single `cancelAnimationFrame` plus one `AbortController` that
removes every listener at once. Gravity is clamped to a maximum of 20 catch-up
steps per frame so a backgrounded tab cannot resume by draining the whole board.

**Line clears mutate late.** The board is only changed when the animation
finishes. The renderer draws the rows above sliding down with an offset
derived from the same progress value, so the final frame lines up exactly with
the real state — there is no snap.

**Rotation data is explicit.** Each piece's four states are written out as cell
offsets rather than rotated at runtime, and the kick tables are stored exactly
as published (+Y up) and negated in one place when applied, since the board's Y
axis points down.

**Storage fails quietly.** A probe write on load detects unavailable
`localStorage`; from then on everything goes to a `Map`. A quota error or a
mid-session revocation downgrades the same way instead of taking the game down.

## Known limitations

- No hold slot, no next-piece preview and no leaderboard: all three were
  removed deliberately. The game is now well short of the Tetris guideline, and
  you have to plan several pieces ahead blind.
- No background music. The audio module is structured so a music bed could be
  added as a second scheduled source on the same master gain, but a synthesised
  loop is a matter of taste and was left out deliberately.
- The high score is per browser. There is no server, so it does not sync
  between devices.
# tetris
