// Villagers: carriers walk the roads from a storage to a workshop and back with the goods on
// their head, timed to the simulation's trips. Actors are pooled.
import * as THREE from 'three';
import { Actor, turnToward } from '../../src/actor.js';
import { GOODS } from './data.js';
import { tileToWorld } from './world3d.js';

const LOOKS = [['Rogue', 0xffffff], ['Ranger', 0xffffff], ['Barbarian', 0xe8d8c0], ['Rogue_Hooded', 0xd8c8a8], ['Knight', 0xc8c0b0]];
const MAX = 44;

export class Units {
  constructor(game) { this.g = game; this.walkers = []; this.pool = []; this.n = 0; }
  get c() { return this.g.colony; }

  actor() {
    const a = this.pool.pop();
    if (a) { a.root.visible = true; return a; }
    const [ch, tint] = LOOKS[this.n++ % LOOKS.length];
    const act = new Actor(this.g.assets, ch, { tint: tint === 0xffffff ? null : new THREE.Color(tint), scale: 0.8 });
    act.load = new THREE.Group(); act.load.position.y = 1.75; act.root.add(act.load);
    return act;
  }
  release(a) { a.root.visible = false; a.load.clear(); this.g.scene.remove(a.root); this.pool.push(a); }

  /** A sim trip started: storage `from` → building `to`, picks up at trip.pick, home at trip.end. */
  trip(trip) {
    if (this.walkers.length >= MAX) return;
    const c = this.c, s = c.buildings.get(trip.from), b = c.buildings.get(trip.to);
    if (!s || !b) return;
    const tiles = c.roadPath(s, b);
    if (!tiles || tiles.length < 2) return;
    const pts = tiles.map(([x, y]) => { const [wx, wz] = tileToWorld(x, y); return new THREE.Vector3(wx, 0.05, wz); });
    const lens = [0]; for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const a = this.actor(); this.g.scene.add(a.root);
    a.root.position.copy(pts[0]);
    const good = trip.good && GOODS[trip.good];
    this.walkers.push({ a, pts, lens, total: lens[lens.length - 1], trip, good, loaded: false, facing: 0, side: (Math.random() - 0.5) * 0.6 });
  }

  at(w, d) {
    const { pts, lens } = w;
    let i = 1; while (i < lens.length - 1 && lens[i] < d) i++;
    const k = (d - lens[i - 1]) / Math.max(1e-6, lens[i] - lens[i - 1]);
    return { p: pts[i - 1].clone().lerp(pts[i], Math.min(1, Math.max(0, k))), dir: pts[i].clone().sub(pts[i - 1]) };
  }

  update(dt) {
    const t = this.c.time + this.c.acc;
    for (const w of this.walkers) {
      const tr = w.trip, out = t < tr.pick;
      const f = out ? (t - tr.start) / (tr.pick - tr.start) : 1 - (t - tr.pick) / (tr.end - tr.pick);
      const { p, dir } = this.at(w, Math.max(0, Math.min(1, f)) * w.total);
      if (!out) dir.negate();
      // keep to the right of the road
      const n = new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(w.side);
      w.a.root.position.copy(p).add(n);
      if (dir.lengthSq() > 1e-6) w.facing = turnToward(w.facing, Math.atan2(dir.x, dir.z), dt * 10);
      w.a.root.rotation.y = w.facing;
      if (!out && !w.loaded) {
        w.loaded = true;
        if (w.good) { const piece = this.g.world.kit.piece(w.good.carry); piece.scale.setScalar(0.45); w.a.load.add(piece); }
        w.a.once('PickUp', { speed: 2.5 });
      }
      w.a.setBase('Walking_A'); w.a.update(dt * this.g.speed || dt);
      w.done = t >= tr.end || !this.c.buildings.get(tr.to);
    }
    this.walkers = this.walkers.filter(w => { if (w.done) { this.release(w.a); return false; } return true; });
  }

  /** Rebuild the walkers after a load (trips in flight are restored from the sim). */
  restore() { for (const w of this.walkers) this.release(w.a); this.walkers = []; for (const tr of this.c.trips || []) this.trip(tr); }
}
