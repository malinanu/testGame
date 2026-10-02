// Battle input + HUD: selection, move/ability targeting, previews, end turn. Shared by Tactics and Arena.
import { CLASSES, ABIL, TILE } from './data.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class BattleController {
  /** opts: { enemyName, onFinish() } — onFinish runs once the battle is over. */
  constructor(view, battle, { enemyName = '', onFinish = () => {} } = {}) {
    this.b = battle; this.v = view; this.enemyName = enemyName; this.onFinish = onFinish;
    this.sel = null; this.mode = null; this.busy = false; this.hoverT = null;
    this.v.onClick = t => this.click(t);
    this.v.onHover = (t, e) => this.hover(t, e);
    this.v.onCancel = () => this.cancel();
    this.onKey = e => this.key(e);
    addEventListener('keydown', this.onKey);
    $('endturn').onclick = () => this.endTurn();
    this.selectNext();
    this.v.banner(`Round 1`);
  }

  dispose() {
    removeEventListener('keydown', this.onKey);
    this.v.onClick = this.v.onHover = this.v.onCancel = null;
    $('tip').style.display = 'none';
    this.v.setHighlights([]); this.v.setHover(null);
  }

  players() { return this.b.units.filter(u => u.side === 'player' && u.alive); }
  ready(u) { return u.alive && u.side === 'player' && (!u.moved || !u.acted); }

  selectNext(from = this.sel) {
    const list = this.players(), start = Math.max(0, list.indexOf(from));
    for (let k = 1; k <= list.length; k++) { const u = list[(start + k) % list.length]; if (this.ready(u)) return this.select(u); }
    this.select(list.find(u => this.ready(u)) || null);
  }

  select(u) { this.sel = u; this.mode = null; this.refresh(); }
  cancel() { if (this.mode) { this.mode = null; this.refresh(); } }

  setMode(id) {
    const u = this.sel;
    if (!u || this.busy || this.b.phase !== 'player' || !this.b.canUse(u, id)) return;
    const a = ABIL[id];
    if (a.free || a.kind === 'cleave') { this.act(() => this.b.use(u, id, u.x, u.y)); return; }
    this.mode = this.mode === id ? null : id;
    this.refresh();
  }

  refresh() {
    const b = this.b, u = this.sel, hl = [];
    if (u && !this.busy && b.phase === 'player') {
      if (this.mode) {
        const a = ABIL[this.mode];
        const col = a.kind === 'heal' ? 0x6dff8a : a.kind === 'aoe' ? 0xffa040 : 0xff4d4d;
        for (const t of b.targets(u, this.mode)) hl.push([t.x, t.y, col]);
        if (a.kind === 'aoe' && this.hoverT && hl.some(([x, y]) => x === this.hoverT[0] && y === this.hoverT[1]))
          for (const [x, y] of b.area(u, this.mode, ...this.hoverT)) hl.push([x, y, a.ignite ? 0xff2a00 : 0x2aff40]);
      } else {
        if (!u.moved) for (const [k, e] of b.reach(u)) if (e.stop && e.c > 0) hl.push([k % b.g.w, (k / b.g.w) | 0, 0x3a8dff]);
        const basic = b.abilities(u)[0];
        if (b.canUse(u, basic)) for (const t of b.targets(u, basic)) if (t.unit) hl.push([t.x, t.y, 0xff4d4d]);
      }
      hl.push([u.x, u.y, 0xffd54a]);
    }
    this.v.setHighlights(hl);
    this.v.setSelected(u);
    this.renderHud();
  }

  renderHud() {
    const b = this.b, u = this.sel;
    $('round').textContent = `Round ${b.round}`;
    $('roster').innerHTML = this.b.units.filter(o => o.side === 'player').map((o, i) =>
      `<div class="hero ${o.alive ? '' : 'dead'} ${o === u ? 'sel' : ''} ${this.ready(o) ? '' : 'done'}" data-i="${i}"><b>${o.name}</b>
        <div class="hpbar"><i style="width:${o.hp / o.maxHp * 100}%"></i></div>${o.hp}/${o.maxHp}
        ${o.alive ? `· ${o.moved ? '<s>Move</s>' : 'Move'} · ${o.acted ? '<s>Act</s>' : 'Act'}` : '· fallen'}</div>`).join('');
    $('roster').querySelectorAll('.hero').forEach(el => {
      const o = this.b.units.filter(x => x.side === 'player')[+el.dataset.i];
      el.onclick = () => { if (o.alive && !this.busy) this.select(o); };
    });
    const ui = $('uinfo'), ab = $('abils');
    const anyReady = this.players().some(o => this.ready(o));
    $('endturn').disabled = this.busy || b.phase !== 'player';
    $('endturn').classList.toggle('pulse', !anyReady && b.phase === 'player' && !this.busy);
    if (!u || !u.alive) { ui.innerHTML = ''; ab.innerHTML = ''; return; }
    const c = CLASSES[u.cls];
    ui.innerHTML = `<b>${c.name}</b> <span class="sub">${c.role}</span><br>${u.hp}/${u.maxHp} HP · Move ${u.move}${u.armor ? ` · Armor ${u.armor}` : ''}
      ${u.cls === 'fighter' ? `<br>Stance: <b style="font-size:13px">${u.stance}</b>` : ''}${u.hidden ? '<br><span style="color:#9bffb0">Hidden</span>' : ''}${u.stunned ? '<br><span style="color:#ffe04a">Stunned this turn</span>' : ''}`;
    ab.innerHTML = '';
    b.abilities(u).forEach((id, i) => {
      const a = ABIL[id], btn = document.createElement('button');
      const cd = u.cd[id] > 0 ? `Ready in ${u.cd[id]}` : a.free ? (u.stanced ? 'Used' : 'Free') : a.cd ? `Cooldown ${a.cd}` : a.range ? `Range ${a.range + (a.ranged ? (u.mods.range || 0) : 0)}` : '';
      btn.className = 'btn abil' + (this.mode === id ? ' on' : '');
      btn.innerHTML = `${a.name}<small>${cd}</small><kbd>${i + 1}</kbd>`;
      btn.disabled = this.busy || b.phase !== 'player' || !b.canUse(u, id);
      btn.onclick = () => this.setMode(id);
      btn.onmouseenter = e => this.tip(`<b>${a.name}</b><br>${a.desc}`, e);
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
    if (!t) { this.v.setHover(null); this.tip(null); return; }
    const b = this.b, [x, y] = t, o = b.unitAt(x, y), u = this.sel;
    const tile = TILE[b.g.get(x, y)];
    let html = `<b>${tile.name}</b>${tile.desc ? `<br><span class="note">${tile.desc}</span>` : ''}`;
    if (b.g.fire[b.g.i(x, y)]) html += `<br><span style="color:#ff8a3a">On fire (${b.g.fire[b.g.i(x, y)]} rounds): 3 damage</span>`;
    if (o) html = `<b>${o.side === 'enemy' ? esc(this.enemyName) + ' ' : ''}${o.name}</b> ${o.hp}/${o.maxHp} HP${o.armor ? ` · Armor ${b.armorOf(o)}` : ''}${o.hidden ? ' · Hidden' : ''}<br>` + html;
    let color = 0xffffff;
    if (u && this.mode && !this.busy) {
      const tg = b.targets(u, this.mode).find(q => q.x === x && q.y === y);
      if (tg) {
        const a = ABIL[this.mode];
        color = 0xffd54a;
        if (a.kind === 'attack') {
          const p = b.preview(u, this.mode, tg);
          html = `<b>${a.name}</b> → ${tg.unit ? tg.unit.name : 'tree'}<br><span class="hit">${p.hit}% hit</span> · ${p.dmg} dmg${p.notes.length ? `<br><span class="note">${p.notes.join(' · ')}</span>` : ''}<hr style="border-color:#fff2">` + html;
        } else if (a.kind === 'heal') html = `<b>${a.name}</b>: +${b.preview(u, this.mode, tg).heal} HP<br>` + html;
        else html = `<b>${a.name}</b> here<br>` + html;
      }
      if (ABIL[this.mode].kind === 'aoe' && (prev?.[0] !== x || prev?.[1] !== y)) this.refresh();
    } else if (u && !u.moved && !o && !this.busy) {
      const e2 = b.reach(u).get(b.g.i(x, y));
      if (e2?.stop) { html = `Move here (${e2.c} of ${u.move})<br>` + html; color = 0x8fc8ff; }
    }
    this.v.setHover(x, y, color);
    this.tip(html, e);
  }

  click(t) {
    if (this.busy || this.b.phase !== 'player' || this.b.over || !t) return;
    const b = this.b, [x, y] = t, o = b.unitAt(x, y), u = this.sel;
    if (this.mode) {
      if (b.targets(u, this.mode).some(q => q.x === x && q.y === y)) return this.act(() => b.use(u, this.mode, x, y));
      if (o?.side === 'player') return this.select(o);
      return this.cancel();
    }
    if (o?.side === 'player') return this.select(o);
    if (!u) return;
    const basic = b.abilities(u)[0];
    if (o && b.canUse(u, basic) && b.targets(u, basic).some(q => q.unit === o)) return this.act(() => b.use(u, basic, x, y));
    if (!u.moved) { const e = b.reach(u).get(b.g.i(x, y)); if (e?.stop && e.c > 0) return this.act(() => b.move(u, x, y)); }
  }

  async act(fn) {
    this.busy = true; this.mode = null; this.refresh(); this.tip(null);
    await fn();
    this.busy = false;
    if (this.b.over) return this.onFinish();
    if (!this.ready(this.sel)) this.selectNext(); else this.refresh();
  }

  async endTurn() {
    if (this.busy || this.b.phase !== 'player') return;
    this.busy = true; this.mode = null; this.refresh();
    await this.b.endPlayerTurn();
    this.busy = false;
    if (this.b.over) return this.onFinish();
    this.sel = null; this.selectNext();
  }

  key(e) {
    if (this.busy) return;
    if (e.key >= '1' && e.key <= '5' && this.sel) { const id = this.b.abilities(this.sel)[+e.key - 1]; if (id) this.setMode(id); }
    else if (e.code === 'Escape') this.cancel();
    else if (e.code === 'Tab') { e.preventDefault(); this.selectNext(); }
    else if (e.code === 'Enter') this.endTurn();
  }
}

