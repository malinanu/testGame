import * as THREE from 'three';
import { Actor, turnToward } from './actor.js';

export const HEROES = {
  Knight:    { char: 'Knight',    hp: 120, speed: 6.0, dmg: 2, cd: 0.55, range: 2.8, weapon: 'sword_1handed', offhand: 'shield_round', blurb: 'Sturdy sword & shield fighter.' },
  Barbarian: { char: 'Barbarian', hp: 150, speed: 5.6, dmg: 4, cd: 0.90, range: 3.2, weapon: 'axe_2handed',   blurb: 'Slow, brutal, huge axe swings.' },
  Rogue:     { char: 'Rogue',     hp: 90,  speed: 7.6, dmg: 1.5, cd: 0.30, range: 2.7, weapon: 'dagger', offhand: 'dagger', blurb: 'Fast and slippery, rapid stabs.' },
  Mage:      { char: 'Mage',      hp: 80,  speed: 6.2, dmg: 3, cd: 0.65, ranged: 'orb',   weapon: 'staff', blurb: 'Fires arcane bolts from range.' },
  Ranger:    { char: 'Ranger',    hp: 95,  speed: 6.8, dmg: 2, cd: 0.50, ranged: 'arrow', weapon: 'bow',   blurb: 'Keeps distance with a longbow.' },
};

const GRAVITY = 26, JUMP_V = 9;

export class Player {
  constructor(game, key) {
    this.game = game; this.key = key; this.cfg = HEROES[key];
    this.actor = new Actor(game.assets, this.cfg.char);
    this.weapon = this.actor.hold(this.cfg.weapon, 'R');
    if (this.cfg.offhand) this.actor.hold(this.cfg.offhand, 'L');
    this.root = this.actor.root;
    this.pos = this.root.position; this.vy = 0; this.facing = Math.PI; this.root.rotation.y = this.facing;
    this.maxHp = this.hp = this.cfg.hp; this.cdLeft = 0; this.swing = 0; this.invuln = 0;
    this.weaponBase = this.weapon.rotation.clone();
    this.alive = true;
  }

  get grounded() { return this.pos.y <= 0.001; }

  update(dt, input, camYaw) {
    const g = this.game;
    if (!this.alive) { this.actor.update(dt); return; }
    this.cdLeft = Math.max(0, this.cdLeft - dt);
    this.invuln = Math.max(0, this.invuln - dt);

    // movement relative to camera
    let mx = (input.d ? 1 : 0) - (input.a ? 1 : 0), mz = (input.s ? 1 : 0) - (input.w ? 1 : 0);
    const len = Math.hypot(mx, mz);
    const attacking = this.actor.busy > 0 && this.attacking;
    if (!(this.actor.busy > 0)) this.attacking = false;
    if (len > 0) {
      mx /= len; mz /= len;
      const s = Math.sin(camYaw), c = Math.cos(camYaw);
      const wx = mx * c + mz * s, wz = -mx * s + mz * c;
      const sp = this.cfg.speed * (attacking ? 0.45 : 1);
      this.pos.x += wx * sp * dt; this.pos.z += wz * sp * dt;
      this.facing = turnToward(this.facing, Math.atan2(wx, wz), dt * 16);
    }
    if (input.jump && this.grounded) { this.vy = JUMP_V; }
    this.vy -= GRAVITY * dt; this.pos.y += this.vy * dt;
    if (this.pos.y < 0) { this.pos.y = 0; this.vy = 0; }
    g.world.resolve(this.pos);
    this.root.rotation.y = this.facing;

    // animation state
    if (!this.grounded) this.actor.setBase('Jump_Idle');
    else this.actor.setBase(len > 0 ? 'Running_B' : 'Idle_A');
    this.actor.update(dt);

    // procedural weapon swing (the free pack has no attack clips)
    if (this.swing > 0) {
      this.swing = Math.max(0, this.swing - dt);
      const t = 1 - this.swing / 0.28, k = Math.sin(t * Math.PI);
      this.weapon.rotation.set(this.weaponBase.x - k * 1.9, this.weaponBase.y, this.weaponBase.z + k * 0.5);
    } else this.weapon.rotation.copy(this.weaponBase);
  }

  attack() {
    const g = this.game, c = this.cfg;
    if (!this.alive || this.cdLeft > 0) return;
    this.cdLeft = c.cd; this.attacking = true;
    const target = g.nearestEnemy(this.pos, c.ranged ? 24 : 6);
    if (target) this.facing = Math.atan2(target.pos.x - this.pos.x, target.pos.z - this.pos.z);
    this.root.rotation.y = this.facing;
    const dir = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
    if (c.ranged) {
      this.actor.once('Throw', { speed: 2.4 });
      g.later(0.18, () => g.spawnProjectile(this.pos.clone().setY(this.pos.y + 1.2).addScaledVector(dir, 0.6), dir, c.ranged, c.dmg));
    } else {
      this.actor.once('Use_Item', { speed: 2.6 });
      this.swing = 0.28;
      g.later(0.14, () => {
        for (const e of g.enemies) {
          if (e.dead) continue;
          const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z, d = Math.hypot(dx, dz);
          if (d > c.range + e.radius) continue;
          const diff = Math.abs(turnToward(this.facing, Math.atan2(dx, dz), 9) - this.facing);
          if (d < 1.2 || diff < 1.1) e.damage(c.dmg, dx / (d || 1), dz / (d || 1));
        }
      });
    }
  }

  damage(n) {
    if (!this.alive || this.invuln > 0) return;
    this.hp = Math.max(0, this.hp - n); this.invuln = 0.5;
    this.actor.hitFlash();
    if (this.hp <= 0) { this.alive = false; this.actor.once('Death_A', { hold: true }); this.game.lose(); }
    else if (!this.attacking) this.actor.once('Hit_A', { speed: 1.5 });
  }

  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); }
}
