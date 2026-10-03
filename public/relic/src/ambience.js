// Ambient soundscape from the tiny WebAudio synth (no audio files): birdsong by day, crickets at
// night, and work sounds (axes, hammers, anvils, saws) that fade with distance from the camera.
export class Ambience {
  constructor(game) { this.g = game; this.sfx = game.sfx; this.t = 1; }

  /** Volume for a sound at world position p (0 when far from the camera target or zoomed out). */
  vol(p) {
    const cam = this.g.cam, t = cam.target, d = Math.hypot(p.x - t.x, p.z - t.z);
    return Math.max(0, 1 - d / 45) * Math.max(0.15, 1 - cam.zoom);
  }

  bird() {
    const f = 1800 + Math.random() * 1600, n = 2 + Math.floor(Math.random() * 4), g = 0.025 + Math.random() * 0.02;
    for (let i = 0; i < n; i++) this.sfx.tone(f * (0.9 + Math.random() * 0.25), 0.09, { gain: g, slide: 1.3 + Math.random() * 0.4, delay: i * 0.12 });
  }
  cricket() { for (let i = 0; i < 3; i++) this.sfx.tone(4200 + Math.random() * 300, 0.035, { type: 'square', gain: 0.006, delay: i * 0.06 }); }

  chop(p) { const v = this.vol(p); if (v > 0.05) { this.sfx.noise(0.08, { freq: 1400, q: 2, type: 'bandpass', gain: 0.2 * v }); this.sfx.tone(180, 0.1, { gain: 0.12 * v, slide: 0.6 }); } }
  hammer(p) { const v = this.vol(p); if (v > 0.05) { this.sfx.tone(900, 0.07, { type: 'triangle', gain: 0.08 * v }); this.sfx.noise(0.05, { freq: 2500, type: 'highpass', gain: 0.08 * v }); } }
  anvil(p) { const v = this.vol(p); if (v > 0.05) [880, 1320, 2090].forEach((f, i) => this.sfx.tone(f, 0.35, { type: 'triangle', gain: 0.05 * v, delay: i * 0.004 })); }
  saw(p) { const v = this.vol(p); if (v > 0.05) for (let i = 0; i < 3; i++) this.sfx.noise(0.16, { freq: 2200, q: 4, type: 'bandpass', gain: 0.07 * v, delay: i * 0.2 }); }

  /** A workshop finished a cycle: play its work sound if the camera is near. */
  produced(b, p) {
    if (b.type === 'blacksmith' || b.type === 'smelter') this.anvil(p);
    else if (b.type === 'sawmill') this.saw(p);
    else if (b.type === 'quarry' || b.type === 'stonemason' || b.type === 'ironmine' || b.type === 'goldmine') this.hammer(p);
  }

  update(dt) {
    if (!this.sfx.ctx || this.sfx.muted || !this.g.speed) return;
    if ((this.t -= dt) > 0) return;
    const night = this.g.colony.night, zoom = this.g.cam.zoom;
    if (night) { this.cricket(); this.t = 0.6 + Math.random() * 1.2; }
    else { if (zoom < 0.8) this.bird(); this.t = 1.5 + Math.random() * 4; }
  }
}
