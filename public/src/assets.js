import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const load = (url) => loader.loadAsync(url);

export const CHARACTERS = ['Knight', 'Barbarian', 'Mage', 'Ranger', 'Rogue', 'Rogue_Hooded'];
export const PROPS = ['sword_1handed', 'sword_2handed', 'axe_1handed', 'axe_2handed', 'dagger', 'staff', 'wand',
  'bow', 'shield_round', 'shield_square', 'shield_badge', 'spellbook_open'];
export const FOREST = [
  'Tree_1_A', 'Tree_1_B', 'Tree_2_A', 'Tree_2_B', 'Tree_3_A', 'Tree_3_B', 'Tree_4_A', 'Tree_4_B',
  'Tree_Bare_1_A', 'Tree_Bare_2_A', 'Bush_1_A', 'Bush_2_A', 'Bush_3_A', 'Bush_4_A',
  'Rock_1_A', 'Rock_1_E', 'Rock_2_A', 'Rock_3_A', 'Rock_3_F', 'Grass_1_A', 'Grass_2_A',
];

/** Loads every model + animation clip the game uses. Returns plain lookup tables. */
export async function loadAssets() {
  const a = { chars: {}, props: {}, forest: {}, clips: {} };
  const jobs = [];
  for (const n of CHARACTERS) jobs.push(load(`assets/chars/${n}.glb`).then(g => a.chars[n] = g.scene));
  for (const n of PROPS) jobs.push(load(`assets/props/${n}.gltf`).then(g => a.props[n] = g.scene));
  for (const n of FOREST) jobs.push(load(`assets/forest/${n}_Color1.gltf`).then(g => a.forest[n] = g.scene));
  for (const f of ['General', 'MovementBasic'])
    jobs.push(load(`assets/anim/Rig_Medium_${f}.glb`).then(g => g.animations.forEach(c => a.clips[c.name] = c)));
  await Promise.all(jobs);
  return a;
}

/** First mesh found inside a loaded scene (the forest props are single-mesh). */
export function firstMesh(scene) {
  let m = null;
  scene.traverse(o => { if (!m && o.isMesh) m = o; });
  return m;
}
export { THREE };
