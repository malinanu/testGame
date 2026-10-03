// The packed asset GLBs (scripts/pack-assets.mjs) must contain every source model of their folder as an
// "@name" node, or the game silently falls back to loading that model file by file. Reads the GLB's JSON
// chunk directly: no dependencies.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const A = new URL('../public/assets/', import.meta.url).pathname;
const glbJson = file => {
  const b = readFileSync(file);
  assert.equal(b.readUInt32LE(0), 0x46546c67, `${file} is a GLB`);
  const len = b.readUInt32LE(12);
  assert.equal(b.readUInt32LE(16), 0x4e4f534a, 'first chunk is JSON');
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
};
for (const pack of ['dungeon', 'resources', 'tools', 'forest', 'props']) {
  const file = `${A}packs/${pack}.glb`;
  assert.ok(existsSync(file), `${pack}.glb exists (run npm run pack)`);
  const j = glbJson(file), names = new Set((j.nodes || []).map(n => n.name).filter(n => n?.startsWith('@')).map(n => n.slice(1)));
  const want = readdirSync(A + pack).filter(f => f.endsWith('.gltf')).map(f => f.slice(0, -5));
  const missing = want.filter(n => !names.has(n));
  assert.deepEqual(missing, [], `${pack}: every model is in the pack`);
  assert.ok(j.extensionsUsed?.includes('EXT_meshopt_compression'), `${pack} is meshopt-compressed`);
  assert.ok((j.images || []).length <= (pack === 'props' ? 6 : 3), `${pack}: textures de-duplicated (${(j.images || []).length})`);
}
const clips = glbJson(`${A}packs/clips.glb`);
assert.ok(clips.animations.length >= 20 && !(clips.meshes || []).length, 'clips pack: animations only');
console.log('ok asset packs (every model present, meshopt, one atlas per pack, clips without meshes)');
