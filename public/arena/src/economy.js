// Wildwood Arena economy: gear tiers, upgrades, harvesting, crafting, raid rewards, Elo and leagues.
// Pure module shared by the browser client and the Supabase Edge Function.
import { T } from '../../tactics/src/data.js';

export const START = { rating: 1200, gold: 150, herbs: 6, berries: 6 };

// Same model at every tier; only the numbers grow.
export const TIERS = [
  { name: 'Common',    color: '#c9c9c9', dmg: 0, hp: 0,  acc: 0 },
  { name: 'Uncommon',  color: '#62d66a', dmg: 1, hp: 2,  acc: 0 },
  { name: 'Rare',      color: '#4aa3ff', dmg: 2, hp: 4,  acc: 5 },
  { name: 'Epic',      color: '#b763ff', dmg: 3, hp: 7,  acc: 5 },
  { name: 'Legendary', color: '#ffb020', dmg: 4, hp: 10, acc: 10 },
];
export const GEAR_NAMES = {
  knight: 'Longsword & Kite Shield', barbarian: 'Two-handed Battleaxe', ranger: 'Longbow',
  rogue: 'Twin Daggers', wizard: 'Green-orb Staff', fighter: 'One-handed Axe',
};
export const UPGRADE_COST = [120, 320, 750, 1600]; // to reach tier 1..4
export const upgradeCost = tier => UPGRADE_COST[tier] ?? null;

export const MAX_LEVEL = 5;
export const LEVEL_COST = [0, 250, 600, 1200, 2200]; // stronghold level n -> n+1
export const buildBudget = level => 20 + level * 6;

// Harvest: grass tufts give herbs, bushes give berries; stockpiles cap.
export const HARVEST = { herbBase: 1, herbPerGrass: 0.12, berryBase: 0.5, berryPerBush: 0.6, capHours: 16, maxCap: 60 };
export function harvestRates(layout) {
  let grass = 0, bush = 0;
  for (const t of layout.tiles) { if (t === T.GRASS || t === T.OVERGROWN) grass++; else if (t === T.BUSH) bush++; }
  return { herbs: HARVEST.herbBase + grass * HARVEST.herbPerGrass, berries: HARVEST.berryBase + bush * HARVEST.berryPerBush };
}
/** Resources waiting to be collected (per hour rates, capped). */
export function pendingHarvest(layout, harvestedAt, now) {
  const hours = Math.max(0, Math.min(HARVEST.capHours, (now - harvestedAt) / 3.6e6));
  const r = harvestRates(layout);
  return { herbs: Math.min(HARVEST.maxCap, Math.floor(r.herbs * hours)), berries: Math.min(HARVEST.maxCap, Math.floor(r.berries * hours)) };
}

export const RECIPES = {
  potion: { name: 'Healing Potion', cost: { herbs: 5 }, desc: 'In-raid Potion Flask: +8 HP to an ally (uses an action).', max: 3 },
  ale:    { name: 'Mug of Ale', cost: { berries: 5 }, desc: '+2 damage for your whole party for one raid.', max: 2 },
  tonic:  { name: 'Forest Tonic', cost: { herbs: 3, berries: 3 }, desc: '+1 move for your whole party for one raid.', max: 2 },
};
export const RAID_CARRY = { potion: 2, ale: 1, tonic: 1 };

// Elo
export const K = 32;
export const expected = (ra, rb) => 1 / (1 + 10 ** ((rb - ra) / 400));
export function eloDelta(attacker, defender, attackerWon) {
  const d = Math.round(K * ((attackerWon ? 1 : 0) - expected(attacker, defender)));
  return { attacker: d, defender: -d };
}

export const LEAGUES = [
  { name: 'Bronze', min: 0, color: '#c98b4e' },
  { name: 'Silver', min: 1100, color: '#cfd8e3' },
  { name: 'Gold', min: 1300, color: '#ffd54a' },
  { name: 'Platinum', min: 1500, color: '#6fe6d8' },
  { name: 'Diamond', min: 1700, color: '#9fb4ff' },
];
export function league(rating) { let l = LEAGUES[0]; for (const x of LEAGUES) if (rating >= x.min) l = x; return l; }

export function raidRewards(won, defenderRating, defenderLevel) {
  if (!won) return { gold: 15, herbs: 0, berries: 0 };
  return { gold: 60 + Math.max(0, Math.round((defenderRating - 900) / 12)) + defenderLevel * 12, herbs: 2, berries: 2 };
}
export const DEFENSE_REWARD = 25; // gold to a defender who holds

export const SEASON_DAYS = 28;
export const seasonReset = r => Math.round(1200 + (r - 1200) * 0.5);

export function dailyBonus(streak) { return 25 + 10 * Math.min(streak, 7); }
