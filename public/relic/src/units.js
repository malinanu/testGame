// Villagers that make the town feel alive (all visual; the simulation is the source of truth):
//  - carriers walk the roads from a storage to a workshop and back with goods on their heads,
//    timed to the simulation's trips
//  - residents stroll from their homes to the Market, Tavern or Chapel and back
//  - lumberjacks walk to the tree the sim fells and chop it; site workers labour beside busy
//    quarries, smithies, sawmills, farms and stonemasons; builders hammer at new construction
// Actors are pooled.
import * as THREE from 'three';
import { Actor, turnToward } from '../../src/actor.js';
import { GOODS, BUILDINGS } from './data.js';
import { tileToWorld } from './world3d.js';

const LOOKS = [['Rogue', 0xffffff], ['Ranger', 0xffffff], ['Barbarian', 0xe8d8c0], ['Rogue_Hooded', 0xd8c8a8], ['Knight', 0xc8c0b0], ['Mage', 0xe0d8ff]];
const MAX_CARRIERS = 40, MAX_STROLL = 24, MAX_SITE = 18;
const SITE_TOOL = { quarry: 'tool:pickaxe', blacksmith: 'tool:hammer', sawmill: 'tool:saw', stonemason: 'tool:mallet', farm: 'tool:shovel', flaxfarm: 'tool:shovel', forester: 'tool:shovel', ironmine: 'tool:pickaxe', goldmine: 'tool:pickaxe', charcoal: 'tool:shovel' };

export class Units {
  constructor(game) { this.g = game; this.walkers = []; this.strollers = []; this.jobs = []; this.site = new Map(); this.pool = []; this.n = 0; this.strollT = 2; }
  get c() { return this.g.colony; }
  worldPt(x, y) { const [wx, wz] = tileToWorld(x, y); return new THREE.Vector3(wx, 0.05, wz); }

  actor() {
    let a = this.pool.pop();
    if (!a) {
      const [ch, tint] = LOOKS[this.n++ % LOOKS.length];
      a = new Actor(this.g.assets, ch, { tint: tint === 0xffffff ? null : new THREE.Color(tint), scale: 0.8 });
      a.load = new THREE.Group(); a.load.position.y = 1.75; a.root.add(a.load);
      a.tools = [];
    }
    a.root.visible = true; a.root.scale.setScalar(1); this.g.scene.add(a.root);
    return a;
  }
  /** Put a tool in the right hand (a kit piece). */
  give(a, ref) {
    const p = this.g.world.kit.piece(ref); p.scale.setScalar(0.9); p.rotation.set(Math.PI / 2, 0, 0);
    (a.handR || a.root).add(p); a.tools.push(p);
  }
  release(a) {
    a.root.visible = false; a.load.clear();
    for (const t of a.tools) t.parent?.remove(t); a.tools = [];
    this.g.scene.remove(a.root); a.busy = 0; this.pool.push(a);
  }

  pathPoints(tiles) {
    const pts = tiles.map(([x, y]) => this.worldPt(x, y));
    const lens = [0]; for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]));
    return { pts, lens, total: lens[lens.length - 1] };
  }
  at(w, d) {
    const { pts, lens } = w;
    let i = 1; while (i < lens.length - 1 && lens[i] < d) i++;
    const k = (d - lens[i - 1]) / Math.max(1e-6, lens[i] - lens[i - 1]);
    return { p: pts[i - 1].clone().lerp(pts[i], Math.min(1, Math.max(0, k))), dir: pts[i].clone().sub(pts[i - 1]) };
  }
  place(w, p, dir, dt) {
    const n = new THREE.Vector3(-dir.z, 0, dir.x); if (n.lengthSq() > 1e-6) n.normalize().multiplyScalar(w.side);
    w.a.root.position.copy(p).add(n);
    if (dir.lengthSq() > 1e-6) w.facing = turnToward(w.facing, Math.atan2(dir.x, dir.z), dt * 10);
    w.a.root.rotation.y = w.facing;
  }
  nearCamera(p, r = 90) { const t = this.g.cam.target; return Math.hypot(p.x - t.x, p.z - t.z) < r; }

  // ------------------------------------------------------------------ carriers
  /** A sim trip started: storage `from` → building `to`, picks up at trip.pick, home at trip.end. */
  trip(trip) {
    if (this.walkers.length >= MAX_CARRIERS) return;
    const c = this.c, s = c.buildings.get(trip.from), b = c.buildings.get(trip.to);
    if (!s || !b) return;
    const tiles = c.roadPath(s, b);
    if (!tiles || tiles.length < 2) return;
    const a = this.actor(), path = this.pathPoints(tiles);
    a.root.position.copy(path.pts[0]);
    this.walkers.push({ a, ...path, trip, good: trip.good && GOODS[trip.good], loaded: false, facing: 0, side: (Math.random() - 0.5) * 0.6 });
  }

  // ------------------------------------------------------------------ residents strolling to services
  spawnStroller() {
    const c = this.c;
    const homes = [...c.buildings.values()].filter(b => b.tier != null && b.residents > 0 && b.connected && !b.fire);
    const services = [...c.buildings.values()].filter(b => BUILDINGS[b.type].service && c.active(b));
    if (!homes.length || !services.length) return;
    const h = homes[Math.floor(Math.random() * homes.length)];
    if (!this.nearCamera(this.worldPt(h.cx, h.cy), 110)) return;
    const near = services.filter(s => Math.hypot(s.cx - h.cx, s.cy - h.cy) <= BUILDINGS[s.type].range);
    const s = (near.length ? near : services)[Math.floor(Math.random() * (near.length || services.length))];
    const tiles = c.roadPath(h, s);
    if (!tiles || tiles.length < 2) return;
    const a = this.actor(), path = this.pathPoints(tiles);
    const speed = 1.7 + Math.random() * 0.5;
    this.strollers.push({ a, ...path, d: 0, dir: 1, speed, wait: 0, facing: 0, side: (Math.random() - 0.5) * 0.7, mug: BUILDINGS[s.type].service === 'tavern' });
  }

  // ------------------------------------------------------------------ lumberjacks and builders
  /** The sim felled a tree for building `by`: a worker walks over and chops it. */
  chop(by, x, y) {
    const c = this.c, b = c.buildings.get(by);
    if (!b || this.jobs.length > 14) return null;
    const home = this.worldPt(b.cx - 0.5, b.cy - 0.5), tree = this.worldPt(x, y);
    if (!this.nearCamera(tree)) return null;
    const a = this.actor(); this.give(a, 'tool:axe');
    a.root.position.copy(home);
    const job = { a, kind: 'chop', from: home, to: tree.clone().add(tree.clone().sub(home).setY(0).normalize().multiplyScalar(-1.1)), t: 0, phase: 'go', facing: 0, swings: 3 };
    this.jobs.push(job);
    return job;
  }
  /** Construction: a builder hammers in front of the new building for `dur` seconds. */
  build(b, dur) {
    const p = this.worldPt(b.cx - 0.5, b.cy - 0.5 + b.h / 2 + 0.6);
    if (!this.nearCamera(p)) return;
    const a = this.actor(); this.give(a, 'tool:hammer');
    a.root.position.copy(p); a.root.rotation.y = Math.PI;
    this.jobs.push({ a, kind: 'build', t: 0, dur, phase: 'work', facing: Math.PI });
  }

  // ------------------------------------------------------------------ site workers
  syncSiteWorkers() {
    const c = this.c, want = new Set();
    const busy = [...c.buildings.values()].filter(b => SITE_TOOL[b.type] && b.running && c.active(b) && this.nearCamera(this.worldPt(b.cx, b.cy), 70))
      .slice(0, MAX_SITE);
    for (const b of busy) {
      want.add(b.id);
      if (this.site.has(b.id)) continue;
      const a = this.actor(); this.give(a, SITE_TOOL[b.type]);
      const field = BUILDINGS[b.type].field || b.type === 'forester';
      const base = this.worldPt(b.cx - 0.5 + (field ? 0.9 : 0.2), b.cy - 0.5 + b.h / 2 - (field ? 1.2 : 0.1));
      a.root.position.copy(base); a.root.rotation.y = Math.random() * 6.28;
      this.site.set(b.id, { a, base, t: Math.random() * 2, field, facing: a.root.rotation.y });
    }
    for (const [id, w] of this.site) if (!want.has(id)) { this.release(w.a); this.site.delete(id); }
  }

  // ------------------------------------------------------------------ frame update
  update(dt) {
    const c = this.c, t = c.time + c.acc, sp = this.g.speed, adt = dt * (sp || 0);
    // carriers follow the sim's trip timing exactly
    for (const w of this.walkers) {
      const tr = w.trip, out = t < tr.pick;
      const f = out ? (t - tr.start) / (tr.pick - tr.start) : 1 - (t - tr.pick) / (tr.end - tr.pick);
      const { p, dir } = this.at(w, Math.max(0, Math.min(1, f)) * w.total);
      if (!out) dir.negate();
      this.place(w, p, dir, dt);
      if (!out && !w.loaded) {
        w.loaded = true;
        if (w.good) { const piece = this.g.world.kit.piece(w.good.carry); piece.scale.setScalar(0.45); w.a.load.add(piece); }
        w.a.once('PickUp', { speed: 2.5 });
      }
      w.a.setBase('Walking_A'); w.a.update(adt);
      w.done = t >= tr.end || !c.buildings.get(tr.to);
    }
    this.walkers = this.walkers.filter(w => { if (w.done) { this.release(w.a); return false; } return true; });

    // strollers: walk to the service, linger, walk home (real time × game speed)
    if (sp && (this.strollT -= dt) <= 0) {
      this.strollT = 1.2;
      const cap = Math.min(MAX_STROLL, Math.floor(c.pop.total / 8));
      if (this.strollers.length < cap) this.spawnStroller();
    }
    for (const s of this.strollers) {
      if (s.wait > 0) {
        s.wait -= adt; s.a.setBase('Idle_A');
        if (s.wait <= 0) { s.dir = -1; s.a.load.clear(); }
      } else {
        s.d += s.dir * s.speed * adt;
        if (s.dir > 0 && s.d >= s.total) {
          s.d = s.total; s.wait = 3 + Math.random() * 4;
          if (s.mug) { const m = this.g.world.kit.piece('prop:mug_full'); m.scale.setScalar(0.9); m.position.y = -0.4; s.a.load.add(m); }
        }
        if (s.dir < 0 && s.d <= 0) s.done = true;
        s.a.setBase('Walking_B');
      }
      const { p, dir } = this.at(s, Math.max(0, Math.min(s.total, s.d)));
      if (s.dir < 0) dir.negate();
      this.place(s, p, s.wait > 0 ? new THREE.Vector3() : dir, dt);
      s.a.update(adt);
    }
    this.strollers = this.strollers.filter(s => { if (s.done) { this.release(s.a); return false; } return true; });

    // lumberjacks and builders
    for (const j of this.jobs) {
      j.t += adt;
      const a = j.a;
      if (j.kind === 'chop') {
        if (j.phase === 'go' || j.phase === 'back') {
          const from = j.phase === 'go' ? j.from : j.to, to = j.phase === 'go' ? j.to : j.from;
          const len = from.distanceTo(to), k = Math.min(1, j.t * 3 / Math.max(0.5, len));
          a.root.position.lerpVectors(from, to, k);
          const d = to.clone().sub(from); j.facing = turnToward(j.facing, Math.atan2(d.x, d.z), dt * 10); a.root.rotation.y = j.facing;
          a.setBase('Walking_A');
          if (k >= 1) { if (j.phase === 'go') { j.phase = 'chop'; j.t = 0; } else j.done = true; }
        } else if (j.phase === 'chop') {
          a.setBase('Idle_A');
          if (a.busy <= 0) {
            if (j.swings-- > 0) { a.once('Use_Item', { speed: 1.6 }); this.g.ambience?.chop(a.root.position); }
            else { j.phase = 'back'; j.t = 0; j.onFelled?.(); j.onFelled = null; }
          }
        }
      } else if (j.kind === 'build') {
        a.setBase('Idle_A');
        if (a.busy <= 0 && j.t < j.dur) { a.once('Use_Item', { speed: 2 }); this.g.ambience?.hammer(a.root.position); }
        if (j.t >= j.dur) j.done = true;
      }
      a.update(adt);
    }
    this.jobs = this.jobs.filter(j => { if (j.done) { this.release(j.a); return false; } return true; });

    // site workers: swing their tool, farmers wander their field
    if ((this.siteT = (this.siteT || 0) - dt) <= 0) { this.siteT = 1; this.syncSiteWorkers(); }
    for (const [, w] of this.site) {
      w.t += adt;
      if (w.field) {
        const a = w.t * 0.35; w.a.root.position.set(w.base.x + Math.sin(a) * 1.4, 0.05, w.base.z + Math.sin(a * 2) * 0.6);
        w.facing = turnToward(w.facing, Math.atan2(Math.cos(a) * 1.4, Math.cos(a * 2) * 1.2), dt * 6); w.a.root.rotation.y = w.facing;
        w.a.setBase('Walking_A');
        if (w.t % 6 < adt && w.a.busy <= 0) w.a.once('PickUp', { speed: 1.4 });
      } else {
        w.a.setBase('Idle_A');
        if (w.a.busy <= 0 && w.t > 1.2) { w.t = 0; w.a.once('Use_Item', { speed: 1.8 }); }
      }
      w.a.update(adt);
    }
  }

  /** Rebuild after a load (trips in flight are restored from the sim). */
  restore() {
    for (const list of [this.walkers, this.strollers, this.jobs]) for (const w of list) this.release(w.a);
    for (const [, w] of this.site) this.release(w.a);
    this.walkers = []; this.strollers = []; this.jobs = []; this.site.clear();
    for (const tr of this.c.trips || []) this.trip(tr);
  }
}
