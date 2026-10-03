// "Training Grounds": a scripted first battle that teaches select → move → act → end turn, plus cover and hiding.
import { T } from './data.js';
import { Grid, rng } from './grid.js';
import { Battle, makeUnit } from './battle.js';
import { BattleController } from './controller.js';
import { Coach } from './coach.js';

export const TUTORIAL_KEY = 'wwt-tutorial-done';

/** Handcrafted practice map + squads (pure, also used by the Node test). */
export function tutorialSetup() {
  const g = new Grid(), r = rng(77);
  for (let i = 0; i < g.t.length; i++) { g.t[i] = r() < 0.25 ? T.GRASS : T.GROUND; g.v[i] = Math.floor(r() * 256); }
  const put = (x, y, t) => g.set(x, y, t);
  [[4, 2], [4, 3], [4, 4], [8, 2], [8, 3], [9, 3], [6, 1], [6, 2]].forEach(([x, y]) => put(x, y, T.GROUND)); // keep lesson paths clear
  put(7, 6, T.BOULDER);   // cover for the enemy archer
  put(9, 3, T.BUSH);      // the Rogue's hiding spot
  put(2, 6, T.PILLAR); put(10, 8, T.TREE); put(1, 3, T.TREE); put(5, 9, T.BARE); put(3, 9, T.BUSH); put(10, 4, T.BOULDER);
  const unit = (cls, side, x, y, extra = {}) => { const u = makeUnit({ cls, gear: [] }, side); Object.assign(u, { x, y }, extra); return u; };
  const knight = unit('knight', 'player', 4, 1), ranger = unit('ranger', 'player', 6, 0), rogue = unit('rogue', 'player', 8, 1);
  const brute = unit('barbarian', 'enemy', 4, 5, { behavior: 'hold', name: 'Training Brute' });
  const archer = unit('ranger', 'enemy', 7, 7, { behavior: 'hold', name: 'Training Archer' });
  for (const d of [brute, archer]) { d.maxHp = d.hp = d === brute ? 9 : 7; d.mods.dmg = -2; }
  return { grid: g, units: [knight, ranger, rogue, brute, archer], knight, ranger, rogue, brute, archer };
}

/** Runs the guided battle on the given View. Resolves with 'done' | 'skipped' | 'lost'. */
export function runTutorial(view, { show }) {
  return new Promise(resolve => {
    const s = tutorialSetup(), { knight, ranger, rogue, brute, archer } = s;
    view.clearCamp(); view.clearUnits(); view.buildBoard(s.grid); view.battleCamera();
    s.units.forEach(u => view.addUnit(u));
    document.getElementById('log').innerHTML = '';
    document.getElementById('vs').textContent = 'Training Grounds: learn the basics';
    show('battle');
    const battle = new Battle({ grid: s.grid, units: s.units, view, seed: 4 });
    const coach = new Coach(view);
    let previewSeen = false, finished = false;
    const ctl = new BattleController(view, battle, { enemyName: '', onFinish: () => end(battle.result === 'win' ? 'done' : 'lost') });
    ctl.select(null, true);
    window.tutorialState = { ctl, battle, coach }; // debugging / automated tests
    ctl.on('preview', p => { if (p.target.unit === archer) previewSeen = true; });
    ctl.on('blocked', () => { coach.shake(); ctl.flashHint('Follow the highlighted step in the yellow bubble.'); });

    const isTile = (d, x, y) => d && d.x === x && d.y === y;
    const steps = [
      { text: '👋 Welcome! You command the heroes with <b style="color:#2a7fd0">blue rings</b>.<br><b>Click your Knight</b> (the armored one).', target: () => ({ unit: knight }),
        check: () => ctl.sel === knight, allow: (k, d) => k === 'select' && d === knight },
      { text: '<b>Blue tiles</b> show where the Knight can walk this turn. Hovering shows the footprint path.<br><b>Click the highlighted tile</b> to walk next to the enemy.', target: () => ({ tile: [4, 4] }),
        check: () => knight.moved, allow: (k, d) => k === 'move' && isTile(d, 4, 4) },
      { text: 'Every hero gets <b>one Move 👣</b> and <b>one Action ⚔️</b> per turn, in any order. Used ones fade out here.', target: () => ({ el: '#uinfo .pips.big' }),
        next: 'Got it', allow: () => false },
      { text: '<b>Red</b> marks an enemy in reach. Hover it to see the <b>hit chance and damage</b>, then <b>click the Brute to attack</b> (or press 1 and click).', target: () => ({ unit: brute }),
        check: () => knight.acted, allow: (k, d) => (k === 'mode' && (d === 'strike' || d === 'bash')) || (k === 'attack' && isTile(d, brute.x, brute.y)) },
      { text: 'The Knight is done for this turn. Now <b>click your Ranger</b> (the archer).', target: () => ({ unit: ranger }),
        check: () => ctl.sel === ranger, allow: (k, d) => k === 'select' && d === ranger },
      { text: 'Press <b>1 (Longshot)</b>, then <b>hover the enemy archer</b>.<br>See the 🪨 boulder in front of him? That\'s <b>half cover</b>: less damage, lower hit chance.', target: () => (ctl.mode === 'shoot' ? { unit: archer } : { el: '#abils [data-id=shoot]' }),
        check: () => ctl.mode === 'shoot' && previewSeen, allow: (k, d) => k === 'mode' && d === 'shoot' },
      { text: 'Better idea: <b>Aimed Shot ignores cover</b>.<br>Press <b>2</b> (or click the button), then <b>click the archer</b>.', target: () => (ctl.mode === 'aimed' ? { unit: archer } : { el: '#abils [data-id=aimed]' }),
        check: () => ranger.acted, allow: (k, d) => (k === 'mode' && (d === 'aimed' || d === 'shoot')) || (k === 'attack' && d.id === 'aimed') },
      { text: 'Rogues can hide. <b>Click your Rogue</b>, then <b>walk into the 🌿 bush</b>. Hidden heroes can only be hit from 1 tile away, and their next attack is a double-damage crit.', target: () => (ctl.sel === rogue ? { tile: [9, 3] } : { unit: rogue }),
        check: () => rogue.hidden, allow: (k, d) => (k === 'select' && d === rogue) || (k === 'move' && isTile(d, 9, 3)) },
      { text: 'Your heroes have used their turn. Press <b>End Turn</b> (or Enter) and <b>watch the enemy move</b>.', target: () => ({ el: '#endturn' }),
        check: () => battle.round >= 2, allow: k => k === 'endTurn' },
      { text: 'Now finish the training on your own: <b>defeat the remaining dummies</b>. The bar at the top always tells you what to do next. <b>T</b> shows enemy threat range and <b>H</b> opens help.', target: () => null,
        next: 'Let me play', allow: () => true, check: () => false, free: true },
    ];
    let i = 0;
    const go = () => {
      const st = steps[i];
      ctl.guard = st.allow ? (k, d) => st.allow(k, d) : null;
      coach.show(st, i, steps.length, { onSkip: () => end('skipped') });
    };
    const tick = setInterval(() => {
      if (finished) return clearInterval(tick);
      const st = steps[i];
      if (!st) return;
      if ((st.check && st.check()) || (st.next && coach.nextClicked)) {
        if (st.free) { coach.hide(); ctl.guard = null; i++; return; }
        i++; if (i < steps.length) go();
      }
    }, 120);
    go();

    function end(how) {
      if (finished) return; finished = true;
      clearInterval(tick); coach.hide(); coach.el.remove();
      setTimeout(() => { ctl.dispose(); resolve(how); }, how === 'skipped' ? 0 : 1200);
      try { if (how === 'done' || how === 'skipped') localStorage.setItem(TUTORIAL_KEY, '1'); } catch {}
    }
  });
}
