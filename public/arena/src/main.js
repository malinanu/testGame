// Wildwood Arena client: home base, stronghold editor, armory, alchemy, raids and leaderboard.
import { loadAssets, PROPS as BASE_PROPS } from '../../src/assets.js';
import { CLASSES, CLASS_KEYS, TILE, T } from '../../tactics/src/data.js';
import { Battle, makeUnit } from '../../tactics/src/battle.js';
import { View } from '../../tactics/src/view.js';
import { BattleController } from '../../tactics/src/controller.js';
import * as E from './economy.js';
import { toGrid, validate, layoutCost, buildRaid, BEHAVIORS, PALETTE, BUILD_COST, ATTACK_ROWS, DEFENSE_MIN_ROW, RAID_ROUNDS } from './stronghold.js';
import { createApi } from './api.js';
import { bindHelp } from '../../tactics/src/help.js';

bindHelp({ extraTab: { id: 'arena', label: '🏰 Arena', html: () => `
  <div class="steps">
    <div class="stepc"><span class="num">1</span><b>Build your stronghold</b><p>Stronghold tab → <b>Edit layout &amp; garrison</b>. Paint rocks, trees and bushes (each costs build points), then place 4 defenders in rows 7–12 and give each an order. Raiders always start in rows 1–2.</p></div>
    <div class="stepc"><span class="num">2</span><b>Raid a rival</b><p>Press <b>⚔ Raid</b>, pick 4 heroes and any potions, and attack. It plays exactly like a Tactics battle: select a hero, move on blue tiles, attack red targets, then End Turn. You have 20 rounds to defeat every defender.</p></div>
    <div class="stepc"><span class="num">3</span><b>Grow stronger</b><p>Wins pay gold. Spend it in the <b>Armory</b> on gear tiers (Common → Legendary). Grass and bushes on your stronghold grow herbs and berries: collect them and brew in <b>Alchemy</b>.</p></div>
    <div class="stepc"><span class="num">4</span><b>Climb the leagues</b><p>Every raid moves your Elo, up or down. Other guilds raid <i>your</i> stronghold while you are away, and a good defense earns gold too. Seasons last 28 days; finishing Silver+ earns an aura.</p></div>
  </div>
  <div class="tip-line">🛡 <b>Garrison orders:</b> ${Object.values(BEHAVIORS).map(b => `<b>${b.name}</b>: ${b.desc}`).join(' · ')}</div>
  <div class="tip-line">💡 New to the battles? The single-player <a href="../tactics/" style="color:#ffd54a">Wildwood Tactics</a> has a 2-minute guided training.</div>` } });

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FOREST = ['Tree_1_A', 'Tree_2_A', 'Tree_3_A', 'Tree_4_A', 'Tree_1_C', 'Tree_2_C', 'Tree_Bare_1_A', 'Tree_Bare_1_B', 'Tree_Bare_2_A',
  'Bush_1_D', 'Bush_2_C', 'Bush_3_B', 'Bush_4_C', 'Rock_1_D', 'Rock_1_E', 'Rock_1_F', 'Rock_3_E', 'Rock_3_G', 'Rock_1_N', 'Rock_1_O', 'Rock_1_P',
  'Grass_1_C', 'Grass_1_D', 'Grass_2_C', 'Grass_2_D'];
const PROPS = [...new Set([...BASE_PROPS, 'bow_withString', 'crossbow_1handed', 'arrow_bow', 'arrow_crossbow', 'mug_full'])];
const auraColor = name => E.LEAGUES.find(l => l.name === name)?.color ? parseInt(E.LEAGUES.find(l => l.name === name).color.slice(1), 16) : null;
const tierOf = n => E.TIERS[n | 0];

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + id));
  $('hud').classList.toggle('hidden', id !== 'battle');
}
let toastTimer;
function toast(html, ms = 3200) {
  const t = $('toast'); t.innerHTML = html; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

class Arena {
  constructor(api, view) {
    this.api = api; this.view = view; this.S = null; this.tab = 'base';
    this.party = ['knight', 'barbarian', 'ranger', 'wizard'];
    $('modenote').textContent = api.mode === 'cloud' ? 'Online: your guild is stored in the Wildwood cloud.' : 'Offline demo: strongholds and rankings live in this browser (add Supabase keys to config.js to play online).';
    $('loginform').onsubmit = e => { e.preventDefault(); this.register(); };
    document.querySelectorAll('#nav [data-tab]').forEach(b => b.onclick = () => { this.tab = b.dataset.tab; this.renderHome(); });
    $('nav').querySelector('[data-go=raid]').onclick = () => this.raidPrep();
    $('r-back').onclick = () => this.home();
    $('r-scout').onclick = () => this.scout(true);
    $('r-attack').onclick = () => this.attack();
    $('res-home').onclick = () => this.home();
    $('b-cancel').onclick = () => this.home();
    $('b-save').onclick = () => this.saveBuild();
    $('retreat').onclick = () => { if (this.raid && confirm('Retreat? The raid counts as a loss.')) this.finishRaid(); };
  }

  async call(action, payload) {
    const r = await this.api.call(action, payload);
    if (r?.error) { toast(`⚠ ${esc(r.error)}`); return null; }
    if (r?.profile) this.S = { ...this.S, ...r };
    return r;
  }

  async boot() {
    const r = await this.api.call('me');
    if (r?.error) { show('login'); $('loginerr').textContent = r.error; return; }
    if (!r?.profile) { this.backdrop(); show('login'); return; }
    this.S = r; this.events(r); this.home();
  }

  events(r) {
    const msgs = [];
    if (r.daily) msgs.push(`☀ Daily tribute: <b>+${r.daily.gold} gold</b> (day ${r.daily.streak} streak)`);
    if (r.defense) msgs.push(`${r.defense.held ? '🛡 Your garrison repelled' : '🔥 Your stronghold fell to'} <b>${esc(r.defense.attacker)}</b> (${r.defense.delta >= 0 ? '+' : ''}${r.defense.delta} Elo)`);
    if (msgs.length) toast(msgs.join('<br>'), 5000);
  }

  backdrop() {
    const g = toGrid({ tiles: new Array(144).fill(T.GRASS).map((t, i) => (i * 37) % 11 === 0 ? T.BUSH : (i * 53) % 17 === 0 ? T.TREE : t) });
    this.view.showBackdrop(g);
  }

  async register() {
    $('loginerr').textContent = '';
    const r = await this.api.call('register', { name: $('name').value });
    if (r?.error) { $('loginerr').textContent = r.error; return; }
    this.S = r; this.events(r); this.home();
  }

  // ------------------------------------------------------------ home base
  stage(layout, garrison, { orbit = 0.05, tiers = {} } = {}) {
    const v = this.view;
    v.clearCamp(); v.clearUnits();
    v.buildBoard(toGrid(layout, 7));
    for (const d of garrison) {
      const u = makeUnit({ cls: d.cls, gear: [] }, 'player');
      u.x = d.x; u.y = d.y; u.auraColor = auraColor(this.S.profile.aura);
      const tier = tiers[d.cls] ?? d.tier ?? 0; if (tier) u.tierColor = tierOf(tier).color;
      v.addUnit(u); v.uv(u).actor.root.rotation.y = Math.PI;
    }
    Object.assign(v.cam, { target: v.cam.target.set(0, 0, 2), dist: 30, pitch: 0.8, orbit, yaw: Math.PI, yawGoal: Math.PI });
  }

  home() {
    this.raid = null;
    this.view.onClick = this.view.onHover = this.view.onCancel = null; $('c').onpointerdown = null;
    const sh = this.S.stronghold;
    this.stage(sh.layout, sh.garrison, { tiers: this.S.profile.tiers });
    show('home');
    this.renderHome();
  }

  renderBar() {
    const p = this.S.profile, lg = E.league(p.rating), c = p.consumables, s = this.S.season;
    const days = s ? Math.max(0, Math.ceil((s.ends - (this.S.now || Date.now())) / 864e5)) : '?';
    $('bar').innerHTML = `<span class="who">${esc(p.name)}</span>
      <span class="chip" style="background:${lg.color}">${lg.name}</span><span>${p.rating} Elo</span>
      ${p.aura ? `<span title="Seasonal aura" style="color:${E.LEAGUES.find(l => l.name === p.aura).color}">✦ ${esc(p.aura)} aura</span>` : ''}
      <span class="sp"></span>
      <span class="res">🪙 <b>${p.gold}</b></span><span class="res">🌿 <b>${p.herbs}</b></span><span class="res">🫐 <b>${p.berries}</b></span>
      <span class="res" title="Potions · Ale · Tonic">🧪 ${c.potion || 0} · 🍺 ${c.ale || 0} · 🍃 ${c.tonic || 0}</span>
      <span style="opacity:.7">Season ${s?.id ?? 1} · ${days}d left</span>`;
  }

  renderHome() {
    this.renderBar();
    document.querySelectorAll('#nav [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === this.tab));
    const p = this.S.profile, el = $('panel');
    if (this.tab === 'base') {
      const sh = this.S.stronghold, pend = this.S.pending || { herbs: 0, berries: 0 }, rates = E.harvestRates(sh.layout);
      const steps = [
        ['Edit your stronghold', sh.version > 1], ['Brew something in Alchemy', Object.values(p.consumables).reduce((a, b) => a + b, 0) > 1 || p.consumables.ale > 0 || p.consumables.tonic > 0],
        ['Win or lose your first raid', p.wins + p.losses > 0], ['Check how your defenders did', (this.S.defenseLog || []).length > 0],
      ];
      const todo = steps.filter(s => !s[1]).length;
      el.innerHTML = (todo ? `<div class="checklist"><h3>Getting started <small>${steps.length - todo}/${steps.length}</small></h3>${steps.map(([t, d]) => `<div class="${d ? 'done' : ''}">${d ? '✅' : '⬜'} ${t}</div>`).join('')}<button class="btn helpbtn" data-help="arena">❓ How the Arena works</button></div>` : '') + `<h3>Your stronghold</h3>
        <div class="item"><div><span class="nm">Level ${p.level}</span><small>Build budget ${layoutCost(sh.layout)} / ${E.buildBudget(p.level)} · layout v${sh.version}</small></div>
          <button class="btn gold" id="h-edit">Edit layout & garrison</button></div>
        <div class="item"><div><span class="nm">Harvest</span><small>Grass tufts grow herbs (${rates.herbs.toFixed(1)}/h), bushes grow berries (${rates.berries.toFixed(1)}/h). Stores fill for ${E.HARVEST.capHours}h.</small></div>
          <button class="btn" id="h-harvest" ${pend.herbs + pend.berries ? '' : 'disabled'}>Collect 🌿${pend.herbs} 🫐${pend.berries}</button></div>
        <div class="item"><div><span class="nm">Record</span><small><span class="stat">Raids ${p.wins}W / ${p.losses}L</span><span class="stat">Defenses ${p.defWins}W / ${p.defLosses}L</span></small></div></div>
        <h3>Garrison</h3>${sh.garrison.map(d => `<div class="item"><div><span class="nm">${CLASSES[d.cls].name}</span> <span class="tier" style="color:${tierOf(p.tiers[d.cls]).color}">${tierOf(p.tiers[d.cls]).name}</span><small>${BEHAVIORS[d.behavior].name}: ${BEHAVIORS[d.behavior].desc}</small></div></div>`).join('')}
        <h3>Defense log</h3><ul class="log">${(this.S.defenseLog || []).map(l => `<li class="${l.held ? 'won' : 'lost'}">${l.held ? 'Repelled' : 'Lost to'} ${esc(l.attacker)} (${l.delta >= 0 ? '+' : ''}${l.delta})</li>`).join('') || '<li>No raids yet. Your walls await.</li>'}</ul>`;
      $('h-edit').onclick = () => this.builder();
      $('h-harvest').onclick = async () => { const r = await this.call('harvest'); if (r) { toast(`Collected 🌿${r.harvested.herbs} herbs and 🫐${r.harvested.berries} berries`); this.renderHome(); } };
    } else if (this.tab === 'armory') {
      el.innerHTML = `<h3>Armory</h3><p class="hint">Same trusty models, mathematically superior steel. Upgrades apply to your raiders and your garrison.</p>` +
        CLASS_KEYS.map(k => {
          const t = p.tiers[k] || 0, cur = tierOf(t), nxt = E.TIERS[t + 1], cost = E.upgradeCost(t);
          return `<div class="item"><div><span class="nm">${CLASSES[k].name}</span> · ${E.GEAR_NAMES[k]}<br>
            <span class="tier" style="color:${cur.color}">${cur.name}</span> <small>+${cur.dmg} dmg · +${cur.hp} HP · +${cur.acc}% hit${nxt ? ` → <span style="color:${nxt.color}">${nxt.name}</span>: +${nxt.dmg} / +${nxt.hp} / +${nxt.acc}%` : ''}</small></div>
            ${nxt ? `<button class="btn ${p.gold >= cost ? 'gold' : ''}" data-up="${k}" ${p.gold >= cost ? '' : 'disabled'}>🪙 ${cost}</button>` : '<b style="color:#ffb020">MAX</b>'}</div>`;
        }).join('') +
        `<h3>Stronghold</h3><div class="item"><div><span class="nm">Level ${p.level}</span><small>Budget ${E.buildBudget(p.level)} build points${p.level < E.MAX_LEVEL ? ` → ${E.buildBudget(p.level + 1)}` : ''}</small></div>
        ${p.level < E.MAX_LEVEL ? `<button class="btn" id="up-level" ${p.gold >= E.LEVEL_COST[p.level] ? '' : 'disabled'}>🪙 ${E.LEVEL_COST[p.level]}</button>` : '<b>MAX</b>'}</div>`;
      el.querySelectorAll('[data-up]').forEach(b => b.onclick = async () => { if (await this.call('upgradeGear', { cls: b.dataset.up })) { toast(`${CLASSES[b.dataset.up].name} gear is now <b style="color:${tierOf(this.S.profile.tiers[b.dataset.up]).color}">${tierOf(this.S.profile.tiers[b.dataset.up]).name}</b>!`); this.home(); } });
      $('up-level')?.addEventListener('click', async () => { if (await this.call('upgradeStronghold')) { toast(`Stronghold level ${this.S.profile.level}: more build points!`); this.renderHome(); } });
    } else if (this.tab === 'alchemy') {
      const pend = this.S.pending || { herbs: 0, berries: 0 };
      el.innerHTML = `<h3>Alchemy</h3><p class="hint">You have 🌿 ${p.herbs} herbs and 🫐 ${p.berries} berries${pend.herbs + pend.berries ? ` (+${pend.herbs}/${pend.berries} ready to collect on the Stronghold tab)` : ''}. Brews are single-use and carried into raids.</p>` +
        Object.entries(E.RECIPES).map(([k, r]) => {
          const can = (r.cost.herbs || 0) <= p.herbs && (r.cost.berries || 0) <= p.berries;
          return `<div class="item"><div><span class="nm">${{ potion: '🧪', ale: '🍺', tonic: '🍃' }[k]} ${r.name}</span> <small>${r.desc}<br>Cost: ${r.cost.herbs ? `🌿${r.cost.herbs} ` : ''}${r.cost.berries ? `🫐${r.cost.berries}` : ''} · In satchel: ${p.consumables[k] || 0} · Carry up to ${E.RAID_CARRY[k]} per raid</small></div>
            <button class="btn ${can ? 'gold' : ''}" data-brew="${k}" ${can ? '' : 'disabled'}>Brew</button></div>`;
        }).join('');
      el.querySelectorAll('[data-brew]').forEach(b => b.onclick = async () => { if (await this.call('craft', { recipe: b.dataset.brew })) { toast(`Brewed a ${E.RECIPES[b.dataset.brew].name}`); this.renderHome(); } });
    } else if (this.tab === 'ranks') {
      el.innerHTML = '<h3>Leaderboard</h3><p class="hint">Loading…</p>';
      this.api.call('leaderboard').then(r => {
        if (this.tab !== 'ranks' || r?.error) return;
        el.innerHTML = `<h3>Season ${r.season?.id ?? 1} leaderboard</h3><p class="hint">You are <b>#${r.me?.rank}</b>. Finish a season in Silver or higher to earn that league's aura for your units.</p>
          <table><tr><th>#</th><th>Guild</th><th>League</th><th>Elo</th></tr>${r.top.map((o, i) => `<tr class="${o.id === p.id ? 'me' : ''}"><td>${i + 1}</td><td>${esc(o.name)}${o.isBot ? ' <small style="opacity:.6">NPC</small>' : ''}${o.aura ? ` <span style="color:${E.LEAGUES.find(l => l.name === o.aura).color}">✦</span>` : ''}</td><td>${o.league}</td><td>${o.rating}</td></tr>`).join('')}</table>`;
      });
    }
  }

  // ------------------------------------------------------------ stronghold editor
  builder() {
    const sh = this.S.stronghold, p = this.S.profile;
    this.draft = { layout: { tiles: sh.layout.tiles.slice() }, garrison: sh.garrison.map(d => ({ ...d })) };
    this.brush = T.PILLAR; this.placing = -1;
    this.stage(this.draft.layout, this.draft.garrison, { orbit: 0, tiers: p.tiers });
    Object.assign(this.view.cam, { yaw: 0, yawGoal: 0, pitch: 1.05, dist: 29, target: this.view.cam.target.set(0, 0, 0) });
    show('builder');
    $('palette').innerHTML = PALETTE.map(t => `<button class="btn" data-t="${t}"><span>${TILE[t].name}</span><span>${BUILD_COST[t]} pt</span></button>`).join('');
    $('palette').querySelectorAll('[data-t]').forEach(b => b.onclick = () => { this.brush = +b.dataset.t; this.placing = -1; this.renderBuilder(); });
    let painting = false;
    const v = this.view;
    v.onClick = t => this.paint(t, true);
    v.onCancel = () => { this.placing = -1; this.renderBuilder(); };
    v.onHover = (t, e) => {
      v.setHover(t?.[0], t?.[1], this.placing >= 0 ? 0x6dff8a : 0xffd54a);
      if (painting && t && this.placing < 0) this.paint(t, false);
    };
    $('c').onpointerdown = e => { if (e.button === 0 && !e.shiftKey) painting = true; };
    window.onpointerup = () => { painting = false; }; // assigned, not added: the builder opens many times
    this.renderBuilder();
  }

  paint(t, click) {
    if (!t || !document.querySelector('#screen-builder.active')) return;
    const [x, y] = t, d = this.draft, i = y * 12 + x;
    if (this.placing >= 0) {
      if (!click) return;
      if (TILE[d.layout.tiles[i]].block) return toast('Defenders need an open tile.');
      if (y < DEFENSE_MIN_ROW) return toast(`Defenders deploy in rows ${DEFENSE_MIN_ROW + 1}–12.`);
      const other = d.garrison.findIndex((g, k) => k !== this.placing && g.x === x && g.y === y);
      if (other >= 0) [d.garrison[other].x, d.garrison[other].y] = [d.garrison[this.placing].x, d.garrison[this.placing].y];
      d.garrison[this.placing].x = x; d.garrison[this.placing].y = y;
      this.placing = -1; this.restageUnits(); this.renderBuilder();
      return;
    }
    if (ATTACK_ROWS.includes(y) && this.brush !== T.GROUND && this.brush !== T.GRASS) { if (click) toast('Rows 1–2 are the raiders\' landing zone.'); return; }
    if (TILE[this.brush].block && d.garrison.some(g => g.x === x && g.y === y)) { if (click) toast('A defender stands there; move them first.'); return; }
    if (d.layout.tiles[i] === this.brush) return;
    d.layout.tiles[i] = this.brush;
    this.view.grid.set(x, y, this.brush); this.view.retileNow(x, y);
    this.renderBuilder();
  }

  restageUnits() {
    const v = this.view; v.clearUnits();
    for (const g of this.draft.garrison) { const u = makeUnit({ cls: g.cls, gear: [] }, 'player'); u.x = g.x; u.y = g.y; v.addUnit(u); }
  }

  renderBuilder() {
    const d = this.draft, p = this.S.profile, cost = layoutCost(d.layout), budget = E.buildBudget(p.level);
    $('budget').textContent = `Build points ${cost} / ${budget}`;
    $('budget').classList.toggle('over', cost > budget);
    $('palette').querySelectorAll('[data-t]').forEach(b => b.classList.toggle('on', +b.dataset.t === this.brush && this.placing < 0));
    const g = $('garrison');
    g.innerHTML = d.garrison.map((u, k) => `<div class="gslot ${this.placing === k ? 'placing' : ''}">
      <select data-cls="${k}">${CLASS_KEYS.map(c => `<option value="${c}" ${c === u.cls ? 'selected' : ''}>${CLASSES[c].name} (${tierOf(p.tiers[c]).name})</option>`).join('')}</select>
      <select data-beh="${k}">${Object.entries(BEHAVIORS).map(([b, x]) => `<option value="${b}" ${b === u.behavior ? 'selected' : ''}>${x.name}</option>`).join('')}</select>
      <small class="hint">${BEHAVIORS[u.behavior].desc}</small>
      <button class="btn" data-place="${k}">${this.placing === k ? 'Click a tile in rows 7–12…' : `Move (now ${u.x + 1},${u.y + 1})`}</button></div>`).join('');
    g.querySelectorAll('[data-cls]').forEach(s => s.onchange = () => { d.garrison[+s.dataset.cls].cls = s.value; this.restageUnits(); this.renderBuilder(); });
    g.querySelectorAll('[data-beh]').forEach(s => s.onchange = () => { d.garrison[+s.dataset.beh].behavior = s.value; this.renderBuilder(); });
    g.querySelectorAll('[data-place]').forEach(b => b.onclick = () => { this.placing = +b.dataset.place; this.renderBuilder(); });
    const errs = validate(d.layout, d.garrison, p.level);
    $('berrs').innerHTML = errs.map(esc).join('<br>');
    $('b-save').disabled = errs.length > 0;
  }

  async saveBuild() {
    const r = await this.call('saveStronghold', this.draft);
    if (r) { toast('Stronghold uploaded. Let them come.'); this.home(); }
  }

  // ------------------------------------------------------------ raids
  raidPrep() {
    show('raid');
    const p = this.S.profile;
    this.carry = { potion: Math.min(1, p.consumables.potion || 0), ale: 0, tonic: 0 };
    const renderParty = () => {
      $('partycount').textContent = `${this.party.length} / 4`;
      $('partypick').innerHTML = CLASS_KEYS.map(k => {
        const n = this.party.filter(c => c === k).length, t = tierOf(p.tiers[k]);
        return `<button class="card ${n ? 'sel' : ''}" data-k="${k}"><b class="t">${CLASSES[k].name}${n > 1 ? ` ×${n}` : ''}</b><span class="sub">${CLASSES[k].role}</span><div class="stats" style="color:${t.color}">${t.name}</div></button>`;
      }).join('');
      $('partypick').querySelectorAll('[data-k]').forEach(b => b.onclick = e => {
        const k = b.dataset.k, i = this.party.indexOf(k);
        if (i >= 0 && !e.shiftKey) this.party.splice(i, 1);           // click a picked hero to drop one
        else if (this.party.length < 4) this.party.push(k);           // shift-click to add duplicates
        else return toast('Party is full: click a picked hero to remove it.');
        renderParty();
      });
      $('r-attack').disabled = this.party.length !== 4 || !this.target;
    };
    this.renderParty = renderParty;
    $('carry').innerHTML = Object.entries(E.RAID_CARRY).map(([k, max]) => `<div class="item">${{ potion: '🧪', ale: '🍺', tonic: '🍃' }[k]} ${E.RECIPES[k].name}
      <input type="number" min="0" max="${Math.min(max, p.consumables[k] || 0)}" value="${this.carry[k]}" data-c="${k}"> <small>have ${p.consumables[k] || 0}</small></div>`).join('');
    $('carry').querySelectorAll('[data-c]').forEach(inp => inp.onchange = () => { this.carry[inp.dataset.c] = Math.max(0, Math.min(+inp.max, inp.value | 0)); inp.value = this.carry[inp.dataset.c]; });
    renderParty();
    this.skip = [];
    this.scout(false);
  }

  async scout(another) {
    if (another && this.target) this.skip.push(this.target.id);
    $('target').innerHTML = '<p class="hint">Scouting the Wildwood…</p>';
    let t = await this.api.call('findTarget', { skip: this.skip });
    if (t?.error && this.skip.length) { this.skip = []; t = await this.api.call('findTarget', { skip: [] }); }
    if (t?.error) { this.target = null; $('target').innerHTML = `<p class="err">${esc(t.error)}</p>`; this.renderParty(); return; }
    this.target = t;
    $('target').innerHTML = `<b class="t">${esc(t.name)}</b><span class="sub">${t.isBot ? 'NPC guild' : 'Player guild'} · ${t.league.name} · ${t.rating} Elo · Stronghold L${t.level}</span>
      <div class="stats">Win: <b style="color:var(--green)">+${t.winDelta}</b> Elo, 🪙 ${t.reward.gold}, 🌿${t.reward.herbs} 🫐${t.reward.berries} · Lose: <b style="color:#ff8a8a">${t.lossDelta}</b> Elo</div>
      <ul>${t.garrison.map(g => `<li>${CLASSES[g.cls].name} <span style="color:${tierOf(g.tier).color}">${tierOf(g.tier).name}</span> · ${BEHAVIORS[g.behavior].name}</li>`).join('')}</ul>
      <small class="hint">You have ${RAID_ROUNDS} rounds to wipe out the garrison.</small>`;
    this.renderParty();
  }

  async attack() {
    if (!this.target || this.party.length !== 4 || this.starting) return;
    this.starting = true; $('r-attack').disabled = true; // one raid per click: a second request would forfeit the first
    let r;
    try { r = await this.api.call('startRaid', { defenderId: this.target.id, party: this.party, consumables: this.carry }); }
    finally { this.starting = false; $('r-attack').disabled = false; }
    if (r?.error) return toast(`⚠ ${esc(r.error)}`);
    this.ctl?.dispose(); this.ctl = null;
    this.raid = r.raid;
    const setup = buildRaid({ attack: r.raid.attack, defense: r.raid.defense, seed: r.raid.seed });
    const v = this.view;
    v.clearCamp(); v.clearUnits(); v.buildBoard(setup.grid); v.battleCamera();
    for (const u of setup.units) {
      u.auraColor = auraColor(u.aura);
      if (u.tier) u.tierColor = tierOf(u.tier).color;
      v.addUnit(u);
    }
    $('log').innerHTML = '';
    $('vs').textContent = `Raid on ${r.raid.defenderName} — survive ≤ ${RAID_ROUNDS} rounds`;
    show('battle');
    const b = this.battle = new Battle({ grid: setup.grid, units: setup.units, view: v, ...setup.opts });
    this.ctl = new BattleController(v, b, { enemyName: r.raid.defenderName, onFinish: () => this.finishRaid() });
  }

  async finishRaid() {
    if (!this.raid || this.finishing) return;
    this.finishing = true;
    const raid = this.raid, b = this.battle;
    if (b.over) await this.view.wait(1.1);
    this.ctl?.dispose(); this.ctl = null;
    const r = await this.api.call('finishRaid', { raidId: raid.id, actions: b.actions });
    this.finishing = false; this.raid = null;
    if (r?.error) { toast(`⚠ ${esc(r.error)}`); return this.home(); }
    this.S = { ...this.S, ...r };
    const won = r.result === 'win';
    $('restitle').textContent = won ? 'Stronghold breached!' : r.reason === 'retreated' ? 'You retreated' : 'The garrison held';
    $('restext').textContent = `Raid on ${raid.defenderName}: ${r.rounds} round${r.rounds === 1 ? '' : 's'}.${r.reason === 'invalid' ? ' The server could not verify this raid.' : ''}`;
    $('resgrid').innerHTML = [
      [`${r.ratingDelta >= 0 ? '+' : ''}${r.ratingDelta}`, 'Elo'], [`+${r.rewards.gold}`, 'Gold'], [`+${r.rewards.herbs}`, 'Herbs'], [`+${r.rewards.berries}`, 'Berries'],
      [E.league(r.profile.rating).name, `${r.profile.rating} Elo`],
    ].map(([a, b2]) => `<div class="card"><b class="t">${a}</b><span class="sub">${b2}</span></div>`).join('');
    this.view.setHighlights([]);
    show('result');
  }
}

// ------------------------------------------------------------ boot
const [api, assets] = await Promise.all([
  createApi(),
  loadAssets({ base: '../', props: PROPS, forest: FOREST, onProgress: (d, n) => { $('loadtxt').textContent = `Raising the banners… ${Math.round(d / n * 100)}%`; } }),
]);
const view = new View($('c'), assets);
const arena = new Arena(api, view);
window.arena = arena; // for debugging / automated tests
await arena.boot();
