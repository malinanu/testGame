// Building assembly: every colony building is composed from KayKit Dungeon walls/floors/props,
// Resource Bits stacks and RPG tools, plus procedural roofs, fields, fences and canopies.
// A finished building is baked (geometry merged per material) to keep draw calls low.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TILE, BUILDINGS } from './data.js';

const K = 0.8;                 // dungeon modules are 4 m; houses use them at 80%
const MOD = 4 * K;             // one wall module, in world units

// ------------------------------------------------------------------ shared materials
const texCache = {};
function shingleTexture(base, dark, kind = 'tile') {
  const key = `${base}-${kind}`;
  if (texCache[key]) return texCache[key];
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  if (kind === 'thatch') {
    for (let i = 0; i < 900; i++) { g.strokeStyle = Math.random() < 0.5 ? dark : '#00000022'; g.lineWidth = 1; const x = Math.random() * 128, y = Math.random() * 128; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 3, y + 6 + Math.random() * 8); g.stroke(); }
    for (let y = 0; y < 128; y += 16) { g.fillStyle = '#00000022'; g.fillRect(0, y, 128, 2); }
  } else {
    for (let row = 0; row < 8; row++) {
      const y = row * 16, off = row % 2 ? 8 : 0;
      g.fillStyle = dark; g.fillRect(0, y + 13, 128, 3);
      for (let x = -off; x < 128; x += 16) { g.fillStyle = '#ffffff10'; g.fillRect(x + 1, y + 1, 14, 6); g.fillStyle = '#0000001a'; g.fillRect(x, y, 1, 14); }
    }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return texCache[key] = t;
}
const matCache = {};
export function mat(key, make) { return matCache[key] ||= make(); }
export const ROOFS = {
  thatch: () => mat('roof-thatch', () => new THREE.MeshStandardMaterial({ map: shingleTexture('#c9a35a', '#8a6a2a', 'thatch'), roughness: 1 })),
  red: () => mat('roof-red', () => new THREE.MeshStandardMaterial({ map: shingleTexture('#a8432f', '#6e2418'), roughness: 0.85 })),
  slate: () => mat('roof-slate', () => new THREE.MeshStandardMaterial({ map: shingleTexture('#4c5d78', '#2c3648'), roughness: 0.8 })),
  brown: () => mat('roof-brown', () => new THREE.MeshStandardMaterial({ map: shingleTexture('#7a5232', '#4a2e18'), roughness: 0.9 })),
  green: () => mat('roof-green', () => new THREE.MeshStandardMaterial({ map: shingleTexture('#4f7a46', '#2e4a28'), roughness: 0.85 })),
};
const plain = (key, color, extra = {}) => mat(key, () => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra }));
export const MATS = {
  plaster: () => plain('plaster', 0xeadcc4), timber: () => plain('timber', 0x5a3a22), cloth: c => plain('cloth' + c, c, { side: THREE.DoubleSide }),
  soil: () => plain('soil', 0x6b4a2e), dark: () => plain('dark', 0x2a2420), glow: c => mat('glow' + c, () => new THREE.MeshBasicMaterial({ color: c })),
};

// ------------------------------------------------------------------ builder helpers
export class Kit {
  constructor(assets) { this.a = assets; this.tinted = {}; }

  /** Clone a pack piece ('dun:wall', 'res:Wood_Log_Stack', 'tool:anvil', 'prop:axe_1handed', 'forest:Bush_1_A'). */
  piece(ref, tint = null) {
    const [pack, name] = ref.split(':');
    const src = ({ dun: this.a.dun, res: this.a.res, tool: this.a.tool, prop: this.a.props, forest: this.a.forest })[pack]?.[name];
    if (!src) { console.warn('missing piece', ref); return new THREE.Group(); }
    const o = src.clone(true);
    if (tint) o.traverse(m => { if (m.isMesh) m.material = this.tint(m.material, tint); });
    return o;
  }
  tint(material, color) {
    const key = material.uuid + color;
    // the dungeon stone texture is dark: tint above 1.0 to get bright plaster / brick tones
    return this.tinted[key] ||= (() => { const m = material.clone(); m.color = new THREE.Color(color).multiplyScalar(color === 0x3a3430 ? 1 : 1.9); return m; })();
  }

  /** Add a piece to group g at (x, y, z), rotation ry, uniform scale s. */
  add(g, ref, x = 0, y = 0, z = 0, ry = 0, s = 1, tint = null) {
    const o = this.piece(ref, tint);
    o.position.set(x, y, z); o.rotation.y = ry; o.scale.setScalar(s);
    g.add(o); return o;
  }

  /**
   * A box-shaped house body made of wall modules: nx × nz modules, `floors` storeys.
   * sides: { front, back, left, right } → arrays of wall piece names per module (bottom floor), upper floors use windows.
   */
  body(g, { nx = 1, nz = 1, floors = 1, cx = 0, cz = 0, tint = null, front = null, door = true, floor = 'floor_wood_large', upper = 'wall_window_closed' }) {
    const w = nx * MOD, d = nz * MOD;
    for (let f = 0; f < floors; f++) {
      const y = f * MOD;
      for (let i = 0; i < nx; i++) {
        const x = cx - w / 2 + MOD * (i + 0.5);
        const fr = f === 0 ? (front?.[i] || (door && i === Math.floor(nx / 2) ? 'wall_doorway' : 'wall_window_open')) : upper;
        this.add(g, 'dun:' + fr, x, y, cz + d / 2 - 0.2 * K, 0, K, tint);
        this.add(g, 'dun:' + (f === 0 ? 'wall' : upper), x, y, cz - d / 2 + 0.2 * K, Math.PI, K, tint);
      }
      for (let j = 0; j < nz; j++) {
        const z = cz - d / 2 + MOD * (j + 0.5);
        this.add(g, 'dun:' + (f === 0 ? (j % 2 ? 'wall' : 'wall_window_open') : upper), cx + w / 2 - 0.2 * K, y, z, Math.PI / 2, K, tint);
        this.add(g, 'dun:' + (f === 0 ? 'wall' : 'wall_window_closed'), cx - w / 2 + 0.2 * K, y, z, -Math.PI / 2, K, tint);
      }
      // timber band between floors (the half-timbered Anno look)
      if (f > 0) this.box(g, w + 0.1, 0.22, d + 0.1, cx, y, cz, MATS.timber());
    }
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++)
      this.add(g, 'dun:' + floor, cx - w / 2 + MOD * (i + 0.5), 0.02, cz - d / 2 + MOD * (j + 0.5), 0, K);
    return { w, d, h: floors * MOD };
  }

  box(g, w, h, d, x, y, z, material, ry = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y + h / 2, z); m.rotation.y = ry; g.add(m); return m;
  }

  /** Gabled roof over a w × d footprint whose eaves sit at height y; ridge along x (or z if alongZ). */
  roof(g, { w, d, y, cx = 0, cz = 0, pitch = 0.75, over = 0.45, material = ROOFS.red(), alongZ = false, gable = MATS.plaster() }) {
    const span = (alongZ ? w : d) / 2 + over, len = (alongZ ? d : w) + over * 2;
    const rise = span * pitch, slope = Math.hypot(span, rise), ang = Math.atan2(rise, span), t = 0.16;
    const grp = new THREE.Group();
    for (const s of [-1, 1]) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(len, t, slope), material);
      slab.position.set(0, rise / 2, s * span / 2);
      slab.rotation.x = s * ang;
      // repeat the shingle texture with the slab size
      const uv = slab.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 2, uv.getY(i) * slope / 2);
      grp.add(slab);
    }
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(len + 0.1, 0.18, 0.3), MATS.timber());
    ridge.position.y = rise + 0.06; grp.add(ridge);
    // gable triangles
    const hw = span - over;
    const shape = new THREE.Shape([new THREE.Vector2(-hw, 0), new THREE.Vector2(hw, 0), new THREE.Vector2(0, rise * hw / span)]);
    const tri = new THREE.ShapeGeometry(shape);
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(tri, gable); m.material.side = THREE.DoubleSide;
      m.position.set(s * ((len - over * 2) / 2), 0.01, 0); m.rotation.y = Math.PI / 2; grp.add(m);
    }
    grp.position.set(cx, y, cz);
    if (alongZ) grp.rotation.y = Math.PI / 2;
    g.add(grp);
    return rise;
  }

  /** Wooden post for open sheds. */
  post(g, x, z, h, w = 0.24) { this.box(g, w, h, w, x, 0, z, MATS.timber()); this.box(g, w + 0.16, 0.18, w + 0.16, x, 0, z, plain('postfoot', 0x7a7064)); }

  chimney(g, x, y, z, h = 1.6) {
    this.box(g, 0.55, h, 0.55, x, y, z, plain('chimney', 0x8a5a44));
    this.box(g, 0.7, 0.14, 0.7, x, y + h, z, MATS.dark());
    const smoke = new THREE.Object3D(); smoke.position.set(x, y + h + 0.2, z); smoke.userData.smoke = true; g.add(smoke);
  }

  /** Canopy (market stall / awning): a sloped cloth plane on two poles. */
  canopy(g, x, z, w, d, color, ry = 0) {
    const grp = new THREE.Group();
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(w, d), MATS.cloth(color));
    cloth.rotation.x = -Math.PI / 2 + 0.25; cloth.position.y = 2.1; grp.add(cloth);
    for (const sx of [-1, 1]) this.box(grp, 0.1, 2.3, 0.1, sx * (w / 2 - 0.1), 0, d / 2 - 0.1, MATS.timber());
    grp.position.set(x, 0, z); grp.rotation.y = ry; g.add(grp);
  }

  fence(g, w, d, { gap = 'front' } = {}) {
    const post = MATS.timber();
    const run = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 1.2)), ry = Math.atan2(x1 - x0, z1 - z0);
      for (let i = 0; i <= n; i++) this.box(g, 0.12, 0.7, 0.12, x0 + (x1 - x0) * i / n, 0, z0 + (z1 - z0) * i / n, post);
      for (const h of [0.3, 0.6]) { const r = this.box(g, 0.06, 0.07, len, (x0 + x1) / 2, h, (z0 + z1) / 2, post); r.rotation.y = ry; }
    };
    const hw = w / 2, hd = d / 2;
    run(-hw, -hd, hw, -hd); run(-hw, -hd, -hw, hd); run(hw, -hd, hw, hd);
    if (gap !== 'front') run(-hw, hd, hw, hd); else { run(-hw, hd, -0.8, hd); run(0.8, hd, hw, hd); }
  }

  /** Crop field: furrowed soil + rows of little plants (grain = golden, flax = blue-green). */
  field(g, x, z, w, d, kind) {
    const soil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), MATS.soil());
    soil.rotation.x = -Math.PI / 2; soil.position.set(x, 0.03, z); g.add(soil);
    const col = kind === 'flax' ? 0x7aa0d8 : 0xe0b84a, stem = kind === 'flax' ? 0x5a8a4a : 0xc89a30;
    const geo = new THREE.ConeGeometry(0.16, 0.7, 4); geo.translate(0, 0.35, 0);
    const n = Math.floor(w / 0.45) * Math.floor(d / 0.6);
    const inst = new THREE.InstancedMesh(geo, plain('crop' + kind, stem), n), tops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 5, 4), plain('cropTop' + kind, col), n);
    const m4 = new THREE.Matrix4(); let k = 0;
    for (let i = 0; i < Math.floor(w / 0.45); i++) for (let j = 0; j < Math.floor(d / 0.6); j++) {
      const px = x - w / 2 + 0.25 + i * 0.45, pz = z - d / 2 + 0.3 + j * 0.6, s = 0.8 + ((i * 7 + j * 3) % 5) * 0.08;
      m4.makeScale(s, s, s).setPosition(px, 0.03, pz); inst.setMatrixAt(k, m4);
      m4.makeScale(s, s, s).setPosition(px, 0.03 + 0.7 * s, pz); tops.setMatrixAt(k++, m4);
    }
    inst.userData.crop = tops.userData.crop = true;
    g.add(inst, tops);
  }

  // ------------------------------------------------------------------ catalog
  /** Build the model for a building type (footprint centered on the origin, front = +z). */
  build(type, { ruined = false } = {}) {
    const def = BUILDINGS[type], g = new THREE.Group();
    const W = def.size[0] * TILE, D = def.size[1] * TILE;
    const f = this[`b_${type}`] || this.b_generic;
    f.call(this, g, W, D, def);
    if (ruined) this.ruin(g);
    g.userData.type = type;
    return g;
  }

  smallHouse(g, { roof = ROOFS.red(), tint = 0xf2e4cc, floors = 1, cx = 0, cz = 0, chimney = false, alongZ = false, front = null } = {}) {
    const b = this.body(g, { cx, cz, floors, tint, front });
    this.roof(g, { w: b.w, d: b.d, y: b.h, cx, cz, material: roof, alongZ });
    if (chimney) this.chimney(g, cx + b.w * 0.25, b.h + 0.4, cz - b.d * 0.2);
    return b;
  }

  b_hut(g) {
    this.smallHouse(g, { roof: ROOFS.thatch(), tint: 0xe9d6b4 });
    this.add(g, 'dun:barrel_small', 1.75, 0, 1.6, 0, 0.5);
    this.add(g, 'forest:Bush_1_A', -1.6, 0, 1.7, 0, 0.45);
  }
  b_house(g) {
    this.smallHouse(g, { roof: ROOFS.red(), tint: 0xd9937a, floors: 2, chimney: true });
    this.add(g, 'dun:barrel_small', 1.75, 0, 1.6, 0, 0.5); this.add(g, 'forest:Bush_2_A', -1.65, 0, 1.75, 0, 0.4);
  }
  b_manor(g) {
    this.smallHouse(g, { roof: ROOFS.slate(), tint: 0xf3ead8, floors: 2, chimney: true });
    this.add(g, 'dun:banner_patternA_red', 0, MOD * 1.05, MOD / 2 + 0.05, 0, 0.55);
    this.post(g, -0.9, 1.95, 2.4, 0.2); this.post(g, 0.9, 1.95, 2.4, 0.2); this.box(g, 2.2, 0.12, 0.8, 0, 2.4, 1.75, ROOFS.slate());
    this.add(g, 'dun:candle_triple', 1.7, 0, 1.75, 0, 0.6);
  }
  b_townhall(g, W, D) {
    const b = this.body(g, { nx: 2, nz: 2, floors: 2, tint: 0xf0e2c6, front: ['wall_window_open', 'wall_doorway'] });
    this.roof(g, { w: b.w, d: b.d, y: b.h, material: ROOFS.slate(), pitch: 0.8 });
    // clock tower
    const n0 = g.children.length;
    const tower = this.body(g, { cx: 0, cz: 0, floors: 1, tint: 0xf0e2c6, door: false, front: ['wall_window_closed'] });
    for (const o of g.children.slice(n0)) o.position.y += b.h + 1.2;
    this.roof(g, { w: tower.w, d: tower.d, y: b.h + 1.2 + tower.h, material: ROOFS.slate(), pitch: 1.3, over: 0.25 });
    this.add(g, 'dun:banner_triple_blue', -1.7, b.h * 0.55, b.d / 2 + 0.05, 0, 0.7); this.add(g, 'dun:banner_triple_blue', 1.7, b.h * 0.55, b.d / 2 + 0.05, 0, 0.7);
    this.add(g, 'dun:stairs_wood', 0, 0, b.d / 2 + 0.2, 0, 0.35);
    for (const x of [-3.2, 3.2]) this.add(g, 'dun:torch_lit', x, 0, D / 2 - 0.6, 0, 0.7);
    this.add(g, 'dun:crates_stacked', W / 2 - 0.9, 0, -D / 2 + 1, 0.3, 0.5);
  }
  b_market(g, W, D) {
    const stalls = [[-1.9, -1.6, 0xc0392b], [1.9, -1.6, 0x2a7fd0], [-1.9, 1.6, 0x27ae60], [1.9, 1.6, 0xe0a030]];
    for (const [x, z, c] of stalls) {
      this.canopy(g, x, z, 2.2, 1.6, c, z > 0 ? Math.PI : 0);
      this.add(g, 'dun:table_medium_tablecloth', x, 0, z, 0, 0.6);
      this.add(g, z > 0 ? 'dun:plate_food_A' : 'dun:bottle_A_green', x, 0.9, z, 0, 0.7);
    }
    this.add(g, 'dun:pillar_decorated', 0, 0, 0, 0, 0.55); this.add(g, 'dun:banner_shield_yellow', 0, 1.6, 0.3, 0, 0.5);
    this.add(g, 'dun:crates_stacked', -W / 2 + 0.7, 0, 0, 1, 0.45); this.add(g, 'dun:barrel_small_stack', W / 2 - 0.7, 0, 0, 0, 0.5);
    this.add(g, 'dun:box_stacked', 0, 0, D / 2 - 0.5, 0, 0.5);
  }
  b_tavern(g, W, D) {
    const b = this.body(g, { nx: 1, nz: 1, floors: 2, cz: -0.9, tint: 0xd6a57a });
    this.roof(g, { w: b.w, d: b.d, y: b.h, cz: -0.9, material: ROOFS.red() });
    this.chimney(g, 0.9, b.h + 0.5, -1.5);
    this.add(g, 'dun:banner_red', 0, MOD * 1.1, -0.9 + b.d / 2 + 0.05, 0, 0.55);
    for (const x of [-1.8, 1.8]) { this.add(g, 'dun:table_small_decorated_A', x, 0, 2, 0, 0.6); this.add(g, 'dun:stool', x - 0.6, 0, 2, 0, 0.6); this.add(g, 'dun:stool', x + 0.6, 0, 2, 0, 0.6); }
    this.add(g, 'dun:keg_decorated', -W / 2 + 0.6, 0, -0.5, 0, 0.5); this.add(g, 'dun:barrel_large', W / 2 - 0.6, 0, -0.4, 0, 0.45);
    this.add(g, 'prop:mug_full', -1.8, 0.82, 2, 0, 0.9);
  }
  b_chapel(g, W, D) {
    const b = this.body(g, { nx: 1, nz: 2, floors: 2, tint: 0xece4d4, front: ['wall_arched'], upper: 'wall_window_open', floor: 'floor_tile_large' });
    this.roof(g, { w: b.w, d: b.d, y: b.h, material: ROOFS.slate(), pitch: 1.2, alongZ: true });
    // bell tower
    this.box(g, 1.2, 2.6, 1.2, 0, b.h + 0.6, b.d / 2 - 0.8, plain('chapelstone', 0xd8d0c0));
    const spire = new THREE.Mesh(new THREE.ConeGeometry(1, 1.8, 4), ROOFS.slate()); spire.position.set(0, b.h + 0.6 + 2.6 + 0.9, b.d / 2 - 0.8); spire.rotation.y = Math.PI / 4; g.add(spire);
    this.add(g, 'dun:candle_triple', -1.6, 0, D / 2 - 0.4, 0, 0.6); this.add(g, 'dun:candle_triple', 1.6, 0, D / 2 - 0.4, 0, 0.6);
  }
  b_warehouse(g, W, D) {
    const b = this.body(g, { nx: 1, nz: 1, floors: 1, cx: -0.8, tint: 0xc8a882, front: ['wall_doorway'] });
    this.roof(g, { w: b.w, d: b.d, y: b.h, cx: -0.8, material: ROOFS.brown(), alongZ: true });
    this.add(g, 'dun:crates_stacked', 2, 0, -0.8, 0.2, 0.55); this.add(g, 'res:Pallet_Wood_Covered_A', 2, 0, 1, 0, 0.9);
    this.add(g, 'dun:barrel_small_stack', 2.5, 0, 0.1, 0, 0.45);
  }
  b_watchtower(g) {
    const b = this.body(g, { floors: 2, tint: 0xbfb5a5, front: ['wall_doorway'], upper: 'wall_window_open', floor: 'floor_tile_large' });
    this.add(g, 'dun:floor_tile_large', 0, b.h, 0, 0, K * 1.1);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; this.add(g, 'dun:barrier', Math.sin(a) * 1.65, b.h, Math.cos(a) * 1.65, a, 0.42); }
    this.add(g, 'dun:banner_thin_red', 0, b.h + 0.1, 1.85, 0, 0.6);
    this.add(g, 'dun:torch_lit', 1.4, b.h, 1.4, 0, 0.6);
  }
  b_outpost(g) {
    this.box(g, 0.16, 4.2, 0.16, 0, 0, -0.4, MATS.timber());
    this.add(g, 'dun:banner_patternB_blue', 0, 2.4, -0.28, 0, 0.55);
    this.canopy(g, 0.8, 0.6, 1.6, 1.4, 0xc9b28a, Math.PI);
    this.fence(g, 3.4, 3.4, { gap: 'front' });
    this.add(g, 'dun:torch_lit', -1.3, 0, 1.3, 0, 0.6); this.add(g, 'dun:box_small', 1.2, 0, -1.1, 0, 0.6);
  }
  b_tradepost(g, W, D) {
    this.smallHouse(g, { roof: ROOFS.green(), tint: 0xe2c9a0, cz: -0.9 });
    this.canopy(g, 0, 1.9, 3.4, 1.6, 0x8e44ad, Math.PI);
    this.add(g, 'dun:table_long_tablecloth_decorated_A', 0, 0, 1.9, 0, 0.55);
    this.add(g, 'dun:coin_stack_large', 0.5, 0.85, 1.9, 0, 0.8); this.add(g, 'tool:compass_base', -0.5, 0.85, 1.9, 0, 0.9);
    this.add(g, 'dun:crates_stacked', -W / 2 + 0.6, 0, 0.3, 0.4, 0.45); this.add(g, 'dun:barrel_small_stack', W / 2 - 0.6, 0, 0.3, 0, 0.45);
  }
  b_sanctum(g, W, D) {
    const tile = 'dun:floor_tile_large';
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) this.add(g, tile, i * 3.2, 0.02, j * 3.2, 0, K);
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; this.add(g, 'dun:pillar_decorated', Math.sin(a) * 3.7, 0, Math.cos(a) * 3.7, -a, 0.75); }
    this.add(g, 'dun:pillar', 0, 0, 0, 0, 0.9); this.add(g, 'dun:chest_gold', 0, 2.5, 0, 0, 0.6);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.1, 18, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 9; beam.userData.noBake = true; g.add(beam);
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 + 0.6; this.add(g, 'dun:candle_triple', Math.sin(a) * 2.2, 0, Math.cos(a) * 2.2, 0, 0.7); }
  }

  // production -------------------------------------------------------
  b_lumberjack(g, W, D) {
    this.smallHouse(g, { roof: ROOFS.brown(), tint: 0xc9a07a, cx: -0.4, cz: -0.4 });
    this.add(g, 'res:Wood_Log_Stack', 1.5, 0, 1.4, 0.4, 0.7); this.add(g, 'res:Wood_Log_A', -1.4, 0, 1.6, 1.2, 0.8);
    this.add(g, 'tool:axe', -1.3, 0.35, 1.6, 0, 1);
  }
  b_forester(g) {
    this.smallHouse(g, { roof: ROOFS.green(), tint: 0xd8c09a, cx: -0.5, cz: -0.5 });
    for (const [x, z] of [[1.5, 1.4], [1.6, -0.5], [-0.5, 1.6]]) this.add(g, 'forest:Tree_1_A', x, 0, z, x * 3, 0.28);
    this.add(g, 'tool:shovel', 0.8, 0, 1.7, 0.4, 0.9); this.add(g, 'tool:bucket_metal', 1.7, 0, 0.6, 0, 0.8);
  }
  b_sawmill(g, W, D) {
    for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.4], [1.6, 1.4]]) this.post(g, x, z, 2.25);
    this.roof(g, { w: 3.6, d: 3.4, y: 2.25, material: ROOFS.brown(), gable: MATS.timber() });
    this.add(g, 'res:Wood_Planks_Stack_Large', -0.8, 0, -0.5, 0, 0.75); this.add(g, 'res:Wood_Log_Stack', 0.9, 0, 0.4, 1.57, 0.65);
    this.add(g, 'tool:saw', 0.2, 0.9, 1, 0, 1.1);
  }
  b_hunter(g) {
    this.smallHouse(g, { roof: ROOFS.thatch(), tint: 0xb8946a, cx: -0.4, cz: -0.5 });
    this.add(g, 'dun:table_small_decorated_A', 1.4, 0, 1.4, 0, 0.55); this.add(g, 'dun:plate_food_A', 1.4, 0.75, 1.4, 0, 0.6);
    this.add(g, 'prop:bow', -1.5, 0.6, 1.6, 0.3, 1); this.add(g, 'dun:trunk_large_A', 1.6, 0, -0.6, 0, 0.5);
  }
  b_quarry(g) {
    for (const [x, z] of [[-1.5, -1.4], [1.5, -1.4], [-1.5, 0.6], [1.5, 0.6]]) this.post(g, x, z, 1.95);
    this.roof(g, { w: 3.3, d: 2.4, y: 1.95, cz: -0.4, material: ROOFS.brown(), gable: MATS.timber() });
    this.add(g, 'res:Stone_Chunks_Large', 0.2, 0, -0.5, 0.6, 0.9); this.add(g, 'dun:rubble_half', -1.2, 0, 1.4, 0, 0.5);
    this.add(g, 'tool:pickaxe', 1.2, 0.2, 1.4, 0.4, 1); this.add(g, 'res:Stone_Chunks_Small', 0.9, 0, 1.5, 0, 1);
  }
  b_stonemason(g) {
    this.smallHouse(g, { roof: ROOFS.red(), tint: 0xbdb3a5, cx: -0.4, cz: -0.5 });
    this.add(g, 'res:Stone_Bricks_Stack_Large', 1.45, 0, 1.3, 0.2, 0.7); this.add(g, 'tool:chisel', -1.3, 0.1, 1.6, 0, 1); this.add(g, 'tool:mallet', -1.0, 0.1, 1.7, 0.6, 1);
  }
  b_charcoal(g) {
    // earth kiln mound + shed
    const mound = new THREE.Mesh(new THREE.SphereGeometry(1.25, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), plain('kiln', 0x3b3029)); mound.position.set(0.6, 0, 0.5); mound.scale.y = 0.8; g.add(mound);
    const smoke = new THREE.Object3D(); smoke.position.set(0.6, 1.1, 0.5); smoke.userData.smoke = true; g.add(smoke);
    this.add(g, 'res:Fuel_A_Barrels', -1.3, 0, -1.2, 0, 0.6); this.add(g, 'res:Wood_Log_Stack', -1.3, 0, 1.3, 0, 0.55); this.add(g, 'tool:shovel', 1.7, 0, -1.3, 0, 0.9);
  }
  farmyard(g, W, D, kind) {
    this.smallHouse(g, { roof: ROOFS.thatch(), tint: 0xe2cfaa, cx: -W / 2 + MOD / 2 + 0.2, cz: -D / 2 + MOD / 2 + 0.2 });
    this.field(g, W / 2 - 1.5, 0, 2.6, D - 0.6, kind);
    this.field(g, -W / 2 + 2.2, D / 2 - 1.15, 3.8, 1.8, kind);
    this.add(g, kind === 'flax' ? 'res:Textiles_Stack_Small' : 'dun:box_stacked', -0.3, 0, -1.5, 0, 0.5);
    this.fence(g, W - 0.2, D - 0.2);
  }
  b_farm(g, W, D) { this.farmyard(g, W, D, 'grain'); }
  b_flaxfarm(g, W, D) { this.farmyard(g, W, D, 'flax'); }
  b_bakery(g) {
    this.smallHouse(g, { roof: ROOFS.red(), tint: 0xf0dcb8, chimney: true, cz: -0.3 });
    this.add(g, 'dun:table_small_decorated_A', 1.5, 0, 1.6, 0, 0.5); this.add(g, 'dun:plate_food_B', 1.5, 0.7, 1.6, 0, 0.6); this.add(g, 'dun:box_small', -1.6, 0, 1.6, 0, 0.5);
  }
  b_brewery(g) {
    this.smallHouse(g, { roof: ROOFS.brown(), tint: 0xd8b48a, chimney: true, cz: -0.3 });
    this.add(g, 'dun:keg_decorated', 1.5, 0, 1.5, 0, 0.5); this.add(g, 'dun:keg', -1.5, 0, 1.5, 0, 0.5); this.add(g, 'dun:barrel_small_stack', 1.8, 0, 0, 0, 0.4);
  }
  b_weaver(g) {
    this.smallHouse(g, { roof: ROOFS.green(), tint: 0xeedcc0, cz: -0.3 });
    this.add(g, 'res:Textiles_Stack_Large_Colored', 1.4, 0, 1.4, 0.3, 0.6); this.add(g, 'res:Textiles_A', -1.5, 0, 1.5, 0, 0.8);
    this.canopy(g, -1.2, 1.4, 1.6, 1, 0x3498db, Math.PI);
  }
  mineEntrance(g, nug) {
    this.add(g, 'dun:wall_arched', 0, 0, -0.6, 0, 0.7);
    const hill = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), plain('minehill', 0x6e6458)); hill.position.set(0, 0, -1.6); hill.scale.set(1, 1.05, 0.8); g.add(hill);
    const dark = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2), MATS.dark()); dark.position.set(0, 1, -0.55); g.add(dark);
    this.add(g, 'dun:rubble_half', -1.5, 0, 1, 0, 0.45); this.add(g, 'res:' + nug, 1.2, 0, 1.2, 0, 1.3);
    this.add(g, 'tool:pickaxe', 0.4, 0.15, 1.6, 0.9, 1); this.add(g, 'dun:box_large', -0.6, 0, 1.3, 0.2, 0.4);
  }
  b_ironmine(g) { this.mineEntrance(g, 'Iron_Nuggets'); }
  b_goldmine(g) { this.mineEntrance(g, 'Gold_Nuggets'); }
  b_smelter(g) {
    this.smallHouse(g, { roof: ROOFS.slate(), tint: 0xa89888, cz: -0.3 });
    this.chimney(g, 1.1, 0, -1.2, 5.2);
    this.add(g, 'res:Iron_Bars_Stack_Medium', 1.5, 0, 1.5, 0, 0.6); this.add(g, 'res:Fuel_A_Barrel', -1.6, 0, 1.5, 0, 0.6);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), MATS.glow(0xff7a2a)); glow.position.set(0, 0.6, 1.51); glow.userData.noBake = true; g.add(glow);
  }
  b_blacksmith(g) {
    for (const [x, z] of [[-1.6, -1.5], [1.6, -1.5], [-1.6, 1.2], [1.6, 1.2]]) this.post(g, x, z, 2.1);
    this.roof(g, { w: 3.5, d: 3.0, y: 2.1, cz: -0.15, material: ROOFS.slate(), gable: MATS.timber() });
    this.add(g, 'tool:anvil', 0, 0, 0.2, 0.3, 1.3); this.add(g, 'tool:grindstone', -1.1, 0, -0.6, 0, 1.1); this.add(g, 'tool:hammer', 0.25, 0.75, 0.2, 0, 1);
    this.add(g, 'res:Iron_Bars', 1.1, 0, -0.8, 0, 1); this.chimney(g, 1.1, 0, -1.2, 3.2);
  }
  b_cartographer(g) {
    this.smallHouse(g, { roof: ROOFS.slate(), tint: 0xf2e8d6, floors: 2, cz: -0.3 });
    this.add(g, 'dun:table_small_decorated_A', 1.5, 0, 1.5, 0, 0.55); this.add(g, 'tool:map', 1.5, 0.74, 1.5, 0, 0.8); this.add(g, 'tool:drafting_compass', -1.5, 0, 1.6, 0, 1); this.add(g, 'tool:lantern', -1.6, 0, 1.0, 0, 1);
  }
  b_goldsmith(g) {
    this.smallHouse(g, { roof: ROOFS.slate(), tint: 0xf6efe0, chimney: true, cz: -0.3 });
    this.add(g, 'dun:chest_gold', 1.5, 0, 1.5, -0.4, 0.45); this.add(g, 'res:Gold_Bars_Stack_Small', -1.5, 0, 1.5, 0, 0.7); this.add(g, 'dun:candle_triple', 1.7, 0, 0.2, 0, 0.5);
  }
  b_generic(g, W, D) { this.smallHouse(g, { roof: ROOFS.red() }); void W; void D; }

  /** Ruined look: drop the roof, darken, scatter rubble. */
  ruin(g) {
    g.traverse(o => { if (o.isMesh) o.material = this.tint(o.material, 0x3a3430); });
    this.add(g, 'dun:rubble_large', 0, 0, 0, 0, 0.6);
  }

  // ------------------------------------------------------------------ baking
  /** Merge all static meshes per material (keeps instanced crops and marked objects separate). */
  bake(g) {
    g.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const byMat = new Map(), keep = [];
    g.traverse(o => {
      if (o === g) return;
      if (o.isInstancedMesh || o.userData.noBake || o.userData.smoke) { keep.push(o); return; }
      if (!o.isMesh) return;
      const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      if (!geo.attributes.normal) geo.computeVertexNormals();
      geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      const list = byMat.get(o.material) || []; list.push(geo); byMat.set(o.material, list);
    });
    const out = new THREE.Group();
    for (const [m, geos] of byMat) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, m); mesh.castShadow = true; mesh.receiveShadow = true;
      out.add(mesh);
    }
    for (const o of keep) {
      const wm = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      o.parent.remove(o); wm.decompose(o.position, o.quaternion, o.scale);
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
      out.add(o);
    }
    out.userData = { ...g.userData };
    return out;
  }
}
