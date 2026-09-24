// SRM Explorer — Skyrace del Maglio 2026
// Percorso 3D navigabile. Dati: export Blender del progetto reel (route.json, scene.glb, lino.glb)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const VER = 'v13';
const $ = id => document.getElementById(id);
const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;

// ---------- stato ----------
const st = {
  s: 60,            // ascissa curvilinea in metri
  sTarget: null,    // teletrasporto dolce (click sul profilo)
  dir: 0, speed: 0, lastDir: 1, hold: 0, view: 'follow', follow: true, ready: false,
  keys: new Set(), lastHudS: -1, curZone: -1, curPoi: -1
};
const VMAX = 175, ACC = 240, VTELE = 3600;
let route, N, TOT, renderer, scene, camera, controls, clock;
let lino, mixer, action, grifTpl, grifs = [], pinGroup;
let elevSamp = [], profCv, profCtx, miniCv, miniCtx, miniPath;
const camTgt = new THREE.Vector3(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(),
      tmpC = new THREE.Vector3(), tmpD = new THREE.Vector3();

// ---------- avvio ----------
function fail(msg){ $('loader').style.display = 'none'; $('err').style.display = 'flex';
  $('errmsg').textContent = msg; }
window.addEventListener('error', e => { if (!st.ready) fail('Errore: ' + (e.message || e.type)); });
const prog = f => { $('load-bar').style.width = Math.round(f * 100) + '%'; };

boot().catch(e => { console.error(e); fail(e.message || String(e)); });

async function boot(){
  if (!window.WebGLRenderingContext) { fail('WebGL non disponibile su questo dispositivo.'); return; }
  $('load-step').textContent = 'dati del percorso…';
  const rr = await fetch('assets/route.json?' + VER);
  if (!rr.ok) throw new Error('route.json non trovato (' + rr.status + ')');
  route = await rr.json();
  N = route.n; TOT = route.total_km * 1000;
  prog(0.06);
  $('load-step').textContent = 'ortofoto e altimetria\u2026';
  await Promise.all([loadOrtho(), loadHeights()]);
  prog(0.12);
  buildStage();
  const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  $('load-step').textContent = 'montagne, sentiero, paesi…';
  const world = await loadGLB(loader, 'assets/scene.glb?' + VER, p => prog(0.06 + 0.58 * p));
  prepWorld(world.scene);
  scene.add(world.scene);
  loadVeg(loader).catch(e => console.warn('vegetazione:', e));
  loader.load('assets/extras.glb?' + VER, g => {
    g.scene.traverse(o => { if (o.isMesh && o.material && o.material.isMeshStandardMaterial) o.material.metalness = 0; });
    scene.add(g.scene);
  }, undefined, () => console.warn('extras assente'));
  $('load-step').textContent = 'Lino…';
  const lg = await loadGLB(loader, 'assets/lino.glb?' + VER, p => prog(0.66 + 0.28 * p));
  prepLino(lg);
  buildPins();
  buildProfile(); buildMinimap(); bindUI();
  const h = location.hash.match(/km=([\d.]+)/);
  if (h) st.s = clamp(parseFloat(h[1]) * 1000, 0, TOT);
  st.ready = true; prog(1);
  $('loader').style.display = 'none';
  try { if (!localStorage.getItem('srmx_help')) { showHelp(); localStorage.setItem('srmx_help', '1'); } }
  catch (e) { /* storage bloccato: pazienza */ }
  window.SRMX = { st, scene: () => scene, route: () => route, vista: setView, terra: groundAt, goto: km => { st.sTarget = clamp(km, 0, route.total_km) * 1000; },
                  poi: i => openPoi(route.pois[i]), gara: showGara, segui: v => setFollow(v, false),
                  anim: () => action ? { t: +action.time.toFixed(3), ts: +mixer.timeScale.toFixed(2),
                                         dur: +action.getClip().duration.toFixed(2) } : null };
  setView('follow');
  clock = new THREE.Clock();
  renderer.setAnimationLoop(tick);
}

function loadGLB(loader, url, onp){
  return new Promise((res, rej) => loader.load(url, res,
    ev => { if (ev.total) onp(ev.loaded / ev.total); },
    () => rej(new Error('Impossibile caricare ' + url))));
}

// ---------- scena ----------
function buildStage(){
  renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(Math.max(320, innerWidth || 1280), Math.max(240, innerHeight || 720));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  scene = new THREE.Scene();
  const cielo = new THREE.Color(0xd9e4ee);
  scene.background = cielo;
  scene.fog = new THREE.Fog(cielo, 2600, 17000);
  camera = new THREE.PerspectiveCamera(55, Math.max(320, innerWidth || 1280) / Math.max(240, innerHeight || 720), 1, 30000);
  camera.position.set(route.x[6], route.z[6] + 60, -route.y[6] + 120);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 14; controls.maxDistance = 4200;
  controls.addEventListener('start', () => setFollow(false, true));
  // luce d'alba, come nel film
  const hemi = new THREE.HemisphereLight(0xffe9cf, 0x2c3a28, 0.95);
  const sun = new THREE.DirectionalLight(0xffc487, 2.0);
  sun.position.set(-0.55, 0.42, -0.72).multiplyScalar(8000);
  const fill = new THREE.DirectionalLight(0xffcf9e, 0.5);
  fill.position.set(0.7, 0.5, 0.6).multiplyScalar(8000);
  scene.add(hemi, sun, fill);
  addEventListener('resize', () => {
    const W = Math.max(320, innerWidth || 1280), H = Math.max(240, innerHeight || 720);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    renderer.setSize(W, H); sizeProfile(); drawProfilePos();
  });
}

function prepWorld(g){
  g.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = true;
    const nm = o.name || '';
    if (nm.startsWith('Terrain')) {
      colorizeTerrain(o);
    } else if (nm.startsWith('SRM_Trail')) {
      colorizeTrail(o);
      o.renderOrder = 1;
    } else if (nm.startsWith('Clouds')) {
      o.material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 });
    } else if (o.material && o.material.isMeshStandardMaterial) {
      o.material.metalness = 0; o.material.roughness = 0.9;
    }
    if (nm.startsWith('Grif_Meshy')) grifTpl = o;
  });
  // grifoni in orbita: cloni del modello, parametri dall'export
  if (grifTpl && route.grif) {
    grifTpl.removeFromParent();
    for (const gdef of route.grif) {
      const m = grifTpl.clone();
      m.userData.g = gdef;
      scene.add(m); grifs.push(m);
    }
  }
}

function prepLino(lg){
  lino = new THREE.Group();
  lino.add(lg.scene);
  scene.add(lino);
  if (lg.animations && lg.animations.length) {
    mixer = new THREE.AnimationMixer(lg.scene);
    const clip = lg.animations.reduce((a, b) => (b.duration > a.duration ? b : a), lg.animations[0]);
    action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
  } else {
    console.warn('lino.glb senza animazioni: resta statico');
  }
}

// ---------- percorso ----------
function posAt(s, out){
  const f = clamp(s, 0, TOT) / TOT * (N - 1);
  const i = Math.min(Math.floor(f), N - 2), t = f - i;
  return out.set(lerp(route.x[i], route.x[i + 1], t),
                 lerp(route.z[i], route.z[i + 1], t),
                -lerp(route.y[i], route.y[i + 1], t));
}
function quotaAt(s){
  const f = clamp(s, 0, TOT) / TOT * (N - 1);
  const i = Math.min(Math.floor(f), N - 2), t = f - i;
  return route.elev_a * lerp(route.z[i], route.z[i + 1], t) + route.elev_b;
}
function tanAt(s, out){
  posAt(Math.min(s + 22, TOT), out); posAt(Math.max(s - 22, 0), tmpD);
  out.sub(tmpD);
  return out.lengthSq() > 1e-6 ? out.normalize() : out.set(1, 0, 0);
}
const zoneAt = km => route.zones.find(z => km >= z[0] && km < z[1]) || route.zones[route.zones.length - 1];
const trailAt = km => (route.trails.find(t => km >= t[0] && km < t[1]) || route.trails[route.trails.length - 1])[2];

// ---------- segnaposto POI ----------
const PIN_COLORS = { start:'#e8e2d0', water:'#58a6d8', gate:'#d84b3f', ristoro:'#9a6bd0',
                     vetta:'#f4951f', vista:'#f4951f', info:'#8d99a6', finish:'#e8e2d0' };
function pinSprite(color){
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.beginPath(); x.arc(128, 104, 64, 0, 7); x.fillStyle = color; x.fill();
  x.lineWidth = 14; x.strokeStyle = '#ffffff'; x.stroke();
  x.beginPath(); x.moveTo(128, 244); x.lineTo(86, 148); x.lineTo(170, 148); x.closePath();
  x.fillStyle = '#ffffff'; x.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return new THREE.SpriteMaterial({ map: tex, depthTest: true, sizeAttenuation: true });
}
function buildPins(){
  pinGroup = new THREE.Group();
  for (const p of route.pois) {
    if (p.tipo === 'start') continue;
    const sp = new THREE.Sprite(pinSprite(PIN_COLORS[p.tipo] || '#ffffff'));
    posAt(p.km * 1000, tmpA);
    sp.position.copy(tmpA); sp.position.y += 16;
    sp.scale.setScalar(17);
    sp.userData.poi = p;
    pinGroup.add(sp);
  }
  scene.add(pinGroup);
  const ray = new THREE.Raycaster(), pt = new THREE.Vector2();
  let downXY = null;
  renderer.domElement.addEventListener('pointerdown', e => { downXY = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!downXY) return;
    const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]); downXY = null;
    if (moved > 7) return;
    pt.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(pt, camera);
    const hit = ray.intersectObjects(pinGroup.children, false)[0];
    if (hit) openPoi(hit.object.userData.poi);
  });
}

// ---------- HUD ----------
function updateHUD(){
  if (Math.abs(st.s - st.lastHudS) < 4 && st.sTarget === null) return;
  st.lastHudS = st.s;
  const km = st.s / 1000;
  $('v-km').textContent = km.toFixed(1).replace('.', ',');
  $('v-q').innerHTML = Math.round(quotaAt(st.s)) + '<span class="unit"> m</span>';
  const z = zoneAt(km), zi = route.zones.indexOf(z);
  if (zi !== st.curZone) { st.curZone = zi; $('zona-n').textContent = z[2]; $('zona-s').textContent = z[3]; }
  const tr = trailAt(km);
  if ($('chip').textContent !== tr) $('chip').textContent = tr;
  let near = -1, best = 200;
  route.pois.forEach((p, i) => {
    const d = Math.abs(p.km * 1000 - st.s);
    if (d < best) { best = d; near = i; }
  });
  if (near !== st.curPoi) {
    st.curPoi = near;
    const b = $('poi-banner');
    if (near >= 0) { $('poi-n').textContent = route.pois[near].nome;
      $('poi-s').textContent = route.pois[near].sub; b.classList.add('on');
      b.onclick = () => openPoi(route.pois[near]);
    } else b.classList.remove('on');
  }
  drawProfilePos(); drawMiniPos();
  if (pinGroup) for (const sp of pinGroup.children) {
    const d = Math.abs(sp.userData.poi.km * 1000 - st.s);
    const o = clamp((d - 40) / 60, 0, 1);
    sp.material.opacity = 0.15 + 0.85 * o;
    sp.material.transparent = true;
  }
}

// ---------- profilo altimetrico ----------
function buildProfile(){
  profCv = $('prof-cv'); profCtx = profCv.getContext('2d');
  elevSamp = [];
  for (let i = 0; i <= 600; i++) elevSamp.push(quotaAt(i / 600 * TOT));
  sizeProfile();
  const go = e => {
    const r = profCv.getBoundingClientRect();
    const km = clamp((e.clientX - r.left - 34) / (r.width - 48), 0, 1) * TOT;
    st.sTarget = km; if (st.view === 'free') setView('follow');
  };
  let drag = false;
  profCv.addEventListener('pointerdown', e => { drag = true; go(e); });
  addEventListener('pointermove', e => { if (drag) go(e); });
  addEventListener('pointerup', () => { drag = false; });
}
let profBase = null;
function sizeProfile(){
  const w = Math.max(360, profCv.clientWidth || innerWidth || 1280);
  profCv.width = w * 2; profCv.height = 192;
  const x = profCtx, W = profCv.width, H = profCv.height, L = 68, R = 28, T = 22, B = 30;
  x.clearRect(0, 0, W, H);
  const emin = 650, emax = 2500;
  const X = i => L + (W - L - R) * i / 600;
  const Y = e => T + (H - T - B) * (1 - (e - emin) / (emax - emin));
  x.beginPath(); x.moveTo(X(0), H - B);
  for (let i = 0; i <= 600; i++) x.lineTo(X(i), Y(elevSamp[i]));
  x.lineTo(X(600), H - B); x.closePath();
  const gr = x.createLinearGradient(0, T, 0, H);
  gr.addColorStop(0, 'rgba(244,149,31,.45)'); gr.addColorStop(1, 'rgba(244,149,31,.06)');
  x.fillStyle = gr; x.fill();
  x.beginPath();
  for (let i = 0; i <= 600; i++) i ? x.lineTo(X(i), Y(elevSamp[i])) : x.moveTo(X(0), Y(elevSamp[0]));
  x.strokeStyle = '#f3efe2'; x.lineWidth = 3; x.stroke();
  x.font = '600 20px Oswald'; x.fillStyle = '#8d99a6'; x.textAlign = 'center';
  for (let k = 0; k <= 25; k += 5) x.fillText(k, X(k / route.total_km * 600), H - 8);
  x.fillText('km', X(290 / 600 * 600) + (W - L - R) * 0.485, H - 8);
  for (const g of route.gates) {
    const gx = X(g[0] / route.total_km * 600);
    x.strokeStyle = 'rgba(216,75,63,.9)'; x.setLineDash([6, 5]); x.lineWidth = 2;
    x.beginPath(); x.moveTo(gx, T); x.lineTo(gx, H - B); x.stroke(); x.setLineDash([]);
    x.fillStyle = '#d84b3f'; x.textAlign = 'center'; x.font = '600 17px Oswald';
    x.fillText(g[2], gx, T - 6);
  }
  for (const p of route.pois) {
    const px = X(p.km / route.total_km * 600), py = Y(quotaAt(p.km * 1000));
    x.beginPath(); x.arc(px, py, 5.5, 0, 7);
    x.fillStyle = PIN_COLORS[p.tipo] || '#fff'; x.fill();
    x.lineWidth = 2; x.strokeStyle = '#0c1f14'; x.stroke();
  }
  x.textAlign = 'left'; x.fillStyle = '#8d99a6'; x.font = '600 18px Oswald';
  x.fillText('2500', 6, Y(2500) + 6); x.fillText('700', 6, Y(700) + 6);
  profBase = x.getImageData(0, 0, W, H);
}
function drawProfilePos(){
  if (!profBase) return;
  const x = profCtx, W = profCv.width, H = profCv.height, L = 68, R = 28, T = 22, B = 30;
  x.putImageData(profBase, 0, 0);
  const i = st.s / TOT * 600;
  const px = L + (W - L - R) * i / 600;
  const py = T + (H - T - B) * (1 - (quotaAt(st.s) - 650) / (2500 - 650));
  x.beginPath(); x.moveTo(px, T); x.lineTo(px, H - B);
  x.strokeStyle = 'rgba(243,239,226,.5)'; x.lineWidth = 2; x.stroke();
  x.beginPath(); x.arc(px, py, 9, 0, 7); x.fillStyle = '#f4951f'; x.fill();
  x.lineWidth = 3; x.strokeStyle = '#fff'; x.stroke();
}

// ---------- minimappa ----------
function buildMinimap(){
  miniCv = $('minimap'); miniCtx = miniCv.getContext('2d');
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let i = 0; i < N; i += 4) {
    x0 = Math.min(x0, route.x[i]); x1 = Math.max(x1, route.x[i]);
    y0 = Math.min(y0, route.y[i]); y1 = Math.max(y1, route.y[i]);
  }
  const span = Math.max(x1 - x0, y1 - y0), pad = 22;
  miniPath = { x0: (x0 + x1) / 2 - span / 2, y0: (y0 + y1) / 2 - span / 2, span, pad };
  drawMiniPos();
}
function miniXY(i){
  const m = miniPath, S = miniCv.width - m.pad * 2;
  return [m.pad + (route.x[i] - m.x0) / m.span * S,
          miniCv.height - m.pad - (route.y[i] - m.y0) / m.span * S];
}
function drawMiniPos(){
  if (!miniCtx) return;
  const x = miniCtx;
  x.clearRect(0, 0, miniCv.width, miniCv.height);
  x.beginPath();
  for (let i = 0; i < N; i += 6) { const p = miniXY(i); i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]); }
  x.strokeStyle = 'rgba(243,239,226,.9)'; x.lineWidth = 4; x.lineJoin = 'round'; x.stroke();
  const pi = Math.round(st.s / TOT * (N - 1)), p = miniXY(Math.min(pi, N - 1));
  x.beginPath(); x.arc(p[0], p[1], 9, 0, 7); x.fillStyle = '#f4951f'; x.fill();
  x.lineWidth = 3; x.strokeStyle = '#fff'; x.stroke();
}

// ---------- UI ----------
function setView(v){
  st.view = v; st.follow = (v === 'follow');
  $('b-seg').classList.toggle('on', v === 'follow');
  const bp = $('b-pov'); if (bp) bp.classList.toggle('on', v === 'fpv');
  if (controls) controls.enabled = (v !== 'fpv');
  if (lino) lino.visible = (v !== 'fpv');
}
function setFollow(v, fromUser){ setView(v ? 'follow' : 'free'); }
function hold(btn, dir){
  const on = e => { e.preventDefault(); st.dir = dir; };
  const off = () => { if (st.dir === dir) st.dir = 0; };
  btn.addEventListener('pointerdown', on);
  addEventListener('pointerup', off);
  btn.addEventListener('pointerleave', off);
  btn.addEventListener('pointercancel', off);
}
function bindUI(){
  hold($('b-avt'), 1); hold($('b-ind'), -1);
  $('b-seg').onclick = () => setView('follow');
  const bp = $('b-pov'); if (bp) bp.onclick = () => setView(st.view === 'fpv' ? 'follow' : 'fpv');
  $('b-help').onclick = showHelp;
  $('b-gara').onclick = showGara;
  $('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  const key = (e, down) => {
    const k = e.key;
    if (k === 'ArrowRight' || k === 'd' || k === 'D') { down ? st.keys.add('R') : st.keys.delete('R'); e.preventDefault(); }
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') { down ? st.keys.add('L') : st.keys.delete('L'); e.preventDefault(); }
    else if (k === 'Escape' && down) closeModal();
    st.dir = st.keys.has('R') ? 1 : (st.keys.has('L') ? -1 : 0);
  };
  addEventListener('keydown', e => key(e, true));
  addEventListener('keyup', e => key(e, false));
}
function openCard(html){
  try {
    $('card').innerHTML = html + '<button class="close" id="card-close">CHIUDI</button>';
    $('card-close').onclick = closeModal;
    $('modal').classList.add('on');
  } catch (e) { console.error('openCard:', e); }
}
function closeModal(){ $('modal').classList.remove('on'); }
function openPoi(p){
  openCard('<h2>' + p.nome + '</h2><h3>km ' + p.km.toFixed(1).replace('.', ',') + ' · ' + p.sub + '</h3><p>' + p.card + '</p>');
}
function showHelp(){
  openCard('<h2>Come si esplora</h2><h3>SRM Explorer</h3><ul>' +
    '<li><b>▶ / ◀</b> (o frecce della tastiera): Lino avanza e torna indietro lungo il percorso; tieni premuto per correre.</li>' +
    '<li><b>Trascina</b> con un dito o col mouse per girare intorno a Lino; <b>pizzica</b> o rotella per lo zoom.</li>' +
    '<li><b>SEGUI LINO</b> riaggancia la telecamera dietro di lui.</li>' +
    '<li>Il <b>profilo altimetrico</b> in basso è cliccabile: tocca un punto e Lino ci va.</li>' +
    '<li>Tocca i <b>segnaposto</b> lungo il percorso per le schede dei punti di interesse.</li>' +
    '<li>La barra in alto dice sempre <b>dove sei</b>: zona, km, quota e numero del sentiero.</li></ul>');
}
function showGara(){
  let g = '<h2>Skyrace del Maglio 2026</h2><h3>' + route.race_date + ' · start ore ' + route.start_time + ' · Magliano de\u2019 Marsi</h3>' +
    '<p>29,7 km e oltre 1.900 m di salita sulla rete sentieristica del Parco Naturale Regionale Sirente Velino, fino a quota 2.385 m alle spalle del Monte Velino.</p>' +
    '<table><tr><th>Cancello</th><th>Tempo</th><th>Orario</th></tr>';
  const nomi = ['Passo Le Forche · km 10', 'Capanna di Sevice · km 15', 'Traguardo · km 29,7'];
  route.gates.forEach((x, i) => { g += '<tr><td>' + nomi[i] + '</td><td>' + x[1] + '</td><td>' + x[2] + '</td></tr>'; });
  g += '</table><p style="margin-top:12px">Sentieri percorsi, nell\u2019ordine: ';
  route.trails.forEach(t => { g += '<span class="kchip">' + t[2] + '</span>'; });
  g += '</p><p style="margin-top:10px"><a href="https://www.skyracedelmaglio.it" target="_blank" rel="noopener" style="color:var(--ambra)">www.skyracedelmaglio.it</a></p>';
  openCard(g);
}



// ---------- colori del terreno: quota reale + pendenza ----------
function colorizeTerrain(mesh){
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const A = route.elev_a, B = route.elev_b;
  const cGrass = [0.235, 0.36, 0.16], cMead = [0.42, 0.45, 0.235],
        cRock = [0.56, 0.52, 0.42], cTop = [0.70, 0.68, 0.62];
  for (let i = 0; i < n; i++) {
    const e = A * pos.getY(i) + B;
    let t1 = clamp((e - 950) / 520, 0, 1), t2 = clamp((e - 1680) / 430, 0, 1),
        t3 = clamp((e - 2150) / 300, 0, 1);
    let r = cGrass[0] * (1 - t1) + cMead[0] * t1,
        g2 = cGrass[1] * (1 - t1) + cMead[1] * t1,
        b = cGrass[2] * (1 - t1) + cMead[2] * t1;
    r = r * (1 - t2) + cRock[0] * t2; g2 = g2 * (1 - t2) + cRock[1] * t2; b = b * (1 - t2) + cRock[2] * t2;
    r = r * (1 - t3) + cTop[0] * t3; g2 = g2 * (1 - t3) + cTop[1] * t3; b = b * (1 - t3) + cTop[2] * t3;
    const up = nrm ? Math.abs(nrm.getY(i)) : 1;
    const st2 = clamp((0.86 - up) / 0.55, 0, 1) * 0.45;
    r = r * (1 - st2) + 0.52 * st2; g2 = g2 * (1 - st2) + 0.49 * st2; b = b * (1 - st2) + 0.44 * st2;
    if (ORTHO && orthoColor(pos.getX(i), -pos.getZ(i), OC)) {
      const w = 0.74;
      r = OC[0] * w + r * (1 - w); g2 = OC[1] * w + g2 * (1 - w); b = OC[2] * w + b * (1 - w);
    }
    col[i * 3] = r; col[i * 3 + 1] = g2; col[i * 3 + 2] = b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
}


// ---------- ortofoto, griglia altezze, brecciato ----------
let ORTHO = null, HG = null;
const OC = [0, 0, 0];
async function loadOrtho(){
  try {
    const j = await (await fetch('assets/ortho.json?' + VER)).json();
    const img = new Image();
    img.src = 'assets/ortho.jpg?' + VER;
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('timeout ortho.jpg')), 9000);
      const ok = () => { clearTimeout(t); res(); };
      if (img.complete && img.naturalWidth) return ok();
      img.onload = ok;
      img.onerror = () => { clearTimeout(t); rej(new Error('ortho.jpg illeggibile')); };
    });
    const c = document.createElement('canvas'); c.width = c.height = j.n;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, j.n, j.n);
    ORTHO = Object.assign({}, j, { px: x.getImageData(0, 0, j.n, j.n).data });
    console.log('ortofoto pronta');
  } catch (e) { console.warn('ortho assente:', e.message); }
}
function orthoColor(xb, yb, out){
  const u = (xb - ORTHO.x0) / (ORTHO.x1 - ORTHO.x0);
  const v = (ORTHO.y1 - yb) / (ORTHO.y1 - ORTHO.y0);
  if (u < 0 || v < 0 || u >= 1 || v >= 1) return false;
  const i = (Math.floor(v * (ORTHO.n - 1)) * ORTHO.n + Math.floor(u * (ORTHO.n - 1))) * 4;
  out[0] = Math.pow(ORTHO.px[i] / 255, 2.2);
  out[1] = Math.pow(ORTHO.px[i + 1] / 255, 2.2);
  out[2] = Math.pow(ORTHO.px[i + 2] / 255, 2.2);
  return true;
}
async function loadHeights(){
  try {
    const j = await (await fetch('assets/height.json?' + VER)).json();
    const b = await (await fetch('assets/height.bin?' + VER)).arrayBuffer();
    HG = Object.assign({}, j, { data: new Uint16Array(b) });
  } catch (e) { console.warn('height assente:', e.message); }
}
function groundAt(x, z){
  if (!HG) return -1e4;
  const xb = x, yb = -z;
  const u = (xb - HG.x0) / (HG.x1 - HG.x0) * (HG.nx - 1);
  const v = (yb - HG.y0) / (HG.y1 - HG.y0) * (HG.ny - 1);
  if (u < 0 || v < 0 || u > HG.nx - 1.001 || v > HG.ny - 1.001) return -1e4;
  const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
  const gg = (jj, ii) => HG.data[Math.min(jj, HG.ny - 1) * HG.nx + Math.min(ii, HG.nx - 1)] * HG.scala;
  return gg(j, i) * (1 - fu) * (1 - fv) + gg(j, i + 1) * fu * (1 - fv) +
         gg(j + 1, i) * (1 - fu) * fv + gg(j + 1, i + 1) * fu * fv;
}
function colorizeTrail(mesh){
  const g = mesh.geometry, p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  const orange = [0.907, 0.31, 0.012], brec = [0.44, 0.415, 0.365];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    let best = 1e12, bj = 0;
    for (let j = 0; j < N; j += 3) {
      const dx = route.x[j] - x, dz = -route.y[j] - z;
      const d = dx * dx + dz * dz;
      if (d < best) { best = d; bj = j; }
    }
    const km = bj / (N - 1) * route.total_km;
    const t = clamp((km - 5.72) / 0.16, 0, 1) * clamp((6.68 - km) / 0.16, 0, 1);
    let nz = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    nz = nz - Math.floor(nz);
    const nn = t > 0 ? 0.82 + 0.36 * nz : 1;
    for (let c = 0; c < 3; c++) col[i * 3 + c] = (orange[c] * (1 - t) + brec[c] * t) * nn;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  mesh.material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
}

// ---------- vegetazione e sassi istanziati ----------
async function loadVeg(loader){
  const r = await fetch('assets/veg.json?' + VER);
  if (!r.ok) return;
  const veg = await r.json();
  const pg = await loadGLB(loader, 'assets/protos.glb?' + VER, () => {});
  const lib = {};
  pg.scene.traverse(o => { if (o.isMesh) lib[o.name] = o; });
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(),
        S = new THREE.Vector3(), E = new THREE.Euler();
  for (const key of Object.keys(veg.inst)) {
    const arr = veg.inst[key];
    const proto = lib[veg.protos[key]];
    if (!proto || !arr.length) continue;
    if (proto.material && proto.material.isMeshStandardMaterial) {
      proto.material.metalness = 0; proto.material.roughness = 0.95;
    }
    const im = new THREE.InstancedMesh(proto.geometry, proto.material, arr.length);
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      P.set(t[0], t[2], -t[1]);
      Q.setFromEuler(E.set(0, t[3], 0));
      S.setScalar(t[4] || 1);
      M.compose(P, Q, S);
      im.setMatrixAt(i, M);
    }
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    scene.add(im);
  }
  console.log('vegetazione:', Object.keys(veg.inst).map(k => k + ':' + veg.inst[k].length).join(', '));
}

// ---------- ciclo ----------
let fpsAcc = 0, fpsN = 0, fpsT = 0, degraded = false;
function tick(){
  const dt = Math.min(clock.getDelta(), 0.05);
  // movimento
  if (st.sTarget !== null) {
    const d = st.sTarget - st.s;
    const step = clamp(d, -VTELE * dt, VTELE * dt);
    st.s += step;
    st.speed = Math.abs(step / dt);
    if (Math.abs(d) < 2) { st.sTarget = null; st.speed = 0; }
  } else {
    if (st.dir !== 0) {
      st.hold += dt; st.lastDir = st.dir;
      const vmax = VMAX * (st.hold > 2.2 ? 1.9 : 1);
      st.speed = Math.min(vmax, st.speed + ACC * dt);
    } else { st.hold = 0; st.speed = Math.max(0, st.speed - ACC * 2.4 * dt); }
    st.s = clamp(st.s + (st.dir || st.lastDir || 1) * st.speed * dt, 0, TOT);
  }
  // Lino
  posAt(st.s, tmpA); tanAt(st.s, tmpB);
  lino.position.copy(tmpA);
  const rotY = Math.atan2(-tmpB.z, tmpB.x);
  const pitch = Math.asin(clamp(tmpB.y, -0.75, 0.75)) * 0.55;
  lino.quaternion.setFromEuler(new THREE.Euler(0, rotY, 0));
  lino.rotateZ(pitch);
  if (mixer) { mixer.timeScale = clamp(0.25 + st.speed / 42, 0, 2.6) * (st.speed < 1 ? 0 : 1); mixer.update(dt); }
  // camera
  tanAt(st.s + 8, tmpC);
  if (st.view === 'fpv') {
    tmpD.copy(tmpA).addScaledVector(tmpC, 2.5); tmpD.y += 8.8;
    camera.position.lerp(tmpD, 1 - Math.exp(-14 * dt));
    tmpB.copy(tmpA).addScaledVector(tmpC, 90); tmpB.y += 14;
    camTgt.lerp(tmpB, 1 - Math.exp(-10 * dt));
    camera.lookAt(camTgt);
  } else {
    const qv = quotaAt(st.s);
    const kv = clamp((qv - 1500) / 750, 0, 1);
    camTgt.lerp(tmpB.copy(tmpA).add(tmpD.set(0, 10 + 22 * kv, 0)), 1 - Math.exp(-5 * dt));
    controls.target.copy(camTgt);
    if (st.view === 'follow') {
      tmpD.copy(tmpA).addScaledVector(tmpC, -(80 + 78 * kv)); tmpD.y = tmpA.y + 42 + 88 * kv;
      camera.position.lerp(tmpD, 1 - Math.exp(-2.6 * dt));
    }
    controls.update();
  }
  const gmin = groundAt(camera.position.x, camera.position.z) + 13;
  if (camera.position.y < gmin) camera.position.y = gmin;
  // grifoni
  const tNow = performance.now() / 1000;
  for (const m of grifs) {
    const g = m.userData.g;
    const ph = g.ph0 + g.rate * tNow;
    m.position.set(g.c[0] + g.r * Math.cos(ph), g.c[2] + Math.sin(tNow * 0.6 + g.ph0) * 4, -(g.c[1] + g.r * Math.sin(ph)));
    m.rotation.y = ph + Math.PI / 2 + Math.PI;
  }
  updateHUD();
  renderer.render(scene, camera);
  // guardia prestazioni
  fpsAcc += dt; fpsN++; fpsT += dt;
  if (fpsT > 4 && !degraded) {
    if (fpsN / fpsT < 26) { degraded = true; renderer.setPixelRatio(1); scene.fog.far = 12000; }
    fpsN = 0; fpsT = 0;
  }
}
