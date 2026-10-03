// Loads every model Wildwood Colony uses: characters/props/forest via the shared loader, plus the
// Dungeon, Resource Bits and RPG Tools kit pieces (all GLTFs of a pack share one texture).
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadAssets } from '../../src/assets.js';

export const DUNGEON = ['wall', 'wall_doorway', 'wall_window_open', 'wall_window_closed', 'wall_half', 'wall_arched', 'wall_corner', 'wall_broken',
  'wall_scaffold', 'wall_doorway_scaffold', 'wall_window_open_scaffold', 'wall_pillar', 'floor_wood_large', 'floor_wood_small', 'floor_tile_large',
  'floor_tile_small', 'floor_dirt_large', 'floor_foundation_allsides', 'floor_tile_small_decorated', 'pillar', 'pillar_decorated', 'column', 'stairs_wood',
  'stairs', 'banner_patternA_red', 'banner_patternB_blue', 'banner_patternC_green', 'banner_shield_yellow', 'banner_thin_red', 'banner_triple_blue',
  'banner_red', 'banner_blue', 'barrel_large', 'barrel_small', 'barrel_small_stack', 'keg', 'keg_decorated', 'box_large', 'box_small', 'box_stacked',
  'crates_stacked', 'table_long_tablecloth_decorated_A', 'table_medium_tablecloth', 'table_small_decorated_A', 'chair', 'stool', 'bed_decorated',
  'shelf_large', 'shelves', 'candle_triple', 'torch_mounted', 'torch_lit', 'chest', 'chest_gold', 'coin_stack_large', 'coin_stack_medium',
  'plate_food_A', 'plate_food_B', 'bottle_A_green', 'rubble_large', 'rubble_half', 'sword_shield', 'barrier', 'barrier_column', 'trunk_large_A'];
export const RESOURCES = ['Wood_Log_A', 'Wood_Log_Stack', 'Wood_Plank_A', 'Wood_Planks_Stack_Large', 'Wood_Planks_Stack_Medium', 'Wood_Planks_Stack_Small',
  'Stone_Brick', 'Stone_Bricks_Stack_Large', 'Stone_Bricks_Stack_Medium', 'Stone_Bricks_Stack_Small', 'Stone_Chunks_Large', 'Stone_Chunks_Small',
  'Iron_Nuggets', 'Iron_Bars', 'Iron_Bars_Stack_Medium', 'Copper_Nuggets', 'Gold_Nuggets', 'Gold_Bars', 'Gold_Bars_Stack_Small', 'Silver_Nuggets',
  'Silver_Bars', 'Textiles_A', 'Textiles_Stack_Large_Colored', 'Textiles_Stack_Small', 'Fuel_A_Barrel', 'Fuel_A_Barrels', 'Pallet_Wood',
  'Pallet_Wood_Covered_A', 'Parts_Pile_Small', 'Iron_Nugget_Large', 'Gold_Nugget_Large'];
export const TOOLS = ['anvil', 'grindstone', 'saw', 'hammer', 'pickaxe', 'shovel', 'axe', 'map', 'map_rolled', 'blueprint_stacked', 'journal_closed',
  'lantern', 'torch', 'bucket_metal', 'rope_bundle_A', 'compass_base', 'drafting_compass', 'chisel', 'mallet'];
export const FOREST = ['Tree_1_A', 'Tree_1_B', 'Tree_2_A', 'Tree_2_B', 'Tree_3_A', 'Tree_3_B', 'Tree_4_A', 'Tree_4_B', 'Tree_Bare_1_A', 'Tree_Bare_2_A',
  'Bush_1_A', 'Bush_2_A', 'Bush_3_A', 'Bush_4_A', 'Rock_1_A', 'Rock_1_E', 'Rock_2_A', 'Rock_3_A', 'Rock_3_E', 'Rock_3_F', 'Rock_3_G', 'Grass_1_A', 'Grass_2_A'];
const PROPS = ['sword_1handed', 'axe_1handed', 'axe_2handed', 'dagger', 'staff', 'bow', 'shield_round', 'mug_full'];

export async function loadGame(onProgress = () => {}) {
  const loader = new GLTFLoader();
  let done = 0; const total = DUNGEON.length + RESOURCES.length + TOOLS.length + 40;
  const tick = () => onProgress(++done, total);
  const pack = async (dir, names) => {
    const out = {};
    await Promise.all(names.map(n => loader.loadAsync(`../assets/${dir}/${n}.gltf`).then(g => { out[n] = g.scene; tick(); })));
    return out;
  };
  const [base, dun, res, tool] = await Promise.all([
    loadAssets({ base: '../', props: PROPS, forest: FOREST, onProgress: () => tick() }),
    pack('dungeon', DUNGEON), pack('resources', RESOURCES), pack('tools', TOOLS),
  ]);
  return { ...base, dun, res, tool };
}
