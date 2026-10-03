// Illustrated "How to play" overlay for Wildwood Tactics (and Arena raids). Plain DOM, no assets.
import { CLASSES, ABIL, TILE, T } from './data.js';
import { TILE_ICON, ABIL_ICON, abilityBlurb } from './controller.js';

const TIPS = {
  knight: 'Stand in a gap between rocks: enemies who step next to him must stop.',
  barbarian: 'Wait until enemies bunch up, then Cleave hits all of them at once.',
  ranger: 'Stay far back next to a leafy tree: more range = more damage, tree = +20% hit.',
  rogue: 'End a turn in a bush to hide. Your next attack is a guaranteed double-damage crit.',
  wizard: 'Fireball a leafy tree near enemies to leave burning ground. Keep potions for emergencies.',
  fighter: 'Swap to Defense (shield) when low on HP. The swap is free and does not use your action.',
};

const grid = cells => `<span class="mini">${cells.map(c => `<i class="${c}"></i>`).join('')}</span>`;

const PAGES = {
  basics: () => `
    <div class="steps">
      <div class="stepc"><span class="num">1</span><b>Pick a hero</b><p>Click one of your heroes. Yours have <b style="color:#4ab0ff">blue rings</b>, enemies have <b style="color:#ff6a6a">red rings</b>. A bouncing ▼ means the hero can still act this turn.</p>
        ${grid(['', '', '', '', '', '', '', 's', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''])}</div>
      <div class="stepc"><span class="num">2</span><b>Move: blue tiles</b><p>Blue tiles show where the hero can walk. Hover one to see the footprint path, then click to go. Each hero moves <b>once</b> per turn.</p>
        ${grid(['', 'm', 'm', 'm', '', 'm', 'm', 's', 'm', 'm', '', 'm', 'm', 'm', '', '', '', 'm', '', '', '', '', '', '', ''])}</div>
      <div class="stepc"><span class="num">3</span><b>Act: red targets</b><p>Red tiles are enemies you can hit. Hover to see the <b>hit %</b> and damage, then click to attack. Or pick another ability (keys 1–4) below. Each hero acts <b>once</b> per turn, before or after moving.</p>
        ${grid(['', '', '', '', '', '', '', '', 'a', '', '', '', 's', '', '', '', '', '', '', '', '', '', '', '', ''])}</div>
      <div class="stepc"><span class="num">4</span><b>End Turn</b><p>When your heroes are done (the button glows), press <b>End Turn</b> or Enter. The enemy squad then moves and attacks. Repeat until one side is wiped out.</p></div>
    </div>
    <div class="tip-line">💡 Hover anything (tiles, enemies, ability buttons) for an explanation. Press <b>T</b> to tint every tile the enemy could hit next turn.</div>`,
  terrain: () => `
    ${[T.GROUND, T.GRASS, T.OVERGROWN, T.BUSH, T.BOULDER, T.PILLAR, T.TREE, T.BARE, T.CORRUPT].map(t => `<div class="trow"><span class="ti">${TILE_ICON[t]}</span><b>${TILE[t].name}</b><span>${TILE[t].desc || 'Open ground. Anyone can walk here.'}</span></div>`).join('')}
    <div class="trow"><span class="ti">🔥</span><b>Fire</b><span>Lasts 3 rounds. Walking through or ending a turn in it deals 3 damage. Wizards create it by Fireballing leafy trees.</span></div>
    <div class="tip-line">💡 <b>Cover:</b> a ranged attack against someone standing right behind a boulder or trunk does −40% damage and has −15% hit. Rock pillars and leafy trees block line of sight completely.</div>`,
  classes: () => Object.entries(CLASSES).map(([k, c]) => `
    <div class="crow"><div><b>${c.name}</b><span class="role">${c.role}</span>❤ ${c.hp} · 👣 ${c.move}${c.armor ? ` · 🛡 ${c.armor}` : ''}</div>
      <div>${c.abilities.map(a => `${ABIL_ICON[a]} <b style="color:#fff;font-size:13.5px">${ABIL[a].name}</b>: ${abilityBlurb(ABIL[a])}. ${ABIL[a].desc}`).join('<br>')}<br><i style="opacity:.8">${c.passive}</i><br>💡 ${TIPS[k]}</div></div>`).join(''),
  run: () => `
    <div class="steps">
      <div class="stepc"><b>🗺 The map</b><p>Travel from the bottom of the map to the boss at the top. Click a <b>glowing node</b>; lines show which nodes connect.</p></div>
      <div class="stepc"><b>⚔ Skirmish · ☠ Elite</b><p>Battles against rival guilds. Elites are tougher but drop better loot. Win to choose one of three rewards.</p></div>
      <div class="stepc"><b>🔥 Campfire</b><p>Spend 2 supplies on a mug to heal a hero 60%, use a potion to <b>revive</b> a fallen hero, or rest (+20% everyone, once).</p></div>
      <div class="stepc"><b>✦ Supply cache · ♛ Boss</b><p>A cache is free loot. The Hollow Crown boss squad waits at the end. Beat them to win the run.</p></div>
    </div>
    <div class="tip-line">💡 Wounds carry over between battles (+25% heal after a win). A hero who falls stays down until revived at a campfire, so don't throw heroes away.</div>`,
};
const TABS = [['basics', '🎮 Basics'], ['terrain', '🌳 Terrain'], ['classes', '🛡 Heroes'], ['run', '🗺 The Run']];

let el;
export function openHelp(tab = 'basics', { extraTab } = {}) {
  if (!el) {
    el = document.createElement('div'); el.id = 'helpov'; el.className = 'hidden';
    document.body.appendChild(el);
    el.addEventListener('click', e => { if (e.target === el) closeHelp(); });
  }
  const tabs = extraTab ? [...TABS, [extraTab.id, extraTab.label]] : TABS;
  const body = tab === extraTab?.id ? extraTab.html() : (PAGES[tab] || PAGES.basics)();
  el.innerHTML = `<div class="helpcard"><h2>How to play <button class="btn" id="helpclose">✕ Close</button></h2>
    <div class="tabs">${tabs.map(([id, label]) => `<button class="btn ${id === tab ? 'on' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>${body}</div>`;
  el.classList.remove('hidden');
  el.querySelector('#helpclose').onclick = closeHelp;
  el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => openHelp(b.dataset.tab, { extraTab }));
}
export function closeHelp() { el?.classList.add('hidden'); }
export function helpOpen() { return el && !el.classList.contains('hidden'); }

/** Wire every .helpbtn plus the H key (and Esc to close). */
export function bindHelp(opts) {
  document.addEventListener('click', e => { if (e.target.closest?.('.helpbtn')) openHelp(e.target.closest('.helpbtn').dataset.help || 'basics', opts); });
  addEventListener('keydown', e => {
    if (e.target?.tagName === 'INPUT') return;
    if (e.code === 'KeyH') helpOpen() ? closeHelp() : openHelp('basics', opts);
    if (e.code === 'Escape' && helpOpen()) closeHelp();
  });
}
