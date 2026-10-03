// A scripted player for Wildwood Colony: lays roads, places a canonical town, upgrades houses and
// "sends the hero" (direct sim calls) for relics. Used as the balance smoke test.
import { Colony } from '../public/relic/src/sim.js';
import { BUILDINGS, W, H, TIERS } from '../public/relic/src/data.js';
import { idx, inMap, T } from '../public/relic/src/map.js';

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class Bot {
  constructor(c, log = () => {}) { this.c = c; this.log = log; this.th = c.ofType('townhall')[0]; }

  free(x, y) { const c = this.c, k = idx(x, y); return inMap(x, y) && c.fog[k] && c.owned[k] && c.ground[k] === T.GRASS && !c.occ[k] && !c.road[k] && !c.depositAt(x, y); }

  /** BFS a road from tiles around building b to the existing road network. */
  connect(b) {
    const c = this.c;
    if (c.doorTiles(b).some(k => c.roadDist?.[k] >= 0)) return true;
    const prev = new Map(), q = [];
    for (let i = -1; i <= b.w; i++) for (let j = -1; j <= b.h; j++) {
      if ((i === -1 || i === b.w) === (j === -1 || j === b.h)) continue;
      const x = b.x + i, y = b.y + j;
      if (!inMap(x, y)) continue;
      const k = idx(x, y);
      if (c.road[k] || this.free(x, y)) { prev.set(k, -1); q.push(k); }
    }
    for (let h = 0; h < q.length; h++) {
      const k = q[h];
      if (c.road[k] && c.roadDist?.[k] >= 0) {
        for (let p = k; p !== -1; p = prev.get(p)) { const x = p % W, y = (p / W) | 0; if (!c.road[p]) c.buildRoad(x, y); }
        c.recompute();
        return true;
      }
      const x = k % W, y = (k / W) | 0;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (!inMap(nx, ny)) continue;
        const j = idx(nx, ny);
        if (prev.has(j) || !(c.road[j] || this.free(nx, ny))) continue;
        prev.set(j, k); q.push(j);
      }
    }
    return false;
  }

  /** Place `type` at the valid spot closest to (ax, ay) (scored), then connect it. */
  place(type, ax = this.th.cx, ay = this.th.cy, score = null) {
    const c = this.c, [w, h] = BUILDINGS[type].size;
    if (!c.affordable(c.costOf(type))) return null;
    let best = null;
    const R = 26;
    for (let y = Math.max(1, Math.floor(ay - R)); y < Math.min(H - h, ay + R); y++) for (let x = Math.max(1, Math.floor(ax - R)); x < Math.min(W - w, ax + R); x++) {
      if (c.placeError(type, x, y)) continue;
      let blocked = false;
      for (let j = 0; j < h && !blocked; j++) for (let i = 0; i < w; i++) if (c.depositAt(x + i, y + j) && !BUILDINGS[type].on) { blocked = true; break; }
      if (blocked) continue;
      // keep a one-tile ring free for roads
      let ring = 0;
      for (let i = -1; i <= w; i++) for (const j of [-1, h]) if (inMap(x + i, y + j) && (c.road[idx(x + i, y + j)] || this.free(x + i, y + j))) ring++;
      if (!ring) continue;
      const s = (score ? score(x, y, w, h) : 0) + Math.hypot(x + w / 2 - ax, y + h / 2 - ay);
      if (!best || s < best.s) best = { x, y, s };
    }
    if (!best) return null;
    const b = c.build(type, best.x, best.y);
    if (b.error) return null;
    this.ensureConnected(b, type);
    return b;
  }

  /** Road it; if it is beyond every storage's range, put a Warehouse next to it. */
  ensureConnected(b, type = b.type) {
    const c = this.c;
    if (!this.connect(b)) this.log(`could not connect ${type}`);
    c.recompute();
    if (!b.connected && type !== 'warehouse' && c.affordable(c.costOf('warehouse'))) {
      const w = this.place('warehouse', b.cx, b.cy); if (w) { this.connect(b); c.recompute(); }
    }
  }

  treesNear(x, y, r = 5) { return -this.c.nearCount(x + 1, y + 1, { what: 'tree', r }) * 2; }

  /** Pretend the hero walks out, clears the relic lair and brings the relic home. */
  fetchRelic() {
    const c = this.c, l = c.lairs.filter(q => q.relic && !q.relicTaken).sort((a, b) => Math.hypot(a.x - this.th.cx, a.y - this.th.cy) - Math.hypot(b.x - this.th.cx, b.y - this.th.cy))[0];
    if (!l) return false;
    c.heroAt(l.x + 1, l.y + 1); c.clearLair(l.id); c.takeRelic(l.id); c.heroAt(this.th.cx, this.th.cy + 3); c.deliverRelic();
    return true;
  }

  run(minutes, plan) {
    for (let t = 0; t < minutes * 60; t += 5) { plan(this, t); this.c.step(5); }
  }
}

/** The canonical build order: a demand-driven planner. Returns the colony and milestones (minutes). */
export function playthrough(seed = 3, { minutes = 240, log = () => {} } = {}) {
  const c = new Colony({ seed }), bot = new Bot(c, log), ms = {};
  const mark = k => { if (!(k in ms)) ms[k] = +(c.time / 60).toFixed(1); };
  const want = (type, n, score) => { n = Math.ceil(n); while (c.count(type) < n) { if (!bot.place(type, undefined, undefined, score)) return false; } return true; };
  const trees = (x, y) => bot.treesNear(x, y);
  const rocks = (x, y) => -c.nearCount(x + 1, y + 1, { what: 'rock', r: 3 }) * 5;
  const mine = (kind, n = 1) => {
    const type = kind === 'iron' ? 'ironmine' : 'goldmine';
    if (c.ofType(type).length >= n) return true;
    const d = c.deposits.filter(q => q.kind === kind && !c.ofType(type).some(m => m.x === q.x && m.y === q.y)).sort((a, z) => Math.hypot(a.x - bot.th.cx, a.y - bot.th.cy) - Math.hypot(z.x - bot.th.cx, z.y - bot.th.cy))[0];
    if (!d) return c.ofType(type).length > 0;
    if (!d.found) c.heroAt(d.x, d.y); // the hero scouts it
    if (!c.owned[idx(d.x, d.y)]) { if (!c.ofType('outpost').some(o => Math.hypot(o.cx - d.x, o.cy - d.y) < 10)) bot.place('outpost', d.x, d.y); return false; }
    const m = c.build(type, d.x, d.y); if (!m.error) bot.ensureConnected(m);
    return !m.error;
  };
  bot.run(minutes, (b, sec) => {
    for (const x of c.buildings.values()) if ((x.fire || x.ruined) && c.affordable(c.repairCost(x))) c.repair(x.id);
    if (sec % 60 === 0) for (const x of [...c.buildings.values()]) if (!x.connected && x.type !== 'outpost') b.ensureConnected(x);
    const P = c.pop, S = P.settlers, C = P.craftsmen, M = P.merchants;
    // basics
    want('lumberjack', 2, trees) && want('sawmill', 1) && want('hunter', 1, trees) && want('hut', 6) && want('market', 1);
    if (!c.count('market')) return;
    want('forester', Math.max(1, c.count('lumberjack') * 0.6), trees);
    want('hunter', S / 70 + 0.5, trees);
    want('quarry', 1, rocks) && want('stonemason', 1);
    if (c.count('stonemason')) want('watchtower', Math.min(4, 1 + c.buildings.size / 25));
    const sawmills = Math.max(2, 1 + c.buildings.size / 20), charcoal = c.count('charcoal');
    if (sec % 60 === 0) { want('sawmill', Math.min(5, sawmills)); want('lumberjack', Math.min(16, (c.count('sawmill') + charcoal) * 1.2 + (c.stock.logs < 3 ? 1 : 0)), trees); }
    const wk = c.work;
    if (sec % 20 === 0 && c.stats.income < c.stats.upkeep + 15 && c.stock.planks >= 2 && c.gold > 15) want('hut', c.count('hut') + 1);
    if (sec % 20 === 0 && (wk.demand[0] + 8 > wk.supply[0] || c.count('hut') < 6)) want('hut', c.count('hut') + 1);
    if (sec % 20 === 0 && (wk.demand[1] + 6 > wk.supply[1]) && c.tierUnlocked(1) && (c.stock.bread > 2 && c.stock.textiles > 2 || c.pop.craftsmen < 12)) { const h = c.ofType('hut').find(x => !c.upgradeError(x)); if (h && wk.supply[0] > wk.demand[0] + 10) c.upgrade(h.id); else want('hut', c.count('hut') + 1); }
    if (S >= 25 && c.relics.length === 0 && sec > 30 * 60) b.fetchRelic();
    if (c.tierUnlocked(1)) {
      mark('craftsmen_unlocked');
      const bakeries = Math.max(1, (C + M) / 80), breweries = Math.max(1, C / 120 + M / 80), weavers = Math.max(1, C / 160 + M / 120);
      want('farm', (bakeries + breweries) * 1.1) && want('bakery', bakeries) && want('flaxfarm', weavers) && want('weaver', weavers) && want('brewery', breweries) && want('tavern', 1);
      want('stonemason', 2); want('quarry', 2, rocks);
      const craftReady = c.stock.bread > 2 && c.stock.textiles > 2 || C === 0;
      if (sec % 30 === 0 && craftReady && wk.supply[0] > wk.demand[0] + 14) for (const h of c.ofType('hut')) if (!c.upgradeError(h)) { c.upgrade(h.id); break; }
      if (mine('iron')) { want('charcoal', 1 + c.count('smelter') + c.count('goldsmith'), trees); want('smelter', 1); want('blacksmith', 1); want('cartographer', 1); want('warehouse', 1); }
      if (C > 0) mark('first_craftsmen');
      if (c.relics.length < 3 && C >= 40 && sec % 600 === 0) b.fetchRelic();
    }
    if (c.tierUnlocked(2)) {
      mark('merchants_unlocked');
      want('chapel', 1);
      if (mine('gold')) { want('goldsmith', 2); if (c.relics.length >= 5) mine('gold', 2); }
      if (c.stock.tools < 6 && sec % 120 === 0) { mine('iron', 2); want('smelter', 2 + c.count('ironmine') - 1); want('charcoal', 1 + c.count('smelter') + c.count('goldsmith'), trees); }
      want('smelter', 2); want('blacksmith', 2);
      if (sec % 30 === 0 && M < 150 && c.stock.ale > 2 && wk.supply[1] > wk.demand[1] + 14) for (const h of c.ofType('house')) if (!c.upgradeError(h)) { c.upgrade(h.id); break; }
      if (M > 0) mark('first_merchants');
      if (c.relics.length < 5 && sec % 600 === 0) b.fetchRelic();
    }
    if (c.relics.length >= 5) mark('five_relics');
    if (!c.count('sanctum') && c.relics.length >= 5 && c.pop.total >= 250) { if (b.place('sanctum')) mark('sanctum'); }
    if (P.total >= 100) mark('pop100');
    if (P.total >= 200) mark('pop200');
  });
  return { c, ms };
}
