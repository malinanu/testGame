// Tiny WebAudio synth for Wizard's Chess (no audio files): footsteps, stone thuds, zaps, clangs, chimes.
export class SFX {
  constructor() {
    this.ctx = null;
    try { this.muted = localStorage.getItem('wizchess-muted') === '1'; } catch { this.muted = false; }
  }
  ensure() {
    if (this.muted) return null;
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  setMuted(m) { this.muted = m; try { localStorage.setItem('wizchess-muted', m ? '1' : '0'); } catch {} }

  noise(dur, { freq = 800, q = 1, gain = 0.3, type = 'lowpass', sweep = 0, delay = 0 } = {}) {
    const c = this.ensure(); if (!c) return;
    const t = c.currentTime + delay, len = Math.ceil(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(c.destination); src.start(t); src.stop(t + dur);
  }
  tone(freq, dur, { type = 'sine', gain = 0.25, slide = 0, delay = 0 } = {}) {
    const c = this.ensure(); if (!c) return;
    const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur);
  }
  step() { this.noise(0.07, { freq: 500, gain: 0.12 }); }
  grind() { this.noise(0.6, { freq: 300, q: 3, gain: 0.25, type: 'bandpass' }); }
  thud(big = false) { this.tone(big ? 55 : 80, big ? 0.6 : 0.35, { gain: 0.5, slide: 0.5 }); this.noise(big ? 0.5 : 0.25, { freq: 600, gain: 0.35, sweep: 0.2 }); }
  clang() { [523, 787, 1240].forEach((f, i) => this.tone(f, 0.4, { type: 'triangle', gain: 0.12, delay: i * 0.005 })); this.noise(0.08, { freq: 4000, type: 'highpass', gain: 0.2 }); }
  zap() { this.tone(1800, 0.35, { type: 'sawtooth', gain: 0.08, slide: 0.15 }); this.noise(0.45, { freq: 3000, type: 'bandpass', q: 0.7, gain: 0.25, sweep: 0.3 }); }
  whoosh() { this.noise(0.35, { freq: 400, type: 'bandpass', q: 0.8, gain: 0.25, sweep: 4 }); }
  twang() { this.tone(220, 0.25, { type: 'triangle', gain: 0.2, slide: 0.7 }); this.whoosh(); }
  shatter() { this.noise(0.5, { freq: 2500, type: 'highpass', gain: 0.25 }); this.thud(); }
  chime() { [659, 880, 1318].forEach((f, i) => this.tone(f, 0.5, { gain: 0.12, delay: i * 0.08 })); }
  doom() { [196, 155, 130].forEach((f, i) => this.tone(f, 0.9, { type: 'sawtooth', gain: 0.08, delay: i * 0.25 })); }
  magic() { [880, 1175, 1568, 2093].forEach((f, i) => this.tone(f, 0.3, { gain: 0.07, delay: i * 0.05 })); }
}
