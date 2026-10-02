// Engine tests: replay determinism, tamper rejection, garrison behaviors, consumables, round limit.
import assert from 'node:assert/strict';
import { generateMap } from '../public/tactics/src/grid.js';
import { Battle, makeUnit } from '../public/tactics/src/battle.js';
import { CLASS_KEYS } from '../public/tactics/src/data.js';

function setup(seed, { behaviors = [], consumables = {}, maxRounds = 0 } = {}) {
  const { grid, pSpawn, eSpawn } = generateMap(seed, 3);
  const units = [];
  for (let i = 0; i < 4; i++) { const u = makeUnit({ cls: CLASS_KEYS[(seed + i) % 6], gear: [] }, 'player'); [u.x, u.y] = pSpawn[i]; units.push(u); }
  for (let i = 0; i < 4; i++) {
    const u = makeUnit({ cls: CLASS_KEYS[(seed + i * 3) % 6], gear: [] }, 'enemy');
    [u.x, u.y] = eSpawn[i]; u.behavior = behaviors[i] || 'aggressive'; units.push(u);
  }
  return new Battle({ grid, units, seed, consumables, maxRounds });
}
const snapshot = b => JSON.stringify({ r: b.result, round: b.round, u: b.units.map(u => [u.x, u.y, u.hp, u.alive]) });
async function autoplay(b) { while (!b.over && b.round < 40) { await b.runAI('player'); if (!b.over) await b.endPlayerTurn(); } }

let n = 0;
for (let seed = 1; seed <= 25; seed++) {
  const live = setup(seed, { behaviors: ['hold', 'guard', 'ambush', 'medic'], consumables: { potion: 2 } });
  await autoplay(live);
  assert.ok(live.over, `battle ${seed} finished`);
  const copy = setup(seed, { behaviors: ['hold', 'guard', 'ambush', 'medic'], consumables: { potion: 2 } });
  assert.equal(await copy.replay(live.actions), true, 'replay accepted');
  assert.equal(snapshot(copy), snapshot(live), `replay ${seed} reproduces the battle exactly`);
  n++;
}
console.log(`ok replay determinism (${n} battles)`);

{ // tampering: an illegal move is rejected
  const b = setup(3);
  const p = b.units[0];
  assert.equal(await b.replay([{ t: 'm', u: 0, x: p.x, y: p.y + 9 }]), false);
  assert.equal(await setup(3).replay([{ t: 'a', u: 5, id: 'strike', x: 0, y: 0 }]), false, 'cannot command enemy units');
  console.log('ok tampered logs rejected');
}
{ // hold never moves; guard stays within 2 of its post
  for (let seed = 1; seed <= 10; seed++) {
    const b = setup(seed, { behaviors: ['hold', 'guard', 'hold', 'guard'] });
    const start = b.units.slice(4).map(u => [u.x, u.y]);
    for (let r = 0; r < 6 && !b.over; r++) {
      await b.runAI('player'); if (b.over) break; await b.endPlayerTurn();
      b.units.slice(4).forEach((u, i) => {
        if (!u.alive) return;
        const d = Math.max(Math.abs(u.x - start[i][0]), Math.abs(u.y - start[i][1]));
        if (u.behavior === 'hold') assert.ok(d <= 1, 'hold unit stays (pushes allowed)');
        if (u.behavior === 'guard') assert.ok(d <= 3, 'guard stays near post');
      });
    }
  }
  console.log('ok hold/guard behaviors');
}
{ // consumable flask is offered, spends stock
  const b = setup(2, { consumables: { potion: 1 } });
  const u = b.units[0]; u.hp -= 6;
  assert.ok(b.abilities(u).includes('flask'));
  assert.equal(await b.use(u, 'flask', u.x, u.y), true);
  assert.equal(b.consumables.potion, 0);
  assert.ok(!b.abilities(b.units[1]).includes('flask'));
  console.log('ok potion flask consumable');
}
{ // round limit: defenders win on timeout
  const b = setup(4, { behaviors: ['hold', 'hold', 'hold', 'hold'], maxRounds: 2 });
  await b.endPlayerTurn(); await b.endPlayerTurn();
  assert.equal(b.over, true); assert.equal(b.result, 'lose');
  console.log('ok round limit');
}
