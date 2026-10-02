// The Training Grounds map: lesson tiles are reachable/legal and the battle is winnable.
import assert from 'node:assert/strict';
import { tutorialSetup } from '../public/tactics/src/tutorial.js';
import { Battle } from '../public/tactics/src/battle.js';
import { halfCover } from '../public/tactics/src/grid.js';
import { T } from '../public/tactics/src/data.js';

const s = tutorialSetup(), b = new Battle({ grid: s.grid, units: s.units, seed: 4 });
const g = s.grid, idx = (x, y) => g.i(x, y);
assert.ok(b.reach(s.knight).get(idx(4, 4))?.stop, 'Knight can walk to the lesson tile');
assert.equal(await b.move(s.knight, 4, 4), true);
assert.ok(b.targets(s.knight, 'strike').some(t => t.unit === s.brute), 'Brute is in sword reach');
assert.ok(b.targets(s.ranger, 'shoot').some(t => t.unit === s.archer), 'Archer in Longshot range with line of sight');
assert.ok(halfCover(g, s.ranger.x, s.ranger.y, s.archer.x, s.archer.y), 'boulder gives the archer half cover');
assert.ok(b.preview(s.ranger, 'shoot', { x: s.archer.x, y: s.archer.y, unit: s.archer }).notes.includes('Half cover'));
assert.ok(b.preview(s.ranger, 'aimed', { x: s.archer.x, y: s.archer.y, unit: s.archer }).notes.includes('Ignores cover'));
assert.equal(g.get(9, 3), T.BUSH);
assert.equal(await b.move(s.rogue, 9, 3), true); assert.equal(s.rogue.hidden, true, 'Rogue hides in the bush');
let wins = 0;
for (let seed = 1; seed <= 20; seed++) {
  const t = tutorialSetup(), bb = new Battle({ grid: t.grid, units: t.units, seed });
  while (!bb.over && bb.round < 30) { await bb.runAI('player'); if (!bb.over) await bb.endPlayerTurn(); }
  if (bb.result === 'win') wins++;
}
assert.ok(wins >= 19, `training is winnable (${wins}/20 AI wins)`);
console.log(`ok tutorial map (lesson tiles valid, ${wins}/20 auto-played wins)`);
