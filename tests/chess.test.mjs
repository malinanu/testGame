// Chess engine + AI tests: perft (move generator correctness), rules edge cases, SAN, AI sanity.
import assert from 'node:assert/strict';
import { Chess, sqName, START_FEN, QUEEN, KNIGHT } from '../public/chess/src/chess.js';
import { search, LEVELS } from '../public/chess/src/ai.js';

const PERFT = [
  [START_FEN, [20, 400, 8902, 197281]],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],     // Kiwipete
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],                         // en passant pins
  ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],          // promotions
  ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
];
for (const [fen, want] of PERFT) {
  const c = new Chess(fen);
  assert.deepEqual(want.map((_, i) => c.perft(i + 1)), want, `perft ${fen}`);
  assert.equal(c.fen(), fen, 'make/unmake restores the position');
}
console.log('ok perft (5 positions)');

{ // scholar's mate, SAN and checkmate
  const c = new Chess();
  for (const s of ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6']) assert.ok(c.play(s), s);
  const m = c.play('Qxf7');
  assert.equal(m.san, 'Qxf7#');
  assert.deepEqual(c.status(), { over: true, result: '1-0', reason: 'checkmate', check: true });
  c.undo(); assert.equal(c.status().over, false, 'undo restores');
}
{ // stalemate
  const c = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.equal(c.status().reason, 'stalemate');
}
{ // en passant + SAN
  const c = new Chess('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3');
  const m = c.play({ from: 'e5', to: 'f6' });
  assert.equal(m.flags, 'e'); assert.equal(m.san, 'exf6'); assert.equal(c.get(0x45 - 16 + 16 - 16), 0);
}
{ // castling: not through check, rook moves
  const c = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.equal(c.play('O-O').san, 'O-O');
  assert.equal(sqName(c.kings[0]), 'g1'); assert.equal(c.fen().split(' ')[0], 'r3k2r/8/8/8/8/8/8/R4RK1');
  const d = new Chess('r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1'); // f2 rook attacks f1
  assert.ok(!d.moves().some(m => m.flags === 'k'), 'cannot castle through an attacked square');
  assert.ok(d.moves().some(m => m.flags === 'q'));
}
{ // promotion choices and under-promotion
  const c = new Chess('8/P7/8/8/8/8/8/k6K w - - 0 1');
  assert.equal(c.moves().filter(m => m.promo).length, 4);
  assert.equal(c.play({ from: 'a7', to: 'a8', promo: 'n' }).san, 'a8=N');
  assert.equal(c.get(0x70) & 7, KNIGHT);
  const d = new Chess('8/P7/8/8/8/8/8/k6K w - - 0 1');
  assert.equal(d.play({ from: 'a7', to: 'a8' }).promo, QUEEN, 'defaults to queen');
}
{ // disambiguation
  const c = new Chess('k7/8/8/8/8/8/8/KN3N2 w - - 0 1');
  assert.ok(c.moves().map(m => c.san(m)).includes('Nbd2'));
}
{ // draws: threefold, fifty-move, insufficient material
  const c = new Chess();
  for (let i = 0; i < 2; i++) for (const s of ['Nf3', 'Nf6', 'Ng1', 'Ng8']) c.play(s);
  assert.equal(c.status().reason, 'threefold repetition');
  // an en-passant square nobody can capture onto does not make 1.e4's position different (FIDE)
  const e = new Chess(); e.play('e4');
  for (let i = 0; i < 2; i++) for (const m of ['Nf6', 'Nf3', 'Ng8', 'Ng1']) e.play(m);
  assert.equal(e.status().reason, 'threefold repetition', 'unusable e.p. square ignored');
  // ...but a capturable one does
  const p = new Chess('4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1'); p.play('e4');
  assert.match(p.key(), / e3$/, 'capturable e.p. square kept in the key');
  assert.equal(new Chess('8/8/8/4k3/8/8/8/4K2R w - - 100 80').status().reason, 'fifty-move rule');
  assert.equal(new Chess('8/8/8/4k3/8/8/8/4KB2 w - - 0 1').status().reason, 'insufficient material');
  assert.equal(new Chess('8/8/8/4k3/8/8/8/4KR2 w - - 0 1').status().over, false);
}
console.log('ok rules (mate, stalemate, en passant, castling, promotion, SAN, draws)');

{ // AI: finds mate in one; doesn't hang the queen; plays legal moves for every level
  const r = search('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', LEVELS.medium);
  assert.equal(sqName(r.move.to), 'd8', 'back-rank mate');
  const q = search('rnb1kbnr/pppp1ppp/8/4p3/4P1q1/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 3', LEVELS.medium);
  assert.notEqual(sqName(q.move.to), 'g2', 'no queen sac into Bxg2? (g2 defended)');
  const c = new Chess();
  for (let i = 0; i < 40 && !c.status().over; i++) {
    const lvl = ['easy', 'medium'][i % 2], r2 = search(c.fen(), { ...LEVELS[lvl], timeMs: 150 });
    assert.ok(c.play({ from: r2.move.from, to: r2.move.to, promo: r2.move.promo }), 'AI move is legal');
  }
  const t = Date.now(); const h = search(START_FEN, { ...LEVELS.hard, useBook: false });
  console.log(`ok AI (mate-in-1, legal self-play; hard reached depth ${h.depth} in ${Date.now() - t}ms, ${h.nodes} nodes)`);

  // Opening variety: AI plays multiple sound moves instead of the exact same line every game
  const startMoves = new Set();
  for (let i = 0; i < 25; i++) startMoves.add(sqName(search(START_FEN, LEVELS.medium).move.to));
  assert.ok(startMoves.size >= 2, 'AI plays different openings from start');

  const e4Replies = new Set();
  const e4Board = new Chess(); e4Board.play('e4');
  for (let i = 0; i < 25; i++) e4Replies.add(sqName(search(e4Board.fen(), LEVELS.medium).move.to));
  assert.ok(e4Replies.size >= 2, 'AI plays different replies to 1.e4');
  console.log('ok opening variety (distinct White openings and Black defenses)');
}
