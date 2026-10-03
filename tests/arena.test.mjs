// Arena server-core tests against the in-memory store with a controllable clock.
import assert from 'node:assert/strict';
import { createCore, botId } from '../public/arena/src/server-core.js';
import { createMemoryStore } from '../public/arena/src/store-memory.js';
import * as E from '../public/arena/src/economy.js';
import { validate, defaultStronghold, buildRaid, botStronghold, BOT_COUNT } from '../public/arena/src/stronghold.js';
import { Battle } from '../public/tactics/src/battle.js';
import { T } from '../public/tactics/src/data.js';

let t = Date.UTC(2026, 9, 2, 12);
const store = createMemoryStore({ clock: () => t });
const core = createCore(store);
const call = async (uid, a, p) => { const r = await core.handle(uid, a, p); return r; };
const ok = async (uid, a, p) => { const r = await call(uid, a, p); assert.ok(!r.error, `${a}: ${r.error}`); return r; };

// pure economy
assert.equal(E.eloDelta(1200, 1200, true).attacker, 16);
assert.equal(E.eloDelta(1200, 1200, false).defender, 16);
assert.ok(E.eloDelta(1000, 1600, true).attacker > 28, 'upsets pay more');
assert.equal(E.league(1250).name, 'Silver'); assert.equal(E.league(1750).name, 'Diamond');
assert.deepEqual(E.pendingHarvest({ tiles: new Array(144).fill(T.GROUND) }, t, t + 3.6e6), { herbs: 1, berries: 0 });
console.log('ok economy');

// validation
const d = defaultStronghold();
assert.deepEqual(validate(d.layout, d.garrison, 1), [], 'default stronghold is valid');
const sealed = { tiles: d.layout.tiles.slice() };
for (let x = 0; x < 12; x++) sealed.tiles[4 * 12 + x] = T.PILLAR;
assert.ok(validate(sealed, d.garrison, 5).some(e => /no path|budget/i.test(e)), 'sealed wall rejected');
const blockedRow = { tiles: d.layout.tiles.slice() }; blockedRow.tiles[3] = T.BOULDER;
assert.ok(validate(blockedRow, d.garrison, 1).some(e => /deployment rows/.test(e)));
assert.ok(validate(d.layout, d.garrison.slice(0, 3), 1).some(e => /exactly 4/.test(e)));
for (let i = 0; i < BOT_COUNT; i++) { const b = botStronghold(i); assert.deepEqual(validate(b.layout, b.garrison, b.level, { bot: true }), [], `bot ${i} valid`); }
console.log('ok stronghold validation');

// account + daily loop
assert.ok((await call('u1', 'me')).profile === null);
assert.match((await call('u1', 'register', { name: 'x' })).error, /at least 2/);
let s = await ok('u1', 'register', { name: 'Mossy <b>Mel</b>' });
assert.equal(s.profile.name, 'Mossy bMelb');
assert.ok(s.daily && s.profile.gold === E.START.gold + E.dailyBonus(1), 'first daily bonus');
s = await ok('u1', 'me'); assert.ok(!s.daily, 'no second bonus same day');
t += 864e5; s = await ok('u1', 'me'); assert.equal(s.daily.streak, 2, 'streak grows');
console.log('ok register + daily streak');

// harvesting and crafting
const herbs0 = s.profile.herbs; t += 5 * 3.6e6;
s = await ok('u1', 'harvest'); assert.ok(s.harvested.herbs > 0 && s.profile.herbs === herbs0 + s.harvested.herbs);
s.profile.herbs < 5 && (store.db.profiles.u1.herbs = 10);
s = await ok('u1', 'craft', { recipe: 'potion' }); assert.equal(s.profile.consumables.potion, 2);
assert.match((await call('u1', 'craft', { recipe: 'ale' })).error || 'none', /Not enough|none/);
console.log('ok harvest + craft');

// upgrades
store.db.profiles.u1.gold = 1000;
s = await ok('u1', 'upgradeGear', { cls: 'knight' });
assert.equal(s.profile.tiers.knight, 1); assert.equal(s.profile.gold, 1000 - E.UPGRADE_COST[0]);
assert.equal(s.stronghold.garrison.find(g => g.cls === 'knight').tier, 1, 'garrison snapshot picks up new tier');
s = await ok('u1', 'upgradeStronghold'); assert.equal(s.profile.level, 2);
assert.match((await call('u1', 'saveStronghold', { layout: sealed, garrison: d.garrison })).error, /path|budget/);
s = await ok('u1', 'saveStronghold', { layout: d.layout, garrison: d.garrison }); assert.equal(s.stronghold.version, 2);
console.log('ok upgrades + save');

// raid: scout, start, play (AI drives the attackers like a player would), finish with server replay
const target = await ok('u1', 'findTarget');
assert.ok(target.garrison.length === 4 && target.id !== 'u1');
const before = (await store.getProfile('u1'));
const start = await ok('u1', 'startRaid', { defenderId: target.id, party: ['knight', 'barbarian', 'ranger', 'wizard'], consumables: { potion: 1 } });
assert.equal((await store.getProfile('u1')).consumables.potion, before.consumables.potion - 1, 'consumable spent at raid start');
const setup = buildRaid({ attack: start.raid.attack, defense: start.raid.defense, seed: start.raid.seed });
const b = new Battle({ grid: setup.grid, units: setup.units, ...setup.opts });
while (!b.over) { await b.runAI('player'); if (!b.over) await b.endPlayerTurn(); }
const fin = await ok('u1', 'finishRaid', { raidId: start.raid.id, actions: b.actions });
assert.equal(fin.result, b.result, 'server replay agrees with the client battle');
assert.equal(fin.profile.rating, before.rating + fin.ratingDelta);
assert.match((await call('u1', 'finishRaid', { raidId: start.raid.id, actions: b.actions })).error, /settled/);
console.log(`ok raid replay (${fin.result}, ${fin.rounds} rounds, ${fin.ratingDelta >= 0 ? '+' : ''}${fin.ratingDelta} Elo, +${fin.rewards.gold} gold)`);

// cheating: a forged "win" log is rejected as a loss
const t2 = await ok('u1', 'findTarget', { skip: [target.id] });
const s2 = await ok('u1', 'startRaid', { defenderId: t2.id, party: ['rogue', 'rogue', 'rogue', 'rogue'] });
const forged = await ok('u1', 'finishRaid', { raidId: s2.raid.id, actions: [{ t: 'm', u: 0, x: 5, y: 11 }] });
assert.equal(forged.result, 'lose'); assert.equal(forged.reason, 'invalid');
assert.ok((await store.recentTargets('u1', t - 1)).includes(target.id), 'raid cooldown recorded');
console.log('ok forged logs rejected');

{ // abilities a unit doesn't have (or that don't exist) are rejected, not crashes; a raid settles once
  const t3 = await ok('u1', 'findTarget', { skip: [target.id, t2.id] });
  const party = ['knight', 'wizard', 'ranger', 'barbarian'];
  const s3 = await ok('u1', 'startRaid', { defenderId: t3.id, party });
  const dup = await ok('u1', 'startRaid', { defenderId: t3.id, party });
  assert.equal(dup.raid.id, s3.raid.id, 'a repeated start returns the same open raid');
  const k = buildRaid({ attack: s3.raid.attack, defense: s3.raid.defense, seed: s3.raid.seed }).units.findIndex(u => u.cls === 'knight');
  const bad = await ok('u1', 'finishRaid', { raidId: s3.raid.id, actions: [{ t: 'a', u: k, id: 'fireball', x: 5, y: 5 }] });
  assert.equal(bad.reason, 'invalid', 'a knight cannot cast fireball');
  const s4 = await ok('u1', 'startRaid', { defenderId: t3.id, party });
  const weird = await call('u1', 'finishRaid', { raidId: s4.raid.id, actions: [{ t: 'a', u: 0, id: 'nope', x: 1, y: 1 }, { t: 'a', u: 0, id: '__proto__', x: 1.5, y: 1 }] });
  assert.ok(!weird.error && weird.reason === 'invalid', 'unknown ability rejected cleanly');
  const s5 = await ok('u1', 'startRaid', { defenderId: t3.id, party });
  const g0 = (await store.getProfile('u1')).gold;
  const both = await Promise.all([call('u1', 'finishRaid', { raidId: s5.raid.id, actions: [] }), call('u1', 'finishRaid', { raidId: s5.raid.id, actions: [] })]);
  const won = both.filter(r => !r.error);
  assert.equal(won.length, 1, 'exactly one of two parallel finishes settles');
  assert.match(both.find(r => r.error).error, /settled/);
  assert.equal((await store.getProfile('u1')).gold, g0 + won[0].rewards.gold, 'rewards paid once');
  console.log('ok foreign/unknown abilities rejected, repeated start reuses the raid, parallel finish settles once');
}

// player vs player: u2 raids u1 and u1's rating moves too
await ok('u2', 'register', { name: 'Rival' });
const { rating: r1, defWins: dw1 } = await store.getProfile('u1'); // earlier simulated NPC raids may already count
const s3 = await ok('u2', 'startRaid', { defenderId: 'u1', party: ['fighter', 'knight', 'ranger', 'rogue'] });
await ok('u2', 'finishRaid', { raidId: s3.raid.id, actions: [{ t: 'e' }] }); // retreats after one turn
const u1 = await store.getProfile('u1');
assert.ok(u1.rating > r1 && u1.defWins === dw1 + 1, 'defender gains Elo and a defense win');
const lb = await ok('u1', 'leaderboard');
assert.ok(lb.top.length >= BOT_COUNT + 2 && lb.me.rank >= 1);
console.log('ok PvP defense + leaderboard');

// NPC guilds raid you while you're away
t += 4 * 3.6e6;
s = await ok('u1', 'me');
assert.ok(s.defense && s.defenseLog.some(l => l.attacker === s.defense.attacker));
console.log(`ok simulated defense (${s.defense.attacker} ${s.defense.held ? 'repelled' : 'broke through'})`);

// season rollover: auras for peak league, soft reset
store.db.profiles.u1.peak = 1520; store.db.profiles.u1.rating = 1500;
t += 29 * 864e5;
s = await ok('u1', 'me');
assert.equal(s.season.id, 2); assert.equal(s.profile.aura, 'Platinum');
assert.ok(Math.abs(s.profile.rating - 1350) <= E.K, 'soft reset to 1350 (± one simulated defense)');
assert.equal((await store.getProfile(botId(0))).rating, botStronghold(0).rating, 'bots keep their rating');
console.log('ok season rollover');
