// Wildwood Colony simulation: an Anno-style economy on a tile map. Pure and deterministic
// (fixed STEP, seeded rng), DOM-free so it runs in Node for tests. The 3D view reads state and
// drains `events` every frame; the UI calls the action methods.
import {
  W, H, STEP, DAY, GOODS, GOOD_KEYS, TIERS, BUILDINGS, RELICS, LAIR_KINDS, START, CARRIER_SPEED, LOCAL_CAP,
  RAID_EVERY, RAID_RANGE, RAID_GRACE, FIRE_TIME, CARAVAN_EVERY, CARAVAN_STAY, QUESTS, SANCTUM_POP,
} from './data.js';
import { generateWorld, rng, idx, inMap, dist, T } from './map.js';

const RESIDENCE_TYPES = ['hut', 'house', 'manor'];
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class Colony {
  /** new Colony({ seed, hero }) starts a fresh game; Colony.load(json) restores one. */
  constructor({ seed = 1, hero = 'Knight', world = null } = {}) {
    this.seed = seed; this.hero = { cls: hero, carry: null, x: 0, y: 0 };
    const w = world || generateWorld(seed);
    this.world = w; this.ground = w.ground; this.tree = w.tree;
    this.deposits = w.deposits.map(d => ({ ...d, found: false }));
    this.lairs = w.lairs.map(l => ({ ...l, found: false, cleared: false, relicTaken: false, nextRaid: 0 }));
    this.chests = w.chests.map(c => ({ ...c, found: false, opened: false }));
    this.fog = new Uint8Array(W * H);         // 1 = explored
    this.road = new Uint8Array(W * H);
    this.occ = new Int32Array(W * H);         // building id occupying the tile (0 = none)
    this.owned = new Uint8Array(W * H);       // territory
    this.buildings = new Map(); this.nextId = 1;
    this.gold = START.gold; this.stock = Object.fromEntries(GOOD_KEYS.map(k => [k, START.stock[k] || 0]));
    this.time = 0; this.acc = 0; this.rand = rng(seed * 4099 + 77);
    this.relics = []; this.events = []; this.raids = []; this.nextRaidId = 1;
    this.questIdx = 0; this.won = false; this.over = false;
    this.caravan = { here: false, t: CARAVAN_EVERY * 0.6 };
    this.pop = { settlers: 0, craftsmen: 0, merchants: 0, total: 0 };
    this.work = { demand: [0, 0, 0], supply: [0, 0, 0], factor: [1, 1, 1] };
    this.stats = { income: 0, upkeep: 0, explored: 0, prod: {}, cons: {} };
    this.dirty = true;
    if (!world || !world.restoring) {
      const th = this.place('townhall', w.start.x, w.start.y, true);
      // a short road stub in front of the Town Hall, and the first settlers' plots
      for (let i = -3; i < 7; i++) this.setRoad(w.start.x + i, w.start.y + 4, true);
      this.reveal(th.cx, th.cy, BUILDINGS.townhall.vision);
      this.hero.x = th.cx; this.hero.y = th.cy + 4;
      this.recompute();
    }
  }

  // ------------------------------------------------------------------ helpers
  emit(type, data = {}) { this.events.push({ type, ...data }); }
  notify(text, kind = 'info') { this.emit('notify', { text, kind }); }
  get day() { return (this.time % DAY) / DAY; }            // 0 = dawn
  get night() { const d = this.day; return d > 0.62 && d < 0.95; }
  isTree(x, y) { return inMap(x, y) && this.tree[idx(x, y)] > 0; }
  explored(x, y) { return inMap(x, y) && this.fog[idx(x, y)] === 1; }
  count(type, connected = false) { let n = 0; for (const b of this.buildings.values()) if (b.type === type && (!connected || b.connected)) n++; return n; }
  ofType(type) { return [...this.buildings.values()].filter(b => b.type === type); }
  tierUnlocked(t) {
    if (t === 0) return true;
    const u = TIERS[t].unlock;
    return (!u.settlers || this.peak.settlers >= u.settlers) && (!u.craftsmen || this.peak.craftsmen >= u.craftsmen) && this.relics.length >= (u.relics || 0);
  }
  get peak() { return this._peak ||= { settlers: 0, craftsmen: 0, merchants: 0 }; }
  relicMult(type) { let m = 1; for (const id of this.relics) { const r = RELICS.find(q => q.id === id); if (r.mult?.[type]) m *= r.mult[type]; } return m; }
  relicTax() { return this.relics.includes('sun') ? RELICS.find(r => r.id === 'sun').tax : 0; }
  relicTrade() { return this.relics.includes('tide') ? RELICS.find(r => r.id === 'tide').trade : 0; }

  reveal(cx, cy, r) {
    let changed = false;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++) {
        const i = idx(x, y);
        if (!this.fog[i] && (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) { this.fog[i] = 1; changed = true; }
      }
    if (!changed) return;
    for (const d of this.deposits) if (!d.found && this.explored(d.x, d.y)) { d.found = true; this.emit('found', { what: 'deposit', id: d.id }); this.notify(`Discovered a ${d.kind} deposit!`, 'good'); }
    for (const l of this.lairs) if (!l.found && this.explored(l.x + 1, l.y + 1)) { l.found = true; this.emit('found', { what: 'lair', id: l.id }); this.notify(`Spotted a ${LAIR_KINDS[l.kind].name}${l.relic ? ' guarding a relic' : ''}.`, l.relic ? 'good' : 'warn'); }
    for (const c of this.chests) if (!c.found && this.explored(c.x, c.y)) { c.found = true; this.emit('found', { what: 'chest', id: c.id }); }
    this.emit('fog');
    let n = 0; for (let i = 0; i < this.fog.length; i++) n += this.fog[i]; this.stats.explored = n / this.fog.length;
  }

  // ------------------------------------------------------------------ territory & placement
  territorySources() { return [...this.buildings.values()].filter(b => BUILDINGS[b.type].territory && !b.ruined); }
  recomputeTerritory() {
    this.owned.fill(0);
    for (const b of this.territorySources()) {
      const r = BUILDINGS[b.type].territory;
      for (let y = Math.max(0, Math.floor(b.cy - r)); y <= Math.min(H - 1, Math.ceil(b.cy + r)); y++)
        for (let x = Math.max(0, Math.floor(b.cx - r)); x <= Math.min(W - 1, Math.ceil(b.cx + r)); x++)
          if ((x + 0.5 - b.cx) ** 2 + (y + 0.5 - b.cy) ** 2 <= r * r) this.owned[idx(x, y)] = 1;
    }
    this.emit('territory');
  }

  /** Why (type) cannot be placed at (x, y), or '' if it can. */
  placeError(type, x, y) {
    const def = BUILDINGS[type];
    if (!def) return 'Unknown building';
    if (def.buildable === false) return 'Cannot be built';
    if (def.tier && !this.tierUnlocked(def.tier)) return `Requires ${TIERS[def.tier].name}`;
    if (def.relics && this.relics.length < def.relics) return `Requires ${def.relics} relics`;
    if (def.monument && this.pop.total < SANCTUM_POP) return `Requires ${SANCTUM_POP} residents`;
    if (def.unique && this.count(type)) return 'Only one allowed';
    const [w, h] = def.size;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const tx = x + i, ty = y + j;
      if (!inMap(tx, ty)) return 'Outside the map';
      const k = idx(tx, ty);
      if (!this.fog[k]) return 'Unexplored land';
      if (this.ground[k] === T.WATER) return 'Water';
      if (this.ground[k] === T.ROCK) return 'Rock';
      if (this.occ[k]) return 'Occupied';
      if (type !== 'road' && this.road[k]) return 'Road in the way';
      if (type === 'road' && this.road[k]) return 'Already a road';
      if (!def.frontier && !this.owned[k]) return 'Outside your territory';
    }
    if (def.frontier) {
      const cx = x + w / 2, cy = y + h / 2;
      if (!this.territorySources().some(b => dist(b.cx, b.cy, cx, cy) <= BUILDINGS[b.type].territory + 14)) return 'Too far from your territory';
    }
    if (def.on) {
      const d = this.deposits.find(q => q.found && q.kind === def.on && q.x === x && q.y === y);
      if (!d) return `Must be placed exactly on a discovered ${def.on} deposit`;
      if ([...this.buildings.values()].some(b => b.x === x && b.y === y)) return 'Deposit already mined';
    }
    if (def.near?.what === 'rock' && this.nearCount(x + w / 2, y + h / 2, def.near) < 1) return 'Must be next to a rock outcrop';
    return '';
  }

  /** Deposits are placeable "occupied" ground: mines must cover them, nothing else may. */
  depositAt(x, y) { return this.deposits.find(d => x >= d.x && x < d.x + 2 && y >= d.y && y < d.y + 2); }

  costOf(type) { return BUILDINGS[type].cost || {}; }
  affordable(cost) { for (const [k, v] of Object.entries(cost)) { if (k === 'gold' ? this.gold < v : (this.stock[k] || 0) < v) return false; } return true; }
  pay(cost, sign = 1) { for (const [k, v] of Object.entries(cost)) { if (k === 'gold') this.gold -= v * sign; else this.stock[k] = (this.stock[k] || 0) - v * sign; } }
  missing(cost) { return Object.entries(cost).filter(([k, v]) => (k === 'gold' ? this.gold : this.stock[k] || 0) < v).map(([k]) => k === 'gold' ? 'gold' : GOODS[k].name); }

  /** Player action: build. Returns the building or { error }. */
  build(type, x, y) {
    if (type === 'road') return this.buildRoad(x, y);
    let err = this.placeError(type, x, y);
    if (!err && !BUILDINGS[type].on) { const [w, h] = BUILDINGS[type].size; for (let j = 0; j < h && !err; j++) for (let i = 0; i < w; i++) if (this.depositAt(x + i, y + j)) { err = 'Deposit in the way (mines only)'; break; } }
    if (err) return { error: err };
    const cost = this.costOf(type);
    if (!this.affordable(cost)) return { error: `Not enough ${this.missing(cost).join(', ')}` };
    this.pay(cost);
    const b = this.place(type, x, y);
    if (BUILDINGS[type].monument) { this.won = true; this.emit('victory'); }
    return b;
  }

  place(type, x, y, free = false) {
    const def = BUILDINGS[type], [w, h] = def.size;
    const b = {
      id: this.nextId++, type, x, y, w, h, cx: x + w / 2, cy: y + h / 2,
      progress: 0, running: false, out: {}, pending: 0, paused: false, fire: 0, ruined: false,
      connected: false, storage: 0, prod: 0, status: '', near: 1, nearT: 0,
      residents: 0, moveT: 0, need: {}, debt: {}, happiness: 50, built: this.time,
    };
    if (def.residence != null) { b.tier = def.residence; b.residents = free ? 0 : 1; }
    this.buildings.set(b.id, b);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = idx(x + i, y + j);
      this.occ[k] = b.id;
      if (this.tree[k]) { this.tree[k] = 0; this.emit('tree', { x: x + i, y: y + j, on: false }); }
    }
    if (def.vision) this.reveal(b.cx, b.cy, def.vision);
    if (def.territory) this.recomputeTerritory();
    this.dirty = true;
    this.emit('built', { id: b.id });
    return b;
  }

  buildRoad(x, y) {
    const err = this.placeError('road', x, y);
    if (err) return { error: err };
    if (this.depositAt(x, y)) return { error: 'Deposit in the way' };
    if (this.gold < 1) return { error: 'Not enough gold' };
    this.gold -= 1; this.setRoad(x, y, true);
    return { road: true };
  }
  setRoad(x, y, on) {
    const k = idx(x, y);
    if (on && this.tree[k]) { this.tree[k] = 0; this.emit('tree', { x, y, on: false }); }
    this.road[k] = on ? 1 : 0; this.dirty = true;
    this.emit('road', { x, y, on });
  }

  /** Demolish a building (refund half the goods) or a road tile. */
  demolish(x, y) {
    if (!inMap(x, y)) return { error: 'Nothing here' };
    const k = idx(x, y);
    if (this.road[k]) { this.setRoad(x, y, false); return { road: true }; }
    const b = this.buildings.get(this.occ[k]);
    if (!b) return { error: 'Nothing here' };
    if (b.type === 'townhall' || b.type === 'sanctum') return { error: 'This cannot be demolished' };
    for (const [g, v] of Object.entries(this.costOf(b.type))) if (g !== 'gold') this.stock[g] += Math.floor(v / 2);
    this.remove(b);
    return { removed: b.type };
  }
  remove(b) {
    for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) this.occ[idx(b.x + i, b.y + j)] = 0;
    this.buildings.delete(b.id);
    if (BUILDINGS[b.type].territory) this.recomputeTerritory();
    this.dirty = true;
    this.emit('removed', { id: b.id, type: b.type });
  }

  /** Residence upgrade: hut → house → manor. */
  upgradeError(b) {
    if (!b || b.tier == null) return 'Not a residence';
    if (b.tier >= TIERS.length - 1) return 'Already the highest tier';
    if (b.fire || b.ruined) return 'Repair it first';
    const next = TIERS[b.tier + 1];
    if (!this.tierUnlocked(b.tier + 1)) {
      const u = next.unlock, bits = [];
      if (u.settlers) bits.push(`${u.settlers} Settlers`); if (u.craftsmen) bits.push(`${u.craftsmen} Craftsmen`);
      if (u.relics) bits.push(`${u.relics} relic${u.relics > 1 ? 's' : ''}`);
      return `${next.name} unlock at ${bits.join(' + ')}`;
    }
    if (b.residents < TIERS[b.tier].cap) return 'House must be full: meet all basic needs first';
    if (!this.affordable(next.upgrade)) return `Not enough ${this.missing(next.upgrade).join(', ')}`;
    return '';
  }
  upgrade(id) {
    const b = this.buildings.get(id), err = this.upgradeError(b);
    if (err) return { error: err };
    this.pay(TIERS[b.tier + 1].upgrade);
    b.tier++; b.type = RESIDENCE_TYPES[b.tier]; b.need = {}; b.debt = {};
    this.dirty = true;
    this.emit('upgraded', { id: b.id });
    return b;
  }
  /** Extinguish a fire or rebuild a ruin. */
  repairCost(b) {
    if (b.fire) return { gold: 40 };
    if (b.ruined) { const c = {}; for (const [k, v] of Object.entries(this.costOf(b.type))) c[k] = Math.ceil(v / 2); return c; }
    return null;
  }
  repair(id) {
    const b = this.buildings.get(id), cost = b && this.repairCost(b);
    if (!cost) return { error: 'Nothing to repair' };
    if (!this.affordable(cost)) return { error: `Not enough ${this.missing(cost).join(', ')}` };
    this.pay(cost); b.fire = 0; b.ruined = false; this.dirty = true;
    this.emit('repaired', { id }); return b;
  }
  togglePause(id) { const b = this.buildings.get(id); if (b) { b.paused = !b.paused; this.emit('changed', { id }); } return b; }

  // ------------------------------------------------------------------ roads & logistics
  /** Road tiles touching a building's footprint. */
  doorTiles(b) {
    const out = [];
    for (let i = -1; i <= b.w; i++) for (let j = -1; j <= b.h; j++) {
      if ((i === -1 || i === b.w) === (j === -1 || j === b.h)) continue; // edges only, no corners
      const x = b.x + i, y = b.y + j;
      if (inMap(x, y) && this.road[idx(x, y)]) out.push(idx(x, y));
    }
    return out;
  }

  /** Multi-source BFS over roads from every storage: road distance + nearest storage per tile. */
  recompute() {
    this.dirty = false;
    const rd = new Int32Array(W * H).fill(-1), from = new Int32Array(W * H), q = [];
    const storages = [...this.buildings.values()].filter(b => BUILDINGS[b.type].storage && !b.ruined);
    for (const s of storages) for (const k of this.doorTiles(s)) if (rd[k] < 0) { rd[k] = 0; from[k] = s.id; q.push(k); }
    for (let h = 0; h < q.length; h++) {
      const k = q[h], x = k % W, y = (k / W) | 0;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (!inMap(nx, ny)) continue;
        const j = idx(nx, ny);
        if (!this.road[j] || rd[j] >= 0) continue;
        rd[j] = rd[k] + 1; from[j] = from[k]; q.push(j);
      }
    }
    this.roadDist = rd; this.roadFrom = from;
    let cap = 0;
    for (const s of storages) cap += BUILDINGS[s.type].storage;
    this.cap = cap;
    for (const b of this.buildings.values()) {
      const def = BUILDINGS[b.type];
      if (def.storage) { b.connected = true; b.storage = b.id; b.roadLen = 0; continue; }
      let best = null;
      for (const k of this.doorTiles(b)) {
        if (rd[k] < 0) continue;
        const s = this.buildings.get(from[k]);
        if (dist(b.cx, b.cy, s.cx, s.cy) > BUILDINGS[s.type].logistic) continue;
        if (!best || rd[k] < best.d) best = { d: rd[k], s: s.id };
      }
      b.connected = !!best; b.storage = best?.s || 0; b.roadLen = best ? best.d + 2 : 0;
    }
    this.emit('logistics');
  }

  /** Road path (list of tiles) between two buildings, for carrier animation. */
  roadPath(a, b) {
    const starts = this.doorTiles(a), goals = new Set(this.doorTiles(b));
    if (!starts.length || !goals.size) return null;
    const prev = new Int32Array(W * H).fill(-2), q = [];
    for (const s of starts) { prev[s] = -1; q.push(s); }
    for (let h = 0; h < q.length; h++) {
      const k = q[h];
      if (goals.has(k)) { const path = []; for (let c = k; c >= 0; c = prev[c]) path.push([c % W, (c / W) | 0]); return path.reverse(); }
      const x = k % W, y = (k / W) | 0;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (!inMap(nx, ny)) continue;
        const j = idx(nx, ny);
        if (!this.road[j] || prev[j] !== -2) continue;
        prev[j] = k; q.push(j);
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ simulation
  step(dt) {
    this.acc += dt;
    while (this.acc >= STEP) { this.acc -= STEP; this.tick(); }
  }

  tick() {
    if (this.dirty) this.recompute();
    this.time += STEP;
    const perMin = STEP / 60;
    const blds = [...this.buildings.values()];

    // population & workforce
    const pop = { settlers: 0, craftsmen: 0, merchants: 0, total: 0 };
    for (const b of blds) if (b.tier != null) { pop[TIERS[b.tier].id] += b.residents; pop.total += b.residents; }
    this.pop = pop;
    for (const k of ['settlers', 'craftsmen', 'merchants']) this.peak[k] = Math.max(this.peak[k], pop[k]);
    const demand = [0, 0, 0];
    for (const b of blds) { const wk = BUILDINGS[b.type].workers; if (wk && this.active(b)) demand[wk.tier] += wk.n; }
    const supply = [pop.settlers, pop.craftsmen, pop.merchants];
    this.work = { demand, supply, factor: demand.map((d, i) => d ? Math.min(1, supply[i] / d) : 1) };

    // services in range (only active, connected service buildings)
    const services = blds.filter(b => BUILDINGS[b.type].service && this.active(b));

    let income = 0, upkeep = 0;
    for (const b of blds) {
      const def = BUILDINGS[b.type];
      if (def.upkeep) upkeep += def.upkeep;
      if (b.fire > 0) {
        b.fire -= STEP;
        if (b.fire <= 0) { b.fire = 0; b.ruined = true; if (b.tier != null) b.residents = 0; this.dirty = true; this.emit('ruined', { id: b.id }); this.notify(`${def.name} burned down. Repair it from its panel.`, 'bad'); }
      }
      if (b.tier != null) income += this.tickResidence(b, services, perMin);
      else if (def.cycle) this.tickProduction(b, def);
    }
    const tax = income * perMin, up = upkeep * perMin;
    this.gold += tax - up;
    const k = 1 - STEP / 30; // ~30 s smoothing for the per-minute readouts
    this.stats.income = this.stats.income * k + income * (1 - k);
    this.stats.upkeep = upkeep;

    this.tickCarriers();
    this.tickRaids(blds);
    this.tickCaravan();
    if (Math.round(this.time / STEP) % 4 === 0) this.tickQuests();
  }

  active(b) { return b.connected && !b.paused && !b.fire && !b.ruined; }

  nearCount(cx, cy, near) {
    let n = 0;
    for (let y = Math.max(0, Math.floor(cy - near.r)); y <= Math.min(H - 1, Math.floor(cy + near.r)); y++)
      for (let x = Math.max(0, Math.floor(cx - near.r)); x <= Math.min(W - 1, Math.floor(cx + near.r)); x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > near.r * near.r) continue;
        const k = idx(x, y);
        if (near.what === 'tree' ? this.tree[k] > 0 : this.ground[k] === T.ROCK) n++;
      }
    return n;
  }

  tickProduction(b, def) {
    // status for the UI, productivity factor, then the cycle
    if (!b.connected) { b.prod = 0; b.status = 'No road to the Town Hall or a Warehouse'; return; }
    if (b.ruined) { b.prod = 0; b.status = 'Ruined'; return; }
    if (b.fire) { b.prod = 0; b.status = 'On fire!'; return; }
    if (b.paused) { b.prod = 0; b.status = 'Paused'; return; }
    if ((b.nearT -= STEP) <= 0 && def.near) { b.nearT = 3; b.near = Math.min(1, this.nearCount(b.cx, b.cy, def.near) / def.near.full); }
    const wf = def.workers ? this.work.factor[def.workers.tier] : 1;
    const nf = def.near ? b.near : 1;
    const outN = Object.values(b.out).reduce((a, v) => a + v, 0);
    b.prod = wf * nf;
    if (!b.running) {
      if (outN >= LOCAL_CAP) { b.prod = 0; b.status = 'Storage full: waiting for a carrier'; return; }
      const ins = Object.entries(def.in || {});
      const lacking = ins.filter(([g, n]) => (this.stock[g] || 0) < n);
      if (lacking.length) { b.prod = 0; b.status = `Missing ${lacking.map(([g]) => GOODS[g].name).join(', ')}`; return; }
      if (def.fells && b.near <= 0) { b.prod = 0; b.status = 'No trees in range'; return; }
      if (def.near?.what === 'rock' && b.near <= 0) { b.prod = 0; b.status = 'No rock in range'; return; }
      for (const [g, n] of ins) { this.stock[g] -= n; this.count2(this.stats.cons, g, n); }
      b.running = true;
    }
    b.status = wf < 1 ? `Short of ${TIERS[def.workers.tier].name} workers` : nf < 1 ? (def.near.what === 'tree' ? 'Few trees in range' : 'Little rock in range') : 'Working';
    b.progress += STEP * b.prod * this.relicMult(b.type) / def.cycle;
    if (b.progress < 1) return;
    b.progress = 0; b.running = false;
    for (const [g, n] of Object.entries(def.out)) b.out[g] = (b.out[g] || 0) + n;
    if (def.fells) this.fellTree(b, def.near.r);
    if (def.plants) this.plantTree(b, 5);
    this.emit('produced', { id: b.id });
  }

  count2(map, g, n) { map[g] = (map[g] || 0) + n; }

  fellTree(b, r) {
    let best = null;
    for (let y = Math.max(0, Math.floor(b.cy - r)); y <= Math.min(H - 1, Math.floor(b.cy + r)); y++)
      for (let x = Math.max(0, Math.floor(b.cx - r)); x <= Math.min(W - 1, Math.floor(b.cx + r)); x++) {
        const d = (x + 0.5 - b.cx) ** 2 + (y + 0.5 - b.cy) ** 2;
        if (d > r * r || !this.tree[idx(x, y)]) continue;
        if (!best || d < best.d) best = { x, y, d };
      }
    if (!best) return;
    this.tree[idx(best.x, best.y)] = 0;
    this.emit('tree', { x: best.x, y: best.y, on: false, by: b.id });
  }

  plantTree(b, r) {
    for (let tries = 0; tries < 20; tries++) {
      const x = Math.floor(b.cx + (this.rand() * 2 - 1) * r), y = Math.floor(b.cy + (this.rand() * 2 - 1) * r);
      if (!inMap(x, y)) continue;
      const k = idx(x, y);
      if (this.tree[k] || this.occ[k] || this.road[k] || this.ground[k] !== T.GRASS || this.depositAt(x, y)) continue;
      this.tree[k] = 1 + Math.floor(this.rand() * 8);
      this.emit('tree', { x, y, on: true, by: b.id });
      return;
    }
  }

  tickResidence(b, services, perMin) {
    const tier = TIERS[b.tier], def = BUILDINGS[b.type];
    if (b.ruined || b.fire) { if (b.fire && b.residents > 0 && Math.round(this.time / STEP) % 12 === 0) b.residents--; b.happiness = 0; return 0; }
    const has = need => need.good ? (this.stock[need.good] || 0) > 0 : services.some(s => BUILDINGS[s.type].service === need.service && dist(s.cx, s.cy, b.cx, b.cy) <= BUILDINGS[s.type].range);
    const consume = need => {
      if (!need.good || !b.residents) return;
      b.debt[need.good] = (b.debt[need.good] || 0) + b.residents * need.rate * perMin;
      while (b.debt[need.good] >= 1 && this.stock[need.good] >= 1) { this.stock[need.good]--; b.debt[need.good]--; this.count2(this.stats.cons, need.good, 1); }
      if (b.debt[need.good] > 3) b.debt[need.good] = 3;
    };
    // a goods need is met while this house keeps getting its share (unpaid debt above 1.5 = shortage)
    const supplied = need => need.good ? (b.debt[need.good] || 0) < 1.5 : true;
    let basicMet = 0, luxMet = 0;
    for (const n of [...tier.basic, ...tier.luxury]) if (b.connected && (n.service ? has(n) : true)) consume(n);
    for (const n of tier.basic) { const ok = b.connected && (n.good ? supplied(n) && (this.stock[n.good] > 0 || (b.debt[n.good] || 0) < 0.3) : has(n)); b.need[n.good || n.service] = ok; if (ok) basicMet++; }
    for (const n of tier.luxury) { const ok = b.connected && (n.good ? supplied(n) && (this.stock[n.good] > 0 || (b.debt[n.good] || 0) < 0.3) : has(n)); b.need[n.good || n.service] = ok; if (ok) luxMet++; }
    const frac = basicMet / tier.basic.length, lux = luxMet / tier.luxury.length;
    const target = Math.max(1, Math.round(tier.cap * frac * frac)); // unmet needs drive people away fast
    b.target = target;
    b.happiness = Math.round(Math.max(0, Math.min(100, 40 + 45 * lux + 15 * frac - (frac < 1 ? 20 : 0))));
    if ((b.moveT -= STEP) <= 0) {
      b.moveT = 4;
      if (b.residents < target) { b.residents++; this.emit('movein', { id: b.id }); }
      else if (b.residents > target) { b.residents--; this.emit('moveout', { id: b.id }); }
    }
    void def;
    return b.residents * tier.tax * (0.5 + b.happiness / 100) * (1 + this.relicTax());
  }

  /** Carriers fetch finished goods from production buildings and bring them to storage. */
  tickCarriers() {
    const cap = this.cap || 40;
    this.trips ||= [];
    // finish trips
    for (const t of this.trips) {
      if (!t.picked && this.time >= t.pick) {
        t.picked = true; const b = this.buildings.get(t.to);
        if (b) { t.goods = { ...b.out }; b.out = {}; b.pending = 0; } else t.goods = {};
      }
      if (this.time >= t.end) {
        for (const [g, n] of Object.entries(t.goods || {})) { this.stock[g] = Math.min(cap, (this.stock[g] || 0) + n); this.count2(this.stats.prod, g, n); }
        t.done = true;
      }
    }
    this.trips = this.trips.filter(t => !t.done);
    // dispatch: storage → building with the fullest buffer first
    const busy = {};
    for (const t of this.trips) busy[t.from] = (busy[t.from] || 0) + 1;
    const waiting = [...this.buildings.values()].filter(b => !b.pending && b.connected && Object.values(b.out).some(v => v > 0))
      .sort((a, b) => Object.values(b.out).reduce((s, v) => s + v, 0) - Object.values(a.out).reduce((s, v) => s + v, 0));
    for (const b of waiting) {
      const s = this.buildings.get(b.storage);
      if (!s || (busy[s.id] || 0) >= BUILDINGS[s.type].carriers) continue;
      busy[s.id] = (busy[s.id] || 0) + 1;
      const leg = b.roadLen / CARRIER_SPEED + 1.5;
      const trip = { id: `t${this.time}_${b.id}`, from: s.id, to: b.id, start: this.time, pick: this.time + leg, end: this.time + 2 * leg, good: Object.keys(b.out).find(g => b.out[g] > 0) };
      b.pending = 1; this.trips.push(trip);
      this.emit('trip', { trip });
    }
  }

  // ------------------------------------------------------------------ raids
  tickRaids(blds) {
    const targets = blds.filter(b => b.type !== 'townhall' && b.type !== 'sanctum' && !b.ruined && !b.fire);
    const calm = this.time < RAID_GRACE || this.pop.total < 40;
    for (const l of this.lairs) {
      if (l.cleared || calm) continue;
      const near = targets.some(b => dist(b.cx, b.cy, l.x + 1.5, l.y + 1.5) < RAID_RANGE);
      if (!near) { l.nextRaid = 0; continue; }
      if (!l.nextRaid) { l.nextRaid = this.time + RAID_EVERY[0] + this.rand() * (RAID_EVERY[1] - RAID_EVERY[0]); continue; }
      if (this.time < l.nextRaid || !this.night) continue;
      l.nextRaid = this.time + RAID_EVERY[0] + this.rand() * (RAID_EVERY[1] - RAID_EVERY[0]);
      const target = targets.reduce((best, b) => { const d = dist(b.cx, b.cy, l.x + 1.5, l.y + 1.5); return !best || d < best.d ? { b, d } : best; }, null);
      if (!target) continue;
      const raid = { id: this.nextRaidId++, lair: l.id, target: target.b.id, start: this.time, arrive: this.time + Math.max(20, target.d / 1.2), repelled: false, size: LAIR_KINDS[l.kind].guards.length };
      this.raids.push(raid);
      this.emit('raid', { raid });
      this.notify(`Creatures from the ${LAIR_KINDS[l.kind].name} are raiding your ${BUILDINGS[target.b.type].name}!`, 'bad');
    }
    for (const r of this.raids) {
      if (r.done || this.time < r.arrive) continue;
      r.done = true;
      const b = this.buildings.get(r.target);
      if (!b || r.repelled) { this.emit('raidEnd', { raid: r, outcome: 'repelled' }); continue; }
      const tower = blds.find(t => BUILDINGS[t.type].guard && this.active(t) && dist(t.cx, t.cy, b.cx, b.cy) <= BUILDINGS[t.type].range);
      if (tower) { this.emit('raidEnd', { raid: r, outcome: 'tower', tower: tower.id }); this.notify('The watchtower archers drove the raiders off.', 'good'); continue; }
      b.fire = FIRE_TIME; this.dirty = true;
      this.emit('raidEnd', { raid: r, outcome: 'fire' }); this.emit('fire', { id: b.id });
      this.notify(`Your ${BUILDINGS[b.type].name} is on fire! Pay to extinguish it before it burns down.`, 'bad');
    }
    this.raids = this.raids.filter(r => !r.done);
  }
  /** The hero (or anything else) stopped a raid before it arrived. */
  repelRaid(id) { const r = this.raids.find(q => q.id === id); if (r) { r.repelled = true; return true; } return false; }

  // ------------------------------------------------------------------ trade
  hasTradepost() { return this.ofType('tradepost').some(b => this.active(b)); }
  tickCaravan() {
    if (!this.hasTradepost()) { this.caravan.here = false; return; }
    this.caravan.t -= STEP;
    if (this.caravan.t > 0) return;
    this.caravan.here = !this.caravan.here;
    this.caravan.t = this.caravan.here ? CARAVAN_STAY : CARAVAN_EVERY;
    this.emit('caravan', { here: this.caravan.here });
    this.notify(this.caravan.here ? 'A merchant caravan has arrived at the Trading Post.' : 'The caravan moves on.', 'info');
  }
  prices(g) { const p = GOODS[g].price, t = this.relicTrade(); return { buy: Math.round(p * 1.3 * (1 - t)), sell: Math.round(p * 0.6 * (1 + t)) }; }
  trade(g, qty) { // qty > 0 buys, < 0 sells
    if (!this.caravan.here) return { error: 'No caravan in town' };
    const { buy, sell } = this.prices(g);
    if (qty > 0) {
      if (this.gold < buy * qty) return { error: 'Not enough gold' };
      this.gold -= buy * qty; this.stock[g] = Math.min(this.cap || 40, this.stock[g] + qty);
    } else {
      const n = Math.min(-qty, this.stock[g]);
      if (!n) return { error: `No ${GOODS[g].name} to sell` };
      this.stock[g] -= n; this.gold += sell * n;
    }
    return { ok: true };
  }

  // ------------------------------------------------------------------ adventure hooks (called by hero mode)
  heroAt(tx, ty) { this.hero.x = tx; this.hero.y = ty; this.reveal(tx, ty, 9); }
  openChest(id) {
    const c = this.chests.find(q => q.id === id);
    if (!c || c.opened) return null;
    c.opened = true; this.gain(c.loot);
    this.emit('chest', { id, loot: c.loot });
    this.notify(`Chest: ${this.lootText(c.loot)}`, 'good');
    return c.loot;
  }
  gain(loot) { for (const [k, v] of Object.entries(loot)) { if (k === 'gold') this.gold += v; else this.stock[k] = (this.stock[k] || 0) + v; } }
  lootText(loot) { return Object.entries(loot).map(([k, v]) => k === 'gold' ? `${v} gold` : `${v} ${GOODS[k].name}`).join(', '); }
  clearLair(id) {
    const l = this.lairs.find(q => q.id === id);
    if (!l || l.cleared) return null;
    l.cleared = true; const loot = LAIR_KINDS[l.kind].loot; this.gain(loot);
    this.emit('lairCleared', { id });
    this.notify(`${LAIR_KINDS[l.kind].name} cleared! ${this.lootText(loot)}${l.relic ? '. The relic is free: pick it up!' : ''}`, 'good');
    return l;
  }
  takeRelic(lairId) {
    const l = this.lairs.find(q => q.id === lairId);
    if (!l || !l.cleared || !l.relic || l.relicTaken || this.hero.carry) return false;
    l.relicTaken = true; this.hero.carry = l.relic;
    const r = RELICS.find(q => q.id === l.relic);
    this.emit('relicTaken', { id: l.relic });
    this.notify(`You hold the ${r.name}! Carry it back to the Town Hall.`, 'good');
    return true;
  }
  deliverRelic() {
    const id = this.hero.carry;
    if (!id) return false;
    this.hero.carry = null; this.relics.push(id);
    const r = RELICS.find(q => q.id === id);
    this.emit('relic', { id });
    this.notify(`${r.name} enshrined: ${r.boon}.`, 'good');
    for (let t = 1; t < TIERS.length; t++) if (this.tierUnlocked(t) && !this.unlockedSeen?.[t]) { (this.unlockedSeen ||= {})[t] = true; this.notify(`${TIERS[t].name} are now available: upgrade your houses!`, 'good'); }
    return true;
  }
  /** Spend a map: reveal the area around the nearest relic lair not yet found. */
  useMap() {
    if ((this.stock.maps || 0) < 1) return { error: 'No maps. Build a Cartographer.' };
    const th = this.ofType('townhall')[0];
    const l = this.lairs.filter(q => q.relic && !q.found).sort((a, b) => dist(a.x, a.y, th.cx, th.cy) - dist(b.x, b.y, th.cx, th.cy))[0];
    if (!l) return { error: 'Every relic site is already on your map.' };
    this.stock.maps--; this.reveal(l.x + 1.5, l.y + 1.5, 7);
    this.emit('mapUsed', { id: l.id });
    return { lair: l.id };
  }

  // ------------------------------------------------------------------ quests
  tickQuests() {
    const q = QUESTS[this.questIdx];
    if (!q || !q.check(this)) return;
    this.gain(q.reward);
    this.emit('quest', { id: q.id, reward: q.reward });
    if (Object.keys(q.reward).length) this.notify(`Objective complete! Reward: ${this.lootText(q.reward)}`, 'good');
    this.questIdx++;
  }
  get quest() { return QUESTS[this.questIdx] || null; }

  // ------------------------------------------------------------------ save / load
  save() {
    const enc = a => String.fromCharCode(...a.map(v => v + 48));
    const s = a => { let out = ''; for (let i = 0; i < a.length; i += 4096) out += enc(Array.from(a.subarray(i, i + 4096))); return out; };
    return JSON.stringify({
      v: 1, seed: this.seed, hero: this.hero, gold: this.gold, stock: this.stock, time: this.time, acc: this.acc,
      relics: this.relics, questIdx: this.questIdx, won: this.won, caravan: this.caravan, peak: this.peak, unlockedSeen: this.unlockedSeen || {},
      nextId: this.nextId, nextRaidId: this.nextRaidId, raids: this.raids, trips: this.trips || [],
      tree: s(this.tree), fog: s(this.fog), road: s(this.road),
      buildings: [...this.buildings.values()],
      deposits: this.deposits, lairs: this.lairs, chests: this.chests, stats: this.stats,
    });
  }
  static load(json) {
    const d = typeof json === 'string' ? JSON.parse(json) : json;
    const w = generateWorld(d.seed); w.restoring = true;
    const c = new Colony({ seed: d.seed, hero: d.hero.cls, world: w });
    const dec = (str, arr) => { for (let i = 0; i < arr.length; i++) arr[i] = str.charCodeAt(i) - 48; };
    dec(d.tree, c.tree); dec(d.fog, c.fog); dec(d.road, c.road);
    Object.assign(c, { hero: d.hero, gold: d.gold, stock: d.stock, time: d.time, acc: d.acc, relics: d.relics, questIdx: d.questIdx, won: d.won, caravan: d.caravan,
      _peak: d.peak, unlockedSeen: d.unlockedSeen, nextId: d.nextId, nextRaidId: d.nextRaidId, raids: d.raids, trips: d.trips, deposits: d.deposits, lairs: d.lairs, chests: d.chests, stats: d.stats });
    c.rand = rng(d.seed * 4099 + 77 + Math.floor(d.time));
    for (const b of d.buildings) { c.buildings.set(b.id, b); for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) c.occ[idx(b.x + i, b.y + j)] = b.id; }
    c.recomputeTerritory(); c.recompute(); c.events = [];
    return c;
  }
}
