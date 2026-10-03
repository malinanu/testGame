// Seeded world generation for Wildwood Colony. Pure (runs in Node).
import { W, H } from './data.js';

export const T = { GRASS: 0, ROCK: 1, WATER: 2 };
export const TREE_VARIANTS = 8;

export function rng(seed) { // mulberry32
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export const idx = (x, y) => y * W + x;
export const inMap = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

/** Smooth value noise in [0,1], a few octaves. */
function noise2(seed) {
  const r = rng(seed), G = 17, grid = [];
  for (let o = 0; o < 3; o++) { const n = G << o, a = new Float32Array((n + 1) * (n + 1)); for (let i = 0; i < a.length; i++) a[i] = r(); grid.push({ n, a }); }
  const s = t => t * t * (3 - 2 * t);
  return (x, y) => {
    let v = 0, w = 0, amp = 1;
    for (const { n, a } of grid) {
      const fx = x / W * n, fy = y / H * n, ix = Math.floor(fx), iy = Math.floor(fy), tx = s(fx - ix), ty = s(fy - iy);
      const g = (i, j) => a[Math.min(n, j) * (n + 1) + Math.min(n, i)];
      const top = g(ix, iy) * (1 - tx) + g(ix + 1, iy) * tx, bot = g(ix, iy + 1) * (1 - tx) + g(ix + 1, iy + 1) * tx;
      v += (top * (1 - ty) + bot * ty) * amp; w += amp; amp *= 0.5;
    }
    return v / w;
  };
}

/**
 * Generate a world. Returns:
 *  { seed, ground: Uint8Array, tree: Uint8Array (0 = none, else variant), start: {x,y},
 *    deposits: [{id, kind, x, y}], lairs: [{id, kind, x, y, relic}], chests: [{id, x, y, loot}] }
 * Deposits and lairs occupy 2×2 / 3×3 tiles starting at (x, y).
 */
export function generateWorld(seed = 1) {
  const r = rng(seed * 7919 + 13), forestN = noise2(seed * 31 + 1), rockN = noise2(seed * 53 + 7), waterN = noise2(seed * 97 + 3);
  const ground = new Uint8Array(W * H), tree = new Uint8Array(W * H);
  const cx = W >> 1, cy = H >> 1, start = { x: cx - 2, y: cy - 2 };
  const edge = (x, y) => Math.min(x, y, W - 1 - x, H - 1 - y);

  // lakes (never close to the start)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = dist(x, y, cx, cy);
    if (d > 16 && edge(x, y) > 3 && waterN(x, y) > 0.68) ground[idx(x, y)] = T.WATER;
  }
  // rock outcrops: noise clusters + a guaranteed one near the start for the first quarry
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = dist(x, y, cx, cy);
    if (ground[idx(x, y)] === T.GRASS && d > 13 && rockN(x, y) > 0.72) ground[idx(x, y)] = T.ROCK;
  }
  const qa = r() * Math.PI * 2, qx = Math.round(cx + Math.cos(qa) * 11), qy = Math.round(cy + Math.sin(qa) * 11);
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) if (Math.abs(x) + Math.abs(y) < 2 || r() < 0.5) ground[idx(qx + x, qy + y)] = T.ROCK;
  // mountains along the edges
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (edge(x, y) < 2 || (edge(x, y) < 4 && rockN(x, y) > 0.5)) ground[idx(x, y)] = T.ROCK;

  // forest: dense noise forests, a meadow around the start, trees thinning near water
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    if (ground[i] !== T.GRASS) continue;
    const d = dist(x + 0.5, y + 0.5, cx, cy);
    let p = (forestN(x, y) - 0.38) * 2.2;
    if (d < 9) p = 0; else if (d < 15) p *= (d - 9) / 6;
    if (edge(x, y) < 6) p += 0.5;
    if (r() < p) tree[i] = 1 + Math.floor(r() * TREE_VARIANTS);
  }
  // a guaranteed grove near the start for the first lumberjack/hunter
  const ga = qa + Math.PI * (0.6 + r() * 0.8);
  for (let k = 0; k < 40; k++) {
    const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * 4.5, x = Math.round(cx + Math.cos(ga) * 13 + Math.cos(a) * rr), y = Math.round(cy + Math.sin(ga) * 13 + Math.sin(a) * rr);
    if (inMap(x, y) && ground[idx(x, y)] === T.GRASS) tree[idx(x, y)] = 1 + Math.floor(r() * TREE_VARIANTS);
  }

  const land = (x, y, w, h) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { if (!inMap(x + i, y + j) || ground[idx(x + i, y + j)] !== T.GRASS) return false; } return true; };
  const clear = (x, y, w, h) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) tree[idx(x + i, y + j)] = 0; };
  const placed = [];
  const spot = (w, h, dmin, dmax, gap) => {
    for (let tries = 0; tries < 4000; tries++) {
      const a = r() * Math.PI * 2, d = dmin + r() * (dmax - dmin);
      const x = Math.round(cx + Math.cos(a) * d - w / 2), y = Math.round(cy + Math.sin(a) * d - h / 2);
      if (edge(x, y) < 5 || edge(x + w, y + h) < 5 || !land(x, y, w, h)) continue;
      if (placed.some(p => dist(p.x, p.y, x, y) < gap)) continue;
      placed.push({ x, y }); clear(x, y, w, h);
      return { x, y };
    }
    return null;
  };
  placed.push({ x: start.x, y: start.y });

  const deposits = [];
  const dep = (kind, dmin, dmax) => { const p = spot(2, 2, dmin, dmax, 10); if (p) deposits.push({ id: `d${deposits.length}`, kind, ...p }); };
  dep('iron', 14, 21); dep('iron', 24, 40); dep('iron', 28, 42); dep('gold', 30, 42); dep('gold', 32, 44);

  // lairs: 3 plain camps, 5 relic sites (relic order: nearer ones first)
  const lairs = [];
  const kinds = ['camp', 'camp', 'den', 'camp', 'den', 'ruin', 'ruin', 'ruin'];
  const bands = [[20, 26], [22, 30], [24, 32], [27, 36], [30, 40], [33, 42], [35, 43], [36, 44]];
  kinds.forEach((kind, i) => { const p = spot(3, 3, bands[i][0], bands[i][1], 12); if (p) lairs.push({ id: `l${i}`, kind, ...p, relic: null }); });
  const relicOrder = ['grove', 'stone', 'ember', 'tide', 'sun'];
  lairs.slice().sort((a, b) => dist(a.x, a.y, cx, cy) - dist(b.x, b.y, cx, cy)).slice(-5)
    .sort((a, b) => dist(a.x, a.y, cx, cy) - dist(b.x, b.y, cx, cy)).forEach((l, i) => { l.relic = relicOrder[i]; });

  const chests = [];
  for (let k = 0; k < 14; k++) {
    const p = spot(1, 1, 14, 44, 6); if (!p) continue;
    const roll = r();
    chests.push({ id: `c${k}`, ...p, loot: roll < 0.4 ? { gold: 120 + Math.floor(r() * 200) } : roll < 0.7 ? { planks: 6, tools: 2 } : roll < 0.9 ? { bricks: 6, food: 8 } : { maps: 1, gold: 100 } });
  }

  // the Town Hall clearing
  clear(start.x - 2, start.y - 2, 8, 8);
  return { seed, ground, tree, start, deposits, lairs, chests };
}

/** Tiles reachable on foot (ignores trees) from the start; used to validate maps. */
export function reachable(world) {
  const seen = new Uint8Array(W * H), q = [idx(world.start.x, world.start.y)];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop(), x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!inMap(nx, ny)) continue;
      const j = idx(nx, ny);
      if (seen[j] || world.ground[j] !== T.GRASS) continue;
      seen[j] = 1; q.push(j);
    }
  }
  return seen;
}
