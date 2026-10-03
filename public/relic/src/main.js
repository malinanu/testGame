// Forest Relic Hunt: Wildwood Colony. Boot, screens, render loop, input modes and glue between the
// simulation (sim.js), the 3D world (world3d.js), villagers (units.js), the hero (hero.js) and the HUD (ui.js).
import * as THREE from 'three';
import { loadGame } from './loader.js';
import { Colony } from './sim.js';
import { BUILDINGS, TILE, W, H, TIERS, RELICS, SANCTUM_POP } from './data.js';
import { World3D, tileToWorld, worldToTile } from './world3d.js';
import { RTSCamera } from './camera.js';
import { UI, renderThumbs } from './ui.js';
import { Units } from './units.js';
import { Adventure, HEROES } from './hero.js';
import { VFX } from '../../chess/src/vfx.js';
import { SFX } from '../../chess/src/sfx.js';
import { Ambience } from './ambience.js';
import { MATS, kitShared } from './kit.js';
import { sharedActorMaterials } from '../../src/actor.js';
import { CONSTRUCT_TIME } from './world3d.js';

const $ = id => document.getElementById(id);
const SAVE_KEY = 'wwc-save-v1';
let modal = true; // a full-screen panel covers the game: render less often behind it
const show = id => { modal = id !== 'none'; document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + id)); };
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } } };
// phones/tablets and 4-core machines start on Low; others on Medium (the player can always change it)
const LOW_END = matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency || 8) <= 4;
const QUALITIES = ['low', 'medium', 'high'];
const PARTICLES = { low: 150, medium: 300, high: 600 };

class Game {
  constructor(assets) {
    this.assets = assets;
    const q0 = store.get('wwc-quality') || (LOW_END ? 'low' : 'medium');
    // MSAA is the costliest per-pixel option on weak GPUs: off on Low (takes effect at the next page load)
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: q0 !== 'low', powerPreference: 'high-performance' });
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.shadowMap.autoUpdate = false; // refreshed every 1-4 frames by quality, see frame()
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0; r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 900);
    this.cam = new RTSCamera(this.camera, r.domElement);
    this.clock = new THREE.Clock();
    this.speed = 1; this.mode = 'select'; this.selected = null; this.heroMode = false;
    this.sfx = new SFX();
    this.setupLights();
    addEventListener('resize', () => this.resize());
    this.applyQuality(q0, false); this.autoQuality = !store.get('wwc-quality');
    this.bindInput();
    this.bindTouch();
    r.setAnimationLoop(() => this.frame());
  }

  setupLights() {
    const s = this.scene;
    s.background = new THREE.Color(0xa9d8cf); s.fog = new THREE.Fog(0xa9d8cf, 140, 420);
    this.hemi = new THREE.HemisphereLight(0xdff6ff, 0x3f5a35, 1.15); s.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d0, 2.5); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.04;
    s.add(this.sun, this.sun.target);
  }

  /** Graphics quality: pixel ratio, shadow map size/filtering, shadow casters and decor (see World3D.lod). */
  applyQuality(q, save = true) {
    this.quality = q; if (save) store.set('wwc-quality', q);
    const r = this.renderer, sh = this.sun.shadow, ms = q === 'low' ? 1024 : 2048;
    r.setPixelRatio(q === 'low' ? Math.min(devicePixelRatio, 1) : q === 'medium' ? Math.min(devicePixelRatio, 1.25) : Math.min(devicePixelRatio, 2));
    r.shadowMap.type = q === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    if (sh.mapSize.x !== ms) { sh.mapSize.set(ms, ms); sh.map?.dispose(); sh.map = null; }
    if (this.world) this.world._lodKey = null;
    if (this.fx) this.fx.maxParticles = PARTICLES[q];
    this.shadowEvery = q === 'low' ? 4 : q === 'medium' ? 2 : 1;
    this.resize();
    const el = $('m-quality'); if (el) el.textContent = `🖥️ Graphics: ${{ low: 'Low', medium: 'Medium', high: 'High' }[q]}`;
  }
  /** View distance by quality: the far plane (and the fog that hides it) follow the camera distance. */
  viewRange() {
    const far = (this.heroMode ? 30 : this.cam.dist) + { low: 110, medium: 170, high: 380 }[this.quality];
    if (Math.abs(far - this.camera.far) < 2) return;
    this.camera.far = far; this.camera.updateProjectionMatrix();
    this.scene.fog.near = far * 0.45; this.scene.fog.far = far;
  }
  /**
   * While the player hasn't picked a quality: measure 4-second windows of actual play and step quality
   * down one level whenever a window averages under 36 fps (never up: that would oscillate).
   */
  measure(raw) {
    if (modal || !this.speed) { this.fpsProbe = null; return; }
    const m = this.fpsProbe ||= { t: 0, n: 0, warm: 1.5 };
    if ((m.warm -= raw) > 0) return;
    m.t += raw; m.n++;
    if (m.t < 4) return;
    const fps = m.n / m.t; this.fpsProbe = { t: 0, n: 0, warm: 0 };
    const i = QUALITIES.indexOf(this.quality);
    if (fps < 36 && i > 0) {
      this.applyQuality(QUALITIES[i - 1], false);
      this.ui.notify(`Graphics lowered to ${QUALITIES[i - 1] === 'low' ? 'Low' : 'Medium'} for smoother play (${fps.toFixed(0)} fps). Change it in the menu.`, 'info');
    }
    if (this.quality === 'low') this.autoQuality = false;
  }

  resize() { const w = innerWidth, h = innerHeight; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  // ------------------------------------------------------------------ game lifecycle
  start(colony) {
    this.teardown();
    this.colony = colony;
    this.world = new World3D(this.scene, this.assets, colony);
    this.fx = new VFX(this.scene, '../assets/vfx/'); this.fx.preload(['smoke_01_a', 'spark_01_a', 'fire_8x8', 'star_06_a', 'smoke_07_a']); this.fx.maxParticles = PARTICLES[this.quality];
    this.units = new Units(this);
    this.ambience = new Ambience(this);
    this.adv = new Adventure(this);
    this.thumbs ||= renderThumbs(this.world.kit, this.renderer);
    this.ui = new UI(this);
    this.ui.renderBuild();
    const th = colony.ofType('townhall')[0], [x, z] = tileToWorld(th.cx - 0.5, th.cy - 0.5);
    this.cam.focus(x, z + 4, 0.38); this.cam.target.copy(this.cam.goal);
    this.units.restore();
    for (const r of colony.raids) this.adv.spawnRaid(r);
    this.labels = new Map(); $('labels').innerHTML = ''; this.labelT = 0;
    this.setMode('select'); this.setHeroMode(false);
    $('hud').classList.remove('hidden'); show('none');
    this.running = true; this.autosaveT = 60; this.uiT = 0; this.buildT = 0; this.mmT = 0;
    this.lastGold = -1;
  }
  /** Everything loaded once and reused by every game: geometry, materials and textures of the asset packs. */
  keepSet() {
    if (this.keep) return this.keep;
    const k = this.keep = new Set(), add = m => { if (!m) return; k.add(m); for (const v of Object.values(m)) if (v?.isTexture) k.add(v); };
    for (const group of Object.values(this.assets)) for (const sc of Object.values(group || {})) sc?.traverse?.(o => { if (o.geometry) k.add(o.geometry); [].concat(o.material || []).forEach(add); });
    return k;
  }
  /** Free the GPU memory of a finished game: its terrain, overlays, baked buildings, roads, forest chunks, VFX. */
  disposeScene(roots) {
    const keep = this.keepSet(), shared = new Set([...kitShared(), ...sharedActorMaterials()]);
    for (const m of shared) { keep.add(m); for (const v of Object.values(m)) if (v?.isTexture) keep.add(v); }
    const done = new Set(), free = x => { if (x && !keep.has(x) && !done.has(x)) { done.add(x); x.dispose(); } };
    for (const r of roots) r.traverse(o => {
      if (o.isInstancedMesh) o.dispose();
      free(o.geometry);
      for (const m of [].concat(o.material || [])) { if (keep.has(m)) continue; for (const v of Object.values(m)) if (v?.isTexture) free(v); free(m); }
    });
    for (const t of Object.values(this.fx?.tex || {})) free(t);
  }
  teardown() {
    if (!this.colony) return;
    const gone = [...this.scene.children].filter(o => o !== this.hemi && o !== this.sun && o !== this.sun.target);
    for (const o of gone) this.scene.remove(o);
    this.disposeScene([...gone, ...(this.units?.pool || []).map(a => a.root)]);
    this.colony = null; this.running = false;
  }
  save(quiet = false) {
    if (!this.colony) return;
    const ok = store.set(SAVE_KEY, this.colony.save());
    if (!quiet) this.ui.notify(ok ? '💾 Colony saved.' : 'Could not save (storage full or blocked).', ok ? 'good' : 'bad');
  }

  setSpeed(s) {
    this.speed = s;
    document.querySelectorAll('#speed button').forEach(b => b.classList.toggle('on', +b.dataset.s === s));
  }

  // ------------------------------------------------------------------ modes
  setMode(mode, type = null) {
    if (mode !== 'road') this.paved = false;
    this.mode = mode; this.buildType = type;
    this.clearGhost();
    $('tool-road').classList.toggle('on', mode === 'road' && !this.paved);
    $('tool-paved').classList.toggle('on', mode === 'road' && !!this.paved);
    $('tool-demolish').classList.toggle('on', mode === 'demolish');
    this.world?.setTerritoryVisible(mode === 'build' || mode === 'road');
    this.ui?.renderBuild();
    this.updateModeHint();
  }
  startBuild(type) {
    if (this.heroMode) return;
    const d = BUILDINGS[type], c = this.colony;
    if (d.tier && !c.tierUnlocked(d.tier)) { this.ui.notify(`${d.name} needs ${TIERS[d.tier].name}.`, 'warn'); return; }
    if (d.relics && c.relics.length < d.relics) { this.ui.notify(`${d.name} needs ${d.relics} relics.`, 'warn'); return; }
    if (this.mode === 'build' && this.buildType === type) return this.setMode('select');
    this.setMode('build', type);
    this.makeGhost(type);
  }
  updateModeHint(err = '') {
    const el = $('modehint');
    let t = '';
    const touch = document.body.classList.contains('touch');
    if (this.mode === 'build') t = touch ? `Placing <b>${BUILDINGS[this.buildType].name}</b>: tap a spot next to a road` : `Placing <b>${BUILDINGS[this.buildType].name}</b>: click a green spot next to a road · right-click / Esc to stop`;
    else if (this.mode === 'road' && touch) t = this.paved ? 'Paved roads: drag a finger to pave (🧱1 + 💰2 per tile)' : 'Roads: drag a finger to paint (💰1 per tile)';
    else if (this.mode === 'road') t = this.paved ? 'Paved roads: drag to paint or pave dirt roads (1 brick + 2 gold per tile) · Esc to stop' : 'Roads: drag to paint (1 gold per tile) · right-click / Esc to stop';
    else if (this.mode === 'demolish' && touch) t = 'Demolish: tap a building or road';
    else if (this.mode === 'demolish') t = 'Demolish: click a building or road (goods are half refunded) · Esc to stop';
    if (err) t += `<br><span class="err">${err}</span>`;
    if (t) t += ' <button id="mh-x" title="Stop (Esc)">✕</button>';
    el.innerHTML = t; el.classList.toggle('hidden', !t);
    const x = $('mh-x'); if (x) x.onclick = () => this.setMode('select');
  }

  makeGhost(type) {
    const kit = this.world.kit, def = BUILDINGS[type];
    const g = kit.model(type); // the cached bake: shares geometry, only the two ghost materials are new
    this.ghostMats = { ok: new THREE.MeshBasicMaterial({ color: 0x6dff8a, transparent: true, opacity: 0.45, depthWrite: false }), bad: new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.45, depthWrite: false }) };
    g.traverse(o => { if (o.isMesh) o.material = this.ghostMats.ok; });
    const foot = new THREE.Mesh(new THREE.PlaneGeometry(def.size[0] * TILE, def.size[1] * TILE).rotateX(-Math.PI / 2), this.ghostMats.ok);
    foot.position.y = 0.12; foot.userData.own = true; g.add(foot);
    const r = def.range || def.logistic || def.territory;
    if (r) { const ring = new THREE.Mesh(new THREE.RingGeometry(r * TILE - 0.25, r * TILE, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.8, depthWrite: false })); ring.position.y = 0.3; ring.userData.own = true; g.add(ring); }
    this.ghost = g; this.scene.add(g);
  }
  clearGhost() {
    this.hoverKey = null;
    if (this.ghost) { // the ghost owns its footprint/ring geometry and its two materials (the kit pieces are shared)
      this.scene.remove(this.ghost);
      this.ghost.traverse(o => { if (o.isMesh && o.userData.own) { o.geometry.dispose(); o.material.dispose(); } });
      this.ghostMats.ok.dispose(); this.ghostMats.bad.dispose(); this.ghost = null;
    } if (this.roadPreview) { this.scene.remove(this.roadPreview); this.roadPreview = null; } if (this.hoverMark) this.hoverMark.visible = false; }

  // ------------------------------------------------------------------ input
  bindInput() {
    const dom = this.renderer.domElement, ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
    this.pick = e => {
      ray.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), this.camera);
      if (!ray.ray.intersectPlane(plane, hit)) return null;
      return { x: hit.x, z: hit.z, tile: worldToTile(hit.x, hit.z) };
    };
    this.rayObjects = e => { ray.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), this.camera); return ray; };
    dom.addEventListener('pointermove', e => { this.mouse = e; if (this.running && !this.heroMode) this.hover(e); });
    dom.addEventListener('pointerdown', e => {
      if (!this.running) return;
      this.sfx.ensure();
      const touch = e.pointerType === 'touch';
      if (touch) document.body.classList.add('touch');
      if (this.heroMode) { if (e.button === 0 && !touch) this.adv.attack(); return; }
      if (touch && this.cam.touches.size > 1) { // a second finger: it's a pinch, not a tap or a road
        this.down = null; if (this.roadDrag) { this.roadDrag = null; if (this.roadPreview) { this.scene.remove(this.roadPreview); this.roadPreview = null; } this.updateModeHint(); }
        return;
      }
      if (touch) this.hover(e);
      if (e.button === 2) { if (this.mode !== 'select') this.setMode('select'); return; }
      if (e.button !== 0) return;
      const p = this.pick(e); if (!p) return;
      if (this.mode === 'road') { this.roadDrag = { from: p.tile, to: p.tile }; this.previewRoad(); return; }
      this.down = { x: e.clientX, y: e.clientY };
    });
    addEventListener('pointerup', e => {
      if (!this.running || this.heroMode || e.button !== 0) return;
      if (this.roadDrag) { this.placeRoad(); return; }
      if (e.pointerType === 'touch' && this.cam.gesture) { this.down = null; return; }
      if (!this.down || Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 6 || e.target !== dom) { this.down = null; return; }
      this.down = null;
      const p = this.pick(e); if (!p) return;
      this.click(p, e);
    });
    addEventListener('keydown', e => {
      if (!this.running || e.target.tagName === 'INPUT') return;
      const k = e.code;
      if (k === 'KeyH') return this.setHeroMode(!this.heroMode);
      if (this.heroMode) {
        if (k === 'KeyF') this.adv.attack();
        if (k === 'KeyE') this.adv.interact();
        if (k === 'Escape') this.setHeroMode(false);
        if (k === 'Space') e.preventDefault();
        return;
      }
      if (k === 'Escape') { if (this.mode !== 'select') this.setMode('select'); else if (this.selected) { this.selected = null; this.ui.renderInspector(); } else this.openMenu(); }
      else if (k === 'KeyR') this.roadTool(false);
      else if (k === 'KeyP') this.roadTool(true);
      else if (k === 'KeyO') this.openStats();
      else if (k === 'KeyC') this.copyHovered();
      else if (k === 'KeyX') this.setMode(this.mode === 'demolish' ? 'select' : 'demolish');
      else if (k === 'Space') { e.preventDefault(); this.setSpeed(this.speed ? 0 : 1); }
      else if (k === 'Digit1') this.setSpeed(1); else if (k === 'Digit2') this.setSpeed(2); else if (k === 'Digit3') this.setSpeed(4);
      else if (k === 'KeyM') $('minimapwrap').classList.toggle('hidden');
      else if (k === 'F1') { e.preventDefault(); show('help'); }
    });
    $('tool-road').onclick = () => this.roadTool(false);
    $('tool-paved').onclick = () => this.roadTool(true);
    $('b-stats').onclick = () => this.openStats();
    $('statstabs').querySelectorAll('button').forEach(b => { b.onclick = () => { $('statstabs').querySelectorAll('button').forEach(q => q.classList.toggle('on', q === b)); this.ui.renderStats(b.dataset.tab); }; });
    $('b-statsclose').onclick = () => { show('none'); this.setSpeed(this.prevSpeed || 1); };
    $('tool-demolish').onclick = () => this.setMode(this.mode === 'demolish' ? 'select' : 'demolish');
    $('tool-hero').onclick = () => this.setHeroMode(!this.heroMode);
    $('tool-map').onclick = () => {
      const r = this.colony.useMap();
      if (r.error) return this.ui.notify(r.error, 'warn');
      const l = this.colony.lairs.find(q => q.id === r.lair), [x, z] = tileToWorld(l.x + 1, l.y + 1);
      this.cam.focus(x, z, 0.6); this.sfx.magic(); this.ui.notify('The map reveals a relic site!', 'good');
    };
    $('b-menu').onclick = () => this.openMenu();
  }

  roadTool(paved) {
    if (this.mode === 'road' && !!this.paved === paved) return this.setMode('select');
    this.paved = paved; this.setMode('road');
  }
  openStats() {
    this.prevSpeed = this.speed || this.prevSpeed || 1; this.setSpeed(0);
    const tab = this.ui.statsTab || 'goods';
    $('statstabs').querySelectorAll('button').forEach(q => q.classList.toggle('on', q.dataset.tab === tab));
    this.ui.renderStats(tab); show('stats');
  }
  /** Anno-style copy: C over a building starts placing another of its type. */
  copyHovered() {
    const c = this.colony, p = this.mouse && this.pick(this.mouse);
    const sel = p && p.tile[0] >= 0 && p.tile[1] >= 0 && p.tile[0] < W && p.tile[1] < H ? c.buildings.get(c.occ[p.tile[1] * W + p.tile[0]]) : null;
    const b = sel || (this.selected?.kind === 'building' ? c.buildings.get(this.selected.id) : null);
    if (!b) return;
    const type = BUILDINGS[b.type].tier != null || b.tier != null ? 'hut' : b.type;
    if (BUILDINGS[type].buildable === false || BUILDINGS[type].unique) return this.ui.notify(`Only one ${BUILDINGS[type].name} can exist.`, 'warn');
    this.startBuild(type);
  }

  /** On-screen joystick + action buttons for the hero on touch screens; one-finger road painting. */
  bindTouch() {
    if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
    this.cam.canPan = () => this.mode !== 'road';
    const stick = $('stick'), knob = stick.querySelector('i'), keys = this.cam.keys;
    let sid = null, c0 = null;
    const move = e => {
      let dx = e.clientX - c0.x, dy = e.clientY - c0.y; const len = Math.hypot(dx, dy);
      if (len > c0.R) { dx *= c0.R / len; dy *= c0.R / len; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      keys.stick = len < c0.R * 0.2 ? null : { x: dx / c0.R, z: dy / c0.R };
    };
    stick.addEventListener('pointerdown', e => { e.preventDefault(); sid = e.pointerId; stick.setPointerCapture(sid); const r = stick.getBoundingClientRect(); c0 = { x: r.left + r.width / 2, y: r.top + r.height / 2, R: r.width / 2 }; move(e); });
    stick.addEventListener('pointermove', e => { if (e.pointerId === sid) move(e); });
    const end = () => { sid = null; keys.stick = null; knob.style.transform = ''; };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
    const hold = (id, down, up = () => {}) => { const b = $(id); b.addEventListener('pointerdown', e => { e.preventDefault(); this.sfx.ensure(); down(); }); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); };
    hold('t-attack', () => this.adv.attack());
    hold('t-use', () => this.adv.interact());
    hold('t-jump', () => { keys.Space = true; }, () => { keys.Space = false; });
  }

  focusTile(tx, ty) { const [x, z] = tileToWorld(tx, ty); this.cam.focus(x, z); }

  /** Footprint top-left tile so the building is centered on the mouse. */
  anchor(tile, type) { const [w, h] = BUILDINGS[type].size; return [tile[0] - Math.floor((w - 1) / 2), tile[1] - Math.floor((h - 1) / 2)]; }

  hover(e) {
    const p = this.pick(e), c = this.colony; if (!p) return;
    if (this.mode === 'build' && this.ghost) {
      const hk = `${p.tile}|${this.buildType}|${c.affordable(c.costOf(this.buildType))}`; // placement checks only change with the tile (or money)
      if (hk === this.hoverKey) return; this.hoverKey = hk;
      const [x, y] = this.anchor(p.tile, this.buildType), def = BUILDINGS[this.buildType];
      const [wx, wz] = tileToWorld(x + def.size[0] / 2 - 0.5, y + def.size[1] / 2 - 0.5);
      this.ghost.position.set(wx, 0, wz);
      let err = c.placeError(this.buildType, x, y);
      if (!err && !def.on) for (let j = 0; j < def.size[1] && !err; j++) for (let i = 0; i < def.size[0]; i++) if (c.depositAt(x + i, y + j)) { err = 'A deposit is in the way: only mines go there'; break; }
      if (!err && !c.affordable(c.costOf(this.buildType))) err = `Not enough ${c.missing(c.costOf(this.buildType)).join(', ')}`;
      let warn = '';
      if (!err) {
        const touchesRoad = c.doorTiles({ x, y, w: def.size[0], h: def.size[1] }).length > 0;
        if (!touchesRoad && this.buildType !== 'outpost') warn = 'Tip: it needs a road next to it';
        if (def.near?.what === 'tree') { const n = c.nearCount(x + def.size[0] / 2, y + def.size[1] / 2, def.near); warn = `Trees in range: ${Math.round(Math.min(1, n / def.near.full) * 100)}% productivity` + (touchesRoad ? '' : ' · needs a road'); }
      }
      const m = err ? this.ghostMats.bad : this.ghostMats.ok;
      this.ghost.traverse(o => { if (o.isMesh && o.material !== m && (o.material === this.ghostMats.ok || o.material === this.ghostMats.bad)) o.material = m; });
      this.ghostErr = err;
      this.updateModeHint(err || warn);
    } else if (this.mode === 'road' && this.roadDrag) { this.roadDrag.to = p.tile; this.previewRoad(); }
    else if (this.mode === 'demolish' || this.mode === 'road') this.markTile(p.tile, this.mode === 'demolish' ? 0xff5a4a : 0xffe27a);
    else this.markTile(null);
  }
  markTile(tile, color = 0xffffff) {
    if (!this.hoverMark) { this.hoverMark = new THREE.Mesh(new THREE.PlaneGeometry(TILE, TILE).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, depthWrite: false })); this.hoverMark.position.y = 0.15; }
    if (!tile) { this.hoverMark.visible = false; return; }
    const c = this.colony, k = tile[1] * W + tile[0], b = c.buildings.get(c.occ[k]);
    if (this.mode === 'demolish' && b) {
      const [wx, wz] = tileToWorld(b.x + b.w / 2 - 0.5, b.y + b.h / 2 - 0.5);
      this.hoverMark.scale.set(b.w, 1, b.h); this.hoverMark.position.set(wx, 0.15, wz);
    } else { const [wx, wz] = tileToWorld(tile[0], tile[1]); this.hoverMark.scale.set(1, 1, 1); this.hoverMark.position.set(wx, 0.15, wz); }
    this.hoverMark.material.color.set(color); this.hoverMark.visible = true;
    if (!this.hoverMark.parent) this.scene.add(this.hoverMark);
  }

  roadTiles() {
    const { from, to } = this.roadDrag, out = [];
    const sx = Math.sign(to[0] - from[0]), sy = Math.sign(to[1] - from[1]);
    for (let x = from[0]; ; x += sx) { out.push([x, from[1]]); if (x === to[0] || !sx) break; }
    if (sy) for (let y = from[1] + sy; ; y += sy) { out.push([to[0], y]); if (y === to[1]) break; }
    return out;
  }
  previewRoad() {
    if (this.roadPreview) this.scene.remove(this.roadPreview);
    const tiles = this.roadTiles(), c = this.colony;
    const g = new THREE.Group();
    const P = this.previewRes ||= { geo: new THREE.PlaneGeometry(TILE * 0.8, TILE * 0.8).rotateX(-Math.PI / 2), ok: new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.6, depthWrite: false }), bad: new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.5, depthWrite: false }) };
    const okM = P.ok, badM = P.bad; // shared: a drag re-previews on every pointer move
    let cost = 0, bad = 0;
    for (const [x, y] of tiles) {
      const lvl = c.road[y * W + x], existing = this.paved ? lvl === 2 : lvl > 0;
      const err = existing || (this.paved && lvl === 1) ? '' : c.placeError('road', x, y) || (c.depositAt(x, y) ? 'deposit' : '');
      if (!existing && !err) cost++; if (err) bad++;
      const m = new THREE.Mesh(P.geo, err ? badM : okM);
      const [wx, wz] = tileToWorld(x, y); m.position.set(wx, 0.2, wz); g.add(m);
    }
    this.roadPreview = g; this.scene.add(g);
    this.updateModeHint(this.paved ? `${cost} tiles to pave · 🧱${cost} 💰${cost * 2}${bad ? ` · ${bad} blocked` : ''}` : `${cost} new tiles · 💰${cost}${bad ? ` · ${bad} blocked` : ''}`);
  }
  placeRoad() {
    const tiles = this.roadTiles(); let n = 0, last = '';
    for (const [x, y] of tiles) {
      const lvl = this.colony.road[y * W + x];
      if (this.paved ? lvl === 2 : lvl) continue;
      const r = this.colony.buildRoad(x, y, !!this.paved); if (r.error) { last = r.error; if (this.paved && r.error.startsWith('Paving')) break; } else n++;
    }
    this.roadDrag = null; if (this.roadPreview) { this.scene.remove(this.roadPreview); this.roadPreview = null; }
    if (n) this.sfx.step(); else if (last) this.ui.notify(last, 'warn');
    this.updateModeHint();
  }

  click(p, e) {
    const c = this.colony;
    if (this.mode === 'build') {
      const [x, y] = this.anchor(p.tile, this.buildType), r = c.build(this.buildType, x, y);
      if (r.error) { this.ui.notify(r.error, 'warn'); this.sfx.tone?.(180, 0.15, { gain: 0.15 }); return; }
      this.sfx.thud();
      this.fx.burst(new THREE.Vector3(...this.worldOf(r, 0.3)), { tex: 'smoke_01_a', color: 0xd8c8a8, count: 10, speed: 2.5, life: 1, size: 1.4, additive: false, gravity: 0.5 });
      if (BUILDINGS[this.buildType].unique) this.setMode('select');
      return;
    }
    if (this.mode === 'demolish') {
      const r = c.demolish(p.tile[0], p.tile[1]);
      if (r.error) this.ui.notify(r.error, 'warn'); else { this.sfx.shatter(); this.fx.burst(new THREE.Vector3(p.x, 0.5, p.z), { tex: 'smoke_01_a', color: 0x9a8a78, count: 12, speed: 3, size: 1.3, additive: false, gravity: 0.3 }); }
      return;
    }
    if (this.mode === 'road') return;
    // select: building, lair, deposit
    const k = p.tile[1] * W + p.tile[0];
    if (p.tile[0] >= 0 && p.tile[1] >= 0 && p.tile[0] < W && p.tile[1] < H && c.occ[k]) { this.selected = { kind: 'building', id: c.occ[k] }; this.sfx.step(); }
    else {
      const l = c.lairs.find(q => q.found && p.tile[0] >= q.x - 1 && p.tile[0] <= q.x + 3 && p.tile[1] >= q.y - 1 && p.tile[1] <= q.y + 3);
      const d = c.deposits.find(q => q.found && p.tile[0] >= q.x && p.tile[0] <= q.x + 1 && p.tile[1] >= q.y && p.tile[1] <= q.y + 1);
      this.selected = l ? { kind: 'lair', id: l.id } : d ? { kind: 'deposit', id: d.id } : null;
    }
    this.ui.renderInspector();
  }

  inspectorAction(act, data) {
    const c = this.colony, sel = this.selected;
    const b = sel?.kind === 'building' ? c.buildings.get(sel.id) : null;
    let r = null;
    if (act === 'close') { this.selected = null; }
    else if (act === 'upgrade') { r = c.upgrade(b.id); if (!r.error) { this.sfx.chime(); this.fx.burst(new THREE.Vector3(...this.worldOf(b, 3)), { tex: 'star_06_a', color: 0xffd54a, count: 18, speed: 4 }); } }
    else if (act === 'repair') { r = c.repair(b.id); if (!r.error) this.sfx.clang(); }
    else if (act === 'pause') c.togglePause(b.id);
    else if (act === 'demolish') { r = c.demolish(b.x, b.y); this.selected = null; this.sfx.shatter(); }
    else if (act === 'buy' || act === 'sell') { r = c.trade(data.good, act === 'buy' ? 5 : -5); if (!r.error) this.sfx.clang(); }
    else if (act === 'hero') this.setHeroMode(true);
    else if (act === 'festival') r = c.festival();
    else if (act === 'expedition') r = c.startExpedition();
    else if (act === 'copy') { this.selected = null; this.ui.renderInspector(); return this.startBuild(data.type); }
    if (r?.error) this.ui.notify(r.error, 'warn');
    this.ui.renderInspector(); this.ui.renderTop();
  }
  worldOf(b, y = 0) { const [x, z] = tileToWorld(b.cx - 0.5, b.cy - 0.5); return [x, y, z]; }

  setHeroMode(on) {
    if (!this.colony) return;
    this.heroMode = on;
    document.body.classList.toggle('heromode', on);
    $('herohud').classList.toggle('hidden', !on);
    $('tool-hero').querySelector('span').textContent = on ? 'Back to town' : 'Take the field';
    if (on) { this.setMode('select'); this.selected = null; this.ui?.renderInspector(); if (this.speed === 0) this.setSpeed(1); this.cam.setHero(this.adv.hero.root); }
    else this.cam.setHero(null);
  }

  openMenu() { this.prevSpeed = this.speed || this.prevSpeed || 1; this.setSpeed(0); show('menu'); }

  // ------------------------------------------------------------------ events from the sim
  drain() {
    const c = this.colony, ev = c.events; c.events = [];
    for (const e of ev) {
      // a lumberjack walks over and chops before the tree falls
      if (e.type === 'tree' && !e.on && e.by) { const job = this.units.chop(e.by, e.x, e.y); if (job) { e.deferred = true; job.onFelled = () => this.world.setTree(e.x, e.y, false); } }
      this.world.handle(e);
      switch (e.type) {
        case 'notify': this.ui.notify(e.text, e.kind); break;
        case 'trip': this.units.trip(e.trip); break;
        case 'built': case 'upgraded': { const b = c.buildings.get(e.id); if (b) this.units.build(b, CONSTRUCT_TIME); break; }
        case 'produced': { const b = c.buildings.get(e.id); if (b) this.ambience.produced(b, new THREE.Vector3(...this.worldOf(b))); break; }
        case 'raid': this.adv.spawnRaid(e.raid); this.sfx.doom(); break;
        case 'raidEnd': this.adv.endRaid(e.raid, e.outcome); if (e.outcome === 'tower') this.sfx.twang(); break;
        case 'fire': this.sfx.thud(true); break;
        case 'tree': if (!e.on && e.by) this.sfx.noise?.(0.25, { freq: 900, gain: 0.04 }); break;
        case 'removed': case 'territory': case 'fog': case 'road': this.ui.mmDirty = true; this.buildDirty = true; break;
        case 'relic': this.buildDirty = true; break;
        case 'quest': this.sfx.chime(); break;
        case 'festival': this.sfx.chime(); this.sfx.magic(); break;
        case 'expedition': if (e.out) this.sfx.step(); else this.sfx.magic(); this.ui.mmDirty = true; break;
        case 'victory': this.victory(); break;
      }
      if (e.type === 'built' || e.type === 'upgraded') { this.ui.mmDirty = true; this.buildDirty = true; }
    }
  }
  victory() {
    const c = this.colony;
    $('victext').innerHTML = `In ${Math.floor(c.time / 60)} minutes your Founder bound the five relics. ${c.pop.total} residents live in the Wildwood, and the Sanctum's light can be seen from every valley.`;
    this.setSpeed(0); show('victory'); this.sfx.chime(); this.save(true);
  }

  // ------------------------------------------------------------------ per-frame visuals
  dayNight(dt) {
    const c = this.colony, d = c.day, a = d * Math.PI * 2, isNight = c.night;
    const elev = isNight ? 0.6 : 0.25 + Math.sin(Math.min(1, d / 0.62) * Math.PI) * 0.9;
    const t = this.cam.target;
    this.sun.position.set(t.x + Math.cos(a) * 60, 30 + elev * 60, t.z + Math.sin(a) * 40 + 30);
    this.sun.target.position.copy(t);
    const span = THREE.MathUtils.clamp(this.cam.dist * 0.8, 40, 110), sc = this.sun.shadow.camera;
    if (sc.right !== span) { sc.left = sc.bottom = -span; sc.right = sc.top = span; sc.far = 300; sc.updateProjectionMatrix(); }
    const dusk = d > 0.5 && d < 0.62 ? (d - 0.5) / 0.12 : d > 0.95 || d < 0.06 ? 0.6 : 0;
    const C = this.dnC ||= { a: new THREE.Color(), b: new THREE.Color(), dusk: new THREE.Color(0xff9a50), day: new THREE.Color(0xfff1d0), off: new THREE.Color(0x2a2018), on: new THREE.Color(0xffc45a) }; // scratch: no allocations per frame
    const sunCol = C.a.copy(C.day).lerp(C.dusk, dusk);
    const target = isNight ? { sun: 0.32, hemi: 0.32, sky: 0x18223a, col: 0x8aa0ff, glow: 1 }
      : { sun: 2.5 - dusk * 1.0, hemi: 1.15 - dusk * 0.35, sky: dusk ? 0xe0a880 : 0xa9d8cf, col: sunCol.getHex(), glow: dusk * 0.6 };
    const k = 1 - Math.exp(-dt * 1.4); // converge in real time, whatever the frame rate
    this.sun.intensity += (target.sun - this.sun.intensity) * k; this.hemi.intensity += (target.hemi - this.hemi.intensity) * k;
    this.sun.color.lerp(C.b.set(target.col), k);
    this.scene.background.lerp(C.b.set(target.sky), k); this.scene.fog.color.copy(this.scene.background);
    this.glow = (this.glow || 0) + (target.glow - (this.glow || 0)) * k;
    MATS.window().color.copy(C.off).lerp(C.on, this.glow);
  }

  smoke(dt) {
    this.smokeT = (this.smokeT || 0) - dt;
    if (this.smokeT > 0) return;
    this.smokeT = 0.35;
    const c = this.colony, t = this.cam.target, R = this.camera.far * 0.7;
    for (const [id, o] of this.world.buildingObjs) {
      const b = c.buildings.get(id); if (!b) continue;
      // smoke nobody can see is just overdraw
      const [bx, , bz] = this.worldOf(b); if (Math.hypot(bx - t.x, bz - t.z) > R) continue;
      const burning = b.fire > 0;
      if (burning) { const p = new THREE.Vector3(...this.worldOf(b, 1.5)); this.fx.burst(p, { tex: 'smoke_07_a', color: 0x40342c, count: 2, speed: 2, life: 2.2, size: 3, additive: false, gravity: 1.2, spread: 0.4 }); this.fx.burst(p, { tex: 'spark_01_a', color: 0xff8a3a, count: 3, speed: 3, life: 0.8, size: 0.6, gravity: 2 }); continue; }
      if (!o.smokes.length || !(b.running || b.tier != null) || Math.random() < 0.4) continue;
      for (const s of o.smokes) { const p = s.getWorldPosition(new THREE.Vector3()); this.fx.burst(p, { tex: 'smoke_01_a', color: 0xe8e2da, count: 1, speed: 0.8, life: 2.5, size: 1.1, additive: false, gravity: 0.7, spread: 0.2, drag: 0.98 }); }
    }
  }

  /** Festival VFX: confetti bursts over the Town Hall, Market and Tavern while it lasts. */
  confetti(dt) {
    const c = this.colony;
    if (!(c.festivalUntil > c.time) || (this.confT = (this.confT || 0) - dt) > 0) return;
    this.confT = 0.5;
    const cols = [0xff5a6a, 0xffd54a, 0x6ad0ff, 0x8aff7a, 0xd88aff];
    for (const b of c.buildings.values()) {
      if (!['townhall', 'market', 'tavern'].includes(b.type) || Math.random() < 0.4) continue;
      const p = new THREE.Vector3(...this.worldOf(b, 6));
      p.x += (Math.random() - 0.5) * 4; p.z += (Math.random() - 0.5) * 4;
      this.fx.burst(p, { tex: 'star_06_a', color: cols[Math.floor(Math.random() * cols.length)], count: 8, speed: 3, life: 1.6, size: 0.5, gravity: 2.5 });
    }
  }

  /**
   * World-anchored labels. Their content (which buildings need an icon, which lairs are known) changes
   * rarely, so it is rebuilt at 4 Hz; positions follow the camera every frame but only touch the DOM
   * when a label actually moves by half a pixel.
   */
  labelsUpdate(raw) {
    const c = this.colony, el = $('labels');
    if ((this.labelT = (this.labelT || 0) - raw) <= 0) {
      this.labelT = 0.25;
      const seen = new Set();
      const put = (key, html, cls, wx, wy, wz) => {
        seen.add(key);
        let L = this.labels.get(key);
        if (!L) {
          const d = document.createElement('div'); d.className = cls; d.style.left = '0'; d.style.top = '0';
          d.innerHTML = '<span></span>'; el.appendChild(d);
          L = { d, span: d.firstChild, html: '', sx: NaN, sy: NaN, vis: true }; this.labels.set(key, L);
        }
        if (L.html !== html) { L.html = html; L.span.innerHTML = html; }
        if (L.d.className !== cls) L.d.className = cls;
        L.wx = wx; L.wy = wy; L.wz = wz;
      };
      if (!this.heroMode) for (const b of c.buildings.values()) {
        const def = BUILDINGS[b.type];
        let icon = '';
        if (b.fire) icon = '🔥'; else if (b.ruined) icon = '🏚️';
        else if (!b.connected && !def.storage && b.type !== 'outpost') icon = '⚠️🛤️';
        else if (def.cycle && b.prod === 0 && b.status.startsWith('Missing')) icon = '📦❓';
        else if (def.cycle && b.status.startsWith('Short')) icon = '👷❓';
        else if (b.tier != null && b.residents < TIERS[b.tier].cap * 0.5 && b.built + 60 < c.time) icon = '😟';
        if (icon) { const [x, , z] = this.worldOf(b); put('b' + b.id, icon, 'blabel', x, 5.2, z); }
      }
      for (const l of c.lairs) if (l.found && (!l.cleared || (l.relic && !l.relicTaken))) {
        const [x, z] = tileToWorld(l.x + 1, l.y + 1);
        const r = l.relic && RELICS.find(q => q.id === l.relic);
        put('l' + l.id, l.cleared ? `💎 ${r.name}` : `☠️ ${{ camp: 'Bandit Camp', den: 'Brute Den', ruin: 'Haunted Ruin' }[l.kind]}${r && !l.relicTaken ? ` · ${r.icon}` : ''}`, 'flabel' + (r ? ' relic' : ''), x, 6.5, z);
      }
      for (const [k, L] of this.labels) if (!seen.has(k)) { L.d.remove(); this.labels.delete(k); }
    }
    const v = this.labelV ||= new THREE.Vector3(), W2 = innerWidth / 2, H2 = innerHeight / 2;
    for (const L of this.labels.values()) {
      v.set(L.wx, L.wy, L.wz).project(this.camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      if (vis !== L.vis) { L.vis = vis; L.d.style.display = vis ? '' : 'none'; }
      if (!vis) continue;
      const sx = (v.x + 1) * W2, sy = (1 - v.y) * H2;
      if (Math.abs(sx - L.sx) < 0.5 && Math.abs(sy - L.sy) < 0.5) continue;
      L.sx = sx; L.sy = sy; L.d.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
    }
    if (this.heroMode) { const it = this.adv.interaction(), t = it ? it.text : ''; if (t !== this.promptText) { this.promptText = t; $('heroprompt').textContent = t; } }
  }

  heroHud() {
    const h = this.adv.hero, c = this.colony;
    $('herohp').style.width = `${h.hp / h.maxHp * 100}%`; $('herohptxt').textContent = `${Math.ceil(h.hp)} / ${h.maxHp}`;
    const r = c.hero.carry && RELICS.find(q => q.id === c.hero.carry);
    $('herocarry').textContent = r ? `🎒 Carrying the ${r.name}: bring it to the Town Hall` : '';
  }

  frame() {
    // behind the title, menu, stats or help screens the scene only needs ~10 fps (the clock keeps
    // counting, so the simulation loses no time)
    const now = performance.now();
    if (modal && now - (this.lastDraw || 0) < 100) return;
    this.lastDraw = now;
    const raw = Math.min(this.clock.getDelta(), 0.1);
    this.frameN = (this.frameN || 0) + 1;
    if (this.frameN % (this.shadowEvery || 1) === 0) this.renderer.shadowMap.needsUpdate = true;
    if (!this.running) { this.renderer.render(this.scene, this.camera); return; }
    const c = this.colony, dt = raw * this.speed;
    if (dt > 0) c.step(dt);
    this.drain();
    const t = this.clock.elapsedTime;
    this.world.update(raw, t);
    this.units.update(raw);
    this.adv.update(raw * (this.speed ? 1 : 0), this.cam.keys, this.cam.moveYaw, this.heroMode);
    this.fx.update(raw);
    this.smoke(raw * (this.speed ? 1 : 0));
    this.confetti(raw * (this.speed ? 1 : 0));
    this.cam.update(raw, !!document.querySelector('.screen.active'));
    this.dayNight(raw);
    this.world.lod(this.cam.target, this.cam.zoom, this.quality, this.camera.position);
    this.viewRange();
    if (this.autoQuality) this.measure(raw);
    this.ambience.update(raw);
    this.labelsUpdate(raw);
    if ((this.uiT -= raw) <= 0) {
      this.uiT = 0.25; this.ui.renderTop();
      if (this.heroMode) this.heroHud();
      if ((this.inspT = (this.inspT || 0) - 1) <= 0) { this.inspT = 2; if (this.selected) this.ui.renderInspector(); }
    }
    if ((this.buildT -= raw) <= 0 || this.buildDirty) { this.buildT = 1.5; this.buildDirty = false; this.ui.renderBuild(); }
    if ((this.mmT -= raw) <= 0) { this.mmT = 0.5; const [tx, ty] = worldToTile(this.cam.target.x, this.cam.target.z); this.ui.renderMinimap([tx, ty], this.adv.heroTile()); }
    if ((this.autosaveT -= raw) <= 0) { this.autosaveT = 60; this.save(true); }
    this.renderer.render(this.scene, this.camera);
  }
}

// ------------------------------------------------------------------ boot & screens
const assets = await loadGame((d, n) => { $('loadbar').style.width = `${Math.round(d / n * 100)}%`; $('loadtxt').textContent = `Unpacking the wagons… ${Math.round(d / n * 100)}%`; });
const game = new Game(assets);
window.game = game; // for debugging and automated tests

let founder = 'Knight', difficulty = store.get('wwc-diff') || 'normal';
function titleScreen() {
  game.running = false; $('hud').classList.add('hidden');
  const saved = store.get(SAVE_KEY);
  let info = '';
  if (saved) { try { const d = JSON.parse(saved); info = `Saved colony: day ${Math.floor(d.time / 240) + 1}, ${d.buildings.length} buildings, ${d.relics.length}/5 relics (${({ easy: 'Relaxed', normal: 'Settler', hard: 'Pioneer' })[d.difficulty || 'normal']}).`; } catch { info = ''; } }
  $('b-continue').classList.toggle('hidden', !saved); $('savedinfo').textContent = info;
  show('title');
}
function newScreen() {
  $('founders').innerHTML = Object.entries(HEROES).map(([k, h]) => `<button class="founder ${k === founder ? 'sel' : ''}" data-k="${k}"><div class="pt" style="background-image:url(../assets/ui/hero-${k.toLowerCase()}.webp)"></div><b>${k}</b><small>${h.blurb}<br>❤ ${h.hp} · ${h.ranged ? 'Ranged' : 'Melee'}</small></button>`).join('');
  $('founders').querySelectorAll('.founder').forEach(b => { b.onclick = () => { founder = b.dataset.k; newScreen(); }; b.ondblclick = () => $('b-start').click(); });
  if (!$('seed').value) $('seed').value = 1 + Math.floor(Math.random() * 99999);
  document.querySelectorAll('#diffs button').forEach(b => { b.classList.toggle('on', b.dataset.d === difficulty); b.onclick = () => { difficulty = b.dataset.d; store.set('wwc-diff', difficulty); newScreen(); }; });
  show('new');
}
$('b-new').onclick = () => { if (store.get(SAVE_KEY) && !confirm('Start a new colony? Your saved colony will be replaced when the new one autosaves.')) return; newScreen(); };
$('b-newback').onclick = titleScreen;
$('b-reroll').onclick = () => { $('seed').value = 1 + Math.floor(Math.random() * 99999); };
$('b-start').onclick = () => { game.start(new Colony({ seed: Math.max(1, +$('seed').value || 1), hero: founder, difficulty })); game.ui.notify('Welcome, Founder! Follow the objective at the top left.', 'good'); game.save(true); if (!store.get('wwc-help-seen')) { store.set('wwc-help-seen', '1'); show('help'); } };
$('b-continue').onclick = () => { try { game.start(Colony.load(store.get(SAVE_KEY))); } catch (err) { console.error(err); alert('The save could not be loaded. Start a new colony.'); } };
$('b-help').onclick = () => show('help');
$('b-helpclose').onclick = () => { if (game.running) show('none'); else titleScreen(); };
$('m-resume').onclick = () => { show('none'); game.setSpeed(game.prevSpeed || 1); };
$('m-save').onclick = () => { game.save(); show('none'); game.setSpeed(game.prevSpeed || 1); };
$('m-help').onclick = () => show('help');
const soundLabel = () => { $('m-sound').textContent = game.sfx.muted ? '🔇 Sound: off' : '🔊 Sound: on'; };
$('m-sound').onclick = () => { game.sfx.setMuted(!game.sfx.muted); soundLabel(); }; soundLabel();
$('m-quality').onclick = () => { game.applyQuality({ low: 'medium', medium: 'high', high: 'low' }[game.quality]); game.autoQuality = false; };
game.applyQuality(game.quality, false);
$('m-title').onclick = () => { game.save(true); titleScreen(); };
$('b-sandbox').onclick = () => { show('none'); game.setSpeed(1); };
$('b-victitle').onclick = () => titleScreen();
addEventListener('beforeunload', () => { if (game.running) game.save(true); });

const q = new URLSearchParams(location.search);
if (q.has('new')) { founder = q.get('hero') || 'Knight'; game.start(new Colony({ seed: +q.get('seed') || 3, hero: founder, difficulty: q.get('difficulty') || 'normal' })); }
else if (q.has('continue') && store.get(SAVE_KEY)) game.start(Colony.load(store.get(SAVE_KEY)));
else titleScreen();
void SANCTUM_POP;
