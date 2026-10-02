import { loadAssets, PROPS as BASE_PROPS } from '../../src/assets.js';
import { CLASSES, CLASS_KEYS, ABIL, ITEMS, TILE, T, maxHpOf } from './data.js';
import { generateMap, pathTo, dist } from './grid.js';
import { Battle, makeUnit } from './battle.js';
import { View } from './view.js';
import { BattleController } from './controller.js';
import * as Run from './run.js';

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

class App {
  constructor(view) {
    this.view = view; this.run = null; this.draft = [];
    $('btn-new').onclick = () => this.showDraft();
    $('btn-continue').onclick = () => { this.run = Run.load(); this.showMap(); };
    $('btn-begin').onclick = () => { this.run = Run.newRun(this.draft); Run.save(this.run); this.showMap(); };
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
    show('title');
  }

  showDraft() {
    this.draft = [];
    const box = $('draftcards'); box.innerHTML = '';
    for (const k of CLASS_KEYS) {
      const c = CLASSES[k], el = document.createElement('button');
      el.className = 'card';
      el.innerHTML = `<b class="t">${c.name}</b><span class="sub">${c.role}</span>
        <div class="stats">❤ ${c.hp} HP · ➜ ${c.move} move${c.armor ? ` · ⛨ ${c.armor} armor` : ''}</div>
        <ul>${c.abilities.map(a => `<li><b>${ABIL[a].name}</b>: ${ABIL[a].desc}</li>`).join('')}</ul>
        <div class="pas">${c.passive}</div>`;
      el.onclick = () => {
        const i = this.draft.indexOf(k);
        if (i >= 0) this.draft.splice(i, 1); else if (this.draft.length < 4) this.draft.push(k);
        box.querySelectorAll('.card').forEach((b, j) => b.classList.toggle('sel', this.draft.includes(CLASS_KEYS[j])));
        $('draftcount').textContent = `${this.draft.length} / 4`;
        $('btn-begin').disabled = this.draft.length !== 4;
      };
      box.appendChild(el);
    }
    $('draftcount').textContent = '0 / 4'; $('btn-begin').disabled = true;
    show('draft');
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
}

// ------------------------------------------------------------------ boot
const assets = await loadAssets({ base: '../', props: PROPS, forest: FOREST, onProgress: (d, n) => { $('loadtxt').textContent = `Gathering the guilds… ${Math.round(d / n * 100)}%`; } });
const view = new View($('c'), assets);
const app = new App(view);
window.app = app; // for debugging and automated tests
app.showTitle();
