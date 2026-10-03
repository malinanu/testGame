// Loads every model Wildwood Colony uses: characters/props/forest via the shared loader, plus the
// Dungeon, Resource Bits and RPG Tools kit pieces (all GLTFs of a pack share one texture).
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadAssets, shareMaterials } from '../../src/assets.js';

export const DUNGEON = ['wall', 'wall_doorway', 'wall_window_open', 'wall_window_closed', 'wall_arched', 'wall_broken',
  'wall_scaffold', 'wall_doorway_scaffold', 'floor_wood_large', 'floor_tile_large', 'floor_dirt_large', 'pillar', 'pillar_decorated', 'stairs_wood', 'banner_patternA_red', 'banner_patternB_blue', 'banner_patternC_green', 'banner_shield_yellow', 'banner_thin_red', 'banner_triple_blue',
  'banner_red', 'barrel_large', 'barrel_small', 'barrel_small_stack', 'keg', 'keg_decorated', 'box_large', 'box_small', 'box_stacked',
  'crates_stacked', 'table_long_tablecloth_decorated_A', 'table_medium_tablecloth', 'table_small_decorated_A', 'stool', 'candle_triple', 'torch_lit', 'chest', 'chest_gold', 'coin_stack_large',
  'plate_food_A', 'plate_food_B', 'bottle_A_green', 'rubble_large', 'rubble_half', 'sword_shield', 'barrier', 'trunk_large_A'];
export const RESOURCES = ['Wood_Log_A', 'Wood_Log_Stack', 'Wood_Plank_A', 'Wood_Planks_Stack_Large', 'Wood_Planks_Stack_Medium', 'Wood_Planks_Stack_Small',
  'Stone_Brick', 'Stone_Bricks_Stack_Large', 'Stone_Bricks_Stack_Medium', 'Stone_Bricks_Stack_Small', 'Stone_Chunks_Large', 'Stone_Chunks_Small',
  'Iron_Nuggets', 'Iron_Bars', 'Iron_Bars_Stack_Medium', 'Gold_Nuggets', 'Gold_Bars', 'Gold_Bars_Stack_Small', 'Textiles_A', 'Textiles_Stack_Large_Colored', 'Textiles_Stack_Small', 'Fuel_A_Barrel', 'Fuel_A_Barrels',
  'Pallet_Wood_Covered_A', 'Parts_Pile_Small', 'Iron_Nugget_Large', 'Gold_Nugget_Large'];
export const TOOLS = ['anvil', 'grindstone', 'saw', 'hammer', 'pickaxe', 'shovel', 'axe', 'map', 'map_rolled', 'blueprint_stacked',
  'lantern', 'bucket_metal', 'compass_base', 'drafting_compass', 'chisel', 'mallet'];
export const FOREST = ['Tree_1_A', 'Tree_1_B', 'Tree_2_A', 'Tree_2_B', 'Tree_3_A', 'Tree_3_B', 'Tree_4_A', 'Tree_4_B',
  'Bush_1_A', 'Bush_2_A', 'Bush_3_A', 'Bush_4_A', 'Rock_1_A', 'Rock_2_A', 'Rock_3_A', 'Rock_3_E', 'Rock_3_F', 'Rock_3_G', 'Grass_1_A', 'Grass_2_A'];
const PROPS = ['sword_1handed', 'axe_1handed', 'axe_2handed', 'dagger', 'staff', 'bow', 'shield_round', 'mug_full'];

export async function loadGame(onProgress = () => {}) {
  const loader = new GLTFLoader();
  let done = 0; const total = DUNGEON.length + RESOURCES.length + TOOLS.length + 40;
  const tick = () => onProgress(++done, total);
  const pack = async (dir, names) => {
    const out = {};
    await Promise.all(names.map(n => loader.loadAsync(`../assets/${dir}/${n}.gltf`).then(g => { shareMaterials(g.scene); out[n] = g.scene; tick(); })));
    return out;
  };
  const [base, dun, res, tool] = await Promise.all([
    loadAssets({ base: '../', props: PROPS, forest: FOREST, onProgress: () => tick() }),
    pack('dungeon', DUNGEON), pack('resources', RESOURCES), pack('tools', TOOLS),
  ]);
  return { ...base, dun, res, tool };
}
