// Chess rules engine (0x88 board). Pure module: legal moves incl. castling, en passant, promotion;
// check/mate/stalemate, 50-move, threefold repetition, insufficient material; SAN; FEN; undo.
export const WHITE = 0, BLACK = 8;
export const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const N_OFF = [33, 31, 18, 14, -33, -31, -18, -14];
const B_OFF = [17, 15, -17, -15];
const R_OFF = [16, -16, 1, -1];
const K_OFF = [17, 15, -17, -15, 16, -16, 1, -1];
const LETTER = ['', 'p', 'n', 'b', 'r', 'q', 'k'];
const FROM_LETTER = { p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING };
const CASTLE_MASK = new Uint8Array(128).fill(15); // rights kept when a piece moves from/to a square
CASTLE_MASK[0x04] = 15 & ~3; CASTLE_MASK[0x00] = 15 & ~2; CASTLE_MASK[0x07] = 15 & ~1;
CASTLE_MASK[0x74] = 15 & ~12; CASTLE_MASK[0x70] = 15 & ~8; CASTLE_MASK[0x77] = 15 & ~4;

export const color = p => p & 8;
export const type = p => p & 7;
export const fileOf = sq => sq & 7;
export const rankOf = sq => sq >> 4;
export const sqName = sq => 'abcdefgh'[sq & 7] + ((sq >> 4) + 1);
export const sqFrom = name => (name.charCodeAt(1) - 49) * 16 + (name.charCodeAt(0) - 97);
export const pieceChar = p => (color(p) === WHITE ? LETTER[type(p)].toUpperCase() : LETTER[type(p)]);

export class Chess {
  constructor(fen = START_FEN) { this.load(fen); }

  load(fen) {
    const [pos, turn, cast, ep, half, full] = fen.trim().split(/\s+/);
    this.board = new Int8Array(128);
    this.kings = [-1, -1];
    let r = 7, f = 0;
    for (const ch of pos) {
      if (ch === '/') { r--; f = 0; continue; }
      if (ch >= '1' && ch <= '8') { f += +ch; continue; }
      const p = FROM_LETTER[ch.toLowerCase()] | (ch === ch.toLowerCase() ? BLACK : WHITE);
      const sq = r * 16 + f; this.board[sq] = p;
      if (type(p) === KING) this.kings[color(p) >> 3] = sq;
      f++;
    }
    this.turn = turn === 'b' ? BLACK : WHITE;
    this.castling = (cast.includes('K') ? 1 : 0) | (cast.includes('Q') ? 2 : 0) | (cast.includes('k') ? 4 : 0) | (cast.includes('q') ? 8 : 0);
    this.ep = ep && ep !== '-' ? sqFrom(ep) : -1;
    this.half = +(half || 0); this.full = +(full || 1);
    this.stack = []; this.history = []; this.keys = [this.key()];
    return this;
  }

  fen() {
    let s = '';
    for (let r = 7; r >= 0; r--) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.board[r * 16 + f];
        if (!p) { empty++; continue; }
        if (empty) { s += empty; empty = 0; }
        s += pieceChar(p);
      }
      if (empty) s += empty;
      if (r) s += '/';
    }
    const c = this.castling;
    const cs = (c & 1 ? 'K' : '') + (c & 2 ? 'Q' : '') + (c & 4 ? 'k' : '') + (c & 8 ? 'q' : '') || '-';
    return `${s} ${this.turn === WHITE ? 'w' : 'b'} ${cs} ${this.ep >= 0 ? sqName(this.ep) : '-'} ${this.half} ${this.full}`;
  }

  /**
   * Position identity for repetition (board, side, castling, en passant). The en-passant square only
   * counts when a pawn of the side to move could actually capture there (FIDE rule): otherwise every
   * double push would make an identical position look new.
   */
  key() {
    const f = this.fen().split(' ').slice(0, 4);
    if (this.ep >= 0) {
      const from = this.ep + (this.turn === WHITE ? -16 : 16), pawn = this.turn | PAWN;
      if (![from - 1, from + 1].some(s => !(s & 0x88) && this.board[s] === pawn)) f[3] = '-';
    }
    return f.join(' ');
  }

  get(sq) { return this.board[sq]; }

  attacked(sq, by) {
    const b = this.board;
    // pawns
    const pdir = by === WHITE ? -16 : 16;
    for (const d of [pdir - 1, pdir + 1]) { const s = sq + d; if (!(s & 0x88) && b[s] === (by | PAWN)) return true; }
    for (const d of N_OFF) { const s = sq + d; if (!(s & 0x88) && b[s] === (by | KNIGHT)) return true; }
    for (const d of K_OFF) { const s = sq + d; if (!(s & 0x88) && b[s] === (by | KING)) return true; }
    for (const d of B_OFF) for (let s = sq + d; !(s & 0x88); s += d) { const p = b[s]; if (p) { if (p === (by | BISHOP) || p === (by | QUEEN)) return true; break; } }
    for (const d of R_OFF) for (let s = sq + d; !(s & 0x88); s += d) { const p = b[s]; if (p) { if (p === (by | ROOK) || p === (by | QUEEN)) return true; break; } }
    return false;
  }

  inCheck(c = this.turn) { return this.attacked(this.kings[c >> 3], c ^ 8); }

  /** Pseudo-legal moves (may leave own king in check). */
  pseudo(capturesOnly = false) {
    const b = this.board, us = this.turn, them = us ^ 8, out = [];
    const add = (from, to, flags, promo = 0) => out.push({ from, to, piece: b[from], captured: flags === 'e' ? (them | PAWN) : b[to], flags, promo });
    for (let from = 0; from < 128; from++) {
      if (from & 0x88) { from += 7; continue; }
      const p = b[from];
      if (!p || color(p) !== us) continue;
      const t = type(p);
      if (t === PAWN) {
        const dir = us === WHITE ? 16 : -16, startRank = us === WHITE ? 1 : 6, lastRank = us === WHITE ? 7 : 0;
        const one = from + dir;
        if (!capturesOnly && !(one & 0x88) && !b[one]) {
          if (rankOf(one) === lastRank) for (const pr of [QUEEN, ROOK, BISHOP, KNIGHT]) add(from, one, 'p', pr);
          else {
            add(from, one, 'n');
            const two = one + dir;
            if (rankOf(from) === startRank && !b[two]) add(from, two, 'b');
          }
        }
        for (const d of [dir - 1, dir + 1]) {
          const to = from + d;
          if (to & 0x88) continue;
          if (b[to] && color(b[to]) === them) {
            if (rankOf(to) === lastRank) for (const pr of [QUEEN, ROOK, BISHOP, KNIGHT]) add(from, to, 'pc', pr);
            else add(from, to, 'c');
          } else if (to === this.ep) add(from, to, 'e');
        }
        continue;
      }
      const offs = t === KNIGHT ? N_OFF : t === BISHOP ? B_OFF : t === ROOK ? R_OFF : K_OFF;
      const slide = t === BISHOP || t === ROOK || t === QUEEN;
      for (const d of offs) {
        for (let to = from + d; !(to & 0x88); to += d) {
          const q = b[to];
          if (q) { if (color(q) === them) add(from, to, 'c'); break; }
          if (!capturesOnly) add(from, to, 'n');
          if (!slide) break;
        }
      }
      if (t === KING && !capturesOnly) {
        const home = us === WHITE ? 0x04 : 0x74, ks = us === WHITE ? 1 : 4, qs = us === WHITE ? 2 : 8;
        if (from === home && !this.attacked(home, them)) {
          if (this.castling & ks && !b[home + 1] && !b[home + 2] && b[home + 3] === (us | ROOK) && !this.attacked(home + 1, them) && !this.attacked(home + 2, them)) add(from, home + 2, 'k');
          if (this.castling & qs && !b[home - 1] && !b[home - 2] && !b[home - 3] && b[home - 4] === (us | ROOK) && !this.attacked(home - 1, them) && !this.attacked(home - 2, them)) add(from, home - 2, 'q');
        }
      }
    }
    return out;
  }

  make(m) {
    const b = this.board, us = this.turn;
    this.stack.push({ m, castling: this.castling, ep: this.ep, half: this.half, full: this.full });
    b[m.to] = m.promo ? (us | m.promo) : m.piece;
    b[m.from] = 0;
    if (m.flags === 'e') b[m.to + (us === WHITE ? -16 : 16)] = 0;
    if (m.flags === 'k') { b[m.to - 1] = b[m.to + 1]; b[m.to + 1] = 0; }
    if (m.flags === 'q') { b[m.to + 1] = b[m.to - 2]; b[m.to - 2] = 0; }
    if (type(m.piece) === KING) this.kings[us >> 3] = m.to;
    this.castling &= CASTLE_MASK[m.from] & CASTLE_MASK[m.to];
    this.ep = m.flags === 'b' ? (m.from + m.to) >> 1 : -1;
    this.half = type(m.piece) === PAWN || m.captured ? 0 : this.half + 1;
    if (us === BLACK) this.full++;
    this.turn = us ^ 8;
  }

  unmake() {
    const s = this.stack.pop(), m = s.m, b = this.board;
    this.turn ^= 8;
    const us = this.turn;
    b[m.from] = m.piece;
    b[m.to] = m.flags === 'e' ? 0 : m.captured;
    if (m.flags === 'e') b[m.to + (us === WHITE ? -16 : 16)] = m.captured;
    if (m.flags === 'k') { b[m.to + 1] = b[m.to - 1]; b[m.to - 1] = 0; }
    if (m.flags === 'q') { b[m.to - 2] = b[m.to + 1]; b[m.to + 1] = 0; }
    if (type(m.piece) === KING) this.kings[us >> 3] = m.from;
    this.castling = s.castling; this.ep = s.ep; this.half = s.half; this.full = s.full;
    return m;
  }

  /** Legal moves, optionally only from one square. */
  moves(from = -1) {
    const out = [];
    for (const m of this.pseudo()) {
      if (from >= 0 && m.from !== from) continue;
      this.make(m);
      if (!this.inCheck(this.turn ^ 8)) out.push(m);
      this.unmake();
    }
    return out;
  }

  san(m) {
    const t = type(m.piece);
    let s;
    if (m.flags === 'k') s = 'O-O';
    else if (m.flags === 'q') s = 'O-O-O';
    else {
      const cap = m.captured ? 'x' : '';
      if (t === PAWN) s = (cap ? 'abcdefgh'[fileOf(m.from)] : '') + cap + sqName(m.to) + (m.promo ? '=' + LETTER[m.promo].toUpperCase() : '');
      else {
        const rivals = this.moves().filter(o => o.to === m.to && o.from !== m.from && o.piece === m.piece);
        let dis = '';
        if (rivals.length) {
          const sameFile = rivals.some(o => fileOf(o.from) === fileOf(m.from)), sameRank = rivals.some(o => rankOf(o.from) === rankOf(m.from));
          dis = !sameFile ? 'abcdefgh'[fileOf(m.from)] : !sameRank ? String(rankOf(m.from) + 1) : sqName(m.from);
        }
        s = LETTER[t].toUpperCase() + dis + cap + sqName(m.to);
      }
    }
    this.make(m);
    const check = this.inCheck(), mate = check && this.moves().length === 0;
    this.unmake();
    return s + (mate ? '#' : check ? '+' : '');
  }

  /** Play a legal move given as a move object, SAN, or {from,to,promo} with square names. Returns the move with .san. */
  play(mv) {
    let m;
    const legal = this.moves();
    if (typeof mv === 'string') { const clean = mv.replace(/[+#?!]/g, ''); m = legal.find(o => this.san(o).replace(/[+#]/g, '') === clean); }
    else {
      const from = typeof mv.from === 'string' ? sqFrom(mv.from) : mv.from, to = typeof mv.to === 'string' ? sqFrom(mv.to) : mv.to;
      const promo = typeof mv.promo === 'string' ? FROM_LETTER[mv.promo] : mv.promo;
      m = legal.find(o => o.from === from && o.to === to && (!o.promo || o.promo === (promo || QUEEN)));
    }
    if (!m) return null;
    const san = this.san(m);
    this.make(m);
    const rec = { ...m, san };
    this.history.push(rec); this.keys.push(this.key());
    return rec;
  }

  undo() {
    if (!this.history.length) return null;
    this.history.pop(); this.keys.pop();
    return this.unmake();
  }

  insufficient() {
    const minors = [];
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = this.board[sq];
      if (!p || type(p) === KING) continue;
      if (type(p) === BISHOP || type(p) === KNIGHT) minors.push({ t: type(p), shade: (fileOf(sq) + rankOf(sq)) & 1 });
      else return false;
    }
    if (minors.length <= 1) return true;
    return minors.every(m => m.t === BISHOP) && minors.every(m => m.shade === minors[0].shade);
  }

  /** { over, result: '1-0'|'0-1'|'1/2-1/2'|null, reason, check } */
  status() {
    const check = this.inCheck(), none = this.moves().length === 0;
    const winner = this.turn === WHITE ? '0-1' : '1-0';
    if (none) return check ? { over: true, result: winner, reason: 'checkmate', check } : { over: true, result: '1/2-1/2', reason: 'stalemate', check };
    if (this.half >= 100) return { over: true, result: '1/2-1/2', reason: 'fifty-move rule', check };
    const k = this.keys[this.keys.length - 1];
    if (this.keys.filter(x => x === k).length >= 3) return { over: true, result: '1/2-1/2', reason: 'threefold repetition', check };
    if (this.insufficient()) return { over: true, result: '1/2-1/2', reason: 'insufficient material', check };
    return { over: false, result: null, reason: null, check };
  }

  perft(depth) {
    if (depth === 0) return 1;
    let n = 0;
    for (const m of this.pseudo()) {
      this.make(m);
      if (!this.inCheck(this.turn ^ 8)) n += this.perft(depth - 1);
      this.unmake();
    }
    return n;
  }

  /** Iterate pieces: [{sq, piece}] */
  pieces() {
    const out = [];
    for (let sq = 0; sq < 128; sq++) { if (sq & 0x88) { sq += 7; continue; } if (this.board[sq]) out.push({ sq, piece: this.board[sq] }); }
    return out;
  }
}
