// Runs the bundled Edge Function (dist/arena-function.ts, from `npm run bundle`) with stubbed Deno and
// supabase-js, sending real Request objects through its Deno.serve handler.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

if (!existsSync('dist/arena-function.ts')) { console.log('skip function bundle (run npm run bundle)'); process.exit(0); }
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


const sb = fakeSupabase();
const USERS = { 'tok-a': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'tok-b': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
sb.auth = { getUser: async tok => USERS[tok] ? { data: { user: { id: USERS[tok] } }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } } };
let handler = null;
globalThis.Deno = { env: { get: k => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' })[k] }, serve: h => { handler = h; } };
globalThis.__createClient = (url, key) => { assert.equal(key, 'sb_secret_test', 'uses the secret key'); return sb; };
const src = readFileSync('dist/arena-function.ts', 'utf8').replace(/import \{ createClient \} from "npm:@supabase\/supabase-js@2";/, 'const createClient = globalThis.__createClient;');
const file = join(mkdtempSync(join(tmpdir(), 'arena-fn-')), 'fn.mjs');
writeFileSync(file, src);
await import(pathToFileURL(file).href);
assert.ok(handler, 'Deno.serve registered a handler');

const post = (tok, body) => handler(new Request('https://x/functions/v1/arena', { method: 'POST', headers: tok ? { Authorization: `Bearer ${tok}` } : {}, body: JSON.stringify(body) }));
const json = async r => ({ status: r.status, body: await r.json() });

assert.equal((await handler(new Request('https://x', { method: 'OPTIONS' }))).status, 200, 'CORS preflight');
assert.equal((await json(await post(null, { action: 'me' }))).status, 401, 'no session rejected');
assert.equal((await json(await post('forged', { action: 'me' }))).status, 401, 'bad JWT rejected');
let r = await json(await post('tok-a', { action: 'me' }));
assert.equal(r.status, 200); assert.equal(r.body.profile, null);
r = await json(await post('tok-a', { action: 'register', name: 'Edge Guild' }));
assert.equal(r.body.profile.name, 'Edge Guild'); assert.equal(r.body.profile.id, USERS['tok-a'], 'identity comes from the JWT');
r = await json(await post('tok-a', { action: 'findTarget' }));
assert.ok(r.body.id && r.body.garrison.length === 4);
const st = await json(await post('tok-a', { action: 'startRaid', defenderId: r.body.id, party: ['knight', 'knight', 'wizard', 'ranger'] }));
const fin = await json(await post('tok-a', { action: 'finishRaid', raidId: st.body.raid.id, actions: [{ t: 'e' }] }));
assert.equal(fin.body.result, 'lose'); assert.equal(fin.body.reason, 'retreated');
const other = await json(await post('tok-b', { action: 'finishRaid', raidId: st.body.raid.id, actions: [] }));
assert.match(other.body.error, /Unknown raid/, "players can't settle each other's raids");
assert.match((await json(await post('tok-a', { action: 'dropTables' }))).body.error, /Unknown action/);
console.log('ok edge function bundle (auth, CORS, register, raid lifecycle, isolation)');
