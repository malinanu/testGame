# KayKit Forest Games

Four browser games built with Three.js and free CC0 asset packs: KayKit *Adventurers 2.0*, *Forest Nature Pack 1.0* and
*Fantasy Weapons Bits 1.0* (Kay Lousberg), plus the *Brackeys VFX bundle* (particles by Picster and Kenney, flipbooks by
Thomas Iché, sprite sheets by CodeManu).

```
cd public && python3 -m http.server 8123   # or: npx serve public
```

| URL | Game |
|---|---|
| http://localhost:8123/chess/ | **Wizard's Chess**, a living 3D chess set where pieces fight to capture (vs AI, two players, AI vs AI) |
| http://localhost:8123/arena/ | **Wildwood Arena: Clash of Guilds**, an online build-and-raid tactics game (Supabase backend, offline demo built in) |
| http://localhost:8123/tactics/ | **Wildwood Tactics**, a turn-based tactics roguelite |
| http://localhost:8123/ | **Forest Relic Hunt**, a third-person action game (`?hero=Mage` skips the menu) |

## Wizard's Chess (`public/chess/`)
Full-rules chess on a cracked stone board in a torch-lit hall.

**The pieces:**
| Piece | Character | How it captures |
|---|---|---|
| King | Crowned Knight | Sword strike |
| Queen | Mage | Lightning from her staff |
| Rook | Living stone tower with glowing eyes | Topples onto its target |
| Bishop | Archer | Shoots an arrow |
| Knight | Barbarian | Leaps its L-move and smashes the target |
| Pawn | Spear-carrying Rogue | Spear thrust |

Captured pieces shatter into rubble and dust, then lie in a graveyard beside the board.

**Atmosphere:**
- Check makes the king's square pulse red.
- On checkmate the losing king falls and his crown rolls away, while the winners cheer under fireworks.
- Floor fog, drifting magic motes and flickering torches fill the hall.
- An optional cinematic camera pushes in on each capture.
- Synthesized sound effects play throughout.

**Rules:** castling, en passant, promotion with a piece picker, check, checkmate, stalemate, the 50-move rule, threefold repetition and insufficient material.

**AI:** alpha-beta search with quiescence search and piece-square tables, running in a Web Worker so animations stay smooth. Three levels: Apprentice, Wizard and Archmage.

**Controls:**
- Click a piece, then a glowing square.
- Right-drag to orbit, the wheel to zoom, Q/E to rotate the view.
- U undoes, F flips the board.

**Code:**
- `chess/src/chess.js`: the rules engine, verified against the standard perft node counts on 5 positions
- `ai.js` / `ai-worker.js`: the AI
- `scene.js`: the hall, the pieces and the move choreography
- `vfx.js`: sprite sheets, particles, debris, lightning and screen shake
- `sfx.js`: the sound synthesizer
- `main.js`: game flow and HUD

## Wildwood Arena: Clash of Guilds (`public/arena/`)
An asynchronous multiplayer game built on the Tactics engine.

- **Stronghold builder:**
  - Paint the 12×12 forest grid with pillars, boulders, leafy trees, bare and corrupted trunks, bushes and grass.
  - A build budget grows with stronghold level.
  - Rows 1–2 stay open as the raiders' landing zone, and every defender must be reachable.
- **Garrison AI:** you program 4 defenders. Each gets a class, a post and a behavior:
  - Aggressive: hunts the nearest raider
  - Guard: never strays more than 2 tiles from its post
  - Hold: never moves, strikes whatever comes in range
  - Ambush: waits until a raider comes within 4 tiles (or it's hurt)
  - Sniper: keeps its distance and prefers cover
  - Medic: stays near the most wounded ally and prioritises heals
- **Raids:**
  - Scout a rival near your Elo, pick a party of 4 and bring brewed consumables.
  - You have 20 rounds to wipe out the garrison.
  - The server replays your command log from the same seed and inputs, so outcomes can't be forged. Then it settles gold, herbs and berries, and Elo (K=32) for both attacker and defender.
  - NPC guilds also raid you while you're away, so your defense log fills up.
- **Progression:**
  - Raid gold buys gear tiers per class, from Common to Legendary. The models stay the same; the stats improve.
  - Grass tufts and bushes on your stronghold grow herbs and berries in real time. Collect them and brew Healing Potions (an in-raid flask), Mugs of Ale (+2 damage) and Forest Tonics (+1 move).
  - A daily tribute grows with your login streak.
- **Leagues and seasons:**
  - Bronze, Silver, Gold, Platinum and Diamond by Elo, plus a leaderboard.
  - Seasons last 28 days. A season you finish in Silver or higher earns a coloured aura under your units. Ratings then soft-reset toward 1200.

### Playing online (Supabase)
Without keys, `/arena/` runs the same server logic inside your browser (a "local cloud" with 8 NPC guilds), which is good for trying it out.
To share one world between players:
1. Create a Supabase project. Under **Authentication → Sign In / Providers**, enable **Allow anonymous sign-ins**. Players are identified by a guild name plus a session kept in their browser, with no passwords.
2. Install the [Supabase CLI](https://supabase.com/docs/guides/cli), then from this repo run:
   ```
   supabase link --project-ref <your-project-ref>
   supabase db push                      # creates the arena_* tables (RLS on, no client access)
   npm run sync                          # copies the shared game modules into supabase/functions/_shared
   supabase functions deploy arena
   ```
3. Put the project URL and **publishable** key (`sb_publishable_…`, from the dashboard's **Connect** dialog or Project Settings → API Keys; called "anon" on older projects) in `public/arena/config.js`. Never put the secret or service-role key there. Then host `public/` anywhere static.
   Add `?offline` to the URL to force the local demo.

**No CLI? Deploy from the dashboard instead:**
1. **SQL Editor:** paste and run `supabase/migrations/20261002000000_arena.sql`.
2. **Edge Functions → Deploy a new function → Via Editor:** name it `arena`, replace the code with the single-file bundle `dist/arena-function.ts` (rebuild it with `npm run bundle`), and deploy.
3. In the function's settings, turn **off** "Verify JWT with legacy secret". The function checks each caller's session itself.
4. Enable anonymous sign-ins (step 1 above).

The browser never writes to the database. Every action goes to the `arena` Edge Function, which runs
`public/arena/src/server-core.js` with the service role.

### Arena code
- `public/arena/src/economy.js`: tiers, costs, harvest rates, recipes, Elo, leagues and seasons (pure)
- `public/arena/src/stronghold.js`: layout and garrison format, budget, validator, raid setup, NPC strongholds (pure)
- `public/arena/src/server-core.js`: the authoritative actions (register, save, upgrade, harvest, craft, scout, raid start/finish with replay, leaderboard, season rollover, simulated defenses), with storage behind a small store interface
- `public/arena/src/store-memory.js` (local and tests) and `supabase/functions/_shared/store-supabase.js` (cloud)
- `public/arena/src/main.js`: the UI (home, editor, armory, alchemy, raid, results)
- `supabase/migrations/`, `supabase/functions/arena/index.ts`: schema and Edge Function

### Tests
Run `npm test`. It covers:
- Chess perft, rules edge cases, SAN notation and AI sanity checks (mate-in-1, legal self-play)
- Engine replay determinism, tampered-log rejection, behaviors, consumables and the round limit
- The arena server core: economy, validation, daily streak, harvest and craft, upgrades, raids with server replay, forged logs, PvP Elo, simulated defenses, season rollover
- The Supabase store, against an in-memory fake of supabase-js
- Whether `_shared` is in sync with `public/`

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
