// SRM Explorer — Skyrace del Maglio 2026
// Percorso 3D navigabile. Dati: export Blender del progetto reel (route.json, scene.glb, lino.glb)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const VER = 'v60';

// ---------- nebbia "d'altura": densa nelle valli, aria pulita in cresta ----------
// Si sostituiscono i chunk della nebbia di three prima che qualunque materiale compili:
// la distanza efficace si allunga con la quota media fra camera e punto (fino a x1,8),
// ma oltre fogFar la nebbia e' comunque piena (serve a nascondere i confini del mondo).
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying float vFogDepth;\n varying float vFogY;\n#endif';
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n vFogDepth = - mvPosition.z;\n' +
  ' #ifdef USE_INSTANCING\n  vFogY = ( modelMatrix * instanceMatrix * vec4( position, 1.0 ) ).y;\n' +
  ' #else\n  vFogY = ( modelMatrix * vec4( position, 1.0 ) ).y;\n #endif\n#endif';
THREE.ShaderChunk.fog_pars_fragment = '#ifdef USE_FOG\n uniform vec3 fogColor;\n varying float vFogDepth;\n varying float vFogY;\n' +
  ' #ifdef FOG_EXP2\n  uniform float fogDensity;\n #else\n  uniform float fogNear;\n  uniform float fogFar;\n #endif\n#endif';
THREE.ShaderChunk.fog_fragment = '#ifdef USE_FOG\n' +
  ' float yAvg = 0.5 * ( cameraPosition.y + vFogY );\n' +
  ' float hA = clamp( ( yAvg - 500.0 ) / 1400.0, 0.0, 1.0 );\n' +
  ' float dEff = vFogDepth * mix( 1.0, 0.55, hA );\n' +
  ' #ifdef FOG_EXP2\n  float fogFactor = 1.0 - exp( - fogDensity * fogDensity * dEff * dEff );\n' +
  ' #else\n  float fogFactor = max( smoothstep( fogNear, fogFar, dEff ), smoothstep( fogFar * 0.85, fogFar * 1.1, vFogDepth ) );\n #endif\n' +
  ' gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );\n#endif';
let LOADT0 = 0;
let cumDP = null;
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

window._loaderShow = loaderShow;
function loaderShow(){
  LOADT0 = performance.now();
  const box = $('spinbox'); if (!box) return;
  const img = new Image();
  let timer = null, chipT = null;
  fetch('assets/lino_giro.json?' + VER).then(r => r.ok ? r.json() : null).then(m => {
    if (!m) return;
    img.onload = () => {
      const el = $('spin-img'), W = 240, H = 320;
      el.style.display = 'block';
      el.style.backgroundImage = 'url(' + img.src + ')';
      el.style.backgroundSize = (m.cols * W) + 'px ' + (Math.ceil(m.n / m.cols) * H) + 'px';
      let frame = 0;
      timer = setInterval(() => {
        frame = (frame + 1) % m.n;
        el.style.backgroundPosition = (-(frame % m.cols) * W) + 'px ' + (-Math.floor(frame / m.cols) * H) + 'px';
      }, 80);
      const tags = [
        ['FACCIA DA SINDACO', 'ricorda qualcuno', 0.50, 0.13, 1],
        ['FISICO ATLETICO', 'o quasi', 0.44, 0.40, -1],
        ['SCARPE TECNICHE', 'collaudate sul brecciato', 0.52, 0.90, 1],
        ['MATERIALE OBBLIGATORIO', 'occhio che lo controlliamo', 0.64, 0.56, 1],
        ['GAMBE DA 2.109 M D+', 'garanzia 29,7 km', 0.44, 0.73, -1],
        ['SGUARDO FISSO SUL VELINO', 'o sul primo ristoro?', 0.54, 0.16, -1],
        ['ZAINO LEGGERO', 'con tanta acqua e sali', 0.40, 0.35, 1],
      ];
      let ti = Math.floor(Math.random() * tags.length);
      const chip = $('spin-chip'), svg = $('spin-svg');
      const show = () => {
        const t = tags[ti]; ti = (ti + 1) % tags.length;
        const bw = box.clientWidth, bh = box.clientHeight;
        const ix = bw / 2 - W / 2;
        const ax = ix + t[2] * W, ay = t[3] * H;
        chip.innerHTML = '<b>' + t[0] + '</b><br>' + t[1];
        chip.style.opacity = 0;
        chip.style.left = ''; chip.style.right = '';
        if (t[4] > 0) chip.style.right = '0px'; else chip.style.left = '0px';
        chip.style.top = Math.max(0, Math.min(bh - 64, ay - 26)) + 'px';
        requestAnimationFrame(() => {
          chip.style.opacity = 1;
          const cr = chip.getBoundingClientRect(), br = box.getBoundingClientRect();
          if (br.width < 4) return;
          const cx2 = t[4] > 0 ? (cr.left - br.left - 3) : (cr.right - br.left + 3);
          const cy2 = cr.top - br.top + cr.height / 2;
          svg.setAttribute('viewBox', '0 0 ' + bw + ' ' + bh);
          // la linea si ferma PRIMA di Lino e finisce con una punta di
          // freccia (un po' irregolare) che indica il punto senza coprirlo
          const dx = ax - cx2, dy = ay - cy2, dl = Math.hypot(dx, dy) || 1;
          const G = Math.min(30, dl * 0.4);
          const ux = dx / dl, uy = dy / dl, px = -uy, py = ux;
          const tx = ax - ux * G, ty = ay - uy * G;          // punta
          const ex = tx - ux * 9, ey = ty - uy * 9;          // fine linea
          const p1x = tx - ux * 11.5 + px * 5.2, p1y = ty - uy * 11.5 + py * 5.2;
          const p2x = tx - ux * 8.5 - px * 4.0, p2y = ty - uy * 8.5 - py * 4.0;
          svg.innerHTML = '<line x1="' + cx2 + '" y1="' + cy2 + '" x2="' + ex.toFixed(1) + '" y2="' + ey.toFixed(1) +
            '" stroke="#f4951f" stroke-width="2.2" opacity="0.92"/>' +
            '<polygon points="' + tx.toFixed(1) + ',' + ty.toFixed(1) + ' ' + p1x.toFixed(1) + ',' + p1y.toFixed(1) +
            ' ' + p2x.toFixed(1) + ',' + p2y.toFixed(1) + '" fill="#f4951f" opacity="0.95"/>';
        });
      };
      show();
      chipT = setInterval(show, 2600);
    };
    img.src = 'assets/lino_giro.webp?' + VER;
  }).catch(() => {});
  window._loaderStop = () => {
    if (timer) clearInterval(timer);
    if (chipT) clearInterval(chipT);
  };
}

boot().catch(e => { console.error(e); fail(e.message || String(e)); });

async function boot(){
  if (!window.WebGLRenderingContext) { fail('WebGL non disponibile su questo dispositivo.'); return; }
  $('load-step').textContent = 'dati del percorso…';
  loaderShow();
  const rr = await fetch('assets/route.json?' + VER);
  if (!rr.ok) throw new Error('route.json non trovato (' + rr.status + ')');
  route = await rr.json();
  N = route.n; TOT = route.total_km * 1000;
  cumDP = new Float32Array(N);
  { let acc = 0;
    for (let i = 1; i < N; i++) {
      const dz = route.elev ? (route.elev[i] - route.elev[i - 1]) : (route.z[i] - route.z[i - 1]) * route.elev_a;
      if (dz > 0) acc += dz; cumDP[i] = acc; } }
  prog(0.06);
  $('load-step').textContent = 'ortofoto e altimetria\u2026';
  await Promise.all([loadOrtho(), loadHeights()]);
  prog(0.12);
  buildStage();
  buildSky();
  const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  $('load-step').textContent = 'montagne, sentiero, paesi…';
  const world = await loadGLB(loader, 'assets/scene.glb?' + VER, p => prog(0.06 + 0.58 * p));
  prepWorld(world.scene);
  scene.add(world.scene);
  loadVeg(loader).catch(e => console.warn('vegetazione:', e));
  try {
    const lupoSrc = world.scene.getObjectByName('Lupo_Pratoni');
    if (lupoSrc) {
      const l2 = lupoSrc.clone();
      posAt(21650, tmpA); tanAt(21650, tmpB);
      const distNastro = (x, z) => {
        let dm = 1e9;
        for (let i = 0; i < N; i += 2) {
          const d = Math.hypot(route.x[i] - x, -route.y[i] - z);
          if (d < dm) dm = d;
        }
        return dm;
      };
      let lx = 0, lz = 0, scelto = 0;
      for (const off of [22, -22, 34, -34]) {
        const cx = tmpA.x + tmpB.z * off, cz = tmpA.z - tmpB.x * off;
        if (distNastro(cx, cz) > 13) { lx = cx; lz = cz; scelto = off; break; }
      }
      if (!scelto) { lx = tmpA.x + tmpB.z * 40; lz = tmpA.z - tmpB.x * 40; }
      let ly = groundAt(lx, lz);
      try {
        let terr = null;
        scene.traverse(o => { if (!terr && o.isMesh && (o.name || '').startsWith('Terrain')) terr = o; });
        if (terr) {
          const rc = new THREE.Raycaster(new THREE.Vector3(lx, (ly > -1e3 ? ly : tmpA.y) + 80, lz),
                                         new THREE.Vector3(0, -1, 0), 0, 300);
          const hit = rc.intersectObject(terr, false)[0];
          if (hit) ly = hit.point.y;
        }
      } catch (e) {}
      l2.position.set(lx, ly > -1e3 ? ly + 0.05 : tmpA.y, lz);
      posAt(26300, tmpC);
      const hOld = Math.atan2(-(tmpC.z - lupoSrc.position.z), tmpC.x - lupoSrc.position.x);
      posAt(21650, tmpA);
      const hNew = Math.atan2(-(tmpA.z - lz), tmpA.x - lx);
      l2.rotation.y += (hNew - hOld);
      scene.add(l2);
      poggia(l2);
      // secondo lupo: km 11,8, lato sinistro, poco prima della scarpata
      const l3w = lupoSrc.clone();
      posAt(11800, tmpA); tanAt(11800, tmpB);
      let mx = 0, mz = 0, sc2 = 0;
      for (const off of [18, 26, 34, -18]) {
        const cx = tmpA.x + tmpB.z * off, cz = tmpA.z - tmpB.x * off;
        if (distNastro(cx, cz) > 11) { mx = cx; mz = cz; sc2 = off; break; }
      }
      if (!sc2) { mx = tmpA.x + tmpB.z * 26; mz = tmpA.z - tmpB.x * 26; }
      let ly2 = groundAt(mx, mz);
      try {
        let terr2 = null;
        scene.traverse(o => { if (!terr2 && o.isMesh && (o.name || '').startsWith('Terrain')) terr2 = o; });
        if (terr2) {
          const rc2 = new THREE.Raycaster(new THREE.Vector3(mx, (ly2 > -1e3 ? ly2 : tmpA.y) + 80, mz),
                                          new THREE.Vector3(0, -1, 0), 0, 300);
          const h2 = rc2.intersectObject(terr2, false)[0];
          if (h2) ly2 = h2.point.y;
        }
      } catch (e) {}
      l3w.position.set(mx, ly2 > -1e3 ? ly2 + 0.05 : tmpA.y, mz);
      const hNew2 = Math.atan2(-(tmpA.z - mz), tmpA.x - mx);
      l3w.rotation.y += (hNew2 - hOld);
      scene.add(l3w);
      poggia(l3w);
      // regola poggia: vale anche per i lupi nativi di scene.glb
      ['Lupo_Rozza', 'Lupo_Bosco'].forEach(nm2 => {
        const wn = world.scene.getObjectByName(nm2);
        if (wn) poggia(wn);
      });
      poggia(lupoSrc);
      // suolo VERO campionato lungo tutto il tratto estrapolato (arco -> km 0)
      try {
        const bers = [];
        scene.traverse(o => { if (o.isMesh && (o.name === 'Terrain' || /^Piazza/.test(o.name || ''))) bers.push(o); });
        const ye = [];
        for (let k = 0; k <= 15; k++) {
          posAt(S0_ARCO + k, tmpA);
          const rc0 = new THREE.Raycaster(new THREE.Vector3(tmpA.x, 400, tmpA.z),
                                          new THREE.Vector3(0, -1, 0), 0, 900);
          const h0 = rc0.intersectObjects(bers, false)[0];
          ye.push(h0 ? h0.point.y + 0.05 : null);
        }
        for (let k = 0; k <= 15; k++) if (ye[k] === null) ye[k] = k > 0 ? ye[k - 1] : route.z[0];
        YEXT = ye;
        Y0_ARCO = ye[0];
      } catch (e) { console.warn('quota arco:', e); }
    }
  } catch (e) { console.warn('lupo discesa:', e); }
  loader.load('assets/extras.glb?' + VER, g => {
    // ceppo e incudine ora vivono in maglianoC.glb (magliano_centro.blend):
    // le vecchie copie in extras.glb restano nascoste finche' non lo si rigenera
    const nomiC = ['Ristoro_ceppo', 'Ristoro_incudine_base', 'Ristoro_incudine_vita',
                   'Ristoro_incudine_corpo', 'Ristoro_incudine_corno'];
    g.scene.traverse(o => {
      if (o.isMesh && o.material && o.material.isMeshStandardMaterial) o.material.metalness = 0;
      if (nomiC.includes(o.name)) o.visible = false;
    });
    scene.add(g.scene);
  }, undefined, () => console.warn('extras assente'));
  loader.load('assets/borghi.glb?' + VER, g => {
    g.scene.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        if (o.material && o.material.isMeshStandardMaterial) { o.material.metalness = 0; o.material.roughness = 0.95; }
      }
    });
    scene.add(g.scene);
  }, undefined, () => console.warn('borghi assente'));
  // centro di Magliano curato a mano (magliano_centro.blend -> export_magliano.py)
  loader.load('assets/maglianoC.glb?' + VER, g => {
    g.scene.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        if (o.material && o.material.isMeshStandardMaterial) { o.material.metalness = 0; o.material.roughness = 0.95; }
      }
    });
    scene.add(g.scene);
  }, undefined, () => console.warn('maglianoC assente'));
  $('load-step').textContent = 'Lino…';
  const lg = await loadGLB(loader, 'assets/lino.glb?' + VER, p => prog(0.66 + 0.28 * p));
  prepLino(lg);
  buildPins();
  try { buildDataSassi(); } catch (e) { console.warn('sassi:', e); }
  try { buildNubiBasse(); } catch (e) { console.warn('nubi:', e); }
  try { buildNuvole(); } catch (e) { console.warn('nuvole:', e); }
  try { await document.fonts.load('400 72px Anton'); } catch (e) {}
  buildPeaks();
  buildProfile(); buildMinimap(); bindUI();
  const h = location.hash.match(/km=([\d.]+)/);
  if (h) st.s = clamp(parseFloat(h[1]) * 1000, 0, TOT);
  else st.s = S0_ARCO;
  st.ready = true; prog(1);
  {
    // Lino continua a girare con le targhette finche' non si preme il pulsante
    const chiudi = () => {
      $('loader').style.display = 'none';
      if (window._loaderStop) window._loaderStop();
      try { if (!localStorage.getItem('srmx_help')) { showHelp(); localStorage.setItem('srmx_help', '1'); } }
      catch (e) { /* storage bloccato: pazienza */ }
    };
    $('load-barw').style.display = 'none';
    $('load-step').style.display = 'none';
    const go = $('go-btn');
    go.style.display = 'inline-block';
    go.onclick = chiudi;
  }
  window.SRMX = { st, scene: () => scene, route: () => route, vista: setView, terra: groundAt,
                  y0arco: () => Y0_ARCO, pos: s => { posAt(s, tmpC); return [tmpC.x, tmpC.y, tmpC.z]; }, goto: km => { st.sTarget = clamp(km, 0, route.total_km) * 1000; },
                  poi: i => openPoi(route.pois[i]), gara: showGara, segui: v => setFollow(v, false),
                  anim: () => action ? { t: +action.time.toFixed(3), ts: +mixer.timeScale.toFixed(2),
                                         dur: +action.getClip().duration.toFixed(2) } : null,
                  tracks: () => action ? action.getClip().tracks.map(t => t.name) : [],
                  poseT: tt => {
                    if (!action) return null;
                    action.time = tt; mixer.timeScale = 1; mixer.update(0);
                    scene.updateMatrixWorld(true);
                    const b = scene.getObjectByName('B_an_L');
                    return b ? b.matrixWorld.elements.slice(12, 15).map(v => +v.toFixed(2)) : null;
                  } };
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
  renderer.toneMappingExposure = 1.22;
  scene = new THREE.Scene();
  const cielo = new THREE.Color(0xcfe2f4);
  scene.background = cielo;
  scene.fog = new THREE.Fog(cielo, 2800, 18000);
  camera = new THREE.PerspectiveCamera(55, Math.max(320, innerWidth || 1280) / Math.max(240, innerHeight || 720), 1, 30000);
  camera.position.set(route.x[6], route.z[6] + 60, -route.y[6] + 120);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 14; controls.maxDistance = 4200;
  controls.addEventListener('start', () => setFollow(false, true));
  // luce d'alba, come nel film
  const hemi = new THREE.HemisphereLight(0xf2f7ff, 0x6d755b, 1.05);
  HEMI = hemi;
  sunLight = new THREE.DirectionalLight(0xfff3e0, 2.4);
  sunLight.position.set(-1200, 1450, -1350);
  const fill = new THREE.DirectionalLight(0xffe7c8, 0.32);
  fill.position.set(5600, 4000, 4800);
  scene.add(hemi, sunLight, sunLight.target, fill);
  SHADOWS = !/Android|iPhone|iPad|Mobi/i.test(navigator.userAgent);
  if (SHADOWS) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    const sk = sunLight.shadow.camera;
    sk.left = -430; sk.right = 430; sk.top = 430; sk.bottom = -430;
    sk.near = 150; sk.far = 4500;
    sunLight.shadow.bias = -0.00055;
  }
  addEventListener('resize', () => {
    const W = Math.max(320, innerWidth || 1280), H = Math.max(240, innerHeight || 720);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    renderer.setSize(W, H);
    if (typeof profCv !== 'undefined' && profCv) { sizeProfile(); drawProfilePos(); }
  });
}

function prepWorld(g){
  g.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = true;
    const nm = o.name || '';
    // arco, scritta e municipio ora arrivano da maglianoC.glb (magliano_centro.blend):
    // le copie ancora dentro scene.glb restano nascoste finche' non si rigenera la scena
    if (nm.startsWith('Arch_') || nm === 'ArchTxt' || nm === 'Comune_Meshy') { o.visible = false; return; }
    o.receiveShadow = true;
    if (!nm.startsWith('Terrain') && !nm.startsWith('SRM_Trail')) o.castShadow = true;
    if (nm.startsWith('Terrain')) {
      colorizeTerrain(o);
    } else if (nm.startsWith('SRM_Trail')) {
      colorizeTrail(o);
      o.renderOrder = 1;
    } else if (nm === 'Forest' || nm.startsWith('Forest')) {
      o.visible = false;
    } else if (nm.startsWith('Clouds')) {
      o.visible = false;   // le nuvole piatte dell'export sono sostituite dai cumuli a billboard (buildNuvole)
    } else if (o.material && o.material.isMeshStandardMaterial) {
      o.material.metalness = 0; o.material.roughness = 0.9;
    }
    if (nm.startsWith('Grif_Meshy')) grifTpl = o;
    if (nm === 'Sevice_Meshy') window._hutS = o;
  });
  // copia-ombra del nastro: il nastro e' MeshBasicMaterial (non illuminato,
  // per avere grigio/arancio costanti) e NON puo' ricevere ombre; una copia
  // della stessa geometria con ShadowMaterial mostra SOLO le ombre sopra.
  // Aggiunta DOPO il traverse per non farla riprocessare dal loop.
  if (SHADOWS) {
    const trails = [];
    g.traverse(o => { if (o.isMesh && (o.name || '').startsWith('SRM_Trail')) trails.push(o); });
    for (const t of trails) {
      const smat = new THREE.ShadowMaterial({ opacity: 0.34 });
      // il nastro ha le facce rivolte in giu' (il suo materiale e' DoubleSide):
      // senza DoubleSide il catcher veniva scartato per intero (backface cull)
      smat.side = THREE.DoubleSide;
      smat.depthWrite = false;
      smat.polygonOffset = true; smat.polygonOffsetFactor = -2; smat.polygonOffsetUnits = -2;
      const catcher = new THREE.Mesh(t.geometry, smat);
      catcher.name = 'TrailShadowCatcher';
      catcher.receiveShadow = true; catcher.castShadow = false;
      catcher.renderOrder = 2;
      t.add(catcher);
    }
  }
  // grifoni in orbita: cloni del modello, parametri dall'export
  if (grifTpl && route.grif) {
    grifTpl.removeFromParent();
    for (const gdef of route.grif) {
      const m = grifTpl.clone();
      m.userData.g = gdef;
      scene.add(m); grifs.push(m);
    }
  }
  // Capanna di Sevice: posizionata da Ale direttamente nel master
}

function prepLino(lg){
  lino = new THREE.Group();
  lg.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  lino.add(lg.scene);
  scene.add(lino);
  if (lg.animations && lg.animations.length) {
    mixer = new THREE.AnimationMixer(lg.scene);
    window._linoclips = lg.animations.map(c => [c.name, +c.duration.toFixed(2), c.tracks.length]);
    let best = null;
    for (const c of lg.animations) {
      const a = mixer.clipAction(c);
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.play();
      if (!best || c.tracks.length > best.getClip().tracks.length) best = a;
    }
    action = best;
    console.log('clip Lino:', JSON.stringify(window._linoclips));
  } else {
    console.warn('lino.glb senza animazioni: resta statico');
  }
}

// ---------- percorso ----------
const S0_ARCO = -15.0;   // partenza sotto l'arco: 15 m prima del km 0 lungo la tangente iniziale
let Y0_ARCO = null;      // quota del suolo vero sotto l'arco (raycast al caricamento)
let YEXT = null;         // suolo campionato ogni metro da s=-15 a s=0
function posAt(s, out){
  if (s < 0) {
    const dx = route.x[2] - route.x[0], dy = route.y[2] - route.y[0];
    const L = Math.hypot(dx, dy) || 1;
    let y;
    if (YEXT) {
      const f0 = clamp(s + 15, 0, 15);
      const k0 = Math.min(14, Math.floor(f0));
      const yg = YEXT[k0] + (YEXT[k0 + 1] - YEXT[k0]) * (f0 - k0);
      const t0 = clamp(1 + s / 3.0, 0, 1);      // raccordo al nastro solo negli ultimi 3 m
      y = yg * (1 - t0) + route.z[0] * t0;
    } else {
      const t0 = clamp(1 + s / 15.0, 0, 1);
      const yA = (typeof Y0_ARCO === 'number') ? Y0_ARCO : route.z[0];
      y = yA * (1 - t0) + route.z[0] * t0;
    }
    return out.set(route.x[0] + dx / L * s, y, -(route.y[0] + dy / L * s));
  }
  const f = clamp(s, 0, TOT) / TOT * (N - 1);
  const i = Math.min(Math.floor(f), N - 2), t = f - i;
  return out.set(lerp(route.x[i], route.x[i + 1], t),
                 lerp(route.z[i], route.z[i + 1], t),
                -lerp(route.y[i], route.y[i + 1], t));
}
function quotaAt(s){
  const f = clamp(s, 0, TOT) / TOT * (N - 1);
  const i = Math.min(Math.floor(f), N - 2), t = f - i;
  if (route.elev) return lerp(route.elev[i], route.elev[i + 1], t);   // profilo GPX reale
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
// data di gara coi sassi: tratti continui dentro il rettangolo segnato da Ale
function buildDataSassi(){
  // box guida (dal master): centro scena (-1166, 2683.4), rotz 30 gradi, 34.5 x 9.3 m
  const CX = -1166, CZ = 2683.4 * -1;
  const advX = 0.5, advZ = 0.866;      // senso di lettura (scena (0.5,-0.866) -> three)
  const upX = 0.866, upZ = -0.5;       // "alto" dei glifi, lato opposto al nastro
  const U = 0.7;
  const SEG = {
    '0': [[0,0,2,0],[2,0,2,4],[2,4,0,4],[0,4,0,0]],
    '1': [[1,0,1,4],[0.2,3.1,1,4],[0.3,0,1.7,0]],
    '2': [[0,4,2,4],[2,4,2,2],[2,2,0,2],[0,2,0,0],[0,0,2,0]],
    '6': [[2,4,0,4],[0,4,0,0],[0,0,2,0],[2,0,2,2],[2,2,0,2]],
    '8': [[0,0,2,0],[2,0,2,4],[2,4,0,4],[0,4,0,0],[0,2,2,2]],
    '9': [[2,0,2,4],[2,4,0,4],[0,4,0,2],[0,2,2,2]],
    '-': [[0.2,2,1.8,2]]
  };
  const testo = '18-10-2026';
  const punti = [];   // [a, b] nel piano del box
  const passo = 0.44;
  const tratto = (x1, y1, x2, y2, a0) => {
    const L = Math.hypot(x2 - x1, y2 - y1) * U;
    const n = Math.max(2, Math.round(L / passo) + 1);
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      punti.push([a0 + (x1 + (x2 - x1) * t) * U + (Math.random() - 0.5) * 0.16,
                  (y1 + (y2 - y1) * t) * U - 2 * U + (Math.random() - 0.5) * 0.16]);
    }
  };
  const totU = testo.length * 3 + (testo.length - 1) * 1.2 + 1.2 + 4;
  let a0 = -totU * U / 2;
  for (const ch of testo) {
    for (const s2 of (SEG[ch] || [])) tratto(s2[0], s2[1], s2[2], s2[3], a0);
    a0 += 4.2 * U;
  }
  a0 += 1.2 * U;
  let prev = null;
  for (let t = 0; t <= 1.001; t += 0.055) {
    const ang = t * Math.PI * 2;
    const hx = 16 * Math.pow(Math.sin(ang), 3);
    const hy = 13 * Math.cos(ang) - 5 * Math.cos(2 * ang) - 2 * Math.cos(3 * ang) - Math.cos(4 * ang);
    const px2 = a0 + 2 * U + hx * U / 8.5, py2 = hy * U / 8.5;
    if (prev) {
      const L = Math.hypot(px2 - prev[0], py2 - prev[1]);
      const n = Math.max(1, Math.round(L / passo));
      for (let k = 1; k <= n; k++) {
        const tt = k / n;
        punti.push([prev[0] + (px2 - prev[0]) * tt + (Math.random() - 0.5) * 0.14,
                    prev[1] + (py2 - prev[1]) * tt + (Math.random() - 0.5) * 0.14]);
      }
    }
    prev = [px2, py2];
  }
  const geo = new THREE.DodecahedronGeometry(0.31, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xdbd8cf, roughness: 1, metalness: 0 });
  const im = new THREE.InstancedMesh(geo, mat, punti.length);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3();
  let k2 = 0;
  for (const [a, b] of punti) {
    const wx = CX + advX * a + upX * b;
    const wz = CZ + advZ * a + upZ * b;
    const wy = groundAt(wx, wz);
    Q.setFromEuler(E.set(Math.random() * 0.7, Math.random() * 3.14, Math.random() * 0.7));
    S.setScalar(0.82 + Math.random() * 0.36);
    M.compose(new THREE.Vector3(wx, (wy > -1e3 ? wy : 1548) + 0.16, wz), Q, S);
    im.setMatrixAt(k2++, M);
  }
  im.instanceMatrix.needsUpdate = true;
  im.frustumCulled = false;
  im.castShadow = true;
  im.name = 'DataSassi';
  scene.add(im);
}

// ---------- cumuli a billboard, con deriva lenta e ombra sul terreno ----------
const NNUBI = 14;
const NUBI_U = [];
for (let i = 0; i < NNUBI; i++) NUBI_U.push(new THREE.Vector3(1e6, 1e6, 1));
let TERR_SH = null, NUVOLE = [];
function nuvolaTex(seed){
  const c = document.createElement('canvas'); c.width = 256; c.height = 160;
  const x = c.getContext('2d');
  let sd = seed;
  const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  x.clearRect(0, 0, 256, 160);
  // base piatta e grigia sotto, batuffoli bianchi sopra
  const blobs = 9 + Math.floor(rnd() * 5);
  for (let i = 0; i < blobs; i++) {
    const bx = 40 + rnd() * 176, by = 70 + rnd() * 50, r = 26 + rnd() * 34;
    const g = x.createRadialGradient(bx, by - r * 0.25, r * 0.1, bx, by, r);
    const lum = 0.86 + 0.14 * (1 - (by - 60) / 70);
    g.addColorStop(0, 'rgba(255,255,255,' + (0.95 * lum).toFixed(2) + ')');
    g.addColorStop(0.55, 'rgba(' + [245, 247, 250].map(v => Math.round(v * lum)).join(',') + ',0.72)');
    g.addColorStop(1, 'rgba(225,230,238,0)');
    x.fillStyle = g; x.beginPath(); x.arc(bx, by, r, 0, 7); x.fill();
  }
  // base leggermente ombreggiata
  const gb = x.createLinearGradient(0, 95, 0, 150);
  gb.addColorStop(0, 'rgba(190,200,215,0)'); gb.addColorStop(1, 'rgba(170,180,200,0.35)');
  x.globalCompositeOperation = 'source-atop'; x.fillStyle = gb; x.fillRect(0, 90, 256, 70);
  x.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function buildNuvole(){
  const grp = new THREE.Group(); grp.name = 'Nuvole';
  const texs = [nuvolaTex(11), nuvolaTex(29), nuvolaTex(47)];
  let sd = 20261018;
  const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < NNUBI; i++) {
    // sparse sull'ellisse del mondo, sopra le vette (y scena 2300-2900 = 2780-3320 m reali)
    const ang = rnd() * Math.PI * 2, rr = 0.25 + 0.7 * Math.sqrt(rnd());
    const cx = FC.BC[0] + Math.cos(ang) * FC.BR[0] * rr, cz = FC.BC[1] + Math.sin(ang) * FC.BR[1] * rr;
    const cy = 2650 + rnd() * 550;
    const W = 360 + rnd() * 420;
    const nube = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const m = new THREE.SpriteMaterial({ map: texs[(i + k) % 3], transparent: true, depthWrite: false, fog: true, opacity: 0.92 });
      const sp = new THREE.Sprite(m);
      const w = W * (0.55 + rnd() * 0.5);
      sp.scale.set(w, w * 0.62, 1);
      sp.position.set((rnd() - 0.5) * W * 0.7, (rnd() - 0.5) * 40 + k * 18, (rnd() - 0.5) * W * 0.5);
      nube.add(sp);
    }
    nube.position.set(cx, cy, cz);
    nube.userData = { w: W, v: 1.6 + rnd() * 1.4 };
    grp.add(nube); NUVOLE.push(nube);
    NUBI_U[i].set(cx, cz, W * 0.55);
  }
  scene.add(grp);
}
function tickNuvole(dt){
  // deriva da NO verso SE (vento dominante), rientro dall'altro lato dell'ellisse
  for (let i = 0; i < NUVOLE.length; i++) {
    const n = NUVOLE[i];
    n.position.x += n.userData.v * 0.62 * dt; n.position.z += n.userData.v * 0.78 * dt;
    const ex = (n.position.x - FC.BC[0]) / FC.BR[0], ez = (n.position.z - FC.BC[1]) / FC.BR[1];
    if (ex * ex + ez * ez > 0.95) { n.position.x -= ex * FC.BR[0] * 1.9; n.position.z -= ez * FC.BR[1] * 1.9; }
    NUBI_U[i].set(n.position.x, n.position.z, n.userData.w * 0.55);
    // dentro o troppo vicino a una nuvola: si dissolve (niente lastre tagliate dal piano vicino)
    const dc = n.position.distanceTo(camera.position);
    const op = 0.92 * clamp((dc - n.userData.w * 0.7) / (n.userData.w * 0.8), 0, 1);
    for (const sp of n.children) sp.material.opacity = op;
  }
}
function buildNubiBasse(){
  const g = new THREE.Group(); g.name = 'NubiBasse';
  const geo = new THREE.SphereGeometry(1, 10, 8);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
  let lato = 1;
  for (const km of [16.15, 16.5, 16.85, 17.15, 17.5, 17.8, 18.1]) {
    posAt(km * 1000, tmpA); tanAt(km * 1000, tmpB);
    lato = -lato;
    const off = (36 + Math.random() * 48) * lato;
    const px2 = tmpA.x + tmpB.z * off, pz2 = tmpA.z - tmpB.x * off;
    const gy = groundAt(px2, pz2);
    const nucleo = new THREE.Group();
    for (let p2 = 0; p2 < 4; p2++) {
      const s = new THREE.Mesh(geo, mat);
      s.position.set((Math.random() - 0.5) * 24, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 15);
      s.scale.set(9 + Math.random() * 8, 3.2 + Math.random() * 2.4, 7 + Math.random() * 6);
      nucleo.add(s);
    }
    nucleo.position.set(px2, (gy > -1e3 ? gy : tmpA.y) + 26 + Math.random() * 18, pz2);
    g.add(nucleo);
  }
  scene.add(g);
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
// La barra superiore non deve MAI crescere: se il nome della via eccede,
// si riduce il carattere finche' entra nel tetto di #sent-lab (min 6.5px).
function fitVia() {
  const el = $('sent-lab'), vn = $('via-n');
  if (!vn) return;
  let fs = window.matchMedia('(max-width:700px)').matches ? 10 : 12;
  vn.style.fontSize = fs + 'px';
  while (el.scrollHeight > el.clientHeight + 1 && fs > 6.5) {
    fs -= 0.5;
    vn.style.fontSize = fs + 'px';
  }
}
window.addEventListener('resize', fitVia);

function updateHUD(){
  if (Math.abs(st.s - st.lastHudS) < 4 && st.sTarget === null) return;
  st.lastHudS = st.s;
  const km = Math.max(0, st.s) / 1000;
  $('v-km').textContent = km.toFixed(1).replace('.', ',');
  $('v-q').innerHTML = Math.round(quotaAt(st.s)) + '<span class="unit"> m</span>';
  const sA = Math.max(st.s - 80, 0), sB = Math.min(st.s + 80, TOT);
  const pRaw = (quotaAt(sB) - quotaAt(sA)) / Math.max(sB - sA, 1) * 100;
  st.pend = (st.pend === undefined) ? pRaw : st.pend + (pRaw - st.pend) * 0.35;
  const pShow = Math.round(st.pend);
  $('v-p').innerHTML = (pShow > 0 ? '+' : '') + pShow + '<span class="unit"> %</span>';
  if (cumDP) {
    const gi = Math.min(N - 1, Math.max(0, Math.round(st.s / TOT * (N - 1))));
    $('v-dp').innerHTML = Math.round(cumDP[gi]).toLocaleString('it-IT') + '<span class="unit"> m</span>';
  }
  const gts = route.gates || [];
  const g = gts.find(gg => gg[0] * 1000 > st.s + 2) || gts[gts.length - 1];
  if (g) {
    const ultimo = g === gts[gts.length - 1];
    const rem = Math.max(0, g[0] * 1000 - st.s) / 1000;
    $('g-lab').textContent = ultimo ? 'Tempo max \u00b7 arrivo' : 'Cancello \u00b7 km ' + g[0];
    $('v-g').innerHTML = g[2] + '<span class="unit"> fra ' + rem.toFixed(1).replace('.', ',') + ' km</span>';
  }
  const z = zoneAt(km), zi = route.zones.indexOf(z);
  if (zi !== st.curZone) { st.curZone = zi; $('zona-n').textContent = z[2]; $('zona-s').textContent = z[3]; }
  const rd = (route.roads || []).find(r => r.n && km >= r.a && km < r.b);
  const key = rd ? 'via:' + rd.n : 'tr:' + trailAt(km);
  if (st.curKey !== key) {
    st.curKey = key;
    if (rd) {
      $('chip').style.display = 'none';
      $('sent-lab').style.display = 'block';
      $('sent-lab').innerHTML = '<span id="via-lab">SU STRADA</span>' +
        '<span id="via-n">' + rd.n + '</span>';
      fitVia();
    } else {
      $('chip').style.display = 'flex';
      $('sent-lab').innerHTML = 'SENTIERO';
      $('chip').textContent = trailAt(km);
    }
  }
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
  const i = Math.max(0, st.s) / TOT * 600;
  const px = L + (W - L - R) * i / 600;
  const py = T + (H - T - B) * (1 - (quotaAt(Math.max(0, st.s)) - 650) / (2500 - 650));
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
  if (FLY.on) {
    // il grifone: freccia orientata come la prua
    const m = miniPath, S = miniCv.width - m.pad * 2;
    const gx = m.pad + (FLY.pos.x - m.x0) / m.span * S;
    const gz = miniCv.height - m.pad - (-FLY.pos.z - m.y0) / m.span * S;
    x.save(); x.translate(gx, gz); x.rotate(Math.atan2(Math.sin(FLY.yaw), -Math.cos(FLY.yaw)) + Math.PI / 2);
    x.beginPath(); x.moveTo(0, -13); x.lineTo(9, 10); x.lineTo(0, 5); x.lineTo(-9, 10); x.closePath();
    x.fillStyle = '#f3efe2'; x.fill(); x.lineWidth = 2; x.strokeStyle = '#0c1f14'; x.stroke();
    x.restore();
  }
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
  $('b-grif').onclick = () => { if (FLY.on) flyStop(); else flyStart(); };
  $('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  const key = (e, down) => {
    const k = e.key;
    if (FLY.on) {
      if (k === 'Escape' && down) { closeModal(); flyStop(); return; }
      const K = st.keys;
      const map = { ArrowLeft: 'L', a: 'L', A: 'L', ArrowRight: 'R', d: 'R', D: 'R',
                    ArrowUp: 'U', w: 'U', W: 'U', ArrowDown: 'D', s: 'D', S: 'D', ' ': 'F' };
      const c = map[k];
      if (c) { down ? K.add(c) : K.delete(c); e.preventDefault(); }
      FLY.keyIn = [(K.has('R') ? 1 : 0) - (K.has('L') ? 1 : 0), (K.has('U') ? 1 : 0) - (K.has('D') ? 1 : 0)];
      FLY.flap = K.has('F');
      $('b-flap').classList.toggle('on', FLY.flap);
      return;
    }
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
    '<li>Il <b>profilo altimetrico</b> in basso è cliccabile: tocca un punto e Lino si posizioner\u00e0 su di esso.</li>' +
    '<li>Tocca i <b>segnaposto</b> lungo il percorso per le schede dei punti di interesse.</li>' +
    '<li>La barra in alto dice sempre <b>dove sei</b>: zona, km, quota e numero del sentiero.</li>' +
    '<li><b>GRIFONE</b>: voli libero sopra il Velino. Il grifone plana e perde quota da solo; ' +
    '<b>▲</b> picchia, <b>▼</b> cabra, <b>◀ ▶</b> vira, <b>SPAZIO</b> (o il pulsante) batte le ali per salire. ' +
    'Sul telefono usi il joystick e puoi scegliere di guidarlo <b>inclinando il telefono</b>. ' +
    'Se cabri troppo senza battere le ali va in <b>stallo</b>: picchia per riprendere velocità. ' +
    'Arriva lento e in assetto e <b>atterri</b> con le ali chiuse (tieni premuto BATTI per ripartire); troppo veloce contro il suolo e si riparte dal Cafornia. ' +
    'Cerca i versanti al sole: le <b>ascendenze</b> ti portano su senza fatica, come fanno i grifoni veri.</li></ul>');
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
let DETTEX = null;
function detailTex(){
  if (DETTEX) return DETTEX;
  const S = 256, n2 = S * S;
  let seed = 20260607;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const mk = passes => {
    let cur = new Float32Array(n2);
    for (let i = 0; i < n2; i++) cur[i] = rnd();
    for (let k = 0; k < passes; k++) {
      const nx = new Float32Array(n2);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        nx[y * S + x] = (cur[y * S + x] + cur[y * S + (x + 1) % S] + cur[y * S + (x + S - 1) % S] +
                         cur[((y + 1) % S) * S + x] + cur[((y + S - 1) % S) * S + x]) / 5;
      }
      cur = nx;
    }
    let mn = 1, mx = 0;
    for (let i = 0; i < n2; i++) { if (cur[i] < mn) mn = cur[i]; if (cur[i] > mx) mx = cur[i]; }
    const sc = mx > mn ? 1 / (mx - mn) : 1;
    for (let i = 0; i < n2; i++) cur[i] = (cur[i] - mn) * sc;
    return cur;
  };
  const A = mk(2), B = mk(5);
  const data = new Uint8Array(n2 * 4);
  for (let i = 0; i < n2; i++) {
    data[i * 4] = A[i] * 255; data[i * 4 + 1] = B[i] * 255; data[i * 4 + 2] = 128; data[i * 4 + 3] = 255;
  }
  DETTEX = new THREE.DataTexture(data, S, S);
  DETTEX.wrapS = DETTEX.wrapT = THREE.RepeatWrapping;
  DETTEX.magFilter = THREE.LinearFilter;
  DETTEX.minFilter = THREE.LinearMipmapLinearFilter;
  DETTEX.generateMipmaps = true;
  DETTEX.anisotropy = 4;
  DETTEX.needsUpdate = true;
  return DETTEX;
}
let _tintaTex = null;
function tintaTex(){
  if (_tintaTex || !ORTHO || !ORTHO.img) return _tintaTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.drawImage(ORTHO.img, 0, 0, 128, 128);
  _tintaTex = new THREE.CanvasTexture(c);
  _tintaTex.colorSpace = THREE.SRGBColorSpace;
  _tintaTex.wrapS = _tintaTex.wrapT = THREE.ClampToEdgeWrapping;
  return _tintaTex;
}
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
    if (ORTHO) { const wl = 0.75; r = r * (1 - wl) + wl; g2 = g2 * (1 - wl) + wl; b = b * (1 - wl) + wl; }
    col[i * 3] = r; col[i * 3 + 1] = g2; col[i * 3 + 2] = b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (ORTHO && ORTHO.img) {
    const uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      uv[i * 2] = (pos.getX(i) - ORTHO.x0) / (ORTHO.x1 - ORTHO.x0);
      uv[i * 2 + 1] = (-pos.getZ(i) - ORTHO.y0) / (ORTHO.y1 - ORTHO.y0);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const tex = new THREE.Texture(ORTHO.img);
    tex.needsUpdate = true;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const matT = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 1, metalness: 0 });
    matT.onBeforeCompile = sh => {
      sh.uniforms.uDet = { value: detailTex() };
      sh.uniforms.uTinta = { value: tintaTex() };
      sh.uniforms.uNubi = { value: NUBI_U };
      TERR_SH = sh;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vDetXZ;\nvarying vec2 vUvO;\nvarying float vNy;\nvarying float vWy;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDetXZ = (modelMatrix * vec4(position, 1.0)).xz;\nvUvO = uv;\nvNy = normalize(mat3(modelMatrix) * normal).y;\nvWy = (modelMatrix * vec4(position, 1.0)).y;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uDet;\nuniform sampler2D uTinta;\nuniform vec3 uNubi[' + NNUBI + '];\nvarying vec2 vDetXZ;\nvarying vec2 vUvO;\nvarying float vNy;\nvarying float vWy;')
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  // C: roccia procedurale sulle pareti ripide (la foto stirata sparisce)
  float ripida = smoothstep(0.86, 0.62, abs(vNy));
  // affioramenti e pietraie sopra i ~2000 m reali (y scena > 1420): chiazze di roccia
  // guidate dal rumore a grande scala, piu' estese dove il pendio e' comunque ripido
  {
    float alto = smoothstep(1380.0, 1620.0, vWy);
    float a1 = texture2D(uDet, vDetXZ / 210.0).r;
    float a2 = texture2D(uDet, vDetXZ / 55.0).g;
    float soglia = 0.62 - 0.18 * smoothstep(0.98, 0.80, abs(vNy));
    float aff = smoothstep(soglia, soglia + 0.12, a1 * 0.7 + a2 * 0.3) * alto;
    ripida = max(ripida, aff * 0.85);
  }
  if (ripida > 0.003) {
    vec3 tinta = texture2D(uTinta, vUvO).rgb;
    float s1 = texture2D(uDet, vDetXZ / 23.0).r;
    float s2 = texture2D(uDet, vDetXZ / 91.0).g;
    float s3 = texture2D(uDet, vDetXZ / 7.0).g;
    float s4 = texture2D(uDet, vDetXZ / 263.0).r;
    float s5 = texture2D(uDet, vDetXZ / 47.0).g;
    // strati appena accennati, frequenza e fase variabili, dominano le chiazze irregolari
    float distors = (s2 - 0.5) * 90.0 + (s1 - 0.5) * 18.0;
    float freq = 0.42 * (0.7 + 0.6 * s4);
    float banda = 0.5 + 0.5 * sin((vWy + distors) * freq);
    banda = mix(banda, s5, 0.5);
    float lum = 0.58 + 0.62 * (0.20 * banda + 0.30 * s1 + 0.16 * s3 + 0.34 * s4);
    diffuseColor.rgb = mix(diffuseColor.rgb, tinta * lum, ripida);
  }
  float d1 = texture2D(uDet, vDetXZ / 19.0).r;
  float d2 = texture2D(uDet, vDetXZ / 141.0).g;
  diffuseColor.rgb *= mix(0.84, 1.16, d1) * mix(0.92, 1.08, d2);
  // dettaglio ravvicinato (sotto i ~350 m dalla camera): grana fine dell'erba e ciuffi,
  // sfuma con la distanza cosi' da lontano la texture resta quella di prima
  {
    float dist = distance(cameraPosition, vec3(vDetXZ.x, vWy, vDetXZ.y));
    float vicino = 1.0 - smoothstep(120.0, 380.0, dist);
    if (vicino > 0.002) {
      float g1 = texture2D(uDet, vDetXZ / 2.6).g;
      float g2 = texture2D(uDet, vDetXZ / 0.9).r;
      float g3 = texture2D(uDet, vDetXZ / 6.5).r;
      float erba = 1.0 - ripida;
      // ciuffi: macchie piu' chiare/gialle e solchi scuri, solo sull'erba
      float ciuffo = smoothstep(0.55, 0.75, g3) * erba;
      vec3 tintaCiuffo = vec3(1.04, 1.02, 0.90);
      float grana = mix(0.90, 1.10, g1) * mix(0.95, 1.05, g2);
      vec3 det = diffuseColor.rgb * grana * mix(vec3(1.0), tintaCiuffo, ciuffo * 0.45);
      // sulla roccia: grana piu' dura e contrastata
      det = mix(det, diffuseColor.rgb * mix(0.80, 1.22, g1) * mix(0.9, 1.1, g2), ripida);
      diffuseColor.rgb = mix(diffuseColor.rgb, det, vicino);
    }
  }
  // ombre morbide dei cumuli che scorrono sul terreno
  float ombra = 1.0;
  for (int i = 0; i < ${NNUBI}; i++) {
    vec3 nb = uNubi[i];
    float dn = distance(vDetXZ, nb.xy) / max(nb.z, 1.0);
    ombra *= 1.0 - 0.30 * (1.0 - smoothstep(0.55, 1.0, dn));
  }
  diffuseColor.rgb *= ombra;
  vec3 gGr = vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)));
  diffuseColor.rgb = clamp((mix(gGr, diffuseColor.rgb, 1.30) - 0.5) * 1.07 + 0.5, 0.0, 1.0);
}`);
    };
    mesh.material = matT;
  } else {
    mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  }
}


// ---------- cielo: cupola con gradiente, sole e foschia all'orizzonte ----------
// Una sfera che segue la camera; il colore all'orizzonte e' anche il colore della nebbia,
// cosi' terreno lontano e cielo si fondono senza stacco. Due tavolozze: alba (Lino) e
// mezzogiorno d'estate (grifone).
let SKY = null;
const SKYPAL = {
  alba:  { zen: 0x5f8ecc, hor: 0xe4e2da, sunC: 0xfff0d2, haze: 0.50 },
  giorno:{ zen: 0x2d6cc6, hor: 0xc6dcef, sunC: 0xfff8ec, haze: 0.35 }
};
function buildSky(){
  const geo = new THREE.SphereGeometry(24000, 40, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uZen: { value: new THREE.Color(SKYPAL.alba.zen) },
      uHor: { value: new THREE.Color(SKYPAL.alba.hor) },
      uSunC: { value: new THREE.Color(SKYPAL.alba.sunC) },
      uSun: { value: new THREE.Vector3(SUNDIR.x, SUNDIR.y, SUNDIR.z).normalize() },
      uHaze: { value: SKYPAL.alba.haze }
    },
    vertexShader: 'varying vec3 vDir;\nvoid main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w * 0.99999; }',
    fragmentShader: `uniform vec3 uZen, uHor, uSunC, uSun; uniform float uHaze; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float t = clamp(d.y, -0.2, 1.0);
        // gradiente: zenit -> orizzonte, con una fascia di foschia bassa
        float k = pow(max(t, 0.0), 0.55);
        vec3 c = mix(uHor, uZen, k);
        float bassa = 1.0 - smoothstep(0.0, 0.05 + 0.08 * uHaze, max(t, 0.0));
        c = mix(c, uHor, bassa * uHaze);
        // sotto l'orizzonte: foschia uniforme (la gonna del mondo e' dello stesso colore)
        c = mix(c, uHor, smoothstep(-0.02, -0.45, d.y));
        // sole: disco + alone largo
        float s = max(dot(d, uSun), 0.0);
        float disco = smoothstep(0.9993, 0.9998, s);
        float alone = pow(s, 90.0) * 0.55 + pow(s, 9.0) * 0.16;
        c += uSunC * (disco * 1.6 + alone);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        // all'orizzonte il cielo deve essere IDENTICO alla nebbia di three (che scrive il
        // colore grezzo dopo il tone mapping): stessa miscela grezza, niente riga di stacco
        float hb = 1.0 - smoothstep(0.0, 0.05, d.y);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, linearToOutputTexel(vec4(uHor, 1.0)).rgb, hb);
      }`
  });
  SKY = new THREE.Mesh(geo, mat);
  SKY.name = 'Sky'; SKY.frustumCulled = false; SKY.renderOrder = -10;
  scene.add(SKY);
  skyPalette('alba');
}
function skyPalette(nome){
  const p = SKYPAL[nome]; if (!SKY || !p) return;
  SKY.material.uniforms.uZen.value.set(p.zen);
  SKY.material.uniforms.uHor.value.set(p.hor);
  SKY.material.uniforms.uSunC.value.set(p.sunC);
  SKY.material.uniforms.uHaze.value = p.haze;
  scene.background.set(p.hor); scene.fog.color.set(p.hor);
  if (skirt) skirt.material.color.set(p.hor);
}

// ---------- ortofoto, griglia altezze, brecciato ----------
let ORTHO = null, HG = null, sunLight = null, SHADOWS = false, HEMI = null;
const SUNDIR = { x: -0.52, y: 0.62, z: -0.58 };
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
    ORTHO = Object.assign({}, j, { px: x.getImageData(0, 0, j.n, j.n).data, img: img });
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
// REGOLA FISSA: ogni oggetto appoggiato al suolo passa da poggia() —
// il punto piu' basso del bounding box tocca terra (+3 cm), mai annegato ne' volante.
function poggia(obj, margine = 0.03){
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return;
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  let gy = groundAt(cx, cz);
  try {
    let terr = null;
    scene.traverse(o => { if (!terr && o.isMesh && (o.name || '').startsWith('Terrain')) terr = o; });
    if (terr) {
      const rc = new THREE.Raycaster(new THREE.Vector3(cx, box.max.y + 120, cz),
                                     new THREE.Vector3(0, -1, 0), 0, 600);
      const hit = rc.intersectObject(terr, false)[0];
      if (hit) gy = hit.point.y;
    }
  } catch (e) {}
  if (gy < -1e3) return;
  obj.position.y += gy - box.min.y + margine;
}
function colorizeTrail(mesh){
  // nastro a 2 colonne di vertici: il bordo arancione sull'asfalto vive nel fragment shader
  const g = mesh.geometry, p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  const aSide = new Float32Array(p.count);
  const aAsf = new Float32Array(p.count);
  const orange = [0.907, 0.31, 0.012], brec = [0.44, 0.415, 0.365];
  const ASF = (route.roads || []).filter(r => r.asf).map(r => [r.a, r.b])
    .concat([[0, 0.50], [29.25, route.total_km]]);
  // linea centrale del NASTRO dai suoi stessi vertici (le due rotaie si alternano
  // in modo bilanciato: una media mobile di indici e' il centro locale del nastro)
  const cxA = new Float64Array(p.count + 1), czA = new Float64Array(p.count + 1);
  for (let i = 0; i < p.count; i++) {
    cxA[i + 1] = cxA[i] + p.getX(i);
    czA[i + 1] = czA[i] + p.getZ(i);
  }
  const cw = (a, b) => [(cxA[b + 1] - cxA[a]) / (b - a + 1), (czA[b + 1] - czA[a]) / (b - a + 1)];
  // aggancio INSEGUITO: il nastro e' costruito in ordine lungo il percorso, quindi ogni
  // vertice cerca solo vicino all'aggancio del precedente - un vertice dell'andata non
  // puo' agganciare il ritorno dove le due gambe corrono sulla stessa strada.
  let bjPrev = 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    let best = 1e12, bj = bjPrev;
    for (let j = Math.max(0, bjPrev - 40); j <= Math.min(N - 1, bjPrev + 40); j++) {
      const dx = route.x[j] - x, dz = -route.y[j] - z;
      const d = dx * dx + dz * dz;
      if (d < best) { best = d; bj = j; }
    }
    if (best > 900) {   // aggancio perso: ricerca globale di sicurezza
      for (let j = 0; j < N; j += 3) {
        const dx = route.x[j] - x, dz = -route.y[j] - z;
        const d = dx * dx + dz * dz;
        if (d < best) { best = d; bj = j; }
      }
      for (let j = Math.max(0, bj - 3); j <= Math.min(N - 1, bj + 3); j++) {
        const dx = route.x[j] - x, dz = -route.y[j] - z;
        const d = dx * dx + dz * dz;
        if (d < best) { best = d; bj = j; }
      }
    }
    bjPrev = bj;
    const km = bj / (N - 1) * route.total_km;
    // lato del nastro (0/1): segno rispetto alla linea centrale del NASTRO stesso
    // (robusto anche ai tappi d'estremita' e agli spigoli, dove la polilinea GPX diverge)
    const W8 = 8;
    const c0 = cw(Math.max(0, i - W8), Math.min(p.count - 1, i + W8));
    const cb = cw(Math.max(0, i - 2 * W8), i);
    const cf = cw(i, Math.min(p.count - 1, i + 2 * W8));
    const sd = (cf[0] - cb[0]) * (z - c0[1]) - (cf[1] - cb[1]) * (x - c0[0]);
    aSide[i] = sd > 0 ? 1 : 0;
    let ta = 0;
    for (const r of ASF) {
      ta = Math.max(ta, clamp((km - r[0] + 0.06) / 0.1, 0, 1) * clamp((r[1] - km + 0.06) / 0.1, 0, 1));
    }
    aAsf[i] = ta;
    const t = clamp((km - 5.72) / 0.16, 0, 1) * clamp((6.68 - km) / 0.16, 0, 1);
    let nz = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    nz = nz - Math.floor(nz);
    const nn = t > 0 ? 0.82 + 0.36 * nz : 1;
    for (let c = 0; c < 3; c++) {
      col[i * 3 + c] = (orange[c] * (1 - t) + brec[c] * t) * nn;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
  g.setAttribute('aAsf', new THREE.BufferAttribute(aAsf, 1));
  // collaudo: nessun triangolo deve avere i 3 vertici sullo stesso lato
  if (g.index) {
    let uni = 0;
    const ix = g.index.array;
    for (let k = 0; k < ix.length; k += 3) {
      if (aSide[ix[k]] === aSide[ix[k + 1]] && aSide[ix[k + 1]] === aSide[ix[k + 2]]) uni++;
    }
    window._trailUni = uni;
    if (uni > 0) console.warn('nastro: ' + uni + ' triangoli con lato uniforme');
  }
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSide; attribute float aAsf; varying float vSide; varying float vAsf;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSide = aSide; vAsf = aAsf;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vSide; varying float vAsf;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n{\n  float bordo = smoothstep(0.68, 0.86, abs(vSide * 2.0 - 1.0));\n  vec3 grigioAsf = vec3(0.30, 0.305, 0.32);\n  vec3 aranc = vec3(0.907, 0.31, 0.012);\n  diffuseColor.rgb = mix(diffuseColor.rgb, mix(grigioAsf, aranc, bordo), vAsf);\n}');
  };
  mesh.material = m;
}


// ---------- bandierine fantasma delle vette ----------
let peakItems = [], peakT = 0;
function peakLabel(nome, quota){
  const mis = document.createElement('canvas').getContext('2d');
  mis.font = '400 86px Anton, Oswald, sans-serif';
  const testo = nome.toUpperCase() + (quota ? '  \u00b7  ' + quota + ' m' : '');
  const cw = Math.min(1900, Math.max(420, Math.ceil(mis.measureText(testo).width) + 120));
  const c = document.createElement('canvas'); c.width = cw; c.height = 192;
  const x = c.getContext('2d');
  x.font = '400 86px Anton, Oswald, sans-serif';
  const w = cw - 24;
  const x0 = 12;
  x.fillStyle = 'rgba(12,31,20,0.84)';
  x.beginPath();
  if (x.roundRect) x.roundRect(x0, 32, w, 128, 48); else x.rect(x0, 32, w, 128);
  x.fill();
  x.strokeStyle = 'rgba(243,239,226,0.9)'; x.lineWidth = 5; x.stroke();
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = '#f3efe2';
  x.fillText(testo, cw / 2, 100);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return { tex, aspect: cw / 192 };
}
function buildPeaks(){
  if (!route.peaks || !route.peaks.length) return;
  const grp = new THREE.Group();
  const astaGeo = new THREE.CylinderGeometry(0.45, 0.75, 54, 6);
  const astaMat = new THREE.MeshBasicMaterial({ color: 0xf3efe2, transparent: true, opacity: 0.5 });
  const sh = new THREE.Shape();
  sh.moveTo(0, 0); sh.lineTo(17, -4.5); sh.lineTo(0, -9); sh.lineTo(0, 0);
  const flagGeo = new THREE.ShapeGeometry(sh);
  for (const p of route.peaks) {
    const g = new THREE.Group();
    g.position.set(p.x, p.z, -p.y);
    const asta = new THREE.Mesh(astaGeo, astaMat.clone());
    asta.position.y = 27;
    const flag = new THREE.Mesh(flagGeo,
      new THREE.MeshBasicMaterial({ color: 0xf4951f, transparent: true, opacity: 0.62, side: THREE.DoubleSide }));
    flag.position.y = 52.5;
    const pl = peakLabel(p.n, p.e);
    const lbl = new THREE.Sprite(new THREE.SpriteMaterial({
      map: pl.tex, transparent: true, depthTest: false }));
    lbl.position.y = 70;
    lbl.userData.aspect = pl.aspect;
    lbl.scale.set(20.6 * pl.aspect, 20.6, 1);
    g.add(asta, flag, lbl);
    g.userData = { lbl, flag, asta };
    grp.add(g); peakItems.push(g);
  }
  scene.add(grp);
  console.log('vette:', route.peaks.map(p => p.n).join(' | '));
}

// ---------- vegetazione e sassi istanziati ----------
const VENTO_SH = [];
async function loadVeg(loader){
  const r = await fetch('assets/veg.json?' + VER);
  if (!r.ok) return;
  const veg = await r.json();
  const pg = await loadGLB(loader, 'assets/protos.glb?' + VER, () => {});
  const lib = {};
  pg.scene.traverse(o => { if (o.isMesh) lib[o.name] = o; });
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(),
        S = new THREE.Vector3(), E = new THREE.Euler();
  // spettatori: mai sopra ~1700 m reali (y scena 1088), mai a meno di 6 m dal nastro
  const rxs = [], rys = [];
  for (let i = 0; i < N; i += 4) { rxs.push(route.x[i]); rys.push(route.y[i]); }
  const dNastro = (x, y) => {
    let dm = 1e9;
    for (let i = 0; i < rxs.length; i++) {
      const d = (rxs[i] - x) * (rxs[i] - x) + (rys[i] - y) * (rys[i] - y);
      if (d < dm) dm = d;
    }
    return Math.sqrt(dm);
  };
  for (const key of Object.keys(veg.inst)) {
    let arr = veg.inst[key];
    const proto = lib[veg.protos[key]];
    if (!proto || !arr.length) continue;
    const isGent = key === 'Sphere_155' || key.startsWith('Cone_03') ||
                   /^M_EX_gen/.test((proto.material && proto.material.name) || '');
    if (isGent) {
      const pre = arr.length;
      arr = arr.filter(t => t[2] < 1088 && dNastro(t[0], t[1]) > 6);
      if (pre !== arr.length) console.log('spettatori rimossi (' + key + '):', pre - arr.length);
      if (!arr.length) continue;
    }
    if (proto.material && proto.material.isMeshStandardMaterial) {
      proto.material = proto.material.clone();
      proto.material.metalness = 0; proto.material.roughness = 0.95;
      if (key === 'Sphere_155') proto.material.color.setHex(0xdfa075);
      else if (key.startsWith('Cone_03')) proto.material.color.setHex(0x2d55b8);
    }
    // alberi (chiome a cono + tronchi): chioma irregolare, colore variato per pianta, vento
    const isChioma = /^Cone(_00\d)?$/.test(key);
    const isTronco = /^Cylinder_02\d$/.test(key);
    let geo = proto.geometry;
    if (isChioma) {
      geo = proto.geometry.clone();
      const pa = geo.getAttribute('position');
      let sd = 7 + key.length;
      const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
      // bordo della chioma frastagliato: i vertici del cerchio di base rientrano a caso
      let ymin = 1e9, ymax = -1e9;
      for (let i = 0; i < pa.count; i++) { const y = pa.getY(i); if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i), z = pa.getZ(i), r = Math.hypot(x, z);
        if (r < 1e-4) continue;
        const k = 0.72 + 0.4 * rnd();
        pa.setXYZ(i, x * k, pa.getY(i) + (rnd() - 0.5) * (ymax - ymin) * 0.10, z * k);
      }
      pa.needsUpdate = true; geo.computeVertexNormals();
    }
    if ((isChioma || isTronco) && proto.material.isMeshStandardMaterial) {
      proto.material.color.set(0xffffff);   // il colore lo da' la tinta per pianta
      proto.material.onBeforeCompile = sh => {
        sh.uniforms.uT = { value: 0 };
        VENTO_SH.push(sh);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uT;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  // oscillazione al vento: cresce con l'altezza del vertice, fase diversa per pianta
  vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float fase = wp.x * 0.05 + wp.z * 0.037;
  float h = clamp(position.y / 6.0, 0.0, 1.0);
  float sw = sin(uT * 1.7 + fase) * 0.12 + sin(uT * 3.1 + fase * 1.7) * 0.05;
  transformed.x += sw * h * h * 1.6;
  transformed.z += sw * h * h * 0.9;
}`);
      };
    }
    const im = new THREE.InstancedMesh(geo, proto.material, arr.length);
    const col = new THREE.Color();
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      P.set(t[0], t[2], -t[1]);
      Q.setFromEuler(E.set(0, t[3], 0));
      S.setScalar(t[4] || 1);
      M.compose(P, Q, S);
      im.setMatrixAt(i, M);
      if (isChioma || isTronco) {
        // tinta per pianta: verdi dal cupo al giallastro (le chiome), corteccia variabile (i tronchi)
        const h1 = Math.sin(t[0] * 12.9898 + t[1] * 78.233) * 43758.5453, r1 = h1 - Math.floor(h1);
        if (isChioma) col.setHSL(0.27 + (r1 - 0.5) * 0.06, 0.48 + r1 * 0.2, 0.12 + r1 * 0.10);
        else col.setHSL(0.07, 0.40, 0.11 + r1 * 0.08);
        im.setColorAt(i, col);
      }
    }
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    im.castShadow = true;
    scene.add(im);
  }
  console.log('vegetazione:', Object.keys(veg.inst).map(k => k + ':' + veg.inst[k].length).join(', '));
}

// ---------- suono sintetizzato (Web Audio, nessun file): vento, battito, tocco, botta ----------
const SND = { ctx: null, on: true, wind: null, windG: null, windF: null, rumb: null, rumbG: null, noise: null, ready: false };
function sndInit(){
  if (SND.ready) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    SND.ctx = new AC();
    try { SND.on = localStorage.getItem('srmx_snd') !== '0'; } catch (e) {}
    const c = SND.ctx;
    // rumore bianco in loop (2 s)
    const n = c.sampleRate * 2, buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    SND.noise = buf;
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.7;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(c.destination); src.start();
    SND.wind = src; SND.windF = f; SND.windG = g;
    // rombo basso per l'alta velocita'
    const src2 = c.createBufferSource(); src2.buffer = buf; src2.loop = true;
    const f2 = c.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 140;
    const g2 = c.createGain(); g2.gain.value = 0;
    src2.connect(f2); f2.connect(g2); g2.connect(c.destination); src2.start();
    SND.rumb = src2; SND.rumbG = g2;
    SND.ready = true;
    const b = $('b-snd'); if (b) b.textContent = SND.on ? '\ud83d\udd0a' : '\ud83d\udd07';
  } catch (e) { console.warn('audio:', e); }
}
function sndToggle(){
  SND.on = !SND.on;
  try { localStorage.setItem('srmx_snd', SND.on ? '1' : '0'); } catch (e) {}
  const b = $('b-snd'); if (b) b.textContent = SND.on ? '\ud83d\udd0a' : '\ud83d\udd07';
  if (!SND.on) sndWind(0, 0);
}
function sndWind(v, fold){
  if (!SND.ready) return;
  const c = SND.ctx, t = c.currentTime;
  const k = SND.on && FLY.on && FLY.mode === 'volo' ? clamp((v - 8) / 60, 0, 1) : 0;
  SND.windG.gain.setTargetAtTime(0.08 + 0.42 * k, t, 0.12);
  if (k === 0) SND.windG.gain.setTargetAtTime(0, t, 0.3);
  SND.windF.frequency.setTargetAtTime(320 + 1500 * k * k + 300 * fold, t, 0.15);
  SND.rumbG.gain.setTargetAtTime(0.5 * k * k, t, 0.15);
}
function sndBurst(freq, q, gain, dur, type){
  if (!SND.ready || !SND.on) return;
  const c = SND.ctx, t = c.currentTime;
  const src = c.createBufferSource(); src.buffer = SND.noise;
  const f = c.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.45), t + dur);
  const g = c.createGain(); g.gain.setValueAtTime(0.001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.25); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(c.destination); src.start(t); src.stop(t + dur + 0.05);
}
function sndFlap(){ sndBurst(900, 1.2, 0.35, 0.28, 'bandpass'); }
function sndTocco(){ sndBurst(400, 0.8, 0.3, 0.35, 'lowpass'); }
function sndBotta(){
  sndBurst(180, 0.6, 0.8, 0.5, 'lowpass');
  if (!SND.ready || !SND.on) return;
  const c = SND.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.5);
  g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
  o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.6);
}
const vibra = ms => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} };

// ---------- modalità GRIFONE: volo libero sopra il Velino ----------
// Modello di volo arcade in unità di scena (~metri): planata con perdita di quota
// costante, picchiata/cabrata scambiano quota e velocità, virata coordinata dal
// rollio, battito d'ali come riserva di spinta, stallo sotto VSTALL.
const FLY = {
  on: false, pos: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, v: 18,
  inX: 0, inY: 0, flap: false, flapPh: 0, flapPow: 0, stall: false, stallT: 0,
  vario: 0, lift: 0, agl: 0, pitchV: 0, rollV: 0, tilt: false, tiltBase: null, tiltIn: [0, 0], joyIn: [0, 0], keyIn: [0, 0],
  fogSaved: null, camRoll: 0, ready: false,
  mode: 'volo', tT: 0, fold: 0, flapHold: 0, tumble: null, orbit: 0, legs: 0, flapCyc: 0, shake: 0
};
const FC = {
  G: 9.81, VSTALL: 9.5, VMAX: 84, CD: 0.0027,   // VMAX 84 m/s ≈ 300 km/h a proiettile (ali chiuse)
  PITCH_GLIDE: -0.105,   // -6°: pendenza di planata naturale
  PITCH_UP: 0.50, PITCH_DN: 0.88, ROLL_MAX: 1.05, FLAP_HZ: 2.1, FLAP_ACC: 16, FLAP_LIFT: 6,
  CEIL: 2950, AGL_MIN: 2.3, V_ATT: 17, V_IMP: 26, PITCH_IMP: -0.5, H_TERRA: 2.75,
  // confine morbido: ellisse centrata sul terreno (coordinate three: x, z)
  BC: [-636, 970], BR: [4250, 5050]
};
let grifP = null, grifMat = null;
const fwdV = new THREE.Vector3(), upV = new THREE.Vector3(0, 1, 0), rightV = new THREE.Vector3();
const gEul = new THREE.Euler(0, 0, 0, 'YXZ');
let skirt = null;
const isTouch = () => matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;

function buildGrifone(){
  if (grifP || !grifTpl) return;
  grifP = new THREE.Group(); grifP.name = 'GrifonePilota';
  const m = grifTpl.clone();
  m.geometry = grifTpl.geometry;
  grifMat = grifTpl.material.clone();
  grifMat.metalness = 0; grifMat.roughness = 0.9;
  // battito d'ali procedurale: le ali (|x| oltre la radice) ruotano attorno all'asse
  // longitudinale del corpo, con le punte che flettono di più della radice
  grifMat.onBeforeCompile = sh => {
    sh.uniforms.uFlap = { value: 0 };
    sh.uniforms.uSweep = { value: 0 };
    sh.uniforms.uLegs = { value: 0 };
    grifMat.userData.sh = sh;
    // uFlap: rotazione dell'ala attorno all'asse del corpo (battito, diedro, ali giù a terra)
    // uSweep: ali che si chiudono all'indietro lungo il corpo (assetto a proiettile)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uFlap;\nuniform float uSweep;\nuniform float uLegs;\nvec3 alaPos(vec3 p, float a, float sw){\n  float ax = abs(p.x); float rad = 0.12;\n  if (ax <= rad) {\n    // zampe: la parte bassa del corpo dietro il petto ruota in giu\' attorno all\'anca\n    float wz = smoothstep(-0.08, -0.16, p.z) * smoothstep(-0.42, -0.34, p.z);\n    float wy = smoothstep(-0.16, -0.24, p.y);\n    float w = wz * wy * uLegs;\n    if (w > 0.001) {\n      float ang = -1.25 * w;\n      float st = 1.0 + 0.9 * w;\n      float dy = (p.y + 0.17) * st, dz = (p.z + 0.24) * st;\n      float c = cos(ang), sn = sin(ang);\n      return vec3(p.x, -0.17 + dy * c - dz * sn * 0.6, -0.24 + dz * c + dy * sn * 0.6);\n    }\n    return p;\n  }\n  float w = clamp((ax - rad) / 0.83, 0.0, 1.0);\n  float ang = a * (0.55 + 0.45 * w);\n  float dx = ax - rad;\n  float x2 = dx * cos(ang); float y2 = p.y + dx * sin(ang);\n  float sa = sw * (0.7 + 0.3 * w);\n  return vec3(sign(p.x) * (rad + x2 * cos(sa)), y2, p.z - x2 * sin(sa) - 0.15 * sw * w);\n}')
      .replace('#include <begin_vertex>', 'vec3 transformed = alaPos(vec3(position), uFlap, uSweep);')
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(normal);\n{ float ax = abs(position.x); if (ax > 0.12) { float w = clamp((ax - 0.12) / 0.83, 0.0, 1.0); float ang = uFlap * (0.55 + 0.45 * w) * sign(position.x);\n  float c = cos(ang), s = sin(ang); objectNormal = vec3(objectNormal.x * c - objectNormal.y * s, objectNormal.x * s + objectNormal.y * c, objectNormal.z); } }');
  };
  m.material = grifMat;
  m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); m.scale.setScalar(grifTpl.scale.x || 6.84);
  m.rotation.y = GRIF_MESH_YAW;
  m.castShadow = true; m.frustumCulled = false;
  grifP.add(m);
  grifP.visible = false;
  scene.add(grifP);
  // "gonna" del mondo: disco color foschia sotto e oltre il bordo del terreno,
  // così il limite della mappa sfuma nella nebbia invece di mostrare un orlo
  const sk = new THREE.Mesh(new THREE.CircleGeometry(60000, 48),
    new THREE.MeshBasicMaterial({ color: scene.fog.color.clone(), fog: true }));
  sk.rotation.x = -Math.PI / 2; sk.position.set(FC.BC[0], -46, FC.BC[1]);
  sk.name = 'Skirt'; sk.visible = false; skirt = sk;
  scene.add(sk);
}
const GRIF_MESH_YAW = 0;   // orientamento del modello Meshy rispetto alla prua (+z del gruppo)

function flyStart(){
  if (!grifTpl) { openCard('<h2>Grifone assente</h2><p>Il modello del grifone non è nella scena.</p>'); return; }
  buildGrifone();
  if (!TIDX) { try { TIDX = buildTerrIndex(); } catch (e) { console.warn('indice terreno:', e); } }
  // si parte dalla vetta del Cafornia, prua verso Magliano: chi vuole picchiare
  // ha subito tutta la valle davanti
  const caf = (route.peaks || []).find(p => /cafornia/i.test(p.n));
  if (caf) FLY.pos.set(caf.x, caf.z + 45, -caf.y);
  else { posAt(st.s, tmpA); FLY.pos.set(tmpA.x, tmpA.y + 70, tmpA.z); }
  posAt(0, tmpA);
  FLY.yaw = Math.atan2(tmpA.x - FLY.pos.x, tmpA.z - FLY.pos.z);
  FLY.pitch = FC.PITCH_GLIDE; FLY.roll = 0; FLY.v = 22; FLY.pitchV = 0; FLY.rollV = 0;
  FLY.stall = false; FLY.flap = false; FLY.flapPow = 0; FLY.vario = 0;
  FLY.mode = 'volo'; FLY.tT = 0; FLY.fold = 0; FLY.flapHold = 0; FLY.tumble = null;
  $('fade').style.opacity = 0; $('impatto').classList.remove('on');
  FLY.on = true; grifP.visible = true; skirt.visible = true;
  if (!FLY.fogSaved) FLY.fogSaved = [scene.fog.near, scene.fog.far];
  scene.fog.near = 700; scene.fog.far = degraded ? 3800 : 4600;
  luceGrifone(true);
  document.body.classList.add('grif');
  document.body.classList.toggle('touch', isTouch());
  controls.enabled = false;
  $('b-grif').classList.add('on'); $('b-grif').textContent = 'TORNA A LINO';
  const lab = document.querySelectorAll('#bar .slot .lab');
  lab[0].textContent = 'In volo'; lab[1].textContent = 'Velocità'; lab[3].textContent = 'Vario';
  $('zona-n').textContent = 'Grifone del Velino'; $('zona-s').textContent = '';
  st.curZone = -1; st.curKey = null; st.lastHudS = -1e9;
  $('poi-banner').classList.remove('on'); st.curPoi = -1;
  // la camera parte dietro al grifone
  fwdOf(FLY, fwdV);
  camera.position.copy(FLY.pos).addScaledVector(fwdV, -40); camera.position.y += 14;
  camTgt.copy(FLY.pos);
  if (!FLY.ready) { FLY.ready = true; bindFlyUI(); }
  sndInit();
  if (window.SRMX) { window.SRMX.fly = FLY; window.SRMX.flyStop = flyStop; window.SRMX.grifP = grifP; window.SRMX.stepFly = dt => tickFly(dt); }
  try { location.hash = 'grifone'; } catch (e) {}
}
function flyStop(){
  if (!FLY.on) return;
  FLY.on = false;
  sndWind(0, 0); grifP.visible = false; skirt.visible = false;
  if (FLY.fogSaved) { scene.fog.near = FLY.fogSaved[0]; scene.fog.far = FLY.fogSaved[1]; FLY.fogSaved = null; }
  $('fade').style.opacity = 0; $('impatto').classList.remove('on');
  camera.fov = 55; camera.updateProjectionMatrix();
  luceGrifone(false);
  document.body.classList.remove('grif');
  $('b-grif').classList.remove('on'); $('b-grif').textContent = 'GRIFONE';
  $('stallo').classList.remove('on');
  const lab = document.querySelectorAll('#bar .slot .lab');
  lab[0].textContent = 'Zona'; lab[1].textContent = 'Km'; lab[3].textContent = 'Pendenza';
  st.curZone = -1; st.curKey = null; st.lastHudS = -1e9; st.curPoi = -1;
  tiltOff();
  setView('follow');
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
}
// luce da mezzogiorno d'estate in volo: cielo più blu, sole più alto e caldo, esposizione su.
// La nebbia resta (serve a nascondere i confini): cambia solo il suo colore, che segue il cielo.
let LUCE0 = null;
function luceGrifone(on){
  if (!LUCE0) LUCE0 = { exp: renderer.toneMappingExposure, bg: scene.background.clone(),
                        sun: sunLight.intensity, sunC: sunLight.color.clone(), hemi: HEMI ? HEMI.intensity : 1 };
  if (on) {
    renderer.toneMappingExposure = 1.34;
    skyPalette('giorno');
    sunLight.intensity = 3.1; sunLight.color.set(0xfff6e4);
    if (HEMI) HEMI.intensity = 1.25;
  } else {
    renderer.toneMappingExposure = LUCE0.exp;
    skyPalette('alba');
    sunLight.intensity = LUCE0.sun; sunLight.color.copy(LUCE0.sunC);
    if (HEMI) HEMI.intensity = LUCE0.hemi;
  }
}
function fwdOf(f, out){
  const cp = Math.cos(f.pitch);
  return out.set(cp * Math.sin(f.yaw), Math.sin(f.pitch), cp * Math.cos(f.yaw));
}
// ascendenze: termiche sui versanti al sole (esposti a sud-ovest, dove sta il sole della
// scena) e sopra le creste; svaniscono lontano dal suolo. In m/s verso l'alto.
// vento dominante da NO (verso SE in coordinate three), piu' forte lontano dal suolo
const VENTO = { x: 0.62, z: 0.78, v: 6.5 };
function ventoAt(agl){
  const k = clamp(0.35 + agl / 320, 0.35, 1);
  return [VENTO.x * VENTO.v * k, VENTO.z * VENTO.v * k];
}
// Ascendenze (m/s verso l'alto) e turbolenza in un punto:
//  - di pendio: il vento che sale lungo il versante sopravvento (svanisce oltre 260 m dal suolo)
//  - termiche: colonne dove girano i grifoni in orbita (route.grif) e sui versanti al sole
//  - sottovento alle creste: aria discendente e turbolenta
let ASC = { pendio: 0, termica: 0, sole: 0, turb: 0 };
function ascendenzaAt(x, z, agl){
  const h = 60;
  const g0 = groundAt(x, z);
  if (g0 < -1e3) { ASC.pendio = ASC.termica = ASC.sole = ASC.turb = 0; return 0; }
  const gx = (groundAt(x + h, z) - groundAt(x - h, z)) / (2 * h);
  const gz = (groundAt(x, z + h) - groundAt(x, z - h)) / (2 * h);
  const slope = Math.hypot(gx, gz);
  // pendio: componente del vento che sale lungo il versante
  const w = ventoAt(agl);
  const up = -(gx * w[0] + gz * w[1]);          // >0 sopravvento (l'aria e' spinta in su)
  const fadeP = clamp(1 - agl / 260, 0, 1);
  ASC.pendio = clamp(up * 1.3, -2.5, 4.5) * fadeP;
  ASC.turb = (up < -0.6 ? clamp(-up * 0.5, 0, 1) : 0) * fadeP;
  // termiche marcate dai grifoni in orbita
  let term = 0;
  if (route.grif) for (const g of route.grif) {
    const d = Math.hypot(g.c[0] - x, -g.c[1] - z);
    const core = Math.exp(-(d * d) / (190 * 190));
    const band = clamp(agl / 60, 0, 1) * clamp((1000 - agl) / 400, 0, 1);
    term = Math.max(term, 3.8 * core * band);
  }
  ASC.termica = term;
  // versanti al sole
  const sunX = SUNDIR.x, sunZ = SUNDIR.z;
  const L = Math.hypot(sunX, sunZ) || 1;
  const facing = -(gx * sunX + gz * sunZ) / L;
  const quota = route.elev_a * g0 + route.elev_b;
  const sole = clamp(facing * 4.0, 0, 1) * clamp(slope * 3.5, 0, 1) * clamp((quota - 1000) / 700, 0.25, 1);
  ASC.sole = 2.0 * sole * clamp(1 - agl / 380, 0, 1);
  return ASC.pendio + Math.max(ASC.termica, ASC.sole);
}
function tickFly(dt){
  const f = FLY;
  if (f.mode === 'terra') { tickTerra(dt); return; }
  if (f.mode === 'impatto') { tickImpatto(dt); return; }
  // assetto a proiettile: oltre ~150 km/h in picchiata le ali si chiudono sul corpo;
  // rallentando (o alzando il muso) si riaprono da sole
  const foldT = clamp((f.v - 42) / 16, 0, 1) * clamp((-f.pitch - 0.12) / 0.2, 0, 1);
  f.fold += (foldT - f.fold) * (1 - Math.exp(-(foldT > f.fold ? 3.5 : 2.5) * dt));
  // zampe: scendono gradualmente quando si rallenta vicino al suolo (preparazione al tocco)
  const legsT = clamp((22 - f.v) / 8, 0, 1) * clamp((45 - f.agl) / 30, 0, 1);
  f.legs += (legsT - f.legs) * (1 - Math.exp(-2.5 * dt));
  // ingressi: tastiera + joystick + inclinazione (il più forte vince)
  const pick = (a, b, c) => Math.abs(a) >= Math.abs(b) ? (Math.abs(a) >= Math.abs(c) ? a : c) : (Math.abs(b) >= Math.abs(c) ? b : c);
  f.inX = clamp(pick(f.keyIn[0], f.joyIn[0], f.tiltIn[0]), -1, 1);
  f.inY = clamp(pick(f.keyIn[1], f.joyIn[1], f.tiltIn[1]), -1, 1);   // +1 = picchiata
  const ctl = (f.stall ? 0.25 : 1) * (1 - 0.55 * f.fold);   // ali chiuse: comandi più duri
  // beccheggio: la planata naturale è leggermente a scendere; in stallo il muso cade
  // la picchiata resta piena anche ad ali chiuse; la cabrata e il rollio si induriscono
  let pT = FC.PITCH_GLIDE + (f.inY > 0 ? -f.inY * FC.PITCH_DN * (f.stall ? 0.25 : 1) : -f.inY * FC.PITCH_UP * ctl);
  if (f.stall) pT = Math.min(pT, -0.55);
  if (f.pos.y > FC.CEIL) pT = Math.min(pT, -0.15 - (f.pos.y - FC.CEIL) / 200);
  // beccheggio con inerzia (molla smorzata): risponde, non scatta
  f.pitchV += ((pT - f.pitch) * (f.stall ? 10 : 8.5) - f.pitchV * 5.2) * dt;
  f.pitch += f.pitchV * dt;
  // rollio → virata coordinata
  const rT = f.inX * FC.ROLL_MAX * ctl;
  f.rollV += ((rT - f.roll) * 13 - f.rollV * 6.2) * dt;
  // turbolenza sottovento alle creste: scossoni sul rollio
  if (ASC.turb > 0) f.rollV += (Math.sin(performance.now() / 173) + Math.sin(performance.now() / 61) * 0.5) * ASC.turb * 1.4 * dt;
  f.roll += f.rollV * dt;
  const yawRate = clamp(FC.G * Math.tan(f.roll) / Math.max(f.v, 10), -1.1, 1.1);
  f.yaw -= yawRate * dt;
  // battito d'ali: ciclo a FLAP_HZ, spinta in avanti + un po' di portanza
  if (f.flap && f.pos.y < FC.CEIL) {
    f.flapPh += dt * FC.FLAP_HZ * Math.PI * 2;
    f.flapPow += (1 - f.flapPow) * (1 - Math.exp(-6 * dt));
  } else {
    // completa il ciclo e torna in planata, senza scatti
    if (f.flapPh % (Math.PI * 2) > 0.05) f.flapPh += dt * FC.FLAP_HZ * Math.PI * 2 * 0.8;
    f.flapPow += (0 - f.flapPow) * (1 - Math.exp(-4 * dt));
  }
  const beat = Math.max(0, Math.sin(f.flapPh));
  // un "whoosh" a ogni battuta (passaggio per l'inizio del ciclo)
  const cyc = Math.floor(f.flapPh / (Math.PI * 2));
  if (cyc !== f.flapCyc) { f.flapCyc = cyc; if (f.flapPow > 0.2) sndFlap(); }
  sndWind(f.v, f.fold);
  // in cabrata il battito rende di più (ali che 'remano'): salita decisa
  const cabra = clamp(f.pitch / 0.35, 0, 1);
  // oltre i ~110 km/h il battito non morde più: in cabrata veloce si scambia velocità con quota
  const morde = clamp(1 - (f.v - 30) / 25, 0, 1);
  const thrust = FC.FLAP_ACC * beat * f.flapPow * (1 + 0.9 * cabra) * morde;
  // bilancio di velocità lungo la prua
  // ad alta velocità il grifone si 'chiude' e la resistenza cala: la picchiata ripida arriva a VMAX
  const chiuso = 1 - 0.46 * clamp((f.v - 25) / 25, 0, 1) - 0.33 * f.fold;
  const drag = FC.CD * f.v * f.v * chiuso * (1 + 1.4 * (1 - Math.cos(f.roll)));
  let dv = -FC.G * Math.sin(f.pitch) - drag + thrust;
  if (f.v < FC.VSTALL + 1 && f.pitch > 0) dv -= 1.5;     // cabrata lenta: il muso perde ancora
  // richiamare costa energia: piu' e' brusca la cabrata (fattore di carico), piu' si frena
  if (f.pitchV > 0) dv -= 0.22 * f.pitchV * f.v;
  // effetto suolo: negli ultimi metri l'aria "porta" un po' di piu'
  if (f.agl < 12) dv += 0.4 * (1 - f.agl / 12);
  f.v = clamp(f.v + dv * dt, 3, FC.VMAX);
  // stallo
  if (!f.stall && f.v < FC.VSTALL && f.pitch > -0.25) { f.stall = true; f.stallT = 0; }
  if (f.stall) { f.stallT += dt; if (f.v > FC.VSTALL + 3 && f.stallT > 0.8) f.stall = false; }
  // moto
  fwdOf(f, fwdV);
  const yPrev = f.pos.y;
  f.pos.addScaledVector(fwdV, f.v * dt);
  if (f.stall) f.pos.y -= (FC.VSTALL + 2 - f.v) * 2.2 * dt;
  f.pos.y += FC.FLAP_LIFT * beat * f.flapPow * (1 + 1.2 * cabra) * morde * dt;
  const gy = suoloVolo(f.pos.x, f.pos.z, f.pos.y);
  f.agl = gy > -1e3 ? f.pos.y - gy : 500;
  f.lift = ascendenzaAt(f.pos.x, f.pos.z, f.agl);
  f.pos.y += f.lift * dt;
  if (f.agl < 12) f.pos.y += 0.9 * (1 - f.agl / 12) * dt;      // effetto suolo
  // deriva col vento (la velocita' e' quella rispetto all'aria)
  const wv = ventoAt(f.agl);
  f.pos.x += wv[0] * dt; f.pos.z += wv[1] * dt;
  // suolo: si rimbalza sopra con perdita di velocità
  if (gy > -1e3 && f.pos.y < gy + FC.AGL_MIN) {
    if (f.v > FC.V_IMP || f.pitch < FC.PITCH_IMP) {
      // troppo veloce o troppo a muso in giù: impatto
      impatto();
      return;
    } else if (f.v < FC.V_ATT && f.pitch > -0.22) {
      // lento e in assetto: si posa
      atterra(gy);
      return;
    }
    // sfioramento: il muso viene tirato su, si perde un po' di velocità ma non ci si pianta
    f.pos.y = gy + FC.AGL_MIN;
    f.v = Math.max(f.v * 0.992, 13);
    if (f.pitch < 0.12) f.pitch = 0.12;
    f.agl = FC.AGL_MIN;
  }
  // confine morbido: oltre l'ellisse la prua viene riportata dolcemente al centro
  const ex = (f.pos.x - FC.BC[0]) / FC.BR[0], ez = (f.pos.z - FC.BC[1]) / FC.BR[1];
  const er = Math.hypot(ex, ez);
  if (er > 0.82) {
    const k = clamp((er - 0.82) / 0.18, 0, 1);
    const yawHome = Math.atan2(FC.BC[0] - f.pos.x, FC.BC[1] - f.pos.z);
    let d = yawHome - f.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    f.yaw += d * k * 1.6 * dt;
    if (er > 1.0) { f.pos.x = FC.BC[0] + ex / er * FC.BR[0]; f.pos.z = FC.BC[1] + ez / er * FC.BR[1]; }
  }
  f.vario += ((f.pos.y - yPrev) / Math.max(dt, 1e-3) - f.vario) * (1 - Math.exp(-3 * dt));
  // posa del grifone: leggera oscillazione in planata, ali che seguono il battito
  gEul.set(-f.pitch, f.yaw, f.roll, 'YXZ');
  grifP.quaternion.setFromEuler(gEul);
  grifP.position.copy(f.pos);
  if (grifMat && grifMat.userData.sh) {
    const idle = Math.sin(performance.now() / 900) * 0.06 + 0.10;    // ali leggermente a diedro
    const fl = Math.sin(f.flapPh) * 0.85 * f.flapPow;
    grifMat.userData.sh.uniforms.uFlap.value = (idle * (1 - f.flapPow) + fl) * (1 - f.fold) - 0.30 * f.fold;
    grifMat.userData.sh.uniforms.uSweep.value = 1.15 * f.fold;
    grifMat.userData.sh.uniforms.uLegs.value = f.legs;
  }
  // camera d'inseguimento
  const back = 26 + f.v * 0.07;
  tmpD.set(Math.sin(f.yaw), 0, Math.cos(f.yaw));
  tmpB.copy(f.pos).addScaledVector(tmpD, -back);
  tmpB.y += 12 - f.pitch * 10 - 4 * f.fold;
  // micro-tremolio oltre i ~200 km/h
  f.shake = clamp((f.v - 56) / 28, 0, 1);
  if (f.shake > 0) {
    const tn = performance.now();
    tmpB.x += Math.sin(tn / 23) * 0.35 * f.shake; tmpB.y += Math.sin(tn / 17) * 0.3 * f.shake; tmpB.z += Math.cos(tn / 29) * 0.35 * f.shake;
  }
  const cg = suoloVolo(tmpB.x, tmpB.z, tmpB.y);
  if (cg > -1e3 && tmpB.y < cg + 4) tmpB.y = cg + 4;
  camera.position.lerp(tmpB, 1 - Math.exp(-5 * dt));
  tmpC.copy(f.pos).addScaledVector(fwdV, 30);
  camTgt.lerp(tmpC, 1 - Math.exp(-7 * dt));
  f.camRoll += (f.roll * 0.28 - f.camRoll) * (1 - Math.exp(-3 * dt));
  upV.set(Math.sin(f.camRoll), Math.cos(f.camRoll), 0);
  camera.up.copy(upV);
  camera.lookAt(camTgt);
  camera.up.set(0, 1, 0);
  // campo visivo che si allarga con la velocità: la picchiata si sente
  const fovT = 55 + 13 * clamp((f.v - 22) / 55, 0, 1);
  if (Math.abs(camera.fov - fovT) > 0.05) { camera.fov += (fovT - camera.fov) * (1 - Math.exp(-3 * dt)); camera.updateProjectionMatrix(); }
  if (SHADOWS && sunLight) {
    sunLight.position.set(f.pos.x + SUNDIR.x * 2300, f.pos.y + SUNDIR.y * 2300, f.pos.z + SUNDIR.z * 2300);
    sunLight.target.position.copy(f.pos);
    sunLight.target.updateMatrixWorld();
  }
  $('stallo').classList.toggle('on', f.stall);
  updateHUDFly();
}
// ---- a terra: ali chiuse, si riparte battendo le ali (o buttandosi da un pendio) ----
function atterra(gy){
  const f = FLY;
  f.mode = 'terra'; f.tT = 0; f.flapHold = 0; f.roll = 0; f.fold = 0; f.pitchV = 0; f.rollV = 0;
  sndTocco(); vibra(40); sndWind(0, 0);
  f.pos.y = gy + FC.H_TERRA;
  f.stall = false; $('stallo').classList.remove('on');
  // vetta vicina: scheda della cima
  let best = 1e9, bp = null;
  for (const p of route.peaks) {
    const d = Math.hypot(p.x - f.pos.x, -p.y - f.pos.z);
    if (d < best) { best = d; bp = p; }
  }
  if (bp && best < 90) openCard(schedaVetta(bp));
}
// ---- schede delle vette: testo curato + dati calcolati dalla scena ----
const PEAK_INFO = {
  'Monte Velino': ['Il tetto del massiccio e la terza vetta dell\u2019Appennino dopo il Corno Grande e il Monte Amaro. Un cono di calcare che domina la Marsica e il Fucino: la Riserva Naturale Orientata che porta il suo nome (1987) è il cuore del Parco Sirente Velino, e qui, sulle sue pareti, sono tornati a nidificare i grifoni reintrodotti negli anni Novanta.',
    'La gara non tocca la cima: la sfiora sulla spalla, a 2.385 m, il punto più alto del tracciato. Dalla croce, nelle giornate limpide, lo sguardo corre dal Gran Sasso alla Maiella, dal Sirente al Terminillo e giù fino alla piana del Fucino.'],
  'Monte Cafornia': ['La seconda cima del massiccio, gemella orientale del Velino, a cui è legata da una lunga cresta d\u2019alta quota. È il punto di partenza dei voli in questa modalità: da qui la valle è tutta davanti.',
    'La Skyrace la costeggia lungo il crinale che dal Velino porta alla Selletta, dove comincia la grande discesa verso Fonte Canale: oltre 1.100 m di dislivello in tre chilometri.'],
  'Monte di Sevice': ['La montagna della Capanna di Sevice: il rifugio ai suoi piedi, a 2.115 m, è l\u2019unico ristoro completo della gara e il secondo cancello orario (ore 12:45).',
    'Dalla sua groppa si domina la conca della capanna e la lunga dorsale del Rozza da cui arrivano gli atleti.'],
  'Monte Costognillo': ['Un\u2019anticima fra il Sevice e il Velino, sul bordo dell\u2019altopiano sommitale.',
    'Sotto di lei passano le Tre Sorelle, il tratto più aereo della gara, prima dell\u2019attacco al cono del Velino.'],
  'Cima Avezzano': ['Una delle cime che chiudono a nord-est il gruppo del Velino, affacciata sui valloni che scendono verso i Piani di Pezza.',
    'Fuori dal tracciato ma a un tiro d\u2019ala dalla spalla del Velino: da qui si vede tutta la cresta percorsa dalla gara.'],
  'Le Tre Sorelle': ['Tre groppe erbose in fila, a 2.200 m, sul filo fra la Val di Teve e i pascoli di Sevice. Il nome viene dalla loro forma: tre gobbe gemelle una dietro l\u2019altra.',
    'La gara le percorre tutte, dal km 15 al km 16,7, prima di rasentare le pareti della Val di Teve: è il balcone più bello del giro.'],
  'Monte Rozza': ['La lunga dorsale che sale da Passo Le Forche verso la Capanna di Sevice: il \u201c3B\u201d, la salita più lunga della gara.',
    'Dal suo crinale, al km 12,6, si apre il balcone sulla Val di Teve, la valle selvaggia nel cuore della Riserva.'],
  'Cimata Fossa dei Cavalli': ['Una cimata erbosa a est del Velino, sopra la Fossa dei Cavalli: un tempo i pascoli estivi delle mandrie in monticazione.',
    'Fuori dal percorso, ma sorvegliata da vicino dai grifoni che sfruttano le ascendenze di questi versanti.'],
  'Punta Trento': ['Con la vicina Punta Trieste forma una coppia di cime sul lato orientale del massiccio, battezzate con i nomi delle città redente dopo la Grande Guerra.', ''],
  'Punta Trieste': ['La gemella di Punta Trento, poco più a est: due punte sulla stessa cresta, sopra i valloni che scendono verso i Piani di Pezza.', ''],
  'Murolungo': ['Il \u201cmuro lungo\u201d che chiude a ovest la Val di Teve: una bastionata di pareti calcaree fra le più selvagge del Parco, regno di grifoni e di silenzio.',
    'Sta di fronte al crinale del Rozza: è la montagna che gli atleti hanno davanti quando si affacciano sulla Val di Teve.'],
  'Iaccio dei Montoni': ['Uno \u201ciaccio\u201d è, nel dialetto dei pastori, il recinto dove si chiudevano le greggi la notte: il nome racconta secoli di monticazione su queste montagne.', ''],
  'Capo di Pezza': ['La cima che sovrasta i Piani di Pezza, il grande altopiano carsico sul versante di Rocca di Mezzo.', ''],
  'Cimata della Selva del Coco': ['Una cimata boscosa sul versante nord-orientale del massiccio, dove la faggeta sale fin quasi in cresta.', ''],
  'Monte il Bicchero': ['Una cima secondaria sul lato nord del gruppo, fra il Velino e i Piani di Pezza.', ''],
  'Costone': ['Il nome dice tutto: un lungo costone erboso sulle propaggini settentrionali del massiccio.', ''],
  'Colle delle Trincere': ['Un colle sul versante nord-orientale; il nome ricorda vecchie linee di trincea, forse legate alle esercitazioni militari del secolo scorso.', ''],
  'Cima della Sentina': ['Una cima delle propaggini sud-orientali del Velino, sopra i paesi della piana.',
    'Da qui si dominano Massa d\u2019Albe e i resti di Alba Fucens, la città romana ai piedi del monte.'],
  'La Difensola': ['Un colle boscoso sopra Massa d\u2019Albe: la \u201cdifesa\u201d era il bosco protetto dalla comunità, dove il taglio era regolato.',
    'Sotto di lei la gara torna verso Magliano lungo il sentiero E1, dopo Fonte Canale.'],
  'Punta Canale': ['Il rilievo che dà il nome a Fonte Canale, il fontanile di sorgente dove gli atleti trovano l\u2019ultimo punto acqua (km 24,3).', ''],
  'Monte Rastegliu': ['Una collina boscosa sopra Massa d\u2019Albe, sul lato della piana del Fucino.', ''],
  'Monte della Maddalena': ['La collina che chiude a ovest la conca di Magliano de\u2019 Marsi, dalla parte opposta al Velino.',
    'Dalla sua cima si vede tutto il giro: il paese, le colline di Rosciolo e, dietro, l\u2019intero massiccio.']
};
function schedaVetta(p){
  const info = PEAK_INFO[p.n] || ['Una delle cime del gruppo del Velino.', ''];
  const px = p.x, pz = -p.y;
  // quanto si domina Magliano e quanto è lontana in linea d'aria
  posAt(0, tmpA);
  const dMag = Math.hypot(tmpA.x - px, tmpA.z - pz) / 1000;
  const disl = p.e - 729;
  // punto della gara più vicino
  let bd = 1e9, bi = 0;
  for (let i = 0; i < N; i += 2) {
    const d = Math.hypot(route.x[i] - px, -route.y[i] - pz);
    if (d < bd) { bd = d; bi = i; }
  }
  const km = bi / (N - 1) * route.total_km;
  const z = zoneAt(km);
  let gara;
  if (bd < 250) gara = 'La gara passa proprio qui: km ' + km.toFixed(1).replace('.', ',') + ', zona \u201c' + z[2] + '\u201d.';
  else if (bd < 1500) gara = 'Il tracciato passa a ' + Math.round(bd / 50) * 50 + ' m in linea d\u2019aria: km ' + km.toFixed(1).replace('.', ',') + ', zona \u201c' + z[2] + '\u201d.';
  else gara = 'La gara resta lontana: il punto più vicino del tracciato è a ' + (bd / 1000).toFixed(1).replace('.', ',') + ' km (km ' + km.toFixed(1).replace('.', ',') + ', \u201c' + z[2] + '\u201d).';
  // vette vicine, con direzione
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const vicine = route.peaks.filter(q => q !== p).map(q => {
    const dx = q.x - px, dz = -q.y - pz, d = Math.hypot(dx, dz);
    // angolo dal nord (blender +y = nord = -z three), in senso orario
    const ang = Math.atan2(dx, -dz);
    return { q, d, dir: dirs[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8] };
  }).sort((a, b) => a.d - b.d).slice(0, 3);
  const vic = vicine.map(v => v.q.n + ' (' + v.q.e + ' m, ' + (v.d / 1000).toFixed(1).replace('.', ',') + ' km a ' + v.dir + ')').join(' · ');
  // fascia altitudinale
  let fascia;
  if (p.e >= 2000) fascia = 'Sopra i 2.000 m: praterie d\u2019altitudine e pietraie, il terreno di caccia dei grifoni, che qui planano sfruttando le ascendenze dei versanti al sole.';
  else if (p.e >= 1400) fascia = 'Siamo nella fascia della faggeta, che sul Velino sale fin verso i 1.800 m prima di lasciare il posto ai pascoli.';
  else fascia = 'Colline di querceti, coltivi e pascoli: la campagna che circonda Magliano e i borghi ai piedi del massiccio.';
  return '<h2>' + p.n + '</h2><h3>' + p.e.toLocaleString('it-IT') + ' m · sei atterrato in vetta</h3>' +
    '<p>' + info[0] + '</p>' + (info[1] ? '<p style="margin-top:8px">' + info[1] + '</p>' : '') +
    '<table><tr><th>Sopra Magliano</th><td>' + disl.toLocaleString('it-IT') + ' m di dislivello, ' + dMag.toFixed(1).replace('.', ',') + ' km in linea d\u2019aria</td></tr>' +
    '<tr><th>La gara</th><td>' + gara + '</td></tr>' +
    '<tr><th>Vette vicine</th><td>' + vic + '</td></tr>' +
    '<tr><th>Ambiente</th><td>' + fascia + '</td></tr></table>' +
    '<p style="margin-top:12px;color:var(--grigio);font-size:13px">Tieni premuto <b>BATTI</b> (o SPAZIO) per decollare; da un pendio ripido basta la picchiata.</p>';
}
function tickTerra(dt){
  const f = FLY;
  f.tT += dt;
  // frenata sul suolo lungo la prua
  f.v = Math.max(0, f.v - 14 * dt);
  fwdV.set(Math.sin(f.yaw), 0, Math.cos(f.yaw));
  f.pos.addScaledVector(fwdV, f.v * dt);
  const gy = suoloVolo(f.pos.x, f.pos.z, f.pos.y);
  if (gy > -1e3) f.pos.y = gy + FC.H_TERRA;
  f.agl = 0; f.lift = 0; f.vario = 0;
  f.pitch += (0.18 - f.pitch) * (1 - Math.exp(-3 * dt));
  f.roll += (0 - f.roll) * (1 - Math.exp(-3 * dt));
  // ali che si chiudono appena fermo
  const foldT = f.v < 2 ? 1 : 0;
  f.fold += (foldT - f.fold) * (1 - Math.exp(-3.5 * dt));
  f.legs += (1 - f.legs) * (1 - Math.exp(-4 * dt));
  // decollo: BATTI tenuto premuto, oppure ci si butta da un pendio ripido con la picchiata
  const inY = clamp(Math.max(f.keyIn[1], f.joyIn[1], f.tiltIn[1]), -1, 1);
  if (f.flap && f.v < 2) f.flapHold += dt; else f.flapHold = 0;
  let via = false;
  if (f.flapHold > 0.35) { via = true; f.v = 12; f.pitch = 0.25; }
  else if (inY > 0.5 && f.v < 2) {
    const gAhead = groundAt(f.pos.x + fwdV.x * 40, f.pos.z + fwdV.z * 40);
    if (gAhead > -1e3 && gAhead < gy - 18) { via = true; f.v = 14; f.pitch = -0.35; }
  }
  if (via) { f.mode = 'volo'; f.fold = 0; f.flapPow = 0.6; f.pos.y = gy + FC.H_TERRA + 0.3; closeModal(); }
  // posa e camera che gira piano intorno
  gEul.set(-f.pitch, f.yaw, f.roll, 'YXZ');
  grifP.quaternion.setFromEuler(gEul);
  grifP.position.copy(f.pos);
  if (grifMat && grifMat.userData.sh) {
    const idle = Math.sin(performance.now() / 900) * 0.05 + 0.08;
    // ali chiuse a terra: raccolte all'indietro lungo il corpo e appena abbassate (le punte non devono bucare il suolo)
    grifMat.userData.sh.uniforms.uFlap.value = idle * (1 - f.fold) - 0.42 * f.fold + (f.flap ? Math.sin(performance.now() / 80) * 0.5 * (1 - f.fold) : 0);
    grifMat.userData.sh.uniforms.uSweep.value = 1.05 * f.fold;
    grifMat.userData.sh.uniforms.uLegs.value = f.legs;
  }
  f.orbit += dt * 0.18;
  const ang = f.yaw + Math.PI + f.orbit;
  tmpB.set(f.pos.x + Math.sin(ang) * 20, f.pos.y + 7, f.pos.z + Math.cos(ang) * 20);
  const cg = terraVera(tmpB.x, tmpB.z, tmpB.y);
  if (cg > -1e3 && tmpB.y < cg + 2.5) tmpB.y = cg + 2.5;
  camera.position.lerp(tmpB, 1 - Math.exp(-2.5 * dt));
  camTgt.lerp(tmpC.copy(f.pos).setY(f.pos.y - 1), 1 - Math.exp(-4 * dt));
  camera.up.set(0, 1, 0); camera.lookAt(camTgt);
  if (Math.abs(camera.fov - 55) > 0.05) { camera.fov += (55 - camera.fov) * (1 - Math.exp(-3 * dt)); camera.updateProjectionMatrix(); }
  if (SHADOWS && sunLight) {
    sunLight.position.set(f.pos.x + SUNDIR.x * 2300, f.pos.y + SUNDIR.y * 2300, f.pos.z + SUNDIR.z * 2300);
    sunLight.target.position.copy(f.pos); sunLight.target.updateMatrixWorld();
  }
  hudFlyT++;
  if (hudFlyT % 6 === 0) {
    $('v-km').textContent = Math.round(f.v * 3.6);
    $('v-q').innerHTML = Math.round(route.elev_a * f.pos.y + route.elev_b) + '<span class="unit"> m</span>';
    $('v-p').innerHTML = '0,0<span class="unit"> m/s</span>';
    $('zona-n').textContent = f.v < 2 ? 'A terra · ali chiuse' : 'Atterraggio';
    $('zona-s').textContent = f.v < 2 ? 'tieni premuto BATTI per decollare' : '';
    drawMiniPos();
  }
}
// ---- impatto: capriola, schermo che sfuma, si riparte dal Cafornia ----
// suolo VERO (mesh del terreno) in un punto: la griglia di groundAt e' grossolana e in
// certi punti sta sotto la mesh, e il grifone finiva "sotto terra"
// Indice spaziale dei triangoli della mesh del terreno (celle di 60 m in pianta):
// il raycast di three su 360k triangoli costa ~100 ms, questo ~0,02 ms.
let TERR = null, TIDX = null;
function buildTerrIndex(){
  scene.traverse(o => { if (!TERR && o.isMesh && (o.name || '').startsWith('Terrain')) TERR = o; });
  if (!TERR) return null;
  const g = TERR.geometry, pos = g.getAttribute('position');
  TERR.updateMatrixWorld(true);
  const n = pos.count, P = new Float32Array(n * 3), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(TERR.matrixWorld); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z; }
  const idx = g.index ? g.index.array : null;
  const nt = idx ? idx.length / 3 : n / 3;
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (let i = 0; i < n; i++) { const x = P[i * 3], z = P[i * 3 + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  const C = 60, nx = Math.ceil((x1 - x0) / C) + 1, nz = Math.ceil((z1 - z0) / C) + 1;
  const cells = new Array(nx * nz);
  const tri = (t, k) => idx ? idx[t * 3 + k] : t * 3 + k;
  for (let t = 0; t < nt; t++) {
    const a = tri(t, 0), b = tri(t, 1), c = tri(t, 2);
    const xa = P[a * 3], xb = P[b * 3], xc = P[c * 3], za = P[a * 3 + 2], zb = P[b * 3 + 2], zc = P[c * 3 + 2];
    const cx0 = Math.floor((Math.min(xa, xb, xc) - x0) / C), cx1 = Math.floor((Math.max(xa, xb, xc) - x0) / C);
    const cz0 = Math.floor((Math.min(za, zb, zc) - z0) / C), cz1 = Math.floor((Math.max(za, zb, zc) - z0) / C);
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      const k = cz * nx + cx;
      (cells[k] || (cells[k] = [])).push(t);
    }
  }
  return { P, tri, x0, z0, C, nx, nz, cells };
}
function terraVera(x, z, yHint){
  const gg = groundAt(x, z);
  if (!TIDX) { try { TIDX = buildTerrIndex(); } catch (e) { console.warn('indice terreno:', e); } if (!TIDX) return gg; }
  const T = TIDX;
  const cx = Math.floor((x - T.x0) / T.C), cz = Math.floor((z - T.z0) / T.C);
  if (cx < 0 || cz < 0 || cx >= T.nx || cz >= T.nz) return gg;
  const list = T.cells[cz * T.nx + cx];
  if (!list) return gg;
  const P = T.P;
  let best = -1e4;
  for (const t of list) {
    const a = T.tri(t, 0), b = T.tri(t, 1), c = T.tri(t, 2);
    const xa = P[a * 3], za = P[a * 3 + 2], xb = P[b * 3], zb = P[b * 3 + 2], xc = P[c * 3], zc = P[c * 3 + 2];
    const d = (zb - zc) * (xa - xc) + (xc - xb) * (za - zc);
    if (Math.abs(d) < 1e-9) continue;
    const l1 = ((zb - zc) * (x - xc) + (xc - xb) * (z - zc)) / d;
    const l2 = ((zc - za) * (x - xc) + (xa - xc) * (z - zc)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
    const y = l1 * P[a * 3 + 1] + l2 * P[b * 3 + 1] + l3 * P[c * 3 + 1];
    if (y > best) best = y;
  }
  return best > -1e3 ? best : gg;
}
// quota del suolo per il volo: griglia lontano dal suolo, mesh vera (raycast, ogni 4 frame)
// quando si e' sotto i 120 m — la griglia sbaglia anche di 20 m e il grifone finiva sotto terra
let gyCache = { x: 0, z: 0, y: -1e4, n: 0 };
function suoloVolo(x, z, y){
  const gg = groundAt(x, z);
  if (gg < -1e3 || y - gg > 120) return gg;
  const t = terraVera(x, z, y);
  return t > -1e3 ? t : gg;
}
function impatto(){
  const f = FLY;
  f.mode = 'impatto'; f.tT = 0;
  sndBotta(); vibra([120, 60, 80]); sndWind(0, 0);
  f.tumble = [Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 8 - 4];
  f.impPos = f.pos.clone(); f.impYaw = f.yaw;
  f.v = Math.min(f.v, 9);
  const gt = terraVera(f.pos.x, f.pos.z, f.pos.y);
  if (gt > -1e3) f.pos.y = gt + 2.1;
  $('impatto').classList.add('on');
  $('stallo').classList.remove('on');
}
// si riparte dallo stesso punto, ma in alto e in planata
function ripartiDaImpatto(){
  const f = FLY;
  const gt = terraVera(f.impPos.x, f.impPos.z, f.impPos.y);
  f.pos.set(f.impPos.x, (gt > -1e3 ? gt : f.impPos.y) + 230, f.impPos.z);
  f.yaw = f.impYaw; f.pitch = FC.PITCH_GLIDE; f.roll = 0; f.v = 20; f.pitchV = 0; f.rollV = 0;
  f.stall = false; f.flap = false; f.flapPow = 0; f.vario = 0; f.fold = 0; f.tumble = null;
  f.mode = 'volo'; f.tT = 0;
  grifP.rotation.set(0, 0, 0);
  $('fade').style.opacity = 0; $('impatto').classList.remove('on');
  fwdOf(f, fwdV);
  camera.position.copy(f.pos).addScaledVector(fwdV, -34); camera.position.y += 12;
  camTgt.copy(f.pos);
}
function tickImpatto(dt){
  const f = FLY;
  f.tT += dt;
  const T = 1.7;
  // il grifone rotola sul posto e rimbalza, sempre SOPRA la mesh del terreno
  f.v = Math.max(0, f.v - 20 * dt);
  fwdV.set(Math.sin(f.yaw), 0, Math.cos(f.yaw));
  f.pos.addScaledVector(fwdV, f.v * dt);
  const gt = terraVera(f.pos.x, f.pos.z, f.pos.y);
  const hop = 5 * Math.abs(Math.sin(f.tT * 7)) * Math.exp(-2.2 * f.tT);
  if (gt > -1e3) f.pos.y = gt + 2.1 + hop;
  grifP.rotation.x += f.tumble[0] * dt; grifP.rotation.y += f.tumble[1] * dt; grifP.rotation.z += f.tumble[2] * dt;
  grifP.position.copy(f.pos);
  if (grifMat && grifMat.userData.sh) { grifMat.userData.sh.uniforms.uFlap.value = Math.sin(performance.now() / 60) * 0.9; grifMat.userData.sh.uniforms.uSweep.value = 0; }
  // camera alta e arretrata, cosi' il grifone resta in vista anche su un pendio
  tmpB.set(f.pos.x - fwdV.x * 22, f.pos.y + 14, f.pos.z - fwdV.z * 22);
  const cg = terraVera(tmpB.x, tmpB.z, tmpB.y);
  if (cg > -1e3 && tmpB.y < cg + 8) tmpB.y = cg + 8;
  camera.position.lerp(tmpB, 1 - Math.exp(-5 * dt));
  camTgt.lerp(f.pos, 1 - Math.exp(-6 * dt)); camera.up.set(0, 1, 0); camera.lookAt(camTgt);
  $('fade').style.opacity = clamp((f.tT - 0.6) / 0.8, 0, 1);
  if (f.tT > T) ripartiDaImpatto();
}
let hudFlyT = 0;
function updateHUDFly(){
  const f = FLY;
  hudFlyT += 1;
  if (hudFlyT % 6) { drawMiniPos(); return; }
  const kmh = Math.round(f.v * 3.6);
  $('v-km').textContent = kmh;
  $('v-q').innerHTML = Math.round(route.elev_a * f.pos.y + route.elev_b) + '<span class="unit"> m</span>';
  const vr = (route.elev_a * f.vario);
  $('v-p').innerHTML = (vr > 0 ? '+' : '') + vr.toFixed(1).replace('.', ',') + '<span class="unit"> m/s</span>';
  // vetta più vicina (in pianta) entro 1,5 km, altrimenti quota del suolo
  let best = 1e9, bp = null;
  for (const p of route.peaks) {
    const d = Math.hypot(p.x - f.pos.x, -p.y - f.pos.z);
    if (d < best) { best = d; bp = p; }
  }
  if (bp && best < 1500) {
    $('zona-n').textContent = bp.n;
    $('zona-s').textContent = Math.round(best) + ' m in pianta · vetta ' + bp.e + ' m';
  } else {
    $('zona-n').textContent = f.fold > 0.6 ? 'A proiettile · ali chiuse' : 'Grifone del Velino';
    let asc = '';
    if (ASC.termica > 0.8 && ASC.termica >= ASC.sole) asc = ' · termica';
    else if (ASC.pendio > 0.8) asc = ' · ascendenza di pendio';
    else if (ASC.sole > 0.8) asc = ' · versante al sole';
    else if (ASC.turb > 0.3) asc = ' · turbolenza sottovento';
    $('zona-s').textContent = 'suolo a ' + Math.round(route.elev_a * f.agl) + ' m sotto di te' + asc;
  }
  const vb = $('vario');
  if (vb) {
    const i = vb.firstElementChild, h = clamp(vr / 6, -1, 1) * 50;
    i.style.top = (h > 0 ? 50 - h : 50) + '%'; i.style.height = Math.abs(h) + '%';
    i.style.background = vr > 0.3 ? '#f4951f' : (vr < -3 ? '#c8102e' : '#8d99a6');
  }
  drawMiniPos();
}
function bindFlyUI(){
  // joystick virtuale
  const joy = $('joy'), knob = $('joy-k');
  let jid = null;
  const R = () => joy.clientWidth / 2;
  const set = e => {
    const r = joy.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const m = Math.hypot(dx, dy), rm = R() - 24;
    if (m > rm) { dx *= rm / m; dy *= rm / m; }
    knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    // zona morta al centro, curva morbida
    const cv = v => { const a = Math.abs(v); return a < 0.1 ? 0 : Math.sign(v) * Math.pow((a - 0.1) / 0.9, 1.4); };
    FLY.joyIn = [cv(dx / rm), cv(-dy / rm)];
  };
  joy.addEventListener('pointerdown', e => { jid = e.pointerId; joy.setPointerCapture(jid); set(e); e.preventDefault(); });
  joy.addEventListener('pointermove', e => { if (e.pointerId === jid) set(e); });
  const rel = e => { if (e.pointerId !== jid) return; jid = null; FLY.joyIn = [0, 0]; knob.style.transform = ''; };
  joy.addEventListener('pointerup', rel); joy.addEventListener('pointercancel', rel);
  // pulsante battito
  const bf = $('b-flap');
  const on = e => { e.preventDefault(); FLY.flap = true; bf.classList.add('on'); };
  const off = () => { FLY.flap = false; bf.classList.remove('on'); };
  bf.addEventListener('pointerdown', on);
  bf.addEventListener('pointerup', off); bf.addEventListener('pointercancel', off); bf.addEventListener('pointerleave', off);
  // inclinazione del telefono
  $('b-tilt').onclick = () => { if (FLY.tilt) tiltOff(); else tiltOn(); };
  const bs = $('b-snd'); if (bs) bs.onclick = sndToggle;
}
function onTilt(e){
  if (!FLY.on || !FLY.tilt) return;
  let b = e.beta, g = e.gamma;
  if (b === null || g === null) return;
  // in orizzontale (telefono girato) gli assi si scambiano
  const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  let fb, lr;
  if (ang === 90) { fb = -g; lr = b; } else if (ang === -90 || ang === 270) { fb = g; lr = -b; } else { fb = b; lr = g; }
  if (!FLY.tiltBase) { FLY.tiltBase = [fb, lr]; return; }
  const dy = FLY.tiltBase[0] - fb, dx = lr - FLY.tiltBase[1];   // in avanti = picchiata
  const cv = v => { const a = Math.abs(v); return a < 3 ? 0 : Math.sign(v) * Math.min(1, (a - 3) / 22); };
  FLY.tiltIn = [cv(dx), cv(dy)];
}
async function tiltOn(){
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') return;
    }
  } catch (e) { return; }
  FLY.tilt = true; FLY.tiltBase = null; FLY.tiltIn = [0, 0];
  $('b-tilt').classList.add('on'); $('b-tilt').textContent = 'TIENI IL TELEFONO COSÌ';
  $('joy').style.opacity = '0.35';
  addEventListener('deviceorientation', onTilt);
  setTimeout(() => { if (FLY.tilt) $('b-tilt').textContent = 'INCLINAZIONE ATTIVA'; }, 1800);
}
function tiltOff(){
  if (!FLY.tilt) return;
  FLY.tilt = false; FLY.tiltIn = [0, 0]; FLY.tiltBase = null;
  removeEventListener('deviceorientation', onTilt);
  $('b-tilt').classList.remove('on'); $('b-tilt').textContent = 'INCLINA IL TELEFONO';
  $('joy').style.opacity = '';
}

// ---------- ciclo ----------
let fpsAcc = 0, fpsN = 0, fpsT = 0, degraded = false;
function tick(){
  const dt = Math.min(clock.getDelta(), 0.05);
  if (SKY) SKY.position.copy(camera.position);
  if (NUVOLE.length) tickNuvole(dt);
  if (VENTO_SH.length) { const tt = performance.now() / 1000; for (const sh of VENTO_SH) sh.uniforms.uT.value = tt; }
  if (FLY.on) {
    tickFly(dt);
    if (mixer) mixer.update(0);
    const tNow0 = performance.now() / 1000;
    for (const m of grifs) {
      const g = m.userData.g;
      const ph = g.ph0 + g.rate * tNow0;
      m.position.set(g.c[0] + g.r * Math.cos(ph), g.c[2] + Math.sin(tNow0 * 0.6 + g.ph0) * 4, -(g.c[1] + g.r * Math.sin(ph)));
      m.rotation.y = ph + Math.PI / 2 + Math.PI;
    }
    tickPeaks(dt);
    renderer.render(scene, camera);
    fpsAcc += dt; fpsN++; fpsT += dt;
    if (fpsT > 4 && !degraded) {
      if (fpsN / fpsT < 26) { degraded = true; renderer.setPixelRatio(1); scene.fog.far = 3800; }
      fpsN = 0; fpsT = 0;
    }
    return;
  }
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
    st.s = clamp(st.s + (st.dir || st.lastDir || 1) * st.speed * dt, S0_ARCO, TOT);
  }
  // Lino
  posAt(st.s, tmpA); tanAt(st.s, tmpB);
  lino.position.copy(tmpA);
  const rotY = Math.atan2(-tmpB.z, tmpB.x);
  const pitch = Math.asin(clamp(tmpB.y, -0.75, 0.75));
  lino.quaternion.setFromEuler(new THREE.Euler(0, rotY, 0));
  lino.rotateZ(-0.10 - pitch * 0.18);
  if (mixer) { mixer.timeScale = clamp(0.25 + st.speed / 42, 0, 2.6) * (st.speed < 1 ? 0 : 1); mixer.update(dt); }
  // camera
  tanAt(st.s + 8, tmpC);
  if (st.view === 'fpv') {
    tmpD.copy(tmpA).addScaledVector(tmpC, 2.5); tmpD.y += 8.8;
    // NIENTE clamp suolo in prima persona: groundAt (griglia coarse) sta
    // sopra la linea del percorso fino a +22 e il vecchio clamp post-lerp
    // (suolo+13 > occhio+8.8 sul 98% del tracciato) faceva tremare la vista.
    // Raycast sulla mesh vera: 0/75 campioni sopra l'occhio -> sicuro.
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
      const bnd = clamp((st.s - 15700) / 600, 0, 1) * clamp((18400 - st.s) / 600, 0, 1);
      tmpD.copy(tmpA).addScaledVector(tmpC, -(80 + 78 * kv) * (1 - 0.18 * bnd));
      tmpD.y = tmpA.y + (42 + 88 * kv) * (1 - 0.42 * bnd);
      camera.position.lerp(tmpD, 1 - Math.exp(-2.6 * dt));
    }
    controls.update();
  }
  if (st.view !== 'fpv') {
    const gmin = groundAt(camera.position.x, camera.position.z) + 13;
    if (camera.position.y < gmin) camera.position.y = gmin;
  }
  if (SHADOWS && sunLight) {
    sunLight.position.set(tmpA.x + SUNDIR.x * 2300, tmpA.y + SUNDIR.y * 2300, tmpA.z + SUNDIR.z * 2300);
    sunLight.target.position.copy(tmpA);
    sunLight.target.updateMatrixWorld();
  }
  // grifoni
  const tNow = performance.now() / 1000;
  for (const m of grifs) {
    const g = m.userData.g;
    const ph = g.ph0 + g.rate * tNow;
    m.position.set(g.c[0] + g.r * Math.cos(ph), g.c[2] + Math.sin(tNow * 0.6 + g.ph0) * 4, -(g.c[1] + g.r * Math.sin(ph)));
    m.rotation.y = ph + Math.PI / 2 + Math.PI;
  }
  tickPeaks(dt);
  updateHUD();
  renderer.render(scene, camera);
  // guardia prestazioni
  fpsAcc += dt; fpsN++; fpsT += dt;
  if (fpsT > 4 && !degraded) {
    if (fpsN / fpsT < 26) { degraded = true; renderer.setPixelRatio(1); scene.fog.far = FLY.on ? 3800 : 12000; }
    fpsN = 0; fpsT = 0;
  }
}
function tickPeaks(dt){
  peakT += dt;
  if (peakItems.length && peakT > 0.15) {
    peakT = 0;
    for (const g of peakItems) {
      const d = camera.position.distanceTo(g.position);
      g.visible = d < 7500;
      if (!g.visible) continue;
      let o = d < 1400 ? 1 : Math.max(0, 1 - (d - 1400) / 3000);
      // in volo l'asta e la bandierina sfumano quando il grifone ci arriva addosso
      let vic = 1;
      if (FLY.on) { const dg = FLY.pos.distanceTo(g.position); vic = clamp((dg - 50) / 110, 0, 1); }
      g.userData.lbl.material.opacity = o * vic;
      g.userData.asta.material.opacity = 0.5 * vic;
      g.userData.flag.material.opacity = 0.62 * vic;
      const s2 = clamp(d * 0.11, 44, 190);
      const hh = s2 * 0.1875;
      g.userData.lbl.scale.set(hh * (g.userData.lbl.userData.aspect || 5.33), hh, 1);
      g.userData.flag.rotation.y = Math.sin(performance.now() / 1400 + g.position.x) * 0.7;
    }
  }
}
