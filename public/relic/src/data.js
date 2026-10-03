// Wildwood Colony rules data: goods, buildings, population tiers, relics, lairs, quests.
// Pure data (no DOM / three.js) so the simulation runs in Node for tests.

export const TILE = 2;           // world units per map tile
export const W = 96, H = 96;     // map size in tiles
export const DAY = 240;          // seconds of game time per day/night cycle
export const STEP = 0.25;        // fixed simulation step (seconds of game time)

// ---------------------------------------------------------------- goods
// price: base caravan price in gold. model: Resource/Tools/Dungeon piece used for stacks and carriers.
export const GOODS = {
  logs:     { name: 'Logs',      icon: '🪵', price: 6,  model: 'res:Wood_Log_Stack',            carry: 'res:Wood_Log_A' },
  planks:   { name: 'Planks',    icon: '🟫', price: 14, model: 'res:Wood_Planks_Stack_Medium',   carry: 'res:Wood_Plank_A' },
  stone:    { name: 'Stone',     icon: '🪨', price: 8,  model: 'res:Stone_Chunks_Large',         carry: 'res:Stone_Chunks_Small' },
  bricks:   { name: 'Bricks',    icon: '🧱', price: 22, model: 'res:Stone_Bricks_Stack_Medium',  carry: 'res:Stone_Brick' },
  food:     { name: 'Game & Berries', icon: '🍖', price: 9, model: 'dun:plate_food_A',           carry: 'dun:plate_food_B' },
  grain:    { name: 'Grain',     icon: '🌾', price: 8,  model: 'dun:box_stacked',                carry: 'dun:box_small' },
  bread:    { name: 'Bread',     icon: '🍞', price: 18, model: 'dun:plate_food_B',               carry: 'dun:plate_food_B' },
  ale:      { name: 'Ale',       icon: '🍺', price: 24, model: 'dun:keg_decorated',              carry: 'dun:barrel_small' },
  flax:     { name: 'Flax',      icon: '🌿', price: 7,  model: 'res:Textiles_Stack_Small',       carry: 'res:Textiles_A' },
  textiles: { name: 'Textiles',  icon: '🧵', price: 26, model: 'res:Textiles_Stack_Large_Colored', carry: 'res:Textiles_A' },
  charcoal: { name: 'Charcoal',  icon: '⚫', price: 12, model: 'res:Fuel_A_Barrels',             carry: 'res:Fuel_A_Barrel' },
  ore:      { name: 'Iron Ore',  icon: '⛏️', price: 12, model: 'res:Iron_Nuggets',               carry: 'res:Iron_Nugget_Large' },
  iron:     { name: 'Iron',      icon: '🔩', price: 30, model: 'res:Iron_Bars_Stack_Medium',     carry: 'res:Iron_Bars' },
  tools:    { name: 'Tools',     icon: '🔨', price: 45, model: 'res:Parts_Pile_Small',           carry: 'tool:hammer' },
  goldore:  { name: 'Gold Ore',  icon: '🟡', price: 30, model: 'res:Gold_Nuggets',               carry: 'res:Gold_Nugget_Large' },
  jewelry:  { name: 'Jewelry',   icon: '💍', price: 90, model: 'res:Gold_Bars_Stack_Small',      carry: 'res:Gold_Bars' },
  maps:     { name: 'Maps',      icon: '🗺️', price: 60, model: 'tool:blueprint_stacked',         carry: 'tool:map_rolled' },
};
export const GOOD_KEYS = Object.keys(GOODS);

// ---------------------------------------------------------------- population tiers
// basic needs decide how many people live in a house; luxury needs raise happiness (and tax).
// goods consumption is per resident per minute.
export const TIERS = [
  { id: 'settlers',  name: 'Settlers',  icon: '🧑‍🌾', house: 'hut',   cap: 6,  tax: 1.2,
    basic: [{ good: 'food', rate: 1 / 40 }, { service: 'market' }],
    luxury: [{ service: 'tavern' }] },
  { id: 'craftsmen', name: 'Craftsmen', icon: '🧑‍🔧', house: 'house', cap: 12, tax: 1.4,
    basic: [{ good: 'bread', rate: 1 / 40 }, { good: 'textiles', rate: 1 / 80 }, { service: 'market' }],
    luxury: [{ good: 'ale', rate: 1 / 60 }, { service: 'tavern' }],
    unlock: { settlers: 30, relics: 1 }, upgrade: { planks: 3, bricks: 2 } },
  { id: 'merchants', name: 'Merchants', icon: '🧑‍💼', house: 'manor', cap: 20, tax: 2.8,
    basic: [{ good: 'bread', rate: 1 / 40 }, { good: 'ale', rate: 1 / 40 }, { good: 'textiles', rate: 1 / 80 }, { service: 'tavern' }, { service: 'chapel' }],
    luxury: [{ good: 'jewelry', rate: 1 / 120 }, { good: 'tools', rate: 1 / 300 }],
    unlock: { craftsmen: 60, relics: 3 }, upgrade: { planks: 4, bricks: 6, tools: 2 } },
];
export const TIER_IDS = TIERS.map(t => t.id);

// ---------------------------------------------------------------- buildings
// size: [w, h] tiles. cost: gold + goods. upkeep: gold / minute. workers: { tier, n }.
// cycle: seconds; in/out: goods per cycle. near: production needs nearby trees/rock (factor).
// on: must be placed on a deposit kind. range: service / logistics / territory radius in tiles.
// tier: population tier index needed to unlock (0 = from the start). relics: relic count needed.
export const BUILDINGS = {
  road:       { name: 'Road', cat: 'roads', size: [1, 1], cost: { gold: 1 }, desc: 'Connects buildings to the Town Hall or a Warehouse. Carriers walk on roads.' },

  townhall:   { name: 'Town Hall', cat: 'public', size: [4, 4], cost: {}, upkeep: 0, unique: true, buildable: false,
    storage: 40, carriers: 8, logistic: 20, territory: 20, vision: 22, desc: 'Heart of the colony: storage, carriers, territory. Bring relics here.' },
  hut:        { name: 'Settler Hut', cat: 'homes', size: [2, 2], cost: { gold: 10, planks: 2 }, upkeep: 0, residence: 0,
    desc: 'Home for up to 6 Settlers. Needs Food and a Market nearby.' },
  house:      { name: 'Craftsman House', cat: 'homes', size: [2, 2], residence: 1, buildable: false, desc: 'Upgraded hut: 12 Craftsmen.' },
  manor:      { name: 'Merchant Manor', cat: 'homes', size: [2, 2], residence: 2, buildable: false, desc: 'Upgraded house: 20 Merchants.' },

  market:     { name: 'Market', cat: 'public', size: [3, 3], cost: { gold: 150, planks: 8 }, upkeep: 6, range: 13, service: 'market',
    desc: 'Residents within range can shop here (basic need).' },
  tavern:     { name: 'Tavern', cat: 'public', size: [3, 3], cost: { gold: 300, planks: 8, bricks: 6 }, upkeep: 12, range: 13, service: 'tavern', tier: 1,
    desc: 'Ale, songs and gossip. Need of Craftsmen and Merchants.' },
  chapel:     { name: 'Chapel', cat: 'public', size: [3, 3], cost: { gold: 600, bricks: 14, tools: 4 }, upkeep: 30, range: 15, service: 'chapel', tier: 2,
    desc: 'Candles and quiet. Need of Merchants.' },
  warehouse:  { name: 'Warehouse', cat: 'public', size: [3, 2], cost: { gold: 120, planks: 6 }, upkeep: 6, storage: 25, carriers: 4, logistic: 16,
    desc: 'More storage and carriers. Buildings within range are served by its carriers.' },
  watchtower: { name: 'Watchtower', cat: 'public', size: [2, 2], cost: { gold: 160, planks: 4, bricks: 4 }, upkeep: 4, range: 11, guard: true,
    desc: 'Archers repel creature raids within range.' },
  outpost:    { name: 'Outpost', cat: 'public', size: [2, 2], cost: { gold: 250, planks: 5 }, upkeep: 6, territory: 12, vision: 14, frontier: true,
    desc: 'Extends your territory. Can be built in explored land just outside it.' },
  tradepost:  { name: 'Trading Post', cat: 'public', size: [3, 3], cost: { gold: 220, planks: 10 }, upkeep: 10, trade: true,
    desc: 'Merchant caravans stop here to buy and sell goods.' },
  sanctum:    { name: 'Relic Sanctum', cat: 'public', size: [5, 5], cost: { gold: 4500, planks: 40, bricks: 50, tools: 15, jewelry: 12 }, upkeep: 0, unique: true, tier: 2, relics: 5, monument: true,
    desc: 'The monument that binds the five relics. Building it wins the game.' },

  lumberjack: { name: 'Lumberjack', cat: 'production', size: [2, 2], cost: { gold: 50, planks: 2 }, upkeep: 3, workers: { tier: 0, n: 3 },
    cycle: 12, out: { logs: 1 }, near: { what: 'tree', r: 5, full: 12 }, fells: true, desc: 'Fells trees nearby. Productivity depends on how many trees are in range.' },
  forester:   { name: 'Forester', cat: 'production', size: [2, 2], cost: { gold: 30, planks: 2 }, upkeep: 1, workers: { tier: 0, n: 1 },
    cycle: 12, out: {}, plants: true, desc: 'Plants new trees nearby so your lumberjacks never run dry.' },
  sawmill:    { name: 'Sawmill', cat: 'production', size: [2, 2], cost: { gold: 100, planks: 3 }, upkeep: 5, workers: { tier: 0, n: 4 },
    cycle: 15, in: { logs: 1 }, out: { planks: 1 }, desc: 'Logs → Planks.' },
  hunter:     { name: 'Hunting Lodge', cat: 'production', size: [2, 2], cost: { gold: 50, planks: 2 }, upkeep: 3, workers: { tier: 0, n: 2 },
    cycle: 30, out: { food: 1 }, near: { what: 'tree', r: 6, full: 8 }, desc: 'Hunts game and gathers berries in the forest nearby.' },
  quarry:     { name: 'Quarry', cat: 'production', size: [2, 2], cost: { gold: 80, planks: 3 }, upkeep: 4, workers: { tier: 0, n: 4 },
    cycle: 30, out: { stone: 1 }, near: { what: 'rock', r: 3, full: 3 }, desc: 'Cuts stone. Must be built next to a rock outcrop.' },
  stonemason: { name: 'Stonemason', cat: 'production', size: [2, 2], cost: { gold: 120, planks: 4 }, upkeep: 6, workers: { tier: 0, n: 4 },
    cycle: 30, in: { stone: 1 }, out: { bricks: 1 }, desc: 'Stone → Bricks.' },
  charcoal:   { name: 'Charcoal Kiln', cat: 'production', size: [2, 2], cost: { gold: 80, planks: 3 }, upkeep: 4, workers: { tier: 0, n: 2 },
    cycle: 30, in: { logs: 1 }, out: { charcoal: 1 }, desc: 'Logs → Charcoal (fuel for smelting).' },
  farm:       { name: 'Grain Farm', cat: 'production', size: [3, 3], cost: { gold: 120, planks: 4 }, upkeep: 6, workers: { tier: 0, n: 3 }, tier: 1,
    cycle: 30, out: { grain: 1 }, field: 'grain', desc: 'Golden fields of grain.' },
  flaxfarm:   { name: 'Flax Farm', cat: 'production', size: [3, 3], cost: { gold: 100, planks: 4 }, upkeep: 5, workers: { tier: 0, n: 2 }, tier: 1,
    cycle: 30, out: { flax: 1 }, field: 'flax', desc: 'Blue-flowered flax for weaving.' },
  bakery:     { name: 'Bakery', cat: 'production', size: [2, 2], cost: { gold: 200, planks: 4, bricks: 3 }, upkeep: 7, workers: { tier: 1, n: 3 }, tier: 1,
    cycle: 30, in: { grain: 1 }, out: { bread: 1 }, desc: 'Grain → Bread.' },
  brewery:    { name: 'Brewery', cat: 'production', size: [2, 2], cost: { gold: 250, planks: 4, bricks: 3 }, upkeep: 8, workers: { tier: 1, n: 3 }, tier: 1,
    cycle: 30, in: { grain: 1 }, out: { ale: 1 }, desc: 'Grain → Ale.' },
  weaver:     { name: 'Weaver', cat: 'production', size: [2, 2], cost: { gold: 200, planks: 4, bricks: 2 }, upkeep: 7, workers: { tier: 1, n: 2 }, tier: 1,
    cycle: 30, in: { flax: 1 }, out: { textiles: 1 }, desc: 'Flax → Textiles.' },
  ironmine:   { name: 'Iron Mine', cat: 'production', size: [2, 2], cost: { gold: 300, planks: 6, tools: 2 }, upkeep: 14, workers: { tier: 1, n: 4 }, tier: 1,
    cycle: 30, out: { ore: 1 }, on: 'iron', desc: 'Must be built on a discovered iron deposit.' },
  smelter:    { name: 'Smelter', cat: 'production', size: [2, 2], cost: { gold: 300, planks: 4, bricks: 6 }, upkeep: 14, workers: { tier: 1, n: 4 }, tier: 1,
    cycle: 30, in: { ore: 1, charcoal: 1 }, out: { iron: 1 }, desc: 'Iron Ore + Charcoal → Iron.' },
  blacksmith: { name: 'Blacksmith', cat: 'production', size: [2, 2], cost: { gold: 350, planks: 4, bricks: 6 }, upkeep: 16, workers: { tier: 1, n: 3 }, tier: 1,
    cycle: 30, in: { iron: 1 }, out: { tools: 1 }, desc: 'Iron → Tools (building material, luxury for Merchants).' },
  cartographer: { name: 'Cartographer', cat: 'production', size: [2, 2], cost: { gold: 300, planks: 6, bricks: 2 }, upkeep: 12, workers: { tier: 1, n: 2 }, tier: 1,
    cycle: 60, in: { planks: 1, textiles: 1 }, out: { maps: 1 }, desc: 'Planks + Textiles → Maps. Use a map to reveal the way to a relic.' },
  goldmine:   { name: 'Gold Mine', cat: 'production', size: [2, 2], cost: { gold: 600, planks: 6, tools: 4 }, upkeep: 20, workers: { tier: 1, n: 4 }, tier: 2,
    cycle: 40, out: { goldore: 1 }, on: 'gold', desc: 'Must be built on a discovered gold deposit.' },
  goldsmith:  { name: 'Goldsmith', cat: 'production', size: [2, 2], cost: { gold: 700, bricks: 8, tools: 4 }, upkeep: 24, workers: { tier: 2, n: 3 }, tier: 2,
    cycle: 45, in: { goldore: 1, charcoal: 1 }, out: { jewelry: 1 }, desc: 'Gold Ore + Charcoal → Jewelry.' },
};
export const CATEGORIES = [
  { id: 'roads', name: 'Roads', icon: '🛤️' },
  { id: 'homes', name: 'Residences', icon: '🏠' },
  { id: 'production', name: 'Production', icon: '⚒️' },
  { id: 'public', name: 'Public', icon: '🏛️' },
];

// ---------------------------------------------------------------- relics & lairs
export const RELICS = [
  { id: 'grove', name: 'Heart of the Grove', icon: '🌳', color: 0x6dff8a, boon: '+25% Lumberjack, Hunter and Farm output', mult: { lumberjack: 1.25, hunter: 1.25, farm: 1.25, flaxfarm: 1.25 } },
  { id: 'stone', name: 'Runestone of the Deep', icon: '🗿', color: 0xb9c2d6, boon: '+30% Quarry and Stonemason output', mult: { quarry: 1.3, stonemason: 1.3 } },
  { id: 'ember', name: 'Ember Crown', icon: '🔥', color: 0xff8a3a, boon: '+30% Charcoal, Smelter and Blacksmith output', mult: { charcoal: 1.3, smelter: 1.3, blacksmith: 1.3 } },
  { id: 'tide',  name: 'Tide Pearl', icon: '🔮', color: 0x6ad0ff, boon: 'Caravans pay 25% more and charge 25% less', trade: 0.25 },
  { id: 'sun',   name: 'Sunforged Sigil', icon: '☀️', color: 0xffd54a, boon: '+20% taxes from every resident', tax: 0.2 },
];
export const LAIR_KINDS = {
  camp:   { name: 'Bandit Camp',  guards: ['grunt', 'grunt', 'grunt'], loot: { gold: 150, planks: 4 } },
  den:    { name: 'Brute Den',    guards: ['brute', 'grunt', 'grunt'], loot: { gold: 250, tools: 3 } },
  ruin:   { name: 'Haunted Ruin', guards: ['brute', 'grunt', 'grunt', 'grunt'], loot: { gold: 350, bricks: 6 } },
};

// ---------------------------------------------------------------- economy constants
/** Difficulty: start gold, upkeep and tax multipliers, raid pacing. */
export const DIFFICULTY = {
  easy:   { name: 'Relaxed',  gold: 2500, upkeep: 0.75, tax: 1.15, raidEvery: 1.6, grace: 2400, fire: 1.5 },
  normal: { name: 'Settler',  gold: 1500, upkeep: 1,    tax: 1,    raidEvery: 1,   grace: 1500, fire: 1 },
  hard:   { name: 'Pioneer',  gold: 1000, upkeep: 1.2,  tax: 0.9,  raidEvery: 0.7, grace: 1080, fire: 0.75 },
};
export const GRANT_POP = 40;
export const FESTIVAL = { cost: { gold: 300, food: 12 }, time: 180, cooldown: 420, happy: 25 };
export const EXPEDITION = { cost: { gold: 200, maps: 1, food: 10 }, time: 240 };
export const HIST_EVERY = 30, HIST_MAX = 120;   // statistics: one sample per 30 s, last hour kept            // upkeep is halved until the colony first reaches this many residents
export const START = { gold: 1500, stock: { planks: 30, logs: 10, food: 20, tools: 8, bricks: 4 } };
export const CARRIER_SPEED = 4;       // tiles / second along roads
export const LOCAL_CAP = 4;             // output buffer per building
export const RAID_EVERY = [300, 420];   // seconds between raids from an uncleared lair near the colony
export const RAID_RANGE = 28;           // tiles: lairs closer than this to a colony building can raid
export const RAID_GRACE = 1500;         // no raids during the first 25 minutes, nor before 40 residents
export const FIRE_TIME = 90;            // seconds a building burns before it is ruined
export const CARAVAN_EVERY = 300, CARAVAN_STAY = 120;

export const QUESTS = [
  { id: 'q_lumber', text: 'Build a Lumberjack near the forest and connect it to the Town Hall with a road.', check: s => s.count('lumberjack', true) >= 1, reward: { gold: 100 } },
  { id: 'q_saw', text: 'Build a Sawmill to turn Logs into Planks.', check: s => s.count('sawmill', true) >= 1, reward: { gold: 100 } },
  { id: 'q_huts', text: 'Build 4 Settler Huts along a road.', check: s => s.count('hut') >= 4, reward: { planks: 6 } },
  { id: 'q_food', text: 'Feed your settlers: build a Hunting Lodge near trees.', check: s => s.count('hunter', true) >= 1, reward: { food: 10 } },
  { id: 'q_market', text: 'Build a Market so the huts are within its range.', check: s => s.count('market') >= 1, reward: { gold: 150 } },
  { id: 'q_pop20', text: 'Grow to 20 Settlers.', check: s => s.pop.settlers >= 20, reward: { gold: 200 } },
  { id: 'q_stone', text: 'Build a Quarry next to rocks and a Stonemason for Bricks.', check: s => s.count('stonemason', true) >= 1, reward: { gold: 200 } },
  { id: 'q_hero', text: 'Take the field (H) with your Founder and explore beyond the border.', check: s => s.stats.explored > 0.22, reward: { gold: 150 } },
  { id: 'q_relic1', text: 'Recover a relic from a guarded lair and bring it to the Town Hall.', check: s => s.relics.length >= 1, reward: { gold: 400 } },
  { id: 'q_craft', text: 'Upgrade a hut to a Craftsman House (30 settlers + 1 relic).', check: s => s.pop.craftsmen > 0, reward: { gold: 300 } },
  { id: 'q_bread', text: 'Build a Grain Farm and a Bakery for bread.', check: s => s.count('bakery', true) >= 1, reward: { gold: 300 } },
  { id: 'q_cloth', text: 'Weave Textiles: Flax Farm + Weaver.', check: s => s.count('weaver', true) >= 1, reward: { gold: 300 } },
  { id: 'q_tavern', text: 'Open a Brewery and a Tavern.', check: s => s.count('tavern') >= 1 && s.count('brewery', true) >= 1, reward: { gold: 400 } },
  { id: 'q_tools', text: 'Forge Tools: Iron Mine, Charcoal Kiln, Smelter and Blacksmith.', check: s => s.count('blacksmith', true) >= 1, reward: { gold: 500 } },
  { id: 'q_relic3', text: 'Hold 3 relics.', check: s => s.relics.length >= 3, reward: { gold: 600 } },
  { id: 'q_merchant', text: 'Upgrade a house to a Merchant Manor.', check: s => s.pop.merchants > 0, reward: { gold: 800 } },
  { id: 'q_jewel', text: 'Craft Jewelry: Gold Mine + Goldsmith.', check: s => s.count('goldsmith', true) >= 1, reward: { gold: 800 } },
  { id: 'q_relic5', text: 'Recover all 5 relics.', check: s => s.relics.length >= 5, reward: { gold: 1000 } },
  { id: 'q_sanctum', text: 'Build the Relic Sanctum (250 residents).', check: s => s.count('sanctum') >= 1, reward: {} },
];
export const SANCTUM_POP = 250;
