import { loadAssets, PROPS as BASE_PROPS } from '../../src/assets.js';
import { CLASSES, CLASS_KEYS, ABIL, ITEMS, TILE, T, GUILDS, maxHpOf } from './data.js';
import { generateMap, pathTo, dist, rng } from './grid.js';
import { Battle, makeUnit } from './battle.js';
import { View } from './view.js';
import { BattleController } from './controller.js';
import { bindHelp } from './help.js';
import { runTutorial, TUTORIAL_KEY } from './tutorial.js';
import * as Run from './run.js';
import { OnlineMatch, pickTransport, cleanCode } from './net.js';
import { CONFIG } from '../../arena/config.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const FOREST = ['Tree_1_A', 'Tree_2_A', 'Tree_3_A', 'Tree_4_A', 'Tree_1_C', 'Tree_2_C', 'Tree_Bare_1_A', 'Tree_Bare_1_B', 'Tree_Bare_2_A',
  'Bush_1_D', 'Bush_2_C', 'Bush_3_B', 'Bush_4_C', 'Rock_1_D', 'Rock_1_E', 'Rock_1_F', 'Rock_3_E', 'Rock_3_G', 'Rock_1_N', 'Rock_1_O', 'Rock_1_P',
  'Grass_1_C', 'Grass_1_D', 'Grass_2_C', 'Grass_2_D'];
const PROPS = [...new Set([...BASE_PROPS, 'bow_withString', 'crossbow_1handed', 'shield_spikes_color', 'shield_round_color', 'sword_2handed_color',
  'mug_full', 'arrow_bow', 'arrow_crossbow', 'spellbook_closed'])];

// ------------------------------------------------------------------ screens
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + id));
  $('hud').classList.toggle('hidden', id !== 'battle');
}

function heroCard(h, extra = '') {
  const c = CLASSES[h.cls], max = maxHpOf(h);
  const gear = h.gear.map(id => ITEMS[id].name).join(', ');
  return `<div class="hero ${h.alive ? '' : 'dead'}"><b>${c.name}</b> <span class="sub">${c.role}</span>
    <div class="hpbar"><i style="width:${h.alive ? h.hp / max * 100 : 0}%"></i></div>
    ${h.alive ? `${h.hp} / ${max} HP` : 'Fallen'}${gear ? `<div class="gear">${esc(gear)}</div>` : ''}${extra}</div>`;
}

const RECOMMENDED = ['knight', 'ranger', 'wizard', 'barbarian'];
const DIFF = { easy: { hpMult: 0.8, dmgBonus: -1, name: 'Easy' }, normal: { hpMult: 1, dmgBonus: 0, name: 'Normal' }, hard: { hpMult: 1.25, dmgBonus: 1, name: 'Hard' } };
const TURN_SECONDS = 90, RETURN_SECONDS = 60;
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const squadNames = list => list.map(k => CLASSES[k].name).join(', ');

class App {
  constructor(view) {
    this.view = view; this.run = null; this.draft = []; this.diff = store.get('wwt-diff', 'normal');
    this.transport = pickTransport(CONFIG);
    const campaign = () => this.showDraft({ title: 'Draft your party', begin: 'Enter the Wildwood', onBegin: list => { this.run = Run.newRun(list); Run.save(this.run); this.showMap(); } });
    this.campaignDraft = campaign;
    $('btn-new').onclick = campaign;
    $('btn-learn').onclick = () => this.tutorial();
    $('btn-tut-run').onclick = campaign;
    $('btn-tut-again').onclick = () => this.tutorial();
    $('btn-tut-title').onclick = () => this.showTitle();
    $('btn-quick').onclick = () => this.pickParty(RECOMMENDED);
    // a reload mid-fight resumes that fight (it was saved as entered but not yet won)
    $('btn-continue').onclick = () => { this.run = Run.load(); if (this.run.inBattle && Run.currentNode(this.run)) this.startBattle(Run.currentNode(this.run)); else this.showMap(); };
    $('btn-begin').onclick = () => this.draftOpts.onBegin([...this.draft]);
    $('btn-draftback').onclick = () => (this.draftOpts.back || (() => this.showTitle()))();
    $('o-diff').querySelectorAll('button').forEach(b => { b.onclick = () => { this.diff = b.dataset.v; store.set('wwt-diff', this.diff); this.renderDraft(); }; });
    $('btn-skirmish').onclick = () => this.skirmishDraft();
    $('btn-local').onclick = () => this.localDraft();
    $('btn-online').onclick = () => this.openOnline();
    this.bindVersus();
    $('btn-again').onclick = () => this.showTitle();
    $('btn-rest').onclick = () => { Run.rest(this.run); this.renderCamp(); };
    $('btn-breakcamp').onclick = () => { this.view.clearCamp(); Run.save(this.run); this.showMap(); };
    this.backdrop();
  }

  backdrop() { this.view.showBackdrop(generateMap(Math.floor(Math.random() * 1e6), 2).grid); }

  showTitle() {
    if (this.view.camp.children.length || !this.view.board.visible || this.view.units.size) this.backdrop();
    const saved = Run.load();
    $('btn-continue').style.display = saved && saved.party?.some(h => h.alive) ? '' : 'none';
    let seen = false; try { seen = localStorage.getItem(TUTORIAL_KEY) === '1'; } catch {}
    $('newhere').textContent = seen ? '' : '👋 New here? Start with the 2-minute training. It walks you through your first battle.';
    $('btn-learn').classList.toggle('pulse', !seen);
    $('btn-quit').classList.add('hidden');
    $('btn-online').disabled = !this.transport;
    $('onlinenote').textContent = this.transport ? (this.transport.kind === 'local' ? 'Test mode: pairs browser tabs on this computer.' : '') : 'Unavailable: no online server configured.';
    show('title');
  }

  async tutorial() {
    this.ctl?.dispose(); this.ctl = null;
    const how = await runTutorial(this.view, { show });
    if (how === 'skipped') return this.showTitle();
    $('tuttitle').textContent = how === 'done' ? "You're ready!" : 'Almost!';
    $('tuttext').innerHTML = how === 'done'
      ? "That's the whole loop: <b>select → move → act → End Turn</b>. Use cover, hide in bushes and watch the enemy's threat range (press T)."
      : 'The dummies got lucky. Try again, or start a real run. The top bar always tells you what to do next.';
    show('tutdone');
  }

  pickParty(list) {
    this.draft = [...list];
    this.renderDraft();
  }

  /** opts: { title, begin, onBegin(list), back(), difficulty, preset } */
  showDraft(opts) {
    this.draftOpts = opts;
    $('drafttitle').textContent = opts.title;
    $('btn-begin').textContent = opts.begin;
    $('draftopts').classList.toggle('hidden', !opts.difficulty);
    this.draft = [...(opts.preset || [])];
    const box = $('draftcards'); box.innerHTML = '';
    for (const k of CLASS_KEYS) {
      const c = CLASSES[k], el = document.createElement('button');
      el.className = 'card';
      const tag = { knight: ['Tank', ''], barbarian: ['Damage', 'dmg'], ranger: ['Damage', 'dmg'], rogue: ['Damage', 'dmg'], wizard: ['Support', 'sup'], fighter: ['Tank / Damage', ''] }[k];
      el.innerHTML = `<b class="t">${c.name}<span class="tag ${tag[1]}">${tag[0]}</span></b><span class="sub">${c.role}</span>
        <div class="stats">❤ ${c.hp} HP · ➜ ${c.move} move${c.armor ? ` · ⛨ ${c.armor} armor` : ''}</div>
        <ul>${c.abilities.map(a => `<li><b>${ABIL[a].name}</b>: ${ABIL[a].desc}</li>`).join('')}</ul>
        <div class="pas">${c.passive}</div>`;
      el.onclick = () => {
        const i = this.draft.indexOf(k);
        if (i >= 0) this.draft.splice(i, 1); else if (this.draft.length < 4) this.draft.push(k);
        this.renderDraft();
      };
      box.appendChild(el);
    }
    this.renderDraft();
    show('draft');
  }

  renderDraft() {
    const d = this.draft;
    $('o-diff').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === this.diff));
    $('draftcards').querySelectorAll('.card').forEach((b, j) => b.classList.toggle('sel', d.includes(CLASS_KEYS[j])));
    $('draftcount').textContent = `${d.length} / 4`;
    $('btn-begin').disabled = d.length !== 4;
    const warn = [];
    if (d.length === 4) {
      if (!d.includes('wizard')) warn.push('No Wizard means no healing in battle. Campfires will matter a lot.');
      if (!d.includes('knight') && !d.includes('fighter')) warn.push('No Knight or Fighter: nobody tough to stand in front.');
      if (!d.some(c => c === 'ranger' || c === 'wizard')) warn.push('No ranged hero: you will have to walk up to everything.');
    }
    $('draftwarn').textContent = d.length < 4 ? `Pick ${4 - d.length} more hero${4 - d.length > 1 ? 'es' : ''}. Click a card to add or remove it.` : warn.length ? `⚠️ ${warn.join(' ')}` : '✅ Nicely balanced party.';
  }

  // -------------------------------------------------------------- node map
  showMap() {
    const run = this.run;
    if (this.view.camp.children.length || this.view.units.size) this.backdrop();
    $('res').innerHTML = `Supplies <b>${run.supplies}</b> · Potions <b>${run.potions}</b> · Battles won <b>${run.won}</b>`;
    $('partybar').innerHTML = run.party.map(h => heroCard(h)).join('');
    const svg = $('mapsvg'), Wd = 600, rows = run.map.length, Hd = rows * 64 + 10;
    svg.setAttribute('viewBox', `0 0 ${Wd} ${Hd}`);
    const pos = n => [40 + n.x * (Wd - 80), Hd - 36 - n.l * 64];
    const avail = new Set(Run.available(run));
    const visited = new Set(run.visited || []);
    let html = '';
    for (const row of run.map) for (const n of row) for (const j of n.next) {
      const m = run.map[n.l + 1][j], [x1, y1] = pos(n), [x2, y2] = pos(m);
      const done = visited.has(`${n.l}:${n.i}`) && visited.has(`${m.l}:${m.i}`);
      html += `<line class="edge ${done ? 'done' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    }
    for (const row of run.map) for (const n of row) {
      const [x, y] = pos(n), key = `${n.l}:${n.i}`, cur = run.layer === n.l && run.node === n.i;
      const cls = ['node', n.type, avail.has(n) ? 'avail' : '', visited.has(key) ? 'visited' : '', cur ? 'cur' : ''].join(' ');
      html += `<g class="${cls}" data-key="${key}" transform="translate(${x},${y})"><circle r="${n.type === 'boss' ? 24 : 18}"/><text>${Run.NODE[n.type].icon}</text></g>`;
    }
    svg.innerHTML = html;
    svg.querySelectorAll('.node').forEach(g => {
      const [l, i] = g.dataset.key.split(':').map(Number), n = run.map[l][i];
      g.onmouseenter = () => {
        const tip = $('nodetip'), b = g.getBoundingClientRect(), wb = svg.parentElement.getBoundingClientRect();
        let txt = `<b>${Run.NODE[n.type].name}</b> — ${Run.NODE[n.type].desc}`;
        if (['skirmish', 'elite', 'boss'].includes(n.type)) { const e = Run.encounter(run, n); txt += `<br>${esc(e.guild.name)}: ${e.summary}`; }
        tip.innerHTML = txt; tip.style.display = 'block';
        tip.style.left = `${b.left - wb.left + b.width / 2 - tip.offsetWidth / 2}px`; tip.style.top = `${b.top - wb.top - tip.offsetHeight - 6}px`;
      };
      g.onmouseleave = () => { $('nodetip').style.display = 'none'; };
      if (avail.has(n)) g.onclick = () => { $('nodetip').style.display = 'none'; this.enter(n); };
    });
    show('map');
  }

  enter(node) {
    const run = this.run;
    Run.travel(run, node);
    (run.visited ||= []).push(`${node.l}:${node.i}`);
    run.inBattle = node.type !== 'camp' && node.type !== 'cache';
    Run.save(run);
    if (node.type === 'camp') this.showCamp();
    else if (node.type === 'cache') this.showLoot(false, 'Supply cache', 'An abandoned mercenary stash. Take one.');
    else this.startBattle(node);
  }

  // -------------------------------------------------------------- loot / camp / end
  showLoot(rich, title = 'Spoils of battle', sub = 'The rival squad left gear behind. Choose one.') {
    const run = this.run, offers = Run.lootOffers(run, rich);
    $('loottitle').textContent = title; $('lootsub').textContent = sub;
    const box = $('lootcards'); box.innerHTML = '';
    for (const o of offers) {
      const d = Run.describeOffer(run, o), el = document.createElement('button');
      el.className = 'card';
      el.innerHTML = `<b class="t">${esc(d.title)}</b><span class="sub">${esc(d.sub)}</span><div class="stats">${esc(d.desc)}</div>`;
      el.onclick = () => { Run.applyOffer(run, o); Run.save(run); this.showMap(); };
      box.appendChild(el);
    }
    show('loot');
  }

  showCamp() { this.view.showCamp(this.run.party); this.renderCamp(); show('camp'); }

  renderCamp(rebuild = false) {
    const run = this.run;
    if (rebuild) this.view.showCamp(run.party);
    $('campres').textContent = `Supplies ${run.supplies} · Potions ${run.potions}`;
    $('btn-rest').disabled = run.rested;
    const list = $('camplist'); list.innerHTML = '';
    run.party.forEach(h => {
      const d = document.createElement('div');
      d.innerHTML = heroCard(h, h.alive
        ? `<button class="btn" ${Run.canMug(run, h) ? '' : 'disabled'}>Share a mug (${Run.MUG_COST} supplies, +60%)</button>`
        : `<button class="btn" ${Run.canRevive(run, h) ? '' : 'disabled'}>Use potion: revive</button>`);
      d.querySelector('button').onclick = () => {
        if (h.alive) Run.mug(run, h); else { Run.revive(run, h); this.renderCamp(true); return; }
        this.renderCamp();
      };
      list.appendChild(d.firstElementChild);
    });
  }

  showEnd(win) {
    const run = this.run;
    Run.clearSave();
    $('endtitle').textContent = win ? 'The Hollow Crown is broken!' : 'Your party has fallen';
    $('endtext').textContent = `Battles won: ${run.won} · Foes defeated: ${run.kills} · Reached stage ${run.layer + 1} of ${Run.LAYERS + 1}.`;
    this.view.clearUnits(); this.view.setHighlights([]);
    show('end');
  }

  // -------------------------------------------------------------- battle
  startBattle(node) {
    const run = this.run, enc = Run.encounter(run, node);
    const { grid, pSpawn, eSpawn } = generateMap(enc.seed, enc.depth);
    const units = [];
    run.party.filter(h => h.alive).forEach((h, i) => { const u = makeUnit(h, 'player'); [u.x, u.y] = pSpawn[i]; units.push(u); });
    enc.heroes.forEach((h, i) => {
      const u = makeUnit(h, 'enemy', { hpMult: enc.hpMult, dmgBonus: enc.dmgBonus, tint: enc.guild.tint, elite: enc.elite });
      [u.x, u.y] = eSpawn[i]; units.push(u);
    });
    const v = this.view;
    v.clearCamp(); v.clearUnits(); v.buildBoard(grid); v.battleCamera();
    units.forEach(u => v.addUnit(u));
    $('log').innerHTML = '';
    $('vs').textContent = `vs. ${enc.guild.name} — ${enc.summary}`;
    show('battle');
    this.battle = new Battle({ grid, units, view: v, seed: enc.seed });
    this.ctl = new BattleController(v, this.battle, { enemyName: enc.guild.name, onFinish: () => this.finishBattle(this.battle, enc) });
  }

  async finishBattle(battle, enc) {
    if (battle.finished) return;
    battle.finished = true;
    await this.view.wait(1.2);
    this.ctl.dispose(); this.ctl = null;
    this.run.inBattle = false;
    if (battle.result === 'win') {
      Run.afterBattle(this.run, battle.units, enc);
      Run.save(this.run);
      if (enc.boss) return this.showEnd(true);
      await this.view.banner('Victory!');
      this.showLoot(enc.elite);
    } else {
      for (const u of battle.units) if (u.side === 'player') { u.hero.alive = false; u.hero.hp = 0; }
      await this.view.banner('Defeat');
      this.showEnd(false);
    }
  }

  // -------------------------------------------------------------- versus modes (vs AI, hot-seat, online)
  skirmishDraft() {
    this.showDraft({ title: 'Skirmish vs AI: draft your squad', begin: 'Fight! ⚔️', difficulty: true, preset: store.get('wwt-squad', null),
      onBegin: list => { store.set('wwt-squad', list); this.startVersus({ mode: 'ai', parties: { player: list, enemy: this.aiSquad() }, diff: this.diff }); } });
  }

  aiSquad() {
    const r = rng(Math.floor(Math.random() * 1e9)), pool = [...CLASS_KEYS], out = [];
    while (out.length < 4) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    return out;
  }

  localDraft() {
    this.showDraft({ title: '🟦 Player 1: draft your squad', begin: 'Next: Player 2 ▶',
      onBegin: p1 => this.showDraft({ title: '🟥 Player 2: draft your squad', begin: 'Start the duel ⚔️', back: () => this.localDraft(),
        onBegin: p2 => this.startVersus({ mode: 'local', parties: { player: p1, enemy: p2 }, names: { player: 'Player 1', enemy: 'Player 2' } }) }) });
  }

  /** Build the board and controller for a one-off battle. cfg: { mode, parties, seed?, diff?, names?, mySide? } */
  startVersus(cfg) {
    this.ctl?.dispose(); this.ctl = null;
    const seed = cfg.seed ?? Math.floor(Math.random() * 1e9);
    this.vs = { ...cfg, seed };
    const ai = cfg.mode === 'ai', pvp = !ai, mySide = cfg.mySide || 'player';
    const guild = GUILDS[seed % GUILDS.length], diff = DIFF[cfg.diff || 'normal'];
    const { grid, pSpawn, eSpawn } = generateMap(seed, 1);
    const units = [];
    cfg.parties.player.forEach((cls, i) => { const u = makeUnit({ cls, gear: [] }, 'player'); [u.x, u.y] = pSpawn[i]; units.push(u); });
    cfg.parties.enemy.forEach((cls, i) => {
      const u = makeUnit({ cls, gear: [] }, 'enemy', ai ? { hpMult: diff.hpMult, dmgBonus: diff.dmgBonus, tint: guild.tint } : {});
      [u.x, u.y] = eSpawn[i]; units.push(u);
    });
    const names = ai ? { player: 'You', enemy: guild.name } : cfg.names;
    this.vs.names = names;
    const v = this.view;
    v.mySide = mySide;
    v.clearCamp(); v.clearUnits(); v.buildBoard(grid); v.battleCamera(mySide);
    units.forEach(u => v.addUnit(u));
    $('log').innerHTML = '';
    $('vs').textContent = ai ? `Skirmish vs ${guild.name} (${diff.name})` : `🟦 ${names[mySide]}${cfg.mode === 'online' ? ' (you)' : ''} vs 🟥 ${names[mySide === 'player' ? 'enemy' : 'player']}`;
    $('btn-quit').classList.remove('hidden');
    show('battle');
    const battle = this.battle = new Battle({ grid, units, view: v, seed, pvp, consumables: pvp ? { player: { potion: 1 }, enemy: { potion: 1 } } : { potion: 1 } });
    const online = cfg.mode === 'online';
    this.ctl = new BattleController(v, battle, {
      enemyName: names.enemy, names,
      localSides: cfg.mode === 'local' ? ['player', 'enemy'] : [mySide],
      onFinish: () => this.finishVersus(battle),
      onCommand: online ? (cmd, seq) => this.match?.sendCommand(cmd, seq) : null,
      onTurn: cfg.mode === 'local' ? side => this.curtain(side) : null,
    });
    if (online) this.match.attach({ logLength: () => battle.actions.length, log: () => battle.actions });
    this.turnKey = null;
    clearInterval(this.ticker);
    this.ticker = setInterval(() => this.tick(), 250);
    this.tick();
  }

  /** Hot-seat: hide the board until the next player is ready, then turn the camera to their side. */
  curtain(side) {
    this.view.mySide = side;
    this.view.battleCamera(side, true);
    const other = side === 'player' ? 'enemy' : 'player';
    $('vs').textContent = `🟦 ${this.vs.names[side]} (your heroes) vs 🟥 ${this.vs.names[other]}`;
    $('cside').textContent = side === 'player' ? '①' : '②';
    $('ctitle').textContent = `${this.vs.names[side]}'s turn`;
    $('curtain').classList.remove('hidden');
    return new Promise(res => { $('btn-ready').onclick = () => { $('curtain').classList.add('hidden'); res(); }; });
  }

  /** Online turn clock + opponent connection status. */
  tick() {
    const b = this.battle, el = $('turntimer');
    if (!this.vs || !b || b.over || this.vs.mode !== 'online') { el.textContent = ''; return; }
    const key = `${b.round}:${b.phase}`;
    if (key !== this.turnKey) { this.turnKey = key; this.turnStart = Date.now(); }
    const left = Math.max(0, TURN_SECONDS - Math.floor((Date.now() - this.turnStart) / 1000));
    const mine = this.ctl?.myTurn();
    el.textContent = `${mine ? 'Your turn' : 'Their turn'} ⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    el.classList.toggle('low', left <= 15);
    if (mine && left === 0 && !this.ctl.busy) { this.ctl.flashHint('Time is up: your turn ended.'); this.ctl.endTurn(); }
    if (this.awayUntil) {
      const s = Math.ceil((this.awayUntil - Date.now()) / 1000);
      if (s <= 0) { this.awayUntil = null; this.forfeit('Your opponent did not come back.'); }
      else $('netbar').textContent = `⚠️ ${this.vs.names[this.foe()]} disconnected. Waiting ${s}s for them to return…`;
    }
  }

  foe() { return this.vs.mySide === 'player' ? 'enemy' : 'player'; }

  /** The opponent left (or, with won = false, they claimed it from us): the battle ends by forfeit. */
  forfeit(why, won = true) {
    const b = this.battle;
    if (!b || b.over) return;
    b.over = true; b.phase = 'over';
    b.result = (this.vs.mySide === 'player') === won ? 'win' : 'lose';
    this.forfeitNote = `${why} ${won ? 'You win' : 'You lose'} by forfeit.`;
    if (won && this.vs.mode === 'online') this.match?.claim(why); // so their screen ends too when they return
    this.ctl.refresh();
    this.finishVersus(b);
  }

  async finishVersus(battle) {
    if (battle.finished) return;
    battle.finished = true;
    clearInterval(this.ticker);
    $('netbar').classList.add('hidden'); this.awayUntil = null;
    await this.view.wait(1.2);
    this.ctl?.dispose(); this.ctl = null;
    const vs = this.vs, winSide = battle.result === 'win' ? 'player' : 'enemy';
    const survivors = battle.units.filter(u => u.alive && u.side === winSide).length;
    let title, text;
    if (vs.mode === 'local') { title = `${vs.names[winSide]} wins!`; text = `${survivors} hero${survivors === 1 ? '' : 's'} left standing after ${battle.round} rounds.`; }
    else {
      const won = winSide === (vs.mySide || 'player');
      title = won ? 'Victory!' : 'Defeat';
      text = vs.mode === 'ai' ? `${won ? 'You beat' : 'You fell to'} ${vs.names?.enemy || 'the AI squad'} on ${DIFF[vs.diff || 'normal'].name} in ${battle.round} rounds.`
        : `${won ? 'You beat' : 'You lost to'} ${vs.names[this.foe()]} in ${battle.round} rounds.`;
      if (this.forfeitNote) text = this.forfeitNote;
      if (this.voidNote) { title = 'Match void'; text = this.voidNote; }
    }
    this.forfeitNote = this.voidNote = null;
    await this.view.banner(title);
    $('restitle').textContent = title; $('restext').textContent = text; $('resnote').textContent = '';
    $('btn-rematch').disabled = vs.mode === 'online' && !this.match?.present;
    show('result');
  }

  bindVersus() {
    $('btn-quit').onclick = () => {
      if (!confirm(this.vs?.mode === 'online' ? 'Leave the match? Your opponent wins.' : 'Leave this battle?')) return;
      this.leaveVersus(); this.showTitle();
    };
    $('btn-rematch').onclick = () => {
      const vs = this.vs;
      if (vs.mode === 'online') { this.match.requestRematch(); $('resnote').textContent = '⏳ Waiting for your opponent to accept the rematch…'; $('btn-rematch').disabled = true; return; }
      this.startVersus({ ...vs, seed: undefined, parties: vs.mode === 'ai' ? { player: vs.parties.player, enemy: this.aiSquad() } : vs.parties });
    };
    $('btn-resquads').onclick = () => {
      const mode = this.vs.mode; this.leaveVersus();
      if (mode === 'ai') this.skirmishDraft(); else if (mode === 'local') this.localDraft(); else this.onlineDraft();
    };
    $('btn-resmenu').onclick = () => { this.leaveVersus(); this.showTitle(); };

    // online lobby
    $('netname').value = store.get('wwt-name', '');
    $('netname').onchange = () => store.set('wwt-name', $('netname').value.trim().slice(0, 16));
    $('joincode').oninput = () => { $('joincode').value = cleanCode($('joincode').value); };
    $('joincode').onkeydown = e => { if (e.key === 'Enter') $('btn-join').click(); };
    $('btn-onlineback').onclick = () => { this.leaveVersus(); this.showTitle(); };
    $('netchange').onclick = e => { e.preventDefault(); this.onlineDraft(); };
    $('btn-quickmatch').onclick = () => this.lobby(m => m.quickMatch());
    $('btn-host').onclick = () => this.lobby(async m => {
      const code = await m.host();
      $('roomcode').textContent = code; $('roomcode').classList.remove('hidden'); $('btn-copycode').classList.remove('hidden');
    });
    $('btn-join').onclick = () => {
      const code = cleanCode($('joincode').value);
      if (code.length !== 4) { $('neterror').textContent = 'Enter the 4-letter room code your friend sees.'; return; }
      this.lobby(m => m.join(code));
    };
    $('btn-copycode').onclick = () => {
      const q = new URLSearchParams(location.search); q.set('join', $('roomcode').textContent);
      const link = `${location.origin}${location.pathname}?${q}`;
      navigator.clipboard?.writeText(link).then(() => { $('btn-copycode').textContent = '✅ Link copied'; }, () => prompt('Copy this link:', link));
    };
    $('btn-netcancel').onclick = () => { this.match?.close(); this.match = null; this.lobbyUi(false); };
    addEventListener('beforeunload', () => this.match?.close());
  }

  onlineDraft() {
    this.showDraft({ title: 'Online Duel: pick your squad', begin: 'Choose this squad ▶', preset: store.get('wwt-squad', null), back: () => this.openOnline(),
      onBegin: list => { store.set('wwt-squad', list); this.openOnline(); } });
  }

  openOnline(code = '') {
    if (!this.transport) { alert('Online play is not configured: add the Supabase URL and publishable key to arena/config.js.'); return; }
    this.leaveVersus();
    $('netparty').textContent = squadNames(store.get('wwt-squad', RECOMMENDED));
    if (code) $('joincode').value = cleanCode(code);
    $('neterror').textContent = '';
    this.lobbyUi(false);
    show('online');
  }

  lobbyUi(waiting, status = '') {
    $('lobbymenu').classList.toggle('hidden', waiting);
    $('lobbywait').classList.toggle('hidden', !waiting);
    $('netstatus').innerHTML = status;
    if (!waiting) { $('roomcode').classList.add('hidden'); $('btn-copycode').classList.add('hidden'); $('btn-copycode').textContent = '📋 Copy invite link'; }
  }

  /** Open a match and run one lobby action (quick match / host / join). */
  async lobby(action) {
    const name = $('netname').value.trim().slice(0, 16) || 'Wanderer';
    store.set('wwt-name', name);
    this.match?.close();
    const m = this.match = new OnlineMatch(this.transport, { name, party: store.get('wwt-squad', RECOMMENDED) });
    $('neterror').textContent = '';
    this.lobbyUi(true, 'Connecting…');
    m.onStatus = html => { if (this.match === m) $('netstatus').innerHTML = html; };
    m.onStart = setup => {
      if (this.match !== m) return;
      // the squads come from the other browser: only known hero classes, one to four of them
      const okParty = q => Array.isArray(q) && q.length >= 1 && q.length <= 4 && q.every(c => CLASS_KEYS.includes(c));
      if (!okParty(setup.parties?.player) || !okParty(setup.parties?.enemy)) {
        m.close(); this.match = null; this.lobbyUi(false); $('neterror').textContent = '⚠️ The other player sent an invalid squad.'; return;
      }
      $('netbar').classList.add('hidden'); this.awayUntil = null;
      this.startVersus({ mode: 'online', seed: setup.seed, parties: setup.parties, names: setup.names, mySide: setup.mySide });
    };
    m.onCommand = cmd => this.ctl?.applyRemote(cmd).then(ok => { if (!ok && this.battle && !this.battle.over) this.desync(); }, () => this.desync());
    m.onClaim = () => { if (this.match === m) this.forfeit('You were away too long: your opponent claimed the win.', false); };
    m.onConnection = st => { if (this.match === m && this.battle && !this.battle.over) this.ctl?.flashHint(st === 'down' ? '⚠️ Lost the connection to the online service. Reconnecting…' : 'Reconnected.'); };
    m.onOpponent = present => {
      if (!this.battle || this.battle.over || this.vs?.mode !== 'online') return;
      if (present) { this.awayUntil = null; $('netbar').classList.add('hidden'); this.ctl?.flashHint('Your opponent is back.'); }
      else { this.awayUntil = Date.now() + RETURN_SECONDS * 1000; $('netbar').classList.remove('hidden'); }
    };
    m.onLeft = () => {
      if (this.battle && !this.battle.over && this.vs?.mode === 'online') this.forfeit('Your opponent left the match.');
      else { $('resnote').textContent = 'Your opponent has left.'; $('btn-rematch').disabled = true; }
    };
    m.onRematch = () => { $('resnote').textContent = '🔁 Your opponent wants a rematch! Press Rematch to accept.'; };
    try { await action(m); }
    catch (e) {
      if (this.match !== m) return;
      m.close(); this.match = null; this.lobbyUi(false);
      $('neterror').textContent = `⚠️ ${e.message}${this.transport.kind === 'supabase' && !/room/i.test(e.message) ? ' (Supabase Realtime must be enabled for the project.)' : ''}`;
    }
  }

  /** The two browsers disagree about the game (a rejected command): end it without a winner. */
  desync() {
    const b = this.battle;
    if (!b || b.over) return;
    b.over = true; b.phase = 'over'; b.result = 'lose';
    this.voidNote = 'The two screens stopped agreeing about the game (desync). Start a rematch.';
    this.ctl?.refresh(); this.finishVersus(b);
  }

  leaveVersus() {
    clearInterval(this.ticker); this.awayUntil = null;
    $('netbar').classList.add('hidden'); $('curtain').classList.add('hidden'); $('turntimer').textContent = '';
    this.ctl?.dispose(); this.ctl = null;
    if (this.battle) this.battle.finished = true;
    this.match?.close(); this.match = null;
    this.vs = null; this.view.mySide = 'player';
  }
}

// ------------------------------------------------------------------ boot
const assets = await loadAssets({ base: '../', props: PROPS, forest: FOREST, onProgress: (d, n) => { $('loadtxt').textContent = `Gathering the guilds… ${Math.round(d / n * 100)}%`; } });
const view = new View($('c'), assets);
bindHelp();
const app = new App(view);
window.app = app; // for debugging and automated tests
app.showTitle();
const joinCode = new URLSearchParams(location.search).get('join');
if (joinCode) app.openOnline(joinCode);
