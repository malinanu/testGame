import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Each .gltf gets its own parser, so without this every model file would download, decode and upload its
// own copy of the pack texture (the KayKit packs share one atlas per pack across dozens of files).
THREE.Cache.enabled = true;
const loader = new GLTFLoader();
const load = (url) => loader.loadAsync(url).then(g => { shareMaterials(g.scene); return g; });

/** One material per (texture image, material settings): later files reuse the first file's material. */
const shared = new Map();
function canon(m) {
  const img = m.map?.image;
  if (!img) return m;
  let byKey = shared.get(img); if (!byKey) shared.set(img, byKey = new Map());
  const key = `${m.type}|${m.name}|${m.color?.getHexString()}|${m.transparent}|${m.opacity}|${m.side}|${m.vertexColors}|${m.alphaTest}|${m.normalMap?.image?.src || ''}`;
  const c = byKey.get(key);
  if (!c) { byKey.set(key, m); return m; }
  if (c !== m) { if (m.map !== c.map) m.map.dispose(); m.dispose(); }
  return c;
}
/**
 * KayKit characters are 7-9 skinned meshes (arms, legs, head, cape...) on one skeleton with one material
 * and one bind matrix: merge them into a single SkinnedMesh so each character is one draw call (and one
 * in the shadow pass) instead of 7-9. Skipped if a model doesn't fit that pattern.
 */
export function mergeCharacter(scene) {
  scene.updateMatrixWorld(true);
  const ms = []; scene.traverse(o => { if (o.isSkinnedMesh) ms.push(o); });
  if (ms.length < 2) return scene;
  const f = ms[0];
  if (ms.some(m => m.skeleton !== f.skeleton || m.material !== f.material || !m.bindMatrix.equals(f.bindMatrix) || !m.matrixWorld.equals(f.matrixWorld) || m.parent !== f.parent)) return scene;
  const geo = mergeGeometries(ms.map(m => m.geometry), false);
  if (!geo) return scene;
  const one = new THREE.SkinnedMesh(geo, f.material);
  one.name = f.name.split('_')[0] + '_Merged';
  one.position.copy(f.position); one.quaternion.copy(f.quaternion); one.scale.copy(f.scale);
  f.parent.add(one); one.updateMatrixWorld(true);
  one.bind(f.skeleton, f.bindMatrix);
  for (const m of ms) { m.parent.remove(m); m.geometry.dispose(); }
  return scene;
}

export function shareMaterials(scene) {
  scene.traverse(o => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(canon) : canon(o.material); });
}

export const CHARACTERS = ['Knight', 'Barbarian', 'Mage', 'Ranger', 'Rogue', 'Rogue_Hooded'];
export const PROPS = ['sword_1handed', 'sword_2handed', 'axe_1handed', 'axe_2handed', 'dagger', 'staff', 'wand',
  'bow', 'shield_round', 'shield_square', 'shield_badge', 'spellbook_open'];
export const FOREST = [
  'Tree_1_A', 'Tree_1_B', 'Tree_2_A', 'Tree_2_B', 'Tree_3_A', 'Tree_3_B', 'Tree_4_A', 'Tree_4_B',
  'Tree_Bare_1_A', 'Tree_Bare_2_A', 'Bush_1_A', 'Bush_2_A', 'Bush_3_A', 'Bush_4_A',
  'Rock_1_A', 'Rock_1_E', 'Rock_2_A', 'Rock_3_A', 'Rock_3_F', 'Grass_1_A', 'Grass_2_A',
];

/** Loads every model + animation clip the game uses. Returns plain lookup tables. */
export async function loadAssets({ base = '', props = PROPS, forest = FOREST, chars = CHARACTERS, anims = true, onProgress } = {}) {
  const a = { chars: {}, props: {}, forest: {}, clips: {} };
  const jobs = [];
  let done = 0;
  const track = p => { jobs.push(p.then(() => onProgress?.(++done, jobs.length))); };
  for (const n of chars) track(load(`${base}assets/chars/${n}.glb`).then(g => a.chars[n] = mergeCharacter(g.scene)));
  for (const n of props) track(load(`${base}assets/props/${n}.gltf`).then(g => a.props[n] = g.scene));
  for (const n of forest) track(load(`${base}assets/forest/${n}_Color1.gltf`).then(g => a.forest[n] = g.scene));
  if (anims) for (const f of ['General', 'MovementBasic'])
    track(load(`${base}assets/anim/Rig_Medium_${f}.glb`).then(g => g.animations.forEach(c => a.clips[c.name] = c)));
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
