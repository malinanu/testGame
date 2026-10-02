# Forest Relic Hunt

A third-person 3D action game for the browser, built with Three.js and the free KayKit asset packs
(*Adventurers 2.0* and *Forest Nature Pack 1.0*, CC0 by Kay Lousberg).

**Goal:** pick a hero, find the 5 glowing relics hidden in the forest (follow the light beams and the
compass), fight the hooded raiders and brutes, then return to the portal at the centre.

## Run
```
cd public && python3 -m http.server 8123   # or: npx serve public
```
Open http://localhost:8123 . Add `?hero=Mage` to skip the menu.

## Controls
WASD / arrows move · mouse look (click to capture) · Space jump · left click or F attack · wheel zoom

Heroes: Knight (sword+shield), Barbarian (big axe), Rogue (fast daggers), Mage (arcane bolts), Ranger (bow).
Defeated foes sometimes drop red health orbs; relics heal a little.

## Layout
- `public/src/assets.js` loads characters, shared rig animations, weapons and forest props
- `public/src/world.js` instanced forest scatter, colliders, lighting
- `public/src/actor.js` rigged character wrapper (animations, hand slots, hit flash)
- `public/src/player.js`, `enemies.js`, `game.js` gameplay, AI, HUD and flow
- `public/vendor/three` vendored Three.js r170 (no CDN needed)

The free Adventurers pack ships no attack clips, so melee swings are procedural weapon motion layered on the
`Use_Item`/`Throw` clips.
