// Packs each KayKit asset folder (dozens of small .gltf + .bin + .png files) into one meshopt-compressed
// GLB: public/assets/packs/<folder>.glb. Every source file becomes a top-level node named "@<file>", which
// the loaders split back into the same { name: Object3D } tables the per-file loading produced. The per-file
// originals stay in the repo as the fallback. Also writes assets/packs/clips.glb: the two animation rigs
// with their (unused) meshes stripped.
//   npm run pack          (needs the devDependencies: npm install)
import { readdirSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, dedup, prune, weld, meshopt, unpartition } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const root = join(dirname(fileURLToPath(import.meta.url)), '..'), assets = join(root, 'public/assets');
const PACKS = ['dungeon', 'resources', 'tools', 'forest', 'props'];
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
mkdirSync(join(assets, 'packs'), { recursive: true });
const kb = n => `${(n / 1024).toFixed(0)} KB`;

async function finish(doc, out) {
  await doc.transform(dedup(), prune(), weld(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }), unpartition());
  await io.write(out, doc);
  return statSync(out).size;
}

for (const pack of PACKS) {
  const dir = join(assets, pack), files = readdirSync(dir).filter(f => f.endsWith('.gltf')).sort();
  const doc = await io.read(join(dir, files[0]));
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  const wrap = (sc, name) => { // the file's root nodes under one named node
    const n = doc.createNode('@' + name);
    for (const child of sc.listChildren()) { sc.removeChild(child); n.addChild(child); }
    return n;
  };
  const first = wrap(scene, basename(files[0], '.gltf'));
  scene.addChild(first);
  let raw = 0;
  for (const f of files) raw += statSync(join(dir, f)).size + statSync(join(dir, f.replace('.gltf', '.bin'))).size;
  for (const f of files.slice(1)) {
    const before = new Set(doc.getRoot().listScenes());
    mergeDocuments(doc, await io.read(join(dir, f)));
    for (const sc of doc.getRoot().listScenes()) {
      if (before.has(sc)) continue;
      scene.addChild(wrap(sc, basename(f, '.gltf')));
      sc.dispose();
    }
  }
  // one buffer, one atlas per image (dedup), no stray scenes
  for (const sc of doc.getRoot().listScenes()) if (sc !== scene) sc.dispose();
  const size = await finish(doc, join(assets, 'packs', `${pack}.glb`));
  console.log(`${pack}: ${files.length} files, ${kb(raw)} of meshes (+ textures) → ${kb(size)}`);
}

// characters stay one file each (own texture) but get the same compression; one quantization volume
// for the whole file so all body parts share one transform (they are merged into one mesh at load)
mkdirSync(join(assets, 'packs/chars'), { recursive: true });
for (const f of readdirSync(join(assets, 'chars')).filter(f => f.endsWith('.glb'))) {
  const doc = await io.read(join(assets, 'chars', f));
  await doc.transform(dedup(), prune(), weld(), meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizationVolume: 'scene' }));
  await io.write(join(assets, 'packs/chars', f), doc);
  console.log(`chars/${f}: ${kb(statSync(join(assets, 'chars', f)).size)} → ${kb(statSync(join(assets, 'packs/chars', f)).size)}`);
}

// animation clips without the 6-mesh bodies that ship in the rig files
{
  const doc = await io.read(join(assets, 'anim/Rig_Medium_General.glb'));
  const bones = new Map(doc.getRoot().listNodes().map(n => [n.getName(), n]));
  mergeDocuments(doc, await io.read(join(assets, 'anim/Rig_Medium_MovementBasic.glb')));
  // both rigs have the same skeleton: point the second file's clips at the first file's bones, or the
  // loader would rename the duplicates (lowerarml_1 …) and those clips would animate nothing
  for (const anim of doc.getRoot().listAnimations()) for (const ch of anim.listChannels()) {
    const n = ch.getTargetNode(), same = n && bones.get(n.getName());
    if (same && same !== n) ch.setTargetNode(same);
  }
  const first = doc.getRoot().listScenes()[0];
  for (const sc of doc.getRoot().listScenes()) if (sc !== first) sc.dispose();
  for (const node of doc.getRoot().listNodes()) if (bones.has(node.getName()) && bones.get(node.getName()) !== node) node.dispose(); // the duplicate rig
  for (const node of doc.getRoot().listNodes()) if (node.getMesh()) node.setMesh(null);
  for (const skin of doc.getRoot().listSkins()) skin.dispose();
  const size = await finish(doc, join(assets, 'packs', 'clips.glb'));
  console.log(`clips: ${doc.getRoot().listAnimations().length} animations → ${kb(size)}`);
}
