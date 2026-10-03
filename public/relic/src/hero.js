// The adventure layer: the Founder hero (third person, adapted from the old Relic Hunt player),
// creatures that guard lairs or raid the colony, projectiles, chests and relic pickup.
import * as THREE from 'three';
import { Actor, turnToward } from '../../src/actor.js';
import { HEROES } from '../../src/player.js';
import { W, H, TILE, LAIR_KINDS, RELICS } from './data.js';
import { T, idx } from './map.js';
import { tileToWorld, worldToTile } from './world3d.js';

export { HEROES };
const GRAVITY = 26, JUMP_V = 9;
const CREATURES = {
  grunt: { char: 'Rogue_Hooded', hp: 6,  speed: 3.6, dmg: 8,  scale: 1.0, tint: 0xc78bff, weapon: 'dagger', reach: 1.7, radius: 0.5 },
  brute: { char: 'Barbarian',    hp: 14, speed: 2.8, dmg: 15, scale: 1.3, tint: 0xff8a70, weapon: 'axe_2handed', reach: 2.4, radius: 0.7 },
};

/** Tile-based collision for walkers: water, rock, buildings and tree trunks block. */
export function resolve(colony, pos, radius = 0.45) {
  const [tx, ty] = worldToTile(pos.x, pos.z);
  for (let y = ty - 1; y <= ty + 1; y++) for (let x = tx - 1; x <= tx + 1; x++) {
    const [cx, cz] = tileToWorld(x, y);
    const out = x < 0 || y < 0 || x >= W || y >= H;
    const k = out ? -1 : idx(x, y);
    const solid = out || colony.ground[k] !== T.GRASS || (colony.occ[k] && colony.buildings.get(colony.occ[k])?.type !== 'outpost');
    if (solid) {
      // push out of the tile square
      const hx = TILE / 2 + radius, dx = pos.x - cx, dz = pos.z - cz;
      if (Math.abs(dx) < hx && Math.abs(dz) < hx) {
        if (hx - Math.abs(dx) < hx - Math.abs(dz)) pos.x = cx + Math.sign(dx || 1) * hx; else pos.z = cz + Math.sign(dz || 1) * hx;
      }
    } else if (colony.tree[k]) {
      const r = 0.45 + radius, dx = pos.x - cx, dz = pos.z - cz, d = Math.hypot(dx, dz);
      if (d < r && d > 1e-4) { pos.x = cx + dx / d * r; pos.z = cz + dz / d * r; }
    }
  }
}

const SHOT = {};

export class Creature {
  constructor(mode, kind, pos, assets, { home = null, raid = null, lair = null } = {}) {
    const t = this.t = CREATURES[kind];
    this.kind = kind; this.mode = mode; this.home = home ? home.clone() : pos.clone(); this.raid = raid; this.lair = lair;
    this.actor = new Actor(assets, t.char, { tint: new THREE.Color(t.tint), scale: t.scale, shared: true });
    this.actor.hold(t.weapon, 'R');
    this.root = this.actor.root; this.pos = this.root.position.copy(pos);
    this.hp = t.hp; this.dead = false; this.radius = t.radius; this.cd = 0; this.facing = Math.random() * 6.28;
    this.wander = new THREE.Vector3(); this.wanderT = 0; this.knock = new THREE.Vector3(); this.removeT = 0;
    this.spawnT = this.actor.once('Spawn_Ground', { speed: 1.4 });
  }
  damage(n, kx = 0, kz = 0) {
    if (this.dead) return false;
    this.hp -= n; this.actor.hitFlash(); this.knock.set(kx * 7, 0, kz * 7);
    if (this.hp <= 0) { this.dead = true; this.removeT = 2.2; this.actor.once('Death_A', { hold: true, speed: 1.2 }); return true; }
    this.actor.once('Hit_B', { speed: 1.8 });
    return false;
  }
  /** hero: Hero or null (when the player is in town view creatures don't chase). */
  update(dt, colony, hero, simTime, tick = (a, d) => a.update(d)) {
    tick(this.actor, dt);
    if (this.dead) { this.removeT -= dt; if (this.removeT < 0.8) this.pos.y -= dt * 0.8; return; }
    this.spawnT -= dt; this.cd -= dt;
    if (this.knock.lengthSq() > 0.01) { this.pos.addScaledVector(this.knock, dt); this.knock.multiplyScalar(Math.max(0, 1 - dt * 9)); }
    if (this.spawnT > 0) return;
    let move = null, run = false;
    const hp = hero?.alive ? hero.pos : null, d = hp ? Math.hypot(hp.x - this.pos.x, hp.z - this.pos.z) : 1e9;
    const aggro = this.mode === 'raid' ? 9 : 13;
    if (hp && d < aggro && Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z) < 26) {
      this.facing = turnToward(this.facing, Math.atan2(hp.x - this.pos.x, hp.z - this.pos.z), dt * 8);
      if (d > this.t.reach * 0.8) { move = new THREE.Vector3(hp.x - this.pos.x, 0, hp.z - this.pos.z).normalize(); run = true; }
      else if (this.cd <= 0 && this.actor.busy <= 0) {
        this.cd = 1.3 + Math.random() * 0.4; this.actor.once('Use_Item', { speed: 2 });
        this.pendingHit = 0.3;
      }
    } else if (this.mode === 'raid' && this.raid) {
      // march toward the target so that we arrive at raid.arrive (sim time)
      const left = Math.max(0.1, this.raid.arrive - simTime), to = this.raid.to;
      const dx = to.x - this.pos.x, dz = to.z - this.pos.z, dd = Math.hypot(dx, dz);
      if (dd > 1.5) { move = new THREE.Vector3(dx / dd, 0, dz / dd); this.marchSpeed = Math.min(6, Math.max(1.5, dd / left)); this.facing = turnToward(this.facing, Math.atan2(dx, dz), dt * 6); }
    } else {
      const dh = Math.hypot(this.home.x - this.pos.x, this.home.z - this.pos.z);
      this.wanderT -= dt;
      if (dh > 8) { this.wander.set(this.home.x - this.pos.x, 0, this.home.z - this.pos.z).normalize(); }
      else if (this.wanderT <= 0) { this.wanderT = 2 + Math.random() * 3; const a = Math.random() * 6.28; this.wander.set(Math.sin(a), 0, Math.cos(a)).multiplyScalar(Math.random() < 0.5 ? 0 : 1); }
      if (this.wander.lengthSq() > 0) { move = this.wander; this.facing = turnToward(this.facing, Math.atan2(move.x, move.z), dt * 5); }
    }
    if (this.pendingHit != null) { this.pendingHit -= dt; if (this.pendingHit <= 0) { this.pendingHit = null; if (hp && Math.hypot(hp.x - this.pos.x, hp.z - this.pos.z) < this.t.reach + 0.6) hero.damage(this.t.dmg); } }
    if (move && this.actor.busy <= 0) {
      const sp = run ? this.t.speed : this.mode === 'raid' ? this.marchSpeed || 2 : this.t.speed * 0.35;
      this.pos.addScaledVector(move, sp * dt);
      this.actor.setBase(run || this.mode === 'raid' ? 'Running_A' : 'Walking_A');
    } else if (this.actor.busy <= 0) this.actor.setBase('Idle_B');
    if (this.mode !== 'raid') resolve(colony, this.pos, this.radius);
    this.root.rotation.y = this.facing;
  }
}

export class Hero {
  constructor(assets, key) {
    this.key = key; this.cfg = HEROES[key] || HEROES.Knight;
    this.actor = new Actor(assets, this.cfg.char);
    this.weapon = this.actor.hold(this.cfg.weapon, 'R');
    if (this.cfg.offhand) this.actor.hold(this.cfg.offhand, 'L');
    this.root = this.actor.root; this.pos = this.root.position; this.vy = 0; this.facing = Math.PI;
    this.maxHp = this.hp = this.cfg.hp; this.cdLeft = 0; this.swing = 0; this.invuln = 0; this.alive = true;
    this.weaponBase = this.weapon.rotation.clone();
    // a little crown so the Founder stands out in the town
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.16, 6, 1, true), new THREE.MeshStandardMaterial({ color: 0xffd54a, metalness: 0.8, roughness: 0.3, side: THREE.DoubleSide }));
    crown.position.y = 2.15; this.root.add(crown);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0.7 }));
    ring.position.y = 0.06; this.root.add(ring);
  }
  get grounded() { return this.pos.y <= 0.001; }
  damage(n) {
    if (!this.alive || this.invuln > 0) return;
    this.hp = Math.max(0, this.hp - n); this.invuln = 0.5; this.actor.hitFlash();
    if (this.hp <= 0) { this.alive = false; this.actor.once('Death_A', { hold: true }); this.onDeath?.(); }
    else if (!this.attacking) this.actor.once('Hit_A', { speed: 1.5 });
  }
  update(dt, input, camYaw, colony, active) {
    if (!this.alive) { this.actor.update(dt); return; }
    this.cdLeft = Math.max(0, this.cdLeft - dt); this.invuln = Math.max(0, this.invuln - dt);
    let mx = 0, mz = 0;
    if (active) { mx = (input.KeyD ? 1 : 0) - (input.KeyA ? 1 : 0); mz = (input.KeyS ? 1 : 0) - (input.KeyW ? 1 : 0); }
    if (active && input.stick) { mx += input.stick.x; mz += input.stick.z; } // touch joystick
    const len = Math.hypot(mx, mz), attacking = this.actor.busy > 0 && this.attacking;
    if (!(this.actor.busy > 0)) this.attacking = false;
    if (len > 0) {
      mx /= len; mz /= len;
      const s = Math.sin(camYaw), c = Math.cos(camYaw);
      const wx = mx * c + mz * s, wz = -mx * s + mz * c;
      const sp = this.cfg.speed * (attacking ? 0.45 : 1.15);
      this.pos.x += wx * sp * dt; this.pos.z += wz * sp * dt;
      this.facing = turnToward(this.facing, Math.atan2(wx, wz), dt * 16);
    }
    if (active && input.Space && this.grounded) this.vy = JUMP_V;
    this.vy -= GRAVITY * dt; this.pos.y += this.vy * dt;
    if (this.pos.y < 0) { this.pos.y = 0; this.vy = 0; }
    resolve(colony, this.pos);
    this.root.rotation.y = this.facing;
    if (!this.grounded) this.actor.setBase('Jump_Idle'); else this.actor.setBase(len > 0 ? 'Running_B' : 'Idle_A');
    this.actor.update(dt);
    if (this.swing > 0) {
      this.swing = Math.max(0, this.swing - dt);
      const t = 1 - this.swing / 0.28, k = Math.sin(t * Math.PI);
      this.weapon.rotation.set(this.weaponBase.x - k * 1.9, this.weaponBase.y, this.weaponBase.z + k * 0.5);
    } else this.weapon.rotation.copy(this.weaponBase);
  }
}

/** Runs the hero, creatures, projectiles and adventure interactions. */
export class Adventure {
  constructor(game) {
    this.g = game; this.creatures = []; this.projectiles = []; this.timers = [];
    this.hero = new Hero(game.assets, game.colony.hero.cls);
    const [hx, hz] = tileToWorld(game.colony.hero.x, game.colony.hero.y);
    this.hero.pos.set(hx, 0, hz);
    this.hero.onDeath = () => this.onHeroDeath();
    game.scene.add(this.hero.root);
    this.revealT = 0; this.active = false;
  }
  get c() { return this.g.colony; }
  later(sec, fn) { this.timers.push({ t: sec, fn }); }

  heroTile() { return worldToTile(this.hero.pos.x, this.hero.pos.z); }

  /** Lazily spawn guards at found, uncleared lairs near the hero. */
  syncGuards() {
    const c = this.c, hp = this.hero.pos;
    for (const l of c.lairs) {
      if (!l.found || l.cleared) continue;
      const [lx, lz] = tileToWorld(l.x + 1, l.y + 1);
      const near = Math.hypot(lx - hp.x, lz - hp.z) < 70;
      const mine = this.creatures.filter(k => k.lair === l.id);
      if (near && !mine.length && !l.spawnedDead) {
        LAIR_KINDS[l.kind].guards.forEach((kind, i) => {
          const a = i / LAIR_KINDS[l.kind].guards.length * Math.PI * 2;
          const cr = new Creature('guard', kind, new THREE.Vector3(lx + Math.sin(a) * 2.5, 0, lz + Math.cos(a) * 2.5), this.g.assets, { lair: l.id, home: new THREE.Vector3(lx, 0, lz) });
          this.creatures.push(cr); this.g.scene.add(cr.root);
        });
      }
    }
  }

  /** A raid arrives from the sim: spawn marching creatures. */
  spawnRaid(raid) {
    const c = this.c, l = c.lairs.find(q => q.id === raid.lair), b = c.buildings.get(raid.target);
    if (!l || !b) return;
    const [lx, lz] = tileToWorld(l.x + 1, l.y + 1), [tx, tz] = tileToWorld(b.cx - 0.5, b.cy - 0.5);
    const kinds = LAIR_KINDS[l.kind].guards.slice(0, 3);
    raid.alive = kinds.length;
    kinds.forEach((kind, i) => {
      const cr = new Creature('raid', kind, new THREE.Vector3(lx + i * 1.2, 0, lz + (i % 2) * 1.2), this.g.assets, { raid: { id: raid.id, arrive: raid.arrive, to: new THREE.Vector3(tx + (i - 1) * 1.4, 0, tz + 2.5) } });
      this.creatures.push(cr); this.g.scene.add(cr.root);
    });
  }
  endRaid(raid, outcome) {
    for (const k of this.creatures) if (k.raid?.id === raid.id && !k.dead) {
      if (outcome === 'tower' || outcome === 'repelled') { k.damage(99); this.g.fx?.burst(k.pos.clone().setY(1), { tex: 'spark_01_a', color: 0xffd54a, count: 8 }); }
      else { k.mode = 'guard'; k.home = k.pos.clone(); k.despawn = 25; }
    }
  }

  nearestCreature(pos, range) {
    let best = null, bd = range;
    for (const k of this.creatures) { if (k.dead) continue; const d = Math.hypot(k.pos.x - pos.x, k.pos.z - pos.z); if (d < bd) { bd = d; best = k; } }
    return best;
  }

  attack() {
    const h = this.hero, c = h.cfg;
    if (!h.alive || h.cdLeft > 0) return;
    h.cdLeft = c.cd; h.attacking = true;
    const target = this.nearestCreature(h.pos, c.ranged ? 24 : 6);
    if (target) h.facing = Math.atan2(target.pos.x - h.pos.x, target.pos.z - h.pos.z);
    h.root.rotation.y = h.facing;
    const dir = new THREE.Vector3(Math.sin(h.facing), 0, Math.cos(h.facing));
    if (c.ranged) {
      h.actor.once('Throw', { speed: 2.4 });
      this.later(0.18, () => this.shoot(h.pos.clone().setY(h.pos.y + 1.2).addScaledVector(dir, 0.6), dir, c.ranged, c.dmg));
    } else {
      h.actor.once('Use_Item', { speed: 2.6 }); h.swing = 0.28;
      this.g.sfx?.whoosh();
      this.later(0.14, () => {
        for (const e of this.creatures) {
          if (e.dead) continue;
          const dx = e.pos.x - h.pos.x, dz = e.pos.z - h.pos.z, d = Math.hypot(dx, dz);
          if (d > c.range + e.radius) continue;
          const diff = Math.abs(turnToward(h.facing, Math.atan2(dx, dz), 9) - h.facing);
          if (d < 1.2 || diff < 1.1) this.hit(e, c.dmg, dx / (d || 1), dz / (d || 1));
        }
      });
    }
  }
  shoot(pos, dir, kind, dmg) {
    const P = SHOT[kind === 'orb' ? 'orb' : 'arrow'] ||= kind === 'orb'
      ? { geo: new THREE.SphereGeometry(0.22, 10, 8), mat: new THREE.MeshBasicMaterial({ color: 0x9be7ff }) }
      : { geo: new THREE.CylinderGeometry(0.04, 0.04, 0.9, 5).rotateX(Math.PI / 2), mat: new THREE.MeshBasicMaterial({ color: 0xffe0a0 }) };
    const mesh = new THREE.Mesh(P.geo, P.mat); // shared geometry + material: nothing to dispose per shot
    mesh.position.copy(pos); mesh.lookAt(pos.clone().add(dir));
    this.g.scene.add(mesh);
    this.projectiles.push({ mesh, dir: dir.clone(), speed: kind === 'orb' ? 20 : 28, life: 1.2, dmg });
    this.g.sfx?.[kind === 'orb' ? 'zap' : 'twang']?.();
  }
  hit(e, dmg, kx, kz) {
    this.g.sfx?.thud();
    this.g.fx?.burst(e.pos.clone().setY(1.1), { tex: 'spark_01_a', color: 0xffe0a0, count: 6, speed: 4, life: 0.4 });
    if (e.damage(dmg, kx, kz)) this.onKill(e);
  }
  onKill(e) {
    const c = this.c;
    if (e.lair) {
      const left = this.creatures.filter(k => k.lair === e.lair && !k.dead).length;
      if (!left) { const l = c.clearLair(e.lair); if (l) { this.g.sfx?.chime(); l.spawnedDead = true; } }
    }
    if (e.raid) {
      const others = this.creatures.filter(k => k.raid?.id === e.raid.id && !k.dead).length;
      if (!others) { c.repelRaid(e.raid.id); c.notify('Your Founder drove off the raiders!', 'good'); }
    }
  }

  onHeroDeath() {
    const c = this.c;
    this.g.sfx?.doom();
    if (c.hero.carry) {
      const l = c.lairs.find(q => q.relic === c.hero.carry); if (l) l.relicTaken = false;
      c.hero.carry = null; c.emit('relicTaken', {});
      c.notify('Your Founder fell and dropped the relic. It is back at its lair.', 'bad');
    } else c.notify('Your Founder fell! They will be carried back to the Town Hall.', 'bad');
    this.later(4, () => {
      const th = c.ofType('townhall')[0], [x, z] = tileToWorld(th.cx - 0.5, th.cy + 2.5);
      const h = this.hero; h.alive = true; h.hp = h.maxHp; h.pos.set(x, 0, z); h.actor.dead = false; h.actor.busy = 0; h.actor.cur = null; h.actor.base = null;
      h.actor.mixer.stopAllAction(); h.actor.setBase('Idle_A');
    });
  }

  /** What the hero can interact with right now (for the prompt and the E key). */
  interaction() {
    const c = this.c, hp = this.hero.pos;
    for (const ch of c.chests) if (ch.found && !ch.opened) { const [x, z] = tileToWorld(ch.x, ch.y); if (Math.hypot(x - hp.x, z - hp.z) < 2.4) return { kind: 'chest', id: ch.id, text: 'E: open the chest' }; }
    for (const l of c.lairs) if (l.cleared && l.relic && !l.relicTaken) { const [x, z] = tileToWorld(l.x + 1.45, l.y + 1.2); if (Math.hypot(x - hp.x, z - hp.z) < 3.2) return { kind: 'relic', id: l.id, text: c.hero.carry ? 'You can carry only one relic' : `E: take the ${RELICS.find(r => r.id === l.relic).name}` }; }
    if (c.hero.carry) { const th = c.ofType('townhall')[0], [x, z] = tileToWorld(th.cx - 0.5, th.cy - 0.5); if (Math.hypot(x - hp.x, z - hp.z) < 10) return { kind: 'deliver', text: 'E: enshrine the relic in the Town Hall' }; }
    return null;
  }
  interact() {
    const it = this.interaction(), c = this.c;
    if (!it) return;
    if (it.kind === 'chest') { c.openChest(it.id); this.g.sfx?.chime(); }
    else if (it.kind === 'relic') { if (c.takeRelic(it.id)) this.g.sfx?.magic(); }
    else if (it.kind === 'deliver') { if (c.deliverRelic()) { this.g.sfx?.magic(); this.g.fx?.burst(this.hero.pos.clone().setY(2), { tex: 'star_06_a', color: 0xffd54a, count: 30, speed: 6, life: 1.4 }); } }
  }

  update(dt, input, camYaw, active) {
    this.active = active;
    for (const t of this.timers) t.t -= dt;
    const due = this.timers.filter(t => t.t <= 0); this.timers = this.timers.filter(t => t.t > 0); due.forEach(t => t.fn());
    const h = this.hero;
    h.update(dt, input, camYaw, this.c, active);
    // regenerate inside your territory
    const [tx, ty] = this.heroTile();
    if (h.alive && tx >= 0 && ty >= 0 && tx < W && ty < H && this.c.owned[idx(tx, ty)]) h.hp = Math.min(h.maxHp, h.hp + dt * 6);
    if ((this.revealT -= dt) <= 0) { this.revealT = 0.4; if (active && tx >= 0 && ty >= 0 && tx < W && ty < H) this.c.heroAt(tx + 0.5, ty + 0.5); this.syncGuards(); }
    const simTime = this.c.time;
    const u = this.g.units, tick = u?.frustum ? (a, d) => u.tick(a, d) : undefined;
    for (const k of this.creatures) {
      k.update(dt, this.c, active ? h : null, simTime, tick);
      if (k.despawn != null && (k.despawn -= dt) <= 0) { k.dead = true; k.removeT = 0; }
    }
    this.creatures = this.creatures.filter(k => { if (k.dead && k.removeT <= 0) { this.g.scene.remove(k.root); return false; } return true; });
    for (const p of this.projectiles) {
      p.life -= dt; p.mesh.position.addScaledVector(p.dir, p.speed * dt);
      for (const e of this.creatures) {
        if (e.dead) continue;
        if (Math.hypot(e.pos.x - p.mesh.position.x, e.pos.z - p.mesh.position.z) < e.radius + 0.4) { this.hit(e, p.dmg, p.dir.x, p.dir.z); p.life = 0; break; }
      }
    }
    this.projectiles = this.projectiles.filter(p => { if (p.life <= 0) { this.g.scene.remove(p.mesh); return false; } return true; });
  }
}
