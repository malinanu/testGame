// HUD for Wildwood Colony: top resource bar, build menu (with rendered thumbnails), inspector,
// objective, notifications, minimap and tooltips. Reads the Colony; actions go through `game`.
import * as THREE from 'three';
import { GOODS, GOOD_KEYS, TIERS, BUILDINGS, CATEGORIES, RELICS, LAIR_KINDS, W, H, FESTIVAL, EXPEDITION, HIST_EVERY } from './data.js';
import { T, idx } from './map.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const costHtml = (cost, c) => Object.entries(cost).map(([k, v]) => {
  const have = k === 'gold' ? c.gold : c.stock[k] || 0, ok = have >= v;
  return `<span style="${ok ? '' : 'color:#b0321e'}">${k === 'gold' ? '💰' : GOODS[k].icon}${v}</span>`;
}).join(' ');
const fmt = n => Math.abs(n) >= 10000 ? (n / 1000).toFixed(0) + 'k' : Math.round(n).toLocaleString();
const SHOWN_GOODS = ['logs', 'planks', 'stone', 'bricks', 'food', 'grain', 'bread', 'flax', 'textiles', 'ale', 'charcoal', 'ore', 'iron', 'tools', 'goldore', 'jewelry', 'maps'];

/** Render a small preview image of every building type. */
/**
 * Building thumbnails for the build menu, rendered once with the game's own renderer (a second WebGL
 * context would compile every shader again): each model is drawn into the corner of the main canvas and
 * copied out in the same task, before the browser can clear the drawing buffer.
 */
export function renderThumbs(kit, r) {
  const size = 152, h = Math.round(size * 0.76), pr = r.getPixelRatio();
  const cv = document.createElement('canvas'); cv.width = size; cv.height = h; const ctx = cv.getContext('2d');
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8ab878);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a6a3a, 1.6));
  const sun = new THREE.DirectionalLight(0xfff1d0, 2.4); sun.position.set(5, 9, 7); scene.add(sun);
  const cam = new THREE.PerspectiveCamera(30, size / h, 0.1, 200), out = {};
  const vp = r.getViewport(new THREE.Vector4());
  r.setViewport(0, 0, size, h); r.setScissor(0, 0, size, h); r.setScissorTest(true);
  for (const type of Object.keys(BUILDINGS)) {
    if (type === 'road') continue;
    const g = kit.model(type); scene.add(g); // also warms the bake cache the world uses
    const box = new THREE.Box3().setFromObject(g), sz = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const d = Math.max(sz.x, sz.y * 1.2, sz.z) * 1.9;
    cam.position.set(c.x + d * 0.6, c.y + d * 0.55, c.z + d * 0.75); cam.lookAt(c.x, c.y * 0.8, c.z);
    r.render(scene, cam);
    ctx.drawImage(r.domElement, 0, r.domElement.height - h * pr, size * pr, h * pr, 0, 0, size, h);
    out[type] = cv.toDataURL('image/webp', 0.8);
    scene.remove(g);
  }
  r.setScissorTest(false); r.setViewport(vp);
  return out;
}

export class UI {
  constructor(game) {
    this.g = game; this.cat = 'production'; this.feedItems = [];
    this.minimapBase = null; this.tipEl = $('tip');
    this.ac = new AbortController(); // a new UI is made per game: its window/document listeners go with it
    const opt = { signal: this.ac.signal };
    $('q-min').onclick = () => $('quest').classList.toggle('min');
    document.querySelectorAll('#speed button').forEach(b => { b.onclick = () => game.setSpeed(+b.dataset.s); });
    this.bindTips(opt);
    const mm = $('minimap');
    const jump = e => { const r = mm.getBoundingClientRect(); game.focusTile((e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H); };
    mm.addEventListener('pointerdown', e => { jump(e); mm.onpointermove = jump; }, opt);
    addEventListener('pointerup', () => { mm.onpointermove = null; }, opt);
  }
  dispose() { this.ac.abort(); }

  get c() { return this.g.colony; }

  // ------------------------------------------------------------------ tooltips
  bindTips(opt) {
    document.addEventListener('pointermove', e => {
      const el = e.target.closest?.('[data-tip]');
      if (!el) { if (this.tipOwner) { this.tipOwner = null; this.tip(null); } return; }
      this.tipOwner = el; this.tip(this.tipHtml(el.dataset.tip, el), e);
    }, opt);
  }
  tip(html, e) {
    const t = this.tipEl;
    if (!html) { t.style.display = 'none'; return; }
    t.innerHTML = html; t.style.display = 'block';
    const x = Math.min(innerWidth - t.offsetWidth - 8, e.clientX + 14), y = Math.min(innerHeight - t.offsetHeight - 8, Math.max(8, e.clientY + 16));
    t.style.left = x + 'px'; t.style.top = y + 'px';
  }
  tipHtml(kind, el) {
    const c = this.c;
    if (kind === 'gold') return `<b>💰 Gold</b><br>Taxes <span style="color:#2a6a20">+${c.stats.income.toFixed(0)}</span>/min · Upkeep <span style="color:#a02a1a">−${c.stats.upkeep.toFixed(0)}</span>/min${c.grant ? '<br><b style="color:#2a6a20">🎁 Founding grant: upkeep halved until 40 residents</b>' : ''}<br><span class="dim">Keep the balance positive. Happy residents pay more tax. Idle workshops cost half upkeep.</span>`;
    if (kind === 'pop') return `<b>Population ${Math.floor(c.pop.total)}</b><br>` + TIERS.map((t, i) => `${t.icon} ${t.name}: ${Math.floor(c.pop[t.id])} · workers needed ${c.work.demand[i]}${c.work.factor[i] < 1 ? ' ⚠️ shortage' : ''}${c.tierUnlocked(i) ? '' : ' (locked)'}`).join('<br>');
    if (kind === 'relics') return `<b>Relics ${c.relics.length}/5</b><br>` + RELICS.map(r => `${c.relics.includes(r.id) ? '✅' : c.hero.carry === r.id ? '🎒' : '❔'} ${r.icon} ${r.name}<br><span class="dim">${r.boon}</span>`).join('<br>');
    if (kind === 'clock') return `<b>Day ${Math.floor(c.time / 240) + 1}</b> · ${c.night ? 'Night: raids come in the dark' : 'Day'}`;
    if (kind.startsWith('good:')) { const g = kind.slice(5), d = GOODS[g]; return `<b>${d.icon} ${d.name}: ${Math.floor(c.stock[g] || 0)}</b> / ${c.cap}<br><span class="dim">Storage grows with Warehouses.</span>`; }
    if (kind.startsWith('b:')) return this.buildingTip(kind.slice(2));
    if (kind.startsWith('need:')) return el.dataset.desc;
    return '';
  }
  buildingTip(type) {
    const d = BUILDINGS[type], c = this.c;
    let h = `<b>${d.name}</b><br><span class="dim">${d.desc || ''}</span><br>Cost: ${costHtml(d.cost || {}, c)}`;
    if (d.upkeep) h += ` · Upkeep 💰${d.upkeep}/min`;
    if (d.workers) h += `<br>Workers: ${d.workers.n} ${TIERS[d.workers.tier].icon} ${TIERS[d.workers.tier].name}`;
    if (d.cycle && (d.in || Object.keys(d.out || {}).length)) h += `<br>${Object.entries(d.in || {}).map(([g, n]) => `${n}${GOODS[g].icon}`).join(' + ') || '🌲'} → ${Object.entries(d.out || {}).map(([g, n]) => `${n}${GOODS[g].icon} ${GOODS[g].name}`).join(', ') || 'new trees'} every ${d.cycle}s`;
    if (d.range) h += `<br>Range ${d.range} tiles`;
    const err = c.placeError(type, -99, -99);
    const lock = d.tier && !c.tierUnlocked(d.tier) ? `Requires ${TIERS[d.tier].name}` : d.relics && c.relics.length < d.relics ? `Requires ${d.relics} relics` : '';
    if (lock) h += `<br><b style="color:#a02a1a">🔒 ${lock}</b>`;
    void err;
    return h;
  }

  // ------------------------------------------------------------------ top bar
  renderTop() {
    const c = this.c, bal = c.stats.income - c.stats.upkeep;
    $('gold').textContent = fmt(c.gold);
    const b = $('balance'); b.textContent = `${bal >= 0 ? '+' : ''}${bal.toFixed(0)}/min`; b.className = bal >= 0 ? 'pos' : 'neg';
    $('t-gold').classList.toggle('neg', c.gold < 0);
    $('t-pop').innerHTML = TIERS.map((t, i) => `<span class="pt ${c.tierUnlocked(i) ? '' : 'lock'}">${t.icon}${Math.floor(c.pop[t.id])}${c.work.factor[i] < 1 ? '⚠️' : ''}</span>`).join('');
    if (!this.goodEls) {
      $('goods').innerHTML = SHOWN_GOODS.map(g => `<div class="good" data-tip="good:${g}" id="g-${g}">${GOODS[g].icon}<span></span></div>`).join('');
      this.goodEls = Object.fromEntries(SHOWN_GOODS.map(g => [g, $('g-' + g)]));
    }
    for (const g of SHOWN_GOODS) {
      const n = Math.floor(c.stock[g] || 0), el = this.goodEls[g];
      el.lastChild.textContent = n; el.classList.toggle('zero', n === 0); el.classList.toggle('low', n > 0 && n < 4);
    }
    $('relicbar').innerHTML = RELICS.map(r => `<span class="${c.relics.includes(r.id) ? 'have' : c.hero.carry === r.id ? 'carry' : ''}">${r.icon}</span>`).join('');
    const d = c.day; $('clock').textContent = c.night ? '🌙' : d < 0.08 ? '🌅' : d > 0.55 ? '🌇' : '☀️';
    $('mapcount').textContent = Math.floor(c.stock.maps || 0);
    const q = c.quest;
    $('q-text').textContent = q ? q.text : 'All objectives complete. Your colony is yours to grow!';
    $('q-reward').textContent = q && Object.keys(q.reward).length ? `Reward: ${c.lootText(q.reward)}` : '';
  }

  // ------------------------------------------------------------------ build menu
  renderBuild() {
    const c = this.c, g = this.g;
    // rebuilt only when something visible changed (the thumbnails are big data: URLs to re-decode)
    const cats = CATEGORIES.filter(k => k.id !== 'roads').map(k => `<button data-cat="${k.id}" class="${this.cat === k.id ? 'on' : ''}">${k.icon} ${k.name}</button>`).join('');
    if (cats !== this.catsHtml) {
      this.catsHtml = cats; $('cats').innerHTML = cats;
      $('cats').querySelectorAll('button').forEach(b => { b.onclick = () => { this.cat = b.dataset.cat; this.renderBuild(); }; });
    }
    const types = Object.keys(BUILDINGS).filter(t => BUILDINGS[t].cat === this.cat && BUILDINGS[t].buildable !== false);
    const cards = types.map(t => {
      const d = BUILDINGS[t], locked = (d.tier && !c.tierUnlocked(d.tier)) || (d.relics && c.relics.length < d.relics);
      const poor = !c.affordable(d.cost || {});
      return `<div class="bcard ${locked ? 'locked' : ''} ${poor ? 'poor' : ''} ${g.mode === 'build' && g.buildType === t ? 'on' : ''}" data-type="${t}" data-tip="b:${t}">
        ${locked ? '<span class="lk">🔒</span>' : ''}<img src="${g.thumbs[t] || ''}" alt=""><b>${d.name}</b><div class="cost">${costHtml(d.cost || {}, c)}</div></div>`;
    }).join('');
    if (cards === this.cardsHtml) return;
    this.cardsHtml = cards; $('cards').innerHTML = cards;
    $('cards').querySelectorAll('.bcard').forEach(el => { el.onclick = () => g.startBuild(el.dataset.type); });
  }

  // ------------------------------------------------------------------ inspector
  renderInspector() {
    const g = this.g, c = this.c, box = $('inspector');
    const sel = g.selected;
    if (!sel) { box.classList.add('hidden'); this.inspHtml = ''; return; }
    box.classList.remove('hidden');
    let h = '';
    if (sel.kind === 'building') {
      const b = c.buildings.get(sel.id);
      if (!b) { g.selected = null; box.classList.add('hidden'); return; }
      const d = BUILDINGS[b.type];
      h += `<h3>${esc(d.name)}<button data-act="close">✕</button></h3><p class="desc">${esc(d.desc || '')}</p>`;
      if (b.fire) h += `<div class="status bad">🔥 On fire! It burns down in ${Math.ceil(b.fire)}s.</div>`;
      else if (b.ruined) h += `<div class="status bad">🏚️ Burned down. Rebuild it to use it again.</div>`;
      else if (!b.connected && !d.storage) h += `<div class="status bad">⚠️ No road to the Town Hall or a Warehouse within range.</div>`;
      if (b.tier != null) h += this.residenceHtml(b);
      else if (d.cycle) h += this.productionHtml(b, d);
      else h += this.publicHtml(b, d);
      const repair = c.repairCost(b);
      h += `<div class="ibtns">`;
      if (repair) h += `<button class="btn good" data-act="repair">${b.fire ? '🪣 Extinguish' : '🔨 Rebuild'} (${costHtml(repair, c)})</button>`;
      if (d.cycle) h += `<button class="btn" data-act="pause">${b.paused ? '▶ Resume' : '⏸ Pause'}</button>`;
      const copyType = b.tier != null ? 'hut' : b.type;
      if (BUILDINGS[copyType].buildable !== false && !BUILDINGS[copyType].unique) h += `<button class="btn" data-act="copy" data-type="${copyType}" title="Build another (C)">➕ Build another</button>`;
      if (b.type !== 'townhall' && b.type !== 'sanctum') h += `<button class="btn bad" data-act="demolish">💥 Demolish</button>`;
      h += `</div>`;
    } else if (sel.kind === 'lair') {
      const l = c.lairs.find(q => q.id === sel.id);
      if (!l) { g.selected = null; box.classList.add('hidden'); return; }
      const k = LAIR_KINDS[l.kind];
      h += `<h3>${l.relic && !l.relicTaken ? '💎' : '☠️'} ${k.name}<button data-act="close">✕</button></h3>`;
      h += l.cleared ? `<div class="status ok">Cleared.${l.relic && !l.relicTaken ? ' The relic waits for your Founder to pick it up.' : ''}</div>` : `<div class="status warn">Guarded by ${k.guards.length} creatures. Only your Founder can clear it.</div>`;
      if (l.relic) { const r = RELICS.find(q => q.id === l.relic); h += `<p class="desc"><b>${r.icon} ${r.name}</b>: ${r.boon}</p>`; }
      h += `<p class="desc">Loot: ${c.lootText(k.loot)}</p><div class="ibtns"><button class="btn good" data-act="hero">⚔️ Send the Founder (H)</button></div>`;
    } else if (sel.kind === 'deposit') {
      const d = c.deposits.find(q => q.id === sel.id);
      if (!d) { g.selected = null; box.classList.add('hidden'); return; }
      h += `<h3>${d.kind === 'iron' ? '⛏️ Iron' : '🟡 Gold'} deposit<button data-act="close">✕</button></h3><p class="desc">Build ${d.kind === 'iron' ? 'an Iron Mine' : 'a Gold Mine'} exactly on it. It must be inside your territory: build an Outpost nearby if it is not.</p>`;
    }
    if (h === this.inspHtml) return; // unchanged: keep the DOM (and a button mid-click) as it is
    this.inspHtml = h; box.innerHTML = h;
    box.querySelectorAll('[data-act]').forEach(el => { el.onclick = () => g.inspectorAction(el.dataset.act, el.dataset); });
  }
  residenceHtml(b) {
    const c = this.c, tier = TIERS[b.tier], next = TIERS[b.tier + 1];
    let h = `<div class="kv"><span>${tier.icon} ${tier.name}</span><b>${Math.floor(b.residents)} / ${tier.cap}</b></div><div class="meter"><i style="width:${b.residents / tier.cap * 100}%"></i></div>`;
    h += `<div class="kv"><span>Happiness</span><b>${b.happiness}%</b></div><div class="kv"><span>Taxes</span><b>💰${(b.residents * tier.tax * (0.5 + b.happiness / 100)).toFixed(1)}/min</b></div>`;
    const line = n => { const key = n.good || n.service, ok = b.need[key]; const label = n.good ? `${GOODS[n.good].icon} ${GOODS[n.good].name}` : `${{ market: '🏪 Market', tavern: '🍻 Tavern', chapel: '⛪ Chapel' }[n.service]} in range`; return `<li>${ok ? '✅' : '❌'} ${label}</li>`; };
    h += `<ul class="needs"><li class="t">Basic needs (more residents)</li>${tier.basic.map(line).join('')}<li class="t">Luxury (happiness, taxes)</li>${tier.luxury.map(line).join('')}</ul>`;
    if (next) {
      const err = c.upgradeError(b);
      h += `<div class="ibtns"><button class="btn good" data-act="upgrade" ${err ? 'disabled' : ''}>⬆️ Upgrade to ${next.name} (${costHtml(next.upgrade, c)})</button></div>${err ? `<p class="desc">${esc(err)}</p>` : ''}`;
    }
    return h;
  }
  productionHtml(b, d) {
    const c = this.c, ok = b.status === 'Working';
    let h = `<div class="status ${ok ? 'ok' : b.prod > 0 ? 'warn' : 'bad'}">${esc(b.status || '…')}</div>`;
    h += `<div class="kv"><span>Productivity</span><b>${Math.round(b.prod * c.relicMult(b.type) * 100)}%</b></div><div class="meter ${b.prod < 0.5 ? 'bad' : ''}"><i style="width:${Math.min(100, b.prod * 100)}%"></i></div>`;
    h += `<div class="chain">${Object.entries(d.in || {}).map(([g, n]) => `<span class="g">${n} ${GOODS[g].icon} ${GOODS[g].name}</span>`).join(' + ') || (d.fells ? '<span class="g">🌲 trees</span>' : d.on ? `<span class="g">⛰️ deposit</span>` : d.near?.what === 'rock' ? '<span class="g">🪨 rock</span>' : d.field ? '<span class="g">🌱 field</span>' : '<span class="g">🌲 forest</span>')} → ${Object.entries(d.out).map(([g, n]) => `<span class="g">${n} ${GOODS[g].icon} ${GOODS[g].name}</span>`).join('') || '<span class="g">🌱 saplings</span>'}</div>`;
    h += `<div class="kv"><span>Cycle</span><b>${d.cycle}s · ${(60 / d.cycle * b.prod * c.relicMult(b.type)).toFixed(1)}/min</b></div>`;
    if (d.workers) h += `<div class="kv"><span>Workers</span><b>${d.workers.n} ${TIERS[d.workers.tier].icon} (${Math.round(c.work.factor[d.workers.tier] * 100)}% staffed)</b></div>`;
    if (d.near) h += `<div class="kv"><span>${d.near.what === 'tree' ? 'Trees' : 'Rock'} in range</span><b>${Math.round(b.near * 100)}%</b></div>`;
    h += `<div class="kv"><span>Waiting for pickup</span><b>${Object.entries(b.out).filter(([, v]) => v > 0).map(([g, v]) => `${v}${GOODS[g].icon}`).join(' ') || '–'}</b></div>`;
    h += `<div class="kv"><span>Upkeep</span><b>💰${d.upkeep}/min</b></div>`;
    if (b.relicBoost) h += '';
    const boost = c.relicMult(b.type); if (boost > 1) h += `<div class="kv"><span>Relic boon</span><b>+${Math.round((boost - 1) * 100)}%</b></div>`;
    if (b.type === 'cartographer') {
      const err = c.expeditionError();
      h += c.expedition ? `<div class="status ok">🧭 Expedition out: back in ${Math.ceil(c.expedition.back - c.time)}s</div>`
        : `<div class="ibtns"><button class="btn good" data-act="expedition" ${err ? 'disabled' : ''}>🧭 Send an expedition (${costHtml(EXPEDITION.cost, c)})</button></div><p class="desc">${err && !/Cartographer/.test(err) ? esc(err) : 'Explorers return after 4 minutes with goods, gold, a charted deposit or a lair, sometimes a relic site.'}</p>`;
    }
    return h;
  }
  publicHtml(b, d) {
    const c = this.c;
    let h = '';
    if (d.storage) h += `<div class="kv"><span>Storage</span><b>${d.storage} per good (total ${c.cap})</b></div><div class="kv"><span>Carriers</span><b>${d.carriers}</b></div><div class="kv"><span>Logistics range</span><b>${d.logistic} tiles</b></div>`;
    if (d.service) { const served = [...c.buildings.values()].filter(r => r.tier != null && Math.hypot(r.cx - b.cx, r.cy - b.cy) <= d.range).length; h += `<div class="kv"><span>Homes in range</span><b>${served}</b></div>`; }
    if (d.guard) h += `<div class="kv"><span>Guards buildings within</span><b>${d.range} tiles</b></div>`;
    if (d.territory) h += `<div class="kv"><span>Territory radius</span><b>${d.territory} tiles</b></div>`;
    if (b.type === 'townhall') {
      h += `<div class="status ${c.hero.carry ? 'warn' : 'ok'}">${c.hero.carry ? '🎒 Your Founder carries a relic: walk to the Town Hall to enshrine it.' : `Relics enshrined: ${c.relics.length}/5`}</div>`;
      h += TIERS.map((t, i) => `<div class="kv"><span>${t.icon} ${t.name}</span><b>${c.tierUnlocked(i) ? Math.floor(c.pop[t.id]) : '🔒'}</b></div>`).join('');
      const ferr = c.festivalError();
      h += c.festivalUntil ? `<div class="status ok">🎉 Festival! ${Math.ceil(c.festivalUntil - c.time)}s left (+${FESTIVAL.happy} happiness)</div>`
        : `<div class="ibtns"><button class="btn good" data-act="festival" ${ferr ? 'disabled' : ''}>🎉 Hold a festival (${costHtml(FESTIVAL.cost, c)})</button></div><p class="desc">${ferr ? esc(ferr) : `+${FESTIVAL.happy} happiness in every home for ${FESTIVAL.time / 60} minutes: more taxes.`}</p>`;
    }
    if (d.trade) {
      if (!c.caravan.here) h += `<div class="status warn">🐪 Next caravan in ${Math.ceil(c.caravan.t)}s.</div>`;
      else {
        h += `<div class="status ok">🐪 Caravan in town for ${Math.ceil(c.caravan.t)}s.</div><table class="trade">`;
        for (const g of GOOD_KEYS) { const p = c.prices(g); h += `<tr><td>${GOODS[g].icon} ${GOODS[g].name}</td><td>${Math.floor(c.stock[g])}</td><td><button data-act="buy" data-good="${g}">Buy 5 · ${p.buy * 5}</button></td><td><button data-act="sell" data-good="${g}">Sell 5 · ${p.sell * 5}</button></td></tr>`; }
        h += '</table>';
      }
    }
    if (d.monument) h += `<div class="status ok">🏆 The Sanctum stands. The Wildwood is yours.</div>`;
    return h;
  }

  // ------------------------------------------------------------------ statistics screen
  renderStats(tab = this.statsTab || 'goods') {
    this.statsTab = tab;
    const c = this.c, h = c.history || [], box = $('statsbody');
    document.querySelectorAll('#statstabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    if (h.length < 2) { box.innerHTML = '<p class="desc">Statistics are sampled every 30 seconds. Check back in a minute.</p>'; return; }
    const last = h.slice(-10), avg = (k, g) => last.reduce((a, s) => a + (s[k][g] || 0), 0) / last.length;
    if (tab === 'goods') {
      box.innerHTML = `<table class="stats"><tr><th>Good</th><th>Stock</th><th>Made /min</th><th>Used /min</th><th>Balance</th><th>Last hour</th></tr>` +
        GOOD_KEYS.map(g => { const p = avg('prod', g), u = avg('cons', g), bal = p - u; if (!p && !u && !c.stock[g]) return '';
          return `<tr class="${bal < -0.05 ? 'deficit' : ''}"><td>${GOODS[g].icon} ${GOODS[g].name}</td><td>${Math.floor(c.stock[g])}</td><td>${p.toFixed(1)}</td><td>${u.toFixed(1)}</td><td><b>${bal >= 0 ? '+' : ''}${bal.toFixed(1)}</b>${bal < -0.05 ? ' ⚠️' : ''}</td><td><canvas class="spark" data-good="${g}" width="120" height="26"></canvas></td></tr>`; }).join('') + '</table>' +
        '<p class="desc">Averages over the last 5 minutes. ⚠️ means you use more than you make: build more producers or buy from caravans.</p>';
      box.querySelectorAll('canvas.spark').forEach(cv => this.spark(cv, [h.map(s => s.prod[cv.dataset.good] || 0), h.map(s => s.cons[cv.dataset.good] || 0)], ['#3f8f3a', '#c0392b']));
    } else if (tab === 'pop') {
      box.innerHTML = `<canvas class="chart" width="640" height="220"></canvas><div class="legend">${TIERS.map((t, i) => `<span><i style="background:${['#c99a3a', '#2a7fd0', '#8e44ad'][i]}"></i>${t.icon} ${t.name} ${Math.floor(c.pop[t.id])}</span>`).join('')}</div>`;
      this.spark(box.querySelector('canvas'), [0, 1, 2].map(i => h.map(s => s.pop[i])), ['#c99a3a', '#2a7fd0', '#8e44ad'], true);
    } else {
      box.innerHTML = `<canvas class="chart" width="640" height="220"></canvas><div class="legend"><span><i style="background:#3f8f3a"></i>Taxes /min</span><span><i style="background:#c0392b"></i>Upkeep /min</span><span><i style="background:#c99a3a"></i>Gold (scaled)</span></div>
        <div class="kv"><span>Treasury</span><b>💰${Math.round(c.gold)}</b></div><div class="kv"><span>Balance</span><b>${(c.stats.income - c.stats.upkeep).toFixed(0)}/min</b></div>`;
      const maxG = Math.max(1, ...h.map(s => s.gold)), maxI = Math.max(1, ...h.map(s => Math.max(s.income, s.upkeep)));
      this.spark(box.querySelector('canvas'), [h.map(s => s.income), h.map(s => s.upkeep), h.map(s => s.gold / maxG * maxI)], ['#3f8f3a', '#c0392b', '#c99a3a'], true);
    }
    void HIST_EVERY;
  }
  spark(cv, series, colors, axes = false) {
    const x = cv.getContext('2d'), w = cv.width, hgt = cv.height, pad = axes ? 22 : 2;
    const max = Math.max(1e-6, ...series.flat()), n = Math.max(2, series[0].length);
    x.clearRect(0, 0, w, hgt);
    if (axes) { x.strokeStyle = '#0003'; x.fillStyle = '#5a4a30'; x.font = '11px system-ui'; for (let i = 0; i <= 4; i++) { const y = pad + (hgt - 2 * pad) * i / 4; x.beginPath(); x.moveTo(pad, y); x.lineTo(w - 4, y); x.stroke(); x.fillText(String(Math.round(max * (1 - i / 4))), 2, y - 2); } }
    series.forEach((s, k) => {
      x.strokeStyle = colors[k]; x.lineWidth = axes ? 2.5 : 1.6; x.beginPath();
      s.forEach((v, i) => { const px = pad + (w - pad - 4) * i / (n - 1), py = hgt - pad - (hgt - 2 * pad) * v / max; i ? x.lineTo(px, py) : x.moveTo(px, py); });
      x.stroke();
    });
  }

  // ------------------------------------------------------------------ notifications
  notify(text, kind = 'info') {
    const el = document.createElement('div'); el.className = `note ${kind}`; el.textContent = text;
    $('feed').prepend(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 700); }, 6500);
    while ($('feed').children.length > 5) $('feed').lastChild.remove();
  }

  // ------------------------------------------------------------------ minimap
  renderMinimap(camTarget, hero) {
    const c = this.c, cv = $('minimap'), x = cv.getContext('2d');
    if (!this.mmImg || this.mmDirty) {
      this.mmDirty = false;
      const img = x.createImageData(W, H);
      for (let i = 0; i < W * H; i++) {
        let r = 110, g = 170, b = 80;
        if (c.ground[i] === T.WATER) [r, g, b] = [60, 130, 180]; else if (c.ground[i] === T.ROCK) [r, g, b] = [130, 124, 115]; else if (c.tree[i]) [r, g, b] = [52, 110, 50];
        if (c.road[i]) [r, g, b] = [200, 170, 120];
        if (c.occ[i]) [r, g, b] = [230, 120, 80];
        if (c.owned[i] && !c.occ[i] && !c.road[i]) { r += 18; g += 14; b += 6; }
        if (!c.fog[i]) [r, g, b] = [40, 48, 56];
        img.data.set([r, g, b, 255], i * 4);
      }
      this.mmImg = img;
      if (!this.mmCanvas) { this.mmCanvas = document.createElement('canvas'); this.mmCanvas.width = W; this.mmCanvas.height = H; }
      this.mmCanvas.getContext('2d').putImageData(img, 0, 0);
    }
    x.imageSmoothingEnabled = false;
    x.drawImage(this.mmCanvas, 0, 0, cv.width, cv.height);
    const s = cv.width / W;
    for (const l of c.lairs) if (l.found) { x.fillStyle = l.cleared ? '#7be07b' : l.relic && !l.relicTaken ? '#ffd54a' : '#ff5a4a'; x.beginPath(); x.arc((l.x + 1.5) * s, (l.y + 1.5) * s, 4, 0, 7); x.fill(); }
    for (const d of c.deposits) if (d.found) { x.fillStyle = d.kind === 'iron' ? '#cfe0ff' : '#ffe27a'; x.fillRect(d.x * s, d.y * s, 2 * s, 2 * s); }
    if (camTarget) { x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.strokeRect(camTarget[0] * s - 14, camTarget[1] * s - 10, 28, 20); }
    if (hero) { x.fillStyle = '#fff'; x.beginPath(); x.arc(hero[0] * s, hero[1] * s, 3.5, 0, 7); x.fill(); x.strokeStyle = '#000'; x.stroke(); }
  }
}
void idx;
