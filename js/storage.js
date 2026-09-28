import { DEFAULT_SETTINGS } from './config.js';

const KEYS = {
  settings: 'tetris.settings',
  highScore: 'tetris.highScore',
};

/**
 * localStorage is not guaranteed to exist: Safari private mode historically
 * threw on write, and embedded webviews can disable storage entirely. Probe it
 * once at load and fall back to an in-memory Map so the game still runs and
 * simply forgets everything on reload.
 */
const memory = new Map();
let persistent = probe();

function probe() {
  try {
    const marker = '__tetris_probe__';
    window.localStorage.setItem(marker, '1');
    window.localStorage.removeItem(marker);
    return true;
  } catch {
    return false;
  }
}

function readRaw(key) {
  try {
    return persistent ? window.localStorage.getItem(key) : memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function writeRaw(key, value) {
  try {
    if (persistent) window.localStorage.setItem(key, value);
    else memory.set(key, value);
  } catch {
    // A quota error or a mid-session revocation: degrade to memory rather than
    // letting a save take the whole game down.
    persistent = false;
    memory.set(key, value);
  }
}

function readJSON(key, fallback) {
  const raw = readRaw(key);
  if (raw === null) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    writeRaw(key, JSON.stringify(value));
  } catch {
    // Nothing sensible to do; the caller does not need to know.
  }
}

/** True when values survive a reload. */
export function isPersistent() {
  return persistent;
}

function deepMerge(base, patch) {
  const out = { ...base };
  for (const key of Object.keys(base)) {
    const value = base[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = deepMerge(value, (patch && patch[key]) || {});
    } else if (patch && patch[key] !== undefined) {
      out[key] = patch[key];
    }
  }
  return out;
}

/** Reads settings, filling in any keys added since the user's last visit. */
export function loadSettings() {
  return deepMerge(DEFAULT_SETTINGS, readJSON(KEYS.settings, {}));
}

export function saveSettings(settings) {
  writeJSON(KEYS.settings, settings);
}

export function loadHighScore() {
  const value = Number(readRaw(KEYS.highScore));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function saveHighScore(score) {
  writeRaw(KEYS.highScore, String(Math.max(0, Math.floor(score))));
}
