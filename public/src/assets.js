import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Each .gltf gets its own parser, so without this every model file would download, decode and upload its
// own copy of the pack texture (the KayKit packs share one atlas per pack across dozens of files).
THREE.Cache.enabled = true;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const load = (url) => loader.loadAsync(url).then(g => { shareMaterials(g.scene); return g; });

/** A copy of geometry with every attribute as plain floats (meshopt packs store quantized integers). */
function floatGeometry(src) {
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(src.attributes)) {
    if (a.array instanceof Float32Array && !a.isInterleavedBufferAttribute) { g.setAttribute(k, a.clone()); continue; }
    const n = a.count, s = a.itemSize, out = new Float32Array(n * s), get = [a.getX, a.getY, a.getZ, a.getW];
    for (let i = 0; i < n; i++) for (let j = 0; j < s; j++) out[i * s + j] = get[j].call(a, i); // getX… undo normalization
    g.setAttribute(k, new THREE.BufferAttribute(out, s));
  }
  if (src.index) g.setIndex(src.index.clone());
  for (const grp of src.groups) g.addGroup(grp.start, grp.count, grp.materialIndex);
  return g;
}

/**
 * One packed asset folder (scripts/pack-assets.mjs): a single GLB whose top-level "@name" nodes are the
 * original files. Returns { name: Group } shaped like the per-file scenes (meshes with their transforms
 * baked into float geometry, so code that instances a mesh's geometry directly sees the same data),
 * or null when the pack is missing (callers then load the per-file originals).
 */
export async function loadPack(url) {
  let g;
  try { g = await load(url); } catch { return null; }
  const out = {}, m = new THREE.Matrix4(), inv = new THREE.Matrix4();
  g.scene.updateMatrixWorld(true);
  for (const w of g.scene.children) {
    if (!w.name.startsWith('@')) continue;
    const grp = new THREE.Group(); grp.name = w.name.slice(1);
    inv.copy(w.matrixWorld).invert();
    w.traverse(o => {
      if (!o.isMesh) return;
      const mesh = new THREE.Mesh(floatGeometry(o.geometry).applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld)), o.material);
      mesh.name = o.name; grp.add(mesh);
    });
    out[grp.name] = grp;
  }
  out.__animations = g.animations;
  return out;
}

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
  // meshopt-compressed copies (scripts/pack-assets.mjs) with the originals as the fallback
  for (const n of chars) track(load(`${base}assets/packs/chars/${n}.glb`).catch(() => load(`${base}assets/chars/${n}.glb`)).then(g => a.chars[n] = mergeCharacter(g.scene)));
  // packed folders (one request each); the per-file originals are the fallback
  const pick = async (pack, names, file, into) => {
    const P = names.length ? await loadPack(`${base}assets/packs/${pack}.glb`) : null;
    await Promise.all(names.map(n => P?.[file(n)] ? (into[n] = P[file(n)]) : load(`${base}assets/${pack}/${file(n)}.gltf`).then(g => { into[n] = g.scene; })));
  };
  track(pick('props', props, n => n, a.props));
  track(pick('forest', forest, n => `${n}_Color1`, a.forest));
  if (anims) track(loadPack(`${base}assets/packs/clips.glb`).then(async P => {
    const list = P ? P.__animations : (await Promise.all(['General', 'MovementBasic'].map(f => load(`${base}assets/anim/Rig_Medium_${f}.glb`)))).flatMap(g => g.animations);
    list.forEach(c => a.clips[c.name] = c);
  }));
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
