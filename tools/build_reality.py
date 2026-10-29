#!/usr/bin/env python3
"""Terreno "reale" per SRMExplorer (branch reality_explorer).

Da Tinitaly 1.1 (DEM 10 m, INGV, CC BY 4.0 - Tarquini et al. 2023) e dall'ortofoto PCN 2012
(MATTM, WMS) scaricati in build/reality/ produce:
  assets/dem10.bin + dem10.json   griglia quote 10 m in coordinate scena (riga 0 = sud), uint16 x0.1 (+off)
  assets/orto/base.jpg            ortofoto 4096 px dell'intera griglia (nord in alto)
  assets/orto/t_I_J.jpg           tasselli 1024 px per ogni chunk (I colonna x, J riga y crescente = nord)
Vicino al centro di Magliano (piazza) le quote si fondono con la mesh di Blender (il paese a mano).
"""
import json, math, sys, os, time
import numpy as np, tifffile
from PIL import Image
from scipy.ndimage import map_coordinates
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import scene_to_utm, ELEV_A, ELEV_B

SRC = os.environ.get('SRC', '/mnt/user-data/uploads/Skyrace_Lino_Blender_Project/build/reality')   # sul PC: Desktop/Skyrace_Lino_Blender_Project/build/reality
OUT = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/reality/out'
os.makedirs(OUT + '/orto', exist_ok=True)

STEP = 10.0
X0, Y0 = -6981.0, -7973.0
NC = 128                       # celle per chunk (1280 m)
NCX, NCY = 10, 11              # chunk: 1280 m x 10 = 12,8 km ; 1408 m x 11 = 14,1 km
NX, NY = NCX * NC + 1, NCY * NC + 1
X1, Y1 = X0 + (NX - 1) * STEP, Y0 + (NY - 1) * STEP
PIAZZA = (-1515.5, -4868.0)    # centro di Magliano (x, y nord) in scena
R_IN, R_OUT = 500.0, 1150.0    # fusione con la mesh di Blender

t0 = time.time()
# ---------- DEM ----------
dem = tifffile.imread(SRC + '/tinitaly_int.tif').astype(np.float32)
J = json.load(open(SRC + '/tinitaly_int.json'))
H, W = dem.shape
xs = X0 + STEP * np.arange(NX); ys = Y0 + STEP * np.arange(NY)
gx, gy = np.meshgrid(xs, ys)                       # [NY, NX], riga 0 = sud
E, N = scene_to_utm(gx.ravel(), gy.ravel())
u = (E - J['E0']) / J['px']; v = (J['N1'] - N) / J['px']
e_new = map_coordinates(dem, [v, u], order=1, mode='nearest').reshape(NY, NX)
print('DEM nuovo: %.0f..%.0f m, fuori dal tif: %d nodi' % (e_new.min(), e_new.max(), ((u < 0) | (u > W - 1) | (v < 0) | (v > H - 1)).sum()))

# mesh di Blender (quote scena -> metri)
TER = os.environ.get('TER_DIR', '/home/claude/rig')      # ter_pos.f32 / ter_idx.u32 da dump_terrain.mjs
pos = np.fromfile(TER + '/ter_pos.f32', dtype=np.float32).reshape(-1, 3)
idx = np.fromfile(TER + '/ter_idx.u32', dtype=np.uint32).reshape(-1, 3)
d = np.hypot(gx - PIAZZA[0], gy - PIAZZA[1])
e_old = np.full_like(e_new, np.nan)
# rasterizzazione diretta dei triangoli della mesh (non e' una triangolazione planare valida):
# per ogni nodo entro R_OUT il triangolo piu' alto che lo contiene, come terraVera()
P = pos.copy(); P[:, 2] = -P[:, 2]            # x, y_scena, nord
tx = P[idx, 0]; ty = P[idx, 2]; tz = P[idx, 1] * ELEV_A + ELEV_B
bx0, bx1 = tx.min(1), tx.max(1); by0, by1 = ty.min(1), ty.max(1)
R = R_OUT + 60
sel = np.where((bx1 > PIAZZA[0] - R) & (bx0 < PIAZZA[0] + R) & (by1 > PIAZZA[1] - R) & (by0 < PIAZZA[1] + R))[0]
best = np.full_like(e_new, -1e9)
for t in sel:
    i0 = max(0, int(math.floor((bx0[t] - X0) / STEP))); i1 = min(NX - 1, int(math.ceil((bx1[t] - X0) / STEP)))
    j0 = max(0, int(math.floor((by0[t] - Y0) / STEP))); j1 = min(NY - 1, int(math.ceil((by1[t] - Y0) / STEP)))
    if i1 < i0 or j1 < j0: continue
    X = gx[j0:j1 + 1, i0:i1 + 1]; Y = gy[j0:j1 + 1, i0:i1 + 1]
    xa, xb, xc = tx[t]; ya, yb, yc = ty[t]; za, zb, zc = tz[t]
    den = (yb - yc) * (xa - xc) + (xc - xb) * (ya - yc)
    if abs(den) < 1e-9: continue
    l1 = ((yb - yc) * (X - xc) + (xc - xb) * (Y - yc)) / den
    l2 = ((yc - ya) * (X - xc) + (xa - xc) * (Y - yc)) / den
    l3 = 1 - l1 - l2
    inside = (l1 >= -1e-4) & (l2 >= -1e-4) & (l3 >= -1e-4)
    z = l1 * za + l2 * zb + l3 * zc
    sub = best[j0:j1 + 1, i0:i1 + 1]
    np.maximum(sub, np.where(inside, z, -1e9), out=sub)
e_old[(best > -1e8) & (d < R_OUT + 50)] = best[(best > -1e8) & (d < R_OUT + 50)]
w = np.clip((d - R_IN) / (R_OUT - R_IN), 0, 1); w = w * w * (3 - 2 * w)   # 0 = Blender, 1 = Tinitaly
ok = ~np.isnan(e_old)
e_mix = e_new.copy()
e_mix[ok] = e_old[ok] * (1 - w[ok]) + e_new[ok] * w[ok]
print('fusione Magliano: %d nodi, scarto Blender-Tinitaly nel nucleo: med %.1f m' % (ok.sum(), np.nanmedian((e_old - e_new)[d < R_IN])))
y_sc = (e_mix - ELEV_B) / ELEV_A                   # quote scena
OFF = -200.0; SC = 0.05
q = np.round((y_sc - OFF) / SC).astype(np.int64)
assert q.min() >= 0 and q.max() < 65536, (q.min(), q.max())
q.astype('<u2').tofile(OUT + '/dem10.bin')
json.dump({'x0': X0, 'y0': Y0, 'x1': X1, 'y1': Y1, 'nx': NX, 'ny': NY, 'scala': SC, 'off': OFF, 'passo': STEP,
           'chunk': NC, 'ncx': NCX, 'ncy': NCY, 'file': 'dem10.bin', 'riga0': 'sud',
           'fonte': 'Tinitaly 1.1 (INGV, CC BY 4.0, Tarquini et al. 2023) 10 m; fuso con la mesh Blender entro %d-%d m dalla piazza' % (R_IN, R_OUT)},
          open(OUT + '/dem10.json', 'w'))
print('dem10.bin: %d x %d, %.1f MB  (%.0fs)' % (NX, NY, q.nbytes / 1e6, time.time() - t0))

# ---------- ortofoto ----------
# (il WMS PCN in EPSG:32632 restituisce immagini spostate di ~1 km: si usa EPSG:4326)
O = json.load(open(SRC + '/ll/ll.json'))
nt, px = O['nt'], O['px']
big = np.zeros((nt * px, nt * px, 3), np.uint8)       # riga 0 = nord
for i in range(nt):
    for j in range(nt):
        im = np.asarray(Image.open('%s/ll/ll_%d_%d.jpg' % (SRC, i, j)).convert('RGB'))
        big[(nt - 1 - j) * px:(nt - j) * px, i * px:(i + 1) * px] = im
GW, GH = nt * px, nt * px
print('ortofoto sorgente: %d px, ~%.2f x %.2f m/px' % (GW, (O['lon1'] - O['lon0']) * 111320 * math.cos(math.radians(42.13)) / GW, (O['lat1'] - O['lat0']) * 110574 / GH))
from geo import scene_to_latlon
def resample(x0, y0, x1, y1, n, nome, qual=82):
    """immagine n x n (nord in alto) del rettangolo scena [x0,x1]x[y0,y1]"""
    xx = x0 + (x1 - x0) * (np.arange(n) + 0.5) / n
    yy = y1 - (y1 - y0) * (np.arange(n) + 0.5) / n
    gx2, gy2 = np.meshgrid(xx, yy)
    la, lo = scene_to_latlon(gx2.ravel(), gy2.ravel())
    cu = (lo - O['lon0']) / (O['lon1'] - O['lon0']) * GW - 0.5; cv = (O['lat1'] - la) / (O['lat1'] - O['lat0']) * GH - 0.5
    out = np.stack([map_coordinates(big[:, :, c], [cv, cu], order=1, mode='nearest') for c in range(3)], -1).reshape(n, n, 3)
    Image.fromarray(out.astype(np.uint8)).save(nome, quality=qual, optimize=True, subsampling=1)

resample(X0, Y0, X1, Y1, 3072, OUT + '/orto/base.jpg', 78)
print('base.jpg (%.0fs)' % (time.time() - t0))
TP = 1024
for I in range(NCX):
    for Jc in range(NCY):
        cx0 = X0 + I * NC * STEP; cy0 = Y0 + Jc * NC * STEP
        resample(cx0, cy0, cx0 + NC * STEP, cy0 + NC * STEP, TP, '%s/orto/t_%d_%d.jpg' % (OUT, I, Jc))
print('tasselli %dx%d da %d px (%.0fs)' % (NCX, NCY, TP, time.time() - t0))
json.dump({'x0': X0, 'y0': Y0, 'x1': X1, 'y1': Y1, 'n': 3072, 'file': 'orto/base.jpg', 'nord_in_alto': True,
           'tasselli': {'ncx': NCX, 'ncy': NCY, 'px': TP, 'file': 'orto/t_I_J.jpg', 'nota': 'I colonna (x), J riga (y nord crescente)'},
           'fonte': 'Ortofoto 2012 PCN - MATTM (WMS, EPSG:4326), riproiettata sugli assi della scena'}, open(OUT + '/orto10.json', 'w'))
