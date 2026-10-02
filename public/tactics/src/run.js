// Roguelite run state: party, resources, node map, encounters, loot and camp actions (no DOM).
import { CLASSES, CLASS_KEYS, ITEMS, GUILDS, BOSS_GUILD, maxHpOf, equip } from './data.js';
import { rng } from './grid.js';

export const LAYERS = 7; // regular layers before the boss
export const NODE = {
  skirmish: { name: 'Skirmish', icon: '⚔', desc: 'A rival squad blocks the trail.' },
  elite:    { name: 'Elite Squad', icon: '☠', desc: 'Veteran mercenaries with gear. Richer spoils.' },
  camp:     { name: 'Campfire', icon: '🔥', desc: 'Rest, share a mug, revive the fallen.' },
  cache:    { name: 'Supply Cache', icon: '✦', desc: 'An abandoned stash. Free loot.' },
  boss:     { name: 'The Hollow Crown', icon: '♛', desc: 'The elite rival guild. Win to end the war.' },
};
const SAVE_KEY = 'wildwood-tactics-run';

const pick = (r, opts) => { let x = r() * opts.reduce((s, o) => s + o[1], 0); for (const [v, w] of opts) if ((x -= w) < 0) return v; return opts[0][0]; };

export function newRun(classes, seed = Math.floor(Math.random() * 1e9)) {
  return {
    seed, map: genMap(seed), layer: -1, node: -1, supplies: 2, potions: 1, won: 0, kills: 0, rested: false,
    party: classes.map(cls => ({ cls, gear: [], hp: CLASSES[cls].hp, alive: true })),
  };
}

function genMap(seed) {
  const r = rng(seed ^ 0x5eed), layers = [];
  for (let l = 0; l < LAYERS; l++) {
    const n = l === 0 ? 2 : r() < 0.6 ? 3 : 2, row = [];
    for (let i = 0; i < n; i++) {
      let type;
      if (l === 0) type = 'skirmish';
      else if (l === LAYERS - 1) type = i % 2 ? 'cache' : 'camp';
      else type = pick(r, [['skirmish', 5], ['elite', l >= 2 ? 2 : 0], ['camp', l >= 2 ? 2 : 0], ['cache', 1.5]]);
      row.push({ type, l, i, x: (i + 1) / (n + 1) + (r() - 0.5) * 0.08, next: [] });
    }
    layers.push(row);
  }
  if (!layers[3].some(n => n.type === 'camp')) layers[3][0].type = 'camp';
  layers.push([{ type: 'boss', l: LAYERS, i: 0, x: 0.5, next: [] }]);
  for (let l = 0; l < layers.length - 1; l++) {
    const a = layers[l], b = layers[l + 1];
    for (const n of a) {
      const near = b.map((m, j) => [Math.abs(m.x - n.x), j]).sort((p, q) => p[0] - q[0]);
      n.next.push(near[0][1]);
      if (near[1] && r() < 0.45) n.next.push(near[1][1]);
    }
    b.forEach((m, j) => {
      if (a.some(n => n.next.includes(j))) return;
      const k = a.map((n, q) => [Math.abs(n.x - m.x), q]).sort((p, q) => p[0] - q[0])[0][1];
      a[k].next.push(j);
    });
  }
  return layers;
}

export function currentNode(run) { return run.layer < 0 ? null : run.map[run.layer][run.node]; }

/** Nodes the party can travel to next. */
export function available(run) {
  if (run.layer < 0) return run.map[0];
  const cur = currentNode(run);
  return cur.next.map(j => run.map[run.layer + 1][j]);
}

export function travel(run, node) { run.layer = node.l; run.node = node.i; run.rested = false; }

const itemsFor = cls => Object.keys(ITEMS).filter(id => ITEMS[id].cls === cls);
const plural = (n, s) => `${n} ${s}${n > 1 ? 's' : ''}`;

/** Procedural rival squad for a node: same six classes, a guild tint, depth scaling. */
export function encounter(run, node) {
  const r = rng(run.seed + node.l * 1009 + node.i * 37 + 11);
  const boss = node.type === 'boss', elite = node.type === 'elite' || boss;
  const guild = boss ? BOSS_GUILD : GUILDS[Math.floor(r() * GUILDS.length)];
  const count = boss ? 5 : elite ? 4 : node.l < 4 ? 3 : 4;
  const classes = [];
  if (r() < 0.45) { // stacked doctrine, e.g. three Barbarians and a Wizard
    const main = CLASS_KEYS[Math.floor(r() * 6)];
    for (let k = 0; k < Math.min(count - 1, 2 + (r() < 0.5 ? 1 : 0)); k++) classes.push(main);
  }
  while (classes.length < count) classes.push(CLASS_KEYS[Math.floor(r() * 6)]);
  const heroes = classes.map(cls => {
    const gear = [], opts = itemsFor(cls);
    if ((elite || r() < node.l * 0.08) && opts.length) gear.push(opts[Math.floor(r() * opts.length)]);
    return { cls, gear, hp: null };
  });
  const tally = {};
  for (const c of classes) tally[c] = (tally[c] || 0) + 1;
  return {
    guild, heroes, elite, boss, depth: node.l, seed: Math.floor(r() * 1e9),
    hpMult: boss ? 0.9 : 0.68 + node.l * 0.045 + (node.type === 'elite' ? 0.15 : 0),
    dmgBonus: boss ? 0 : Math.floor(node.l / 4),
    summary: Object.entries(tally).map(([c, n]) => plural(n, CLASSES[c].name)).join(', '),
  };
}

/** Three post-battle choices: two gear upgrades for the party, one resource. */
export function lootOffers(run, rich = false) {
  const r = rng(run.seed + run.layer * 7919 + run.node * 131 + run.won * 17);
  const cands = [];
  run.party.forEach((h, hi) => {
    for (const [id, it] of Object.entries(ITEMS)) if ((it.cls === h.cls || it.cls === 'any') && !h.gear.includes(id)) cands.push({ kind: 'item', id, hero: hi, w: it.cls === 'any' ? 0.6 : 1 });
  });
  const offers = [];
  while (offers.length < 2 && cands.length) {
    const c = pick(r, cands.map(c => [c, c.w]));
    offers.push(c);
    for (let k = cands.length - 1; k >= 0; k--) if (cands[k].id === c.id || (cands[k].hero === c.hero && cands.some(o => o.hero !== c.hero))) cands.splice(k, 1);
  }
  offers.push(r() < (rich ? 0.65 : 0.3) ? { kind: 'potion' } : { kind: 'supplies', n: rich ? 4 : 3 });
  return offers;
}

export function describeOffer(run, o) {
  if (o.kind === 'potion') return { title: 'Potion Bottle', sub: 'Rare', desc: 'Revives a fallen hero at a campfire.' };
  if (o.kind === 'supplies') return { title: `${o.n} Supplies`, sub: 'Resources', desc: 'Spend at camp: share a mug to restore stamina.' };
  const it = ITEMS[o.id], h = run.party[o.hero];
  return { title: it.name, sub: `for ${CLASSES[h.cls].name}`, desc: it.desc, model: it.model };
}

export function applyOffer(run, o) {
  if (o.kind === 'potion') run.potions++;
  else if (o.kind === 'supplies') run.supplies += o.n;
  else equip(run.party[o.hero], o.id);
}

// ---- camp
export const MUG_COST = 2;
export function canMug(run, h) { return h.alive && h.hp < maxHpOf(h) && run.supplies >= MUG_COST; }
export function mug(run, h) { if (!canMug(run, h)) return false; run.supplies -= MUG_COST; h.hp = Math.min(maxHpOf(h), h.hp + Math.ceil(maxHpOf(h) * 0.6)); return true; }
export function canRevive(run, h) { return !h.alive && run.potions > 0; }
export function revive(run, h) { if (!canRevive(run, h)) return false; run.potions--; h.alive = true; h.hp = Math.ceil(maxHpOf(h) * 0.5); return true; }
export function rest(run) {
  if (run.rested) return false;
  run.rested = true;
  for (const h of run.party) if (h.alive) h.hp = Math.min(maxHpOf(h), h.hp + Math.ceil(maxHpOf(h) * 0.2));
  return true;
}

/** Copy surviving HP back from battle units onto the heroes. */
export function afterBattle(run, units, enc) {
  // survivors catch their breath (+25% max HP); the fallen stay down until revived at camp
  for (const u of units) if (u.side === 'player') {
    u.hero.alive = u.alive;
    u.hero.hp = u.alive ? Math.min(maxHpOf(u.hero), u.hp + Math.ceil(maxHpOf(u.hero) * 0.25)) : 0;
  }
  run.kills += units.filter(u => u.side === 'enemy' && !u.alive).length;
  run.won++;
  run.supplies += enc.elite ? 3 : 2;
}

export function save(run) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(run)); } catch {} }
export function load() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; } }
export function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch {} }
