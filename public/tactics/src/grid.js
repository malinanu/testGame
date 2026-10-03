// Pure grid logic (no DOM / three.js): map generation, pathfinding, line of sight, cover.
import { W, H, T, TILE } from './data.js';

export function rng(seed) { // mulberry32
  let s = seed >>> 0;
  return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const N8 = [...N4, [1, 1], [1, -1], [-1, 1], [-1, -1]];
export const dist = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

export class Grid {
  constructor(w = W, h = H) {
    this.w = w; this.h = h;
    this.t = new Uint8Array(w * h);    // tile type
    this.fire = new Uint8Array(w * h); // rounds of fire left
    this.v = new Uint8Array(w * h);    // visual variant seed
  }
  in(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  i(x, y) { return y * this.w + x; }
  xy(i) { return [i % this.w, (i / this.w) | 0]; }
  get(x, y) { return this.t[this.i(x, y)]; }
  set(x, y, t) { this.t[this.i(x, y)] = t; }
  def(x, y) { return TILE[this.get(x, y)]; }
  blocked(x, y) { return !this.in(x, y) || !!this.def(x, y).block; }
  blocksLos(x, y) { return this.in(x, y) && !!this.def(x, y).los; }
  cost(x, y) { return this.def(x, y).cost || 1; }
  isAdjTo(x, y, type) { return N8.some(([dx, dy]) => this.in(x + dx, y + dy) && this.get(x + dx, y + dy) === type); }
}

/** Sampled supercover line between tile centres; pillars and leafy trees block it. */
export function lineOfSight(g, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, steps = Math.max(Math.abs(dx), Math.abs(dy)) * 8;
  for (let s = 1; s < steps; s++) {
    const t = s / steps, px = ax + dx * t, py = ay + dy * t;
    // check both tiles when the sample sits on a tile boundary so diagonal corner gaps don't leak
    for (const [x, y] of [[Math.floor(px + 0.5), Math.floor(py + 0.5)], [Math.ceil(px - 0.5), Math.ceil(py - 0.5)]]) {
      if ((x === ax && y === ay) || (x === bx && y === by)) continue;
      if (g.blocksLos(x, y)) return false;
    }
  }
  return true;
}

/** Half cover: an obstacle orthogonally adjacent to the target, on the attacker's side. */
export function halfCover(g, ax, ay, tx, ty) {
  if (dist(ax, ay, tx, ty) <= 1) return false;
  const vx = ax - tx, vy = ay - ty, len = Math.hypot(vx, vy);
  for (const [dx, dy] of N4) {
    const x = tx + dx, y = ty + dy;
    if (!g.in(x, y) || !g.def(x, y).block) continue;
    if ((dx * vx + dy * vy) / len > 0.35) return true;
  }
  return false;
}

/**
 * Dijkstra over 4-neighbours. Allies can be passed through but not stopped on, enemies block,
 * and an enemy Knight's surrounding tiles end movement (Hold the Line).
 * Returns Map<index, {c, prev, stop}> where stop=false means the tile is not a valid destination.
 */
export function reachable(g, units, u, budget) {
  const occ = new Map(), zoc = new Set();
  for (const o of units) {
    if (!o.alive || o === u) continue;
    occ.set(g.i(o.x, o.y), o);
    if (o.side !== u.side && o.cls === 'knight')
      for (const [dx, dy] of N8) if (g.in(o.x + dx, o.y + dy)) zoc.add(g.i(o.x + dx, o.y + dy));
  }
  const start = g.i(u.x, u.y);
  const best = new Map([[start, { c: 0, prev: -1, stop: true }]]);
  const q = [[0, start]];
  while (q.length) {
    let bi = 0; for (let k = 1; k < q.length; k++) if (q[k][0] < q[bi][0]) bi = k;
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
      if (!cur || cur.c > nc) { best.set(nk, { c: nc, prev: k, stop: !o }); q.push([nc, nk]); }
    }
  }
  return best;
}

export function pathTo(g, reach, k) {
  const p = [];
  while (k !== -1 && k !== undefined) { p.unshift(g.xy(k)); k = reach.get(k)?.prev; }
  return p;
}

/** Step distance field from a set of tiles over passable ground (units ignored). */
export function distanceField(g, sources) {
  const d = new Int16Array(g.w * g.h).fill(999), q = [];
  for (const [x, y] of sources) { const k = g.i(x, y); d[k] = 0; q.push(k); }
  for (let h = 0; h < q.length; h++) {
    const [x, y] = g.xy(q[h]);
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (!g.in(nx, ny) || g.blocked(nx, ny)) continue;
      const nk = g.i(nx, ny), nd = d[q[h]] + g.cost(nx, ny);
      if (nd < d[nk]) { d[nk] = nd; q.push(nk); }
    }
  }
  return d;
}

function flood(g, sx, sy) {
  const seen = new Uint8Array(g.w * g.h), q = [g.i(sx, sy)]; seen[q[0]] = 1;
  for (let h = 0; h < q.length; h++) {
    const [x, y] = g.xy(q[h]);
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (!g.in(nx, ny) || g.blocked(nx, ny)) continue;
      const k = g.i(nx, ny); if (!seen[k]) { seen[k] = 1; q.push(k); }
    }
  }
  return seen;
}

/**
 * Seeded forest clearing: two jagged barriers of trees/rocks with narrow gaps (chokepoints),
 * scattered boulders, bushes and grass, corrupted trees that scale with depth.
 * Player deploys on rows 0-1, enemies on rows H-2..H-1.
 */
export function generateMap(seed, depth = 0) {
  const r = rng(seed);
  const g = new Grid();
  const pick = opts => { let x = r() * opts.reduce((s, o) => s + o[1], 0); for (const [v, w] of opts) if ((x -= w) < 0) return v; return opts[0][0]; };
  const obstacle = () => pick([[T.TREE, 4], [T.PILLAR, 3], [T.BARE, 1.5], [T.BOULDER, 1.5]]);
  const ri = (a, b) => a + Math.floor(r() * (b - a + 1));

  for (let i = 0; i < g.t.length; i++) { g.t[i] = r() < 0.3 ? T.GRASS : T.GROUND; g.v[i] = Math.floor(r() * 256); }

  // barriers with chokepoint gaps
  for (const row of [ri(3, 4), ri(7, 8)]) {
    const gaps = [];
    const nGaps = r() < 0.35 ? 3 : 2;
    for (let n = 0; n < nGaps; n++) gaps.push({ x: ri(1, W - 2), w: r() < 0.6 ? 1 : 2 });
    for (let x = 0; x < W; x++) {
      if (gaps.some(gp => x >= gp.x && x < gp.x + gp.w)) continue;
      if (r() < 0.12) continue;
      const y = row + (r() < 0.25 ? (r() < 0.5 ? -1 : 1) : 0);
      g.set(x, y, obstacle());
    }
  }
  const scatter = (type, n, y0 = 2, y1 = H - 3) => {
    for (let k = 0, tries = 0; k < n && tries < 200; tries++) {
      const x = ri(0, W - 1), y = ri(y0, y1);
      if (g.get(x, y) > T.GRASS) continue;
      g.set(x, y, type); k++;
    }
  };
  scatter(T.BOULDER, ri(5, 8), 1, H - 2);
  scatter(T.BUSH, ri(6, 9), 1, H - 2);
  scatter(T.TREE, ri(2, 4));
  scatter(T.PILLAR, ri(1, 2));
  scatter(T.BARE, ri(1, 2));
  scatter(T.CORRUPT, Math.min(5, Math.floor(depth / 2) + (r() < 0.6 ? 1 : 0)), 3, H - 4);

  // deployment zones
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

  // guarantee the zones connect: knock out obstacles bordering the reachable region until they do
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
