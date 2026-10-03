import * as THREE from 'three';
import { World } from './world.js';
import { Player, HEROES } from './player.js';
import { Enemy } from './enemies.js';

const RELICS = 5;
const $ = id => document.getElementById(id);

export class Game {
  constructor(canvas, assets) {
    this.assets = assets;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25)); // the hub's moving backdrop does not need retina pixels
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 0.95;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 220);
    this.clock = new THREE.Clock();
    this.input = { w: 0, a: 0, s: 0, d: 0, jump: false };
    this.yaw = 0; this.pitch = 0.35; this.camDist = 7.5;
    this.state = 'menu'; this.timers = []; this.enemies = []; this.projectiles = []; this.pickups = []; this.relics = [];
    this.world = new World(this.scene, assets);
    this.bindEvents(canvas);
    addEventListener('resize', () => this.resize()); this.resize();
    this.menuOrbit = 0;
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
  }

  bindEvents(canvas) {
    const keys = { KeyW: 'w', ArrowUp: 'w', KeyA: 'a', ArrowLeft: 'a', KeyS: 's', ArrowDown: 's', KeyD: 'd', ArrowRight: 'd' };
    addEventListener('keydown', e => {
      if (keys[e.code]) this.input[keys[e.code]] = 1;
      if (e.code === 'Space' && this.state === 'play') { this.input.jump = true; e.preventDefault(); } // the hub page keeps Space for scrolling / buttons
      if (e.code === 'KeyF' && this.state === 'play') this.player.attack();
    });
    addEventListener('keyup', e => { if (keys[e.code]) this.input[keys[e.code]] = 0; if (e.code === 'Space') this.input.jump = false; });
    addEventListener('mousemove', e => {
      if (this.state !== 'play' || (document.pointerLockElement !== canvas && !(e.buttons & 2))) return;
      this.yaw -= e.movementX * 0.0035; this.pitch = THREE.MathUtils.clamp(this.pitch + e.movementY * 0.0035, -0.1, 1.2);
    });
    canvas.addEventListener('mousedown', e => {
      if (this.state !== 'play') return;
      if (e.button === 0) { if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.(); this.player.attack(); }
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => { this.camDist = THREE.MathUtils.clamp(this.camDist + e.deltaY * 0.005, 4, 14); });
  }

  later(sec, fn) { this.timers.push({ t: sec, fn }); }

  start(heroKey) {
    this.reset();
    this.player = new Player(this, heroKey);
    this.scene.add(this.player.root);
    this.state = 'play'; this.kills = 0; this.collected = 0; this.spawnTimer = 3; this.portal = null;
    this.yaw = 0;
    for (let i = 0; i < RELICS; i++) this.addRelic();
    for (let i = 0; i < 6; i++) this.spawnEnemy();
    $('menu').classList.add('hidden'); $('hub').classList.add('hidden'); $('end').classList.add('hidden'); $('hud').classList.remove('hidden');
    $('relicn').textContent = 0; $('killn').textContent = 0;
    this.setObjective('Find the glowing relics'); this.toast('Find the 5 relics!');
    $('c').requestPointerLock?.();
  }

  reset() {
    for (const o of [...this.enemies, this.player].filter(Boolean)) this.scene.remove(o.root);
    for (const o of [...this.projectiles, ...this.pickups, ...this.relics]) this.scene.remove(o.mesh);
    if (this.portal) this.scene.remove(this.portal.mesh);
    this.enemies = []; this.projectiles = []; this.pickups = []; this.relics = []; this.timers = [];
  }

  // ---------- spawning ----------
  addRelic() {
    let pos;
    for (let i = 0; i < 60; i++) {
      pos = this.world.randomFreeSpot(22, 56, 3);
      if (this.relics.every(r => r.mesh.position.distanceTo(pos) > 25)) break;
    }
    const mesh = new THREE.Group();
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), new THREE.MeshStandardMaterial({ color: 0xffd54a, emissive: 0xffa800, emissiveIntensity: 1.6, metalness: .3, roughness: .2 }));
    gem.position.y = 1.4; gem.castShadow = true;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 60, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.position.y = 30;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 8, 32).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe9a0 }));
    ring.position.y = 0.1;
    mesh.add(gem, beam, ring); mesh.position.copy(pos); this.scene.add(mesh);
    this.relics.push({ mesh, gem });
  }

  spawnEnemy() {
    const p = this.player.pos;
    let pos;
    for (let i = 0; i < 40; i++) { pos = this.world.randomFreeSpot(8, 58, 1.5); if (pos.distanceTo(p) > 20) break; }
    const e = new Enemy(this, Math.random() < 0.25 ? 'brute' : 'grunt', pos);
    this.scene.add(e.root); this.enemies.push(e);
  }

  nearestEnemy(from, maxD) {
    let best = null, bd = maxD;
    for (const e of this.enemies) { if (e.dead) continue; const d = from.distanceTo(e.pos); if (d < bd) { bd = d; best = e; } }
    return best;
  }

  spawnProjectile(pos, dir, kind, dmg) {
    const isOrb = kind === 'orb';
    const mesh = isOrb
      ? new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), new THREE.MeshBasicMaterial({ color: 0x7fd0ff }))
      : new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe8d9b0 }));
    mesh.position.copy(pos);
    if (!isOrb) mesh.lookAt(pos.clone().add(dir));
    this.scene.add(mesh);
    this.projectiles.push({ mesh, vel: dir.clone().multiplyScalar(isOrb ? 20 : 28), life: 1.2, dmg });
  }

  onEnemyKilled(e) {
    this.kills++; $('killn').textContent = this.kills;
    if (Math.random() < 0.3) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), new THREE.MeshStandardMaterial({ color: 0xff5a5a, emissive: 0xff2020, emissiveIntensity: 1.2 }));
      mesh.position.set(e.pos.x, 0.7, e.pos.z); this.scene.add(mesh); this.pickups.push({ mesh });
    }
  }

  // ---------- flow ----------
  setObjective(t) { $('objective').textContent = t; }
  toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(this._tt); this._tt = setTimeout(() => el.classList.remove('on'), 1800); }

  win() { this.end('Victory!', `You recovered all relics and defeated ${this.kills} foes.`); }
  lose() { this.later(1.6, () => this.end('Defeated', `You fell with ${this.collected}/${RELICS} relics and ${this.kills} foes slain.`)); }
  end(title, text) {
    if (this.state !== 'play') return;
    this.state = 'over'; document.exitPointerLock?.();
    $('endtitle').textContent = title; $('endtext').textContent = text; $('end').classList.remove('hidden');
  }

  // ---------- loop ----------
  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05), time = this.clock.elapsedTime;
    this.timers = this.timers.filter(t => (t.t -= dt) > 0 || (t.fn(), false));
    if (this.state === 'menu') { this.menuOrbit += dt * 0.12; this.camera.position.set(Math.sin(this.menuOrbit) * 30, 14, Math.cos(this.menuOrbit) * 30); this.camera.lookAt(0, 3, 0); }
    else this.updatePlay(dt, time);
    this.renderer.render(this.scene, this.camera);
  }

  updatePlay(dt, time) {
    const p = this.player;
    p.update(dt, this.input, this.yaw);
    for (const e of this.enemies) e.update(dt);
    this.enemies = this.enemies.filter(e => { if (e.dead && e.removeT <= 0) { this.scene.remove(e.root); return false; } return true; });

    // projectiles
    this.projectiles = this.projectiles.filter(pr => {
      pr.mesh.position.addScaledVector(pr.vel, dt); pr.life -= dt;
      let hit = false;
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (Math.hypot(e.pos.x - pr.mesh.position.x, e.pos.z - pr.mesh.position.z) < e.radius + 0.5) {
          e.damage(pr.dmg, pr.vel.x * 0.05, pr.vel.z * 0.05); hit = true; break;
        }
      }
      if (this.world.colliders.some(k => (k.x - pr.mesh.position.x) ** 2 + (k.z - pr.mesh.position.z) ** 2 < k.r * k.r)) hit = true;
      if (hit || pr.life <= 0) { this.scene.remove(pr.mesh); return false; }
      return true;
    });

    // relics
    for (const r of this.relics) { r.gem.rotation.y = time * 2; r.gem.position.y = 1.4 + Math.sin(time * 2.5) * 0.15; }
    this.relics = this.relics.filter(r => {
      if (r.mesh.position.distanceTo(p.pos) < 1.8) {
        this.scene.remove(r.mesh); this.collected++; $('relicn').textContent = this.collected;
        this.toast(this.collected < RELICS ? `Relic ${this.collected}/${RELICS}` : 'All relics found!');
        p.heal(20);
        if (this.collected === RELICS) this.openPortal();
        return false;
      }
      return true;
    });

    // health pickups
    this.pickups = this.pickups.filter(h => {
      h.mesh.position.y = 0.7 + Math.sin(time * 4) * 0.1;
      if (h.mesh.position.distanceTo(p.pos.clone().setY(0.7)) < 1.4) { p.heal(25); this.scene.remove(h.mesh); return false; }
      return true;
    });

    // portal
    if (this.portal) {
      this.portal.ring.rotation.z = time; this.portal.mesh.position.y = Math.sin(time * 2) * 0.1;
      if (Math.hypot(p.pos.x, p.pos.z) < 2.2) this.win();
    }

    // reinforcements
    this.spawnTimer -= dt;
    const cap = 8 + this.collected * 2;
    if (this.spawnTimer <= 0) { this.spawnTimer = 6; if (this.enemies.filter(e => !e.dead).length < cap) this.spawnEnemy(); }

    this.updateCamera(dt); this.updateHud();
  }

  openPortal() {
    const mesh = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.18, 12, 48), new THREE.MeshStandardMaterial({ color: 0x9be7ff, emissive: 0x2fb7ff, emissiveIntensity: 1.5 }));
    ring.position.y = 1.9;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.5, 32), new THREE.MeshBasicMaterial({ color: 0x7fd0ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    disc.position.y = 1.9;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 60, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0x7fd0ff, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.position.y = 30;
    mesh.add(ring, disc, beam); this.scene.add(mesh); this.portal = { mesh, ring: new THREE.Group() };
    this.portal.ring = ring; ring.rotation.set(0, 0, 0);
    this.setObjective('Return to the portal at the center!');
  }

  updateCamera(dt) {
    const p = this.player.pos, cp = Math.cos(this.pitch), d = this.camDist;
    const target = new THREE.Vector3(p.x, p.y + 1.6, p.z);
    const want = new THREE.Vector3(target.x + Math.sin(this.yaw) * cp * d, target.y + Math.sin(this.pitch) * d, target.z + Math.cos(this.yaw) * cp * d);
    want.y = Math.max(want.y, 0.5);
    this.camera.position.lerp(want, 1 - Math.exp(-14 * dt));
    this.camera.lookAt(target);
    this.world.sun.target.position.set(p.x, 0, p.z);
    this.world.sun.position.set(p.x + 30, 50, p.z + 20);
  }

  updateHud() {
    const p = this.player;
    $('hpbar').style.width = (p.hp / p.maxHp * 100) + '%'; $('hptxt').textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
    let target = null, bd = 1e9;
    if (this.portal) target = new THREE.Vector3();
    else for (const r of this.relics) { const d = r.mesh.position.distanceTo(p.pos); if (d < bd) { bd = d; target = r.mesh.position; } }
    if (target) {
      const dx = target.x - p.pos.x, dz = target.z - p.pos.z;
      const f = [-Math.sin(this.yaw), -Math.cos(this.yaw)], r = [Math.cos(this.yaw), -Math.sin(this.yaw)];
      const ang = Math.atan2(dx * r[0] + dz * r[1], dx * f[0] + dz * f[1]);
      $('arrow').style.transform = `rotate(${ang}rad)`;
    }
  }
}

export function buildMenu(onPick, onStart) {
  const el = $('heroes'), all = Object.values(HEROES);
  const top = { hp: Math.max(...all.map(h => h.hp)), speed: Math.max(...all.map(h => h.speed)), power: Math.max(...all.map(h => h.dmg / h.cd)) };
  const bar = (label, v) => `<div class="stat"><span>${label}</span><i><em style="width:${Math.round(v * 100)}%"></em></i></div>`;
  for (const [k, h] of Object.entries(HEROES)) {
    const b = document.createElement('button'); b.className = 'hero'; b.dataset.hero = k;
    b.innerHTML = `<div class="portrait" style="background-image:url(assets/ui/hero-${k.toLowerCase()}.webp)"><span class="role">${h.ranged ? '🏹 Ranged' : '⚔️ Melee'}</span></div>
      <b>${k}</b><small>${h.blurb}</small>${bar('Health', h.hp / top.hp)}${bar('Speed', h.speed / top.speed)}${bar('Power', h.dmg / h.cd / top.power)}`;
    b.onclick = () => onPick(k);
    b.ondblclick = () => { onPick(k); onStart(); };
    el.appendChild(b);
  }
}
