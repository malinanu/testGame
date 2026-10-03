// Game hub: a slowly orbiting Wildwood behind the tiles; arrow keys + Enter choose a game.
import { loadAssets } from './assets.js';
import { Game } from './game.js';

const tiles = document.getElementById('tiles');
addEventListener('keydown', e => {
  const items = [...tiles.children], i = items.indexOf(document.activeElement);
  const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (d) { e.preventDefault(); items[(i + d + items.length) % items.length].focus(); }
});
tiles.querySelector('.tile')?.focus({ preventScroll: true });

// the old hash route for the action game now goes to the colony game
if (location.hash === '#relic') location.replace('relic/');
else {
  // the backdrop is just the orbiting forest: skip characters, weapons and animations (about 4 MB)
  const assets = await loadAssets({ chars: [], props: [], anims: false });
  window.game = new Game(document.getElementById('c'), assets); // backdrop only (menu orbit)
}
