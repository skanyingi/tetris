/**
 * Builds one self-contained HTML file that runs by double-clicking.
 *
 * The multi-file version uses ES modules, and browsers refuse to load those
 * over file:// — so opening index.html straight off disk does nothing. This
 * bundles the stylesheets and the module graph into a single HTML file with a
 * plain inline <script>, which has no such restriction.
 *
 * This is deliberately not a bundler. It concatenates the modules in dependency
 * order and strips the import/export keywords, then refuses to emit anything if
 * two modules declare the same top-level name (which would be a redeclaration
 * error once merged into one scope).
 *
 * Usage: node tools/build-single.js
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, basename } from 'node:path';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const JS_DIR = resolve(ROOT, 'js');
const OUT = resolve(ROOT, 'dist/tetris.html');

/** Strips a file's path to a module name, e.g. "./config.js" -> "config". */
const moduleName = (p) => basename(p).replace(/\.js$/, '');

/**
 * Extracts the top-level declarations of a module, so collisions between
 * modules can be caught before the bundle is written.
 */
function topLevelNames(source) {
  const names = [];
  const withoutStrings = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(\/\/|\s)#[^\n]*/g, '$1')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');

  const declaration =
    /^(?:export\s+)?(?:async\s+)?(?:const|let|var|class|function)\s+([A-Za-z_$][\w$]*)/gm;
  for (const match of withoutStrings.matchAll(declaration)) names.push(match[1]);
  return names;
}

/** Collects the local module specifiers a file imports. */
function importsOf(source) {
  const found = new Set();
  const patterns = [
    /import\s*\{[\s\S]*?\}\s*from\s*['"]([^'"]+)['"]/g,
    /import\s*\*\s*as\s+[A-Za-z_$][\w$]*\s+from\s*['"]([^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
}

/** Removes import statements, bare re-export lists, and `export` keywords. */
function stripModuleSyntax(source) {
  return source
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];?[ \t]*$/gm, '')
    .replace(/^import\s*\*\s*as\s+[A-Za-z_$][\w$]*\s+from\s*['"][^'"]+['"];?[ \t]*$/gm, '')
    .replace(/^import\s+[A-Za-z_$][\w$]*\s*,?\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];?[ \t]*$/gm, '')
    .replace(/^export\s*\{[\s\S]*?\};?[ \t]*$/gm, '')
    .replace(/^export\s+default\s+/gm, 'var __default = ')
    .replace(/^export\s+(?=(?:const|let|var|class|function|async)\b)/gm, '')
    .replace(/^import\s+['"][^'"]+['"];?[ \t]*$/gm, '');
}

/** Finds module keywords that survived stripping, ignoring comments. */
function leftoverModuleSyntax(source) {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  return [...code.matchAll(/^\s*(import|export)\b.*$/gm)].map((m) => m[0].trim());
}

// ------------------------------------------------------------------ read ---

const indexHtml = await readFile(resolve(ROOT, 'index.html'), 'utf8');
const cssFiles = [...indexHtml.matchAll(/<link rel="stylesheet" href="css\/([^"]+)"/g)].map(
  (m) => `css/${m[1]}`,
);
if (cssFiles.length === 0) throw new Error('no stylesheets found in index.html');

const sources = new Map();
for (const entry of await readdirJs()) sources.set(entry, await readFile(resolve(JS_DIR, entry), 'utf8'));

async function readdirJs() {
  const { readdir } = await import('node:fs/promises');
  return (await readdir(JS_DIR)).filter((f) => f.endsWith('.js'));
}

// -------------------------------------------------------------- toposort ---

/** Orders modules so every module follows the ones it imports. */
function resolveOrder() {
  const byName = new Map([...sources.keys()].map((f) => [moduleName(f), f]));
  const ordered = [];
  const state = new Map();

  const visit = (name, trail) => {
    if (state.get(name) === 'done') return;
    if (state.get(name) === 'visiting') {
      throw new Error(`circular import: ${[...trail, name].join(' -> ')}`);
    }
    state.set(name, 'visiting');
    const file = byName.get(name);
    if (!file) throw new Error(`unknown module "${name}" imported by ${trail.at(-1)}`);
    for (const spec of importsOf(sources.get(file))) {
      visit(moduleName(spec), [...trail, name]);
    }
    state.set(name, 'done');
    ordered.push(file);
  };

  for (const name of byName.keys()) visit(name, []);
  return ordered;
}

const order = resolveOrder();

// --------------------------------------------------- collision detection ---

const owners = new Map();
const clashes = [];
for (const file of order) {
  for (const name of topLevelNames(sources.get(file))) {
    if (owners.has(name)) clashes.push(`"${name}" declared in both ${owners.get(name)} and ${file}`);
    else owners.set(name, file);
  }
}
if (clashes.length > 0) {
  console.error('Refusing to build: top-level name collisions would break the merge.\n');
  for (const clash of clashes) console.error(`  - ${clash}`);
  console.error('\nRename one of each pair, or keep that module as a separate <script>.');
  process.exit(1);
}

// ---------------------------------------------------------------- bundle ---

const bundle = order
  .map((file) => {
    const body = stripModuleSyntax(sources.get(file)).trim();
    return `/* ==== js/${file} ==== */\n${body}`;
  })
  .join('\n\n');

// The bundle is emitted as a classic script, so any surviving module keyword
// would be a syntax error. Fail here rather than shipping a dead file.
const leftovers = leftoverModuleSyntax(bundle);
if (leftovers.length > 0) {
  console.error('Refusing to build: module syntax survived stripping.\n');
  for (const line of leftovers) console.error(`  - ${line}`);
  process.exit(1);
}

// Parse the merged source. `new Function` compiles without running, so this is
// a pure syntax check that catches redeclarations and bad merges.
try {
  // eslint-disable-next-line no-new-func
  new Function(`(function () { "use strict";\n${bundle}\n})();`);
} catch (error) {
  console.error('Refusing to build: the merged script is not valid JavaScript.\n');
  console.error(`  ${error.message}`);
  process.exit(1);
}

const css = (
  await Promise.all(cssFiles.map(async (f) => `/* ${f} */\n${await readFile(resolve(ROOT, f), 'utf8')}`))
).join('\n\n');

let html = indexHtml
  .replace(/\n\s*<link rel="stylesheet" href="css\/[^"]+" \/>/g, '')
  .replace('</head>', `  <style>\n${css}\n  </style>\n  </head>`)
  .replace(
    /<script type="module" src="js\/main\.js"><\/script>/,
    `<script>\n(function () {\n"use strict";\n${bundle}\n})();\n</script>`,
  );

if (html.includes('src="js/main.js"')) {
  throw new Error('the module script tag was not replaced — check index.html');
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html, 'utf8');

const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log(`Built ${OUT}`);
console.log(`  ${order.length} modules, ${cssFiles.length} stylesheets, ${kb} kB, one file`);
console.log(`  order: ${order.map(moduleName).join(' -> ')}`);
console.log('  open it by double-clicking; it needs no server.');
