// Game hub: a slowly orbiting Wildwood behind the tiles; arrow keys + Enter choose a game.
import { loadAssets } from './assets.js';
import { Game } from './game.js';

const tiles = document.getElementById('tiles');
addEventListener('keydown', e => {
  const items = [...tiles.children], n = items.length, i = items.indexOf(document.activeElement);
  // up/down move a whole row of the grid (its column count depends on the window width)
  const cols = Math.max(1, Math.round(tiles.clientWidth / (items[0]?.offsetWidth || tiles.clientWidth)));
  const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
  if (!d) return;
  e.preventDefault();
  items[i < 0 ? (d > 0 ? 0 : n - 1) : (i + d + n * cols) % n].focus();
});
tiles.querySelector('.tile')?.focus({ preventScroll: true });

// the old hash route for the action game now goes to the colony game
if (location.hash === '#relic') location.replace('relic/');
else {
  // the backdrop is just the orbiting forest: skip characters, weapons and animations (about 4 MB)
  const assets = await loadAssets({ chars: [], props: [], anims: false });
  window.game = new Game(document.getElementById('c'), assets); // backdrop only (menu orbit)
}
