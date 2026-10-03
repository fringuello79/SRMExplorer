// SRM Explorer · Magliano centro — bozza del paese esplorabile (branch modellazione_centro)
// Scena a scala reale (1 unita' = 1 m) costruita da dati attendibili: impronte degli edifici, strade,
// aree pedonali, filari e punti notevoli da OpenStreetMap; quote dal terreno dell'Explorer (griglia 5 m);
// Municipio = modello Meshy di Ale posato sull'impronta OSM; tigli = modello di Ale. Lino cammina con le frecce.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const VER = 'c1';
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ELEV_A = 0.8948, ELEV_B = 726.2;         // quota reale = a*y + b (come nell'Explorer)
const LINO_H = 1.8;                             // Lino a scala reale (nel paese)

let renderer, scene, camera, sun, DATA, DEM, lino = null, mixer = null, ACT = {}, clock = new THREE.Clock();
const VENTO = [];
const EDIFICI = [];                             // { mesh, poly, c, nome, tipo, lv, h }
const STRADE = [];                              // { p, nome, tipo }
let MUNI = null, FINISH = null;
const ST = { x: -1588, z: 4875, yaw: -0.8, v: 0, run: false, keys: {}, joy: [0, 0] };
const CAM = { yaw: 0, pit: 0.28, dist: 7.5, drag: false, pid: null, px: 0, py: 0, idle: 9 };

// ---------- quote ----------
function demAt(x, z){
  const D = DEM, fx = (x - D.X0) / D.D, fz = (z - D.Z0) / D.D;
  const i = clamp(Math.floor(fx), 0, D.N - 2), j = clamp(Math.floor(fz), 0, D.N - 2);
  const tx = clamp(fx - i, 0, 1), tz = clamp(fz - j, 0, 1);
  const h = D.h, a = h[j * D.N + i], b = h[j * D.N + i + 1], c = h[(j + 1) * D.N + i], d = h[(j + 1) * D.N + i + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}
// ---------- utilita' geometriche ----------
function areaSegno(p){ let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q[0] * r[1] - r[0] * q[1]; } return a / 2; }
function dentro(p, x, z){ let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const xi = p[i][0], zi = p[i][1], xj = p[j][0], zj = p[j][1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
function centro(p){ let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length]; }
function hash(n){ let h = (n * 2654435761) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; return (h >>> 0) / 4294967295; }

// ---------- texture procedurali ----------
function texMuro(seme){
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256; const g = cv.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
  // intonaco: grana leggera
  for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(0,0,0,${0.02 + 0.04 * Math.random()})`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
  // una finestra per tessera (tessera = 3,6 m x 3,2 m): cornice chiara, vetro scuro, persiane
  const w = 72, h = 110, x0 = 128 - w / 2, y0 = 64;
  g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(x0 - 10, y0 - 8, w + 20, h + 16);
  g.fillStyle = '#e9e4d6'; g.fillRect(x0 - 8, y0 - 6, w + 16, h + 12);
  g.fillStyle = '#2b3540'; g.fillRect(x0, y0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x0 + 6, y0 + 6, w / 2 - 9, h / 2 - 9); g.fillRect(x0 + w / 2 + 3, y0 + h / 2 + 3, w / 2 - 9, h / 2 - 9);
  g.fillStyle = '#d7d2c3'; g.fillRect(x0 + w / 2 - 2, y0, 4, h); g.fillRect(x0, y0 + h / 2 - 2, w, 4);
  // persiane (meta' delle case le hanno)
  if (seme > 0.5) { g.fillStyle = '#6b7a4a'; g.fillRect(x0 - 26, y0 - 2, 20, h + 4); g.fillRect(x0 + w + 6, y0 - 2, 20, h + 4); g.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = y0 + 4; y < y0 + h; y += 8) { g.fillRect(x0 - 24, y, 16, 2); g.fillRect(x0 + w + 8, y, 16, 2); } }
  // davanzale
  g.fillStyle = '#efece3'; g.fillRect(x0 - 12, y0 + h + 6, w + 24, 7); g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x0 - 12, y0 + h + 13, w + 24, 4);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function texPianoTerra(){
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256; const g = cv.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(0,0,0,${0.02 + 0.04 * Math.random()})`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
  // zoccolatura in pietra
  g.fillStyle = '#b9b2a3'; g.fillRect(0, 226, 256, 30); g.fillStyle = 'rgba(0,0,0,0.12)'; for (let x = 0; x < 256; x += 32) g.fillRect(x, 226, 2, 30);
  // portone ad arco
  g.fillStyle = '#e9e4d6'; g.fillRect(84, 60, 88, 170); g.fillStyle = '#4a3522'; g.fillRect(92, 70, 72, 156); g.beginPath(); g.arc(128, 70, 36, Math.PI, 0); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(96, 90, 30, 130); g.fillStyle = '#b08a3c'; g.fillRect(150, 150, 5, 5);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function texTegole(){
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128; const g = cv.getContext('2d');
  g.fillStyle = '#9c5a3c'; g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 16) for (let x = 0; x < 128; x += 16) { g.fillStyle = `hsl(${14 + Math.random() * 10},${45 + Math.random() * 15}%,${36 + Math.random() * 12}%)`; g.fillRect(x + (y / 16 % 2) * 8, y, 15, 14); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + (y / 16 % 2) * 8, y + 12, 15, 3); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function texPorfido(){
  // cubetti di porfido come davanti al Municipio: tessera 2 m
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256; const g = cv.getContext('2d');
  g.fillStyle = '#7d7268'; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 16) for (let x = 0; x < 256; x += 16) { g.fillStyle = `hsl(${20 + Math.random() * 20},${8 + Math.random() * 12}%,${40 + Math.random() * 18}%)`; g.fillRect(x + 1, y + 1, 14, 14); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function texAsfalto(){
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128; const g = cv.getContext('2d');
  g.fillStyle = '#5e5f5c'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 255 : 0},0.05)`; g.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
function texPrato(){
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256; const g = cv.getContext('2d');
  g.fillStyle = '#8f9a6a'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) { g.fillStyle = `hsl(${70 + Math.random() * 40},${25 + Math.random() * 25}%,${32 + Math.random() * 22}%)`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 3); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

// ---------- scena ----------
function buildStage(){
  renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  scene = new THREE.Scene(); scene.background = new THREE.Color('#bcd4e6'); scene.fog = new THREE.Fog('#bcd4e6', 350, 900);
  camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.2, 2000);
  const hemi = new THREE.HemisphereLight('#dbe7f3', '#6b6a55', 0.9); scene.add(hemi);
  sun = new THREE.DirectionalLight('#fff3df', 2.0); sun.position.set(-120, 180, 90); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); const sk = sun.shadow.camera; sk.left = -140; sk.right = 140; sk.top = 140; sk.bottom = -140; sk.near = 20; sk.far = 600; sk.updateProjectionMatrix();
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.3; scene.add(sun); scene.add(sun.target);
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
}
function buildTerreno(){
  const D = DEM, N = D.N;
  const g = new THREE.PlaneGeometry((N - 1) * D.D, (N - 1) * D.D, N - 1, N - 1);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position');
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = j * N + i; pos.setXYZ(k, D.X0 + i * D.D, D.h[k], D.Z0 + j * D.D); }
  g.computeVertexNormals();
  const uv = g.getAttribute('uv'); for (let k = 0; k < uv.count; k++) uv.setXY(k, pos.getX(k) / 6, pos.getZ(k) / 6);
  // nel centro abitato il suolo fra le case e' asfalto/pavimentazione, non prato: si sfuma dal grigio
  // (entro 170 m dal Municipio) al prato (oltre 280 m); le aree verdi OSM restano verdi sopra
  const urb = new Float32Array(N * N); const C = DATA.centro;
  for (let k = 0; k < N * N; k++) { const d = Math.hypot(pos.getX(k) - C[0], pos.getZ(k) - C[1]); urb[k] = 1 - clamp((d - 170) / 110, 0, 1); }
  g.setAttribute('urb', new THREE.BufferAttribute(urb, 1));
  const m = new THREE.MeshStandardMaterial({ map: texPrato(), roughness: 1, metalness: 0 });
  const asf = texAsfalto();
  m.onBeforeCompile = sh => {
    sh.uniforms.tAsf = { value: asf };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float urb; varying float vUrb;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvUrb = urb;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tAsf; varying float vUrb;')
      .replace('#include <map_fragment>', `#include <map_fragment>
{ vec4 a = texture2D(tAsf, vMapUv * 2.0); a.rgb *= vec3(1.08, 1.06, 1.0); diffuseColor.rgb = mix(diffuseColor.rgb, a.rgb, vUrb); }`);
  };
  const t = new THREE.Mesh(g, m); t.receiveShadow = true; t.name = 'Terreno'; scene.add(t);
}
// nastro piatto che segue il terreno (strade), largo w, con uv lungo l'asse
function nastro(pts, w, y0, mat, nome){
  const P = [], UV = [], I = [];
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1]; const n = Math.hypot(dx, dz) || 1; dx /= n; dz /= n;
    const nx = -dz * w / 2, nz = dx * w / 2;
    if (i > 0) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const x1 = pts[i][0] + nx, z1 = pts[i][1] + nz, x2 = pts[i][0] - nx, z2 = pts[i][1] - nz;
    P.push(x1, demAt(x1, z1) + y0, z1, x2, demAt(x2, z2) + y0, z2); UV.push(0, s / 4, 1, s / 4);
    if (i > 0) { const k = (i - 1) * 2; I.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(I); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.name = nome || 'nastro'; return m;
}
// area poligonale appoggiata al terreno
function areaPoly(poly, y0, mat, nome){
  const pts = poly.map(p => new THREE.Vector2(p[0], p[1]));
  const tri = THREE.ShapeUtils.triangulateShape(pts, []);
  const P = [], UV = [], I = [];
  // suddivisione fine per seguire il terreno: si campiona ogni vertice; le aree sono piccole
  pts.forEach(p => { P.push(p.x, demAt(p.x, p.y) + y0, p.y); UV.push(p.x / 2, p.y / 2); });
  for (const t of tri) I.push(t[0], t[1], t[2]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(I); g.computeVertexNormals();
  // normale verso l'alto
  const n = g.getAttribute('normal'); let up = 0; for (let k = 0; k < n.count; k++) up += n.getY(k); if (up < 0) { const idx = g.getIndex(); for (let k = 0; k < idx.count; k += 3) { const a = idx.getX(k); idx.setX(k, idx.getX(k + 2)); idx.setX(k + 2, a); } g.computeVertexNormals(); }
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.name = nome || 'area'; m.material.side = THREE.DoubleSide; return m;
}
function buildStrade(){
  const asf = new THREE.MeshStandardMaterial({ map: texAsfalto(), roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const ped = new THREE.MeshStandardMaterial({ map: texPorfido(), roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const verde = new THREE.MeshStandardMaterial({ color: '#7f9a5a', roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const park = new THREE.MeshStandardMaterial({ color: '#8a8a86', roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const grp = new THREE.Group(); grp.name = 'Strade';
  for (const s of DATA.strade) {
    if (s.tipo === 'steps' || s.tipo === 'footway' || s.tipo === 'path') { const m = nastro(s.p, s.w, 0.07, ped, s.nome); grp.add(m); }
    else { const m = nastro(s.p, s.w, 0.06, s.tipo === 'pedestrian' ? ped : asf, s.nome); grp.add(m); }
    STRADE.push(s);
  }
  for (const a of DATA.aree) {
    const mat = a.tipo === 'pedonale' || a.tipo === 'piazza' ? ped : a.tipo === 'parcheggio' ? park : verde;
    try { grp.add(areaPoly(a.p, a.tipo === 'verde' ? 0.04 : 0.08, mat, a.nome || a.tipo)); } catch (e) {}
  }
  scene.add(grp);
}
// ---------- edifici: pareti con finestre per piano, tetto a falde basse ----------
let TEX_MURI = [], TEX_PT = null, TEX_TEG = null, TEX_MATTONI = null, TEX_PIETRA = null;
// colori e materiali delle facciate letti dalle foto di Street View (ott. 2025): punto in scena + raggio
const OVERRIDE_COL = [
  { p: [-1541, 4897], r: 14, col: '#ffffff', mattoni: true },   // casa d'angolo in mattoni faccia a vista, lato est di Via S. Maria di Loreto
  { p: [-1590, 4927], r: 12, col: '#e8a27a' },                  // casa color salmone, lato ovest
  { p: [-1552, 4960], r: 12, col: '#f6f3ec' },                  // casa bianca d'angolo del bar (Via Fiume / SS578), balconi
  { p: [-1572, 4958], r: 10, col: '#f3efe4' },                  // edificio basso della macelleria
  { p: [-1614, 4851], r: 12, col: '#e9a06a' }                   // casa arancio con tetto a padiglione, incrocio Via Massa d'Albe
];
function texMattoni(){
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256; const g = cv.getContext('2d');
  g.fillStyle = '#c9c2b4'; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 12) for (let x = -24; x < 256; x += 24) { const ox = (y / 12 % 2) * 12; g.fillStyle = `hsl(${12 + Math.random() * 10},${50 + Math.random() * 15}%,${38 + Math.random() * 10}%)`; g.fillRect(x + ox + 1, y + 1, 22, 10); }
  // finestra con cornice bianca
  g.fillStyle = '#efece4'; g.fillRect(84, 52, 88, 126); g.fillStyle = '#2b3540'; g.fillRect(92, 60, 72, 110); g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(96, 64, 30, 50);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function texPietra(){
  // opus incertum come il muro della piazza del Municipio
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256; const g = cv.getContext('2d');
  g.fillStyle = '#8d8578'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 120; i++) { const x = Math.random() * 256, y = Math.random() * 256, r = 14 + Math.random() * 16; g.fillStyle = `hsl(${30 + Math.random() * 15},${12 + Math.random() * 12}%,${52 + Math.random() * 20}%)`; g.beginPath(); for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; g.lineTo(x + Math.cos(a) * r * (0.7 + Math.random() * 0.5), y + Math.sin(a) * r * (0.7 + Math.random() * 0.5)); } g.closePath(); g.fill(); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const PALETTE = ['#f4efe4', '#efe3c9', '#e9d3a8', '#f1d7c0', '#eadfd6', '#dcd6c8', '#f3e6c0', '#e5c9a2', '#f0e9dc', '#e8c7b4'];
function buildEdifici(){
  TEX_MURI = [texMuro(0.2), texMuro(0.8)]; TEX_PT = texPianoTerra(); TEX_TEG = texTegole(); TEX_MATTONI = texMattoni(); TEX_PIETRA = texPietra();
  const grp = new THREE.Group(); grp.name = 'Edifici';
  const PIANO = 3.2;
  for (const e of DATA.edifici) {
    if (e.tipo === 'municipio') continue;        // modello di Ale
    let poly = e.p.map(p => [p[0], p[1]]); if (poly.length < 3) continue;
    if (areaSegno(poly) < 0) poly.reverse();     // orientazione uniforme
    const A = Math.abs(areaSegno(poly));
    let lv = e.lv; if (!lv) lv = A < 45 ? 1 : A < 170 ? 2 : 3;
    if (e.tipo === 'chiesa') lv = 3.5;
    let H = e.h || lv * PIANO + 0.6;
    const c = centro(poly);
    // quota di base: il punto piu' basso dell'impronta; le pareti scendono 2,5 m sotto per i pendii
    let yb = 1e9; for (const p of poly) yb = Math.min(yb, demAt(p[0], p[1]));
    const seme = hash(e.id);
    const ov = OVERRIDE_COL.find(o => Math.hypot(o.p[0] - c[0], o.p[1] - c[1]) < o.r);
    const col = ov ? ov.col : e.tipo === 'chiesa' ? '#efe8dc' : PALETTE[Math.floor(seme * PALETTE.length)];
    const mattoni = ov && ov.mattoni;
    const matMuro = new THREE.MeshStandardMaterial({ map: mattoni ? TEX_MATTONI : TEX_MURI[seme > 0.5 ? 1 : 0], color: col, roughness: 0.92, metalness: 0 });
    const matPT = new THREE.MeshStandardMaterial({ map: mattoni ? TEX_MATTONI : TEX_PT, color: col, roughness: 0.92, metalness: 0 });
    const P = [], UV = [], I = [], P2 = [], UV2 = [], I2 = [];
    const addQuad = (arrP, arrUV, arrI, ax, az, bx, bz, y0, y1, u0, u1, v0, v1, out) => {
      const b = arrP.length / 3;
      arrP.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az); arrUV.push(u0, v0, u1, v0, u1, v1, u0, v1);
      // normale della faccia (a->b, su): (dz, 0, -dx) ; se non punta verso l'esterno si inverte l'ordine
      const dx = bx - ax, dz = bz - az; const nx = dz, nz = -dx; const mx = (ax + bx) / 2 - c[0], mz = (az + bz) / 2 - c[1];
      if (nx * mx + nz * mz >= 0) arrI.push(b, b + 1, b + 2, b, b + 2, b + 3); else arrI.push(b, b + 2, b + 1, b, b + 3, b + 2);
    };
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.3) continue;
      const nWin = Math.max(1, Math.round(L / 3.6));
      // piano terra (zoccolo + portone): da -2,5 a +PIANO
      addQuad(P2, UV2, I2, a[0], a[1], b[0], b[1], yb - 2.5, yb + PIANO, 0, nWin, -2.5 / PIANO, 1, true);
      // piani superiori
      if (H > PIANO) addQuad(P, UV, I, a[0], a[1], b[0], b[1], yb + PIANO, yb + H, 0, nWin, 0, (H - PIANO) / PIANO, true);
    }
    const mk = (Pa, UVa, Ia, mat) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(Pa, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UVa, 2)); g.setIndex(Ia); g.computeVertexNormals(); const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; return m; };
    const gE = new THREE.Group(); gE.name = 'Ed_' + e.id;
    gE.add(mk(P2, UV2, I2, matPT)); if (P.length) gE.add(mk(P, UV, I, matMuro));
    // tetto: cappello di tegole leggermente sporgente, con un colmo basso (tetto a padiglione semplificato:
    // un prisma sulla direzione principale)
    const shape = new THREE.Shape(poly.map(p => new THREE.Vector2(p[0], p[1])));
    const gT = new THREE.ShapeGeometry(shape); gT.rotateX(Math.PI / 2);   // nel piano xz, normale -y: si capovolge
    const pt = gT.getAttribute('position'); for (let k = 0; k < pt.count; k++) pt.setY(k, yb + H + 0.05);
    const uvT = gT.getAttribute('uv'); for (let k = 0; k < uvT.count; k++) uvT.setXY(k, pt.getX(k) / 1.2, pt.getZ(k) / 1.2);
    gT.computeVertexNormals();
    const tetto = new THREE.Mesh(gT, new THREE.MeshStandardMaterial({ map: TEX_TEG, roughness: 1, side: THREE.DoubleSide })); tetto.castShadow = true; tetto.receiveShadow = true;
    gE.add(tetto);
    // cornicione
    const corn = new THREE.Mesh(gT.clone(), new THREE.MeshStandardMaterial({ color: '#d9d2c2', roughness: 1, side: THREE.DoubleSide })); corn.position.y = -0.35; corn.scale.set(1, 1, 1); gE.add(corn);
    grp.add(gE);
    EDIFICI.push({ grp: gE, poly, c, nome: e.nome, tipo: e.tipo, lv, h: H, id: e.id, yb });
  }
  scene.add(grp);
}
// ---------- Municipio (modello Meshy di Ale) sull'impronta OSM ----------
async function buildMunicipio(loader){
  const e = DATA.edifici.find(x => x.tipo === 'municipio'); if (!e) return;
  const g = await loadGLB(loader, 'assets/municipio.glb?' + VER);
  g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material) { o.material.roughness = 0.9; o.material.metalness = 0; } } });
  // impronta OSM: rettangolo orientato (angolo 41 gradi, lati 16,3 x 35,3), centro (-1564,1, 4864,7)
  const poly = e.p, c = centro(poly);
  // asse lungo dell'impronta
  let best = null;
  for (let a = 0; a < 180; a += 0.5) { const t = a * Math.PI / 180, cs = Math.cos(t), sn = Math.sin(t); let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9; for (const p of poly) { const u = cs * p[0] - sn * p[1], v = sn * p[0] + cs * p[1]; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); } const ar = (u1 - u0) * (v1 - v0); if (!best || ar < best.ar) best = { ar, a: t, w: u1 - u0, d: v1 - v0 }; }
  // il modello: asse lungo a 24 gradi (misurato), corpo 79,3 (u) x 88,9 (v), alto 30,3; lampioni sul lato della facciata
  const MA = 24 * Math.PI / 180, MU = 79.3, MV = 88.9, MH = 30.3;
  const lati = best.w > best.d ? [best.w, best.d] : [best.d, best.w];           // [lungo, corto]
  const inner = new THREE.Group(); inner.rotation.y = -MA; inner.add(g.scene);     // assi del modello allineati a x/z
  const mid = new THREE.Group();
  // u (corto, profondita') -> lato corto OSM; v (lungo, facciata) -> lato lungo OSM; altezza: gronda ~13,5 m + tetto
  mid.scale.set(lati[1] / MU, 12.5 / MH, lati[0] / MV);   // due piani + cornicione + tetto: ~12,5 m al colmo
  mid.add(inner);
  const outer = new THREE.Group(); outer.name = 'Municipio';
  // orientamento dal lato della facciata (il lato lungo verso Via S. Maria di Loreto): asse lungo del modello (z) lungo il lato
  let bi = 0, bd = 1e9; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; const mm = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; const d = Math.hypot(mm[0] - FINISH_P[0], mm[1] - FINISH_P[1]); if (d < bd) { bd = d; bi = i; } }
  { const a = poly[bi], b = poly[(bi + 1) % poly.length]; outer.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]) + MUNI_FLIP * Math.PI; }
  const y = Math.min(...poly.map(p => demAt(p[0], p[1])));
  outer.position.set(c[0], y + 0.2, c[1]); outer.add(mid); scene.add(outer);
  // frame della facciata: fw = normale uscente della facciata (verso la strada), rt = lungo la facciata
  { let bi = 0, bd = 1e9; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; const d = Math.hypot(m[0] - FINISH_P[0], m[1] - FINISH_P[1]); if (d < bd) { bd = d; bi = i; } }
    const a = poly[bi], b = poly[(bi + 1) % poly.length]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const rt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; let fw = [rt[1], -rt[0]];
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; if ((m[0] + fw[0] - c[0]) * fw[0] + (m[1] + fw[1] - c[1]) * fw[1] < (m[0] - c[0]) * fw[0] + (m[1] - c[1]) * fw[1]) fw = [-fw[0], -fw[1]];
    MUNI = { grp: outer, c, poly, a, b, m, rt, fw, L, y }; }
  EDIFICI.push({ grp: outer, poly: poly.map(p => [p[0], p[1]]), c, nome: 'Palazzo comunale', tipo: 'municipio', lv: 2, h: 12.5, id: e.id, yb: y });
}
let MUNI_FLIP = 1;   // 0/1: facciata verso Via Santa Maria di Loreto (sud-ovest) — si verifica a vista
// ---------- tigli (modello di Ale) sui filari OSM ----------
async function buildAlberi(loader){
  const g = await loadGLB(loader, 'assets/tiglio.glb?' + VER);
  const matChioma = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  matChioma.customProgramCacheKey = () => 'tiglio-c';
  matChioma.onBeforeCompile = sh => {
    sh.uniforms.uT = { value: 0 }; VENTO.push(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uT; varying vec3 vLoc; varying float vHn;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vLoc = (modelMatrix * vec4(position, 1.0)).xyz; vHn = position.y;
{ float fase = modelMatrix[3].x * 0.05 + modelMatrix[3].z * 0.037;
  float sw = sin(uT * 1.5 + fase + position.y * 0.4) * 0.10 + sin(uT * 2.9 + fase * 1.7 + position.x) * 0.04;
  transformed.x += sw * 0.6; transformed.z += sw * 0.35; }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vLoc; varying float vHn;
float hh(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float vn3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hh(i), hh(i + vec3(1, 0, 0)), f.x), mix(hh(i + vec3(0, 1, 0)), hh(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hh(i + vec3(0, 0, 1)), hh(i + vec3(1, 0, 1)), f.x), mix(hh(i + vec3(0, 1, 1)), hh(i + vec3(1, 1, 1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{ // tigli di meta' ottobre (come nelle foto): verde che vira al giallo-oro, piu' in alto e all'esterno
  float n1 = vn3(vLoc * 1.3) * 0.6 + vn3(vLoc * 3.1) * 0.4; float n2 = vn3(vLoc * 9.0);
  vec3 verde = vec3(0.34, 0.46, 0.15) * (0.85 + 0.3 * n2);
  vec3 giallo = vec3(0.86, 0.66, 0.18) * (0.9 + 0.2 * n2);
  float aut = smoothstep(0.35, 0.62, n1 * 0.7 + 0.3 * clamp(vHn * 0.12, 0.0, 1.0));
  diffuseColor.rgb = mix(verde, giallo, aut); }`);
  };
  const matTronco = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 1, metalness: 0 });
  g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.material = /tronco/i.test(o.name) ? matTronco : matChioma; } });
  const grp = new THREE.Group(); grp.name = 'Alberi'; let n = 0;
  const posa = (x, z, k) => { const t = g.scene.clone(true); const s = 0.64 + 0.12 * hash(k); t.scale.set(s * 0.8, s, s * 0.8); t.traverse(o => { if (o.isMesh && !/tronco/i.test(o.name)) o.position.y += 1.6; }); /* tigli del viale: ~8 m, fusto libero ~2,5 m, chioma stretta */ t.rotation.y = hash(k + 7) * Math.PI * 2; t.position.set(x, demAt(x, z), z); grp.add(t); n++; };
  for (const a of DATA.alberi) {
    if (a.p) { posa(a.p[0], a.p[1], n); continue; }
    const f = a.fila; let acc = 0;
    for (let i = 1; i < f.length; i++) {
      const L = Math.hypot(f[i][0] - f[i - 1][0], f[i][1] - f[i - 1][1]);
      for (let s = acc === 0 ? 0 : 7 - acc; s <= L; s += 7) { const t = s / L; posa(f[i - 1][0] + (f[i][0] - f[i - 1][0]) * t, f[i - 1][1] + (f[i][1] - f[i - 1][1]) * t, n); acc = L - s; }
      if (L < 7 - acc) acc += L;
    }
  }
  scene.add(grp); console.log('tigli:', n);
}
// ---------- percorso: tratto in paese + proposta di prolungamento davanti al Municipio ----------
async function buildPercorso(){
  let r; try { r = await (await fetch('../assets/route.json?' + VER)).json(); } catch (e) { console.warn('route.json non raggiungibile'); return; }
  const C = DATA.centro;
  const seg = (i0, i1) => { const p = []; for (let i = i0; i <= i1; i++) p.push([r.x[i], -r.y[i]]); return p; };
  const n = r.x.length; const vicino = i => Math.hypot(r.x[i] - C[0], -r.y[i] - C[1]) < 330;
  let a0 = 0; while (a0 < n && vicino(a0)) a0++;          // tratto iniziale
  let b0 = n - 1; while (b0 >= 0 && vicino(b0)) b0--;     // tratto finale
  // il "gancio" GPS verso l'angolo nord del Municipio si toglie: il tracciato nuovo resta su Via
  // Dalmazia fino all'incrocio con Via Santa Maria di Loreto (come disegnato da Ale)
  const STACCO = [-1557, 4813];
  const piuVicino = (i0, i1) => { let bi = i0, bd = 1e9; for (let i = i0; i <= i1; i++) { const d = Math.hypot(r.x[i] - STACCO[0], -r.y[i] - STACCO[1]); if (d < bd) { bd = d; bi = i; } } return bi; };
  const ia = piuVicino(0, a0), ib = piuVicino(b0, n - 1);
  const matR = new THREE.MeshStandardMaterial({ color: '#f2a900', roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const matP = new THREE.MeshStandardMaterial({ color: '#ff5a1f', roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const grp = new THREE.Group(); grp.name = 'Percorso';
  grp.add(nastro(seg(ia, a0), 1.6, 0.12, matR, 'percorso andata'));
  grp.add(nastro(seg(b0, ib), 1.6, 0.12, matR, 'percorso ritorno'));
  // nuovo finale (e, al contrario, nuova partenza): da Via Dalmazia all'incrocio con Via Santa Maria
  // di Loreto, poi a sinistra fino a meta' della facciata del Palazzo comunale
  const stacco = [r.x[ib], -r.y[ib]];
  const ext = [stacco, [-1581, 4844], [-1593, 4861], [-1598, 4868.5], [-1593.5, 4874], FINISH_P];
  grp.add(nastro(ext, 1.6, 0.14, matP, 'nuovo finale'));
  // traguardo: arco sottile e scritta
  const arco = new THREE.Group(); arco.name = 'Traguardo';
  const colMat = new THREE.MeshStandardMaterial({ color: '#f3efe2', roughness: 0.6 });
  const dir = [FINISH_P[0] - ext[3][0], FINISH_P[1] - ext[3][1]]; const dn = Math.hypot(dir[0], dir[1]); const px = -dir[1] / dn, pz = dir[0] / dn;
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.2, 10), colMat); p.position.set(FINISH_P[0] + px * 3 * s, demAt(FINISH_P[0] + px * 3 * s, FINISH_P[1] + pz * 3 * s) + 2.1, FINISH_P[1] + pz * 3 * s); p.castShadow = true; arco.add(p); }
  const trave = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.7, 0.25), new THREE.MeshStandardMaterial({ color: '#f2a900' })); trave.position.set(FINISH_P[0], demAt(FINISH_P[0], FINISH_P[1]) + 4.3, FINISH_P[1]); trave.rotation.y = Math.atan2(px, pz); arco.add(trave);
  grp.add(arco);
  FINISH = FINISH_P;
  scene.add(grp);
}
const FINISH_P = [-1585, 4883];   // davanti alla facciata del Municipio, su Via Santa Maria di Loreto (da confermare)
// cerchio del motivo pavimentale davanti alla scalinata: posizione da confermare con Ale (foto)
// ---------- piazza rialzata del Municipio e arredo urbano (dalle foto) ----------
function distAsse(pt, nome){
  let bd = 1e9;
  for (const st of DATA.strade) { if (st.nome !== nome) continue; const p = st.p; for (let i = 1; i < p.length; i++) { const ax = p[i - 1][0], az = p[i - 1][1], dx = p[i][0] - ax, dz = p[i][1] - az; const L2 = dx * dx + dz * dz || 1; const t = clamp(((pt[0] - ax) * dx + (pt[1] - az) * dz) / L2, 0, 1); bd = Math.min(bd, Math.hypot(ax + dx * t - pt[0], az + dz * t - pt[1])); } }
  return bd;
}
function boxAt(w, h, d, x, y, z, rotY, mat){ const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.y = rotY; m.castShadow = true; m.receiveShadow = true; return m; }
function lampioneTreGlobi(x, z, y0){
  const g = new THREE.Group(); const grigio = new THREE.MeshStandardMaterial({ color: '#3b3f44', roughness: 0.6, metalness: 0.5 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 0.9, 10), grigio); base.position.y = 0.45; g.add(base);
  const palo = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 3.2, 8), grigio); palo.position.y = 2.5; g.add(palo);
  const globo = new THREE.MeshStandardMaterial({ color: '#f4f1e8', emissive: '#f8f3e4', emissiveIntensity: 0.25, roughness: 0.4 });
  const tops = [[0, 4.5, 0], [-0.55, 4.15, 0], [0.55, 4.15, 0]];
  for (const t of tops) { const br = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), grigio); br.position.set(t[0] * 0.6, 3.95, 0); br.rotation.z = -t[0] * 0.9; g.add(br); const s = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), globo); s.position.set(t[0], t[1], t[2]); g.add(s); }
  g.position.set(x, y0, z); g.traverse(o => { if (o.isMesh) o.castShadow = true; }); return g;
}
function fioriera(x, z, y0){
  const g = new THREE.Group();
  const v = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.6, 0.65, 16), new THREE.MeshStandardMaterial({ color: '#b8b0a2', roughness: 1 })); v.position.y = 0.33; g.add(v);
  const c = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 8), new THREE.MeshStandardMaterial({ color: '#5f7a3c', roughness: 1 })); c.position.y = 0.95; c.scale.y = 0.7; g.add(c);
  g.position.set(x, y0, z); g.traverse(o => { if (o.isMesh) o.castShadow = true; }); return g;
}
function dissuasore(x, z, y0){
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.0, 8), new THREE.MeshStandardMaterial({ color: '#2d2f33', roughness: 0.6, metalness: 0.5 })); m.position.set(x, y0 + 0.5, z); m.castShadow = true;
  const t = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), m.material); t.position.set(x, y0 + 1.02, z); const g = new THREE.Group(); g.add(m, t); return g;
}
function buildArredo(){
  if (!MUNI) return;
  const { m, rt, fw, L } = MUNI; const grp = new THREE.Group(); grp.name = 'Arredo';
  const P = (u, v) => [m[0] + rt[0] * u + fw[0] * v, m[1] + rt[1] * u + fw[1] * v];   // u lungo la facciata, v verso la strada
  // profondita' della piazza: dalla facciata all'asse di Via S. Maria di Loreto meno mezza carreggiata e il marciapiede
  const PROF = Math.max(6, distAsse(m, 'Via Santa Maria di Loreto') - 3.4 - 1.6);
  const yS = demAt(...P(0, PROF + 2.5));            // quota della strada davanti
  const H = 1.0, HALF = L / 2 + 2.5;                // piazza rialzata: 1 m, sborda 2,5 m oltre il palazzo
  MUNI.PROF = PROF;
  const yT = yS + H;
  // piano in porfido + muro in pietra sui tre lati
  const ped = new THREE.MeshStandardMaterial({ map: texPorfido(), roughness: 0.9 });
  const pietra = new THREE.MeshStandardMaterial({ map: TEX_PIETRA.clone(), roughness: 1 }); pietra.map.repeat.set(12, 1); pietra.map.needsUpdate = true;
  const ang = Math.atan2(-rt[1], rt[0]);          // BoxGeometry: larghezza lungo rt, profondita' lungo fw
  const cen = P(0, PROF / 2 - 0.5);
  grp.add(boxAt(HALF * 2, H + 1.2, PROF + 1, cen[0], yT - (H + 1.2) / 2 + 0.02, cen[1], ang, pietra));
  const pedTop = ped.clone(); pedTop.map = ped.map.clone(); pedTop.map.repeat.set(HALF, (PROF + 1) / 2); pedTop.map.needsUpdate = true;
  const top = boxAt(HALF * 2, 0.08, PROF + 1, cen[0], yT + 0.02, cen[1], ang, pedTop); grp.add(top);
  // cordolo bianco a filo del muro
  const cb = P(0, PROF + 0.2); grp.add(boxAt(HALF * 2 + 0.4, 0.14, 0.4, cb[0], yT + 0.05, cb[1], ang, new THREE.MeshStandardMaterial({ color: '#e8e3d6', roughness: 0.9 })));
  // scalinata centrale (6 m) e scala d'angolo (2 m) verso Via Dalmazia: 5 gradini
  const scala = (u0, w) => { for (let k = 0; k < 5; k++) { const v = PROF + 0.2 + 0.36 * (4 - k) + 0.18; const q = P(u0, v); grp.add(boxAt(w, 0.2, 0.36, q[0], yS + 0.1 + 0.2 * k, q[1], ang, new THREE.MeshStandardMaterial({ color: '#dcd6c8', roughness: 0.9 }))); } };
  scala(0, 6.5); scala(HALF - 1.6, 2.2);
  // ringhiera in ferro battuto: corrimano + correnti + montanti, lungo il fronte (salvo le scale) e sui fianchi
  const ferro = new THREE.MeshStandardMaterial({ color: '#2b2e33', roughness: 0.5, metalness: 0.6 });
  const tratto = (pA, pB) => { const dx = pB[0] - pA[0], dz = pB[1] - pA[1]; const l = Math.hypot(dx, dz); const a = Math.atan2(dx, dz); const mx = (pA[0] + pB[0]) / 2, mz = (pA[1] + pB[1]) / 2;
    for (const h of [1.0, 0.55, 0.12]) grp.add(boxAt(0.04, 0.04, l, mx, yT + h, mz, a, ferro));
    const n = Math.max(1, Math.round(l / 1.4)); for (let k = 0; k <= n; k++) { const t = k / n; const x = pA[0] + dx * t, z = pA[1] + dz * t; grp.add(boxAt(0.05, 1.0, 0.05, x, yT + 0.5, z, a, ferro)); if (k < n) { const x2 = pA[0] + dx * (t + 0.5 / n), z2 = pA[1] + dz * (t + 0.5 / n); const r = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.015, 6, 14), ferro); r.position.set(x2, yT + 0.78, z2); r.rotation.y = a; grp.add(r); } } };
  const vF = PROF + 0.35;
  tratto(P(-HALF, vF), P(-3.4, vF)); tratto(P(3.4, vF), P(HALF - 2.9, vF));
  tratto(P(-HALF, vF), P(-HALF, 0.5)); tratto(P(HALF, vF), P(HALF, 0.5));
  // lampioni a tre globi ai lati della scalinata, fioriere lungo la ringhiera
  grp.add(lampioneTreGlobi(...P(-4.6, PROF - 1.2), yT), lampioneTreGlobi(...P(4.6, PROF - 1.2), yT));
  for (const u of [-11, -8, 8, 11]) grp.add(fioriera(...P(u, PROF - 1.3), yT));
  // marciapiede in porfido con cordolo lungo la strada davanti e dissuasori all'incrocio
  const pedMp = ped.clone(); pedMp.map = ped.map.clone(); pedMp.map.repeat.set(HALF + 2, 1); pedMp.map.needsUpdate = true;
  const mp = P(0, PROF + 1.6); grp.add(boxAt(HALF * 2 + 4, 0.14, 1.9, mp[0], yS + 0.07, mp[1], ang, pedMp));
  scene.add(grp);
  // fontana circolare bianca di Piazza della Repubblica (dalla foto di Via Fiume) e dissuasori in ghisa
  const fz = [-1534, 4942], yf = demAt(fz[0], fz[1]);
  const bianco = new THREE.MeshStandardMaterial({ color: '#efece6', roughness: 0.7 });
  const vasca = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.3, 0.7, 36), bianco); vasca.position.set(fz[0], yf + 0.35, fz[1]); vasca.castShadow = true; scene.add(vasca);
  const acqua = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.9, 0.08, 36), new THREE.MeshStandardMaterial({ color: '#6fb0d8', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 })); acqua.position.set(fz[0], yf + 0.7, fz[1]); scene.add(acqua);
  const getto = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.25, 1.4, 8), new THREE.MeshStandardMaterial({ color: '#dff2fb', transparent: true, opacity: 0.6 })); getto.position.set(fz[0], yf + 1.4, fz[1]); scene.add(getto);
  for (let k = 0; k < 7; k++) scene.add(dissuasore(-1547 + k * 1.6 * 0.6, 4927 + k * 1.6 * 0.8, demAt(-1547 + k * 0.96, 4927 + k * 1.28)));
  // lampioni con lanterna lungo Via Santa Maria di Loreto (fra i tigli, ogni ~22 m)
  const lan = new THREE.MeshStandardMaterial({ color: '#2d2f33', roughness: 0.6, metalness: 0.5 });
  for (let k = 0; k < 5; k++) { const x = -1596 + k * 10.5, z = 4866 + k * 11.9; const y0 = demAt(x, z); const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 4.5, 8), lan); p.position.set(x - 4.2, y0 + 2.25, z + 3.7); p.castShadow = true; scene.add(p); const l = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.6, 6), new THREE.MeshStandardMaterial({ color: '#f6f0dc', emissive: '#f1e6c0', emissiveIntensity: 0.3 })); l.position.set(x - 4.2, y0 + 4.7, z + 3.7); scene.add(l); }
}
function MUNI_P(u, v){ const { m, rt, fw } = MUNI; return [m[0] + rt[0] * u + fw[0] * v, m[1] + rt[1] * u + fw[1] * v]; }
function buildMotivoPiazza(){
  if (!MUNI) return;
  // davanti al centro della facciata sud-ovest, 9 m fuori dall'impronta
  const poly = MUNI.poly; let bestI = 0, bestD = 1e9;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; const d = Math.hypot(m[0] - FINISH_P[0], m[1] - FINISH_P[1]); if (d < bestD) { bestD = d; bestI = i; } }
  const a = poly[bestI], b = poly[(bestI + 1) % poly.length]; const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const dx = FINISH_P[0] - m[0], dz = FINISH_P[1] - m[1]; const dn = Math.hypot(dx, dz);
  const cx = m[0] + dx / dn * (MUNI.PROF || 9) / 2, cz = m[1] + dz / dn * (MUNI.PROF || 9) / 2;      // a meta' fra la facciata e la scalinata
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.6, 48), new THREE.MeshStandardMaterial({ color: '#b9b0a0', roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  const yq = demAt(...MUNI_P(0, (MUNI.PROF || 9) + 2.5)) + 1.0 + 0.12;
  ring.rotation.x = -Math.PI / 2; ring.position.set(cx, yq, cz); ring.name = 'MotivoCircolare'; scene.add(ring);
  const r2 = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.9, 32), ring.material); r2.rotation.x = -Math.PI / 2; r2.position.set(cx, yq, cz); scene.add(r2);
  // segnaposto dell'incudine
  const inc = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.45), new THREE.MeshStandardMaterial({ color: '#3a3a3a', roughness: 0.5, metalness: 0.6 })); inc.position.set(cx, yq + 0.78, cz); inc.castShadow = true; inc.name = 'Incudine_segnaposto'; scene.add(inc);
  const ceppo = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.6, 12), new THREE.MeshStandardMaterial({ color: '#7a5a3a', roughness: 1 })); ceppo.position.set(cx, yq + 0.18, cz); ceppo.castShadow = true; scene.add(ceppo);
}
// ---------- Lino ----------
async function buildLino(loader){
  // Lino 2 e' l'asset dell'Explorer (cartella assets/ del repository)
  let g = null;
  try { g = await loadGLB(loader, '../assets/lino2.glb?' + VER); } catch (e) { console.warn('lino2.glb non trovato: segnaposto', e); }
  lino = new THREE.Group(); lino.name = 'Lino';
  if (!g) {   // segnaposto: capsula arancione, cosi' si cammina comunque
    const cap = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, LINO_H - 0.6, 6, 12), new THREE.MeshStandardMaterial({ color: '#f2a900' })); cap.position.y = LINO_H / 2; cap.castShadow = true; lino.add(cap); scene.add(lino);
    ST.x = -1596; ST.z = 4871; ST.yaw = Math.atan2(FINISH_P[0] - ST.x, FINISH_P[1] - ST.z); return;
  }
  g.scene.traverse(o => { if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.frustumCulled = false; if (o.material) { o.material.metalness = 0; o.material.roughness = 0.85; } } });
  g.scene.scale.setScalar(LINO_H / 1.7);
  lino.add(g.scene); scene.add(lino);
  if (g.animations && g.animations.length) {
    mixer = new THREE.AnimationMixer(g.scene);
    for (const c of g.animations) { const a = mixer.clipAction(c); a.setLoop(THREE.LoopRepeat, Infinity); a.play(); a.setEffectiveWeight(0); if (/walk/i.test(c.name)) ACT.walk = a; else if (/charge/i.test(c.name)) ACT.charge = a; else ACT.run = a; }
    if (ACT.walk) ACT.walk.setEffectiveWeight(1);
  }
  ST.x = -1596; ST.z = 4871; ST.yaw = Math.atan2(FINISH_P[0] - ST.x, FINISH_P[1] - ST.z);
}
function loadGLB(loader, url){ return new Promise((res, rej) => loader.load(url, res, undefined, () => rej(new Error('Impossibile caricare ' + url)))); }

// ---------- movimento e camera ----------
function setupInput(){
  addEventListener('keydown', e => { ST.keys[e.key] = true; if (e.key === 'Shift') ST.run = true; if (e.key.startsWith('Arrow')) e.preventDefault(); });
  addEventListener('keyup', e => { ST.keys[e.key] = false; if (e.key === 'Shift') ST.run = false; });
  const el = renderer.domElement;
  el.addEventListener('pointerdown', e => { if (CAM.pid !== null) return; CAM.pid = e.pointerId; CAM.px = e.clientX; CAM.py = e.clientY; CAM.drag = false; CAM.t0 = performance.now(); });
  el.addEventListener('pointermove', e => { if (e.pointerId !== CAM.pid) return; const dx = e.clientX - CAM.px, dy = e.clientY - CAM.py; if (!CAM.drag && Math.hypot(dx, dy) > 6) CAM.drag = true; if (CAM.drag) { CAM.yaw -= dx * 0.006; CAM.pit = clamp(CAM.pit + dy * 0.004, -0.05, 1.2); CAM.idle = 0; } CAM.px = e.clientX; CAM.py = e.clientY; });
  const up = e => { if (e.pointerId !== CAM.pid) return; CAM.pid = null; if (!CAM.drag) tocca(e.clientX, e.clientY); CAM.drag = false; CAM.idle = 0; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', () => { CAM.pid = null; CAM.drag = false; });
  el.addEventListener('wheel', e => { CAM.dist = clamp(CAM.dist * Math.exp(e.deltaY * 0.0012), 2.5, 40); }, { passive: true });
  // joystick e pulsante corri (telefono)
  const joy = $('joy'), knob = joy.querySelector('i'); let jid = null;
  const set = e => { const r = joy.getBoundingClientRect(); let x = (e.clientX - r.left - 60) / 50, y = (e.clientY - r.top - 60) / 50; const n = Math.hypot(x, y); if (n > 1) { x /= n; y /= n; } ST.joy = [x, -y]; knob.style.left = 40 + x * 40 + 'px'; knob.style.top = 40 + y * 40 + 'px'; };
  joy.addEventListener('pointerdown', e => { jid = e.pointerId; joy.setPointerCapture(jid); set(e); });
  joy.addEventListener('pointermove', e => { if (e.pointerId === jid) set(e); });
  const fine = e => { if (e.pointerId === jid) { jid = null; ST.joy = [0, 0]; knob.style.left = '40px'; knob.style.top = '40px'; } };
  joy.addEventListener('pointerup', fine); joy.addEventListener('pointercancel', fine);
  const br = $('brun'); br.addEventListener('pointerdown', () => { ST.run = true; }); br.addEventListener('pointerup', () => { ST.run = false; }); br.addEventListener('pointercancel', () => { ST.run = false; });
}
// quota calpestabile: terreno, piu' la piazza rialzata del Municipio (con i gradini della scalinata)
function quotaCamminata(x, z){
  const g = demAt(x, z); if (!MUNI) return g;
  const { m, rt, fw, L } = MUNI; const dx = x - m[0], dz = z - m[1]; const u = dx * rt[0] + dz * rt[1], v = dx * fw[0] + dz * fw[1];
  const HALF = L / 2 + 2.5, PROF = MUNI.PROF || 9; const yS = demAt(...MUNI_P(0, PROF + 2.5));
  if (Math.abs(u) <= HALF && v >= -0.5 && v <= PROF + 0.2) return yS + 1.0;
  if (Math.abs(u) <= 3.25 && v > PROF + 0.2 && v < PROF + 2.2) { const k = Math.floor((PROF + 2.2 - v) / 0.36); return yS + 0.2 * Math.min(5, k + 1); }
  return g;
}
function bloccato(x, z){
  for (const e of EDIFICI) { if (Math.abs(e.c[0] - x) > 45 || Math.abs(e.c[1] - z) > 45) continue; if (dentro(e.poly, x, z)) return e; }
  return null;
}
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
function tocca(cx, cy){
  ptr.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1); ray.setFromCamera(ptr, camera);
  const objs = []; for (const e of EDIFICI) objs.push(e.grp);
  const hit = ray.intersectObjects(objs, true)[0]; if (!hit) return;
  let o = hit.object; while (o && !EDIFICI.find(e => e.grp === o)) o = o.parent;
  const e = EDIFICI.find(x => x.grp === o); if (!e) return;
  const nome = e.tipo === 'municipio' ? 'Palazzo comunale' : e.nome || (e.tipo === 'chiesa' ? 'Chiesa' : 'Edificio');
  $('card-b').innerHTML = '<h2>' + nome + '</h2><p>' + (e.tipo === 'municipio' ? 'Modello Meshy di Ale posato sull’impronta OpenStreetMap (16 × 35 m). Palazzo «Universitas Malleani»: due piani, arcate e portale al piano terra, loggia centrale a tre arcate con balcone, piazza rialzata con ringhiera in ferro battuto, scalinata centrale e lampioni a tre globi.' :
    'Impronta da OpenStreetMap (way ' + e.id + '); ' + (e.lv ? e.lv + (e.lv > 1 ? ' piani' : ' piano') : '') + ', altezza stimata ' + e.h.toFixed(1) + ' m' + (e.nome ? '' : '. Facciata e colore sono provvisori: da sostituire con il rilievo fotografico.')) + '</p>';
  $('card').classList.add('on');
}
function nomeVia(x, z){
  let best = null, bd = 14;
  for (const s of STRADE) { if (!s.nome) continue; const p = s.p; for (let i = 1; i < p.length; i++) { const ax = p[i - 1][0], az = p[i - 1][1], bx = p[i][0], bz = p[i][1]; const dx = bx - ax, dz = bz - az; const L2 = dx * dx + dz * dz || 1; let t = ((x - ax) * dx + (z - az) * dz) / L2; t = clamp(t, 0, 1); const d = Math.hypot(ax + dx * t - x, az + dz * t - z); if (d < bd) { bd = d; best = s.nome; } } }
  return best;
}
let hudT = 0;
function tick(){
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, clock.getDelta());
  if (lino) {
    const kf = (ST.keys.ArrowUp || ST.keys.w ? 1 : 0) - (ST.keys.ArrowDown || ST.keys.s ? 1 : 0) + ST.joy[1];
    const kt = (ST.keys.ArrowRight || ST.keys.d ? 1 : 0) - (ST.keys.ArrowLeft || ST.keys.a ? 1 : 0) + ST.joy[0];
    const vT = clamp(kf, -1, 1) * (ST.run ? 4.6 : 1.5);
    ST.v += clamp(vT - ST.v, -8 * dt, 8 * dt);
    ST.yaw -= clamp(kt, -1, 1) * 2.4 * dt;
    const nx = ST.x + Math.sin(ST.yaw) * ST.v * dt, nz = ST.z + Math.cos(ST.yaw) * ST.v * dt;
    if (!bloccato(nx, nz)) { ST.x = nx; ST.z = nz; } else ST.v = 0;
    const y = quotaCamminata(ST.x, ST.z);
    lino.position.set(ST.x, y, ST.z); lino.rotation.y = ST.yaw - Math.PI / 2;   // il modello guarda verso +x
    if (mixer) {
      const sp = Math.abs(ST.v); const wW = sp < 0.05 ? 0 : clamp(1 - (sp - 1.5) / 1.5, 0, 1), wR = clamp((sp - 1.5) / 1.5, 0, 1);
      const k = 1 - Math.exp(-6 * dt);
      if (ACT.walk) ACT.walk.setEffectiveWeight(THREE.MathUtils.lerp(ACT.walk.getEffectiveWeight(), sp < 0.05 ? 0.0 : wW, k));
      if (ACT.run) ACT.run.setEffectiveWeight(THREE.MathUtils.lerp(ACT.run.getEffectiveWeight(), wR, k));
      if (ACT.charge) ACT.charge.setEffectiveWeight(0);
      mixer.timeScale = sp < 0.05 ? 0.25 : clamp(sp / (wR > 0.5 ? 4.6 : 1.5), 0.6, 1.3);
      mixer.update(dt);
    }
    // camera: dietro a Lino, orbita con il trascinamento, torna dietro quando cammina
    CAM.idle += dt;
    if (!CAM.drag && Math.abs(ST.v) > 0.3 && CAM.idle > 1.5) CAM.yaw -= CAM.yaw * (1 - Math.exp(-0.8 * dt));
    const dir = ST.yaw + Math.PI + CAM.yaw;
    const cx = ST.x + Math.sin(dir) * Math.cos(CAM.pit) * CAM.dist, cz = ST.z + Math.cos(dir) * Math.cos(CAM.pit) * CAM.dist;
    let cy = y + 1.4 + Math.sin(CAM.pit) * CAM.dist; const gc = demAt(cx, cz); if (cy < gc + 0.6) cy = gc + 0.6;
    // se la camera finisce dentro un edificio si avvicina
    const bl = bloccato(cx, cz); const tgt = new THREE.Vector3(cx, cy, cz);
    if (bl) { const d = CAM.dist; for (let f = 0.9; f > 0.15; f -= 0.1) { const x2 = ST.x + (cx - ST.x) * f, z2 = ST.z + (cz - ST.z) * f; if (!bloccato(x2, z2)) { tgt.set(x2, y + 1.4 + Math.sin(CAM.pit) * d * f, z2); break; } } }
    if (!CAM.free) { camera.position.lerp(tgt, 1 - Math.exp(-(CAM.drag ? 14 : 5) * dt)); camera.lookAt(ST.x, y + 1.5, ST.z); }
    sun.position.set(ST.x - 120, y + 180, ST.z + 90); sun.target.position.set(ST.x, y, ST.z); sun.target.updateMatrixWorld();
    if (++hudT % 10 === 0) {
      $('via').textContent = nomeVia(ST.x, ST.z) || 'Magliano de’ Marsi';
      $('q').innerHTML = Math.round(ELEV_A * y + ELEV_B) + ' <small>m</small>';
      $('d').innerHTML = Math.round(Math.hypot(ST.x - DATA.centro[0], ST.z - DATA.centro[1])) + ' <small>m</small>';
    }
  }
  for (const sh of VENTO) sh.uniforms.uT.value = clock.elapsedTime;
  renderer.render(scene, camera);
}
// ---------- avvio ----------
async function main(){
  const prog = (f, t) => { $('lbar').style.width = Math.round(f * 100) + '%'; if (t) $('ltxt').textContent = t; };
  buildStage();
  DATA = await (await fetch('assets/centro.json?' + VER)).json(); DEM = DATA.dem; prog(0.15, 'terreno…');
  buildTerreno(); prog(0.25, 'strade e piazze…');
  buildStrade(); prog(0.35, 'edifici…');
  buildEdifici(); prog(0.55, 'Municipio, tigli, Lino…');
  const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  await Promise.all([buildMunicipio(loader).catch(e => console.warn(e)), buildAlberi(loader).catch(e => console.warn(e)), buildLino(loader).catch(e => console.warn(e))]);
  prog(0.85, 'percorso…');
  await buildPercorso().catch(e => console.warn(e));
  buildArredo(); buildMotivoPiazza();
  setupInput(); prog(1, 'pronto');
  { const y = demAt(ST.x, ST.z); camera.position.set(ST.x - Math.sin(ST.yaw) * 7, y + 3.5, ST.z - Math.cos(ST.yaw) * 7); camera.lookAt(ST.x, y + 1.5, ST.z); }
  setTimeout(() => $('load').classList.add('off'), 300);
  window.CENTRO = { scene, camera, ST, CAM, EDIFICI, demAt, lino: () => lino, muni: () => MUNI, flip: v => { MUNI_FLIP = v; } };
  tick();
}
main().catch(e => { console.error(e); $('ltxt').innerHTML = 'Errore: ' + e.message + (location.protocol === 'file:' ? '<br><br>La pagina va aperta da un server locale, non dal disco:<br>fai doppio clic su <b>centro\\avvia.bat</b> (oppure <i>python -m http.server</i> nella cartella del repository e apri <i>http://localhost:8000/centro/</i>).' : ''); });
if (location.protocol === 'file:') $('ltxt').innerHTML = 'Apri la pagina da un server locale: doppio clic su <b>centro\\avvia.bat</b>.';
