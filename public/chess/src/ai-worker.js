// Web Worker: runs the chess search off the main thread so the 3D scene keeps animating.
import { search, LEVELS } from './ai.js';
import { sqName } from './chess.js';

self.onmessage = e => {
  const { id, fen, level } = e.data;
  const r = search(fen, LEVELS[level] || LEVELS.medium);
  self.postMessage({ id, move: r?.move ? { from: sqName(r.move.from), to: sqName(r.move.to), promo: r.move.promo || 0 } : null, depth: r?.depth, nodes: r?.nodes });
};
