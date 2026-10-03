// Three.js presentation layer for Wildwood Tactics. Every animation method returns a Promise
// so battle.js can `await` it.
import * as THREE from 'three';
import { Actor } from '../../src/actor.js';
import { firstMesh } from '../../src/assets.js';
import { W, H, T, CLASSES, gearModels } from './data.js';
import { rng } from './grid.js';

export const S = 2; // world units per tile
export const tw = (x, y, v = new THREE.Vector3()) => v.set((x - (W - 1) / 2) * S, 0, (y - (H - 1) / 2) * S);

const PROPS = {
  [T.BUSH]: [['Bush_2_C', 0.95], ['Bush_3_B', 0.95], ['Bush_4_C', 0.95], ['Bush_1_D', 0.9]],
  [T.BOULDER]: [['Rock_1_D', 1.25], ['Rock_1_E', 1.2], ['Rock_1_F', 1.2], ['Rock_3_E', 1.15]],
  [T.PILLAR]: [['Rock_1_N', 0.85], ['Rock_1_O', 0.85], ['Rock_1_P', 0.9]],
  [T.TREE]: [['Tree_1_A', 0.62], ['Tree_3_A', 0.62], ['Tree_2_A', 0.75], ['Tree_4_A', 0.8]],
  [T.BARE]: [['Tree_Bare_1_A', 0.9], ['Tree_Bare_1_B', 0.7], ['Tree_Bare_2_A', 0.8]],
};
PROPS[T.CORRUPT] = [['Tree_Bare_1_A', 1.1], ['Tree_Bare_2_A', 1.0]];
const TILE_COLORS = { a: 0x8cc65c, b: 0x82bd55, over: 0x4e8a36, burnt: 0x5d4a32, corrupt: 0x7a5f86 };
const MOODS = {
  day:   { bg: 0xa9d8cf, fog: [45, 110], hemi: 1.1, sun: 2.4, sunColor: 0xfff1d0 },
  night: { bg: 0x152238, fog: [12, 45], hemi: 0.25, sun: 0.25, sunColor: 0x8fa8ff },
};

/** Free a mesh tree this view created itself (not asset clones, whose geometry is shared). */
const disposeOwn = o => o.traverse(m => { if (m.isMesh) { m.geometry.dispose(); m.material.dispose(); } });

export class View {
  constructor(canvas, assets) {
    this.assets = assets;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    const lowEnd = matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency || 8) <= 4;
    r.setPixelRatio(Math.min(devicePixelRatio, lowEnd ? 1.25 : 1.5));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
    this.clock = new THREE.Clock();
    this.speed = 1;
    this.tweens = []; this.units = new Map(); this.fires = new Map(); this.floats = []; this.extraActors = [];
    this.cam = { yaw: 0, yawGoal: 0, pitch: 0.92, dist: 31, target: new THREE.Vector3(0, 0, 0), orbit: 0 };
    this.keys = {};
    this.labels = document.getElementById('labels');

    this.hemi = new THREE.HemisphereLight(0xdff6ff, 0x3f5a35, 1.1);
    this.sun = new THREE.DirectionalLight(0xfff1d0, 2.4);
    this.sun.position.set(18, 34, -12); this.sun.castShadow = true;
    this.sun.shadow.mapSize.setScalar(lowEnd ? 1024 : 2048);
    Object.assign(this.sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 90 });
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.hemi, this.sun);
    this.scene.fog = new THREE.Fog(0xa9d8cf, 45, 110);
    this.setMood('day');

    this.decorate();
    this.board = new THREE.Group(); this.camp = new THREE.Group();
    this.scene.add(this.board, this.camp);
    this.makeOverlay();
    this.bindInput(canvas);
    addEventListener('resize', () => this.resize()); this.resize();
    r.setAnimationLoop(() => this.frame());
  }

  setMood(name) {
    const m = MOODS[name];
    this.scene.background = new THREE.Color(m.bg);
    this.scene.fog.color.set(m.bg); [this.scene.fog.near, this.scene.fog.far] = m.fog;
    this.hemi.intensity = m.hemi; this.sun.intensity = m.sun; this.sun.color.set(m.sunColor);
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    if (this.cam?.fitted) this.fitBoard(this.cam.side); // still at the home framing: keep the whole board in view
  }

  // ------------------------------------------------------------ scenery
  clone(name, scale = 1) {
    const o = this.assets.forest[name].clone(true);
    o.scale.setScalar(scale);
    o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    return o;
  }

  instanced(name, mats, shadow = true) {
    const src = firstMesh(this.assets.forest[name]);
    const inst = new THREE.InstancedMesh(src.geometry, src.material, mats.length);
    mats.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.castShadow = shadow; inst.receiveShadow = true;
    this.scene.add(inst);
  }

  /** Ground and a dense ring of forest around the board. */
  decorate() {
    const ground = new THREE.Mesh(new THREE.CircleGeometry(140, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x4f7f3a, roughness: 1 }));
    ground.position.y = -0.06; ground.receiveShadow = true; this.scene.add(ground);
    const r = rng(99), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const ring = (names, n, min, max, sc) => {
      const per = names.map(() => []);
      for (let i = 0; i < n; i++) {
        let x, z;
        do { x = (r() * 2 - 1) * max; z = (r() * 2 - 1) * max; } while (Math.max(Math.abs(x), Math.abs(z)) < min || Math.hypot(x, z) > max);
        const s = sc[0] + r() * (sc[1] - sc[0]);
        m.compose(new THREE.Vector3(x, 0, z), q.setFromEuler(e.set(0, r() * 6.28, 0)), new THREE.Vector3(s, s, s));
        per[i % names.length].push(m.clone());
      }
      names.forEach((nm, i) => this.instanced(nm, per[i]));
    };
    ring(['Tree_1_A', 'Tree_2_A', 'Tree_3_A', 'Tree_4_A', 'Tree_1_C', 'Tree_2_C'], 220, 15, 60, [0.8, 1.3]);
    ring(['Bush_2_C', 'Bush_4_C', 'Rock_1_E', 'Rock_3_G'], 70, 13.5, 30, [0.8, 1.4]);
  }

  /** Build the tile board + terrain props from a Grid. */
  buildBoard(grid) {
    this.grid = grid;
    if (this.tiles) { this.tiles.geometry.dispose(); this.tiles.material.dispose(); this.tiles.dispose(); } // one per battle
    for (const f of this.fires.values()) disposeOwn(f);
    this.board.clear();
    this.burnt = new Set(); this.fires = new Map();
    this.props = new Array(W * H).fill(null);
    this.tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(S * 0.965, 0.4, S * 0.965),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }), W * H);
    this.tiles.receiveShadow = true;
    const m = new THREE.Matrix4();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = tw(x, y); p.y = -0.2;
      this.tiles.setMatrixAt(grid.i(x, y), m.makeTranslation(p.x, p.y, p.z));
    }
    this.board.add(this.tiles);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) this.retileNow(x, y);
    this.syncFire();
    this.board.add(this.overlay, this.hover);
    this.board.visible = true;
  }

  retileNow(x, y) {
    const g = this.grid, i = g.i(x, y), t = g.get(x, y);
    const col = t === T.OVERGROWN ? TILE_COLORS.over : t === T.CORRUPT ? TILE_COLORS.corrupt : (x + y) % 2 ? TILE_COLORS.a : TILE_COLORS.b;
    this.tiles.setColorAt(i, new THREE.Color(this.burnt?.has(i) ? TILE_COLORS.burnt : col).offsetHSL(0, 0, ((g.v[i] % 7) - 3) * 0.006));
    this.tiles.instanceColor.needsUpdate = true;
    if (this.props[i]) this.board.remove(this.props[i]);
    this.props[i] = null;
    const r = rng(g.v[i] * 977 + 13), base = tw(x, y);
    const grp = new THREE.Group(); grp.position.copy(base);
    if (PROPS[t]) {
      const [name, sc] = PROPS[t][g.v[i] % PROPS[t].length];
      const o = this.clone(name, sc * (0.92 + r() * 0.16));
      o.rotation.y = r() * Math.PI * 2;
      if (t === T.CORRUPT) o.traverse(mm => {
        if (!mm.isMesh) return;
        mm.material = mm.material.clone(); mm.material.color.multiply(new THREE.Color(0xb080ff));
        mm.material.emissive = new THREE.Color(0x5a10a0);
      });
      grp.add(o); grp.userData.main = o;
    }
    if (t === T.GRASS || t === T.OVERGROWN || t === T.BUSH) {
      const n = t === T.OVERGROWN ? 6 : 2, names = t === T.OVERGROWN ? ['Grass_1_D', 'Grass_2_D'] : ['Grass_1_C', 'Grass_2_C'];
      for (let k = 0; k < n; k++) {
        const o = this.clone(names[k % 2], (t === T.OVERGROWN ? 0.9 : 0.6) + r() * 0.3);
        o.position.set((r() - 0.5) * S * 0.75, 0, (r() - 0.5) * S * 0.75); o.rotation.y = r() * 6.28;
        o.traverse(mm => { if (mm.isMesh) mm.castShadow = false; });
        grp.add(o);
      }
    }
    if (grp.children.length) { this.board.add(grp); this.props[i] = grp; }
  }

  makeOverlay() {
    const n = W * H;
    this.overlay = new THREE.InstancedMesh(new THREE.PlaneGeometry(S * 0.9, S * 0.9).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false }), n);
    this.overlay.renderOrder = 2;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < n; i++) { this.overlay.setMatrixAt(i, zero); this.overlay.setColorAt(i, new THREE.Color(1, 1, 1)); }
    const edge = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
    this.hover = new THREE.Group();
    for (const [w, d, x, z] of [[S, 0.08, 0, S / 2], [S, 0.08, 0, -S / 2], [0.08, S, S / 2, 0], [0.08, S, -S / 2, 0]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), edge); b.position.set(x * 0.95, 0.06, z * 0.95); this.hover.add(b);
    }
    this.hover.visible = false;
  }

  /** list of [x, y, hexColor, opacity?] */
  setHighlights(list) {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0), m = new THREE.Matrix4(), c = new THREE.Color();
    for (let i = 0; i < W * H; i++) this.overlay.setMatrixAt(i, zero);
    for (const [x, y, col] of list) {
      const p = tw(x, y); const i = y * W + x;
      this.overlay.setMatrixAt(i, m.makeTranslation(p.x, 0.035, p.z));
      this.overlay.setColorAt(i, c.set(col));
    }
    this.overlay.instanceMatrix.needsUpdate = true; this.overlay.instanceColor.needsUpdate = true;
  }

  setHover(x, y, color = 0xffffff) {
    if (x == null) { this.hover.visible = false; return; }
    tw(x, y, this.hover.position); this.hover.visible = true;
    this.hover.children[0].material.color.set(color);
  }

  /** Dotted footprints along a planned walking path ([[x,y],...]) or null to clear. */
  showPath(path) {
    if (!this.pathGroup) { this.pathGroup = new THREE.Group(); this.scene.add(this.pathGroup); }
    // called on every hover move: skip an unchanged path, and share one dot geometry + material
    const key = path && path.length > 1 ? path.join(';') : '';
    if (key === this.pathKey) return;
    this.pathKey = key;
    this.pathGroup.clear();
    if (!key) return;
    const P = this.pathRes ||= { mat: new THREE.MeshBasicMaterial({ color: 0xbfe4ff, transparent: true, opacity: 0.85, depthWrite: false }), geo: new THREE.CircleGeometry(0.16, 12).rotateX(-Math.PI / 2) };
    const mat = P.mat, geo = P.geo;
    for (let i = 1; i < path.length; i++) {
      const a = tw(...path[i - 1]), b = tw(...path[i]);
      for (const k of [0.33, 0.66, 1]) {
        const d = new THREE.Mesh(geo, mat); d.position.lerpVectors(a, b, k).setY(0.07);
        if (k === 1 && i === path.length - 1) d.scale.setScalar(2.2);
        d.renderOrder = 4; this.pathGroup.add(d);
      }
    }
  }

  /** Floating "78% · 5" badge over a tile ({x,y,text,kind}) or null. */
  showBadge(b) {
    if (!this.badgeEl) { this.badgeEl = document.createElement('div'); this.badgeEl.className = 'tbadge'; this.labels.appendChild(this.badgeEl); }
    this.badge = b;
    this.badgeEl.style.display = b ? '' : 'none';
    if (b) { this.badgeEl.textContent = b.text; this.badgeEl.className = 'tbadge ' + (b.kind || ''); }
  }

  /** Bouncing chevron over heroes that can still act. */
  setReady(u, on) { const uv = this.uv(u); if (uv) uv.label.classList.toggle('ready', !!on); }

  /** Screen position of a tile (with height) or of a unit; used by the tutorial pointer. */
  screenOf(x, y, h = 0) {
    const v = tw(x, y).setY(h).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, visible: v.z < 1 };
  }

  /** Enemy turn: ease the camera toward whoever is acting, then back. */
  async focusUnit(u) {
    if (u.side === (this.mySide || 'player') || this.noFollow) return;
    const uv = this.uv(u); if (!uv) return;
    this.camHome ??= this.cam.target.clone();
    const from = this.cam.target.clone(), to = this.camHome.clone().lerp(uv.actor.root.position.clone().setY(0), 0.6);
    await this.tween(0.35, k => this.cam.target.lerpVectors(from, to, k * k * (3 - 2 * k)));
  }
  async restoreCamera() {
    if (!this.camHome) return;
    const from = this.cam.target.clone(), to = this.camHome; this.camHome = null;
    await this.tween(0.4, k => this.cam.target.lerpVectors(from, to, k));
  }

  // ------------------------------------------------------------ fire
  syncFire() {
    const g = this.grid;
    for (const [i, f] of this.fires) if (!g.fire[i]) { this.board.remove(f); disposeOwn(f); this.fires.delete(i); }
    for (let i = 0; i < g.fire.length; i++) {
      if (!g.fire[i] || this.fires.has(i)) continue;
      const f = new THREE.Group(); tw(i % W, (i / W) | 0, f.position);
      const r = rng(i * 31 + 7);
      for (let k = 0; k < 4; k++) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.22 + r() * 0.15, 0.7 + r() * 0.6, 6),
          new THREE.MeshBasicMaterial({ color: k % 2 ? 0xffb430 : 0xff5a1a, transparent: true, opacity: 0.9 }));
        c.position.set((r() - 0.5) * 1.1, 0.35, (r() - 0.5) * 1.1); c.userData.ph = r() * 6.28;
        f.add(c);
      }
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(S * 0.95, S * 0.95).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0.45, depthWrite: false }));
      glow.position.y = 0.04; f.add(glow);
      this.board.add(f); this.fires.set(i, f);
    }
    return Promise.resolve();
  }

  // ------------------------------------------------------------ units
  /** "Mine" = the side viewing this screen (blue); in hot-seat this flips each turn. */
  isMine(u) { return u.side === (this.mySide || 'player'); }
  ringColor(u) { return this.isMine(u) ? 0x4ab0ff : 0xff4f4f; }

  addUnit(u) {
    const actor = new Actor(this.assets, CLASSES[u.cls].model, { tint: u.tint ? new THREE.Color(u.tint) : null, scale: 0.92 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.78, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: this.ringColor(u), transparent: true, opacity: 0.9, depthWrite: false }));
    ring.position.y = 0.05;
    const label = document.createElement('div');
    label.className = 'ulabel ' + (this.isMine(u) ? 'player' : 'enemy');
    label.innerHTML = `<div class="rdy">▼</div><div class="st"></div><div class="bar"><i></i></div>`;
    this.labels.appendChild(label);
    const uv = { u, actor, ring, label, held: {} };
    tw(u.x, u.y, actor.root.position);
    actor.root.rotation.y = u.side === 'player' ? 0 : Math.PI;
    actor.root.add(ring);
    if (u.auraColor) { // cosmetic seasonal aura (Arena)
      uv.aura = new THREE.Mesh(new THREE.RingGeometry(0.82, 1.2, 40).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: u.auraColor, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      uv.aura.position.y = 0.07; actor.root.add(uv.aura);
    }
    this.scene.add(actor.root);
    this.units.set(u.id, uv);
    this.equip(uv);
    actor.setBase('Idle_A');
    actor.mixer.update(Math.random() * 2);
    this.updateLabel(u);
    return uv;
  }

  equip(uv) {
    for (const p of Object.values(uv.held)) p?.parent?.remove(p);
    const g = gearModels(uv.u);
    uv.held = { R: g.R ? uv.actor.hold(g.R, 'R') : null, L: g.L ? uv.actor.hold(g.L, 'L') : null };
    uv.wBase = uv.held.R?.rotation.clone();
  }

  clearUnits() {
    for (const uv of this.units.values()) {
      this.scene.remove(uv.actor.root); uv.label.remove();
      // the actor's materials are its own clones and the rings are per unit; meshes and props are shared assets
      for (const m of uv.actor.meshes) { m.material.dispose(); m.skeleton?.dispose(); } // the skeleton owns a bone texture
      for (const o of [uv.ring, uv.aura]) if (o) { o.geometry.dispose(); o.material.dispose(); }
    }
    this.units.clear();
    for (const f of this.floats) f.el.remove();
    this.floats = [];
  }

  uv(u) { return this.units.get(u.id); }

  updateLabel(u, selected = false) {
    const uv = this.uv(u); if (!uv) return;
    uv.label.querySelector('i').style.width = `${Math.max(0, u.hp / u.maxHp * 100)}%`;
    const st = [];
    if (u.hidden) st.push('<b class="hid">HIDDEN</b>');
    if (u.stun > 0 || u.stunned) st.push('<b class="stun">STUN</b>');
    if (u.cls === 'fighter') st.push(`<b class="stance">${u.stance === 'defense' ? 'DEF' : 'OFF'}</b>`);
    if (u.elite) st.push('<b class="elite">ELITE</b>');
    if (u.tierColor) st.push(`<b style="color:${u.tierColor}">◆</b>`);
    uv.label.querySelector('.st').innerHTML = st.join('');
    uv.label.classList.toggle('done', this.isMine(u) && u.moved && u.acted);
    uv.label.classList.toggle('player', this.isMine(u)); uv.label.classList.toggle('enemy', !this.isMine(u));
    uv.label.classList.toggle('sel', selected);
    uv.ring.material.opacity = u.alive ? 0.9 : 0;
    for (const m of uv.actor.meshes) { m.material.transparent = u.hidden; m.material.opacity = u.hidden ? 0.55 : 1; } // held props share one material per atlas: leave them
  }

  setSelected(u) {
    for (const uv of this.units.values()) {
      const sel = uv.u === u;
      uv.ring.material.color.set(sel ? 0xffd54a : this.ringColor(uv.u));
      this.updateLabel(uv.u, sel);
    }
  }

  face(uv, x, y) {
    const p = tw(x, y), r = uv.actor.root.position;
    if (Math.abs(p.x - r.x) + Math.abs(p.z - r.z) > 0.01) uv.actor.root.rotation.y = Math.atan2(p.x - r.x, p.z - r.z);
  }

  // ------------------------------------------------------------ tween helpers
  tween(dur, fn) { return new Promise(res => this.tweens.push({ t: 0, dur: Math.max(dur, 0.0001), fn, res })); }
  wait(sec) { return this.tween(sec, () => {}); }

  float(pos, text, cls = '') {
    const el = document.createElement('div');
    el.className = 'float ' + cls; el.textContent = text;
    this.labels.appendChild(el);
    this.floats.push({ el, pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 2.4, 0)), t: 0 });
  }
  floatOn(u, text, cls) { const uv = this.uv(u); if (uv) this.float(uv.actor.root.position, text, cls); }

  log(msg) {
    const el = document.getElementById('log'); if (!el) return Promise.resolve();
    const d = document.createElement('div'); d.textContent = msg; el.appendChild(d);
    while (el.children.length > 7) el.firstChild.remove();
    return Promise.resolve();
  }

  async banner(text) {
    const el = document.getElementById('banner'); if (!el) return;
    el.textContent = text; el.classList.add('on');
    await this.wait(0.9);
    el.classList.remove('on');
  }

  // ------------------------------------------------------------ battle animations
  async walk(u, path) {
    const uv = this.uv(u); if (!uv) return; // the board was cleared (left mid-turn)
    const a = uv.actor;
    a.busy = 0; a.setBase('Running_A');
    for (let i = 1; i < path.length; i++) {
      const from = tw(...path[i - 1]), to = tw(...path[i]);
      this.face(uv, ...path[i]);
      await this.tween(0.19, k => a.root.position.lerpVectors(from, to, k));
    }
    a.setBase('Idle_A');
    this.updateLabel(u);
  }

  swing(uv, k) {
    const w = uv.held.R; if (!w || !uv.wBase) return;
    const s = Math.sin(k * Math.PI);
    w.rotation.set(uv.wBase.x - s * 1.9, uv.wBase.y, uv.wBase.z + s * 0.5);
  }

  async attack(u, tx, ty, a) {
    const uv = this.uv(u); if (!uv) return;
    const act = uv.actor, home = act.root.position.clone();
    if (a.kind === 'cleave') {
      act.once('Use_Item', { speed: 2 });
      const r0 = act.root.rotation.y;
      await this.tween(0.45, k => { act.root.rotation.y = r0 + k * Math.PI * 2; this.swing(uv, k); });
      this.ring(home, 0xffc070);
    } else if (a.proj) {
      this.face(uv, tx, ty);
      act.once('Throw', { speed: 2.2 });
      await this.wait(0.22);
      await this.projectile(home.clone().setY(1.3), tw(tx, ty).setY(1.1), a.proj);
    } else {
      this.face(uv, tx, ty);
      act.once('Use_Item', { speed: 2.4 });
      const dir = tw(tx, ty).sub(home).setY(0).normalize();
      await this.tween(0.32, k => { act.root.position.copy(home).addScaledVector(dir, Math.sin(k * Math.PI) * 0.6); this.swing(uv, k); });
      act.root.position.copy(home);
    }
    if (uv.wBase) uv.held.R.rotation.copy(uv.wBase);
    act.busy = Math.min(act.busy, 0.05); act.setBase('Idle_A');
  }

  async cast(u, tx, ty, a) {
    const uv = this.uv(u), act = uv.actor;
    if (!(uv.u.x === tx && uv.u.y === ty)) this.face(uv, tx, ty);
    act.once(a.kind === 'heal' ? 'Throw' : 'Use_Item', { speed: 2 });
    await this.wait(0.25);
    const to = tw(tx, ty).setY(a.kind === 'heal' ? 1.2 : 0.4);
    await this.projectile(act.root.position.clone().setY(1.4), to, a.proj);
    if (a.kind === 'aoe') await this.explode(tx, ty, a.proj === 'fire' ? 0xff7a2a : 0x6dff6a);
    act.busy = Math.min(act.busy, 0.05); act.setBase('Idle_A');
  }

  makeProjectile(kind) {
    if (kind === 'arrow' || kind === 'bolt') {
      const o = this.assets.props[kind === 'arrow' ? 'arrow_bow' : 'arrow_crossbow'].clone(true);
      return o;
    }
    if (kind === 'potion') {
      const g = new THREE.Group();
      const glass = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12),
        new THREE.MeshStandardMaterial({ color: 0xff3d6b, emissive: 0x800020, transparent: true, opacity: 0.85, roughness: 0.15 }));
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.18, 10), new THREE.MeshStandardMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.7 }));
      neck.position.y = 0.24;
      const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.08, 8), new THREE.MeshStandardMaterial({ color: 0x8a5a2b }));
      cork.position.y = 0.36;
      g.add(glass, neck, cork); return g;
    }
    const col = { orb: 0x9fe8ff, fire: 0xff8a2a, vine: 0x7dff6a }[kind] ?? 0xffffff;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), new THREE.MeshBasicMaterial({ color: col })));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false })));
    return g;
  }

  async projectile(from, to, kind) {
    const o = this.makeProjectile(kind);
    this.scene.add(o);
    const d = from.distanceTo(to), arc = kind === 'arrow' || kind === 'bolt' ? d * 0.08 : 1 + d * 0.12;
    const at = k => from.clone().lerp(to, k).setY(from.y + (to.y - from.y) * k + Math.sin(k * Math.PI) * arc);
    await this.tween(0.12 + d * 0.025, k => {
      o.position.copy(at(k));
      if (kind === 'potion') o.rotation.z = k * 8; else o.lookAt(at(Math.min(1, k + 0.05)));
    });
    this.scene.remove(o);
    if (kind !== 'arrow' && kind !== 'bolt') disposeOwn(o); // arrows are clones of shared asset meshes
  }

  ring(pos, color) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.8, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    m.position.copy(pos).setY(0.1); this.scene.add(m);
    this.tween(0.4, k => { m.scale.setScalar(1 + k * 3); m.material.opacity = 0.8 * (1 - k); }).then(() => { this.scene.remove(m); disposeOwn(m); });
  }

  async explode(x, y, color) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    tw(x, y, m.position).setY(0.6); this.scene.add(m);
    await this.tween(0.38, k => { m.scale.setScalar(0.3 + k * S * 1.5); m.material.opacity = 0.7 * (1 - k); });
    this.scene.remove(m); disposeOwn(m);
  }

  async hit(u, n, opts = {}) {
    const uv = this.uv(u); if (!uv) return;
    uv.actor.hitFlash();
    if (u.hp > 0) uv.actor.once('Hit_A', { speed: 1.7 });
    this.floatOn(u, `-${n}`, opts.crit ? 'crit' : opts.src === 'fire' ? 'burn' : opts.src === 'tree' ? 'lash' : 'dmg');
    if (opts.crit) this.floatOn(u, 'CRITICAL!', 'crit small');
    if (opts.note) this.floatOn(u, opts.note, 'note');
    this.updateLabel(u);
    await this.wait(0.28);
  }

  async miss(u) {
    const uv = this.uv(u); this.floatOn(u, 'Miss', 'miss');
    const home = uv.actor.root.position.clone(), side = new THREE.Vector3(Math.cos(uv.actor.root.rotation.y), 0, -Math.sin(uv.actor.root.rotation.y));
    await this.tween(0.3, k => uv.actor.root.position.copy(home).addScaledVector(side, Math.sin(k * Math.PI) * 0.5));
  }

  async death(u) {
    const uv = this.uv(u);
    uv.actor.busy = 0; uv.actor.once('Death_A', { hold: true, speed: 1.2 });
    uv.label.style.display = 'none';
    this.updateLabel(u);
    await this.wait(0.6);
  }

  async heal(u, n) {
    this.floatOn(u, `+${n}`, 'heal');
    this.ring(this.uv(u).actor.root.position, 0x6dff8a);
    this.updateLabel(u);
    await this.wait(0.3);
  }

  async status(u, s) { if (s) this.floatOn(u, s, 'note'); this.updateLabel(u); await this.wait(s ? 0.3 : 0); }

  async stance(u) {
    const uv = this.uv(u);
    this.equip(uv); uv.actor.once('Interact', { speed: 2.2 });
    this.floatOn(u, u.stance === 'defense' ? 'Defense stance' : 'Offense stance', 'note');
    this.updateLabel(u);
    await this.wait(0.35);
  }

  async bump(u, dx, dy) {
    const uv = this.uv(u), home = uv.actor.root.position.clone(), d = new THREE.Vector3(dx, 0, dy).normalize();
    await this.tween(0.25, k => uv.actor.root.position.copy(home).addScaledVector(d, Math.sin(k * Math.PI) * 0.45));
  }

  async slide(u, x, y) {
    const uv = this.uv(u), from = uv.actor.root.position.clone(), to = tw(x, y);
    await this.tween(0.25, k => uv.actor.root.position.lerpVectors(from, to, 1 - (1 - k) * (1 - k)));
    this.updateLabel(u);
  }

  async fell(x, y) {
    const i = this.grid.i(x, y), grp = this.props[i], main = grp?.userData.main;
    if (main) {
      const ax = Math.random() * 6.28;
      await this.tween(0.5, k => { main.rotation.x = Math.cos(ax) * k * k * 1.5; main.rotation.z = Math.sin(ax) * k * k * 1.5; });
      await this.tween(0.3, k => { main.position.y = -k * 2; });
    }
    this.retileNow(x, y);
  }

  async ignite(x, y) {
    const i = this.grid.i(x, y), main = this.props[i]?.userData.main;
    (this.burnt ??= new Set()).add(i);
    if (main) {
      main.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.color.set(0x2a1a10); m.material.emissive = new THREE.Color(0xff4a10); } });
      await this.tween(0.6, k => main.scale.multiplyScalar(1 - k * 0.08));
    }
    this.retileNow(x, y);
  }

  fire() { return this.syncFire(); }

  async retile(x, y) { this.retileNow(x, y); await this.wait(0.04); }

  async lash(x, y, u) {
    const main = this.props[this.grid.i(x, y)]?.userData.main;
    const p = tw(x, y), uv = this.uv(u);
    if (main) await this.tween(0.4, k => { main.rotation.z = Math.sin(k * Math.PI * 3) * 0.35 * (1 - k); main.rotation.x = Math.atan2(uv.actor.root.position.z - p.z, 1) * Math.sin(k * Math.PI) * 0.4; });
  }

  // ------------------------------------------------------------ camp scene
  showCamp(heroes) {
    this.board.visible = false;
    this.clearUnits(); this.clearCamp();
    this.setMood('night');
    const c = this.camp;
    for (let k = 0; k < 3; k++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.3, 8), new THREE.MeshStandardMaterial({ color: 0x6b4423 }));
      log.rotation.set(Math.PI / 2, 0, k * 2.1); log.position.y = 0.15; log.castShadow = true; c.add(log);
    }
    this.campFlames = [];
    for (let k = 0; k < 5; k++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.18 + k * 0.03, 0.9 - k * 0.08, 7),
        new THREE.MeshBasicMaterial({ color: k % 2 ? 0xffc040 : 0xff6a1a, transparent: true, opacity: 0.9 }));
      f.position.set(Math.cos(k * 1.3) * 0.2, 0.55, Math.sin(k * 1.3) * 0.2); f.userData.ph = k; c.add(f); this.campFlames.push(f);
    }
    this.campLight = new THREE.PointLight(0xff9a40, 60, 22, 1.6); this.campLight.position.y = 1.2; // no shadow: a point-light shadow re-renders the scene 6 more times
    c.add(this.campLight);
    const seats = Math.max(heroes.length, 4);
    heroes.forEach((h, i) => {
      const ang = (i / seats) * Math.PI * 2 + 0.4, R = 3.1;
      const rock = this.clone(['Rock_1_E', 'Rock_1_D', 'Rock_3_E', 'Rock_1_F'][i % 4], 0.9);
      rock.position.set(Math.cos(ang) * R, 0, Math.sin(ang) * R); c.add(rock);
      const a = new Actor(this.assets, CLASSES[h.cls].model, { scale: 0.92 });
      a.root.position.set(Math.cos(ang) * R, h.alive ? 0.55 : 0, Math.sin(ang) * R);
      a.root.rotation.y = Math.atan2(-a.root.position.x, -a.root.position.z);
      if (h.alive) { a.hold('mug_full', 'R'); a.setBase(i % 2 ? 'Idle_A' : 'Idle_B'); a.mixer.update(i * 0.7); }
      else { a.root.position.multiplyScalar(1.45); a.once('Death_B', { hold: true }); a.mixer.update(5); }
      c.add(a.root); this.extraActors.push(a);
    });
    for (let k = 0; k < 6; k++) { const b = this.clone(['Bush_2_C', 'Bush_4_C', 'Tree_3_A'][k % 3], k % 3 === 2 ? 0.8 : 1.1); const ang = k * 1.05 + 0.2; b.position.set(Math.cos(ang) * 8, 0, Math.sin(ang) * 8); c.add(b); }
    Object.assign(this.cam, { target: new THREE.Vector3(0, 0.8, 0), dist: 11, pitch: 0.42, orbit: 0.05, fitted: false });
  }

  clearCamp() {
    this.camp.clear(); this.extraActors = []; this.campFlames = null;
    this.setMood('day');
  }

  /** Decorative board for menus. */
  showBackdrop(grid) {
    this.clearCamp(); this.clearUnits(); this.buildBoard(grid); this.setHighlights([]); this.setHover(null);
    Object.assign(this.cam, { target: new THREE.Vector3(0, 0, 0), dist: 34, pitch: 0.75, orbit: 0.06, fitted: false });
  }

  battleCamera(side = 'player', smooth = false) {
    // the 'enemy' side (player 2 in versus play) looks at the board from the opposite end
    const yaw = side === 'enemy' ? Math.PI : 0;
    this.camHome = null;
    Object.assign(this.cam, { orbit: 0, yawGoal: yaw });
    if (!smooth) this.cam.yaw = yaw;
    this.fitBoard(side);
  }

  /**
   * Frame the whole board: aim at its centre and pick the smallest distance at which every board corner
   * (and the far row at unit height) lands inside the part of the screen the HUD leaves free: the top bar
   * and hint above, the unit panel and legend below.
   */
  fitBoard(side = 'player') {
    const c = this.cam, cam = (this.fitCam ||= new THREE.PerspectiveCamera()).copy(this.camera);
    const yaw = side === 'enemy' ? Math.PI : 0, pitch = this.camera.aspect < 1 ? 1.32 : 0.98, cp = Math.cos(pitch); // phones: steeper, so the board fits the band between the HUD panels
    const hw = W * S / 2, hh = H * S / 2, v = new THREE.Vector3(), target = new THREE.Vector3(0, 0, 0);
    const pts = [[-hw, 0, -hh], [hw, 0, -hh], [-hw, 0, hh], [hw, 0, hh], [-hw, 2.2, -hh], [hw, 2.2, -hh], [-hw, 2.2, hh], [hw, 2.2, hh]];
    // the free band between the HUD panels actually on screen (desktop: top bar + hint; phones: also the
    // roster strip and legend), with room kept for the unit panel, which only appears once a hero is picked
    const ih = innerHeight || 1, phone = this.camera.aspect < 1;
    let top = ih * 0.1, bottom = ih * (phone ? 0.7 : 0.86);
    for (const sel of ['#topbar', '#roster', '#legend', '#hint', '#unitpanel', '#endturn']) {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      if (!r || !r.height || r.width > innerWidth * 0.9 && sel === '#roster' && !phone) continue;
      if (r.bottom < ih * 0.45) top = Math.max(top, r.bottom + 6);
      else if (r.top > ih * 0.55 && (phone || r.left < innerWidth * 0.75 && r.right > innerWidth * 0.25)) bottom = Math.min(bottom, r.top - 6);
    }
    const yMax = 1 - 2 * top / ih, yMin = 1 - 2 * bottom / ih;
    let dist = 90;
    for (let d = 12; d <= 90; d += 0.5) {
      cam.position.set(Math.sin(yaw) * cp * d, Math.sin(pitch) * d, -Math.cos(yaw) * cp * d);
      cam.lookAt(target); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      if (pts.every(([x, y, z]) => { v.set(x, y, z).project(cam); return v.x > -0.95 && v.x < 0.95 && v.y > yMin && v.y < yMax; })) { dist = d; break; }
    }
    Object.assign(c, { target, dist, pitch, side, fitted: true });
  }

  // ------------------------------------------------------------ input & loop
  bindInput(canvas) {
    let drag = null;
    const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
    const pick = e => {
      ray.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), this.camera);
      if (!ray.ray.intersectPlane(plane, hit)) return null;
      const x = Math.round(hit.x / S + (W - 1) / 2), y = Math.round(hit.z / S + (H - 1) / 2);
      return x >= 0 && y >= 0 && x < W && y < H ? [x, y] : null;
    };
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    // mouse: right-drag (or shift+drag) orbits. touch: one finger orbits once it moves, two fingers pinch-zoom;
    // either way a gesture never counts as a tap on a tile
    const touches = new Map();
    let pinch = 0;
    canvas.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') { touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (touches.size > 1 && drag) drag.moved = 99; pinch = 0; }
      if (touches.size <= 1) drag = { x: e.clientX, y: e.clientY, b: e.button, moved: 0, touch: e.pointerType === 'touch' };
    });
    const lift = e => { touches.delete(e.pointerId); pinch = 0; };
    addEventListener('pointercancel', e => { lift(e); drag = null; });
    addEventListener('pointerup', e => {
      lift(e);
      if (drag && drag.moved < 6 && e.target === canvas) {
        const t = pick(e);
        if (drag.b === 0) this.onClick?.(t); else if (drag.b === 2) this.onCancel?.();
      }
      if (!touches.size) drag = null;
    });
    canvas.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
        const t = touches.get(e.pointerId), dx = e.clientX - t.x, dy = e.clientY - t.y; t.x = e.clientX; t.y = e.clientY;
        if (touches.size > 1) {
          const [a, b] = [...touches.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
          if (pinch) { this.cam.dist = THREE.MathUtils.clamp(this.cam.dist - (d - pinch) * 0.06, 12, 90); this.cam.fitted = false; }
          pinch = d; return;
        }
        if (!drag) return;
        drag.moved += Math.abs(dx) + Math.abs(dy);
        if (drag.moved > 10) {
          this.cam.yawGoal -= dx * 0.008; this.cam.yaw = this.cam.yawGoal;
          this.cam.pitch = THREE.MathUtils.clamp(this.cam.pitch + dy * 0.005, 0.35, 1.35); this.cam.fitted = false;
          return;
        }
      } else if (drag) {
        drag.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
        if (drag.b === 2 || (drag.b === 0 && drag.moved > 6 && e.buttons & 1 && e.shiftKey)) {
          this.cam.yawGoal -= e.movementX * 0.006; this.cam.yaw = this.cam.yawGoal;
          this.cam.pitch = THREE.MathUtils.clamp(this.cam.pitch + e.movementY * 0.004, 0.35, 1.35); this.cam.fitted = false;
        }
      }
      this.onHover?.(pick(e), e);
    });
    canvas.addEventListener('wheel', e => { this.cam.dist = THREE.MathUtils.clamp(this.cam.dist + e.deltaY * 0.02, 12, 70); this.cam.fitted = false; }, { passive: true });
    addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      this.keys[e.code] = true;
      if (e.code === 'KeyQ') this.cam.yawGoal += Math.PI / 2;
      if (e.code === 'KeyE') this.cam.yawGoal -= Math.PI / 2;
    });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
  }

  frame() {
    const raw = Math.min(this.clock.getDelta(), 0.05), dt = raw * this.speed, time = this.clock.elapsedTime;
    // tweens (resolve after stepping so awaiting code sees final state)
    const done = [];
    for (const tw of this.tweens) { tw.t += dt; const k = Math.min(1, tw.t / tw.dur); tw.fn(k); if (k >= 1) done.push(tw); }
    if (done.length) { this.tweens = this.tweens.filter(t => !done.includes(t)); done.forEach(t => t.res()); }
    for (const uv of this.units.values()) {
      uv.actor.update(dt);
      if (uv.aura) { const k = 1 + Math.sin(time * 3 + uv.u.id) * 0.06; uv.aura.scale.set(k, 1, k); uv.aura.material.opacity = uv.u.alive ? 0.5 : 0; }
    }
    for (const a of this.extraActors) a.update(dt);
    // fire flicker
    for (const f of this.fires.values()) for (const c of f.children) if (c.userData.ph != null) { const s = 0.8 + Math.sin(time * 9 + c.userData.ph) * 0.25; c.scale.set(s, s * (1 + Math.sin(time * 13 + c.userData.ph) * 0.2), s); }
    if (this.campFlames) {
      for (const f of this.campFlames) f.scale.set(1, 0.8 + Math.sin(time * 11 + f.userData.ph * 2) * 0.25, 1);
      this.campLight.intensity = 55 + Math.sin(time * 17) * 6 + Math.sin(time * 7) * 6;
    }
    // camera
    const c = this.cam;
    if (c.orbit) c.yawGoal += raw * c.orbit;
    const pan = 14 * raw, fx = -Math.sin(c.yaw), fz = Math.cos(c.yaw);
    if (!c.orbit && !document.querySelector('.screen.active')) {
      if (this.keys.KeyW || this.keys.ArrowUp || this.keys.KeyS || this.keys.ArrowDown || this.keys.KeyA || this.keys.ArrowLeft || this.keys.KeyD || this.keys.ArrowRight) c.fitted = false;
      if (this.keys.KeyW || this.keys.ArrowUp) { c.target.x += fx * pan; c.target.z += fz * pan; }
      if (this.keys.KeyS || this.keys.ArrowDown) { c.target.x -= fx * pan; c.target.z -= fz * pan; }
      if (this.keys.KeyA || this.keys.ArrowLeft) { c.target.x += fz * pan; c.target.z -= fx * pan; }
      if (this.keys.KeyD || this.keys.ArrowRight) { c.target.x -= fz * pan; c.target.z += fx * pan; }
      c.target.x = THREE.MathUtils.clamp(c.target.x, -14, 14); c.target.z = THREE.MathUtils.clamp(c.target.z, -14, 14);
    }
    c.yaw += (c.yawGoal - c.yaw) * (1 - Math.exp(-raw * 10));
    const cp = Math.cos(c.pitch);
    this.camera.position.set(c.target.x + Math.sin(c.yaw) * cp * c.dist, c.target.y + Math.sin(c.pitch) * c.dist, c.target.z - Math.cos(c.yaw) * cp * c.dist);
    this.camera.lookAt(c.target);
    this.renderer.render(this.scene, this.camera);
    this.updateOverlayDom(dt);
  }

  updateOverlayDom(dt) {
    const v = new THREE.Vector3(), w = innerWidth, h = innerHeight;
    const place = (el, pos, y) => {
      v.copy(pos); v.y += y; v.project(this.camera);
      if (v.z > 1) { el.style.display = 'none'; return; }
      el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
    };
    for (const uv of this.units.values()) if (uv.u.alive) { uv.label.style.display = ''; place(uv.label, uv.actor.root.position, 2.55); }
    if (this.badge && this.badgeEl) place(this.badgeEl, tw(this.badge.x, this.badge.y), 3.4);
    for (const f of this.floats) {
      f.t += dt; place(f.el, f.pos, f.t * 0.9);
      f.el.style.opacity = String(Math.min(1, 2.4 - f.t * 2));
    }
    this.floats = this.floats.filter(f => { if (f.t > 1.2) { f.el.remove(); return false; } return true; });
  }
}
