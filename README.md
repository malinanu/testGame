# KayKit Forest Games

A game hub and four browser games built with Three.js and free CC0 asset packs: KayKit *Adventurers 2.0*, *Forest Nature Pack 1.0*,
*Fantasy Weapons Bits 1.0*, *Dungeon Pack 1.1*, *Resource Bits 1.0* and *RPG Tools Bits 1.0* (Kay Lousberg), plus the *Brackeys VFX bundle* (particles by Picster and Kenney, flipbooks by
Thomas Iché, sprite sheets by CodeManu).

```
cd public && python3 -m http.server 8123   # or: npx serve public
```

| URL | Game |
|---|---|
| http://localhost:8123/ | **Game hub**: the start screen, with a tile for each game (arrow keys + Enter work) |
| http://localhost:8123/chess/ | **Wizard's Chess**, a living 3D chess set where pieces fight to capture (vs AI, two players, AI vs AI) |
| http://localhost:8123/arena/ | **Wildwood Arena: Clash of Guilds**, an online build-and-raid tactics game (Supabase backend, offline demo built in) |
| http://localhost:8123/tactics/ | **Wildwood Tactics**, turn-based squad battles: roguelite campaign, skirmish vs AI, same-screen 2 players, online duels |
| http://localhost:8123/relic/ | **Forest Relic Hunt: Wildwood Colony**, an Anno-style colony builder with a hero you can take into the wilds |

The hub art in `public/assets/ui/` (hero portraits and game thumbnails) is rendered from the games themselves with
`node scripts/make-thumbs.mjs` (needs Playwright and a server on port 8123). The menu font is Lilita One (SIL OFL,
`public/assets/fonts/`).

## Forest Relic Hunt: Wildwood Colony (`public/relic/`)
An Anno 1800-style city builder set in an uncharted forest valley, with an adventure layer: your Founder hero
(one of the five Adventurers) walks out in third person to clear lairs and bring back five lost relics.

**The economy**
- **Roads and logistics.** Every building needs a road to the Town Hall or a Warehouse within its range. Carriers
  (villagers with the goods on their heads) walk the roads to fetch output. Storage per good grows with Warehouses.
- **Production chains**, each with its own building model:
  - Lumberjack (fells the nearest trees) → Logs → Sawmill → Planks
  - Forester (replants trees)
  - Quarry (beside rock) → Stone → Stonemason → Bricks
  - Hunting Lodge → Game & Berries
  - Grain Farm → Bakery (Bread) and Brewery (Ale)
  - Flax Farm → Weaver → Textiles
  - Iron Mine (on an iron deposit) + Charcoal Kiln → Smelter → Blacksmith → Tools
  - Gold Mine + Charcoal → Goldsmith → Jewelry
  - Planks + Textiles → Cartographer → Maps (each one reveals a relic site)
- **Population tiers.** Settlers live in huts and need Food plus a Market. Craftsmen live in two-storey houses and need
  Bread, Textiles and a Market, with Ale and a Tavern as luxuries. Merchants live in manors and need Bread, Ale,
  Textiles, a Tavern and a Chapel, with Jewelry and Tools as luxuries.
  - Unmet basic needs empty a house.
  - Luxuries raise happiness and taxes.
  - Every production building needs workers of a given tier. A shortage cuts its productivity, as in Anno.
- **Gold** is taxes minus upkeep, shown per minute in the top bar. A Trading Post brings caravans to buy and sell goods.
- **Territory and fog.** You can build inside the Town Hall's radius, and Outposts extend it. Land outside is fogged
  until your hero or a building reveals it.
- **Difficulty.** Relaxed, Settler or Pioneer, chosen on the new-colony screen. It scales starting gold, upkeep,
  taxes, raid timing and fire. Every map gets the same guarantees: a grove, rock and an iron deposit near the start.
  A founding grant halves upkeep until the colony first reaches 40 residents.
- **Paved roads** (P) cost 1 Brick + 2 gold per tile, and carriers walk them 50% faster. Drag over dirt roads to pave them.
- **Statistics** (O or 📊): goods made and used per minute with sparklines and deficit warnings, population per
  tier, and a finance chart.
- **Festivals** at the Town Hall: +25 happiness for 3 minutes, with a cooldown.
- **Expeditions** from the Cartographer: spend a map, food and gold to chart deposits or lairs or to bring back loot.
- **A living town.** Villagers stroll between homes and the market, tavern and chapel. Lumberjacks walk out and chop
  the trees they fell, and workers hammer, saw and haul beside busy workshops. New buildings go up behind scaffolding.
  Windows glow at night, and there is ambient sound (birds, crickets, work sounds near the camera).

**The adventure**
- Press **H** for the hero (action-RPG camera: WASD, click to attack with auto-aim, E to open chests or pick up relics).
- **Lairs** (bandit camps, brute dens, haunted ruins) are guarded. Clearing one pays loot. Five of them hold relics:
  - Heart of the Grove: lumber, hunting and farms
  - Runestone: stone and bricks
  - Ember Crown: smelting and smithing
  - Tide Pearl: trade prices
  - Sunforged Sigil: taxes
- Carry each relic to the Town Hall. Relics also unlock the tiers: Craftsmen need 30 settlers and 1 relic, Merchants
  need 60 craftsmen and 3 relics.
- **Raids.** After 25 minutes, lairs near your town raid it at night. Watchtowers repel them, your hero can fight
  them off, and unguarded buildings catch fire. Pay to put the fire out, or rebuild later.
- **Victory**: hold all five relics, reach 250 residents and build the **Relic Sanctum**.

**Controls**
- Camera: WASD or edge scroll to pan, the wheel to zoom (it tilts from street view to overview), Q/E or right-drag to rotate.
- Building: pick a card in the build menu, then click to place. R paints roads, P paves them, X demolishes, and C over
  a building places another of the same type.
- Space pauses, and 1/2/3 set the game speed. M toggles the minimap.
- The game autosaves every minute and when you leave. **Continue** restores the colony.
- **Touch screens:** one finger pans, pinch zooms, and a two-finger twist rotates. Tap to select or place, and drag
  to paint roads. ✕ stops the current tool. In hero mode a joystick and Attack / Use / Jump buttons appear.
- **Graphics** (menu): Low, Medium or High sets the pixel ratio, shadow quality, decor, shadow casters, view
  distance, and (on Low) a lighter tree model for distant forest chunks. Phones and 4-core machines start on
  Low. Until you pick a level yourself, the game steps down one level whenever a few seconds of play average
  under 36 fps.

**Code** (`public/relic/src`, the simulation is DOM-free and tested in Node)
- `data.js`: goods, buildings, tiers, relics, lairs and quests
- `map.js`: seeded world generation
- `sim.js`: the deterministic colony simulation (fixed step, save/load)
- `kit.js`: builds every building from Dungeon walls, floors and props plus Resource and Tool pieces, with
  procedural roofs, fields and canopies, then merges the geometry per material
- `world3d.js`: terrain, water, the instanced forest (in 24×24-tile chunks, so off-screen chunks are culled), dirt
  and paved roads, fog and territory overlay, lairs and deposits, and level of detail
- `camera.js`: the RTS camera and the hero camera
- `units.js`: carriers, strolling villagers, lumberjacks, builders and site workers
- `ambience.js`: birdsong, crickets and positional work sounds from the WebAudio synth
- `hero.js`: the Founder, creatures, raids and relics
- `ui.js`: the HUD, build menu with rendered thumbnails, inspector and minimap
- `main.js`: glue, input modes, day/night, VFX and save
- `tests/colony.test.mjs` covers:
  - map fairness over 50 seeds
  - difficulty and the founding grant
  - placement, logistics and paved roads
  - chains, workforce, needs and tiers
  - relics, raids and trade
  - festivals, expeditions and statistics
  - save/load

  A scripted bot (`tests/colony-bot.mjs`) plays seeds 1–8 on Settler and must win at least 7. It currently wins 8/8,
  in about 70 game minutes.

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
- Versus play: two-sided turns, per-side flasks, lockstep determinism, and online duels between two in-process clients (room code, lost-message repair, a full room, rematch, quick-match pairing)
- The arena server core: economy, validation, daily streak, harvest and craft, upgrades, raids with server replay, forged logs, PvP Elo, simulated defenses, season rollover
- The Supabase store, against an in-memory fake of supabase-js
- Wildwood Colony: simulation unit tests, 50-seed map fairness and eight bot playthroughs
- Whether `_shared` is in sync with `public/`

## Wildwood Tactics
The mercenary guilds are at war in the Wildwood. You draft 4 of 6 classes, fight procedurally generated rival squads
on a 12×12 forest grid, and travel a branching node map (skirmishes, elite squads, supply caches, campfires) to the
boss, an elite squad called the Hollow Crown.

**Turns:** each hero gets one move and one action per turn, in either order. Then the enemy squad acts.

**Modes** (title screen)
| Mode | What it is |
|---|---|
| Campaign | The roguelite run described below |
| Skirmish vs AI | One battle against a random AI squad. Easy, Normal or Hard scales its HP and damage |
| 2 Players: same screen | Hot-seat. Each player drafts a squad. Between turns a curtain hides the board and the camera turns to the next player's side |
| Online Duel | Live duel with another browser. **Quick Match** pairs you with anyone waiting; **Create room** gives a 4-letter code (and an invite link, `?join=CODE`) for a friend |

**How online duels work**
- Supabase Realtime only: one broadcast + presence channel per room (`wwt-room-CODE`) and a lobby channel (`wwt-lobby`). No tables, no Edge Function.
- The battle is deterministic: the same seed, squads and command list give the same game. So peers send only their commands (`move`, `ability`, `end turn`), numbered by their index in the shared log.
- A lost message shows up as a gap. The missing entries are fetched from the other player's log, and a 4-second ping catches a lost last message.
- Each turn has a 90-second clock that ends the turn automatically. If the opponent disconnects, they get 60 seconds to come back. Closing the tab forfeits.
- Play is trust-based (casual). Both screens validate every command, and an illegal one is reported as a desync.
- It uses the URL and publishable key in `public/arena/config.js`. The project's Realtime must be enabled; it is by default.
- `?net=local` swaps in a BroadcastChannel transport so two tabs on one computer can duel, which is handy for testing. `?offline` disables online play.

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
- `controller.js`: battle input, HUD and hints. Works for whichever side is local (`localSides`) and applies remote commands
- `net.js`: online duels (`OnlineMatch`, Supabase / BroadcastChannel transports, room codes, quick match, gap repair)
- `main.js`: screens, game modes and the online lobby

## Performance on mid-range devices
All four games share the loader and character code, so these apply everywhere:
- **Loading.** `THREE.Cache` is on, and each pack's texture atlas is decoded and uploaded once, not once per model
  file. In the colony this cuts GPU textures from 171 to 36 and load time from about 12 s to 3 s (headless test).
- **Characters.** The 7–9 skinned parts of each KayKit character are merged into one mesh at load, so each
  actor is one draw call. Animation clips are created on first use.
- **Particles** are recycled from a pool, capped by quality.
- **Phones and 4-core machines** get lighter defaults: no MSAA in the colony on Low, lower pixel ratios and
  smaller shadow maps in Chess and Tactics, and two torch lights instead of five in Chess (none on phones).

In the colony:
- Buildings of a type share one baked model.
- Off-screen villagers are hidden and animate at 4 Hz, and only villagers near the view cast shadows.
- The shadow map refreshes every 1–4 frames depending on quality.
- The scene renders at about 10 fps behind menus.
- Labels, the build menu and the inspector only touch the DOM when something changed.
- The previous game's GPU memory is freed when a new one starts.

**Measured** in headless Chromium with a software renderer, on a bot-grown town (Medium quality):
- draw calls: 527 / 640 / 567 → 379 / 474 / 401 at street / mid / overview zoom
- JS heap: 110 → 83 MB

Real-GPU frame rates still need checking on actual devices.

**Touch** works in every game: one-finger orbit or pan, pinch zoom, tap to select. The Tactics and Chess
HUDs have phone layouts.

## Asset notes
- The free Adventurers pack has no attack or sit animations. Attacks are procedural lunges and weapon swings layered on
  the `Use_Item`/`Throw` clips.
- The packs have no potion bottle, so it's a small procedural mesh.
- Three.js r170 is vendored in `public/vendor/three`, so no CDN is needed.
