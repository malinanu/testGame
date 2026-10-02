// supabase/functions/arena/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";

// supabase/functions/_shared/tactics/src/data.js
var W = 12;
var H = 12;
var T = { GROUND: 0, GRASS: 1, OVERGROWN: 2, BUSH: 3, BOULDER: 4, PILLAR: 5, TREE: 6, BARE: 7, CORRUPT: 8 };
var TILE = {
  [T.GROUND]: { name: "Clearing", cost: 1 },
  [T.GRASS]: { name: "Grass tufts", cost: 1, desc: "A Wizard can entangle it into difficult terrain." },
  [T.OVERGROWN]: { name: "Overgrown", cost: 2, desc: "Difficult terrain: costs 2 movement." },
  [T.BUSH]: { name: "Bush", cost: 1, desc: "A Rogue ending a turn here becomes Hidden." },
  [T.BOULDER]: { name: "Boulder", block: true, desc: "Impassable. Half cover against ranged attacks." },
  [T.PILLAR]: { name: "Rock pillar", block: true, los: true, desc: "Full cover: blocks line of sight." },
  [T.TREE]: { name: "Leafy tree", block: true, los: true, flammable: true, desc: "Blocks sight. Flammable. Rangers beside it aim better." },
  [T.BARE]: { name: "Bare trunk", block: true, fell: true, desc: "Half cover. A Barbarian can fell it." },
  [T.CORRUPT]: { name: "Corrupted tree", block: true, fell: true, desc: "Lashes anyone ending a turn next to it for 3 damage." }
};
var FIRE_DMG = 3;
var LASH_DMG = 3;
var FIRE_ROUNDS = 3;
var ABIL = {
  strike: { name: "Strike", kind: "attack", range: 1, dmg: 4, acc: 95, anim: "melee", desc: "Sword strike." },
  bash: {
    name: "Shield Bash",
    kind: "attack",
    range: 1,
    dmg: 2,
    acc: 95,
    cd: 2,
    push: true,
    anim: "melee",
    desc: "Push the target 1 tile. If it slams into rock, a tree or another unit: +2 damage and Stunned."
  },
  chop: { name: "Chop", kind: "attack", range: 1, dmg: 5, acc: 90, fell: true, anim: "melee", desc: "Heavy axe blow. Can fell bare trunks." },
  cleave: { name: "Cleave", kind: "cleave", dmg: 4, cd: 2, anim: "melee", desc: "Sweep all 8 surrounding tiles. Fells bare and corrupted trees." },
  shoot: {
    name: "Longshot",
    kind: "attack",
    range: 7,
    dmg: 2,
    distScale: 0.5,
    acc: 80,
    ranged: true,
    proj: "arrow",
    desc: "Damage grows with distance (+1 per 2 tiles). +20% hit next to a leafy tree."
  },
  aimed: {
    name: "Aimed Shot",
    kind: "attack",
    range: 8,
    dmg: 2,
    distScale: 0.5,
    mult: 1.5,
    acc: 90,
    ignoreCover: true,
    ranged: true,
    cd: 3,
    proj: "arrow",
    desc: "x1.5 damage and ignores half cover."
  },
  stab: { name: "Twin Daggers", kind: "attack", range: 1, dmg: 5, acc: 95, anim: "melee", desc: "Strike from Hidden for a guaranteed x2 crit." },
  crossbow: { name: "Crossbow", kind: "attack", range: 5, dmg: 3, acc: 80, ranged: true, proj: "bolt", desc: "Ranged shot. Crits from Hidden too." },
  bolt: { name: "Arcane Bolt", kind: "attack", range: 5, dmg: 3, acc: 90, ranged: true, spell: true, proj: "orb", desc: "Reliable magic missile." },
  fireball: {
    name: "Fireball",
    kind: "aoe",
    range: 5,
    dmg: 3,
    cd: 3,
    spell: true,
    ignite: true,
    proj: "fire",
    desc: "3x3 blast (hurts allies too). Sets leafy trees ablaze, leaving fire for 3 rounds."
  },
  entangle: {
    name: "Entangle",
    kind: "aoe",
    range: 5,
    dmg: 0,
    cd: 2,
    overgrow: true,
    proj: "vine",
    desc: "Grass and clearings in a 3x3 area become overgrown difficult terrain."
  },
  heal: { name: "Healing Potion", kind: "heal", range: 3, amount: 6, cd: 2, proj: "potion", desc: "Throw a potion to an ally (or self): +6 HP." },
  axe: { name: "Axe Strike", kind: "attack", range: 1, dmg: 4, acc: 95, stanceBonus: true, anim: "melee", desc: "+2 damage in Offense stance." },
  flask: { name: "Potion Flask", kind: "heal", range: 3, amount: 8, consumable: "potion", proj: "potion", desc: "Consumable brewed at home: +8 HP to an ally in range. Uses your action." },
  stance: {
    name: "Swap Stance",
    kind: "stance",
    free: true,
    desc: "Free, once per turn. Offense: axe, +2 damage. Defense: raise the round shield, -2 damage taken."
  }
};
var CLASSES = {
  knight: {
    name: "Knight",
    role: "Tank",
    model: "Knight",
    hp: 24,
    move: 3,
    armor: 1,
    prefer: 1,
    gear: { R: "sword_1handed", L: "shield_badge" },
    abilities: ["strike", "bash"],
    passive: "Hold the Line: enemies that step next to the Knight must stop. Armor 1."
  },
  barbarian: {
    name: "Barbarian",
    role: "Melee AoE",
    model: "Barbarian",
    hp: 22,
    move: 4,
    prefer: 1,
    gear: { R: "axe_2handed" },
    abilities: ["chop", "cleave"],
    passive: "Clears bare trunks to open new paths."
  },
  ranger: {
    name: "Ranger",
    role: "Sniper",
    model: "Rogue",
    hp: 15,
    move: 4,
    prefer: 5,
    gear: { R: "bow_withString" },
    abilities: ["shoot", "aimed"],
    passive: "Eagle Eye: +20% hit chance next to a leafy tree."
  },
  rogue: {
    name: "Rogue",
    role: "Stealth",
    model: "Rogue_Hooded",
    hp: 16,
    move: 5,
    prefer: 1,
    gear: { R: "dagger", L: "dagger" },
    abilities: ["stab", "crossbow"],
    passive: "Hidden on bushes: can only be targeted from 1 tile, next attack is a guaranteed crit."
  },
  wizard: {
    name: "Wizard",
    role: "Support",
    model: "Mage",
    hp: 14,
    move: 3,
    prefer: 4,
    gear: { R: "staff", L: "spellbook_open" },
    abilities: ["bolt", "fireball", "entangle", "heal"],
    passive: "Controls the field with fire, vines and potions."
  },
  fighter: {
    name: "Fighter",
    role: "Versatile",
    model: "Ranger",
    hp: 20,
    move: 4,
    prefer: 1,
    gear: { R: "axe_1handed" },
    abilities: ["axe", "stance"],
    passive: "Swaps freely between offense and a defensive shield stance."
  }
};
var CLASS_KEYS = Object.keys(CLASSES);
var ITEMS = {
  masterblade: { name: "Masterwork Blade", cls: "knight", slot: "R", model: "sword_2handed_color", mods: { dmg: 2 }, desc: "+2 damage" },
  spiked: { name: "Spiked Kite Shield", cls: "knight", slot: "L", model: "shield_spikes_color", mods: { hp: 4, bash: 2 }, desc: "+4 HP, Shield Bash +2 damage" },
  clansword: { name: "Clan Greatsword", cls: "barbarian", slot: "R", model: "sword_2handed", mods: { dmg: 2 }, desc: "+2 damage" },
  pelt: { name: "Bear Pelt", cls: "barbarian", mods: { hp: 6 }, desc: "+6 HP" },
  ironbow: { name: "Ironwood Longbow", cls: "ranger", slot: "R", model: "bow", mods: { dmg: 1, range: 1 }, desc: "+1 damage, +1 range" },
  hawkquiver: { name: "Hawk-feather Quiver", cls: "ranger", mods: { acc: 10 }, desc: "+10% hit chance" },
  repeater: { name: "Repeating Crossbow", cls: "rogue", slot: "L", model: "crossbow_1handed", mods: { dmg: 1, range: 1 }, desc: "+1 damage, +1 crossbow range" },
  smoke: { name: "Smoke Bombs", cls: "rogue", mods: { move: 1 }, desc: "+1 move" },
  elderwand: { name: "Elder Wand", cls: "wizard", slot: "R", model: "wand", mods: { spell: 2 }, desc: "+2 spell damage" },
  grimoire: { name: "Verdant Grimoire", cls: "wizard", slot: "L", model: "spellbook_closed", mods: { heal: 3 }, desc: "+3 healing" },
  guildshield: { name: "Guild Round Shield", cls: "fighter", slot: "shield", model: "shield_round_color", mods: { armor: 1, hp: 3 }, desc: "+1 armor, +3 HP" },
  whetstone: { name: "Whetstone", cls: "fighter", mods: { dmg: 1 }, desc: "+1 damage" },
  boots: { name: "Trail Boots", cls: "any", mods: { move: 1 }, desc: "+1 move" },
  chainshirt: { name: "Chain Shirt", cls: "any", mods: { hp: 4 }, desc: "+4 HP" }
};
function gearMods(gear) {
  const m = {};
  for (const id of gear) for (const [k, v] of Object.entries(ITEMS[id].mods)) m[k] = (m[k] || 0) + v;
  return m;
}

// supabase/functions/_shared/tactics/src/grid.js
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = s + 1831565813 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
var N8 = [...N4, [1, 1], [1, -1], [-1, 1], [-1, -1]];
var dist = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
var Grid = class {
  constructor(w = W, h = H) {
    this.w = w;
    this.h = h;
    this.t = new Uint8Array(w * h);
    this.fire = new Uint8Array(w * h);
    this.v = new Uint8Array(w * h);
  }
  in(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  i(x, y) {
    return y * this.w + x;
  }
  xy(i) {
    return [i % this.w, i / this.w | 0];
  }
  get(x, y) {
    return this.t[this.i(x, y)];
  }
  set(x, y, t) {
    this.t[this.i(x, y)] = t;
  }
  def(x, y) {
    return TILE[this.get(x, y)];
  }
  blocked(x, y) {
    return !this.in(x, y) || !!this.def(x, y).block;
  }
  blocksLos(x, y) {
    return this.in(x, y) && !!this.def(x, y).los;
  }
  cost(x, y) {
    return this.def(x, y).cost || 1;
  }
  isAdjTo(x, y, type) {
    return N8.some(([dx, dy]) => this.in(x + dx, y + dy) && this.get(x + dx, y + dy) === type);
  }
};
function lineOfSight(g, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, steps = Math.max(Math.abs(dx), Math.abs(dy)) * 8;
  for (let s = 1; s < steps; s++) {
    const t = s / steps, px = ax + dx * t, py = ay + dy * t;
    for (const [x, y] of [[Math.floor(px + 0.5), Math.floor(py + 0.5)], [Math.ceil(px - 0.5), Math.ceil(py - 0.5)]]) {
      if (x === ax && y === ay || x === bx && y === by) continue;
      if (g.blocksLos(x, y)) return false;
    }
  }
  return true;
}
function halfCover(g, ax, ay, tx, ty) {
  if (dist(ax, ay, tx, ty) <= 1) return false;
  const vx = ax - tx, vy = ay - ty, len = Math.hypot(vx, vy);
  for (const [dx, dy] of N4) {
    const x = tx + dx, y = ty + dy;
    if (!g.in(x, y) || !g.def(x, y).block) continue;
    if ((dx * vx + dy * vy) / len > 0.35) return true;
  }
  return false;
}
function reachable(g, units, u, budget) {
  const occ = /* @__PURE__ */ new Map(), zoc = /* @__PURE__ */ new Set();
  for (const o of units) {
    if (!o.alive || o === u) continue;
    occ.set(g.i(o.x, o.y), o);
    if (o.side !== u.side && o.cls === "knight") {
      for (const [dx, dy] of N8) if (g.in(o.x + dx, o.y + dy)) zoc.add(g.i(o.x + dx, o.y + dy));
    }
  }
  const start = g.i(u.x, u.y);
  const best = /* @__PURE__ */ new Map([[start, { c: 0, prev: -1, stop: true }]]);
  const q = [[0, start]];
  while (q.length) {
    let bi = 0;
    for (let k2 = 1; k2 < q.length; k2++) if (q[k2][0] < q[bi][0]) bi = k2;
    const [c, k] = q.splice(bi, 1)[0];
    if (c > best.get(k).c) continue;
    if (k !== start && zoc.has(k)) continue;
    const [x, y] = g.xy(k);
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (g.blocked(nx, ny)) continue;
      const nk = g.i(nx, ny), o = occ.get(nk);
      if (o && o.side !== u.side) continue;
      const nc = c + g.cost(nx, ny);
      if (nc > budget) continue;
      const cur = best.get(nk);
      if (!cur || cur.c > nc) {
        best.set(nk, { c: nc, prev: k, stop: !o });
        q.push([nc, nk]);
      }
    }
  }
  return best;
}
function pathTo(g, reach, k) {
  const p = [];
  while (k !== -1 && k !== void 0) {
    p.unshift(g.xy(k));
    k = reach.get(k)?.prev;
  }
  return p;
}
function distanceField(g, sources) {
  const d = new Int16Array(g.w * g.h).fill(999), q = [];
  for (const [x, y] of sources) {
    const k = g.i(x, y);
    d[k] = 0;
    q.push(k);
  }
  for (let h = 0; h < q.length; h++) {
    const [x, y] = g.xy(q[h]);
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (!g.in(nx, ny) || g.blocked(nx, ny)) continue;
      const nk = g.i(nx, ny), nd = d[q[h]] + g.cost(nx, ny);
      if (nd < d[nk]) {
        d[nk] = nd;
        q.push(nk);
      }
    }
  }
  return d;
}
function flood(g, sx, sy) {
  const seen = new Uint8Array(g.w * g.h), q = [g.i(sx, sy)];
  seen[q[0]] = 1;
  for (let h = 0; h < q.length; h++) {
    const [x, y] = g.xy(q[h]);
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (!g.in(nx, ny) || g.blocked(nx, ny)) continue;
      const k = g.i(nx, ny);
      if (!seen[k]) {
        seen[k] = 1;
        q.push(k);
      }
    }
  }
  return seen;
}
function generateMap(seed, depth = 0) {
  const r = rng(seed);
  const g = new Grid();
  const pick = (opts) => {
    let x = r() * opts.reduce((s, o) => s + o[1], 0);
    for (const [v, w] of opts) if ((x -= w) < 0) return v;
    return opts[0][0];
  };
  const obstacle = () => pick([[T.TREE, 4], [T.PILLAR, 3], [T.BARE, 1.5], [T.BOULDER, 1.5]]);
  const ri = (a, b) => a + Math.floor(r() * (b - a + 1));
  for (let i = 0; i < g.t.length; i++) {
    g.t[i] = r() < 0.3 ? T.GRASS : T.GROUND;
    g.v[i] = Math.floor(r() * 256);
  }
  for (const row of [ri(3, 4), ri(7, 8)]) {
    const gaps = [];
    const nGaps = r() < 0.35 ? 3 : 2;
    for (let n = 0; n < nGaps; n++) gaps.push({ x: ri(1, W - 2), w: r() < 0.6 ? 1 : 2 });
    for (let x = 0; x < W; x++) {
      if (gaps.some((gp) => x >= gp.x && x < gp.x + gp.w)) continue;
      if (r() < 0.12) continue;
      const y = row + (r() < 0.25 ? r() < 0.5 ? -1 : 1 : 0);
      g.set(x, y, obstacle());
    }
  }
  const scatter = (type, n, y0 = 2, y1 = H - 3) => {
    for (let k = 0, tries = 0; k < n && tries < 200; tries++) {
      const x = ri(0, W - 1), y = ri(y0, y1);
      if (g.get(x, y) > T.GRASS) continue;
      g.set(x, y, type);
      k++;
    }
  };
  scatter(T.BOULDER, ri(5, 8), 1, H - 2);
  scatter(T.BUSH, ri(6, 9), 1, H - 2);
  scatter(T.TREE, ri(2, 4));
  scatter(T.PILLAR, ri(1, 2));
  scatter(T.BARE, ri(1, 2));
  scatter(T.CORRUPT, Math.min(5, Math.floor(depth / 2) + (r() < 0.6 ? 1 : 0)), 3, H - 4);
  const zone = (rows) => {
    const spots = [];
    for (const y of rows) for (let x = 2; x <= W - 3; x++) {
      if (g.blocked(x, y) || g.get(x, y) === T.BUSH) g.set(x, y, r() < 0.3 ? T.GRASS : T.GROUND);
      spots.push([x, y]);
    }
    return spots.sort(() => r() - 0.5);
  };
  const pSpawn = zone([0, 1]).sort((a, b) => Math.abs(a[0] - 5.5) - Math.abs(b[0] - 5.5));
  const eSpawn = zone([H - 1, H - 2]);
  for (let guard = 0; guard < 60; guard++) {
    const seen = flood(g, pSpawn[0][0], pSpawn[0][1]);
    if (eSpawn.every(([x, y]) => seen[g.i(x, y)])) break;
    const frontier = [];
    for (let k = 0; k < seen.length; k++) {
      if (!seen[k]) continue;
      const [x, y] = g.xy(k);
      for (const [dx, dy] of N4) if (g.in(x + dx, y + dy) && g.blocked(x + dx, y + dy) && y + dy > y) frontier.push([x + dx, y + dy]);
    }
    const [fx, fy] = frontier.length ? frontier[Math.floor(r() * frontier.length)] : [ri(0, W - 1), ri(2, H - 3)];
    g.set(fx, fy, T.GROUND);
  }
  return { grid: g, pSpawn, eSpawn };
}

// supabase/functions/_shared/tactics/src/battle.js
var nextId = 1;
function makeUnit(hero, side, { hpMult = 1, dmgBonus = 0, tint = null, elite = false } = {}) {
  const c = CLASSES[hero.cls], mods = gearMods(hero.gear);
  if (dmgBonus) mods.dmg = (mods.dmg || 0) + dmgBonus;
  const maxHp = Math.round((c.hp + (mods.hp || 0)) * hpMult);
  return {
    id: nextId++,
    side,
    cls: hero.cls,
    name: c.name,
    hero,
    elite,
    tint,
    hp: hero.hp == null ? maxHp : Math.min(hero.hp, maxHp),
    maxHp,
    move: c.move + (mods.move || 0),
    armor: (c.armor || 0) + (mods.armor || 0),
    mods,
    gear: hero.gear,
    x: 0,
    y: 0,
    cd: {},
    stun: 0,
    hidden: false,
    stance: "offense",
    moved: false,
    acted: false,
    stanced: false,
    attacked: false,
    alive: true
  };
}
var NullView = new Proxy({}, { get: () => () => Promise.resolve() });
var Battle = class {
  /**
   * consumables: shared player-side stock, e.g. { potion: 2 } (enables the Potion Flask ability).
   * maxRounds: when set, surviving past that round ends the battle as a loss for the player (raid timeout).
   */
  constructor({ grid, units, view = NullView, seed = 1, onEnd = () => {
  }, consumables = {}, maxRounds = 0 }) {
    this.g = grid;
    this.units = units;
    this.view = view;
    this.rand = rng(seed);
    this.onEnd = onEnd;
    this.consumables = { ...consumables };
    this.maxRounds = maxRounds;
    this.round = 1;
    this.phase = "player";
    this.over = false;
    this.result = null;
    this.log = [];
    this.actions = [];
    for (const u of units) if (u.behavior === "guard" && !u.post) u.post = [u.x, u.y];
    this.startPhase("player");
  }
  record(entry) {
    if (this.phase === "player") this.actions.push(entry);
  }
  /** Re-run a recorded command log headless. Returns false if any command is illegal. */
  async replay(actions) {
    for (const a of actions) {
      if (this.over) break;
      if (a.t === "e") {
        if (this.phase !== "player") return false;
        await this.endPlayerTurn();
        continue;
      }
      const u = this.units[a.u];
      if (!u || u.side !== "player" || this.phase !== "player") return false;
      const ok = a.t === "m" ? await this.move(u, a.x, a.y) : a.t === "a" ? await this.use(u, a.id, a.x, a.y) : false;
      if (!ok) return false;
    }
    return true;
  }
  say(msg) {
    this.log.push(msg);
    this.view.log?.(msg);
  }
  unitAt(x, y) {
    return this.units.find((u) => u.alive && u.x === x && u.y === y);
  }
  alive(side) {
    return this.units.filter((u) => u.alive && u.side === side);
  }
  foes(u) {
    return this.units.filter((o) => o.alive && o.side !== u.side);
  }
  abilities(u) {
    const list = CLASSES[u.cls].abilities;
    return u.side === "player" && this.consumables.potion > 0 ? [...list, "flask"] : list;
  }
  moveBudget(u) {
    return u.move;
  }
  reach(u) {
    return reachable(this.g, this.units, u, this.moveBudget(u));
  }
  canUse(u, id) {
    const a = ABIL[id];
    if (!u.alive || this.over) return false;
    if (a.free) return !u.stanced;
    if (a.consumable && !(this.consumables[a.consumable] > 0)) return false;
    return !u.acted && !(u.cd[id] > 0);
  }
  /** Valid targets for an ability from (fx, fy). Each target: {x, y, unit?, tree?} */
  targets(u, id, fx = u.x, fy = u.y) {
    const a = ABIL[id], g = this.g, out = [];
    if (a.kind === "attack") {
      const range = a.range + (a.ranged ? u.mods.range || 0 : 0);
      for (const e of this.foes(u)) {
        const d = dist(fx, fy, e.x, e.y);
        if (d < 1 || d > range || e.hidden && d > 1) continue;
        if (a.ranged && !lineOfSight(g, fx, fy, e.x, e.y)) continue;
        out.push({ x: e.x, y: e.y, unit: e });
      }
      if (a.fell) for (const [dx, dy] of N8) {
        const x = fx + dx, y = fy + dy;
        if (g.in(x, y) && g.def(x, y).fell) out.push({ x, y, tree: true });
      }
    } else if (a.kind === "aoe") {
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
        const d = dist(fx, fy, x, y);
        if (d < 1 || d > a.range) continue;
        if (!lineOfSight(g, fx, fy, x, y)) continue;
        out.push({ x, y });
      }
    } else if (a.kind === "heal") {
      for (const o of this.units) if (o.alive && o.side === u.side && o.hp < o.maxHp && dist(fx, fy, o.x, o.y) <= a.range) out.push({ x: o.x, y: o.y, unit: o });
    } else out.push({ x: fx, y: fy, unit: u });
    return out;
  }
  /** Tiles affected by an ability aimed at (tx, ty). */
  area(u, id, tx, ty, fx = u.x, fy = u.y) {
    const a = ABIL[id];
    if (a.kind === "aoe") return N8.concat([[0, 0]]).map(([dx, dy]) => [tx + dx, ty + dy]).filter(([x, y]) => this.g.in(x, y));
    if (a.kind === "cleave") return N8.map(([dx, dy]) => [fx + dx, fy + dy]).filter(([x, y]) => this.g.in(x, y));
    return [[tx, ty]];
  }
  armorOf(t) {
    return t.armor + (t.cls === "fighter" && t.stance === "defense" ? 2 : 0);
  }
  /** Hit chance, damage and notes for an attack-type ability. */
  preview(u, id, target, fx = u.x, fy = u.y) {
    const a = ABIL[id], g = this.g, notes = [];
    if (a.kind === "heal") return { hit: 100, heal: a.amount + (u.mods.heal || 0), notes };
    let dmg = a.dmg + (u.mods.dmg || 0) + (a.spell ? u.mods.spell || 0 : 0);
    let hit = a.acc ?? 100;
    const d = target ? dist(fx, fy, target.x, target.y) : 0;
    if (a.distScale) {
      const b = Math.floor(d * a.distScale);
      if (b) {
        dmg += b;
        notes.push(`+${b} range`);
      }
    }
    if (a.stanceBonus && u.stance === "offense") {
      dmg += 2;
      notes.push("Offense +2");
    }
    if (a.push) dmg += 0;
    if (a.mult) dmg = Math.round(dmg * a.mult);
    if (a.ranged) {
      hit += u.mods.acc || 0;
      if (u.cls === "ranger" && g.isAdjTo(fx, fy, T.TREE)) {
        hit += 20;
        notes.push("Eagle Eye +20%");
      }
    }
    let cover = false;
    if (target && a.ranged && halfCover(g, fx, fy, target.x, target.y)) {
      if (a.ignoreCover) notes.push("Ignores cover");
      else {
        cover = true;
        dmg = Math.max(1, Math.round(dmg * 0.6));
        hit -= 15;
        notes.push("Half cover");
      }
    }
    const crit = u.hidden && a.kind === "attack";
    if (crit) {
      dmg *= 2;
      hit = 100;
      notes.push("Hidden: CRIT");
    }
    if (target?.unit) {
      const arm = this.armorOf(target.unit);
      if (arm) {
        dmg = Math.max(1, dmg - arm);
        notes.push(`Armor -${arm}`);
      }
    }
    if (target?.tree) {
      hit = 100;
      notes.push("Fell tree");
    }
    return { hit: Math.max(5, Math.min(100, hit)), dmg, crit, cover, notes };
  }
  // ---------------------------------------------------------------- actions
  async move(u, x, y) {
    const rec = this.phase === "player";
    const ok = await this.doMove(u, x, y);
    if (ok && rec) this.actions.push({ t: "m", u: this.units.indexOf(u), x, y });
    return ok;
  }
  async use(u, id, tx, ty) {
    const rec = this.phase === "player";
    const ok = await this.doUse(u, id, tx, ty);
    if (ok && rec) this.actions.push({ t: "a", u: this.units.indexOf(u), id, x: tx, y: ty });
    return ok;
  }
  async doMove(u, x, y) {
    if (u.moved || this.over) return false;
    const reach = this.reach(u), k = this.g.i(x, y), e = reach.get(k);
    if (!e || !e.stop) return false;
    const path = pathTo(this.g, reach, k);
    u.moved = true;
    if (path.length < 2) return true;
    u.x = x;
    u.y = y;
    if (u.hidden) u.hidden = false;
    await this.view.walk(u, path);
    const burns = path.slice(1).filter(([px, py]) => this.g.fire[this.g.i(px, py)]).length;
    if (burns) {
      this.say(`${u.name} runs through fire.`);
      await this.damage(u, FIRE_DMG * burns, { src: "fire" });
    }
    if (u.alive && u.cls === "rogue" && this.g.get(x, y) === T.BUSH && !u.attacked) await this.hide(u);
    return true;
  }
  async hide(u) {
    if (!u.hidden) {
      u.hidden = true;
      this.say(`${u.name} slips into the bush (Hidden).`);
      await this.view.status(u, "Hidden");
    }
  }
  async doUse(u, id, tx, ty) {
    const a = ABIL[id], g = this.g;
    if (!this.canUse(u, id)) return false;
    const tgt = this.targets(u, id).find((t) => t.x === tx && t.y === ty);
    if (!tgt) return false;
    if (a.free) {
      u.stanced = true;
      u.stance = u.stance === "offense" ? "defense" : "offense";
      this.say(`${u.name} switches to ${u.stance} stance.`);
      await this.view.stance(u);
      return true;
    }
    u.acted = true;
    if (a.cd) u.cd[id] = a.cd;
    if (a.consumable) this.consumables[a.consumable]--;
    const wasHidden = u.hidden;
    if (a.kind === "attack") {
      u.attacked = true;
      const p = this.preview(u, id, tgt);
      await this.view.attack(u, tx, ty, a);
      if (tgt.tree) {
        this.say(`${u.name} fells a tree.`);
        await this.fell(tx, ty);
      } else if (this.rand() * 100 < p.hit) {
        this.say(`${u.name} ${a.name} \u2192 ${tgt.unit.name}: ${p.dmg}${p.crit ? " CRIT" : ""}`);
        await this.damage(tgt.unit, p.dmg, { crit: p.crit });
        if (a.push && tgt.unit.alive) await this.push(u, tgt.unit);
      } else {
        this.say(`${u.name} ${a.name} misses ${tgt.unit.name}.`);
        await this.view.miss(tgt.unit);
      }
    } else if (a.kind === "cleave") {
      u.attacked = true;
      await this.view.attack(u, u.x, u.y, a);
      const dmg = (a.dmg + (u.mods.dmg || 0)) * (wasHidden ? 2 : 1);
      for (const [x, y] of this.area(u, id)) {
        const o = this.unitAt(x, y);
        if (o && o.side !== u.side) await this.damage(o, Math.max(1, dmg - this.armorOf(o)));
        if (g.def(x, y).fell) await this.fell(x, y);
      }
      this.say(`${u.name} cleaves everything around.`);
    } else if (a.kind === "aoe") {
      u.attacked = true;
      await this.view.cast(u, tx, ty, a);
      const tiles = this.area(u, id, tx, ty);
      if (a.dmg) {
        const dmg = a.dmg + (u.mods.spell || 0) + (u.mods.dmg || 0);
        for (const [x, y] of tiles) {
          const o = this.unitAt(x, y);
          if (o) await this.damage(o, Math.max(1, dmg - this.armorOf(o)));
        }
      }
      if (a.ignite) {
        let lit = 0;
        for (const [x, y] of tiles) if (g.def(x, y).flammable) {
          lit++;
          g.set(x, y, T.GROUND);
          for (const [dx, dy] of [[0, 0], ...N4]) {
            const nx = x + dx, ny = y + dy;
            if (g.in(nx, ny) && !g.blocked(nx, ny)) g.fire[g.i(nx, ny)] = FIRE_ROUNDS;
          }
          await this.view.ignite(x, y);
        }
        if (lit) {
          this.say(`${lit} tree${lit > 1 ? "s" : ""} burst into flames!`);
          await this.view.fire();
        }
      }
      if (a.overgrow) {
        for (const [x, y] of tiles) if (g.get(x, y) <= T.GRASS) {
          g.set(x, y, T.OVERGROWN);
          await this.view.retile(x, y);
        }
        this.say(`${u.name} calls up grasping vines.`);
      }
    } else if (a.kind === "heal") {
      const p = this.preview(u, id, tgt);
      await this.view.cast(u, tx, ty, a);
      const t = tgt.unit, before = t.hp;
      t.hp = Math.min(t.maxHp, t.hp + p.heal);
      this.say(`${u.name} heals ${t.name} for ${t.hp - before}.`);
      await this.view.heal(t, t.hp - before);
    }
    if (wasHidden && u.alive) {
      u.hidden = false;
      await this.view.status(u, "");
    }
    this.checkEnd();
    return true;
  }
  async push(u, t) {
    const dx = Math.sign(t.x - u.x), dy = Math.sign(t.y - u.y), nx = t.x + dx, ny = t.y + dy;
    if (!this.g.in(nx, ny) || this.g.blocked(nx, ny) || this.unitAt(nx, ny)) {
      t.stun = 1;
      this.say(`${t.name} is slammed into an obstacle \u2014 Stunned!`);
      await this.view.bump(t, dx, dy);
      await this.damage(t, 2 + (u.mods.bash || 0), { note: "Stunned!" });
    } else {
      t.x = nx;
      t.y = ny;
      t.hidden = false;
      await this.view.slide(t, nx, ny);
      if (this.g.fire[this.g.i(nx, ny)]) await this.damage(t, FIRE_DMG, { src: "fire" });
    }
  }
  async fell(x, y) {
    this.g.set(x, y, T.GROUND);
    await this.view.fell(x, y);
  }
  async damage(t, n, opts = {}) {
    if (!t.alive) return;
    t.hp = Math.max(0, t.hp - n);
    await this.view.hit(t, n, opts);
    if (t.hp <= 0) {
      t.alive = false;
      t.hidden = false;
      this.say(`${t.name} falls!`);
      await this.view.death(t);
    }
    this.checkEnd();
  }
  checkEnd() {
    if (this.over) return;
    const p = this.alive("player").length, e = this.alive("enemy").length;
    if (!p || !e) {
      this.over = true;
      this.result = p ? "win" : "lose";
      this.phase = "over";
      this.onEnd(this.result);
    }
  }
  // ---------------------------------------------------------------- turn flow
  startPhase(side) {
    this.phase = side;
    for (const u of this.units) {
      if (u.side !== side || !u.alive) continue;
      u.moved = u.acted = u.stanced = u.attacked = false;
      for (const k in u.cd) if (u.cd[k] > 0) u.cd[k]--;
      if (u.stun > 0) {
        u.stun--;
        u.moved = u.acted = true;
        u.stunned = true;
      } else u.stunned = false;
    }
  }
  async endOfTurn(side) {
    const g = this.g;
    for (const u of this.alive(side)) {
      if (this.over) return;
      if (g.fire[g.i(u.x, u.y)]) {
        this.say(`${u.name} burns.`);
        await this.damage(u, FIRE_DMG, { src: "fire" });
      }
      for (const [dx, dy] of N8) {
        const x = u.x + dx, y = u.y + dy;
        if (!u.alive || !g.in(x, y) || g.get(x, y) !== T.CORRUPT) continue;
        this.say(`A corrupted tree lashes ${u.name}!`);
        await this.view.lash(x, y, u);
        await this.damage(u, LASH_DMG, { src: "tree" });
      }
      if (u.alive && u.cls === "rogue" && g.get(u.x, u.y) === T.BUSH && !u.attacked) await this.hide(u);
    }
  }
  /** Called when the player presses End Turn: resolves the enemy phase and returns control. */
  async endPlayerTurn() {
    if (this.phase !== "player" || this.over) return;
    this.record({ t: "e" });
    await this.endOfTurn("player");
    if (this.over) return;
    this.startPhase("enemy");
    await this.view.banner?.("Enemy Turn");
    await this.runAI("enemy");
    if (this.over) return;
    await this.endOfTurn("enemy");
    if (this.over) return;
    let changed = false;
    for (let i = 0; i < this.g.fire.length; i++) if (this.g.fire[i]) {
      this.g.fire[i]--;
      changed = true;
    }
    if (changed) await this.view.fire();
    this.round++;
    if (this.maxRounds && this.round > this.maxRounds) {
      this.say("The defenders held out!");
      this.over = true;
      this.result = "lose";
      this.phase = "over";
      this.onEnd(this.result);
      return;
    }
    this.startPhase("player");
    await this.view.banner?.(`Round ${this.round}`);
  }
  async runAI(side) {
    const order = this.alive(side).sort((a, b) => CLASSES[a.cls].prefer - CLASSES[b.cls].prefer);
    for (const u of order) {
      if (this.over) return;
      if (!u.alive || u.moved && u.acted) continue;
      await this.aiTurn(u);
      await this.view.wait?.(0.15);
    }
  }
  // ---------------------------------------------------------------- AI
  async aiTurn(u) {
    if (u.cls === "fighter") {
      const want = u.hp < u.maxHp * 0.45 ? "defense" : "offense";
      if (u.stance !== want && this.canUse(u, "stance")) await this.use(u, "stance", u.x, u.y);
    }
    const plan = this.plan(u);
    if (!u.moved && plan.move) await this.move(u, plan.move[0], plan.move[1]);
    if (!u.alive || this.over || !plan.act) return;
    const { id, x, y } = plan.act;
    if (!await this.use(u, id, x, y)) {
      const alt = this.bestAction(u, u.x, u.y);
      if (alt.act) await this.use(u, alt.act.id, alt.act.x, alt.act.y);
    }
  }
  scoreAction(u, id, t, fx, fy) {
    const a = ABIL[id];
    if (a.kind === "attack") {
      if (t.tree) return this.g.get(t.x, t.y) === T.CORRUPT ? 1.5 : 0.1;
      const p = this.preview(u, id, t, fx, fy), ev = p.hit / 100 * p.dmg;
      return ev + (p.dmg >= t.unit.hp ? 6 * p.hit / 100 : 0) + (a.push ? 1 : 0);
    }
    if (a.kind === "heal") {
      const miss = t.unit.maxHp - t.unit.hp, amt = a.amount + (u.mods.heal || 0);
      return miss >= 4 ? Math.min(miss, amt) * 1.3 : 0;
    }
    let s = 0;
    const tiles = a.kind === "cleave" ? this.area(u, id, 0, 0, fx, fy) : this.area(u, id, t.x, t.y, fx, fy);
    for (const [x, y] of tiles) {
      const o = this.unitAt(x, y);
      const here = o && o !== u ? o : x === fx && y === fy ? u : null;
      if (a.dmg && here) {
        const dmg = Math.max(1, a.dmg + (u.mods.dmg || 0) + (a.spell ? u.mods.spell || 0 : 0) - this.armorOf(here));
        if (here.side !== u.side) s += dmg + (dmg >= here.hp ? 5 : 0);
        else s -= dmg * 2;
      }
      if (a.overgrow && this.g.get(x, y) <= T.GRASS) {
        if (o && o.side !== u.side) s += 0.6;
        s += this.foes(u).some((f) => dist(f.x, f.y, x, y) <= 2) ? 0.15 : 0;
      }
      if (a.ignite && this.g.def(x, y).flammable) s += this.foes(u).some((f) => dist(f.x, f.y, x, y) <= 1) ? 2 : 0.2;
    }
    return a.kind === "cleave" && s < 3 ? s * 0.5 : s;
  }
  bestAction(u, fx, fy) {
    let best = { score: 0, act: null };
    if (u.acted) return best;
    for (const id of this.abilities(u)) {
      if (ABIL[id].free || !this.canUse(u, id)) continue;
      for (const t of this.targets(u, id, fx, fy)) {
        const s = this.scoreAction(u, id, t, fx, fy);
        if (s > best.score) best = { score: s, act: { id, x: t.x, y: t.y } };
      }
    }
    return best;
  }
  plan(u) {
    const g = this.g, foes = this.foes(u);
    const field = distanceField(g, foes.map((f) => [f.x, f.y]));
    const beh = u.behavior || "aggressive";
    if (beh === "ambush" && !u.triggered && (u.hp < u.maxHp || foes.some((f) => dist(f.x, f.y, u.x, u.y) <= 4))) u.triggered = true;
    const still = beh === "hold" || beh === "ambush" && !u.triggered;
    const pref = beh === "sniper" ? Math.max(CLASSES[u.cls].prefer, 4) : CLASSES[u.cls].prefer;
    const reach = u.moved || still ? /* @__PURE__ */ new Map([[g.i(u.x, u.y), { c: 0, stop: true }]]) : this.reach(u);
    const hurt = beh === "medic" ? this.units.filter((o) => o.alive && o.side === u.side && o !== u).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0] : null;
    const rangedFoes = foes.filter((f) => this.abilities(f).some((id) => ABIL[id].ranged));
    let best = { score: -1e9 };
    for (const [k, e] of reach) {
      if (!e.stop) continue;
      const [x, y] = g.xy(k);
      if (beh === "guard" && u.post && dist(x, y, u.post[0], u.post[1]) > 2) continue;
      let pos = -e.c * 0.02;
      if (hurt && dist(x, y, hurt.x, hurt.y) <= 2) pos += 1.5;
      if (beh === "sniper" && foes.some((f) => dist(f.x, f.y, x, y) <= 2)) pos -= 2;
      if (g.fire[k]) pos -= 7;
      if (e.c) pos -= 3 * pathTo(g, reach, k).slice(1, -1).filter(([px, py]) => g.fire[g.i(px, py)]).length;
      for (const [dx, dy] of N8) if (g.in(x + dx, y + dy) && g.get(x + dx, y + dy) === T.CORRUPT) pos -= 4;
      if (u.cls === "rogue" && g.get(x, y) === T.BUSH) pos += 2.5;
      if (u.cls === "ranger" && g.isAdjTo(x, y, T.TREE)) pos += 0.8;
      for (const f of rangedFoes) {
        const d = dist(f.x, f.y, x, y);
        if (d > 1 && d <= 7 && lineOfSight(g, f.x, f.y, x, y)) pos -= halfCover(g, f.x, f.y, x, y) ? 0.3 : 1;
      }
      const fd = field[k] === 999 ? 30 : field[k];
      pos -= Math.max(0, fd - pref) * 0.5;
      if (pref > 1 && foes.some((f) => dist(f.x, f.y, x, y) <= 1)) pos -= 2.5;
      const act = this.bestAction(u, x, y);
      const healBoost = beh === "medic" && act.act && ABIL[act.act.id].kind === "heal" ? 2 : 1;
      const total = pos + act.score * 2 * healBoost;
      if (total > best.score) best = { score: total, move: [x, y], act: act.act };
    }
    if (!best.move) best = { score: 0, move: null, act: this.bestAction(u, u.x, u.y).act };
    return best;
  }
};

// supabase/functions/_shared/arena/src/economy.js
var START = { rating: 1200, gold: 150, herbs: 6, berries: 6 };
var TIERS = [
  { name: "Common", color: "#c9c9c9", dmg: 0, hp: 0, acc: 0 },
  { name: "Uncommon", color: "#62d66a", dmg: 1, hp: 2, acc: 0 },
  { name: "Rare", color: "#4aa3ff", dmg: 2, hp: 4, acc: 5 },
  { name: "Epic", color: "#b763ff", dmg: 3, hp: 7, acc: 5 },
  { name: "Legendary", color: "#ffb020", dmg: 4, hp: 10, acc: 10 }
];
var UPGRADE_COST = [120, 320, 750, 1600];
var upgradeCost = (tier) => UPGRADE_COST[tier] ?? null;
var MAX_LEVEL = 5;
var LEVEL_COST = [0, 250, 600, 1200, 2200];
var buildBudget = (level) => 20 + level * 6;
var HARVEST = { herbBase: 1, herbPerGrass: 0.12, berryBase: 0.5, berryPerBush: 0.6, capHours: 16, maxCap: 60 };
function harvestRates(layout) {
  let grass = 0, bush = 0;
  for (const t of layout.tiles) {
    if (t === T.GRASS || t === T.OVERGROWN) grass++;
    else if (t === T.BUSH) bush++;
  }
  return { herbs: HARVEST.herbBase + grass * HARVEST.herbPerGrass, berries: HARVEST.berryBase + bush * HARVEST.berryPerBush };
}
function pendingHarvest(layout, harvestedAt, now) {
  const hours = Math.max(0, Math.min(HARVEST.capHours, (now - harvestedAt) / 36e5));
  const r = harvestRates(layout);
  return { herbs: Math.min(HARVEST.maxCap, Math.floor(r.herbs * hours)), berries: Math.min(HARVEST.maxCap, Math.floor(r.berries * hours)) };
}
var RECIPES = {
  potion: { name: "Healing Potion", cost: { herbs: 5 }, desc: "In-raid Potion Flask: +8 HP to an ally (uses an action).", max: 3 },
  ale: { name: "Mug of Ale", cost: { berries: 5 }, desc: "+2 damage for your whole party for one raid.", max: 2 },
  tonic: { name: "Forest Tonic", cost: { herbs: 3, berries: 3 }, desc: "+1 move for your whole party for one raid.", max: 2 }
};
var RAID_CARRY = { potion: 2, ale: 1, tonic: 1 };
var K = 32;
var expected = (ra, rb) => 1 / (1 + 10 ** ((rb - ra) / 400));
function eloDelta(attacker, defender, attackerWon) {
  const d = Math.round(K * ((attackerWon ? 1 : 0) - expected(attacker, defender)));
  return { attacker: d, defender: -d };
}
var LEAGUES = [
  { name: "Bronze", min: 0, color: "#c98b4e" },
  { name: "Silver", min: 1100, color: "#cfd8e3" },
  { name: "Gold", min: 1300, color: "#ffd54a" },
  { name: "Platinum", min: 1500, color: "#6fe6d8" },
  { name: "Diamond", min: 1700, color: "#9fb4ff" }
];
function league(rating) {
  let l = LEAGUES[0];
  for (const x of LEAGUES) if (rating >= x.min) l = x;
  return l;
}
function raidRewards(won, defenderRating, defenderLevel) {
  if (!won) return { gold: 15, herbs: 0, berries: 0 };
  return { gold: 60 + Math.max(0, Math.round((defenderRating - 900) / 12)) + defenderLevel * 12, herbs: 2, berries: 2 };
}
var DEFENSE_REWARD = 25;
var SEASON_DAYS = 28;
var seasonReset = (r) => Math.round(1200 + (r - 1200) * 0.5);
function dailyBonus(streak) {
  return 25 + 10 * Math.min(streak, 7);
}

// supabase/functions/_shared/arena/src/stronghold.js
var ATTACK_ROWS = [0, 1];
var DEFENSE_MIN_ROW = 6;
var ATTACK_SPAWNS = [[5, 0], [6, 0], [4, 0], [7, 0]];
var RAID_ROUNDS = 20;
var DEFENDER_TINT = 16755082;
var BUILD_COST = {
  [T.GROUND]: 0,
  [T.GRASS]: 0,
  [T.OVERGROWN]: 1,
  [T.BUSH]: 1,
  [T.BARE]: 1,
  [T.BOULDER]: 2,
  [T.TREE]: 2,
  [T.PILLAR]: 3,
  [T.CORRUPT]: 3
};
var PALETTE = [T.GROUND, T.GRASS, T.OVERGROWN, T.BUSH, T.BOULDER, T.PILLAR, T.TREE, T.BARE, T.CORRUPT];
var BEHAVIORS = {
  aggressive: { name: "Aggressive", desc: "Hunts the nearest raider." },
  guard: { name: "Guard", desc: "Never strays more than 2 tiles from its post." },
  hold: { name: "Hold", desc: "Never moves; strikes whatever comes in range." },
  ambush: { name: "Ambush", desc: "Waits until a raider comes within 4 tiles (or it is hurt), then attacks." },
  sniper: { name: "Sniper", desc: "Keeps its distance and prefers cover." },
  medic: { name: "Medic", desc: "Stays near the most wounded ally and prioritises heals." }
};
var layoutCost = (layout) => layout.tiles.reduce((s, t) => s + (BUILD_COST[t] ?? 99), 0);
function toGrid(layout, seed = 1) {
  const g = new Grid(), r = rng(seed ^ 2654435769);
  for (let i = 0; i < W * H; i++) {
    g.t[i] = layout.tiles[i];
    g.v[i] = Math.floor(r() * 256);
  }
  return g;
}
function flood2(g, sx, sy) {
  const seen = new Uint8Array(W * H), q = [g.i(sx, sy)];
  seen[q[0]] = 1;
  for (let h = 0; h < q.length; h++) {
    const [x, y] = g.xy(q[h]);
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (!g.in(nx, ny) || g.blocked(nx, ny)) continue;
      const k = g.i(nx, ny);
      if (!seen[k]) {
        seen[k] = 1;
        q.push(k);
      }
    }
  }
  return seen;
}
function validate(layout, garrison, level, { bot = false } = {}) {
  const errs = [];
  if (!layout || !Array.isArray(layout.tiles) || layout.tiles.length !== W * H) return ["Layout must have 144 tiles."];
  if (layout.tiles.some((t) => !(t in BUILD_COST))) errs.push("Layout contains an unknown tile.");
  const openRow = (y) => layout.tiles.slice(y * W, y * W + W).every((t) => t === T.GROUND || t === T.GRASS);
  if (!ATTACK_ROWS.every(openRow)) errs.push("The two raider deployment rows must stay open (clearing or grass).");
  const cost = layoutCost(layout), budget = buildBudget(level);
  if (!bot && cost > budget) errs.push(`Over budget: ${cost} / ${budget} build points.`);
  if (!Array.isArray(garrison) || garrison.length !== 4) errs.push("The garrison needs exactly 4 defenders.");
  else {
    const g = toGrid(layout), seen = flood2(g, ATTACK_SPAWNS[0][0], ATTACK_SPAWNS[0][1]), spots = /* @__PURE__ */ new Set();
    garrison.forEach((d, i) => {
      const tag = `Defender ${i + 1}`;
      if (!CLASSES[d.cls]) errs.push(`${tag}: unknown class.`);
      if (!BEHAVIORS[d.behavior]) errs.push(`${tag}: unknown behavior.`);
      if (!Number.isInteger(d.x) || !Number.isInteger(d.y) || !g.in(d.x, d.y)) {
        errs.push(`${tag}: not on the board.`);
        return;
      }
      if (d.y < DEFENSE_MIN_ROW) errs.push(`${tag}: must be placed in rows ${DEFENSE_MIN_ROW + 1}-${H}.`);
      if (g.blocked(d.x, d.y)) errs.push(`${tag}: standing inside ${TILE[g.get(d.x, d.y)].name.toLowerCase()}.`);
      else if (!seen[g.i(d.x, d.y)]) errs.push(`${tag}: raiders have no path to it (strongholds can't be sealed).`);
      const key = `${d.x},${d.y}`;
      if (spots.has(key)) errs.push(`${tag}: shares a tile.`);
      spots.add(key);
    });
  }
  return errs;
}
function applyTier(u, tier = 0) {
  const t = TIERS[Math.max(0, Math.min(TIERS.length - 1, tier | 0))];
  u.tier = tier | 0;
  u.mods.dmg = (u.mods.dmg || 0) + t.dmg;
  u.mods.acc = (u.mods.acc || 0) + t.acc;
  u.maxHp += t.hp;
  u.hp = u.maxHp;
  return u;
}
function buildRaid({ attack, defense, seed }) {
  const grid = toGrid(defense.layout, seed), units = [];
  const cons = attack.consumables || {};
  attack.party.forEach((cls, i) => {
    const u = applyTier(makeUnit({ cls, gear: [] }, "player"), attack.tiers?.[cls] || 0);
    if (cons.ale) u.mods.dmg += 2;
    if (cons.tonic) u.move += 1;
    [u.x, u.y] = ATTACK_SPAWNS[i];
    u.aura = attack.aura || null;
    units.push(u);
  });
  defense.garrison.forEach((d) => {
    const u = applyTier(makeUnit({ cls: d.cls, gear: [] }, "enemy", { tint: DEFENDER_TINT }), d.tier || 0);
    u.x = d.x;
    u.y = d.y;
    u.behavior = d.behavior;
    u.aura = defense.aura || null;
    units.push(u);
  });
  return { grid, units, opts: { seed, consumables: { potion: cons.potion || 0 }, maxRounds: RAID_ROUNDS } };
}
function defaultStronghold() {
  const tiles = new Array(W * H).fill(T.GROUND);
  const set = (x, y, t) => {
    tiles[y * W + x] = t;
  };
  for (let i = 0; i < W * H; i++) if (i * 7919 % 5 === 0) tiles[i] = T.GRASS;
  [[2, 5], [3, 5], [8, 5], [9, 5]].forEach(([x, y]) => set(x, y, T.TREE));
  [[5, 7], [6, 7], [1, 8]].forEach(([x, y]) => set(x, y, T.BOULDER));
  [[4, 9], [10, 9], [7, 10]].forEach(([x, y]) => set(x, y, T.BUSH));
  return {
    layout: { tiles },
    garrison: [
      { cls: "knight", behavior: "guard", x: 5, y: 8 },
      { cls: "barbarian", behavior: "ambush", x: 8, y: 8 },
      { cls: "ranger", behavior: "sniper", x: 3, y: 10 },
      { cls: "wizard", behavior: "medic", x: 7, y: 11 }
    ]
  };
}
var BOT_NAMES = ["Grey Ravens", "Ashen Fangs", "Crimson Oath", "Thornwake Co.", "Iron Lanterns", "Duskmire Pact", "Mossback Wardens", "Hollow Crown"];
var BOT_COUNT = BOT_NAMES.length;
function botStronghold(i) {
  const r = rng(4242 + i * 97), rating = 900 + i * 85;
  const { grid, eSpawn } = generateMap(7e3 + i * 13, Math.min(6, i));
  const tiles = Array.from(grid.t);
  for (const y of ATTACK_ROWS) for (let x = 0; x < W; x++) if (tiles[y * W + x] !== T.GRASS) tiles[y * W + x] = T.GROUND;
  const behaviors = Object.keys(BEHAVIORS), tier = Math.max(0, Math.min(4, Math.floor((rating - 900) / 170)));
  const garrison = eSpawn.slice(0, 4).map(([x, y]) => ({ cls: CLASS_KEYS[Math.floor(r() * 6)], behavior: behaviors[Math.floor(r() * behaviors.length)], x, y, tier }));
  return { name: BOT_NAMES[i], rating, level: Math.min(5, 1 + Math.floor(i / 2)), layout: { tiles }, garrison };
}

// supabase/functions/_shared/arena/src/server-core.js
var GameError = class extends Error {
};
var fail = (msg) => {
  throw new GameError(msg);
};
var botId = (i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
var DAY = 864e5;
var HOUR = 36e5;
var RAID_COOLDOWN = 6 * HOUR;
var RAID_EXPIRY = HOUR;
var DEFENSE_SIM_EVERY = 3 * HOUR;
function newProfile(id, name, now, extra = {}) {
  return {
    id,
    name,
    isBot: false,
    rating: START.rating,
    peak: START.rating,
    gold: START.gold,
    herbs: START.herbs,
    berries: START.berries,
    harvestedAt: now - 2 * HOUR,
    level: 1,
    tiers: Object.fromEntries(CLASS_KEYS.map((k) => [k, 0])),
    consumables: { potion: 1, ale: 0, tonic: 0 },
    aura: null,
    wins: 0,
    losses: 0,
    defWins: 0,
    defLosses: 0,
    lastDaily: null,
    streak: 0,
    lastSim: now,
    createdAt: now,
    ...extra
  };
}
var snapshotGarrison = (garrison, tiers) => garrison.map((d) => ({ cls: d.cls, behavior: d.behavior, x: d.x, y: d.y, tier: tiers[d.cls] || 0 }));
var dayKey = (t) => new Date(t).toISOString().slice(0, 10);
function createCore(store) {
  const now = () => store.now();
  async function ensureWorld() {
    let s = await store.getSeason();
    if (!s) {
      s = { id: 1, starts: now(), ends: now() + SEASON_DAYS * DAY };
      await store.putSeason(s);
    } else if (now() > s.ends) s = await closeSeason(s);
    if (!await store.getProfile(botId(BOT_COUNT - 1))) {
      for (let i = 0; i < BOT_COUNT; i++) {
        const b = botStronghold(i), id = botId(i);
        await store.putProfile(newProfile(id, b.name, now(), { isBot: true, rating: b.rating, peak: b.rating, level: b.level }));
        await store.putStronghold({ owner: id, version: 1, layout: b.layout, garrison: b.garrison, updatedAt: now() });
      }
    }
    return s;
  }
  async function closeSeason(s) {
    for (const p of await store.allProfiles()) {
      if (p.isBot) continue;
      const peak = league(p.peak);
      if (peak.min > 0) p.aura = peak.name;
      p.rating = seasonReset(p.rating);
      p.peak = p.rating;
      await store.putProfile(p);
    }
    const next = { id: s.id + 1, starts: now(), ends: now() + SEASON_DAYS * DAY };
    await store.putSeason(next);
    return next;
  }
  async function mustProfile(uid) {
    return await store.getProfile(uid) || fail("No profile yet: pick a name first.");
  }
  async function state(p, extra = {}) {
    const sh = await store.getStronghold(p.id);
    const log = (await store.raidsAgainst(p.id, 8)).map((r) => ({
      at: r.finishedAt,
      attacker: r.attackerName,
      held: r.result !== "win",
      delta: r.deltas?.defender ?? 0
    }));
    return {
      profile: p,
      stronghold: sh,
      pending: sh ? pendingHarvest(sh.layout, p.harvestedAt, now()) : null,
      league: league(p.rating),
      season: await store.getSeason(),
      defenseLog: log,
      now: now(),
      ...extra
    };
  }
  async function simulateDefense(p) {
    if (now() - p.lastSim < DEFENSE_SIM_EVERY) return null;
    p.lastSim = now();
    const sh = await store.getStronghold(p.id);
    if (!sh) return null;
    const bots = (await store.bots()).sort((a, b2) => Math.abs(a.rating - p.rating) - Math.abs(b2.rating - p.rating));
    const bot = bots[Math.floor(p.lastSim / 1e3 % Math.min(3, bots.length))];
    const seed = Math.floor(Math.random() * 2 ** 31);
    const party = Array.from({ length: 4 }, (_, i) => CLASS_KEYS[(seed >> i * 3) % 6]);
    const tier = Math.max(0, Math.min(4, Math.floor((bot.rating - 900) / 170)));
    const attack = { party, tiers: Object.fromEntries(CLASS_KEYS.map((k) => [k, tier])), consumables: {}, aura: null };
    const defense = { layout: sh.layout, garrison: sh.garrison, aura: p.aura };
    const setup = buildRaid({ attack, defense, seed });
    const b = new Battle({ grid: setup.grid, units: setup.units, ...setup.opts });
    while (!b.over) {
      await b.runAI("player");
      if (!b.over) await b.endPlayerTurn();
    }
    const won = b.result === "win", d = eloDelta(bot.rating, p.rating, won);
    p.rating = Math.max(0, p.rating + d.defender);
    p.peak = Math.max(p.peak, p.rating);
    if (won) p.defLosses++;
    else {
      p.defWins++;
      p.gold += DEFENSE_REWARD;
    }
    const raid = {
      id: store.newId(),
      attacker: bot.id,
      defender: p.id,
      attackerName: bot.name,
      defenderName: p.name,
      status: "done",
      seed,
      attack,
      defense: { ...defense, version: sh.version },
      result: b.result,
      deltas: { attacker: 0, defender: d.defender },
      rounds: b.round,
      createdAt: now(),
      finishedAt: now(),
      simulated: true
    };
    await store.putRaid(raid);
    return { attacker: bot.name, held: !won, delta: d.defender };
  }
  const actions = {
    async me(uid) {
      await ensureWorld();
      const p = await store.getProfile(uid);
      if (!p) return { profile: null };
      const extra = {};
      const today = dayKey(now());
      if (p.lastDaily !== today) {
        p.streak = p.lastDaily === dayKey(now() - DAY) ? p.streak + 1 : 1;
        p.lastDaily = today;
        extra.daily = { gold: dailyBonus(p.streak), streak: p.streak };
        p.gold += extra.daily.gold;
      }
      const def = await simulateDefense(p);
      if (def) extra.defense = def;
      await store.putProfile(p);
      return state(p, extra);
    },
    async register(uid, { name } = {}) {
      await ensureWorld();
      const existing = await store.getProfile(uid);
      if (existing) return state(existing);
      const clean = String(name || "").replace(/[^\p{L}\p{N} _'-]/gu, "").trim().slice(0, 20);
      if (clean.length < 2) fail("Pick a name of at least 2 letters.");
      const p = newProfile(uid, clean, now());
      const d = defaultStronghold();
      await store.putProfile(p);
      await store.putStronghold({ owner: uid, version: 1, layout: d.layout, garrison: snapshotGarrison(d.garrison, p.tiers), updatedAt: now() });
      return actions.me(uid);
    },
    async saveStronghold(uid, { layout, garrison } = {}) {
      const p = await mustProfile(uid);
      const errs = validate(layout, garrison, p.level);
      if (errs.length) fail(errs.join(" "));
      const old = await store.getStronghold(uid);
      await store.putStronghold({ owner: uid, version: (old?.version || 0) + 1, layout: { tiles: layout.tiles.map(Number) }, garrison: snapshotGarrison(garrison, p.tiers), updatedAt: now() });
      return state(p);
    },
    async upgradeGear(uid, { cls } = {}) {
      const p = await mustProfile(uid);
      if (!CLASSES[cls]) fail("Unknown class.");
      const tier = p.tiers[cls] || 0, cost = upgradeCost(tier);
      if (cost == null) fail("Already Legendary.");
      if (p.gold < cost) fail(`Need ${cost} gold.`);
      p.gold -= cost;
      p.tiers[cls] = tier + 1;
      await store.putProfile(p);
      const sh = await store.getStronghold(uid);
      if (sh) {
        sh.garrison = snapshotGarrison(sh.garrison, p.tiers);
        await store.putStronghold(sh);
      }
      return state(p);
    },
    async upgradeStronghold(uid) {
      const p = await mustProfile(uid);
      if (p.level >= MAX_LEVEL) fail("Stronghold is at max level.");
      const cost = LEVEL_COST[p.level];
      if (p.gold < cost) fail(`Need ${cost} gold.`);
      p.gold -= cost;
      p.level++;
      await store.putProfile(p);
      return state(p);
    },
    async harvest(uid) {
      const p = await mustProfile(uid), sh = await store.getStronghold(uid);
      const got = pendingHarvest(sh.layout, p.harvestedAt, now());
      p.herbs += got.herbs;
      p.berries += got.berries;
      p.harvestedAt = now();
      await store.putProfile(p);
      return state(p, { harvested: got });
    },
    async craft(uid, { recipe } = {}) {
      const p = await mustProfile(uid), r = RECIPES[recipe] || fail("Unknown recipe.");
      if ((p.consumables[recipe] || 0) >= 9) fail("Your satchel is full of those.");
      if ((r.cost.herbs || 0) > p.herbs || (r.cost.berries || 0) > p.berries) fail("Not enough herbs or berries.");
      p.herbs -= r.cost.herbs || 0;
      p.berries -= r.cost.berries || 0;
      p.consumables[recipe] = (p.consumables[recipe] || 0) + 1;
      await store.putProfile(p);
      return state(p);
    },
    async findTarget(uid, { skip = [] } = {}) {
      await ensureWorld();
      const p = await mustProfile(uid);
      const recent = new Set(await store.recentTargets(uid, now() - RAID_COOLDOWN));
      const pool = (await store.nearby(p.rating, 40)).filter((o) => o.id !== uid && !skip.includes(o.id) && !recent.has(o.id));
      if (!pool.length) fail("No strongholds left to raid right now \u2014 check back later.");
      const near = pool.filter((o) => Math.abs(o.rating - p.rating) <= 250);
      const list = (near.length ? near : pool).sort((a, b) => Math.abs(a.rating - p.rating) - Math.abs(b.rating - p.rating));
      const t = list[Math.floor(Math.random() * Math.min(3, list.length))];
      const sh = await store.getStronghold(t.id);
      return {
        id: t.id,
        name: t.name,
        rating: t.rating,
        league: league(t.rating),
        level: t.level,
        isBot: t.isBot,
        aura: t.aura,
        garrison: sh.garrison.map((d) => ({ cls: d.cls, behavior: d.behavior, tier: d.tier })),
        winDelta: eloDelta(p.rating, t.rating, true).attacker,
        lossDelta: eloDelta(p.rating, t.rating, false).attacker,
        reward: raidRewards(true, t.rating, t.level)
      };
    },
    async startRaid(uid, { defenderId, party, consumables = {} } = {}) {
      const p = await mustProfile(uid);
      if (!Array.isArray(party) || party.length !== 4 || party.some((c) => !CLASSES[c])) fail("Pick a raiding party of 4.");
      const open = await store.openRaidOf(uid);
      if (open) await resolve(open, null, "abandoned");
      if (defenderId === uid) fail("You cannot raid yourself.");
      const def = await store.getProfile(defenderId), sh = await store.getStronghold(defenderId);
      if (!def || !sh) fail("That stronghold is gone.");
      const cons = {};
      for (const k of Object.keys(RAID_CARRY)) {
        const n = Math.max(0, Math.min(RAID_CARRY[k], consumables[k] | 0));
        if (n > (p.consumables[k] || 0)) fail(`You don't have enough ${RECIPES[k].name}.`);
        cons[k] = n;
        p.consumables[k] -= n;
      }
      await store.putProfile(p);
      const raid = {
        id: store.newId(),
        attacker: uid,
        defender: def.id,
        attackerName: p.name,
        defenderName: def.name,
        status: "open",
        seed: Math.floor(Math.random() * 2 ** 31),
        createdAt: now(),
        attack: { party, tiers: { ...p.tiers }, consumables: cons, aura: p.aura },
        defense: { layout: sh.layout, garrison: sh.garrison, aura: def.aura, version: sh.version },
        ratings: { attacker: p.rating, defender: def.rating },
        defenderLevel: def.level
      };
      await store.putRaid(raid);
      return { raid: publicRaid(raid), league: league(def.rating) };
    },
    async finishRaid(uid, { raidId, actions: log } = {}) {
      const raid = await store.getRaid(raidId);
      if (!raid || raid.attacker !== uid) fail("Unknown raid.");
      if (raid.status !== "open") fail("This raid is already settled.");
      if (!Array.isArray(log) || log.length > 3e3) fail("Bad raid log.");
      const expired = now() - raid.createdAt > RAID_EXPIRY;
      return resolve(raid, expired ? null : log, expired ? "expired" : null);
    },
    async leaderboard(uid) {
      const p = await store.getProfile(uid);
      const top = (await store.top(50)).map((o) => ({ id: o.id, name: o.name, rating: o.rating, league: league(o.rating).name, aura: o.aura, isBot: o.isBot, wins: o.wins, defWins: o.defWins }));
      return { top, me: p ? { rank: await store.rankOf(p.rating) + 1, rating: p.rating } : null, season: await store.getSeason() };
    }
  };
  async function resolve(raid, log, reason) {
    let result = "lose", rounds = 0, valid = true;
    if (log) {
      const setup = buildRaid({ attack: raid.attack, defense: raid.defense, seed: raid.seed });
      const b = new Battle({ grid: setup.grid, units: setup.units, ...setup.opts });
      valid = await b.replay(log);
      result = valid && b.over ? b.result : "lose";
      rounds = b.round;
      if (!valid) reason = "invalid";
      else if (!b.over) reason = "retreated";
    }
    const att = await store.getProfile(raid.attacker), def = await store.getProfile(raid.defender);
    const won = result === "win", d = eloDelta(att.rating, def.rating, won), rew = raidRewards(won, def.rating, raid.defenderLevel || def.level);
    att.rating = Math.max(0, att.rating + d.attacker);
    att.peak = Math.max(att.peak, att.rating);
    att.gold += rew.gold;
    att.herbs += rew.herbs;
    att.berries += rew.berries;
    won ? att.wins++ : att.losses++;
    await store.putProfile(att);
    if (!def.isBot) {
      def.rating = Math.max(0, def.rating + d.defender);
      def.peak = Math.max(def.peak, def.rating);
      if (won) def.defLosses++;
      else {
        def.defWins++;
        def.gold += DEFENSE_REWARD;
      }
      await store.putProfile(def);
    }
    Object.assign(raid, { status: "done", result, reason: reason || null, rounds, deltas: { attacker: d.attacker, defender: def.isBot ? 0 : d.defender }, rewards: rew, finishedAt: now(), actions: log ? log.length : 0 });
    await store.putRaid(raid);
    return { result, reason: reason || null, rewards: rew, ratingDelta: d.attacker, rounds, ...await state(att) };
  }
  const publicRaid = (r) => ({ id: r.id, seed: r.seed, attack: r.attack, defense: r.defense, attackerName: r.attackerName, defenderName: r.defenderName, ratings: r.ratings });
  return {
    actions,
    async handle(uid, action, payload) {
      if (!uid) return { error: "Not signed in." };
      const fn = actions[action];
      if (!fn) return { error: `Unknown action ${action}` };
      try {
        return await fn(uid, payload || {});
      } catch (e) {
        if (e instanceof GameError) return { error: e.message };
        throw e;
      }
    }
  };
}

// supabase/functions/_shared/store-supabase.js
function createSupabaseStore(sb, { clock = () => Date.now() } = {}) {
  const must = ({ data, error }) => {
    if (error) throw new Error(error.message || String(error));
    return data;
  };
  const P = "arena_profiles", S = "arena_strongholds", R = "arena_raids", SE = "arena_seasons";
  const rows = (q) => (must(q) || []).map((r) => r.data);
  async function pagedProfiles(filter = (q) => q) {
    const out = [];
    for (let from = 0; ; from += 1e3) {
      const page = rows(await filter(sb.from(P).select("data")).order("rating", { ascending: false }).range(from, from + 999));
      out.push(...page);
      if (page.length < 1e3) return out;
    }
  }
  return {
    now: clock,
    newId: () => crypto.randomUUID(),
    async getProfile(id) {
      return must(await sb.from(P).select("data").eq("id", id).maybeSingle())?.data ?? null;
    },
    async putProfile(p) {
      must(await sb.from(P).upsert({ id: p.id, name: p.name, rating: p.rating, is_bot: !!p.isBot, data: p, updated_at: new Date(clock()).toISOString() }));
    },
    allProfiles: () => pagedProfiles(),
    bots: () => pagedProfiles((q) => q.eq("is_bot", true)),
    async nearby(rating, limit) {
      const up = rows(await sb.from(P).select("data").gte("rating", rating).order("rating", { ascending: true }).limit(limit));
      const down = rows(await sb.from(P).select("data").lt("rating", rating).order("rating", { ascending: false }).limit(limit));
      return [...up, ...down].sort((a, b) => Math.abs(a.rating - rating) - Math.abs(b.rating - rating)).slice(0, limit);
    },
    async top(limit) {
      return rows(await sb.from(P).select("data").order("rating", { ascending: false }).limit(limit));
    },
    async rankOf(rating) {
      const r = await sb.from(P).select("id", { count: "exact", head: true }).gt("rating", rating);
      must(r);
      return r.count || 0;
    },
    async getStronghold(owner) {
      return must(await sb.from(S).select("data").eq("owner", owner).maybeSingle())?.data ?? null;
    },
    async putStronghold(s) {
      must(await sb.from(S).upsert({ owner: s.owner, version: s.version, data: s, updated_at: new Date(clock()).toISOString() }));
    },
    async getRaid(id) {
      return must(await sb.from(R).select("data").eq("id", id).maybeSingle())?.data ?? null;
    },
    async putRaid(r) {
      must(await sb.from(R).upsert({ id: r.id, attacker: r.attacker, defender: r.defender, status: r.status, created_at: r.createdAt, finished_at: r.finishedAt ?? null, data: r }));
    },
    async openRaidOf(attacker) {
      return rows(await sb.from(R).select("data").eq("attacker", attacker).eq("status", "open").limit(1))[0] ?? null;
    },
    async raidsAgainst(defender, limit) {
      return rows(await sb.from(R).select("data").eq("defender", defender).eq("status", "done").order("finished_at", { ascending: false }).limit(limit));
    },
    async recentTargets(attacker, since) {
      return (must(await sb.from(R).select("defender").eq("attacker", attacker).gte("created_at", since)) || []).map((r) => r.defender);
    },
    async getSeason() {
      return rows(await sb.from(SE).select("data").order("id", { ascending: false }).limit(1))[0] ?? null;
    },
    async putSeason(s) {
      must(await sb.from(SE).upsert({ id: s.id, data: s }));
    }
  };
}

// supabase/functions/arena/index.ts
var cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
var json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
var serverKey = Deno.env.get("ARENA_SECRET_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
var admin = createClient(Deno.env.get("SUPABASE_URL"), serverKey, { auth: { persistSession: false } });
var core = createCore(createSupabaseStore(admin));
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return json({ error: "Not signed in." }, 401);
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad JSON" }, 400);
  }
  const { action, ...payload } = body;
  try {
    return json(await core.handle(data.user.id, String(action), payload));
  } catch (e) {
    console.error(e);
    return json({ error: "Server error" }, 500);
  }
});
