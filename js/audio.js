/**
 * All sound is synthesised with the Web Audio API — no audio files to host,
 * bundle, or license. Every effect is a short oscillator/noise envelope shaped
 * through a master gain.
 *
 * Autoplay policy blocks an AudioContext from starting until the user has
 * interacted with the page, so the context is created lazily on the first real
 * gesture and the game ships muted.
 *
 * Extension point: a music bed would slot in here as a second scheduled source
 * driven from the same master gain, gated by its own setting.
 */
export class AudioKit {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = false;
    this.unlocked = false;
  }

  /** Creates the context. Must be called from a user gesture handler. */
  unlock() {
    if (this.unlocked) {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.28 : 0;
      this.master.connect(this.ctx.destination);
      this.unlocked = true;
    } catch {
      this.ctx = null;
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.master) {
      this.master.gain.setTargetAtTime(this.enabled ? 0.28 : 0, this.ctx.currentTime, 0.02);
    }
  }

  /**
   * Routes a gameplay event to an effect. Unknown events are ignored so new
   * game events never throw.
   */
  handle(event) {
    if (!this.enabled || !this.ctx) return;
    switch (event.type) {
      case 'move':
        this.#blip({ type: 'square', freq: 210, duration: 0.03, gain: 0.18 });
        break;
      case 'rotate':
        this.#blip({ type: 'triangle', freq: 330, duration: 0.05, gain: 0.2 });
        break;
      case 'rotateBlocked':
        this.#blip({ type: 'square', freq: 110, duration: 0.04, gain: 0.12 });
        break;
      case 'lock':
        this.#thud(0.09);
        break;
      case 'hardDrop':
        this.#hardDrop(event.distance || 1);
        break;
      case 'clear':
        this.#lineClear(event.count || 1);
        break;
      case 'levelUp':
        this.#sweep(320, 900, 0.28, 0.18);
        break;
      case 'gameOver':
        this.#sweep(420, 90, 0.7, 0.22, 'sawtooth');
        break;
      default:
        break;
    }
  }

  /** A single shaped oscillator note. */
  #blip({ type = 'sine', freq, duration = 0.08, gain = 0.2, slideTo = null, delay = 0 }) {
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    // Fast attack, exponential decay: keeps effects short and percussive.
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(env).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  /** A pitched run of notes, used for line clears. */
  #arpeggio(notes, { step = 0.055, gain = 0.2, type = 'triangle' } = {}) {
    notes.forEach((freq, i) => {
      this.#blip({ type, freq, duration: 0.12, gain, delay: i * step });
    });
  }

  /** A filtered noise burst — the basis of the thud and hard-drop effects. */
  #noise(duration, { gain = 0.3, cutoff = 1200, sweepTo = 120, delay = 0 } = {}) {
    const t = this.ctx.currentTime + delay;
    const frames = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      // Fade the noise out linearly so the burst has no click at the end.
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + duration);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(env).connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  #thud(gain) {
    this.#blip({ type: 'sine', freq: 130, duration: 0.09, gain, slideTo: 70 });
    this.#noise(0.06, { gain: gain * 0.6, cutoff: 900, sweepTo: 200 });
  }

  #hardDrop(distance) {
    // Bigger drops land harder, but the effect is compressed so a 20-cell drop
    // is not deafening.
    const weight = Math.min(1, 0.4 + distance / 24);
    this.#noise(0.16, { gain: 0.34 * weight, cutoff: 2600, sweepTo: 90 });
    this.#blip({ type: 'sine', freq: 260, duration: 0.14, gain: 0.24 * weight, slideTo: 55 });
  }

  /** Rising pitch and a bigger fanfare the more rows go at once. */
  #lineClear(count) {
    const root = 330;
    const ladder = [0, 4, 7, 12, 16, 19];
    const notes = ladder.slice(0, count).map((semi) => root * 2 ** (semi / 12));
    this.#arpeggio(notes, { step: 0.05, gain: 0.18 });
    this.#noise(0.14, { gain: 0.16, cutoff: 4000, sweepTo: 600 });
    if (count === 4) {
      // A tetris gets a bright sustained chord on top of the run.
      [0, 7, 12].forEach((semi, i) => {
        this.#blip({
          type: 'triangle',
          freq: 660 * 2 ** (semi / 12),
          duration: 0.3,
          gain: 0.14,
          delay: 0.18 + i * 0.03,
        });
      });
    }
  }

  #sweep(from, to, duration, gain, type = 'sine') {
    this.#blip({ type, freq: from, duration, gain, slideTo: to });
  }
}
