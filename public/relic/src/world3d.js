// The 3D world for Wildwood Colony: terrain, water, forest (one instance per tree tile), rocks,
// decor, roads, fog of war / territory overlay, deposits, lairs, chests and building models.
// It mirrors the Colony sim and applies its events.
import * as THREE from 'three';
import { firstMesh } from '../../src/assets.js';
import { W, H, TILE, BUILDINGS, RELICS, LAIR_KINDS } from './data.js';
import { T, idx, rng } from './map.js';
import { Kit, MATS } from './kit.js';

export const tileToWorld = (x, y) => [(x - W / 2 + 0.5) * TILE, (y - H / 2 + 0.5) * TILE];
export const CONSTRUCT_TIME = 2.6;  // seconds of scaffolding before a new building rises
export const worldToTile = (wx, wz) => [Math.floor(wx / TILE + W / 2), Math.floor(wz / TILE + H / 2)];
const TREE_MODELS = ['Tree_1_A', 'Tree_2_A', 'Tree_3_A', 'Tree_4_A', 'Tree_1_B', 'Tree_2_B', 'Tree_3_B', 'Tree_4_B'];
const hash = (x, y, k = 0) => { let h = (x * 374761393 + y * 668265263 + k * 1442695041) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/** A growable InstancedMesh pool keyed by tile index. */
class Pool {
  constructor(scene, mesh, cap, { shadow = true } = {}) {
    this.inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, cap);
    this.inst.count = 0; this.inst.castShadow = shadow; this.inst.receiveShadow = true; this.inst.frustumCulled = false;
    this.slot = new Map(); this.free = []; this.m = new THREE.Matrix4();
    this.inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.inst);
  }
  set(key, matrix) {
    let i = this.slot.get(key);
    if (i == null) { i = this.free.length ? this.free.pop() : this.inst.count++; if (i >= this.inst.instanceMatrix.count) { this.inst.count--; return; } this.slot.set(key, i); }
    this.inst.setMatrixAt(i, matrix); this.inst.instanceMatrix.needsUpdate = true;
  }
  remove(key) {
    const i = this.slot.get(key); if (i == null) return;
    this.inst.setMatrixAt(i, this.m.makeScale(0, 0, 0)); this.inst.instanceMatrix.needsUpdate = true;
    this.slot.delete(key); this.free.push(i);
  }
  has(key) { return this.slot.has(key); }
}

export class World3D {
  constructor(scene, assets, colony) {
    this.scene = scene; this.a = assets; this.c = colony; this.kit = new Kit(assets);
    this.root = new THREE.Group(); scene.add(this.root);
    this.buildingObjs = new Map(); this.falling = []; this.anims = [];
    this.showTerritory = false;
    this.buildTerrain();
    this.buildWater();
    this.buildForest();
    this.buildRocksAndDecor();
    this.roads = new THREE.Group(); this.root.add(this.roads); this.rebuildRoads();
    this.buildOverlay();
    this.features = new THREE.Group(); this.root.add(this.features); this.featureObjs = new Map();
    this.syncFeatures();
    for (const b of colony.buildings.values()) this.addBuilding(b, false);
    this.applyFog();
  }

  // ------------------------------------------------------------------ terrain
  heightAt(x, y) { // tile-space height used for terrain vertices
    const g = this.c.ground;
    const k = (tx, ty) => (tx < 0 || ty < 0 || tx >= W || ty >= H) ? T.ROCK : g[idx(tx, ty)];
    let water = 0, rock = 0;
    for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) { const t = k(x + dx, y + dy); if (t === T.WATER) water++; if (t === T.ROCK) rock++; }
    const edge = Math.min(x, y, W - x, H - y);
    let h = 0;
    if (water) h -= 0.45 * water;
    if (rock === 4) h += 0.6 + hash(x, y, 3) * 1.2 + (edge < 4 ? (4 - edge) * 1.4 : 0);
    else if (rock) h += 0.25 * rock;
    return h + (hash(x, y, 9) - 0.5) * 0.12;
  }

  buildTerrain() {
    const geo = new THREE.PlaneGeometry(W * TILE, H * TILE, W, H).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3);
    const grass = new THREE.Color(0x76b24f), grass2 = new THREE.Color(0x8cc05a), forest = new THREE.Color(0x4e8a3a), rock = new THREE.Color(0x8a8378), sand = new THREE.Color(0xc9b98a), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const vx = i % (W + 1), vy = Math.floor(i / (W + 1));
      pos.setY(i, this.heightAt(vx, vy));
      // colour from the 4 tiles around the vertex
      let trees = 0, rocks = 0, water = 0;
      for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        const tx = vx + dx, ty = vy + dy;
        if (tx < 0 || ty < 0 || tx >= W || ty >= H) { rocks++; continue; }
        const k = idx(tx, ty);
        if (this.c.tree[k]) trees++;
        if (this.c.ground[k] === T.ROCK) rocks++;
        if (this.c.ground[k] === T.WATER) water++;
      }
      c.copy(grass).lerp(grass2, hash(vx, vy, 1) * 0.8).lerp(forest, trees / 4 * 0.7);
      if (water) c.lerp(sand, Math.min(1, water / 2));
      if (rocks) c.lerp(rock, rocks / 4);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    this.terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    this.terrain.receiveShadow = true;
    this.root.add(this.terrain);
    // the world beyond the valley: a big skirt of darker forest floor
    const skirt = new THREE.Mesh(new THREE.RingGeometry(W * TILE * 0.7, W * TILE * 3, 48, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3f6e33, roughness: 1 }));
    skirt.position.y = 0.6; this.root.add(skirt);
  }

  buildWater() {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(W * TILE, H * TILE).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x3f8fb8, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.82 }));
    water.position.y = -0.22; this.water = water; this.root.add(water);
  }

  // ------------------------------------------------------------------ forest, rocks, decor
  treeMatrix(x, y, v) {
    const [wx, wz] = tileToWorld(x, y), s = 0.55 + hash(x, y, 2) * 0.3;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(wx + (hash(x, y, 4) - 0.5) * 0.9, 0, wz + (hash(x, y, 5) - 0.5) * 0.9),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, hash(x, y, 6) * Math.PI * 2, 0)), new THREE.Vector3(s, s * (0.9 + hash(x, y, 7) * 0.3), s));
    void v; return m;
  }
  buildForest() {
    this.trees = TREE_MODELS.map(n => new Pool(this.root, firstMesh(this.a.forest[n]), 2600));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = this.c.tree[idx(x, y)]; if (v) this.trees[(v - 1) % 8].set(idx(x, y), this.treeMatrix(x, y, v)); }
  }
  setTree(x, y, on, animate = true) {
    const k = idx(x, y);
    if (on) {
      const v = this.c.tree[k] || 1, pool = this.trees[(v - 1) % 8];
      const m = this.treeMatrix(x, y, v);
      if (animate) { const s0 = new THREE.Vector3(), p = new THREE.Vector3(), q = new THREE.Quaternion(); m.decompose(p, q, s0); this.anims.push({ t: 0, dur: 3, fn: k2 => pool.set(k, new THREE.Matrix4().compose(p, q, s0.clone().multiplyScalar(0.15 + 0.85 * k2))) }); }
      else pool.set(k, m);
    } else {
      for (const pool of this.trees) if (pool.has(k)) {
        if (animate && this.fog(x, y)) { // falling tree
          const mesh = new THREE.Mesh(pool.inst.geometry, pool.inst.material), m = this.treeMatrix(x, y, 1);
          m.decompose(mesh.position, mesh.quaternion, mesh.scale); mesh.castShadow = true;
          this.root.add(mesh); this.falling.push({ mesh, t: 0, dir: hash(x, y, 8) * Math.PI * 2 });
        }
        pool.remove(k);
      }
    }
  }
  buildRocksAndDecor() {
    const rocks = ['Rock_3_A', 'Rock_3_E', 'Rock_3_F', 'Rock_3_G'].map(n => new Pool(this.root, firstMesh(this.a.forest[n]), 3000));
    const decor = ['Bush_1_A', 'Bush_2_A', 'Bush_3_A', 'Bush_4_A', 'Grass_1_A', 'Grass_2_A', 'Rock_1_A', 'Rock_2_A'].map(n => new Pool(this.root, firstMesh(this.a.forest[n]), 2500, { shadow: false }));
    this.decor = decor;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = idx(x, y), [wx, wz] = tileToWorld(x, y), g = this.c.ground[k];
      if (g === T.ROCK) {
        const edge = Math.min(x, y, W - 1 - x, H - 1 - y), big = edge < 4 ? 3.2 + hash(x, y, 1) * 2.5 : 1.8 + hash(x, y, 1) * 1.2;
        e.set(0, hash(x, y, 2) * 6.28, 0);
        m.compose(new THREE.Vector3(wx, this.heightAt(x, y) * 0.6, wz), q.setFromEuler(e), new THREE.Vector3(big, big * (0.8 + hash(x, y, 3) * 0.7), big));
        rocks[Math.floor(hash(x, y, 4) * 4)].set(k, m);
      } else if (g === T.GRASS && !this.c.tree[k] && hash(x, y, 11) < 0.12) {
        const which = Math.floor(hash(x, y, 12) * decor.length), s = which < 4 ? 1.1 + hash(x, y, 13) * 0.7 : which < 6 ? 1.4 : 0.45;
        e.set(0, hash(x, y, 14) * 6.28, 0);
        m.compose(new THREE.Vector3(wx + (hash(x, y, 15) - 0.5), 0, wz + (hash(x, y, 16) - 0.5)), q.setFromEuler(e), new THREE.Vector3(s, s, s));
        decor[which].set(k, m);
      }
    }
    this.rocks = rocks;
  }
  clearDecor(x, y) { const k = idx(x, y); for (const d of this.decor) d.remove(k); }

  // ------------------------------------------------------------------ roads
  roadMaterial() {
    if (this._roadMat) return this._roadMat;
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    g.fillStyle = '#b8976a'; g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 140; i++) { g.fillStyle = Math.random() < 0.5 ? '#9c7c52' : '#cdb088'; g.fillRect(Math.random() * 64, Math.random() * 64, 2 + Math.random() * 3, 2 + Math.random() * 2); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return this._roadMat = new THREE.MeshStandardMaterial({ map: t, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
  }
  rebuildRoads() {
    this.roads.clear();
    const tiles = []; for (let i = 0; i < W * H; i++) if (this.c.road[i]) tiles.push(i);
    if (!tiles.length) return;
    const centers = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2), this.roadMaterial(), tiles.length);
    const links = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.5, 1.1).rotateX(-Math.PI / 2), this.roadMaterial(), tiles.length * 2);
    const m = new THREE.Matrix4(); let n = 0;
    tiles.forEach((k, i) => {
      const x = k % W, y = (k / W) | 0, [wx, wz] = tileToWorld(x, y);
      centers.setMatrixAt(i, m.makeTranslation(wx, 0.04, wz));
      if (x + 1 < W && this.c.road[k + 1]) links.setMatrixAt(n++, new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(wx + 1, 0.035, wz));
      if (y + 1 < H && this.c.road[k + W]) links.setMatrixAt(n++, m.makeTranslation(wx, 0.035, wz + 1));
    });
    links.count = n;
    centers.receiveShadow = links.receiveShadow = true;
    this.roads.add(centers, links);
  }

  // ------------------------------------------------------------------ fog of war + territory overlay
  buildOverlay() {
    this.ovData = new Uint8Array(W * H * 4);
    this.ovTex = new THREE.DataTexture(this.ovData, W, H, THREE.RGBAFormat);
    this.ovTex.magFilter = THREE.LinearFilter; this.ovTex.minFilter = THREE.LinearFilter; this.ovTex.flipY = false;
    const geo = new THREE.PlaneGeometry(W * TILE, H * TILE).rotateX(-Math.PI / 2);
    // PlaneGeometry UV v runs bottom→top; our rows run -z→+z, so flip v
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    this.overlay = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.ovTex, transparent: true, depthWrite: false }));
    this.overlay.position.y = 0.25; this.overlay.renderOrder = 2; this.root.add(this.overlay);
    // a soft cloud lid over unexplored land so trees and hills there read as mist
    this.mistData = new Uint8Array(W * H * 4);
    this.mistTex = new THREE.DataTexture(this.mistData, W, H, THREE.RGBAFormat);
    this.mistTex.magFilter = THREE.LinearFilter; this.mistTex.minFilter = THREE.LinearFilter;
    this.mist = new THREE.Mesh(geo.clone(), new THREE.MeshBasicMaterial({ map: this.mistTex, transparent: true, depthWrite: false, opacity: 0.9 }));
    this.mist.position.y = 7; this.mist.renderOrder = 3; this.root.add(this.mist);
  }
  fog(x, y) { return this.c.fog[idx(x, y)] === 1; }
  applyFog() {
    const d = this.ovData, md = this.mistData, c = this.c;
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      md[o] = 205; md[o + 1] = 218; md[o + 2] = 222; md[o + 3] = c.fog[i] ? 0 : 255;
      if (!c.fog[i]) { d[o] = 52; d[o + 1] = 66; d[o + 2] = 78; d[o + 3] = 235; }
      else if (this.showTerritory && !c.owned[i]) { d[o] = 150; d[o + 1] = 50; d[o + 2] = 40; d[o + 3] = 70; }
      else d[o + 3] = 0;
    }
    this.ovTex.needsUpdate = true; this.mistTex.needsUpdate = true;
    this.syncFeatures();
  }
  setTerritoryVisible(on) { if (this.showTerritory !== on) { this.showTerritory = on; this.applyFog(); } }

  // ------------------------------------------------------------------ features: deposits, lairs, chests
  syncFeatures() {
    const c = this.c;
    for (const d of c.deposits) if (d.found && !this.featureObjs.has(d.id)) {
      const g = new THREE.Group(), [wx, wz] = tileToWorld(d.x + 0.5, d.y + 0.5);
      this.kit.add(g, 'forest:Rock_1_A', -0.6, 0, -0.3, 0, 2.2); this.kit.add(g, 'forest:Rock_2_A', 0.7, 0, 0.4, 1, 1.8);
      this.kit.add(g, d.kind === 'iron' ? 'res:Iron_Nuggets' : 'res:Gold_Nuggets', 0.2, 0, 0.9, 0, 1.6);
      this.kit.add(g, d.kind === 'iron' ? 'res:Iron_Nugget_Large' : 'res:Gold_Nugget_Large', -0.9, 0, 0.8, 0.5, 1.4);
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.7, 2, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: d.kind === 'iron' ? 0x9ab0c8 : 0xffd54a, transparent: true, opacity: 0.6 }));
      ring.position.y = 0.08; g.add(ring);
      g.position.set(wx, 0, wz); g.userData = { kind: 'deposit', id: d.id };
      this.features.add(g); this.featureObjs.set(d.id, g);
    }
    for (const d of c.deposits) { const o = this.featureObjs.get(d.id); if (o) o.visible = !c.buildings.size || ![...c.buildings.values()].some(b => b.x === d.x && b.y === d.y); }
    for (const l of c.lairs) {
      let g = this.featureObjs.get(l.id);
      if (l.found && !g) {
        g = this.lairModel(l); this.features.add(g); this.featureObjs.set(l.id, g);
      }
      if (g) {
        const relic = g.userData.relic;
        if (relic) relic.visible = !!l.relic && !l.relicTaken;
        g.userData.flag.visible = !l.cleared;
      }
    }
    for (const ch of c.chests) {
      let g = this.featureObjs.get(ch.id);
      if (ch.found && !ch.opened && !g) {
        g = new THREE.Group(); const [wx, wz] = tileToWorld(ch.x, ch.y);
        this.kit.add(g, 'dun:chest', 0, 0, 0, hash(ch.x, ch.y) * 6, 0.7);
        const glow = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.85, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0.7 }));
        glow.position.y = 0.06; g.add(glow);
        g.position.set(wx, 0, wz); g.userData = { kind: 'chest', id: ch.id };
        this.features.add(g); this.featureObjs.set(ch.id, g);
      }
      if (g && ch.opened) { this.features.remove(g); this.featureObjs.delete(ch.id); }
    }
  }
  lairModel(l) {
    const g = new THREE.Group(), [wx, wz] = tileToWorld(l.x + 1, l.y + 1), k = this.kit;
    k.add(g, 'dun:floor_dirt_large', 0, 0.02, 0, 0, 1.4);
    if (l.kind === 'ruin') {
      k.add(g, 'dun:wall_broken', -1.5, 0, -2.3, 0, 0.8); k.add(g, 'dun:wall_arched', 1.8, 0, -1.6, -0.5, 0.75);
      k.add(g, 'dun:pillar', -2.4, 0, 1.6, 0, 0.6); k.add(g, 'dun:rubble_large', 1.8, 0, 2, 0.4, 0.6); k.add(g, 'dun:pillar_decorated', 2.4, 0, 0.9, 0, 0.6);
    } else if (l.kind === 'den') {
      k.add(g, 'dun:rubble_large', -1.8, 0, -1.6, 0.4, 0.7); k.add(g, 'dun:trunk_large_A', 1.7, 0, -1.6, 0.8, 0.6); k.add(g, 'dun:sword_shield', -2, 0, 1.5, 0.3, 0.8); k.add(g, 'dun:barrel_large', 2, 0, 1.6, 0, 0.45);
    } else {
      for (const [x, z, r] of [[-1.6, -1.4, 0.4], [1.7, -1.2, -0.4], [0, 1.9, 0]]) k.canopy(g, x, z, 1.8, 1.6, 0x6b4a3a, r);
      k.add(g, 'dun:box_stacked', 2.2, 0, 1.4, 0, 0.5); k.add(g, 'dun:torch_lit', -2.3, 0, 1.2, 0, 0.7);
    }
    // the creature banner (hidden once cleared)
    const flag = k.add(g, 'dun:banner_patternC_green', 0, 0, -0.5, 0, 0.7); flag.position.y = 0;
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.6, 0.14), MATS.timber()); pole.position.set(0, 1.8, -0.6); flag.add(pole);
    flag.position.set(-0.4, 0, -0.4);
    // a relic on a pedestal: glowing gem + light beam
    let relic = null;
    if (l.relic) {
      const r = RELICS.find(q => q.id === l.relic);
      relic = new THREE.Group();
      k.add(relic, 'dun:pillar', 0, 0, 0, 0, 0.35);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), new THREE.MeshStandardMaterial({ color: r.color, emissive: r.color, emissiveIntensity: 1.4, roughness: 0.2 }));
      gem.position.y = 2.2; gem.userData.spin = true; relic.add(gem);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.5, 26, 12, 1, true), new THREE.MeshBasicMaterial({ color: r.color, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.y = 13; relic.add(beam);
      relic.position.set(0.9, 0, 0.4);
      g.add(relic);
    }
    g.position.set(wx, 0, wz);
    g.userData = { kind: 'lair', id: l.id, relic, flag };
    void LAIR_KINDS;
    return g;
  }

  // ------------------------------------------------------------------ buildings
  addBuilding(b, animate = true) {
    const old = this.buildingObjs.get(b.id); if (old) this.root.remove(old.obj);
    const model = this.kit.bake(this.kit.build(b.type, { ruined: b.ruined }));
    const [wx, wz] = tileToWorld(b.x + b.w / 2 - 0.5, b.y + b.h / 2 - 0.5);
    model.position.set(wx, 0, wz);
    // face the nearest road
    model.rotation.y = this.facing(b);
    model.userData.id = b.id;
    model.traverse(o => { o.userData.bid = b.id; });
    this.root.add(model);
    for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) this.clearDecor(b.x + i, b.y + j);
    const smokes = []; model.traverse(o => { if (o.userData.smoke) smokes.push(o); });
    this.buildingObjs.set(b.id, { obj: model, smokes });
    if (animate === 'construct') {
      // scaffold first, then the building rises out of it
      const scaf = this.kit.bake(this.kit.scaffold(b.type)); scaf.position.copy(model.position); scaf.rotation.y = model.rotation.y; this.root.add(scaf);
      model.scale.set(1, 0.01, 1); model.visible = false;
      this.anims.push({ t: 0, dur: CONSTRUCT_TIME + 0.9, fn: k => {
        const t = k * (CONSTRUCT_TIME + 0.9) - CONSTRUCT_TIME;
        if (t < 0) { scaf.scale.y = Math.min(1, k * 6); return; }
        if (scaf.parent) { this.root.remove(scaf); model.visible = true; }
        const r = Math.min(1, t / 0.9); model.scale.set(1, 0.01 + 0.99 * (1 - (1 - r) ** 3), 1);
      } });
    } else if (animate) { model.scale.set(1, 0.01, 1); this.anims.push({ t: 0, dur: 0.9, fn: k => model.scale.set(1, 0.01 + 0.99 * (1 - (1 - k) ** 3), 1) }); }
    return model;
  }
  facing(b) {
    if (b.type === 'townhall' || BUILDINGS[b.type].size[0] !== BUILDINGS[b.type].size[1]) return 0;
    const sides = [[0, b.h, 0], [b.w, 0, Math.PI / 2], [0, -1, Math.PI], [-1, 0, -Math.PI / 2]]; // +z, +x, -z, -x
    for (const [dx, dy, ry] of sides) {
      for (let i = 0; i < Math.max(b.w, b.h); i++) {
        const x = dx === 0 ? b.x + Math.min(i, b.w - 1) : b.x + dx, y = dy === 0 ? b.y + Math.min(i, b.h - 1) : b.y + dy;
        if (x >= 0 && y >= 0 && x < W && y < H && this.c.road[idx(x, y)]) return ry;
      }
    }
    return 0;
  }
  removeBuilding(id) { const o = this.buildingObjs.get(id); if (o) { this.root.remove(o.obj); this.buildingObjs.delete(id); } }

  // ------------------------------------------------------------------ events & animation
  handle(e) {
    switch (e.type) {
      case 'tree': if (!e.deferred) this.setTree(e.x, e.y, e.on); break;
      case 'road': this.roadsDirty = true; if (e.on) this.clearDecor(e.x, e.y); break;
      case 'built': this.addBuilding(this.c.buildings.get(e.id), 'construct'); this.syncFeatures(); break;
      case 'removed': this.removeBuilding(e.id); this.syncFeatures(); break;
      case 'upgraded': case 'ruined': case 'repaired': { const b = this.c.buildings.get(e.id); if (b) this.addBuilding(b, e.type === 'upgraded' ? 'construct' : e.type !== 'ruined'); break; }
      case 'fog': case 'territory': this.fogDirty = true; break;
      case 'found': case 'lairCleared': case 'relicTaken': case 'chest': case 'mapUsed': this.syncFeatures(); break;
    }
  }

  update(dt, time) {
    if (this.roadsDirty) { this.roadsDirty = false; this.rebuildRoads(); for (const b of this.c.buildings.values()) { const o = this.buildingObjs.get(b.id); if (o) o.obj.rotation.y = this.facing(b); } }
    if (this.fogDirty) { this.fogDirty = false; this.applyFog(); }
    for (const a of this.anims) { a.t += dt; a.fn(Math.min(1, a.t / a.dur)); }
    this.anims = this.anims.filter(a => a.t < a.dur);
    for (const f of this.falling) {
      f.t += dt;
      const k = Math.min(1, f.t / 1.2);
      f.mesh.rotation.set(Math.sin(f.dir) * k * k * 1.5, f.mesh.rotation.y, Math.cos(f.dir) * k * k * 1.5);
      if (f.t > 1.8) f.mesh.position.y -= dt * 2;
    }
    this.falling = this.falling.filter(f => { if (f.t > 3) { this.root.remove(f.mesh); return false; } return true; });
    for (const g of this.featureObjs.values()) g.traverse(o => { if (o.userData.spin) { o.rotation.y += dt * 1.5; o.position.y = 2.2 + Math.sin(time * 2) * 0.15; } });
    this.water.position.y = -0.22 + Math.sin(time * 0.8) * 0.02;
  }
}
