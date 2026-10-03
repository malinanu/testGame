// Renders the hub art into public/assets/ui/: a portrait per Relic Hunt hero and a screenshot per game.
// Usage: serve public/ (e.g. `python3 -m http.server 8123 -d public`), then
//   node scripts/make-thumbs.mjs [http://localhost:8123]
// Needs Playwright with Chromium (WebGL via SwiftShader is fine).
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8123';
const OUT = new URL('../public/assets/ui/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const save = (name, dataUrl) => { const buf = Buffer.from(dataUrl.split(',')[1], 'base64'); writeFileSync(new URL(name, OUT), buf); console.log(name, `${(buf.length / 1024).toFixed(0)} KB`); };

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
/** Screenshot a region, scale it to `width` and encode as webp inside the browser. */
async function shot(name, { clip, width = 520, quality = 0.82 }) {
  const png = (await page.screenshot({ clip })).toString('base64');
  const data = await page.evaluate(async ({ png, width, quality }) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
    const c = document.createElement('canvas'); c.width = width; c.height = Math.round(img.height * width / img.width);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/webp', quality);
  }, { png, width, quality });
  save(name, data);
}
const hideUi = sel => page.addStyleTag({ content: `${sel} { display: none !important; }` });

// ---- hero portraits (rendered on a transparent canvas inside the Relic Hunt page)
await page.goto(`${BASE}/index.html`);
await page.waitForFunction(() => window.game, null, { timeout: 120000 });
const portraits = await page.evaluate(async () => {
  const THREE = await import('three');
  const { Actor } = await import('./src/actor.js');
  const { HEROES } = await import('./src/player.js');
  const W = 300, H = 300;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H); renderer.outputColorSpace = THREE.SRGBColorSpace;
  const out = {};
  for (const [k, h] of Object.entries(HEROES)) {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff4dd, 0x30402a, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4); sun.position.set(2, 4, 5); scene.add(sun);
    const rim = new THREE.DirectionalLight(0xffd88a, 2); rim.position.set(-3, 3, -4); scene.add(rim);
    const a = new Actor(game.assets, h.char);
    a.hold(h.weapon, 'R'); if (h.offhand) a.hold(h.offhand, 'L');
    a.setBase('Idle_A'); a.mixer.update(0.6);
    a.root.rotation.y = 0.45;
    scene.add(a.root);
    const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 50);
    cam.position.set(0, 1.75, 4.6); cam.lookAt(0, 1.15, 0);
    renderer.render(scene, cam);
    out[k] = renderer.domElement.toDataURL('image/webp', 0.86);
  }
  return out;
});
for (const [k, d] of Object.entries(portraits)) save(`hero-${k.toLowerCase()}.webp`, d);

// ---- game thumbnails
const card = { x: 0, y: 0, width: 1280, height: 740 };
// Forest Relic Hunt (Wildwood Colony): a town grown by the test bot, seen at a low Anno-style angle
const botSrc = readFileSync(new URL('../tests/colony-bot.mjs', import.meta.url), 'utf8').replaceAll("'../public/relic/src/", "'/relic/src/");
await page.route('**/__bot.mjs', r => r.fulfill({ contentType: 'text/javascript', body: botSrc }));
await page.goto(`${BASE}/relic/?new&seed=3`);
await page.waitForFunction(() => window.game?.running, null, { timeout: 180000 });
await page.evaluate(async () => {
  const { Bot } = await import('/__bot.mjs');
  const c = game.colony, bot = new Bot(c), want = (t, n, sc) => { while (c.count(t) < n) if (!bot.place(t, undefined, undefined, sc)) break; };
  const trees = (x, y) => bot.treesNear(x, y), rocks = (x, y) => -c.nearCount(x + 1, y + 1, { what: 'rock', r: 3 }) * 5;
  for (let t = 0; t < 1800; t += 5) {
    want('lumberjack', 2, trees); want('sawmill', 1); want('hunter', 1, trees); want('hut', 10); want('market', 1);
    want('forester', 1, trees); want('quarry', 1, rocks); want('stonemason', 1); want('hut', 14);
    if (c.time > 600) { want('warehouse', 1); want('tradepost', 1); want('watchtower', 1); }
    c.step(5); game.drain();
  }
  const th = c.ofType('townhall')[0];
  game.cam.zoomGoal = game.cam.zoom = 0.22; game.cam.yawGoal = game.cam.yaw = 0.7;
  game.focusTile(th.cx - 1, th.cy); game.cam.target.copy(game.cam.goal); game.setSpeed(1);
});
await hideUi('#hud, #labels');
await page.waitForTimeout(3000);
await shot('game-relic.webp', { clip: { x: 160, y: 60, width: 960, height: 560 } });

// Tactics: a skirmish battle board
await page.goto(`${BASE}/tactics/index.html`);
await page.waitForFunction(() => window.app, null, { timeout: 120000 });
await page.evaluate(() => app.startVersus({ mode: 'ai', seed: 4242, parties: { player: ['knight', 'ranger', 'wizard', 'barbarian'], enemy: ['fighter', 'rogue', 'ranger', 'knight'] } }));
await hideUi('#hud, #labels');
await page.evaluate(() => { app.view.cam.target.set(0, 0, -6); app.view.cam.dist = 15; app.view.cam.pitch = 0.7; app.view.cam.yawGoal = app.view.cam.yaw = 0.55; });
await page.waitForTimeout(2500);
await shot('game-tactics.webp', { clip: { x: 160, y: 60, width: 960, height: 560 } });

// Arena: a stronghold (offline demo backend)
await page.goto(`${BASE}/arena/index.html?offline`);
await page.waitForSelector('#screen-login.active, #screen-home.active', { timeout: 120000 });
if (await page.$('#screen-login.active')) { await page.fill('#name', 'Thumbnail Guild'); await page.click('#loginform button'); }
await page.waitForSelector('#screen-home.active', { timeout: 30000 });
await hideUi('body > *:not(canvas)');
await page.evaluate(() => { const c = arena.view.cam; c.target.set(0, 0, 5); c.dist = 16; c.pitch = 0.66; c.orbit = 0; c.yawGoal = c.yaw = Math.PI + 0.4; });
await page.waitForTimeout(2500);
await shot('game-arena.webp', { clip: { x: 160, y: 60, width: 960, height: 560 } });

// Chess: the board mid-game
await page.goto(`${BASE}/chess/index.html`);
await page.waitForSelector('#screen-menu.active', { timeout: 120000 });
await page.click('#o-mode [data-v=watch]');
await page.click('#b-start');
await page.waitForTimeout(9000);
await hideUi('#hud');
await shot('game-chess.webp', { clip: { x: 160, y: 40, width: 960, height: 560 } });

await browser.close();
