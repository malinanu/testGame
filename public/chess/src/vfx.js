// VFX for Wizard's Chess, built on the Brackeys CC0 bundle: sprite-sheet flipbooks, pooled particles,
// rubble debris, procedural lightning and camera shake.
import * as THREE from 'three';

// [cols, rows, frames actually used] measured from the sheets
export const SHEETS = {
  big_hit_6x5: [6, 5, 12], boom_8x8: [8, 8, 64], charge_7x6: [7, 6, 40], electric_ring_6x5: [6, 5, 30],
  explosion_6x5: [6, 5, 27], fire_8x8: [8, 8, 64], fire_ring_6x5: [6, 5, 30], flame_16x4: [16, 4, 64],
  impact_white_6x4: [6, 4, 12], lightstreaks_6x5: [6, 5, 30], smoke_8x8: [8, 8, 64], star_explosion_6x5: [6, 5, 26],
  vortex_6x5: [6, 5, 25], wavy_purple_6x5: [6, 5, 30],
};
const RGB_SHEETS = new Set(['fire_8x8']); // black background, needs additive blending

export class VFX {
  constructor(scene, base = '../assets/vfx/') {
    this.scene = scene; this.base = base; this.loader = new THREE.TextureLoader();
    this.tex = {}; this.live = []; this.speed = 1;
    this.pool = []; this.particles = 0; this.maxParticles = Infinity; // sprites are recycled, never re-created
    this.shakeT = 0; this.shakeAmp = 0;
  }

  texture(name) {
    if (!this.tex[name]) {
      const t = this.loader.load(`${this.base}${name}.png`);
      t.colorSpace = THREE.SRGBColorSpace;
      this.tex[name] = t;
    }
    return this.tex[name];
  }

  preload(names) { names.forEach(n => this.texture(n)); }

  /** Animated sprite sheet. opts: size, duration, loop, color, additive, ground (flat on floor), rotation, opacity */
  sheet(name, pos, opts = {}) {
    const [c, r, frames] = SHEETS[name];
    const map = this.texture(name).clone();
    map.needsUpdate = true;
    map.repeat.set(1 / c, 1 / r);
    const additive = opts.additive ?? RGB_SHEETS.has(name);
    const matOpts = { map, transparent: true, depthWrite: false, color: opts.color ?? 0xffffff, opacity: opts.opacity ?? 1, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending };
    let obj;
    if (opts.ground) {
      obj = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ ...matOpts, side: THREE.DoubleSide }));
      obj.rotation.y = opts.rotation || 0;
    } else {
      obj = new THREE.Sprite(new THREE.SpriteMaterial({ ...matOpts, rotation: opts.rotation || 0 }));
    }
    obj.scale.setScalar(opts.size ?? 2);
    if (opts.ground) obj.scale.y = 1;
    obj.position.copy(pos);
    obj.renderOrder = 5;
    (opts.parent || this.scene).add(obj);
    const fx = { obj, map, c, r, frames, t: 0, dur: opts.duration ?? frames / 30, loop: !!opts.loop, fade: opts.fade ?? 0, kind: 'sheet', drift: opts.drift };
    this.setFrame(fx, 0);
    this.live.push(fx);
    return fx;
  }

  setFrame(fx, i) {
    const col = i % fx.c, row = Math.floor(i / fx.c);
    fx.map.offset.set(col / fx.c, 1 - (row + 1) / fx.r);
  }

  /** Burst of textured particles. */
  burst(pos, { count = 12, tex = 'spark_01_a', color = 0xffffff, speed = 3, life = 0.8, size = 0.4, gravity = -4, additive = true, spread = 1, up = 1, drag = 0.9 } = {}) {
    const map = this.texture(tex);
    count = Math.min(count, this.maxParticles - this.particles);
    for (let i = 0; i < count; i++) {
      const s = this.pool.pop() || new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
      const m = s.material;
      m.map = map; m.color.set(color); m.opacity = 1; m.rotation = Math.random() * 6.28;
      m.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
      s.position.copy(pos); this.particles++;
      const a = Math.random() * Math.PI * 2, e = Math.random() * spread;
      const v = new THREE.Vector3(Math.cos(a) * e, up * (0.4 + Math.random()), Math.sin(a) * e).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      const sz = size * (0.6 + Math.random() * 0.8);
      s.scale.setScalar(sz);
      this.scene.add(s);
      this.live.push({ obj: s, kind: 'particle', v, t: 0, dur: life * (0.6 + Math.random() * 0.6), gravity, drag, size: sz, spin: (Math.random() - 0.5) * 4 });
    }
  }

  /** Physical rubble chunks that bounce on the board and sink. */
  debris(pos, { count = 14, color = 0x9a958c, speed = 5, size = 0.18, floor = 0 } = {}) {
    const geo = new THREE.DodecahedronGeometry(1, 0);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: new THREE.Color(color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.15), roughness: 0.9, flatShading: true, transparent: true }));
      const s = size * (0.5 + Math.random());
      mesh.scale.set(s, s * (0.6 + Math.random() * 0.6), s);
      mesh.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.8, (Math.random() - 0.5) * 0.6));
      mesh.castShadow = true;
      this.scene.add(mesh);
      const a = Math.random() * Math.PI * 2;
      this.live.push({ obj: mesh, kind: 'debris', v: new THREE.Vector3(Math.cos(a) * speed * Math.random(), 2 + Math.random() * speed, Math.sin(a) * speed * Math.random()), spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8), t: 0, dur: 2.4 + Math.random(), floor: floor + s * 0.5 });
    }
  }

  /** Jagged flickering lightning between two points. */
  lightning(from, to, { duration = 0.6, color = 0x9fdcff, width = 0.06, branches = 2 } = {}) {
    const group = new THREE.Group();
    this.scene.add(group);
    const fx = { obj: group, kind: 'lightning', t: 0, dur: duration, from: from.clone(), to: to.clone(), color, width, branches, next: 0 };
    this.rebuildBolt(fx);
    this.live.push(fx);
    return fx;
  }

  rebuildBolt(fx) {
    fx.obj.clear();
    const bolt = (a, b, depth, w) => {
      let pts = [a.clone(), b.clone()];
      let disp = a.distanceTo(b) * 0.22;
      for (let k = 0; k < 5; k++) {
        const next = [pts[0]];
        for (let i = 0; i < pts.length - 1; i++) {
          const m = pts[i].clone().lerp(pts[i + 1], 0.5).add(new THREE.Vector3((Math.random() - 0.5) * disp, (Math.random() - 0.5) * disp, (Math.random() - 0.5) * disp));
          next.push(m, pts[i + 1]);
        }
        pts = next; disp *= 0.55;
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i], q = pts[i + 1], len = p.distanceTo(q);
        for (const [rad, op] of [[w, 1], [w * 4, 0.25]]) {
          const seg = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, 5, 1, true),
            new THREE.MeshBasicMaterial({ color: op === 1 ? 0xffffff : fx.color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false }));
          seg.position.copy(p).lerp(q, 0.5);
          seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), q.clone().sub(p).normalize());
          fx.obj.add(seg);
        }
      }
      if (depth > 0) for (let i = 0; i < fx.branches; i++) {
        const start = pts[Math.floor(pts.length * (0.3 + Math.random() * 0.5))];
        const end = start.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2.5, -Math.random() * 1.5, (Math.random() - 0.5) * 2.5));
        bolt(start, end, depth - 1, w * 0.6);
      }
    };
    bolt(fx.from, fx.to, 1, fx.width);
  }

  shake(amp = 0.3, dur = 0.4) { this.shakeAmp = Math.max(this.shakeAmp, amp); this.shakeT = Math.max(this.shakeT, dur); }

  /** Returns a camera offset for screen shake. */
  update(rawDt) {
    const dt = rawDt * this.speed;
    for (const fx of this.live) {
      fx.t += dt;
      const k = fx.t / fx.dur;
      if (fx.kind === 'sheet') {
        const i = fx.loop ? Math.floor((fx.t / fx.dur) * fx.frames) % fx.frames : Math.min(fx.frames - 1, Math.floor(k * fx.frames));
        this.setFrame(fx, i);
        if (fx.drift) fx.obj.position.addScaledVector(fx.drift, dt);
        if (fx.fade && !fx.loop) fx.obj.material.opacity = Math.min(1, (1 - k) / fx.fade);
      } else if (fx.kind === 'particle') {
        fx.v.y += fx.gravity * dt; fx.v.multiplyScalar(Math.pow(fx.drag, dt * 10));
        fx.obj.position.addScaledVector(fx.v, dt);
        fx.obj.material.opacity = Math.max(0, 1 - k);
        fx.obj.material.rotation += fx.spin * dt;
        fx.obj.scale.setScalar(fx.size * (1 + k * 0.6));
      } else if (fx.kind === 'debris') {
        const o = fx.obj;
        if (o.position.y > fx.floor || fx.v.y > 0) {
          fx.v.y -= 18 * dt; o.position.addScaledVector(fx.v, dt);
          o.rotation.x += fx.spin.x * dt; o.rotation.y += fx.spin.y * dt; o.rotation.z += fx.spin.z * dt;
          if (o.position.y < fx.floor) { o.position.y = fx.floor; fx.v.y *= -0.35; fx.v.x *= 0.6; fx.v.z *= 0.6; fx.spin.multiplyScalar(0.5); if (Math.abs(fx.v.y) < 0.8) fx.v.set(0, 0, 0); }
        }
        if (k > 0.7) { o.material.opacity = Math.max(0, (1 - k) / 0.3); o.position.y -= dt * 0.15; }
      } else if (fx.kind === 'lightning') {
        if (fx.t > fx.next) { this.rebuildBolt(fx); fx.next = fx.t + 0.05; }
        fx.obj.children.forEach(m => { m.material.opacity *= k > 0.7 ? 0.85 : 1; });
      }
    }
    // finished effects: particles go back to the pool, everything else is disposed (swap-remove, O(n))
    for (let i = this.live.length - 1; i >= 0; i--) {
      const fx = this.live[i];
      if (fx.loop || fx.t < fx.dur) continue;
      fx.obj.parent?.remove(fx.obj);
      if (fx.kind === 'particle') { this.particles--; this.pool.push(fx.obj); }
      else { fx.obj.traverse?.(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); fx.map?.dispose?.(); }
      this.live[i] = this.live[this.live.length - 1]; this.live.pop();
    }
    if (this.shakeT > 0) {
      this.shakeT -= rawDt;
      const a = this.shakeAmp * Math.max(0, this.shakeT) * 3;
      if (this.shakeT <= 0) this.shakeAmp = 0;
      return new THREE.Vector3((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
    }
    return null;
  }

  remove(fx) { if (!fx) return; fx.loop = false; fx.t = fx.dur; }
}
