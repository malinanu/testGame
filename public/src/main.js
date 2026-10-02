import { loadAssets } from './assets.js';
import { Game, buildMenu } from './game.js';

const assets = await loadAssets();
const game = new Game(document.getElementById('c'), assets);
window.game = game; // handy for debugging / automated tests
document.getElementById('loading').remove();
buildMenu(k => game.start(k));
document.getElementById('again').onclick = () => { document.getElementById('end').classList.add('hidden'); document.getElementById('menu').classList.remove('hidden'); game.state = 'menu'; game.reset(); };
const q = new URLSearchParams(location.search).get('hero');
if (q) game.start(q);
