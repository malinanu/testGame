// Battle input + HUD: selection, move/ability targeting, previews, end turn. Shared by Tactics and Arena.
// Also the "teaching layer": a hint bar that always says what to do next, move/action pips, path and
// hit-chance previews, a danger overlay, and events (on/emit) that the tutorial coach listens to.
import { CLASSES, ABIL, TILE, T } from './data.js';
import { pathTo, dist, lineOfSight, N8 } from './grid.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const TILE_ICON = {
  [T.GROUND]: '▫️', [T.GRASS]: '🌱', [T.OVERGROWN]: '🌾', [T.BUSH]: '🌿', [T.BOULDER]: '🪨',
  [T.PILLAR]: '🗿', [T.TREE]: '🌳', [T.BARE]: '🪵', [T.CORRUPT]: '☠️',
};
export const ABIL_ICON = {
  strike: '🗡️', bash: '🛡️', chop: '🪓', cleave: '🌀', shoot: '🏹', aimed: '🎯', stab: '🔪', crossbow: '🏹',
  bolt: '✨', fireball: '🔥', entangle: '🌿', heal: '🧪', axe: '🪓', stance: '🔄', flask: '🧪',
};
const COLORS = { move: 0x3a8dff, attack: 0xff4d4d, heal: 0x6dff8a, area: 0xffa040, sel: 0xffd54a, danger: 0x7a1a2a };

/** Short "what it does" line for an ability, used on buttons. */
export function abilityBlurb(a, u) {
  if (a.kind === 'stance') return 'Free: swap axe ⇄ shield';
  if (a.kind === 'heal') return `Heal +${a.amount + (u?.mods?.heal || 0)} · range ${a.range}`;
  if (a.kind === 'cleave') return `${a.dmg} dmg to all around`;
  if (a.kind === 'aoe') return a.overgrow ? `3×3 vines · range ${a.range}` : `${a.dmg} dmg 3×3 · range ${a.range}`;
  const r = a.range + (a.ranged ? (u?.mods?.range || 0) : 0);
  return `${a.dmg}${a.distScale ? '+' : ''} dmg · ${r === 1 ? 'melee' : `range ${r}`}`;
}

export class BattleController {
  /**
   * opts: { enemyName, onFinish() } — onFinish runs once the battle is over.
   * Versus play (battle.pvp): localSides lists the sides commanded on this screen (both for hot-seat,
   * one for online), names = { player, enemy } labels them, onCommand(cmd) receives every command made
   * here (to send to the opponent), onTurn(side) fires when a local side's turn begins.
   */
  constructor(view, battle, { enemyName = '', onFinish = () => {}, localSides = ['player'], names = null, onCommand = null, onTurn = null } = {}) {
    this.b = battle; this.v = view; this.enemyName = enemyName; this.onFinish = onFinish;
    this.localSides = localSides; this.names = names || { player: 'You', enemy: enemyName || 'Enemy' };
    this.onCommand = onCommand; this.onTurn = onTurn; this.remoteQ = Promise.resolve();
    this.sel = null; this.mode = null; this.busy = false; this.hoverT = null; this.danger = false;
    this.listeners = {}; this.guard = null; this.hintOverride = null; this.autoHint = null;
    const cb = $('autoend');
    if (cb) { cb.checked = this.autoEndOn(); cb.onchange = () => { try { localStorage.setItem('wwt-autoend', cb.checked ? '1' : '0'); } catch {} if (cb.checked) this.maybeAutoEnd(); else this.cancelAutoEnd(); }; }
    this.v.onClick = t => this.click(t);
    this.v.onHover = (t, e) => this.hover(t, e);
    this.v.onCancel = () => this.cancel();
    this.onKey = e => this.key(e);
    addEventListener('keydown', this.onKey);
    $('endturn').onclick = () => this.endTurn();
    if ($('dangerbtn')) $('dangerbtn').onclick = () => this.toggleDanger();
    this.selectNext();
    this.v.banner(`Round 1`);
  }

  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); return this; }
  emit(evt, data) { for (const fn of this.listeners[evt] || []) fn(data); }
  /** The tutorial can veto actions: guard(kind, data) → false blocks it. */
  allowed(kind, data) { if (!this.guard) return true; const ok = this.guard(kind, data); if (!ok) this.emit('blocked', { kind, data }); return ok; }

  dispose() {
    this.b.aborted = true; this.disposed = true; // stops an AI turn / animation still running behind the next screen
    clearTimeout(this.autoT); this.autoT = null; this.autoHint = null;
    removeEventListener('keydown', this.onKey);
    this.v.onClick = this.v.onHover = this.v.onCancel = null;
    $('tip').style.display = 'none';
    if ($('hint')) $('hint').textContent = '';
    this.v.setHighlights([]); this.v.setHover(null); this.v.showPath?.(null); this.v.showBadge?.(null);
    for (const u of this.b.units) this.v.setReady?.(u, false);
  }

  /** The side this screen is commanding right now (the side whose roster is shown). */
  get side() { return this.localSides.includes(this.b.phase) ? this.b.phase : this.localSides[0]; }
  myTurn() { return !this.b.over && this.localSides.includes(this.b.phase); }
  sideName(side) { return this.names[side] || side; }
  players() { return this.b.units.filter(u => u.side === this.side && u.alive); }
  ready(u) { return !!u && u.alive && u.side === this.side && (!u.moved || !u.acted); }

  selectNext(from = this.sel) {
    const list = this.players(), start = Math.max(0, list.indexOf(from));
    for (let k = 1; k <= list.length; k++) { const u = list[(start + k) % list.length]; if (this.ready(u)) return this.select(u, true); }
    this.select(list.find(u => this.ready(u)) || null, true);
  }

  // ---------------------------------------------------------------- automatic end of turn
  autoEndOn() { try { return localStorage.getItem('wwt-autoend') !== '0'; } catch { return true; } }
  /** Every living hero has used its action (or none can do anything at all). */
  allSpent() { const mine = this.players(); return mine.length > 0 && (mine.every(u => u.acted) || !mine.some(u => this.ready(u))); }
  /** After the last hero acts: show "ending turn…", then end it unless the player picks a hero meanwhile. */
  maybeAutoEnd() {
    this.cancelAutoEnd();
    if (this.disposed || !this.autoEndOn() || this.busy || !this.myTurn() || this.b.over || !this.allSpent()) return;
    if (this.guard && !this.guard('endTurn')) return; // the tutorial decides when turns end (no "blocked" nag)
    const stamp = `${this.b.round}|${this.b.phase}|${this.b.actions.length}`;
    this.autoHint = '✅ All heroes have acted: ending the turn… <span class="autoend-note">(pick a hero to keep moving)</span>';
    this.renderHint(); $('endturn')?.classList.add('pulse');
    this.autoT = setTimeout(() => {
      this.autoT = null; this.autoHint = null;
      if (this.disposed) return;
      if (stamp === `${this.b.round}|${this.b.phase}|${this.b.actions.length}` && !this.busy && this.myTurn() && this.allSpent()) this.endTurn();
      else this.renderHint();
    }, 900 / Math.max(1, this.v.speed || 1));
  }
  cancelAutoEnd() {
    if (this.autoT) clearTimeout(this.autoT);
    if (this.autoT || this.autoHint) { this.autoT = null; this.autoHint = null; this.renderHint(); }
  }

  select(u, auto = false) {
    if (!auto) this.cancelAutoEnd();
    if (!auto && u && !this.allowed('select', u)) return;
    this.sel = u; this.mode = null; this.refresh();
    if (u && !auto) this.emit('select', u);
  }
  cancel() { if (this.mode) { this.mode = null; this.refresh(); this.emit('mode', null); } }

  setMode(id) {
    this.cancelAutoEnd();
    const u = this.sel;
    if (!u || this.busy || !this.myTurn() || !this.b.canUse(u, id)) return;
    if (!this.allowed('mode', id)) return;
    const a = ABIL[id];
    if (a.free || a.kind === 'cleave') { this.act(() => this.b.use(u, id, u.x, u.y), { kind: 'ability', id }); return; }
    this.mode = this.mode === id ? null : id;
    this.refresh();
    this.emit('mode', this.mode);
  }

  toggleDanger() { this.danger = !this.danger; $('dangerbtn')?.classList.toggle('on', this.danger); this.refresh(); }

  /** Tiles any living enemy could hit next turn (move + reach of its attacks). */
  dangerTiles() {
    const b = this.b, g = b.g, out = new Set();
    for (const e of b.units) {
      if (!e.alive || e.side === this.side) continue;
      const atks = b.abilities(e).filter(id => ['attack', 'cleave', 'aoe'].includes(ABIL[id].kind) && ABIL[id].dmg);
      const spots = e.stun > 0 || e.behavior === 'hold' ? [[e.x, e.y]] : [...b.reach(e)].filter(([, s]) => s.stop).map(([k]) => g.xy(k));
      for (const [sx, sy] of spots) for (const id of atks) {
        const a = ABIL[id], r = a.kind === 'cleave' ? 1 : (a.range || 1) + (a.kind === 'aoe' ? 1 : 0);
        for (let y = Math.max(0, sy - r); y <= Math.min(g.h - 1, sy + r); y++) for (let x = Math.max(0, sx - r); x <= Math.min(g.w - 1, sx + r); x++) {
          if (g.blocked(x, y) || out.has(g.i(x, y))) continue;
          if ((a.ranged || a.kind === 'aoe') && dist(sx, sy, x, y) > 1 && !lineOfSight(g, sx, sy, x, y)) continue;
          out.add(g.i(x, y));
        }
      }
    }
    return out;
  }

  refresh() {
    const b = this.b, u = this.sel, hl = [];
    if (this.danger && this.myTurn()) for (const k of this.dangerTiles()) hl.push([k % b.g.w, (k / b.g.w) | 0, COLORS.danger]);
    if (u && !this.busy && this.myTurn()) {
      if (this.mode) {
        const a = ABIL[this.mode];
        const col = a.kind === 'heal' ? COLORS.heal : a.kind === 'aoe' ? COLORS.area : COLORS.attack;
        for (const t of b.targets(u, this.mode)) hl.push([t.x, t.y, col]);
        if (a.kind === 'aoe' && this.hoverT && hl.some(([x, y]) => x === this.hoverT[0] && y === this.hoverT[1]))
          for (const [x, y] of b.area(u, this.mode, ...this.hoverT)) hl.push([x, y, a.ignite ? 0xff2a00 : 0x2aff40]);
      } else {
        if (!u.moved) for (const [k, e] of b.reach(u)) if (e.stop && e.c > 0) hl.push([k % b.g.w, (k / b.g.w) | 0, COLORS.move]);
        const basic = b.abilities(u)[0];
        if (b.canUse(u, basic)) for (const t of b.targets(u, basic)) if (t.unit) hl.push([t.x, t.y, COLORS.attack]);
      }
      hl.push([u.x, u.y, COLORS.sel]);
    }
    for (const extra of this.extraHighlights || []) hl.push(extra);
    this.v.setHighlights(hl);
    this.v.setSelected(u);
    for (const o of b.units) this.v.setReady?.(o, this.myTurn() && !this.busy && this.ready(o));
    if (!this.mode) this.v.showBadge?.(null);
    this.renderHud();
  }

  /** One sentence telling the player what to do right now. */
  hintText() {
    if (this.autoHint) return this.autoHint;
    if (this.hintOverride) return this.hintOverride;
    const b = this.b, u = this.sel;
    if (b.over) {
      if (!b.pvp) return b.result === 'win' ? 'Victory!' : 'Defeat…';
      return `🏆 ${esc(this.sideName(b.result === 'win' ? 'player' : 'enemy'))} wins!`;
    }
    if (!this.myTurn()) return b.pvp ? `⏳ Waiting for ${esc(this.sideName(b.phase))} to move…` : this.enemyLine || 'Enemy turn: watch what they do…';
    if (this.busy) return '…';
    const ready = this.players().filter(o => this.ready(o));
    if (!ready.length) return `✅ Everyone has acted. Press End Turn (Enter) to let ${b.pvp ? esc(this.sideName(this.foeSide())) : 'the enemy'} move.`;
    if (!u || !this.ready(u)) return `👆 Click one of your heroes (blue rings). ${ready.length} can still act.`;
    const c = CLASSES[u.cls];
    if (this.mode) {
      const a = ABIL[this.mode], n = b.targets(u, this.mode).length;
      const what = a.kind === 'heal' ? 'a green ally' : a.kind === 'aoe' ? 'an orange tile (the 3×3 area is shown on hover)' : 'a red target';
      return n ? `${ABIL_ICON[this.mode] || ''} ${a.name}: click ${what}. Esc cancels.` : `${a.name}: nothing in range. Move closer or pick another ability (Esc).`;
    }
    if (!u.moved && !u.acted) return `${c.name}: click a 🟦 blue tile to move, a 🟥 red enemy to attack, or pick an ability below.`;
    if (!u.acted) return `${c.name} moved. Now attack (🟥 red) or pick an ability, or press Tab for the next hero.`;
    return `${c.name} acted and can still move (🟦 blue), or press Tab for the next hero.`;
  }

  foeSide(side = this.side) { return side === 'player' ? 'enemy' : 'player'; }

  renderHint() { const h = $('hint'); if (h) h.innerHTML = this.hintText(); }

  disabledReason(u, id) {
    const a = ABIL[id], b = this.b;
    if (this.busy || !this.myTurn()) return 'Wait for your turn';
    if (a.free) return u.stanced ? 'Already swapped this turn' : '';
    if (u.acted) return 'Already used this hero\'s action this turn';
    if (u.cd[id] > 0) return `Recharging: ready in ${u.cd[id]} turn${u.cd[id] > 1 ? 's' : ''}`;
    if (a.consumable && !(b.stock(u.side)[a.consumable] > 0)) return 'None left';
    return '';
  }

  renderHud() {
    const b = this.b, u = this.sel;
    $('round').textContent = `Round ${b.round}${b.maxRounds ? ` / ${b.maxRounds}` : ''}`;
    const mine = this.b.units.filter(o => o.side === this.side);
    $('roster').innerHTML = mine.map((o, i) =>
      `<div class="hero ${o.alive ? '' : 'dead'} ${o === u ? 'sel' : ''} ${this.ready(o) ? 'can' : 'done'}" data-i="${i}"><b>${o.name}</b>${this.ready(o) && this.myTurn() ? '<span class="rdy">ready</span>' : ''}
        <div class="hpbar"><i style="width:${o.hp / o.maxHp * 100}%"></i></div>${o.hp}/${o.maxHp}
        ${o.alive ? `<span class="pips"><i class="${o.moved ? 'spent' : ''}" title="Move">👣</i><i class="${o.acted ? 'spent' : ''}" title="Action">⚔️</i></span>` : '· fallen'}</div>`).join('');
    $('roster').querySelectorAll('.hero').forEach(el => {
      const o = mine[+el.dataset.i];
      el.onclick = () => { if (o.alive && !this.busy) this.select(o); };
    });
    const ui = $('uinfo'), ab = $('abils');
    const anyReady = this.players().some(o => this.ready(o));
    $('endturn').disabled = this.busy || !this.myTurn();
    $('endturn').classList.toggle('pulse', !anyReady && this.myTurn() && !this.busy);
    this.renderHint();
    if (!u || !u.alive) { ui.innerHTML = ''; ab.innerHTML = ''; return; }
    const c = CLASSES[u.cls];
    ui.innerHTML = `<b>${c.name}</b> <span class="sub">${c.role}</span>
      <div class="hpbar big"><i style="width:${u.hp / u.maxHp * 100}%"></i></div>${u.hp}/${u.maxHp} HP${u.armor ? ` · 🛡 ${u.armor}` : ''}
      <div class="pips big"><span class="${u.moved ? 'spent' : ''}">👣 Move ${u.moved ? 'used' : u.move}</span><span class="${u.acted ? 'spent' : ''}">⚔️ Action ${u.acted ? 'used' : 'ready'}</span></div>
      ${u.cls === 'fighter' ? `<small>Stance: <b>${u.stance}</b></small>` : ''}${u.hidden ? '<small style="color:#9bffb0">🌿 Hidden: next attack crits</small>' : ''}${u.stunned ? '<small style="color:#ffe04a">💫 Stunned this turn</small>' : ''}`;
    ab.innerHTML = '';
    b.abilities(u).forEach((id, i) => {
      const a = ABIL[id], btn = document.createElement('button'), why = this.disabledReason(u, id);
      const cd = u.cd[id] > 0 ? `⏳ ${u.cd[id]}` : a.cd ? `↻ ${a.cd}` : '';
      btn.className = 'btn abil' + (this.mode === id ? ' on' : '');
      btn.dataset.id = id;
      btn.innerHTML = `<span class="ic">${ABIL_ICON[id] || '•'}</span>${a.name}<small>${abilityBlurb(a, u)} ${cd}</small><kbd>${i + 1}</kbd>`;
      btn.disabled = !!why || !b.canUse(u, id);
      btn.onclick = () => this.setMode(id);
      btn.onmouseenter = e => this.tip(`<b>${ABIL_ICON[id] || ''} ${a.name}</b><br>${a.desc}${a.cd ? `<br><span class="note">Recharge: ${a.cd} turns after use</span>` : ''}${why ? `<br><span style="color:#ff9a8a">${why}</span>` : ''}`, e);
      btn.onmouseleave = () => this.tip(null);
      ab.appendChild(btn);
    });
  }

  tip(html, e) {
    const t = $('tip');
    if (!html) { t.style.display = 'none'; return; }
    t.innerHTML = html; t.style.display = 'block';
    const x = Math.min(innerWidth - t.offsetWidth - 8, e.clientX + 16), y = Math.max(8, e.clientY - t.offsetHeight - 12);
    t.style.left = x + 'px'; t.style.top = y + 'px';
  }

  hover(t, e) {
    const prev = this.hoverT;
    this.hoverT = t;
    if (!t) { this.v.setHover(null); this.tip(null); this.v.showPath?.(null); this.v.showBadge?.(null); return; }
    const b = this.b, [x, y] = t, o = b.unitAt(x, y), u = this.sel;
    const tile = TILE[b.g.get(x, y)];
    let html = `<b>${TILE_ICON[b.g.get(x, y)] || ''} ${tile.name}</b>${tile.desc ? `<br><span class="note">${tile.desc}</span>` : ''}`;
    if (b.g.fire[b.g.i(x, y)]) html += `<br><span style="color:#ff8a3a">🔥 On fire (${b.g.fire[b.g.i(x, y)]} rounds): 3 damage</span>`;
    const foeLabel = b.pvp ? this.sideName(this.foeSide()) : this.enemyName;
    if (o) html = `<b>${o.side !== this.side ? '🟥 ' + esc(foeLabel) + ' ' : '🟦 '}${o.name}</b> ${o.hp}/${o.maxHp} HP${o.armor ? ` · Armor ${b.armorOf(o)}` : ''}${o.hidden ? ' · Hidden' : ''}${o.behavior && o.side === 'enemy' ? ` · ${o.behavior}` : ''}<br>` + html;
    let color = 0xffffff, path = null, badge = null;
    if (u && this.mode && !this.busy) {
      const tg = b.targets(u, this.mode).find(q => q.x === x && q.y === y);
      if (tg) {
        const a = ABIL[this.mode];
        color = 0xffd54a;
        if (a.kind === 'attack') {
          const p = b.preview(u, this.mode, tg);
          const kill = tg.unit && p.dmg >= tg.unit.hp;
          html = `<b>${a.name}</b> → ${tg.unit ? tg.unit.name : 'tree'}<br><span class="hit">${p.hit}% to hit</span> · ${p.dmg} damage${kill ? ' · 💀 would defeat it' : ''}${p.notes.length ? `<br><span class="note">${p.notes.join(' · ')}</span>` : ''}<hr style="border-color:#fff2">` + html;
          badge = { x, y, text: `${p.hit}% · ${p.dmg}${kill ? ' 💀' : ''}`, kind: kill ? 'kill' : 'hit' };
          this.emit('preview', { id: this.mode, target: tg, preview: p });
        } else if (a.kind === 'heal') { const p = b.preview(u, this.mode, tg); html = `<b>${a.name}</b>: +${p.heal} HP<br>` + html; badge = { x, y, text: `+${p.heal} HP`, kind: 'heal' }; }
        else html = `<b>${a.name}</b> here<br>` + html;
      }
      if (ABIL[this.mode].kind === 'aoe' && (prev?.[0] !== x || prev?.[1] !== y)) this.refresh();
    } else if (u && !u.moved && !o && !this.busy && this.myTurn()) {
      const reach = b.reach(u), e2 = reach.get(b.g.i(x, y));
      if (e2?.stop && e2.c > 0) {
        html = `👣 Move here: ${e2.c} of ${u.move} steps${b.g.get(x, y) === T.BUSH && u.cls === 'rogue' ? '<br>🌿 The Rogue will be Hidden here' : ''}${b.g.fire[b.g.i(x, y)] ? '<br>⚠️ Fire burns!' : ''}<br>` + html;
        color = 0x8fc8ff; path = pathTo(b.g, reach, b.g.i(x, y));
      }
    } else if (u && o && o.side !== this.side && !this.busy) {
      const basic = b.abilities(u)[0], tg = b.canUse(u, basic) && b.targets(u, basic).find(q => q.unit === o);
      if (tg) { const p = b.preview(u, basic, tg); badge = { x, y, text: `${p.hit}% · ${p.dmg}${p.dmg >= o.hp ? ' 💀' : ''}`, kind: p.dmg >= o.hp ? 'kill' : 'hit' }; html = `Click to ${ABIL[basic].name}: ${p.hit}% · ${p.dmg} dmg<br>` + html; }
      else html += `<br><span class="note">Out of reach: move closer first.</span>`;
    }
    this.v.setHover(x, y, color);
    this.v.showPath?.(path);
    this.v.showBadge?.(badge);
    this.tip(html, e);
  }

  click(t) {
    if (this.busy || !this.myTurn() || !t) return;
    const b = this.b, [x, y] = t, o = b.unitAt(x, y), u = this.sel;
    if (this.mode) {
      if (b.targets(u, this.mode).some(q => q.x === x && q.y === y)) {
        const id = this.mode, a = ABIL[id];
        if (!this.allowed(a.kind === 'attack' ? 'attack' : 'ability', { id, x, y })) return;
        return this.act(() => b.use(u, id, x, y), { kind: a.kind === 'attack' ? 'attack' : 'ability', id });
      }
      if (o?.side === this.side) return this.select(o);
      return this.cancel();
    }
    if (o?.side === this.side) return this.select(o);
    if (!u) { if (o) this.flashHint('First click one of your own heroes (blue rings).'); return; }
    const basic = b.abilities(u)[0];
    if (o && b.canUse(u, basic) && b.targets(u, basic).some(q => q.unit === o)) {
      if (!this.allowed('attack', { id: basic, x, y })) return;
      return this.act(() => b.use(u, basic, x, y), { kind: 'attack', id: basic });
    }
    if (o && o.side !== this.side) { this.flashHint(u.acted ? `${u.name} has already acted this turn.` : `${o.name} is out of reach. Move closer first (blue tiles).`); return; }
    if (!u.moved) {
      const e = b.reach(u).get(b.g.i(x, y));
      if (e?.stop && e.c > 0) { if (!this.allowed('move', { x, y })) return; return this.act(() => b.move(u, x, y), { kind: 'move', x, y }); }
      if (!b.g.blocked(x, y)) this.flashHint(`Too far: ${u.name} can walk ${u.move} steps (the blue tiles).`);
    }
  }

  flashHint(text) {
    const h = $('hint'); if (!h) return;
    h.innerHTML = `⚠️ ${text}`; h.classList.add('warn');
    clearTimeout(this.flashT); this.flashT = setTimeout(() => { h.classList.remove('warn'); this.renderHint(); }, 2200);
  }

  async act(fn, info = {}) {
    this.busy = true; this.mode = null; this.refresh(); this.tip(null); this.v.showPath?.(null); this.v.showBadge?.(null);
    const u = this.sel, n = this.b.actions.length;
    await fn();
    if (this.disposed) return; // left the battle mid-animation: this HUD belongs to the next one now
    this.sendNew(n);
    this.busy = false;
    this.emit(info.kind || 'act', { ...info, unit: u });
    if (u?.hidden) this.emit('hidden', u);
    if (this.b.over) { this.emit('over', this.b.result); return this.onFinish(); }
    if (!this.ready(this.sel)) this.selectNext(); else this.refresh();
    this.maybeAutoEnd();
  }

  /** Pass commands made on this screen to the opponent (online play). */
  sendNew(from) { if (this.onCommand) for (let i = from; i < this.b.actions.length; i++) this.onCommand(this.b.actions[i], i); }

  /** Apply a command received from the remote opponent (queued, so they animate in order). */
  applyRemote(cmd) {
    // a throw must not poison the queue (every later command would be dropped): it counts as rejected
    return this.remoteQ = this.remoteQ.then(async () => {
      if (this.b.over || this.myTurn()) return false;
      this.busy = true; this.sel = null; this.mode = null; this.refresh();
      let ok = false;
      try {
        const u = Number.isInteger(cmd?.u) ? this.b.units[cmd.u] : null;
        if (u && cmd.t !== 'e') await this.v.focusUnit?.(u);
        ok = await this.b.applyCmd(cmd);
      } catch (e) { console.warn('remote command failed', e); ok = false; }
      if (this.disposed) return ok;
      this.busy = false;
      if (this.b.over) { this.emit('over', this.b.result); this.refresh(); this.onFinish(); return ok; }
      if (cmd.t === 'e' && ok) await this.beginLocalTurn(); else this.refresh();
      return ok;
    });
  }

  async beginLocalTurn() {
    await this.v.restoreCamera?.();
    if (this.disposed) return;
    if (this.myTurn()) {
      // hot-seat: keys and clicks behind the pass-the-device curtain must not act for the next player
      this.busy = true;
      try { await this.onTurn?.(this.b.phase); } finally { this.busy = false; }
      if (this.disposed) return;
      this.v.banner(this.b.pvp ? `${this.sideName(this.b.phase)}: your turn` : `Round ${this.b.round}`);
      this.emit('playerTurn', this.b.round);
    }
    this.sel = null; this.selectNext();
  }

  async endTurn() {
    this.cancelAutoEnd();
    if (this.busy || !this.myTurn()) return;
    if (!this.allowed('endTurn')) return;
    this.busy = true; this.mode = null; this.refresh();
    this.emit('endTurn');
    if (this.b.pvp) {
      const n = this.b.actions.length;
      await this.b.endTurn();
      if (this.disposed) return;
      this.sendNew(n);
      this.busy = false;
      if (this.b.over) { this.emit('over', this.b.result); this.refresh(); return this.onFinish(); }
      if (this.myTurn()) return this.beginLocalTurn();
      this.v.banner(`${this.sideName(this.b.phase)}'s turn`);
      this.sel = null; this.refresh();
      return;
    }
    const logLen = this.b.log.length;
    const poll = setInterval(() => { const l = this.b.log[this.b.log.length - 1]; if (this.b.log.length > logLen && l) { this.enemyLine = `🟥 Enemy turn: ${esc(l)}`; this.renderHint(); } }, 150);
    this.renderHint();
    await this.b.endPlayerTurn();
    clearInterval(poll); this.enemyLine = null;
    if (this.disposed) return;
    this.busy = false;
    if (this.b.over) { this.emit('over', this.b.result); return this.onFinish(); }
    this.emit('playerTurn', this.b.round);
    this.sel = null; this.selectNext();
  }

  key(e) {
    if (this.busy || e.target?.tagName === 'INPUT') return;
    if (e.key >= '1' && e.key <= '5' && this.sel) { const id = this.b.abilities(this.sel)[+e.key - 1]; if (id) this.setMode(id); }
    else if (e.code === 'Escape') { this.cancelAutoEnd(); this.cancel(); }
    else if (e.code === 'Tab') { e.preventDefault(); this.selectNext(); }
    else if (e.code === 'Enter') this.endTurn();
    else if (e.code === 'KeyT') this.toggleDanger();
  }
}
