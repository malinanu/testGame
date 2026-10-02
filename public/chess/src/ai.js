// Chess AI: negamax alpha-beta with quiescence, iterative deepening, MVV-LVA + killer move ordering,
// piece-square tables. Pure; runs in a Web Worker (ai-worker.js) or Node (tests).
import { Chess, WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, type, color } from './chess.js';

const VALUE = [0, 100, 320, 330, 500, 900, 20000];
// Piece-square tables from White's view, index [rank 7..0][file 0..7] (top row = 8th rank).
const PST = {
  [PAWN]: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  [KNIGHT]: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  [BISHOP]: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  [ROOK]: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  [QUEEN]: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  [KING]: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
};
const KING_END = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];
const pstIndex = (sq, c) => { const f = sq & 7, r = sq >> 4; return (c === WHITE ? 7 - r : r) * 8 + f; };

export function evaluate(ch) {
  let score = 0, nonPawn = 0;
  const b = ch.board;
  for (let sq = 0; sq < 128; sq++) { if (sq & 0x88) { sq += 7; continue; } const p = b[sq]; if (p && type(p) !== PAWN && type(p) !== KING) nonPawn += VALUE[type(p)]; }
  const endgame = nonPawn <= 2600;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = b[sq]; if (!p) continue;
    const t = type(p), c = color(p), i = pstIndex(sq, c);
    const v = VALUE[t] + (t === KING && endgame ? KING_END[i] : PST[t][i]);
    score += c === WHITE ? v : -v;
  }
  return ch.turn === WHITE ? score : -score;
}

const MATE = 100000;
export function search(fenOrChess, { depth = 3, timeMs = 1500, noise = 0, rand = Math.random } = {}) {
  const ch = typeof fenOrChess === 'string' ? new Chess(fenOrChess) : fenOrChess;
  const deadline = Date.now() + timeMs;
  let nodes = 0, stopped = false;
  const killers = [];
  const order = (moves, ply, pv) => {
    for (const m of moves) {
      m.s = m.captured ? 10 * VALUE[type(m.captured)] - VALUE[type(m.piece)] + 100000 : 0;
      if (m.promo) m.s += VALUE[m.promo] + 50000;
      const k = killers[ply];
      if (k && k.from === m.from && k.to === m.to) m.s += 9000;
      if (pv && pv.from === m.from && pv.to === m.to && pv.promo === m.promo) m.s += 1e7;
    }
    return moves.sort((a, b) => b.s - a.s);
  };
  const quiesce = (alpha, beta, ply) => {
    if ((++nodes & 2047) === 0 && Date.now() > deadline) stopped = true;
    const stand = evaluate(ch);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (ply > 12) return alpha;
    for (const m of order(ch.pseudo(true), ply)) {
      ch.make(m);
      if (ch.inCheck(ch.turn ^ 8)) { ch.unmake(); continue; }
      const s = -quiesce(-beta, -alpha, ply + 1);
      ch.unmake();
      if (stopped) return alpha;
      if (s >= beta) return beta;
      if (s > alpha) alpha = s;
    }
    return alpha;
  };
  const negamax = (d, alpha, beta, ply, pv) => {
    if ((++nodes & 2047) === 0 && Date.now() > deadline) stopped = true;
    if (stopped) return 0;
    if (d <= 0) return quiesce(alpha, beta, ply);
    const inCheck = ch.inCheck();
    let legal = 0, best = -Infinity, bestMove = null;
    for (const m of order(ch.pseudo(), ply, pv)) {
      ch.make(m);
      if (ch.inCheck(ch.turn ^ 8)) { ch.unmake(); continue; }
      legal++;
      const s = -negamax(d - 1 + (inCheck ? 1 : 0) * (ply < 6 ? 1 : 0), -beta, -alpha, ply + 1, null);
      ch.unmake();
      if (stopped) return 0;
      if (s > best) { best = s; bestMove = m; }
      if (s > alpha) alpha = s;
      if (alpha >= beta) { if (!m.captured) killers[ply] = m; break; }
    }
    if (!legal) return inCheck ? -MATE + ply : 0;
    if (ply === 0) rootBest = bestMove;
    return best;
  };

  let rootBest = null, best = null, bestScore = 0, reached = 0;
  const root = ch.moves();
  if (!root.length) return null;
  if (root.length === 1) return { move: root[0], score: 0, depth: 0, nodes: 0 };
  for (let d = 1; d <= depth; d++) {
    rootBest = null;
    const score = negamax(d, -Infinity, Infinity, 0, best);
    if (stopped && d > 1) break;
    if (rootBest) { best = rootBest; bestScore = score; reached = d; }
    if (Math.abs(score) > MATE - 100) break;
  }
  if (noise > 0) { // weaker play: pick among near-best moves by noisy static evaluation after one ply
    const scored = root.map(m => { ch.make(m); const s = -evaluate(ch) + (rand() - 0.5) * noise; ch.unmake(); return { m, s }; });
    scored.sort((a, b) => b.s - a.s);
    if (rand() < 0.75) best = scored[0].m;
  }
  return { move: best, score: bestScore, depth: reached, nodes };
}

export const LEVELS = {
  easy:   { depth: 1, timeMs: 400, noise: 160 },
  medium: { depth: 3, timeMs: 1200, noise: 0 },
  hard:   { depth: 5, timeMs: 2500, noise: 0 },
};
