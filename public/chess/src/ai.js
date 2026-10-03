// Chess AI: negamax alpha-beta with quiescence, iterative deepening, Transposition Table,
// MVV-LVA + killer + history move ordering, comprehensive positional evaluation (pawns, rooks,
// bishop pair, king safety, center control, development), opening book, and weighted
// candidate move selection for diverse, intelligent play every game.
import { Chess, WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, type, color } from './chess.js';
import { getBookMove } from './book.js';

const VALUE = [0, 100, 320, 330, 500, 900, 20000];

// Piece-square tables from White's perspective, index [rank 7..0][file 0..7] (top row = 8th rank).
const PST = {
  [PAWN]: [
    0,   0,   0,   0,   0,   0,   0,   0,
    50,  50,  50,  50,  50,  50,  50,  50,
    10,  10,  20,  30,  30,  20,  10,  10,
     5,   5,  10,  25,  25,  10,   5,   5,
     0,   0,   5,  25,  25,   5,   0,   0,
     5,  -5,  -5,   5,   5,  -5,  -5,   5,
     5,  10,  10,  -5,  -5,  10,  10,   5,
     0,   0,   0,   0,   0,   0,   0,   0
  ],
  [KNIGHT]: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20,   0,   0,   0,   0, -20, -40,
    -30,   0,  10,  15,  15,  10,   0, -30,
    -30,   5,  15,  20,  20,  15,   5, -30,
    -30,   0,  15,  20,  20,  15,   0, -30,
    -30,   5,  10,  15,  15,  10,   5, -30,
    -40, -20,   0,   5,   5,   0, -20, -40,
    -50, -30, -30, -30, -30, -30, -30, -50
  ],
  [BISHOP]: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -10,   0,   5,  10,  10,   5,   0, -10,
    -10,   5,   5,  10,  10,   5,   5, -10,
    -10,   0,  10,  10,  10,  10,   0, -10,
    -10,  10,  10,  10,  10,  10,  10, -10,
    -10,   5,   0,   0,   0,   0,   5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20
  ],
  [ROOK]: [
     0,   0,   0,   0,   0,   0,   0,   0,
     5,  10,  10,  10,  10,  10,  10,   5,
    -5,   0,   0,   0,   0,   0,   0,  -5,
    -5,   0,   0,   0,   0,   0,   0,  -5,
    -5,   0,   0,   0,   0,   0,   0,  -5,
    -5,   0,   0,   0,   0,   0,   0,  -5,
    -5,   0,   0,   0,   0,   0,   0,  -5,
     0,   0,   0,   5,   5,   0,   0,   0
  ],
  [QUEEN]: [
    -20, -10, -10,  -5,  -5, -10, -10, -20,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -10,   0,   5,   5,   5,   5,   0, -10,
     -5,   0,   5,   5,   5,   5,   0,  -5,
      0,   0,   5,   5,   5,   5,   0,  -5,
    -10,   5,   5,   5,   5,   5,   0, -10,
    -10,   0,   5,   0,   0,   0,   0, -10,
    -20, -10, -10,  -5,  -5, -10, -10, -20
  ],
  [KING]: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
     20,  20,   0,   0,   0,   0,  20,  20,
     20,  30,  10,   0,   0,  10,  30,  20
  ],
};
const KING_END = [
  -50, -40, -30, -20, -20, -30, -40, -50,
  -30, -20, -10,   0,   0, -10, -20, -30,
  -30, -10,  20,  30,  30,  20, -10, -30,
  -30, -10,  30,  40,  40,  30, -10, -30,
  -30, -10,  30,  40,  40,  30, -10, -30,
  -30, -10,  20,  30,  30,  20, -10, -30,
  -30, -30,   0,   0,   0,   0, -30, -30,
  -50, -30, -30, -30, -30, -30, -30, -50
];

const PASSED_PAWN_BONUS = [0, 5, 10, 20, 35, 65, 120, 0];

const pstIndex = (sq, c) => {
  const f = sq & 7, r = sq >> 4;
  return (c === WHITE ? 7 - r : r) * 8 + f;
};

// Deterministic Zobrist values for hashing
const Z_PIECES = new Int32Array(16 * 128);
for (let i = 0; i < Z_PIECES.length; i++) Z_PIECES[i] = ((i * 1103515245 + 12345) ^ (i * 2654435761)) | 0;
const Z_SIDE = 0x5a5a5a5a;
const Z_CASTLE = new Int32Array(16);
for (let i = 0; i < 16; i++) Z_CASTLE[i] = (i * 1000000007) | 0;
const Z_EP = new Int32Array(128);
for (let i = 0; i < 128; i++) Z_EP[i] = (i * 999983) | 0;

function computeHash(ch) {
  let h = ch.turn === WHITE ? 0 : Z_SIDE;
  const b = ch.board;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = b[sq];
    if (p) h ^= Z_PIECES[(p << 7) | sq];
  }
  h ^= Z_CASTLE[ch.castling];
  if (ch.ep >= 0) {
    const from = ch.ep + (ch.turn === WHITE ? -16 : 16), pawn = ch.turn | PAWN;
    if ([from - 1, from + 1].some(s => !(s & 0x88) && b[s] === pawn)) {
      h ^= Z_EP[ch.ep];
    }
  }
  return h | 0;
}

export function evaluate(ch) {
  let score = 0, nonPawnWhite = 0, nonPawnBlack = 0;
  const b = ch.board;

  let whiteBishops = 0, blackBishops = 0;
  let whiteQueen = false, blackQueen = false;
  const whitePawnsByFile = new Int8Array(8);
  const blackPawnsByFile = new Int8Array(8);
  const whiteRooks = [];
  const blackRooks = [];
  const whitePawnSquares = [];
  const blackPawnSquares = [];

  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = b[sq];
    if (!p) continue;
    const t = type(p), c = color(p), f = sq & 7;

    if (t === PAWN) {
      if (c === WHITE) { whitePawnsByFile[f]++; whitePawnSquares.push(sq); }
      else { blackPawnsByFile[f]++; blackPawnSquares.push(sq); }
    } else if (t !== KING) {
      if (c === WHITE) {
        nonPawnWhite += VALUE[t];
        if (t === BISHOP) whiteBishops++;
        else if (t === ROOK) whiteRooks.push(sq);
        else if (t === QUEEN) whiteQueen = true;
      } else {
        nonPawnBlack += VALUE[t];
        if (t === BISHOP) blackBishops++;
        else if (t === ROOK) blackRooks.push(sq);
        else if (t === QUEEN) blackQueen = true;
      }
    }
  }

  const endgame = (nonPawnWhite + nonPawnBlack) <= 2600;

  // Material & PST
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = b[sq];
    if (!p) continue;
    const t = type(p), c = color(p), i = pstIndex(sq, c);
    const v = VALUE[t] + (t === KING && endgame ? KING_END[i] : PST[t][i]);
    score += c === WHITE ? v : -v;
  }

  // Bishop pair
  if (whiteBishops >= 2) score += 35;
  if (blackBishops >= 2) score -= 35;

  // Rooks on open/semi-open files & 7th rank
  for (const sq of whiteRooks) {
    const f = sq & 7, r = sq >> 4;
    if (whitePawnsByFile[f] === 0) {
      score += blackPawnsByFile[f] === 0 ? 22 : 12;
    }
    if (r === 6) score += 25; // 7th rank
  }
  for (const sq of blackRooks) {
    const f = sq & 7, r = sq >> 4;
    if (blackPawnsByFile[f] === 0) {
      score -= whitePawnsByFile[f] === 0 ? 22 : 12;
    }
    if (r === 1) score -= 25; // 7th rank for black
  }

  // Pawn structure: doubled and isolated pawns
  for (let f = 0; f < 8; f++) {
    if (whitePawnsByFile[f] > 1) score -= (whitePawnsByFile[f] - 1) * 16;
    if (blackPawnsByFile[f] > 1) score += (blackPawnsByFile[f] - 1) * 16;

    if (whitePawnsByFile[f] > 0) {
      const hasAdj = (f > 0 && whitePawnsByFile[f - 1] > 0) || (f < 7 && whitePawnsByFile[f + 1] > 0);
      if (!hasAdj) score -= whitePawnsByFile[f] * 14;
    }
    if (blackPawnsByFile[f] > 0) {
      const hasAdj = (f > 0 && blackPawnsByFile[f - 1] > 0) || (f < 7 && blackPawnsByFile[f + 1] > 0);
      if (!hasAdj) score += blackPawnsByFile[f] * 14;
    }
  }

  // Passed pawns
  for (const sq of whitePawnSquares) {
    const f = sq & 7, r = sq >> 4;
    let passed = true;
    for (const bsq of blackPawnSquares) {
      const bf = bsq & 7, br = bsq >> 4;
      if (Math.abs(bf - f) <= 1 && br > r) { passed = false; break; }
    }
    if (passed) {
      const bonus = PASSED_PAWN_BONUS[r] * (endgame ? 1.5 : 1.0);
      score += Math.round(bonus);
    }
  }
  for (const sq of blackPawnSquares) {
    const f = sq & 7, r = sq >> 4;
    let passed = true;
    for (const wsq of whitePawnSquares) {
      const wf = wsq & 7, wr = wsq >> 4;
      if (Math.abs(wf - f) <= 1 && wr < r) { passed = false; break; }
    }
    if (passed) {
      const bonus = PASSED_PAWN_BONUS[7 - r] * (endgame ? 1.5 : 1.0);
      score -= Math.round(bonus);
    }
  }

  // King safety & castling
  const wk = ch.kings[0], bk = ch.kings[1];
  if (wk === 0x06) { // White castled kingside
    if (b[0x15] === (WHITE | PAWN)) score += 10;
    if (b[0x16] === (WHITE | PAWN)) score += 12;
    if (b[0x17] === (WHITE | PAWN)) score += 8;
  } else if (wk === 0x02) { // White castled queenside
    if (b[0x11] === (WHITE | PAWN)) score += 10;
    if (b[0x12] === (WHITE | PAWN)) score += 10;
  } else if ((ch.castling & 3) === 0 && wk === 0x04 && blackQueen) {
    score -= 25; // Stuck in center having lost castling rights
  }

  if (bk === 0x76) { // Black castled kingside
    if (b[0x65] === (BLACK | PAWN)) score -= 10;
    if (b[0x66] === (BLACK | PAWN)) score -= 12;
    if (b[0x67] === (BLACK | PAWN)) score -= 8;
  } else if (bk === 0x72) { // Black castled queenside
    if (b[0x61] === (BLACK | PAWN)) score -= 10;
    if (b[0x62] === (BLACK | PAWN)) score -= 10;
  } else if ((ch.castling & 12) === 0 && bk === 0x74 && whiteQueen) {
    score += 25;
  }

  // Opening development incentives
  if (nonPawnWhite >= 1600) {
    if (b[0x01] === (WHITE | KNIGHT)) score -= 10; // b1
    if (b[0x06] === (WHITE | KNIGHT)) score -= 10; // g1
    if (b[0x02] === (WHITE | BISHOP)) score -= 10; // c1
    if (b[0x05] === (WHITE | BISHOP)) score -= 10; // f1
  }
  if (nonPawnBlack >= 1600) {
    if (b[0x71] === (BLACK | KNIGHT)) score += 10; // b8
    if (b[0x76] === (BLACK | KNIGHT)) score += 10; // g8
    if (b[0x72] === (BLACK | BISHOP)) score += 10; // c8
    if (b[0x75] === (BLACK | BISHOP)) score += 10; // f8
  }

  // Center pawn control
  if (b[0x34] === (WHITE | PAWN)) score += 12; // e4
  if (b[0x33] === (WHITE | PAWN)) score += 12; // d4
  if (b[0x44] === (BLACK | PAWN)) score -= 12; // e5
  if (b[0x43] === (BLACK | PAWN)) score -= 12; // d5

  return ch.turn === WHITE ? score : -score;
}

const MATE = 100000;
const TT_EXACT = 1, TT_LOWER = 2, TT_UPPER = 3;

export function search(fenOrChess, { depth = 3, timeMs = 1500, noise = 0, rand = Math.random, useBook = true, candidateWindow = 20 } = {}) {
  const ch = typeof fenOrChess === 'string' ? new Chess(fenOrChess) : fenOrChess;
  const root = ch.moves();
  if (!root.length) return null;
  if (root.length === 1) return { move: root[0], score: 0, depth: 0, nodes: 0 };

  // 1. Opening book query for varied, master opening play
  if (useBook) {
    const bookMove = getBookMove(ch, rand);
    if (bookMove) {
      const match = root.find(m => m.from === bookMove.from && m.to === bookMove.to && (!m.promo || m.promo === bookMove.promo));
      if (match) return { move: match, score: 20, depth, nodes: 1, book: true };
    }
  }

  const deadline = Date.now() + timeMs;
  let nodes = 0, stopped = false;
  const killers = [];
  const history = new Int32Array(128 * 128);

  // Simple Transposition Table: 64k entries
  const TT_SIZE = 65536;
  const ttKeys = new Int32Array(TT_SIZE);
  const ttScores = new Int32Array(TT_SIZE);
  const ttMeta = new Int32Array(TT_SIZE); // (depth << 4) | flag
  const ttMoves = new Int32Array(TT_SIZE);

  const packMove = m => m ? (m.from | (m.to << 7) | ((m.promo || 0) << 14)) : 0;
  const unpackMove = p => p ? { from: p & 0x7f, to: (p >> 7) & 0x7f, promo: (p >> 14) & 0x7 } : null;

  const order = (moves, ply, pv, ttMove) => {
    for (const m of moves) {
      if (ttMove && m.from === ttMove.from && m.to === ttMove.to && (m.promo || 0) === (ttMove.promo || 0)) {
        m.s = 2e7;
      } else if (pv && pv.from === m.from && pv.to === m.to && (pv.promo || 0) === (m.promo || 0)) {
        m.s = 1e7;
      } else if (m.captured) {
        m.s = 10 * VALUE[type(m.captured)] - VALUE[type(m.piece)] + 100000;
      } else if (m.promo) {
        m.s = VALUE[m.promo] + 50000;
      } else {
        const k = killers[ply];
        if (k && k.from === m.from && k.to === m.to) m.s = 9000;
        else m.s = history[m.from * 128 + m.to] || 0;
      }
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

  const isRepetition = () => {
    if (ch.half >= 100) return true;
    const curKey = ch.key();
    let count = 0;
    for (let i = ch.keys.length - 1; i >= 0; i--) {
      if (ch.keys[i] === curKey) {
        count++;
        if (count >= 2) return true;
      }
    }
    return false;
  };

  const negamax = (d, alpha, beta, ply, pv) => {
    if ((++nodes & 2047) === 0 && Date.now() > deadline) stopped = true;
    if (stopped) return 0;

    if (ply > 0 && isRepetition()) return 0; // Evaluate repetition draw as 0

    const hash = computeHash(ch);
    const ttIdx = hash & (TT_SIZE - 1);
    let ttMove = null;
    if (ttKeys[ttIdx] === hash) {
      const meta = ttMeta[ttIdx];
      const ttDepth = meta >> 4;
      const ttFlag = meta & 0xf;
      const ttScore = ttScores[ttIdx];
      ttMove = unpackMove(ttMoves[ttIdx]);
      if (ttDepth >= d && ply > 0) {
        if (ttFlag === TT_EXACT) return ttScore;
        if (ttFlag === TT_LOWER && ttScore >= beta) return ttScore;
        if (ttFlag === TT_UPPER && ttScore <= alpha) return ttScore;
      }
    }

    if (d <= 0) return quiesce(alpha, beta, ply);

    const inCheck = ch.inCheck();
    let legal = 0, best = -Infinity, bestMove = null;
    const origAlpha = alpha;

    for (const m of order(ch.pseudo(), ply, pv, ttMove)) {
      ch.make(m);
      if (ch.inCheck(ch.turn ^ 8)) { ch.unmake(); continue; }
      legal++;
      const s = -negamax(d - 1 + (inCheck ? 1 : 0) * (ply < 6 ? 1 : 0), -beta, -alpha, ply + 1, null);
      ch.unmake();
      if (stopped) return 0;
      if (s > best) { best = s; bestMove = m; }
      if (s > alpha) alpha = s;
      if (alpha >= beta) {
        if (!m.captured) {
          killers[ply] = m;
          history[m.from * 128 + m.to] = (history[m.from * 128 + m.to] || 0) + d * d;
        }
        break;
      }
    }

    if (!legal) return inCheck ? -MATE + ply : 0;

    // Save to TT
    let flag = TT_EXACT;
    if (best <= origAlpha) flag = TT_UPPER;
    else if (best >= beta) flag = TT_LOWER;
    ttKeys[ttIdx] = hash;
    ttScores[ttIdx] = best;
    ttMeta[ttIdx] = (d << 4) | flag;
    ttMoves[ttIdx] = packMove(bestMove);

    return best;
  };

  // Iterative deepening with root move scoring
  let best = null, bestScore = 0, reached = 0;
  let rootScores = [];

  for (let d = 1; d <= depth; d++) {
    let dBest = null, dBestScore = -Infinity;
    const currentRootScores = [];

    // Order root moves: previous iteration's best move first
    const orderedRoot = order(root.slice(), 0, best);
    let alpha = -Infinity;

    for (const m of orderedRoot) {
      ch.make(m);
      if (ch.inCheck(ch.turn ^ 8)) { ch.unmake(); continue; }
      const s = -negamax(d - 1, -Infinity, Infinity, 1, null);
      ch.unmake();

      if (stopped && d > 1) break;
      currentRootScores.push({ move: m, score: s });

      if (s > dBestScore) {
        dBestScore = s;
        dBest = m;
      }
      if (s > alpha) alpha = s;
    }

    if (stopped && d > 1) break;
    if (dBest) {
      best = dBest;
      bestScore = dBestScore;
      reached = d;
      rootScores = currentRootScores;
    }
    if (Math.abs(bestScore) > MATE - 100) break;
  }

  // Multi-candidate move selection for diverse, creative play
  if (rootScores.length > 1) {
    const maxScore = Math.max(...rootScores.map(r => r.score));

    if (maxScore >= MATE - 100) {
      // Checkmate found: always play the fastest mate
      const mates = rootScores.filter(r => r.score === maxScore);
      best = mates[0].move;
      bestScore = maxScore;
    } else if (maxScore <= -MATE + 100) {
      // Getting mated: play the best defense
      const defenses = rootScores.filter(r => r.score === maxScore);
      best = defenses[0].move;
      bestScore = maxScore;
    } else {
      // Normal play: choose among candidate moves within window with Boltzmann distribution
      const window = Math.max(8, candidateWindow);
      const candidates = rootScores.filter(r => r.score >= maxScore - window);

      if (candidates.length > 1) {
        const temperature = window * 0.45;
        const weights = candidates.map(c => Math.exp((c.score - maxScore) / temperature));
        const totalWeight = weights.reduce((sum, w) => sum + w, 0);

        let roll = rand() * totalWeight;
        let chosen = candidates[0];
        for (let i = 0; i < candidates.length; i++) {
          roll -= weights[i];
          if (roll <= 0) { chosen = candidates[i]; break; }
        }
        best = chosen.move;
        bestScore = chosen.score;
      }
    }
  }

  // Easy mode noise fallback
  if (noise > 0 && rand() < 0.35) {
    const scored = root.map(m => {
      ch.make(m);
      const s = -evaluate(ch) + (rand() - 0.5) * noise;
      ch.unmake();
      return { m, s };
    });
    scored.sort((a, b) => b.s - a.s);
    best = scored[0].m;
  }

  return { move: best, score: bestScore, depth: reached, nodes };
}

export const LEVELS = {
  easy:   { depth: 2, timeMs: 500,  noise: 40, candidateWindow: 70 },
  medium: { depth: 4, timeMs: 1500, noise: 0,  candidateWindow: 26 },
  hard:   { depth: 5, timeMs: 3000, noise: 0,  candidateWindow: 12 },
};
