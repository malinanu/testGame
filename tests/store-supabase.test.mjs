// Runs the arena server-core on the Supabase store, backed by a tiny in-memory fake of the
// supabase-js query builder (select/eq/gt/gte/lt/order/limit/range/maybeSingle/upsert, count head).
import assert from 'node:assert/strict';
import { createSupabaseStore } from '../supabase/functions/_shared/store-supabase.js';
import { createCore } from '../supabase/functions/_shared/arena/src/server-core.js';
import { buildRaid } from '../supabase/functions/_shared/arena/src/stronghold.js';
import { Battle } from '../supabase/functions/_shared/tactics/src/battle.js';

const PK = { arena_profiles: 'id', arena_strongholds: 'owner', arena_raids: 'id', arena_seasons: 'id' };
function fakeSupabase() {
  const tables = {};
  class Q {
    constructor(t) { this.t = t; this.f = []; this.opts = {}; }
    select(cols, opts = {}) { this.cols = cols; this.opts = opts; return this; }
    eq(k, v) { this.f.push(r => r[k] === v); return this; }
    gt(k, v) { this.f.push(r => r[k] > v); return this; }
    gte(k, v) { this.f.push(r => r[k] >= v); return this; }
    lt(k, v) { this.f.push(r => r[k] < v); return this; }
    order(k, { ascending = true } = {}) { this.o = [k, ascending]; return this; }
    limit(n) { this.lim = n; return this; }
    range(a, b) { this.rng = [a, b]; return this; }
    maybeSingle() { this.single = true; return this; }
    upsert(row) { this.row = row; return this; }
    then(res, rej) { try { res(this.exec()); } catch (e) { rej(e); } }
    exec() {
      const T = (tables[this.t] ||= new Map());
      if (this.row) { T.set(this.row[PK[this.t]], structuredClone(this.row)); return { data: null, error: null }; }
      let rows = [...T.values()].filter(r => this.f.every(f => f(r)));
      if (this.opts.head) return { data: null, count: rows.length, error: null };
      if (this.o) { const [k, asc] = this.o; rows.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (asc ? 1 : -1)); }
      if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
      if (this.lim != null) rows = rows.slice(0, this.lim);
      const keys = this.cols.split(',').map(s => s.trim());
      const proj = r => Object.fromEntries(keys.map(k => [k, structuredClone(r[k])]));
      if (this.single) { if (rows.length > 1) return { data: null, error: { message: 'multiple rows' } }; return { data: rows[0] ? proj(rows[0]) : null, error: null }; }
      return { data: rows.map(proj), error: null };
    }
  }
  return { from: t => new Q(t), tables };
}

let t = Date.UTC(2026, 9, 2, 12);
const sb = fakeSupabase();
const core = createCore(createSupabaseStore(sb, { clock: () => t }));
const ok = async (uid, a, p) => { const r = await core.handle(uid, a, p); assert.ok(!r.error, `${a}: ${r.error}`); return r; };
const u = '11111111-1111-4111-8111-111111111111';
let s = await ok(u, 'register', { name: 'Cloud Tester' });
assert.equal(sb.tables.arena_profiles.size, 9, '8 bots + player stored');
assert.equal(sb.tables.arena_profiles.get(u).rating, 1200, 'rating column mirrors data');
s = await ok(u, 'harvest');
const target = await ok(u, 'findTarget');
const st = await ok(u, 'startRaid', { defenderId: target.id, party: ['knight', 'wizard', 'ranger', 'barbarian'], consumables: { potion: 1 } });
assert.equal(sb.tables.arena_raids.get(st.raid.id).status, 'open');
const setup = buildRaid({ attack: st.raid.attack, defense: st.raid.defense, seed: st.raid.seed });
const b = new Battle({ grid: setup.grid, units: setup.units, ...setup.opts });
while (!b.over) { await b.runAI('player'); if (!b.over) await b.endPlayerTurn(); }
const fin = await ok(u, 'finishRaid', { raidId: st.raid.id, actions: b.actions });
assert.equal(fin.result, b.result);
assert.equal(sb.tables.arena_raids.get(st.raid.id).status, 'done');
const lb = await ok(u, 'leaderboard');
assert.equal(lb.top.length, 9); assert.equal(lb.top[0].rating >= lb.top[8].rating, true);
assert.equal(lb.me.rank, lb.top.findIndex(p => p.id === u) + 1, 'rank matches leaderboard order');
t += 4 * 3.6e6;
s = await ok(u, 'me');
assert.ok(s.defense, 'simulated defense ran'); assert.ok(s.defenseLog.length >= 1);
console.log(`ok supabase store (${fin.result} raid, rank ${lb.me.rank}, defense log ${s.defenseLog.length})`);
