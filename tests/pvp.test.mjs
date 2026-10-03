// Versus play: pvp turn flow, per-side consumables, lockstep determinism, and the online match protocol
// over the BroadcastChannel transport (two "browsers" in one process).
import assert from 'node:assert/strict';
import { generateMap } from '../public/tactics/src/grid.js';
import { Battle, makeUnit } from '../public/tactics/src/battle.js';
import { CLASS_KEYS } from '../public/tactics/src/data.js';
import { LocalTransport, OnlineMatch, makeCode, cleanCode } from '../public/tactics/src/net.js';

function versus(seed, parties) {
  const { grid, pSpawn, eSpawn } = generateMap(seed, 1);
  const units = [];
  parties.player.forEach((cls, i) => { const u = makeUnit({ cls, gear: [] }, 'player'); [u.x, u.y] = pSpawn[i]; units.push(u); });
  parties.enemy.forEach((cls, i) => { const u = makeUnit({ cls, gear: [] }, 'enemy'); [u.x, u.y] = eSpawn[i]; units.push(u); });
  return new Battle({ grid, units, seed, pvp: true, consumables: { player: { potion: 1 }, enemy: { potion: 1 } }, maxRounds: 0 });
}
const pick = s => [0, 1, 2, 3].map(i => CLASS_KEYS[(s * 7 + i * 5) % CLASS_KEYS.length]);
const snapshot = b => JSON.stringify({ r: b.result, round: b.round, u: b.units.map(u => [u.x, u.y, u.hp, u.alive]) });
async function autoplay(b) { while (!b.over && b.round < 40) { await b.runAI(b.phase); if (!b.over) await b.endTurn(); } }

{ // turn flow: player → enemy → next round, nothing happens on its own
  const b = versus(5, { player: pick(1), enemy: pick(2) });
  assert.equal(b.phase, 'player');
  const before = snapshot(b);
  await b.endTurn();
  assert.equal(b.phase, 'enemy', 'control passes to the other human');
  assert.equal(snapshot(b), before, 'no AI moved for the enemy');
  await b.endTurn();
  assert.equal(b.phase, 'player'); assert.equal(b.round, 2);
  assert.deepEqual(b.actions, [{ t: 'e' }, { t: 'e' }], 'both sides\' end-turns recorded');
  assert.equal(await b.applyCmd({ t: 'm', u: 5, x: 0, y: 0 }), false, 'cannot move the other side\'s unit');
  console.log('ok pvp turn flow');
}
{ // per-side flask stock
  const b = versus(9, { player: ['knight', 'ranger', 'rogue', 'barbarian'], enemy: ['knight', 'ranger', 'rogue', 'barbarian'] });
  const p = b.units[0], e = b.units[4];
  assert.ok(b.abilities(p).includes('flask') && b.abilities(e).includes('flask'), 'both sides carry a flask');
  p.hp -= 5; e.hp -= 5;
  assert.equal(await b.use(p, 'flask', p.x, p.y), true);
  assert.equal(b.stock('player').potion, 0); assert.equal(b.stock('enemy').potion, 1, 'enemy stock untouched');
  await b.endTurn();
  assert.equal(await b.use(e, 'flask', e.x, e.y), true);
  assert.ok(!b.abilities(p).includes('flask') && !b.abilities(e).includes('flask'));
  console.log('ok per-side flask');
}
{ // lockstep: replaying the shared log on another machine reproduces the battle exactly
  for (let seed = 1; seed <= 12; seed++) {
    const parties = { player: pick(seed), enemy: pick(seed + 3) };
    const live = versus(seed, parties);
    await autoplay(live);
    assert.ok(live.over, `duel ${seed} finished`);
    const copy = versus(seed, parties);
    assert.equal(await copy.replay(live.actions), true);
    assert.equal(snapshot(copy), snapshot(live), `duel ${seed} identical on both peers`);
  }
  console.log('ok pvp lockstep (12 duels)');
}

// ------------------------------------------------------------------ online protocol
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 6000, what = 'condition') => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout: ' + what); await sleep(20); } };
const transport = () => new LocalTransport({ heartbeat: 60, ttl: 400 });

/** A peer: its own Battle, built from the match setup, fed by remote commands. */
function peer(m) {
  const p = { m, b: null, q: Promise.resolve() };
  m.onStart = s => {
    p.b = versus(s.seed, s.parties); p.side = s.mySide; p.setup = s;
    m.attach({ logLength: () => p.b.actions.length, log: () => p.b.actions });
  };
  m.onCommand = cmd => { p.q = p.q.then(async () => assert.equal(await p.b.applyCmd(cmd), true, 'remote command legal')); };
  p.turn = async (lag = 0) => { // play our turn with the AI, then send the commands (optionally late)
    const n = p.b.actions.length;
    await p.b.runAI(p.side);
    if (!p.b.over) await p.b.endTurn();
    if (lag) await sleep(lag);   // pings / sync requests arrive while our log is ahead of what we sent
    for (let i = n; i < p.b.actions.length; i++) m.sendCommand(p.b.actions[i], i);
  };
  return p;
}

{ // host + join by code, play a whole duel in lockstep, with one message lost on the way
  assert.equal(cleanCode(' ab-1cd9 '), 'ABCD'); assert.match(makeCode(), /^[A-Z]{4}$/);
  const A = peer(new OnlineMatch(transport(), { name: 'Ann', party: pick(1), pingMs: 40 }));
  const B = peer(new OnlineMatch(transport(), { name: 'Bo', party: pick(4), pingMs: 40 }));
  const code = await A.m.host();
  await B.m.join(code);
  await until(() => A.b && B.b, 3000, 'both started');
  assert.equal(A.side, 'player'); assert.equal(B.side, 'enemy');
  assert.deepEqual(A.setup.names, { player: 'Ann', enemy: 'Bo' }); assert.equal(A.setup.seed, B.setup.seed);

  let dropped = false;
  const realSend = A.m.room.send.bind(A.m.room);
  A.m.room.send = msg => { if (!dropped && msg.t === 'cmd' && msg.seq === 2) { dropped = true; return; } realSend(msg); };

  let turns = 0;
  while (!A.b.over && !B.b.over && turns < 60) {
    const [me, them] = A.b.phase === A.side ? [A, B] : [B, A];
    await me.turn(turns % 3 === 1 ? 150 : 0);
    await until(() => them.b.actions.length === me.b.actions.length, 8000, 'opponent caught up');
    await them.q;
    turns++;
  }
  assert.ok(dropped, 'a command was dropped');
  assert.ok(A.b.over && B.b.over, 'duel over on both screens');
  assert.equal(snapshot(A.b), snapshot(B.b), 'both screens agree on every unit');
  assert.equal(A.b.result, B.b.result);
  console.log(`ok online duel by room code (${turns} turns, lost message repaired)`);

  // a third player cannot crash the room
  const C = new OnlineMatch(transport(), { name: 'Cy', party: pick(2) });
  await assert.rejects(C.join(code, { timeout: 1500 }), /two players/);
  // rematch: both ask, host restarts with a new seed
  const seed0 = A.setup.seed;
  A.m.requestRematch(); B.m.requestRematch();
  await until(() => A.setup.seed !== seed0 && B.setup?.seed === A.setup.seed, 3000, 'rematch');
  assert.equal(B.side, 'enemy');
  console.log('ok full room rejected, rematch restarts');
  A.m.close(); B.m.close(); C.close();
}
{ // joining a code nobody hosts fails cleanly
  const m = new OnlineMatch(transport(), { name: 'Lone', party: pick(3) });
  await assert.rejects(m.join('ZZZZ', { timeout: 600 }), /No open room/);
  m.close();
  console.log('ok unknown room');
}
{ // quick match: two players searching at the same moment end up in one room, a third waits
  const ms = ['Ira', 'Jo', 'Kai'].map((name, i) => new OnlineMatch(transport(), { name, party: pick(i) }));
  const got = [];
  ms.slice(0, 2).forEach((m, i) => m.quickMatch({ settle: 150 }).then(s => { got[i] = s; }));
  await until(() => got[0] && got[1], 8000, 'pair found');
  assert.equal(got[0].seed, got[1].seed, 'same match');
  assert.deepEqual([got[0].mySide, got[1].mySide].sort(), ['enemy', 'player']);
  let third = null;
  ms[2].quickMatch({ settle: 150 }).then(s => { third = s; });
  await sleep(800);
  assert.equal(third, null, 'third player waits for someone new');
  const late = new OnlineMatch(transport(), { name: 'Lu', party: pick(5) });
  let lateSetup = null;
  late.quickMatch({ settle: 150 }).then(s => { lateSetup = s; });
  await until(() => third && lateSetup, 8000, 'third paired with the late player');
  assert.equal(third.seed, lateSetup.seed);
  [...ms, late].forEach(m => m.close());
  console.log('ok quick match pairing (simultaneous search, waiting host)');
}
{ // names from other players are shown as text, never as HTML
  const evil = '<img src=x onerror=alert(1)>';
  const host = new OnlineMatch(transport(), { name: evil, party: pick(0) });
  const guest = new OnlineMatch(transport(), { name: 'Safe', party: pick(1) });
  const said = []; guest.onStatus = h => said.push(h);
  let a = null, b = null;
  host.quickMatch({ settle: 100 }).then(x => { a = x; });
  await sleep(500);
  guest.quickMatch({ settle: 150 }).then(x => { b = x; });
  await until(() => a && b, 8000, 'paired');
  const found = said.find(h => h.startsWith('Found'));
  assert.ok(found && !found.includes('<img') && found.includes('&lt;img'), `escaped: ${found}`);
  assert.equal(b.names.player.length <= 20, true, 'names are capped');
  host.close(); guest.close();
  console.log('ok lobby names escaped');
}
