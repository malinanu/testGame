// Wizard's Chess: menu, turn flow, input, AI worker, HUD.
import { loadAssets } from '../../src/assets.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Chess, WHITE, BLACK, KING, type, color, sqName } from './chess.js';
import { search, LEVELS } from './ai.js';
import { ChessScene } from './scene.js';
import { SFX } from './sfx.js';

const $ = id => document.getElementById(id);
const WEAPONS = ['sword_E', 'shield_C', 'staff_A', 'bow_A_withString', 'arrow_A', 'hammer_B', 'spear_A', 'shield_A', 'sword_A', 'axe_A', 'halberd'];
const FOREST = ['Rock_1_N', 'Rock_1_O', 'Rock_1_P', 'Rock_1_E', 'Rock_1_D', 'Rock_3_E', 'Tree_1_A', 'Tree_2_A', 'Tree_3_A', 'Tree_4_A',
  'Tree_Bare_1_A', 'Tree_Bare_1_B', 'Tree_Bare_2_A', 'Bush_2_C', 'Bush_4_C'];
const GLYPH = { [WHITE]: ['', '♙', '♘', '♗', '♖', '♕', '♔'], [BLACK]: ['', '♟', '♞', '♝', '♜', '♛', '♚'] };
const SIDE = c => (c === WHITE ? 'White' : 'Black');

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + id));
}
function seg(id, onChange) {
  const el = $(id);
  el.querySelectorAll('button').forEach(b => b.onclick = () => { el.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); onChange?.(b.dataset.v); });
  return () => el.querySelector('.on')?.dataset.v;
}

/** Runs the search in a module Web Worker; falls back to the main thread if workers are unavailable. */
class AIClient {
  constructor() {
    this.pending = new Map(); this.id = 0;
    try {
      this.w = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
      this.w.onmessage = e => { const p = this.pending.get(e.data.id); if (p) { this.pending.delete(e.data.id); p(e.data.move); } };
      this.w.onerror = () => { this.w = null; for (const [id, p] of this.pending) { this.pending.delete(id); p(null); } };
    } catch { this.w = null; }
  }
  think(fen, level) {
    if (!this.w) return new Promise(res => setTimeout(() => { const r = search(fen, LEVELS[level]); res(r?.move ? { from: sqName(r.move.from), to: sqName(r.move.to), promo: r.move.promo } : null); }, 30));
    return new Promise(res => { const id = ++this.id; this.pending.set(id, res); this.w.postMessage({ id, fen, level }); });
  }
}

class Game {
  constructor(scene, sfx) {
    this.scene = scene; this.sfx = sfx; this.ai = new AIClient();
    this.chess = new Chess(); this.busy = false; this.selected = null; this.active = false; this.token = 0;
    this.getMode = seg('o-mode', v => { $('o-side-row').style.display = v === 'ai' ? '' : 'none'; $('o-level-row').style.display = v === 'local' ? 'none' : ''; });
    this.getSide = seg('o-side'); this.getLevel = seg('o-level');
    $('b-start').onclick = () => this.start();
    $('b-resume').onclick = () => { show('none'); };
    $('b-menu').onclick = () => { $('b-resume').classList.toggle('hidden', !this.active); show('menu'); };
    $('b-again').onclick = () => { $('b-resume').classList.add('hidden'); show('menu'); };
    $('b-review').onclick = () => show('none');
    $('b-undo').onclick = () => this.undo();
    $('b-flip').onclick = () => this.scene.flip();
    $('t-cine').onchange = e => { this.scene.cinematic = e.target.checked; };
    $('t-sound').checked = !sfx.muted;
    $('t-sound').onchange = e => sfx.setMuted(!e.target.checked);
    $('t-speed').onchange = e => { this.scene.speed = this.scene.vfx.speed = +e.target.value; };
    addEventListener('keydown', e => { if (e.code === 'KeyU') this.undo(); if (e.code === 'KeyF') this.scene.flip(); if (e.code === 'Escape') this.select(null); });
    scene.onSquare = sq => this.click(sq);
    scene.onHover = sq => scene.setHover(this.isHumanTurn() && !this.busy ? sq : null);
  }

  start() {
    const mode = this.getMode(), side = this.getSide();
    const me = side === 'b' ? BLACK : side === 'r' ? (Math.random() < 0.5 ? WHITE : BLACK) : WHITE;
    this.mode = mode; this.level = this.getLevel();
    this.humans = new Set(mode === 'local' ? [WHITE, BLACK] : mode === 'ai' ? [me] : []);
    this.chess = new Chess(); this.selected = null; this.last = null; this.active = true; this.token++;
    this.scene.setPosition(this.chess);
    this.scene.viewFor(mode === 'ai' ? me : WHITE);
    this.scene.setHighlights({});
    $('hud').classList.remove('hidden');
    show('none');
    this.sfx.chime();
    this.banner(mode === 'watch' ? 'Let the game begin' : mode === 'ai' ? `You play ${SIDE(me)}` : 'White begins');
    this.loop();
  }

  isHumanTurn() { return this.active && this.humans?.has(this.chess.turn); }

  captured() {
    const out = { [WHITE]: [], [BLACK]: [] };
    for (const m of this.chess.history) if (m.captured) out[color(m.captured)].push(m.captured);
    return out;
  }

  banner(text, red = false, ms = 1400) {
    const b = $('banner'); b.textContent = text; b.classList.toggle('red', red); b.classList.add('on');
    clearTimeout(this.bt); this.bt = setTimeout(() => b.classList.remove('on'), ms);
  }

  renderHud(thinking = false) {
    const c = this.chess, turn = c.turn;
    $('turn').innerHTML = `<span class="dot" style="background:${turn === WHITE ? '#f4ecd8' : '#2a2238'}"></span>${thinking ? `${SIDE(turn)} is thinking…` : this.isHumanTurn() ? `${SIDE(turn)} to move${this.mode === 'ai' ? ' (you)' : ''}` : `${SIDE(turn)} to move`}`;
    const cap = this.captured();
    $('capw').textContent = cap[BLACK].map(p => GLYPH[BLACK][type(p)]).join('');
    $('capb').textContent = cap[WHITE].map(p => GLYPH[WHITE][type(p)]).join('');
    const h = c.history, rows = [];
    for (let i = 0; i < h.length; i += 2) rows.push(`<li><span class="${i === h.length - 1 ? 'cur' : ''}">${h[i].san}</span><span class="${i + 1 === h.length - 1 ? 'cur' : ''}">${h[i + 1]?.san ?? ''}</span></li>`);
    $('moves').innerHTML = rows.join('');
    $('moves').scrollTop = 1e6;
    $('b-undo').disabled = this.busy || !h.length || this.mode === 'watch';
  }

  checkSquare() { return this.chess.inCheck() ? this.chess.kings[this.chess.turn >> 3] : null; }

  async loop() {
    const token = this.token;
    while (this.active && token === this.token) {
      const st = this.chess.status();
      this.scene.setHighlights({ last: this.last, check: st.check ? this.checkSquare() : null });
      this.renderHud();
      if (st.over) return this.finish(st);
      if (st.check) { this.banner('Check!', true); this.sfx.chime(); }
      if (this.isHumanTurn()) { this.busy = false; this.renderHud(); return; } // wait for clicks
      this.busy = true; this.renderHud(true);
      const t0 = performance.now();
      const mv = await this.ai.think(this.chess.fen(), this.mode === 'watch' ? (this.chess.turn === WHITE ? 'medium' : this.level) : this.level);
      if (token !== this.token) return;
      await new Promise(r => setTimeout(r, Math.max(0, 450 - (performance.now() - t0))));
      if (!mv) return;
      await this.perform(mv);
    }
  }

  async perform(mv) {
    const rec = this.chess.play(mv);
    if (!rec) return false;
    this.busy = true; this.select(null);
    this.scene.setHighlights({ last: [rec.from, rec.to] });
    this.renderHud();
    const token = this.token;
    await this.scene.animateMove(rec);
    if (token !== this.token) return true;
    this.last = [rec.from, rec.to];
    return true;
  }

  select(sq) {
    this.selected = sq;
    const moves = sq == null ? [] : this.chess.moves(sq);
    this.selMoves = moves;
    const uniq = new Map(); for (const m of moves) uniq.set(m.to, { sq: m.to, capture: !!m.captured });
    this.scene.setHighlights({ selected: sq, moves: [...uniq.values()], last: this.last, check: this.chess.inCheck() ? this.checkSquare() : null });
  }

  async click(sq) {
    if (sq == null || this.busy || !this.isHumanTurn()) return;
    const p = this.chess.get(sq);
    if (p && color(p) === this.chess.turn) { this.sfx.step(); return this.select(sq === this.selected ? null : sq); }
    if (this.selected == null) return;
    const cands = this.selMoves.filter(m => m.to === sq);
    if (!cands.length) return this.select(null);
    let promo = 0;
    if (cands[0].promo) promo = await this.askPromotion();
    await this.perform({ from: this.selected, to: sq, promo });
    this.loop();
  }

  askPromotion() {
    show('promo');
    return new Promise(res => $('promo').querySelectorAll('button').forEach(b => b.onclick = () => { show('none'); res(b.dataset.v); }));
  }

  undo() {
    if (this.busy || !this.chess.history.length || this.mode === 'watch') return;
    let n = 1;
    if (this.mode === 'ai') n = this.isHumanTurn() ? 2 : 1;
    if (this.chess.status().over) this.active = true;
    for (let i = 0; i < n && this.chess.history.length; i++) this.chess.undo();
    if (this.mode === 'ai' && !this.isHumanTurn() && this.chess.history.length) this.chess.undo();
    this.token++;
    const h = this.chess.history; this.last = h.length ? [h[h.length - 1].from, h[h.length - 1].to] : null;
    this.scene.setPosition(this.chess, this.captured());
    this.select(null);
    this.sfx.whoosh();
    this.loop();
  }

  async finish(st) {
    this.active = false; this.busy = true; this.renderHud();
    const reason = { checkmate: 'by checkmate', stalemate: 'Stalemate', 'fifty-move rule': 'Fifty-move rule', 'threefold repetition': 'Threefold repetition', 'insufficient material': 'Insufficient material' }[st.reason];
    const title = st.result === '1/2-1/2' ? 'Draw' : `${st.result === '1-0' ? 'White' : 'Black'} wins!`;
    this.banner(st.reason === 'checkmate' ? 'Checkmate!' : 'Draw', st.reason === 'checkmate', 2200);
    const token = this.token;
    await this.scene.gameOver(st.result, this.chess);
    if (token !== this.token) return;
    this.busy = false; this.renderHud();
    $('endtitle').textContent = title;
    $('endtext').textContent = `${st.reason === 'checkmate' ? 'Checkmate' : reason} after ${Math.ceil(this.chess.history.length / 2)} moves.${this.mode === 'ai' && st.result !== '1/2-1/2' ? (this.humans.has(st.result === '1-0' ? WHITE : BLACK) ? ' The castle bows to you.' : ' The castle prevails, this time.') : ''}`;
    show('end');
  }
}

// ---------------------------------------------------------------- boot
const assets = await loadAssets({ base: '../', props: ['mug_full'], forest: FOREST, onProgress: (d, n) => { $('loadtxt').textContent = `Waking the pieces… ${Math.round(d / n * 90)}%`; } });
const loader = new GLTFLoader();
await Promise.all(WEAPONS.map(n => loader.loadAsync(`../assets/weapons/${n}.gltf`).then(g => { assets.props['wb:' + n] = g.scene; })));
const sfx = new SFX();
const scene = new ChessScene($('c'), assets, sfx);
scene.setPosition(new Chess());
Object.assign(scene.cam, { yaw: 0.6, yawGoal: 0.6 });
const game = new Game(scene, sfx);
window.wiz = { game, scene }; // for debugging / automated tests
show('menu');
