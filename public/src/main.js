import { loadAssets } from './assets.js';
import { Game, buildMenu } from './game.js';

const $ = id => document.getElementById(id);

// ------------------------------------------------------------------ hub router: '' = game hub, '#relic' = hero select
function route() {
  if (game?.state === 'play') return;
  const relic = location.hash === '#relic';
  $('hub').classList.toggle('hidden', relic);
  $('menu').classList.toggle('hidden', !relic);
  $('end').classList.add('hidden'); $('hud').classList.add('hidden');
  if (relic) ($('heroes').querySelector('.hero.sel') || $('heroes').querySelector('.hero'))?.focus();
  else $('tiles').querySelector('.tile')?.focus({ preventScroll: true });
}
addEventListener('hashchange', route);

// arrow keys move between tiles / hero cards, Enter activates the focused one, Esc goes back
addEventListener('keydown', e => {
  if (game?.state === 'play') return;
  const box = !$('menu').classList.contains('hidden') ? $('heroes') : !$('hub').classList.contains('hidden') ? $('tiles') : null;
  if (!box) return;
  if (e.key === 'Escape' && box === $('heroes')) { location.hash = ''; return; }
  const items = [...box.children], i = items.indexOf(document.activeElement);
  const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (d) { e.preventDefault(); const n = items[(i + d + items.length) % items.length]; n.focus(); if (box === $('heroes')) n.click(); }
});

let game = null, picked = null;
route();

const assets = await loadAssets();
game = new Game($('c'), assets);
window.game = game; // handy for debugging / automated tests
$('loading').remove();
const pick = k => {
  picked = k;
  $('heroes').querySelectorAll('.hero').forEach(b => b.classList.toggle('sel', b.dataset.hero === k));
  $('startbtn').disabled = false; $('startbtn').textContent = `Start the hunt as ${k} ▶`;
};
const start = () => { if (picked) game.start(picked); };
buildMenu(pick, start);
pick('Knight');
$('startbtn').onclick = start;
$('again').onclick = () => { $('end').classList.add('hidden'); game.state = 'menu'; game.reset(); location.hash = '#relic'; route(); };
document.querySelector('#end .back2').onclick = e => { e.preventDefault(); $('end').classList.add('hidden'); game.state = 'menu'; game.reset(); location.hash = ''; route(); };
route();
const q = new URLSearchParams(location.search).get('hero');
if (q) game.start(q);
