import * as THREE from 'three';
import { firstMesh } from './assets.js';

export const ARENA_R = 64;

function rng(seed) { // mulberry32
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export class World {
  constructor(scene, assets, seed = 7) {
    this.scene = scene; this.colliders = []; this.rand = rng(seed);
    scene.background = new THREE.Color(0xa9d8cf);
    scene.fog = new THREE.Fog(0xa9d8cf, 35, 95);

    scene.add(new THREE.HemisphereLight(0xdff6ff, 0x3f5a35, 1.1));
    this.sun = new THREE.DirectionalLight(0xfff1d0, 2.4);
    this.sun.position.set(30, 50, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const c = this.sun.shadow.camera; c.left = c.bottom = -38; c.right = c.top = 38; c.near = 1; c.far = 140;
    this.sun.shadow.bias = -0.0004;
    scene.add(this.sun, this.sun.target);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(110, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x6fae4f, roughness: 1 }));
    ground.receiveShadow = true; scene.add(ground);

    this.populate(assets);
  }

  /** Place `count` instances of an asset, optionally registering circle colliders. */
  scatter(assets, name, count, { minR = 0, maxR = ARENA_R, scale = [1, 1], radius = 0, minGap = 0, shadow = true, tilt = 0 } = {}) {
    const mesh = firstMesh(assets.forest[name]);
    const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, count);
    inst.castShadow = shadow; inst.receiveShadow = true; inst.frustumCulled = false;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    let n = 0, tries = 0;
    while (n < count && tries++ < count * 40) {
      const ang = this.rand() * Math.PI * 2, r = minR + Math.sqrt(this.rand()) * (maxR - minR);
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      if (minGap && this.colliders.some(k => (k.x - x) ** 2 + (k.z - z) ** 2 < (k.r + minGap) ** 2)) continue;
      const s = scale[0] + this.rand() * (scale[1] - scale[0]);
      e.set((this.rand() - .5) * tilt, this.rand() * Math.PI * 2, (this.rand() - .5) * tilt);
      m.compose(new THREE.Vector3(x, 0, z), q.setFromEuler(e), new THREE.Vector3(s, s, s));
      inst.setMatrixAt(n++, m);
      if (radius) this.colliders.push({ x, z, r: radius * s });
    }
    inst.count = n; this.scene.add(inst);
  }

  populate(a) {
    const spawnClear = 7;
    // dense boundary wall of trees + rocks
    for (const t of ['Tree_1_A', 'Tree_2_A', 'Tree_3_A', 'Tree_4_A'])
      this.scatter(a, t, 40, { minR: ARENA_R, maxR: ARENA_R + 14, scale: [1.1, 1.5], radius: 1.1 });
    // interior forest
    for (const t of ['Tree_1_B', 'Tree_2_B', 'Tree_3_B', 'Tree_4_B'])
      this.scatter(a, t, 22, { minR: spawnClear, maxR: ARENA_R - 2, scale: [.9, 1.3], radius: 1.1, minGap: 2.2 });
    for (const t of ['Tree_Bare_1_A', 'Tree_Bare_2_A'])
      this.scatter(a, t, 8, { minR: 18, maxR: ARENA_R - 2, scale: [.9, 1.2], radius: .8, minGap: 2.2 });
    for (const t of ['Rock_1_A', 'Rock_1_E', 'Rock_2_A', 'Rock_3_A', 'Rock_3_F'])
      this.scatter(a, t, 9, { minR: spawnClear, maxR: ARENA_R - 2, scale: [1, 2], radius: 1.1, minGap: 1.5, tilt: .2 });
    for (const t of ['Bush_1_A', 'Bush_2_A', 'Bush_3_A', 'Bush_4_A'])
      this.scatter(a, t, 20, { minR: 4, maxR: ARENA_R + 6, scale: [.9, 1.5], radius: .7, minGap: 1 });
    for (const t of ['Grass_1_A', 'Grass_2_A'])
      this.scatter(a, t, 260, { minR: 2, maxR: ARENA_R + 10, scale: [.45, .9], shadow: false });
  }

  /** True if (x,z) is clear of every collider by `pad`. */
  isFree(x, z, pad = 2) {
    return !this.colliders.some(k => (k.x - x) ** 2 + (k.z - z) ** 2 < (k.r + pad) ** 2);
  }

  randomFreeSpot(minR, maxR, pad = 2.5) {
    for (let i = 0; i < 200; i++) {
      const a = this.rand() * Math.PI * 2, r = minR + this.rand() * (maxR - minR);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.isFree(x, z, pad)) return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(minR, 0, 0);
  }

  /** Push a position out of colliders and keep it in the arena. */
  resolve(pos, radius = 0.45) {
    for (const k of this.colliders) {
      const dx = pos.x - k.x, dz = pos.z - k.z, min = k.r + radius, d2 = dx * dx + dz * dz;
      if (d2 < min * min) { const d = Math.sqrt(d2) || 0.001; pos.x = k.x + dx / d * min; pos.z = k.z + dz / d * min; }
    }
    const d = Math.hypot(pos.x, pos.z);
    if (d > ARENA_R - 1) { pos.x *= (ARENA_R - 1) / d; pos.z *= (ARENA_R - 1) / d; }
  }
}
