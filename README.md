# KayKit Forest Games

Two browser games built with Three.js and the free KayKit asset packs
(*Adventurers 2.0* and *Forest Nature Pack 1.0*, CC0 by Kay Lousberg).

```
cd public && python3 -m http.server 8123   # or: npx serve public
```

| URL | Game |
|---|---|
| http://localhost:8123/tactics/ | **Wildwood Tactics**, a turn-based tactics roguelite |
| http://localhost:8123/ | **Forest Relic Hunt**, a third-person action game (`?hero=Mage` skips the menu) |

## Wildwood Tactics
The mercenary guilds are at war in the Wildwood. You draft 4 of 6 classes, fight procedurally generated rival squads
on a 12×12 forest grid, and travel a branching node map (skirmishes, elite squads, supply caches, campfires) to the
boss, an elite squad called the Hollow Crown.

**Turns:** each hero gets one move and one action per turn, in either order. Then the enemy squad acts.

| Class (model) | Role | Abilities |
|---|---|---|
| Knight (`Knight`) | Tank | Strike, **Shield Bash** (push; slamming into rock, a tree or a unit stuns), passive **Hold the Line** (enemies stepping next to the Knight must stop) |
| Barbarian (`Barbarian`) | Melee AoE | Chop (can fell trunks), **Cleave** (all 8 neighbours, fells bare and corrupted trees) |
| Ranger (`Rogue`) | Sniper | Longshot (damage grows with distance, +20% hit next to a leafy tree), **Aimed Shot** (ignores cover) |
| Rogue (`Rogue_Hooded`) | Stealth | Twin Daggers, Crossbow, passive **Hidden** on bushes (only targetable from 1 tile, next attack is a guaranteed crit) |
| Wizard (`Mage`) | Support | Arcane Bolt, **Fireball** (ignites trees into lingering fire), **Entangle** (turns grass into difficult terrain), **Healing Potion** |
| Fighter (`Ranger`) | Versatile | Axe Strike, free **Swap Stance** (offense: axe, +2 damage; defense: round shield, −2 damage taken) |

**Terrain**
- Rock pillars and leafy trees block line of sight (full cover).
- Boulders and trunks next to a target give half cover: −40% damage and −15% hit.
- Bushes hide Rogues.
- Overgrown tiles cost 2 movement.
- Fire burns anyone who enters it or ends a turn in it.
- Corrupted purple trees lash anyone, friend or foe, who ends a turn next to them.
- Maps are seeded, with chokepoints between rock and tree walls.

**Between fights**
- Wounds carry over, and survivors recover 25% after a win.
- Fallen heroes stay down until revived with a potion at a campfire.
- Loot swaps gear models and stats, e.g. Masterwork Blade, Spiked Kite Shield, Repeating Crossbow, Elder Wand.
- At camp, the party sits on boulders with mugs. You can share a mug (2 supplies, +60% HP), use a potion to revive someone, or rest (+20% for everyone).
- The run auto-saves to `localStorage`.

**Controls**
- Click a hero, then click a blue tile to move or a red enemy to attack.
- 1–4 pick abilities, Esc cancels, Tab selects the next hero, Enter ends the turn.
- Q/E rotate the camera, WASD pans, right-drag orbits, the wheel zooms.

### Code (`public/tactics/src`)
- `data.js`: all rules data (tiles, abilities, classes, items, guilds)
- `grid.js`: map generation, pathfinding, line of sight and cover (pure, runs in Node)
- `battle.js`: turn flow, ability resolution and AI (pure, renders through an awaitable `view`, headless with `NullView`)
- `run.js`: node map, encounters, loot, camp and save (pure)
- `view.js`: Three.js board, units, highlights, animations and the camp scene
- `main.js`: screens, battle input and HUD

## Asset notes
- The free Adventurers pack has no attack or sit animations. Attacks are procedural lunges and weapon swings layered on
  the `Use_Item`/`Throw` clips.
- The packs have no potion bottle, so it's a small procedural mesh.
- Three.js r170 is vendored in `public/vendor/three`, so no CDN is needed.
