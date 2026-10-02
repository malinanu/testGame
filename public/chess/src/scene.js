// Wizard's Chess 3D scene: a torch-lit stone hall, a cracked stone board, living KayKit pieces and
// fully choreographed moves/captures (arrows, lightning, hammer leaps, toppling rook golems).
import * as THREE from 'three';
import { Actor } from '../../src/actor.js';
import { WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, type, color, fileOf, rankOf } from './chess.js';
import { VFX } from './vfx.js';

export const S = 2.4; // world units per square
// White sits at +z (near the default camera) so a1 is bottom-left from White's view.
export const sqPos = (sq, y = 0, v = new THREE.Vector3()) => v.set((fileOf(sq) - 3.5) * S, y, (3.5 - rankOf(sq)) * S);
const DAIS_Y = -0.55;
const BLACK_TINT = 0x6d6680, WHITE_STONE = 0xdcd6c8, BLACK_STONE = 0x3b3546;

const CAST = {
  [KING]: { name: 'King', model: 'Knight', scale: 1.08, R: 'wb:sword_E', L: 'wb:shield_C', crown: true },
  [QUEEN]: { name: 'Queen', model: 'Mage', scale: 1.02, R: 'wb:staff_A' },
  [BISHOP]: { name: 'Bishop', model: 'Ranger', scale: 0.98, R: 'wb:bow_A_withString' },
  [KNIGHT]: { name: 'Knight', model: 'Barbarian', scale: 1.0, R: 'wb:hammer_B' },
  [PAWN]: { name: 'Pawn', model: ['Rogue', 'Rogue_Hooded'], scale: 0.86, R: 'wb:spear_A', L: 'wb:shield_A' },
  [ROOK]: { name: 'Rook', rock: 'Rock_1_N', scale: 0.62 },
};
export const PIECE_NAME = t => CAST[t].name;

function rng(seed) { let s = seed >>> 0; return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/** Procedural cracked stone texture (canvas). */
function stoneTexture({ base, seed = 1, cracks = 3, size = 256, grain = 0.12, edge = 0.35 }) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), r = rng(seed), col = new THREE.Color(base);
  g.fillStyle = `#${col.getHexString()}`; g.fillRect(0, 0, size, size);
  for (let i = 0; i < 40; i++) { // mottling
    const l = (r() - 0.5) * 0.18, cc = col.clone().offsetHSL(0, 0, l);
    g.fillStyle = `rgba(${cc.r * 255 | 0},${cc.g * 255 | 0},${cc.b * 255 | 0},0.35)`;
    g.beginPath(); g.arc(r() * size, r() * size, 10 + r() * 50, 0, 6.28); g.fill();
  }
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) { const n = (r() - 0.5) * 255 * grain; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  g.putImageData(img, 0, 0);
  g.strokeStyle = `rgba(0,0,0,0.55)`; g.lineCap = 'round';
  for (let k = 0; k < cracks; k++) { // cracks: random walks with branches
    let x = r() * size, y = r() * size, a = r() * 6.28;
    g.lineWidth = 1 + r() * 1.6; g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 14; s++) {
      a += (r() - 0.5) * 1.2; x += Math.cos(a) * 9; y += Math.sin(a) * 9; g.lineTo(x, y);
      if (r() < 0.15) { g.stroke(); g.beginPath(); g.moveTo(x, y); g.lineWidth *= 0.7; }
    }
    g.stroke();
  }
  const grd = g.createRadialGradient(size / 2, size / 2, size * 0.25, size / 2, size / 2, size * 0.72); // worn edges
  grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, `rgba(0,0,0,${edge})`);
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function bannerTexture(main, trim, emblem) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 320;
  const g = c.getContext('2d');
  g.fillStyle = main; g.fillRect(0, 0, 128, 320);
  g.fillStyle = trim; g.fillRect(0, 0, 128, 14); g.fillRect(0, 0, 10, 320); g.fillRect(118, 0, 10, 320);
  g.beginPath(); g.moveTo(0, 290); g.lineTo(64, 320); g.lineTo(128, 290); g.lineTo(128, 320); g.lineTo(0, 320); g.fill(); // swallowtail cut later via alpha
  g.fillStyle = trim; g.font = 'bold 84px serif'; g.textAlign = 'center'; g.fillText(emblem, 64, 175);
  g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.moveTo(0, 320); g.lineTo(64, 285); g.lineTo(128, 320); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function labelTexture(text) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); g.fillStyle = 'rgba(255,214,120,0.85)'; g.font = 'bold 42px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 32, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class ChessScene {
  constructor(canvas, assets, sfx) {
    this.assets = assets; this.sfx = sfx; this.speed = 1; this.cinematic = true;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.15;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07080d);
    this.scene.fog = new THREE.FogExp2(0x0a0c14, 0.016);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
    this.cam = { yaw: 0, yawGoal: 0, pitch: 0.82, dist: 31, target: new THREE.Vector3(0, 0, 0), focus: null };
    this.clock = new THREE.Clock();
    this.tweens = []; this.pieces = new Map(); this.grave = { [WHITE]: [], [BLACK]: [] }; this.extraActors = [];
    this.vfx = new VFX(this.scene);
    this.vfx.preload(['big_hit_6x5', 'electric_ring_6x5', 'charge_7x6', 'impact_white_6x4', 'lightstreaks_6x5', 'vortex_6x5', 'star_explosion_6x5', 'fire_8x8', 'smoke_8x8', 'explosion_6x5',
      'spark_01_a', 'spark_05_a', 'magic_01_a', 'magic_03_a', 'magic_05_a', 'smoke_01_a', 'smoke_07_a', 'circle_03_a', 'circle_05_a', 'symbol_01_a', 'star_06_a', 'slash_02_a', 'light_01_a']);
    this.lights();
    this.buildHall();
    this.buildBoard();
    this.buildDecor();
    this.buildHighlights();
    this.bindInput(canvas);
    addEventListener('resize', () => this.resize()); this.resize();
    r.setAnimationLoop(() => this.frame());
  }

  resize() { this.renderer.setSize(innerWidth, innerHeight, false); this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }

  // ---------------------------------------------------------------- environment
  lights() {
    this.scene.add(new THREE.HemisphereLight(0x8a98d0, 0x2a2018, 0.45));
    const key = this.key = new THREE.DirectionalLight(0xffe8c8, 2.1);
    key.position.set(8, 34, -14); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 80 });
    key.shadow.bias = -0.0004;
    this.scene.add(key, key.target);
    const rim = new THREE.DirectionalLight(0x6f8cff, 0.7); rim.position.set(-20, 12, 24); this.scene.add(rim);
    this.boardGlow = new THREE.PointLight(0x9fb7ff, 25, 30, 2); this.boardGlow.position.set(0, 9, 0); this.scene.add(this.boardGlow);
  }

  buildHall() {
    const sc = this.scene;
    const floorTex = stoneTexture({ base: 0x3a3a40, seed: 7, cracks: 4, edge: 0.6 }); floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(30, 30);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(80, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 }));
    floor.position.y = -2.6; floor.receiveShadow = true; sc.add(floor);
    const wallTex = stoneTexture({ base: 0x34343c, seed: 11, cracks: 2, edge: 0.7 }); wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping; wallTex.repeat.set(24, 6);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(42, 42, 46, 48, 1, true), new THREE.MeshStandardMaterial({ map: wallTex, side: THREE.BackSide, roughness: 1 }));
    wall.position.y = 20; sc.add(wall);
    // columns with torches
    const colTex = stoneTexture({ base: 0x5a5852, seed: 5, cracks: 3, edge: 0.5 }); colTex.wrapS = colTex.wrapT = THREE.RepeatWrapping; colTex.repeat.set(2, 6);
    const colMat = new THREE.MeshStandardMaterial({ map: colTex, roughness: 0.9 });
    this.torches = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.PI / 10, R = 28;
      const g = new THREE.Group(); g.position.set(Math.cos(a) * R, -2.6, Math.sin(a) * R);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 30, 14), colMat); shaft.position.y = 15; shaft.castShadow = true;
      const foot = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.6, 4.2), colMat); foot.position.y = 0.8;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.4, 4.2), colMat); cap.position.y = 29;
      g.add(shaft, foot, cap); sc.add(g);
      if (i % 2 === 0) { // torch facing the board
        const dir = new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a));
        const p = g.position.clone().addScaledVector(dir, 1.9).setY(7.5);
        const holder = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.24, 1.3, 8), new THREE.MeshStandardMaterial({ color: 0x3b2a1a, roughness: 0.8 }));
        holder.position.copy(p).setY(6.8); sc.add(holder);
        const fire = this.vfx.sheet('fire_8x8', p.clone().setY(8.0), { size: 2.2, loop: true, duration: 1.6, additive: true });
        const light = new THREE.PointLight(0xff8a3a, 70, 34, 2); light.position.copy(p).setY(8.2); sc.add(light);
        this.torches.push({ light, fire, ph: Math.random() * 10 });
      }
    }
    // banners between columns (house colours, no logos)
    const designs = [['#7a1414', '#e8b84a', '♜'], ['#14532d', '#c9ced6', '♞'], ['#7a1414', '#e8b84a', '♛'], ['#14532d', '#c9ced6', '♚']];
    designs.forEach(([m, t, e], i) => {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4, R = 41.5;
      const b = new THREE.Mesh(new THREE.PlaneGeometry(5, 12.5), new THREE.MeshStandardMaterial({ map: bannerTexture(m, t, e), transparent: true, side: THREE.DoubleSide, roughness: 0.9 }));
      b.position.set(Math.cos(a) * R, 14, Math.sin(a) * R); b.lookAt(0, 14, 0); sc.add(b);
    });
    // high windows of cold moonlight
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2, R = 41.8;
      const w = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 9), new THREE.MeshBasicMaterial({ color: 0x5a78c8, transparent: true, opacity: 0.35, fog: false }));
      w.position.set(Math.cos(a) * R, 27, Math.sin(a) * R); w.lookAt(0, 27, 0); sc.add(w);
    }
  }

  buildBoard() {
    const sc = this.scene, light = [], dark = [];
    for (let i = 0; i < 4; i++) { light.push(stoneTexture({ base: 0xd2cdc2, seed: 100 + i, cracks: 2, edge: 0.3 })); dark.push(stoneTexture({ base: 0x5e4c3e, seed: 200 + i, cracks: 4, edge: 0.45 })); }
    const r = rng(42);
    this.squares = [];
    const geo = new THREE.BoxGeometry(S * 0.975, 0.6, S * 0.975);
    for (let rk = 0; rk < 8; rk++) for (let f = 0; f < 8; f++) {
      const isLight = (rk + f) % 2 === 1;
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: (isLight ? light : dark)[Math.floor(r() * 4)], roughness: isLight ? 0.75 : 0.9 }));
      m.position.set((f - 3.5) * S, -0.3 + (r() - 0.5) * 0.03, (3.5 - rk) * S);
      m.rotation.y = Math.floor(r() * 4) * Math.PI / 2;
      m.receiveShadow = true; sc.add(m); this.squares.push(m);
    }
    const rimTex = stoneTexture({ base: 0x75726a, seed: 300, cracks: 3, edge: 0.5 });
    const rimMat = new THREE.MeshStandardMaterial({ map: rimTex, roughness: 0.9 });
    const half = 4 * S, w = 1.5;
    for (let side = 0; side < 4; side++) for (let i = -1; i <= 8; i++) {
      const len = S * (0.9 + r() * 0.08), h = 0.85 + r() * 0.12;
      const b = new THREE.Mesh(new THREE.BoxGeometry(side % 2 ? w : len, h, side % 2 ? len : w), rimMat);
      const along = (i - 3.5) * S, out = half + w / 2;
      b.position.set(side === 0 ? along : side === 2 ? along : side === 1 ? out : -out, h / 2 - 0.62, side === 0 ? -out : side === 2 ? out : along);
      b.rotation.y = (r() - 0.5) * 0.04; b.castShadow = b.receiveShadow = true; sc.add(b);
    }
    // coordinates carved on the rim
    for (let i = 0; i < 8; i++) {
      for (const [txt, x, z] of [['abcdefgh'[i], (i - 3.5) * S, -half - 0.75], ['abcdefgh'[i], (i - 3.5) * S, half + 0.75], [String(i + 1), -half - 0.75, (3.5 - i) * S], [String(i + 1), half + 0.75, (3.5 - i) * S]]) {
        const l = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: labelTexture(txt), transparent: true, depthWrite: false }));
        l.position.set(x, 0.32, z); sc.add(l);
      }
    }
    const daisTex = stoneTexture({ base: 0x4c4a48, seed: 400, cracks: 5, edge: 0.4 }); daisTex.wrapS = daisTex.wrapT = THREE.RepeatWrapping; daisTex.repeat.set(6, 6);
    const dais = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 14, 2, half * 2 + 14), new THREE.MeshStandardMaterial({ map: daisTex, roughness: 0.95 }));
    dais.position.y = DAIS_Y - 1; dais.receiveShadow = true; sc.add(dais);
    const step = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 18, 1.1, half * 2 + 18), new THREE.MeshStandardMaterial({ map: daisTex, roughness: 0.95 }));
    step.position.y = -2.05; step.receiveShadow = true; sc.add(step);
  }

  forest(name, scale, x, z, rotY = 0) {
    const o = this.assets.forest[name].clone(true);
    o.scale.setScalar(scale); o.position.set(x, DAIS_Y, z); o.rotation.y = rotY;
    o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    this.scene.add(o); return o;
  }

  buildDecor() {
    const h = 4 * S + 3.6, r = rng(9);
    // trees and rock formations framing the board, like a forest clearing brought indoors
    [[-h, -h, 'Tree_1_A', 1.0], [h, h, 'Tree_3_A', 1.1], [-h, h, 'Tree_4_A', 0.9], [h, -h, 'Tree_2_A', 1.0]].forEach(([x, z, n, s]) => this.forest(n, s, x, z, r() * 6));
    [[-h - 1.5, -2], [h + 1.5, 3], [-3, h + 1.5], [4, -h - 1.5], [-h, 6], [h, -7]].forEach(([x, z], i) => this.forest(['Tree_Bare_1_A', 'Tree_Bare_1_B', 'Tree_Bare_2_A'][i % 3], 1.1, x, z, r() * 6));
    [[-h - 0.5, 9], [h + 0.5, -10], [8, h + 0.6], [-9, -h - 0.6]].forEach(([x, z], i) => this.forest(['Rock_1_N', 'Rock_1_O', 'Rock_1_P', 'Rock_1_O'][i], 0.75, x, z, r() * 6));
    for (let i = 0; i < 14; i++) {
      const side = i % 4, t = (r() - 0.5) * 2 * h, x = side === 0 ? -h : side === 1 ? h : t, z = side === 2 ? -h : side === 3 ? h : t;
      this.forest(['Rock_1_E', 'Rock_3_E', 'Bush_2_C', 'Bush_4_C', 'Rock_1_D'][i % 5], 0.9 + r() * 0.5, x + (r() - 0.5), z + (r() - 0.5), r() * 6);
    }
    // side table with mugs and a glowing potion
    const table = new THREE.Group(); table.position.set(-h + 0.5, DAIS_Y, -h + 6.5);
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.8 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.25, 2), wood); top.position.y = 1.6; top.castShadow = true; table.add(top);
    for (const [x, z] of [[-1.4, -0.8], [1.4, -0.8], [-1.4, 0.8], [1.4, 0.8]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.6, 0.2), wood); l.position.set(x, 0.8, z); table.add(l); }
    for (const x of [-0.9, 0.9]) { const m = this.assets.props.mug_full.clone(true); m.position.set(x, 1.72, 0.2); m.scale.setScalar(1.2); table.add(m); }
    const potion = new THREE.Group();
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 14), new THREE.MeshStandardMaterial({ color: 0x45ff6a, emissive: 0x18a030, emissiveIntensity: 1.4, transparent: true, opacity: 0.85, roughness: 0.1 }));
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.5, 12), new THREE.MeshStandardMaterial({ color: 0xd8f0ff, transparent: true, opacity: 0.6 })); neck.position.y = 0.55;
    const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.16, 10), new THREE.MeshStandardMaterial({ color: 0x8a5a2b })); cork.position.y = 0.85;
    potion.add(glass, neck, cork); potion.position.set(0, 2.15, -0.3); table.add(potion);
    const pl = new THREE.PointLight(0x50ff70, 6, 6, 2); pl.position.set(0, 2.3, -0.3); table.add(pl);
    this.scene.add(table);
    // weapon rack
    const rack = new THREE.Group(); rack.position.set(h - 0.6, DAIS_Y, h - 6);
    ['wb:halberd', 'wb:axe_A', 'wb:sword_A', 'wb:spear_A'].forEach((n, i) => { const w = this.assets.props[n].clone(true); w.position.set((i - 1.5) * 0.7, 0.2, 0); w.rotation.z = (i - 1.5) * 0.08; w.scale.setScalar(1.3); rack.add(w); });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.15, 0.3), wood); bar.position.y = 1.8; rack.add(bar);
    rack.rotation.y = -Math.PI / 4; this.scene.add(rack);
    // drifting fog around the dais and magic motes in the air
    this.fog = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, R = h + 1 + r() * 4;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.vfx.texture('smoke_07_a'), color: 0x9aa0b4, transparent: true, opacity: 0.18, depthWrite: false }));
      s.position.set(Math.cos(a) * R, 0.2 + r() * 0.6, Math.sin(a) * R); s.scale.setScalar(7 + r() * 5);
      this.scene.add(s); this.fog.push({ s, a, R, sp: (r() - 0.5) * 0.05 });
    }
    this.motes = [];
    const moteMat = ['magic_05_a', 'spark_05_a', 'star_06_a'].map((t, i) => new THREE.SpriteMaterial({ map: this.vfx.texture(t), color: [0x9fdcff, 0xffd27a, 0xb68cff][i], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    for (let i = 0; i < 110; i++) {
      const s = new THREE.Sprite(moteMat[i % 3]);
      s.position.set((r() - 0.5) * 50, r() * 18, (r() - 0.5) * 50); s.scale.setScalar(0.12 + r() * 0.22);
      this.scene.add(s); this.motes.push({ s, v: 0.2 + r() * 0.5, ph: r() * 10 });
    }
  }

  buildHighlights() {
    this.hl = [];
    const mk = (tex, color) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(S * 0.92, S * 0.92).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: this.vfx.texture(tex), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.renderOrder = 3; m.visible = false; this.scene.add(m); return m;
    };
    for (let i = 0; i < 40; i++) this.hl.push(mk('circle_05_a', 0x66d8ff));
    this.selRune = mk('symbol_01_a', 0xffd54a);
    this.hoverMark = mk('circle_03_a', 0xffffff); this.hoverMark.material.opacity = 0.45;
    this.lastMarks = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.PlaneGeometry(S * 0.97, S * 0.97).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffc04a, transparent: true, opacity: 0.18, depthWrite: false })); m.visible = false; this.scene.add(m); return m; });
    this.checkRing = mk('circle_03_a', 0xff2a2a); this.checkRing.scale.setScalar(1.25);
  }

  /** { selected: sq|null, moves: [{sq, capture}], last: [from,to]|null, check: sq|null } */
  setHighlights({ selected = null, moves = [], last = null, check = null } = {}) {
    this.hl.forEach((m, i) => {
      const mv = moves[i]; m.visible = !!mv;
      if (mv) { sqPos(mv.sq, 0.03, m.position); m.material.color.set(mv.capture ? 0xff4a3a : 0x66d8ff); m.scale.setScalar(mv.capture ? 1.05 : 0.7); }
    });
    this.selRune.visible = selected != null; if (selected != null) sqPos(selected, 0.04, this.selRune.position);
    this.lastMarks.forEach((m, i) => { m.visible = !!last; if (last) sqPos(last[i], 0.02, m.position); });
    this.checkRing.visible = check != null; if (check != null) sqPos(check, 0.05, this.checkRing.position);
  }

  setHover(sq) { this.hoverMark.visible = sq != null; if (sq != null) sqPos(sq, 0.035, this.hoverMark.position); }

  // ---------------------------------------------------------------- pieces
  makePiece(p, sq, variant = 0) {
    const t = type(p), c = color(p), cast = CAST[t];
    const group = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 0.18, 28), c === WHITE
      ? new THREE.MeshStandardMaterial({ color: 0xd9c38a, metalness: 0.65, roughness: 0.32 })
      : new THREE.MeshStandardMaterial({ color: 0x241d30, metalness: 0.45, roughness: 0.35, emissive: 0x150820 }));
    base.position.y = 0.09; base.castShadow = base.receiveShadow = true; group.add(base);
    const trim = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.035, 6, 32).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: c === WHITE ? 0xffd77a : 0xa46bff }));
    trim.position.y = 0.17; group.add(trim);
    const piece = { p, t, c, sq, group, base, home: c === WHITE ? Math.PI : 0 };
    if (cast.rock) {
      const rock = this.assets.forest[cast.rock].clone(true);
      rock.scale.setScalar(cast.scale);
      rock.traverse(m => { if (m.isMesh) { m.castShadow = true; m.material = m.material.clone(); if (c === BLACK) m.material.color.multiply(new THREE.Color(0x5a546a)); } });
      const pivot = new THREE.Group(); pivot.position.y = 0.18; pivot.add(rock); group.add(pivot);
      for (const x of [-0.25, 0.25]) { // golem eyes
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), new THREE.MeshBasicMaterial({ color: c === WHITE ? 0x7fd8ff : 0xff3a3a }));
        eye.position.set(x, 2.05, 0.72); pivot.add(eye);
      }
      piece.rock = pivot;
    } else {
      const model = Array.isArray(cast.model) ? cast.model[variant % cast.model.length] : cast.model;
      const actor = new Actor(this.assets, model, { tint: c === BLACK ? new THREE.Color(BLACK_TINT) : null, scale: cast.scale });
      actor.root.position.y = 0.18;
      if (cast.R) piece.weapon = actor.hold(cast.R, 'R');
      if (cast.L) actor.hold(cast.L, 'L');
      group.add(actor.root);
      actor.setBase(Math.random() < 0.5 ? 'Idle_A' : 'Idle_B');
      actor.mixer.update(Math.random() * 3);
      piece.actor = actor;
      if (cast.crown) piece.crown = this.addCrown(actor, c);
    }
    group.rotation.y = piece.home;
    sqPos(sq, 0, group.position);
    this.scene.add(group);
    return piece;
  }

  addCrown(actor, c) {
    const crown = new THREE.Group(), gold = new THREE.MeshStandardMaterial({ color: c === WHITE ? 0xffcc44 : 0xb9a8ff, metalness: 0.9, roughness: 0.25, emissive: c === WHITE ? 0x332200 : 0x1a1033 });
    crown.add(new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.07, 8, 24).rotateX(Math.PI / 2), gold));
    for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.26, 6), gold); const a = i / 6 * Math.PI * 2; s.position.set(Math.cos(a) * 0.32, 0.15, Math.sin(a) * 0.32); crown.add(s); }
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), new THREE.MeshBasicMaterial({ color: c === WHITE ? 0xff3355 : 0x55ff99 })); gem.position.set(0, 0.06, 0.38); crown.add(gem);
    const head = actor.model.getObjectByName('head');
    actor.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(actor.model), hw = head.getWorldPosition(new THREE.Vector3()), ws = head.getWorldScale(new THREE.Vector3());
    crown.position.set(0, (box.max.y - hw.y - 0.12) / ws.y, 0);
    crown.scale.setScalar(1 / ws.y);
    head.add(crown);
    return crown;
  }

  /** Rebuild every piece instantly from a position (new game, undo). captured = {w:[piece ints], b:[...]} */
  setPosition(chess, captured = { [WHITE]: [], [BLACK]: [] }) {
    for (const pc of this.pieces.values()) this.scene.remove(pc.group);
    for (const c of [WHITE, BLACK]) for (const pc of this.grave[c]) this.scene.remove(pc.group);
    this.pieces.clear(); this.grave = { [WHITE]: [], [BLACK]: [] };
    let v = 0;
    for (const { sq, piece } of chess.pieces()) this.pieces.set(sq, this.makePiece(piece, sq, v++));
    for (const c of [WHITE, BLACK]) for (const p of captured[c]) { const pc = this.makePiece(p, 0, v++); this.toGrave(pc, true); }
  }

  gravePos(c, i) {
    const side = c === WHITE ? 1 : -1, row = Math.floor(i / 8), col = i % 8;
    return new THREE.Vector3(side * (4 * S + 2.6 + row * 1.7), DAIS_Y, side * (col - 3.5) * S * 0.92);
  }

  toGrave(pc, instant = false) {
    const list = this.grave[pc.c], i = list.length; list.push(pc);
    pc.group.position.copy(this.gravePos(pc.c, i));
    pc.group.rotation.set(0, pc.c === WHITE ? -Math.PI / 2 : Math.PI / 2, 0);
    pc.base.visible = true;
    if (pc.actor) { pc.actor.busy = 0; pc.actor.dead = false; pc.actor.once(Math.random() < 0.5 ? 'Death_A' : 'Death_B', { hold: true }); if (instant) pc.actor.mixer.update(5); }
    if (pc.rock) { pc.rock.visible = true; pc.rock.scale.set(1, 0.35, 1); pc.rock.rotation.set(0, 0, 0.2); }
  }

  // ---------------------------------------------------------------- tween helpers
  tween(dur, fn, ease = k => k) { return new Promise(res => this.tweens.push({ t: 0, dur: Math.max(dur, 1e-4), fn, ease, res })); }
  wait(s) { return this.tween(s, () => {}); }
  facing(from, to) { return Math.atan2(to.x - from.x, to.z - from.z); }
  async turn(pc, angle, dur = 0.22) {
    const a0 = pc.group.rotation.y; let d = ((angle - a0 + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    if (Math.abs(d) < 0.02) return;
    await this.tween(dur, k => { pc.group.rotation.y = a0 + d * k; });
  }
  setFade(pc, a) {
    pc.group.traverse(m => { if (m.isMesh && m.material) { const mats = Array.isArray(m.material) ? m.material : [m.material]; mats.forEach(x => { x.transparent = a < 1 || x.userData.wasT; x.opacity = a; }); } });
  }
  chest(pc) { return pc.group.position.clone().setY(pc.t === ROOK ? 1.6 : pc.t === PAWN ? 1.0 : 1.25); }

  async travel(pc, to, { stopShort = 0 } = {}) {
    const from = pc.group.position.clone(), dir = to.clone().sub(from), dist = dir.length();
    if (dist < 0.01) return;
    dir.normalize();
    const end = to.clone().addScaledVector(dir, -stopShort), len = from.distanceTo(end);
    await this.turn(pc, this.facing(from, to));
    if (pc.t === KNIGHT) { // leap
      pc.actor.busy = 0; pc.actor.once('Jump_Full_Long', { speed: 1.25 });
      this.sfx.whoosh();
      const dur = 0.85 + len * 0.03;
      await this.tween(dur, k => { pc.group.position.lerpVectors(from, end, k); pc.group.position.y = Math.sin(k * Math.PI) * (1.6 + len * 0.15); });
      this.sfx.thud(); this.vfx.burst(end.clone().setY(0.2), { tex: 'smoke_01_a', color: 0x8a8378, count: 8, speed: 2, size: 1.2, gravity: 0.5, additive: false, up: 0.2 });
      pc.actor.busy = 0; pc.actor.setBase('Idle_A');
      return;
    }
    if (pc.t === ROOK) { // grinding slide
      this.sfx.grind();
      const dur = 0.5 + len * 0.12; let puff = 0;
      await this.tween(dur, k => {
        pc.group.position.lerpVectors(from, end, k);
        pc.rock.rotation.z = Math.sin(k * Math.PI * 6) * 0.04;
        if (k > puff) { puff += 0.12; this.vfx.burst(pc.group.position.clone().setY(0.15), { tex: 'smoke_01_a', color: 0x8e887c, count: 2, speed: 0.8, size: 0.9, gravity: 0.3, additive: false, up: 0.3, life: 0.9 }); }
      }, k => k * k * (3 - 2 * k));
      pc.rock.rotation.z = 0;
      return;
    }
    const a = pc.actor, glide = pc.t === QUEEN;
    a.busy = 0; a.setBase(glide ? 'Walking_B' : len > 4 ? 'Running_A' : 'Walking_A');
    const speed = glide ? 4.2 : len > 4 ? 6 : 3.2, dur = Math.max(0.35, len / speed);
    let nextStep = 0, nextSpark = 0;
    await this.tween(dur, k => {
      pc.group.position.lerpVectors(from, end, k);
      if (glide) {
        pc.group.position.y = Math.sin(k * Math.PI) * 0.45;
        if (k > nextSpark) { nextSpark += 0.06; this.vfx.burst(pc.group.position.clone().setY(0.6), { tex: 'magic_05_a', color: pc.c === WHITE ? 0x8fe8ff : 0xc08cff, count: 2, speed: 0.6, size: 0.35, gravity: 0.6, life: 0.8 }); }
      } else if (k > nextStep) { nextStep += 0.28 / dur; this.sfx.step(); }
    });
    a.setBase('Idle_A');
  }

  async faceHome(pc) { await this.turn(pc, pc.home, 0.3); }

  async shatter(victim, dir, { crush = false, burn = false } = {}) {
    const pos = victim.group.position.clone();
    const stone = victim.c === WHITE ? WHITE_STONE : BLACK_STONE;
    this.vfx.debris(pos.clone().setY(1), { count: crush ? 26 : 16, color: stone, speed: crush ? 7 : 4.5, size: crush ? 0.24 : 0.18 });
    this.vfx.burst(pos.clone().setY(0.6), { tex: 'smoke_07_a', color: burn ? 0x3a3040 : 0xa49e92, count: 10, speed: 1.8, size: 1.6, gravity: 0.4, additive: false, life: 1.4, up: 0.5 });
    this.sfx.shatter();
    if (victim.rock) {
      victim.rock.visible = false;
      this.vfx.debris(pos.clone().setY(1.5), { count: 30, color: victim.c === WHITE ? 0x8d8a82 : 0x4a4456, speed: 6, size: 0.32 });
    } else {
      const a = victim.actor;
      a.hitFlash(); a.busy = 0; a.once('Hit_A', { speed: 1.6 });
      if (burn) a.meshes.forEach(m => m.material.color.multiplyScalar(0.35));
      await this.wait(0.2);
      a.busy = 0; a.once('Death_A', { hold: true, speed: 1.3 });
      const home = victim.group.position.clone();
      await this.tween(0.4, k => victim.group.position.copy(home).addScaledVector(dir, k * 0.7));
      await this.wait(0.35);
    }
    await this.tween(0.45, k => this.setFade(victim, 1 - k));
    if (burn && victim.actor) victim.actor.meshes.forEach(m => m.material.color.multiplyScalar(1 / 0.35));
    this.setFade(victim, 1);
    this.toGrave(victim);
    this.vfx.sheet('vortex_6x5', victim.group.position.clone().setY(0.8), { size: 2.2, duration: 0.8, additive: true, color: victim.c === WHITE ? 0xffd77a : 0xb08cff });
  }

  focus(pos) { if (this.cinematic) this.cam.focus = { target: pos.clone().setY(0.8), dist: 17 }; }
  unfocus() { this.cam.focus = null; }

  async capture(att, victim, to) {
    const vpos = victim.group.position.clone(), apos = att.group.position.clone();
    const dir = vpos.clone().sub(apos).setY(0).normalize();
    this.focus(vpos.clone().lerp(apos, 0.35));
    victim.actor && (victim.actor.busy = 0, victim.actor.once('Hit_B', { speed: 0.8 })); // flinch as the attacker comes
    if (victim.actor) this.turn(victim, this.facing(vpos, apos), 0.3);
    if (att.t === KNIGHT) {
      const landing = this.travel(att, to);
      await this.wait(0.55);
      await landing;
      this.vfx.sheet('big_hit_6x5', vpos.clone().setY(1), { size: 5, duration: 0.45 });
      this.vfx.shake(0.55, 0.45); this.sfx.thud(true); this.sfx.clang();
      await this.shatter(victim, dir, { crush: true });
    } else if (att.t === BISHOP) {
      await this.turn(att, this.facing(apos, vpos));
      att.actor.busy = 0; att.actor.once('Throw', { speed: 1.5 });
      await this.wait(0.35); this.sfx.twang();
      const arrow = this.assets.props['wb:arrow_A'].clone(true); arrow.scale.setScalar(1.4); this.scene.add(arrow);
      const from = apos.clone().setY(1.4), hit = this.chest(victim), d = from.distanceTo(hit);
      await this.tween(0.18 + d * 0.025, k => { arrow.position.lerpVectors(from, hit, k); arrow.position.y += Math.sin(k * Math.PI) * d * 0.05; arrow.lookAt(hit); });
      this.scene.remove(arrow);
      this.vfx.sheet('impact_white_6x4', hit, { size: 2.6, duration: 0.35 });
      this.vfx.burst(hit, { tex: 'spark_01_a', color: 0xffe6a0, count: 14, speed: 4, size: 0.3 });
      await this.shatter(victim, dir);
      await this.travel(att, to);
    } else if (att.t === QUEEN) {
      await this.turn(att, this.facing(apos, vpos));
      att.actor.busy = 0; att.actor.once('Use_Item', { speed: 1.1 });
      const tip = (att.weapon ? att.weapon.getWorldPosition(new THREE.Vector3()) : apos.clone().setY(1.6)).add(new THREE.Vector3(0, 0.9, 0));
      this.vfx.sheet('charge_7x6', tip, { size: 2.2, duration: 0.55, additive: true, color: att.c === WHITE ? 0x9fffd0 : 0xd09cff });
      this.sfx.magic();
      await this.wait(0.5);
      const hit = this.chest(victim);
      this.vfx.lightning(tip, hit, { duration: 0.75, color: att.c === WHITE ? 0x8fdcff : 0xc58cff });
      this.vfx.sheet('electric_ring_6x5', vpos.clone().setY(0.1), { size: 4, duration: 0.7, ground: true, additive: true });
      this.vfx.sheet('lightstreaks_6x5', hit, { size: 3.5, duration: 0.6, additive: true });
      this.sfx.zap(); this.vfx.shake(0.25, 0.4);
      this.boardGlow.color.set(0xbfe4ff); this.boardGlow.intensity = 120;
      await this.wait(0.4);
      this.boardGlow.intensity = 25; this.boardGlow.color.set(0x9fb7ff);
      await this.shatter(victim, dir, { burn: true });
      await this.travel(att, to);
    } else if (att.t === ROOK) {
      await this.travel(att, vpos, { stopShort: S * 0.98 });
      await this.turn(att, this.facing(att.group.position, vpos), 0.15);
      this.sfx.grind();
      await this.tween(0.55, k => { att.rock.rotation.x = k * k * 1.45; });
      this.vfx.sheet('explosion_6x5', vpos.clone().setY(0.6), { size: 4, duration: 0.6 });
      this.vfx.burst(vpos.clone().setY(0.3), { tex: 'smoke_07_a', color: 0x9a948a, count: 16, speed: 3.5, size: 1.8, gravity: 0.3, additive: false, life: 1.6, up: 0.3 });
      this.vfx.shake(0.75, 0.5); this.sfx.thud(true);
      const crushed = this.shatter(victim, dir, { crush: true });
      await this.wait(0.3);
      await this.tween(0.6, k => { att.rock.rotation.x = 1.45 * (1 - k); }, k => 1 - (1 - k) * (1 - k));
      await crushed;
      await this.travel(att, to);
    } else { // pawn / king melee
      await this.travel(att, vpos, { stopShort: S * 0.55 });
      await this.turn(att, this.facing(att.group.position, vpos), 0.12);
      att.actor.busy = 0; att.actor.once('Use_Item', { speed: 2.2 });
      const home = att.group.position.clone();
      await this.tween(0.22, k => att.group.position.copy(home).addScaledVector(dir, Math.sin(k * Math.PI) * 0.5));
      const hit = this.chest(victim);
      this.vfx.sheet('big_hit_6x5', hit, { size: att.t === KING ? 3.4 : 2.6, duration: 0.4 });
      this.vfx.burst(hit, { tex: 'slash_02_a', color: 0xffffff, count: 1, speed: 0.1, size: 1.8, gravity: 0, life: 0.25 });
      this.sfx.clang(); this.vfx.shake(0.2, 0.25);
      await this.shatter(victim, dir);
      await this.travel(att, to);
    }
    this.unfocus();
    this.cheer(att.c, vpos);
  }

  cheer(c, near) {
    for (const pc of this.pieces.values()) {
      if (!pc.actor || pc.group.position.distanceTo(near) > S * 2.6) continue;
      if (pc.c === c && Math.random() < 0.8) { pc.actor.busy = 0; pc.actor.once(Math.random() < 0.5 ? 'Interact' : 'Jump_Full_Short', { speed: 1.2 }); }
      else if (pc.c !== c) { pc.actor.busy = 0; pc.actor.once('Hit_B', { speed: 1 }); }
    }
  }

  async promote(pc, promo) {
    const pos = pc.group.position.clone();
    this.sfx.magic(); this.sfx.chime();
    this.vfx.sheet('vortex_6x5', pos.clone().setY(1), { size: 3.5, duration: 0.9, additive: true, color: pc.c === WHITE ? 0xffe08a : 0xc08cff });
    this.vfx.sheet('star_explosion_6x5', pos.clone().setY(1.6), { size: 4, duration: 0.8 });
    await this.tween(0.4, k => pc.group.scale.setScalar(1 - k * 0.9));
    this.scene.remove(pc.group);
    const np = this.makePiece(pc.c | promo, pc.sq, 1);
    np.group.scale.setScalar(0.1);
    if (np.actor) { np.actor.busy = 0; np.actor.once('Spawn_Air', { speed: 1.2 }); }
    await this.tween(0.45, k => np.group.scale.setScalar(0.1 + 0.9 * k), k => 1 - (1 - k) ** 3);
    return np;
  }

  /** Animate a move that has already been played on the engine (rec from Chess.play). */
  async animateMove(m) {
    const mover = this.pieces.get(m.from);
    if (!mover) return;
    const us = color(m.piece);
    const victimSq = m.flags === 'e' ? m.to + (us === WHITE ? -16 : 16) : m.to;
    const victim = m.captured ? this.pieces.get(victimSq) : null;
    this.pieces.delete(m.from);
    if (victim) this.pieces.delete(victimSq);
    const to = sqPos(m.to);
    let rookJob = null;
    if (m.flags === 'k' || m.flags === 'q') {
      const rf = m.flags === 'k' ? m.to + 1 : m.to - 2, rt = m.flags === 'k' ? m.to - 1 : m.to + 1, rook = this.pieces.get(rf);
      if (rook) { this.pieces.delete(rf); rook.sq = rt; this.pieces.set(rt, rook); rookJob = this.wait(0.3).then(() => this.travel(rook, sqPos(rt))).then(() => this.faceHome(rook)); }
      this.sfx.magic();
    }
    if (victim) await this.capture(mover, victim, to); else await this.travel(mover, to);
    if (rookJob) await rookJob;
    mover.sq = m.to;
    let final = mover;
    if (m.promo) final = await this.promote(mover, m.promo);
    this.pieces.set(m.to, final);
    await this.faceHome(final);
  }

  /** Board-wide reaction: check pulses, mate topples the king, winners cheer. */
  async gameOver(result, chess) {
    if (result === '1/2-1/2') { for (const pc of this.pieces.values()) if (pc.actor) { pc.actor.busy = 0; pc.actor.once('Interact'); } return; }
    const winner = result === '1-0' ? WHITE : BLACK, loser = winner ^ 8;
    const king = [...this.pieces.values()].find(pc => pc.t === KING && pc.c === loser);
    if (king) {
      this.focus(king.group.position);
      this.sfx.doom();
      king.actor.busy = 0; king.actor.once('Death_B', { hold: true, speed: 0.7 });
      if (king.crown) {
        const cw = king.crown.getWorldPosition(new THREE.Vector3());
        king.crown.removeFromParent(); this.scene.add(king.crown); king.crown.position.copy(cw); king.crown.scale.setScalar(1);
        const land = king.group.position.clone().add(new THREE.Vector3(0.9, 0.12, 0.4));
        this.tween(1.1, k => { king.crown.position.lerpVectors(cw, land, k); king.crown.position.y = cw.y + (land.y - cw.y) * k * k; king.crown.rotation.z = k * 1.4; });
      }
      this.vfx.sheet('vortex_6x5', king.group.position.clone().setY(0.3), { size: 4.5, duration: 1.6, ground: true, additive: true, color: 0xff4040 });
      await this.wait(1.4);
      this.unfocus();
    }
    for (let round = 0; round < 3; round++) {
      for (const pc of this.pieces.values()) if (pc.c === winner && pc.actor) { pc.actor.busy = 0; pc.actor.once('Jump_Full_Short', { speed: 0.9 + Math.random() * 0.4 }); }
      for (let i = 0; i < 3; i++) this.vfx.sheet('star_explosion_6x5', new THREE.Vector3((Math.random() - 0.5) * 16, 6 + Math.random() * 5, (Math.random() - 0.5) * 16), { size: 5, duration: 0.9 });
      this.sfx.chime();
      await this.wait(1.1);
    }
  }

  setCheckPulse(on) { this.checkPulse = on; }

  // ---------------------------------------------------------------- camera / input / loop
  flip() { this.cam.yawGoal += Math.PI; }
  viewFor(c) { this.cam.yawGoal = this.cam.yaw = c === WHITE ? 0 : Math.PI; }

  bindInput(canvas) {
    const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
    let drag = null;
    const pick = e => {
      ray.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), this.camera);
      if (!ray.ray.intersectPlane(plane, hit)) return null;
      const f = Math.round(hit.x / S + 3.5), r = Math.round(3.5 - hit.z / S);
      return f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 16 + f : null;
    };
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerdown', e => { drag = { b: e.button, moved: 0 }; });
    addEventListener('pointerup', e => { if (drag && drag.moved < 6 && e.target === canvas && drag.b === 0) this.onSquare?.(pick(e)); drag = null; });
    canvas.addEventListener('pointermove', e => {
      if (drag) {
        drag.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
        if (drag.b === 2 || (drag.b === 0 && drag.moved > 6)) {
          this.cam.yawGoal -= e.movementX * 0.006; this.cam.yaw = this.cam.yawGoal;
          this.cam.pitch = THREE.MathUtils.clamp(this.cam.pitch + e.movementY * 0.004, 0.3, 1.4);
        }
      }
      this.onHover?.(pick(e));
    });
    canvas.addEventListener('wheel', e => { this.cam.dist = THREE.MathUtils.clamp(this.cam.dist + e.deltaY * 0.02, 12, 55); }, { passive: true });
    addEventListener('keydown', e => { if (e.code === 'KeyQ') this.cam.yawGoal += Math.PI / 4; if (e.code === 'KeyE') this.cam.yawGoal -= Math.PI / 4; });
  }

  frame() {
    const raw = Math.min(this.clock.getDelta(), 0.05), dt = raw * this.speed, time = this.clock.elapsedTime;
    const done = [];
    for (const tw of this.tweens) { tw.t += dt; const k = Math.min(1, tw.t / tw.dur); tw.fn(tw.ease(k)); if (k >= 1) done.push(tw); }
    if (done.length) { this.tweens = this.tweens.filter(t => !done.includes(t)); done.forEach(t => t.res()); }
    for (const pc of this.pieces.values()) pc.actor?.update(dt);
    for (const c of [WHITE, BLACK]) for (const pc of this.grave[c]) pc.actor?.update(dt);
    // idle liveliness: now and then a piece fidgets
    this.fidget = (this.fidget || 0) - dt;
    if (this.fidget <= 0) {
      this.fidget = 0.6 + Math.random() * 1.6;
      const list = [...this.pieces.values()].filter(p => p.actor && p.actor.busy <= 0);
      const pc = list[Math.floor(Math.random() * list.length)];
      if (pc) pc.actor.once(['Idle_B', 'Interact', 'Idle_A'][Math.floor(Math.random() * 3)], { speed: 1 });
    }
    for (const pc of this.pieces.values()) if (pc.actor && pc.actor.busy <= 0 && !pc.actor.base && !pc.actor.dead) pc.actor.setBase('Idle_A');
    for (const t of this.torches) t.light.intensity = 60 + Math.sin(time * 13 + t.ph) * 10 + Math.sin(time * 7.3 + t.ph * 2) * 8;
    for (const f of this.fog) { f.a += f.sp * dt; f.s.position.x = Math.cos(f.a) * f.R; f.s.position.z = Math.sin(f.a) * f.R; f.s.material.rotation += dt * 0.03; }
    for (const m of this.motes) { m.s.position.y += m.v * dt; m.s.position.x += Math.sin(time * 0.5 + m.ph) * dt * 0.3; if (m.s.position.y > 20) m.s.position.y = -1; }
    if (this.checkRing.visible) { const k = 1.15 + Math.sin(time * 6) * 0.12; this.checkRing.scale.setScalar(k); this.checkRing.material.opacity = 0.6 + Math.sin(time * 6) * 0.35; }
    this.selRune.rotation.y += dt * 0.8;
    for (const h of this.hl) if (h.visible) h.material.opacity = 0.65 + Math.sin(time * 4) * 0.25;
    const shake = this.vfx.update(raw);
    // camera
    const c = this.cam, goalT = c.focus ? c.focus.target : c.target, goalD = c.focus ? c.focus.dist : c.dist;
    c.curT = (c.curT || c.target.clone()).lerp(goalT, 1 - Math.exp(-raw * 3));
    c.curD = (c.curD ?? c.dist) + (goalD - (c.curD ?? c.dist)) * (1 - Math.exp(-raw * 3));
    c.yaw += (c.yawGoal - c.yaw) * (1 - Math.exp(-raw * 6));
    const cp = Math.cos(c.pitch);
    this.camera.position.set(c.curT.x + Math.sin(c.yaw) * cp * c.curD, c.curT.y + Math.sin(c.pitch) * c.curD, c.curT.z + Math.cos(c.yaw) * cp * c.curD);
    if (shake) this.camera.position.add(shake);
    this.camera.lookAt(c.curT);
    this.renderer.render(this.scene, this.camera);
  }
}
