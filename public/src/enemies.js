import * as THREE from 'three';
import { Actor, turnToward } from './actor.js';

const TYPES = {
  grunt: { char: 'Rogue_Hooded', hp: 5,  speed: 3.4, dmg: 8,  scale: 1.0,  tint: new THREE.Color(0xc78bff), weapon: 'dagger', reach: 1.7, radius: 0.5 },
  brute: { char: 'Barbarian',    hp: 11, speed: 2.7, dmg: 16, scale: 1.3,  tint: new THREE.Color(0xff8a70), weapon: 'axe_2handed', reach: 2.4, radius: 0.7 },
};

export class Enemy {
  constructor(game, kind, pos) {
    this.game = game; this.kind = kind; const t = this.t = TYPES[kind];
    this.actor = new Actor(game.assets, t.char, { tint: t.tint, scale: t.scale });
    this.weapon = this.actor.hold(t.weapon, 'R');
    this.root = this.actor.root; this.pos = this.root.position.copy(pos);
    this.hp = t.hp; this.dead = false; this.radius = t.radius; this.cd = 0; this.facing = Math.random() * 6.28;
    this.spawnT = this.actor.once('Spawn_Ground', { speed: 1.4 });
    this.wander = new THREE.Vector3(); this.wanderT = 0; this.knock = new THREE.Vector3();
    this.removeT = 0;
  }

  damage(n, kx, kz) {
    if (this.dead) return;
    this.hp -= n; this.actor.hitFlash();
    this.knock.set(kx * 7, 0, kz * 7);
    if (this.hp <= 0) {
      this.dead = true; this.removeT = 2.2;
      this.actor.once('Death_A', { hold: true, speed: 1.2 });
      this.game.onEnemyKilled(this);
    } else if (this.spawnT <= 0 && this.cd < 0.4) this.actor.once('Hit_B', { speed: 1.8 });
  }

  update(dt) {
    const g = this.game, p = g.player;
    this.actor.update(dt);
    if (this.dead) { this.removeT -= dt; if (this.removeT < 0.8) this.root.position.y -= dt * 0.8; return; }
    this.spawnT -= dt; this.cd -= dt;
    // knockback decay
    if (this.knock.lengthSq() > 0.01) { this.pos.addScaledVector(this.knock, dt); this.knock.multiplyScalar(Math.max(0, 1 - dt * 9)); }
    if (this.spawnT > 0) return;

    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z, d = Math.hypot(dx, dz);
    let move = null;
    if (p.alive && d < 18) {
      this.facing = turnToward(this.facing, Math.atan2(dx, dz), dt * 8);
      if (d > this.t.reach * 0.8) move = new THREE.Vector3(dx / d, 0, dz / d);
      else if (this.cd <= 0 && this.actor.busy <= 0) {
        this.cd = 1.3 + Math.random() * 0.4;
        this.actor.once('Use_Item', { speed: 2 });
        g.later(0.3, () => { if (!this.dead && Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < this.t.reach + 0.6) p.damage(this.t.dmg); });
      }
    } else {
      this.wanderT -= dt;
      if (this.wanderT <= 0) { this.wanderT = 2 + Math.random() * 3; const a = Math.random() * 6.28; this.wander.set(Math.sin(a), 0, Math.cos(a)).multiplyScalar(Math.random() < 0.4 ? 0 : 1); }
      if (this.wander.lengthSq() > 0) { move = this.wander; this.facing = turnToward(this.facing, Math.atan2(move.x, move.z), dt * 5); }
    }
    if (move && this.actor.busy <= 0) { this.pos.addScaledVector(move, this.t.speed * dt * (d < 18 ? 1 : 0.4)); this.actor.setBase(d < 18 ? 'Running_A' : 'Walking_A'); }
    else if (this.actor.busy <= 0) this.actor.setBase('Idle_B');
    g.world.resolve(this.pos, this.radius);
    this.root.rotation.y = this.facing;
  }
}
