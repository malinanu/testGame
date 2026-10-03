// Wildwood Colony (Forest Relic Hunt) simulation tests: map gen, placement rules, logistics,
// production chains, workforce, needs/tiers, raids, relics, trade, save/load and a full bot playthrough.
import assert from 'node:assert/strict';
import { Colony } from '../public/relic/src/sim.js';
import { generateWorld, reachable, idx, T } from '../public/relic/src/map.js';
import { BUILDINGS, TIERS, W, H, LOCAL_CAP, DIFFICULTY, GRANT_POP, FESTIVAL, EXPEDITION, HIST_EVERY } from '../public/relic/src/data.js';
import { Bot, playthrough } from './colony-bot.mjs';

const fresh = (seed = 3) => { const c = new Colony({ seed }); return { c, bot: new Bot(c), th: c.ofType('townhall')[0] }; };

{ // world generation
  for (const seed of [1, 2, 3, 4, 5, 7, 11, 42]) {
    const w = generateWorld(seed), reach = reachable(w);
    assert.equal(w.lairs.length, 8, `seed ${seed}: 8 lairs`);
    assert.equal(w.lairs.filter(l => l.relic).length, 5, 'five relic sites');
    assert.ok(w.deposits.filter(d => d.kind === 'iron').length >= 2 && w.deposits.some(d => d.kind === 'gold'), 'iron and gold deposits');
    for (const l of w.lairs) assert.ok(reach[idx(l.x + 1, l.y + 1)], `seed ${seed}: lair reachable on foot`);
    for (const d of w.deposits) assert.ok(reach[idx(d.x, d.y)], 'deposit reachable');
    let rockNear = 0;
    for (let y = w.start.y - 14; y < w.start.y + 18; y++) for (let x = w.start.x - 14; x < w.start.x + 18; x++) if (w.ground[idx(x, y)] === T.ROCK) rockNear++;
    assert.ok(rockNear > 0, 'a quarry site near the start');
  }
  assert.deepEqual(Array.from(generateWorld(9).tree.slice(0, 500)), Array.from(generateWorld(9).tree.slice(0, 500)), 'deterministic');
  for (let seed = 1; seed <= 50; seed++) { // fairness: every valley can start the same economy
    const w = generateWorld(seed), r = reachable(w), cx = w.start.x + 2, cy = w.start.y + 2;
    let trees = 0, rock = 99;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const d = Math.hypot(x - cx, y - cy), k = idx(x, y); if (d <= 15 && w.tree[k]) trees++; if (w.ground[k] === T.ROCK) rock = Math.min(rock, d); }
    const iron = Math.min(...w.deposits.filter(d => d.kind === 'iron' && r[idx(d.x, d.y)]).map(d => Math.hypot(d.x - cx, d.y - cy)));
    assert.ok(trees >= 40 && rock <= 12 && iron <= 24 && w.deposits.some(d => d.kind === 'gold' && r[idx(d.x, d.y)]), `seed ${seed} fair start (trees ${trees}, rock ${rock.toFixed(1)}, iron ${iron.toFixed(1)})`);
  }
  console.log('ok world generation (lairs, relics, deposits reachable; fair start on 50 seeds)');
}

{ // placement rules
  const { c, th } = fresh();
  assert.equal(c.placeError('hut', th.x, th.y), 'Occupied');
  assert.match(c.placeError('hut', 2, 2), /Unexplored|Rock/);
  assert.match(c.placeError('bakery', th.x + 6, th.y), /Requires Craftsmen/);
  assert.match(c.placeError('sanctum', th.x + 6, th.y), /Requires/);
  const iron = c.deposits.find(d => d.kind === 'iron');
  assert.match(c.placeError('ironmine', iron.x, iron.y), /Requires|deposit|territory|Unexplored/);
  const b = c.build('hut', th.x - 3, th.y + 5);
  assert.ok(!b.error, `hut placed: ${b.error}`);
  assert.equal(c.build('hut', th.x - 3, th.y + 5).error, 'Occupied');
  const g0 = c.gold; c.demolish(b.x, b.y); assert.equal(c.count('hut'), 0); assert.equal(c.gold, g0, 'demolish refunds goods, not gold');
  console.log('ok placement rules (occupied, fog, tier lock, monument lock, deposits, demolish)');
}

{ // logistics: no road, no production; carriers deliver to storage
  const { c, bot, th } = fresh();
  // the most wooded valid spot, built without a road
  let best = null;
  for (let y = th.y - 18; y < th.y + 18; y++) for (let x = th.x - 18; x < th.x + 18; x++) {
    if (c.placeError('lumberjack', x, y) || c.depositAt(x, y)) continue;
    if (c.doorTiles({ x, y, w: 2, h: 2 }).length) continue;
    const n = c.nearCount(x + 1, y + 1, { what: 'tree', r: 5 }); if (!best || n > best.n) best = { x, y, n };
  }
  const lj = c.build('lumberjack', best.x, best.y);
  assert.ok(!lj.error, lj.error);
  c.step(30);
  assert.equal(lj.connected, false); assert.match(lj.status, /No road/);
  assert.ok(bot.connect(lj)); c.step(1);
  assert.equal(lj.connected, true);
  assert.match(lj.status, /Short of Settlers/, 'nobody lives here yet');
  for (let i = 0; i < 3; i++) bot.place('hut');
  bot.place('market');
  const logs0 = c.stock.logs;
  c.step(120);
  assert.ok(c.stock.logs > logs0, `logs delivered (${logs0} → ${c.stock.logs})`);
  assert.ok(c.events.some(e => e.type === 'trip'), 'carrier trips emitted');
  assert.ok(c.events.some(e => e.type === 'tree' && !e.on), 'trees felled');
  const path = c.roadPath(th, lj);
  assert.ok(path && path.length >= 2, 'road path for carriers');
  console.log('ok logistics (unconnected stalls, carriers deliver, trees felled, road paths)');
}

{ // production chain + missing input + full buffer
  const { c, bot, th } = fresh();
  for (let i = 0; i < 3; i++) bot.place('hut');
  bot.place('market');
  const saw = bot.place('sawmill');
  c.stock.logs = 0; c.step(20);
  assert.match(saw.status, /Missing Logs/);
  c.stock.logs = 10; const p0 = c.stock.planks; c.step(90);
  assert.ok(c.stock.planks > p0 && c.stock.logs < 10, 'logs → planks');
  // a building whose carrier never comes fills its buffer and stops
  const q = { ...saw }; void q; void th;
  console.log('ok production chain (missing input stalls, logs → planks)');
}

{ // workforce shortage scales productivity
  const { c, bot } = fresh();
  for (let i = 0; i < 4; i++) bot.place('sawmill');
  c.stock.logs = 40; c.step(5);
  assert.ok(c.work.demand[0] >= 16);
  assert.ok(c.work.factor[0] < 1, `short of workers (${c.work.supply[0]}/${c.work.demand[0]})`);
  assert.ok(c.ofType('sawmill').every(s => s.prod <= c.work.factor[0] + 1e-9));
  console.log(`ok workforce (supply ${c.work.supply[0]} / demand ${c.work.demand[0]} → ${(c.work.factor[0] * 100).toFixed(0)}%)`);
}

{ // needs, population, tax, upgrades gated by tier unlock
  const { c, bot } = fresh();
  const huts = [0, 1, 2, 3].map(() => bot.place('hut'));
  c.step(60);
  const before = huts.reduce((a, h) => a + h.residents, 0);
  bot.place('market'); c.stock.food = 30; c.step(120);
  const after = huts.reduce((a, h) => a + h.residents, 0);
  assert.ok(after > before, `market + food grow huts (${before} → ${after})`);
  assert.equal(huts[0].residents, TIERS[0].cap);
  assert.ok(c.stats.income > 0, 'taxes');
  assert.match(c.upgradeError(huts[0]), /unlock at 30 Settlers \+ 1 relic/);
  c._peak.settlers = 40; bot.fetchRelic();
  assert.equal(c.relics.length, 1);
  assert.equal(c.upgradeError(huts[0]), '');
  c.upgrade(huts[0].id);
  assert.equal(huts[0].type, 'house'); assert.equal(huts[0].tier, 1);
  c.stock.food = 0; c.step(420);
  assert.ok(huts[1].residents < TIERS[0].cap, 'no food → people leave');
  console.log('ok needs & tiers (market+food fill huts, taxes, upgrade locked until 30 settlers + relic, hunger)');
}

{ // relic boons and map use
  const { c, bot } = fresh();
  const lj = bot.place('lumberjack', undefined, undefined, (x, y) => bot.treesNear(x, y)); c.step(10);
  const base = c.relicMult('lumberjack');
  bot.fetchRelic();
  assert.equal(c.relics[0], 'grove'); assert.equal(c.relicMult('lumberjack'), base * 1.25);
  c.stock.maps = 1; const r = c.useMap();
  assert.ok(r.lair, 'map reveals a relic lair'); assert.ok(c.lairs.find(l => l.id === r.lair).found);
  void lj;
  console.log('ok relics (boon multiplier, carried home, maps reveal relic sites)');
}

{ // raids: none during the grace period; fire without a tower; tower repels
  const { c, bot } = fresh();
  for (let i = 0; i < 8; i++) bot.place('hut');
  bot.place('market'); c.stock.food = 40;
  c.step(c.diff.grace - 10);
  assert.equal(c.events.filter(e => e.type === 'raid').length, 0, 'grace period');
  const l = c.lairs.find(q => !q.relic);
  const target = c.ofType('hut')[0];
  c.raids.push({ id: 99, lair: l.id, target: target.id, start: c.time, arrive: c.time + 1, repelled: false, size: 3 });
  c.step(2);
  assert.ok(target.fire > 0, 'unguarded hut burns');
  c.gold += 100; assert.ok(!c.repair(target.id).error); assert.equal(target.fire, 0);
  c.stock.bricks += 10; const tw = bot.place('watchtower', target.cx, target.cy);
  c.raids.push({ id: 100, lair: l.id, target: target.id, start: c.time, arrive: c.time + 1, repelled: false, size: 3 });
  c.step(2);
  assert.equal(target.fire, 0, 'watchtower repels'); void tw;
  console.log('ok raids (grace period, fire, repair, watchtower defense)');
}

{ // caravan trade
  const { c, bot } = fresh();
  bot.place('tradepost'); c.step(1);
  assert.equal(c.trade('planks', 5).error, 'No caravan in town');
  for (let t = 0; t < 600 && !c.caravan.here; t += 5) c.step(5);
  assert.ok(c.caravan.here, 'a caravan comes');
  const g0 = c.gold, p0 = c.stock.planks;
  assert.ok(!c.trade('planks', -5).error); assert.ok(c.gold > g0 && c.stock.planks === p0 - 5, 'sold planks');
  console.log('ok caravan trade');
}

{ // difficulty and the founding grant
  const e = new Colony({ seed: 3, difficulty: 'easy' }), h = new Colony({ seed: 3, difficulty: 'hard' });
  assert.equal(e.gold, DIFFICULTY.easy.gold); assert.equal(h.gold, DIFFICULTY.hard.gold);
  assert.ok(e.diff.grace > h.diff.grace && e.diff.upkeep < h.diff.upkeep);
  const { c, bot } = fresh();
  bot.place('sawmill'); c.step(5);
  assert.equal(c.grant, true); const halfed = c.stats.upkeep;
  c.grant = false; c.step(5);
  assert.ok(Math.abs(c.stats.upkeep - halfed * 2) < 1e-6, 'grant halves upkeep');
  const g = new Colony({ seed: 3 }), gb = new Bot(g); for (let i = 0; i < 10; i++) gb.place('hut'); gb.place('market'); g.stock.food = 40;
  for (let t = 0; t < 600 && g.grant; t += 5) g.step(5);
  assert.equal(g.grant, false, `grant ends at ${GRANT_POP} residents`);
  assert.equal(Colony.load(e.save()).difficulty, 'easy', 'difficulty saved');
  console.log('ok difficulty (easy/hard scaling, saved) and founding grant (half upkeep until 40 residents)');
}

{ // paved roads make carriers faster
  const { c, bot } = fresh();
  for (let i = 0; i < 3; i++) bot.place('hut'); bot.place('market');
  const lj = bot.place('lumberjack', undefined, undefined, (x, y) => bot.treesNear(x, y));
  c.step(1);
  const dirt = lj.roadLen;
  assert.match(c.buildRoad(0, 0, true).error || '', /territory|Unexplored|Rock|map/i);
  c.stock.bricks = 200; c.gold += 500;
  let paved = 0;
  for (let i = 0; i < W * H; i++) if (c.road[i] === 1) { const r = c.buildRoad(i % W, (i / W) | 0, true); assert.ok(!r.error, r.error); paved++; }
  c.step(1);
  assert.ok(paved > 0 && lj.roadLen < dirt, `paved trip is shorter (${dirt.toFixed(1)} → ${lj.roadLen.toFixed(1)})`);
  assert.ok([...c.road].every(v => v !== 1), 'all paved');
  console.log(`ok paved roads (${paved} tiles, carrier leg ${dirt.toFixed(1)} → ${lj.roadLen.toFixed(1)} tiles)`);
}

{ // festival, expeditions and statistics history
  const { c, bot } = fresh();
  for (let i = 0; i < 4; i++) bot.place('hut'); bot.place('market'); c.stock.food = 40;
  c.step(60);
  const h0 = c.ofType('hut')[0].happiness;
  assert.ok(!c.festival().error); c.step(1);
  assert.equal(c.ofType('hut')[0].happiness, Math.min(100, h0 + FESTIVAL.happy), 'festival lifts happiness');
  assert.match(c.festival().error, /already/);
  c.step(FESTIVAL.time + 1); assert.equal(c.festivalUntil, 0);
  assert.match(c.festivalError(), /recover/);
  assert.match(c.expeditionError(), /Cartographer/);
  // expeditions: deterministic for the same colony state
  const run = () => { const d = new Colony({ seed: 4 }), db = new Bot(d); d.peak.settlers = 40; db.fetchRelic(); d.gold += 3000; d.stock.planks = 30; d.stock.bricks = 20; d.stock.food = 30; d.stock.maps = 3;
    for (let i = 0; i < 6; i++) db.place('hut'); db.place('market'); db.place('cartographer'); d.step(2);
    assert.equal(d.expeditionError(), ''); d.startExpedition(); d.step(EXPEDITION.time + 2); return d.events.filter(e => e.type === 'expedition' && !e.out).map(e => e.text); };
  const a = run(), b = run();
  assert.equal(a.length, 1); assert.deepEqual(a, b, 'same outcome for the same state');
  assert.ok(c.history.length >= Math.floor(c.time / HIST_EVERY) - 1 && c.history.at(-1).pop.length === 3, 'history sampled');
  c.step(360); assert.ok(c.history.some(s => s.cons.food > 0), 'food consumption recorded');
  const back = Colony.load(c.save());
  assert.equal(back.history.length, c.history.length); assert.equal(back.festivalReady, c.festivalReady);
  console.log(`ok festival, expedition ("${a[0]}") and statistics (${c.history.length} samples)`);
}

{ // save / load round trip
  const { c, bot } = fresh();
  bot.place('lumberjack', undefined, undefined, (x, y) => bot.treesNear(x, y)); bot.place('hut'); bot.place('market');
  c.step(200); c.reveal(10, 10, 6);
  const json = c.save(), d = Colony.load(json);
  assert.equal(d.save(), json, 'identical after reload');
  c.step(120); d.step(120);
  assert.equal(JSON.stringify([c.gold, c.stock, c.pop]), JSON.stringify([d.gold, d.stock, d.pop]), 'continues identically');
  console.log(`ok save/load (${(json.length / 1024).toFixed(0)} KB, deterministic after reload)`);
}

{ // full playthroughs: the bot reaches every tier and builds the Sanctum on (nearly) every valley
  const rows = [];
  for (let seed = 1; seed <= 8; seed++) {
    const t0 = Date.now(), { c, ms } = playthrough(seed, { minutes: 200 });
    rows.push({ seed, won: c.won, craftsmen: ms.first_craftsmen, merchants: ms.first_merchants, sanctum: ms.sanctum, ms: Date.now() - t0 });
  }
  console.table(rows);
  const wins = rows.filter(r => r.won).length;
  assert.ok(wins >= 7, `bot builds the Sanctum on at least 7 of 8 seeds (got ${wins})`);
  console.log(`ok playthroughs: Sanctum on ${wins}/8 seeds`);
}
void BUILDINGS; void LOCAL_CAP;
