// Opening book for Wizard's Chess.
// Built from popular master and grandmaster opening lines covering King's Pawn (1.e4),
// Queen's Pawn (1.d4), English (1.c4), and Reti (1.Nf3).
import { Chess } from './chess.js';

const LINES = [
  // 1.e4 Open Games (e4 e5)
  { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O', 'O-O'], weight: 35 }, // Italian Giuoco Piano
  { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'd3', 'Bc5', 'O-O', 'd6'], weight: 30 },             // Italian Two Knights
  { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6'], weight: 40 }, // Ruy Lopez Morphy
  { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6', 'O-O', 'Nxe4', 'd4', 'Nd6'], weight: 20 },             // Ruy Lopez Berlin
  { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Nf6', 'Nc3', 'Bb4'], weight: 20 },             // Scotch Game
  { moves: ['e4', 'e5', 'Nc3', 'Nf6', 'f4', 'd5', 'fxe5', 'Nxe4'], weight: 15 },                           // Vienna Game
  { moves: ['e4', 'e5', 'Bc4', 'Nf6', 'd3', 'c6', 'Nf3', 'd5'], weight: 15 },                             // Bishop's Opening
  { moves: ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5', 'd6', 'Nf3', 'Nxe4', 'd4', 'd5'], weight: 20 },             // Petrov's Defense

  // 1.e4 Sicilian Defense (e4 c5)
  { moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be3', 'e5'], weight: 35 }, // Najdorf
  { moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'Nc6', 'Bg5', 'e6'], weight: 25 }, // Classical
  { moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'g6', 'Be3', 'Bg7'], weight: 25 }, // Dragon
  { moves: ['e4', 'c5', 'Nf3', 'e6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'd6'], weight: 20 },             // Scheveningen
  { moves: ['e4', 'c5', 'Nf3', 'Nc6', 'Bb5', 'g6', 'O-O', 'Bg7'], weight: 20 },                           // Rossolimo
  { moves: ['e4', 'c5', 'Nc3', 'Nc6', 'g3', 'g6', 'Bg2', 'Bg7'], weight: 15 },                             // Closed Sicilian

  // 1.e4 French Defense (e4 e6)
  { moves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e5', 'Nfd7'], weight: 25 },             // Classical
  { moves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Bb4', 'e5', 'c5', 'a3', 'Bxc3+', 'bxc3'], weight: 20 },         // Winawer
  { moves: ['e4', 'e6', 'd4', 'd5', 'e5', 'c5', 'c3', 'Nc6', 'Nf3', 'Qb6'], weight: 20 },                 // Advance
  { moves: ['e4', 'e6', 'd4', 'd5', 'Nd2', 'c5', 'exd5', 'exd5', 'Ngf3', 'Nc6'], weight: 15 },             // Tarrasch

  // 1.e4 Caro-Kann Defense (e4 c6)
  { moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6', 'Nf3', 'Nd7'], weight: 25 }, // Classical
  { moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3', 'e6', 'Be2', 'c5'], weight: 20 },                 // Advance
  { moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Bd3', 'Nc6', 'c3', 'Nf6'], weight: 15 },             // Exchange

  // 1.e4 Scandinavian (e4 d5)
  { moves: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5', 'd4', 'Nf6', 'Nf3'], weight: 15 },

  // 1.d4 Queen's Gambit & Slav (d4 d5)
  { moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O', 'Nf3', 'Nbd7'], weight: 35 }, // QGD Orthodox
  { moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'cxd5', 'exd5', 'Bg5', 'c6', 'e3', 'Be7'], weight: 25 }, // QGD Exchange
  { moves: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4', 'a4', 'Bf5', 'e3', 'e6'], weight: 30 },   // Slav
  { moves: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'e6', 'e3', 'Nbd7', 'Bd3', 'Bd6'], weight: 25 },   // Semi-Slav
  { moves: ['d4', 'd5', 'c4', 'dxc4', 'Nf3', 'Nf6', 'e3', 'e6', 'Bxc4', 'c5', 'O-O', 'a6'], weight: 20 },   // QGA

  // 1.d4 London System
  { moves: ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'c5', 'c3', 'Nc6', 'Nd2', 'e6', 'Ngf3', 'Bd6'], weight: 25 },
  { moves: ['d4', 'Nf6', 'Bf4', 'd5', 'e3', 'c5', 'c3', 'Nc6', 'Nd2', 'e6', 'Ngf3'], weight: 20 },

  // 1.d4 Indian Defenses (d4 Nf6)
  { moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O', 'Be2', 'e5', 'O-O', 'Nc6'], weight: 35 }, // King's Indian Classical
  { moves: ['d4', 'Nf6', 'c4', 'g6', 'Nf3', 'Bg7', 'g3', 'O-O', 'Bg2', 'd6', 'O-O', 'Nbd7'], weight: 20 },             // King's Indian Fianchetto
  { moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5', 'cxd5', 'Nxd5', 'e4', 'Nxc3', 'bxc3', 'Bg7'], weight: 20 },             // Grunfeld
  { moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4', 'e3', 'O-O', 'Bd3', 'd5', 'Nf3', 'c5'], weight: 30 },                 // Nimzo-Indian Rubinstein
  { moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4', 'Qc2', 'O-O', 'a3', 'Bxc3+', 'Qxc3', 'b6'], weight: 20 },             // Nimzo-Indian Classical
  { moves: ['d4', 'Nf6', 'c4', 'e6', 'Nf3', 'b6', 'g3', 'Ba6', 'b3', 'Bb4+', 'Bd2', 'Be7'], weight: 20 },                 // Queen's Indian
  { moves: ['d4', 'Nf6', 'c4', 'c5', 'd5', 'e6', 'Nc3', 'exd5', 'cxd5', 'd6', 'e4', 'g6'], weight: 15 },                 // Modern Benoni
  { moves: ['d4', 'Nf6', 'c4', 'e6', 'g3', 'd5', 'Bg2', 'Be7', 'Nf3', 'O-O', 'O-O', 'dxc4'], weight: 20 },                 // Catalan

  // 1.c4 English Opening
  { moves: ['c4', 'e5', 'Nc3', 'Nf6', 'Nf3', 'Nc6', 'g3', 'd5', 'cxd5', 'Nxd5', 'Bg2', 'Nb6'], weight: 25 },
  { moves: ['c4', 'c5', 'Nc3', 'Nc6', 'g3', 'g6', 'Bg2', 'Bg7', 'Nf3', 'Nf6', 'O-O', 'O-O'], weight: 20 },
  { moves: ['c4', 'Nf6', 'Nc3', 'e6', 'e4', 'd5', 'e5', 'd4', 'exf6', 'dxc3', 'bxc3', 'Qxf6'], weight: 15 },

  // 1.Nf3 Reti Opening
  { moves: ['Nf3', 'd5', 'g3', 'Nf6', 'Bg2', 'c6', 'O-O', 'Bf5', 'd3', 'e6', 'Nbd2', 'h6'], weight: 20 },
  { moves: ['Nf3', 'Nf6', 'c4', 'g6', 'b3', 'Bg7', 'Bb2', 'O-O', 'g3', 'd6', 'Bg2', 'e5'], weight: 20 }
];

const BOOK = new Map();

for (const { moves, weight } of LINES) {
  const ch = new Chess();
  for (const san of moves) {
    const k = ch.key();
    const m = ch.play(san);
    if (!m) break;
    if (!BOOK.has(k)) BOOK.set(k, []);
    const entry = BOOK.get(k);
    const existing = entry.find(e => e.san === san);
    if (existing) existing.weight += weight;
    else entry.push({ from: m.from, to: m.to, promo: m.promo || 0, san, weight });
  }
}

/**
 * Returns a weighted random opening book move for the given chess position, or null if out of book.
 * @param {Chess} chess
 * @param {() => number} [rand]
 */
export function getBookMove(chess, rand = Math.random) {
  const entries = BOOK.get(chess.key());
  if (!entries || !entries.length) return null;
  const total = entries.reduce((s, e) => s + e.weight, 0);
  let roll = rand() * total;
  for (const e of entries) {
    roll -= e.weight;
    if (roll <= 0) return e;
  }
  return entries[entries.length - 1];
}

export { BOOK };
