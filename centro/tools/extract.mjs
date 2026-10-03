import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule(), 'draco3d.encoder': await draco3d.createEncoderModule() });
const [src, dst, pattern] = process.argv.slice(2);
const re = new RegExp(pattern);
const doc = await io.read(src);
const root = doc.getRoot(); const scene = root.listScenes()[0]; for (const sc of root.listScenes().slice(1)) sc.dispose(); root.setDefaultScene(scene); scene.setName('Scene');
const keep = root.listNodes().filter(n => re.test(n.getName()) && n.getMesh());
// reparent kept nodes to the scene root with their world transform baked
for (const n of keep) { const W = n.getWorldMatrix(); const p = n.getParentNode(); if (p) p.removeChild(n); n.setMatrix(W); if (!scene.listChildren().includes(n)) scene.addChild(n); }
for (const n of root.listNodes()) if (!keep.includes(n)) n.dispose();
// recentre: xz centre, y min -> origin
let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
for (const n of keep) { const b = getBounds(n); for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], b.min[i]); max[i] = Math.max(max[i], b.max[i]); } }
const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2, y0 = min[1];
for (const n of keep) { const t = n.getTranslation(); n.setTranslation([t[0] - cx, t[1] - y0, t[2] - cz]); }
await doc.transform(prune(), dedup());
await io.write(dst, doc);
console.log(JSON.stringify({ keep: keep.map(n => n.getName()), size: [max[0]-min[0], max[1]-min[1], max[2]-min[2]].map(v => +v.toFixed(2)), centre: [cx, y0, cz] }));
