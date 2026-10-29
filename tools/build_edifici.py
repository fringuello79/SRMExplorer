# Edifici dei borghi dalle impronte OSM (cache di Blender) -> assets/edifici.json in coordinate di scena (metri).
# rect: [cx, cz, ang, w, l, h, tipo]  (ang = rotazione del lato lungo, radianti, nel piano x/z di three)
# poly: {"p": [[x,z],...], "h": h, "t": tipo}
import json, math, sys, collections
g = json.load(open('/mnt/user-data/uploads/Skyrace_Lino_Blender_Project/build/dem_ext/georef.json'))
th = g['theta']; s = g['s']; c0 = math.cos(math.radians(g['lat0'])) * 111320
def tosc(lat, lon):
    E = (lon - g['lon0']) * c0; N = (lat - g['lat0']) * 110574
    ex = (E - g['tx']) / s; ny = (N - g['ty']) / s
    x = math.cos(th) * ex + math.sin(th) * ny; y = -math.sin(th) * ex + math.cos(th) * ny
    return x, -y
def area(p): return abs(sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p)))) / 2
def hull(pts):
    pts = sorted(set(pts))
    if len(pts) < 3: return pts
    cr = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo = []
    for p in pts:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    up = []
    for p in reversed(pts):
        while len(up) >= 2 and cr(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]
def minrect(p):
    h = hull(p); best = None
    for i in range(len(h)):
        a = h[i]; b = h[(i + 1) % len(h)]; ang = math.atan2(b[1] - a[1], b[0] - a[0]); c = math.cos(-ang); sn = math.sin(-ang)
        xs = [q[0] * c - q[1] * sn for q in h]; ys = [q[0] * sn + q[1] * c for q in h]
        A = (max(xs) - min(xs)) * (max(ys) - min(ys))
        if best is None or A < best[0]:
            cx = (max(xs) + min(xs)) / 2; cy = (max(ys) + min(ys)) / 2
            # centro riportato nel sistema originale
            C = math.cos(ang); S = math.sin(ang)
            best = (A, ang, max(xs) - min(xs), max(ys) - min(ys), cx * C - cy * S, cx * S + cy * C)
    return best
d = json.load(open('/mnt/user-data/uploads/Skyrace_Lino_Blender_Project/build/osm_edifici_cache.json'))
isl = json.load(open('/home/claude/rig/borghi_islands.json'))
isl = [x for x in isl if (x['x1'] - x['x0']) > 3 and (x['z1'] - x['z0']) > 3]
out = []; stat = collections.Counter()
for e in d['elements']:
    t = e.get('tags', {}); pts = [tosc(p['lat'], p['lon']) for p in e['geometry']]
    if len(pts) > 1 and abs(pts[0][0] - pts[-1][0]) < 1e-6 and abs(pts[0][1] - pts[-1][1]) < 1e-6: pts = pts[:-1]
    if len(pts) < 3: continue
    A = area(pts)
    if A < 8: stat['troppo piccolo'] += 1; continue
    cx = sum(p[0] for p in pts) / len(pts); cz = sum(p[1] for p in pts) / len(pts)
    b = t.get('building', 'yes')
    tipo = 'chiesa' if b == 'church' else 'industria' if b in ('industrial', 'warehouse') else 'rudere' if b == 'ruins' else 'casa'
    # altezza: dai livelli OSM, altrimenti dal blocco di borghi.glb piu' vicino (stesso dato), altrimenti dall'area
    h = None
    if t.get('height'):
        try: h = float(t['height'].replace('m', ''))
        except: pass
    if h is None and t.get('building:levels'):
        try: h = 3.1 * float(t['building:levels']) + 0.4
        except: pass
    if h is None:
        near = min(isl, key=lambda x: ((x['x0'] + x['x1']) / 2 - cx) ** 2 + ((x['z0'] + x['z1']) / 2 - cz) ** 2)
        dd = math.hypot((near['x0'] + near['x1']) / 2 - cx, (near['z0'] + near['z1']) / 2 - cz)
        if dd < 12 and 2.5 < (near['y1'] - near['y0']) < 30: h = (near['y1'] - near['y0']) - 1.2; stat['h da borghi'] += 1   # il blocco include il tetto piatto: tolgo poco
    if h is None:
        hs = (math.sin(cx * 12.9898 + cz * 78.233) * 43758.5453) % 1
        h = 3.2 if A < 35 else 6.4 if A < 110 else (6.6 + 3.2 * (hs > 0.45)) if A < 300 else 9.8
        stat['h stimata'] += 1
    if tipo == 'chiesa': h = max(h, 10)
    if tipo == 'industria': h = min(max(h, 5), 8)
    r = minrect(pts)
    if r and A / r[0] > 0.78 and len(pts) <= 6:
        A0, ang, w, l, rcx, rcz = r
        if w > l: w, l, ang = l, w, ang + math.pi / 2
        out.append([round(rcx, 2), round(rcz, 2), round(ang, 4), round(w, 2), round(l, 2), round(h, 1), tipo]); stat['rect'] += 1
    else:
        out.append({'p': [[round(x, 2), round(z, 2)] for x, z in pts], 'h': round(h, 1), 't': tipo}); stat['poly'] += 1
json.dump({'nota': 'impronte OSM (cache Blender 28/09/2026) in metri di scena, georef dem_ext/georef.json; rect = [cx,cz,ang,w,l,h,tipo]', 'e': out}, open('/home/claude/srm/assets/edifici.json', 'w'), separators=(',', ':'))
print(stat, len(out))
import os; print(os.path.getsize('/home/claude/srm/assets/edifici.json') // 1024, 'KB')
