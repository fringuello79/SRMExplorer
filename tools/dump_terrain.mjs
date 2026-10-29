import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import fs from 'fs';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
// uso: node dump_terrain.mjs assets/scene.glb out_dir  -> ter_pos.f32 / ter_idx.u32 (mesh Terrain di Blender, per build_reality.py)
const [,, glb = 'assets/scene.glb', outDir = '.'] = process.argv;
const doc = await io.read(glb);
for (const n of doc.getRoot().listNodes()) {
  const m = n.getMesh(); if (!m || !/^Terrain/.test(n.getName())) continue;
  console.log(n.getName(), 'T', n.getTranslation(), 'R', n.getRotation(), 'S', n.getScale());
  const p = m.listPrimitives()[0]; const pos = p.getAttribute('POSITION').getArray(); const idx = p.getIndices().getArray();
  fs.writeFileSync(outDir + '/ter_pos.f32', Buffer.from(new Float32Array(pos).buffer));
  fs.writeFileSync(outDir + '/ter_idx.u32', Buffer.from(new Uint32Array(idx).buffer));
  console.log('verts', pos.length/3, 'tris', idx.length/3);
}
