import json, math
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon, Circle
g=json.load(open('georef.json')); c,s_=math.cos(g['theta']),math.sin(g['theta']); s=g['s']
def ll2three(lat,lon):
    E=(lon-g['lon0'])*math.cos(math.radians(g['lat0']))*111320; N=(lat-g['lat0'])*110574
    ex=(E-g['tx'])/s; ny=(N-g['ty'])/s
    bx, by = c*ex+s_*ny, -s_*ex+c*ny
    return bx, -by          # three: x, z
osm=json.load(open('/mnt/user-data/uploads/Skyrace_Lino_Blender_Project/build/dem_ext/magliano_osm.json'))
foot=json.load(open('/tmp/maglianoC_foot.json'))
r=json.load(open('site/assets/route.json'))
CX, CZ = -1540, 4880     # centro della pianta (fra arco e municipio)
R = 130
fig, ax = plt.subplots(figsize=(14, 14), dpi=110)
ax.set_facecolor('#f4f1ea')
def geom(e):
    return [ll2three(p['lat'], p['lon']) for p in e.get('geometry', [])]
# --- OSM ---
for e in osm['elements']:
    t = e.get('tags', {}); ty = e['type']
    if ty == 'way':
        pts = geom(e)
        if len(pts) < 2: continue
        xs=[p[0] for p in pts]; zs=[p[1] for p in pts]
        if 'building' in t:
            col = '#c9a227' if t.get('amenity') == 'townhall' else ('#b06060' if t.get('building') == 'church' else '#8c8c8c')
            ax.add_patch(Polygon(pts, closed=True, fc=col, ec='#333', lw=0.8, alpha=0.75, zorder=3))
            if t.get('amenity') == 'townhall': ax.text(sum(xs)/len(xs), sum(zs)/len(zs), 'MUNICIPIO\n(OSM)', ha='center', va='center', fontsize=8, weight='bold', zorder=9)
            if t.get('building') == 'church': ax.text(sum(xs)/len(xs), sum(zs)/len(zs), t.get('name','chiesa'), ha='center', va='center', fontsize=7, zorder=9)
        elif 'highway' in t:
            hw = t['highway']
            if hw == 'pedestrian' and pts[0] == pts[-1]:
                ax.add_patch(Polygon(pts, closed=True, fc='#e8dcc0', ec='#a08c5a', lw=0.8, zorder=2))
                ax.text(sum(xs)/len(xs), sum(zs)/len(zs), t.get('name',''), ha='center', fontsize=7, style='italic', color='#6b5a2e', zorder=9)
            else:
                lw = {'tertiary': 5, 'residential': 3.5, 'service': 2, 'footway': 1, 'steps': 1.5, 'pedestrian': 3, 'unclassified': 3}.get(hw, 2)
                ls = ':' if hw == 'steps' else '-'
                ax.plot(xs, zs, color='#d9d4c7' if hw not in ('footway','steps') else '#9a7b4f', lw=lw, ls=ls, solid_capstyle='round', zorder=2)
                if 'name' in t and len(pts) > 1:
                    i = len(pts)//2; ax.text(pts[i][0], pts[i][1], t['name'], fontsize=6, color='#555', rotation=math.degrees(math.atan2(pts[-1][1]-pts[0][1], pts[-1][0]-pts[0][0])), ha='center', zorder=9)
        elif t.get('natural') == 'tree_row':
            # un albero ogni ~7 m lungo la fila
            L = 0; prev = None
            for p in pts:
                if prev is not None:
                    d = math.hypot(p[0]-prev[0], p[1]-prev[1]); n = max(1, round(d/7))
                    for k in range(n+1):
                        q = (prev[0]+(p[0]-prev[0])*k/n, prev[1]+(p[1]-prev[1])*k/n)
                        ax.add_patch(Circle(q, 2.2, fc='#5fa05a', ec='#2f6b2c', lw=0.6, alpha=0.8, zorder=5))
                prev = p
            ax.plot(xs, zs, color='#2f6b2c', lw=0.8, zorder=4)
        elif t.get('leisure') in ('park', 'garden', 'playground') or t.get('landuse') in ('grass', 'village_green'):
            ax.add_patch(Polygon(pts, closed=True, fc='#cfe3bd', ec='#7aa06a', lw=0.8, alpha=0.8, zorder=2))
            if 'name' in t: ax.text(sum(xs)/len(xs), sum(zs)/len(zs), t['name'], fontsize=6, color='#3e6b2f', ha='center', zorder=9)
        elif 'barrier' in t:
            ax.plot(xs, zs, color='#7b3f00', lw=1.6, zorder=6)
        elif t.get('amenity') == 'parking':
            ax.add_patch(Polygon(pts, closed=True, fc='#dddddd', ec='#999', lw=0.6, alpha=0.6, zorder=2)); ax.text(sum(xs)/len(xs), sum(zs)/len(zs), 'P', fontsize=8, color='#555', ha='center', zorder=9)
        elif t.get('place') == 'square':
            ax.add_patch(Polygon(pts, closed=False, fill=False, ec='#a08c5a', lw=1, ls='--', zorder=2)); ax.text(xs[0], zs[0], t.get('name',''), fontsize=7, style='italic', color='#6b5a2e', zorder=9)
    elif ty == 'node':
        x, z = ll2three(e['lat'], e['lon'])
        if t.get('natural') == 'tree': ax.add_patch(Circle((x, z), 2.2, fc='#5fa05a', ec='#2f6b2c', lw=0.6, zorder=5))
        elif t.get('amenity') == 'fountain': ax.plot(x, z, marker='o', ms=9, mfc='#6fb7e8', mec='#1f5f8a', zorder=8); ax.text(x+3, z, 'fontana', fontsize=7, zorder=9)
        elif t.get('historic') == 'monument': ax.plot(x, z, marker='^', ms=9, mfc='#444', mec='k', zorder=8); ax.text(x+3, z, 'monumento', fontsize=7, zorder=9)
        elif t.get('amenity') == 'drinking_water': ax.plot(x, z, marker='v', ms=6, mfc='#6fb7e8', mec='#1f5f8a', zorder=8)
        elif 'barrier' in t: ax.plot(x, z, marker='s', ms=5, mfc='#7b3f00', mec='k', zorder=8)
        elif 'amenity' in t and 'name' in t: ax.plot(x, z, marker='.', color='#333', zorder=8); ax.text(x+2, z, t['name'], fontsize=6, zorder=9)
# --- Explorer ---
for o in foot:
    n = o['n']; h = o['h']
    if n.startswith('Casa_'): ax.add_patch(Polygon(h, closed=True, fill=False, ec='#1f4fd1', lw=1.4, zorder=7))
    elif n == 'Municipio': ax.add_patch(Polygon(h, closed=True, fill=False, ec='#d12f1f', lw=2, zorder=7)); ax.text(h[0][0], h[0][1]-3, 'Municipio Meshy (impronta)', color='#d12f1f', fontsize=8, zorder=9)
    elif n.startswith('Tiglio_') and 'tronco' in n:
        cx = sum(p[0] for p in h)/len(h); cz = sum(p[1] for p in h)/len(h); ax.add_patch(Circle((cx, cz), 2.6, fill=False, ec='#1f4fd1', lw=1.6, zorder=7))
    elif n.startswith('Arch_Pillar'):
        cx = sum(p[0] for p in h)/len(h); cz = sum(p[1] for p in h)/len(h); ax.plot(cx, cz, marker='s', ms=7, color='#ff7f00', zorder=8)
    elif n.startswith('Transenna'): ax.add_patch(Polygon(h, closed=True, fc='#ff7f00', ec='#ff7f00', lw=1, zorder=7))
    elif n == 'Ristoro_ceppo': cx = sum(p[0] for p in h)/len(h); cz = sum(p[1] for p in h)/len(h); ax.plot(cx, cz, marker='*', ms=11, color='#ff7f00', zorder=8); ax.text(cx+3, cz, 'incudine', fontsize=7, color='#ff7f00', zorder=9)
# percorso
xs = r['x']; zs = [-y for y in r['y']]
ax.plot(xs, zs, color='#f2a900', lw=4, alpha=0.9, zorder=6, label='percorso di gara (Explorer)')
ax.plot(xs[0], zs[0], marker='o', ms=10, color='#f2a900', mec='k', zorder=9); ax.text(xs[0]+3, zs[0]+3, 'km 0', fontsize=8, weight='bold', zorder=9)
# legenda e cornice
from matplotlib.lines import Line2D
from matplotlib.patches import Patch
leg = [Patch(fc='#8c8c8c', ec='#333', alpha=0.75, label='edifici OSM'), Patch(fc='#c9a227', ec='#333', label='Municipio OSM'), Patch(fc='#b06060', ec='#333', label='chiese OSM'),
       Patch(fc='#e8dcc0', ec='#a08c5a', label='piazza pedonale OSM'), Patch(fc='#cfe3bd', ec='#7aa06a', label='verde / parco OSM'), Line2D([0],[0], color='#d9d4c7', lw=4, label='strade OSM'), Line2D([0],[0], color='#9a7b4f', lw=1.5, ls=':', label='scale / pedonali OSM'),
       Line2D([0],[0], marker='o', color='w', mfc='#5fa05a', mec='#2f6b2c', ms=9, label='alberi OSM (file di alberi)'), Line2D([0],[0], color='#7b3f00', lw=1.6, label='recinzioni / ringhiere OSM'),
       Line2D([0],[0], color='#1f4fd1', lw=1.4, label='case dell\'Explorer (maglianoC)'), Line2D([0],[0], marker='o', color='w', mec='#1f4fd1', mfc='none', ms=9, mew=1.6, label='tigli dell\'Explorer'),
       Line2D([0],[0], color='#d12f1f', lw=2, label='Municipio Meshy (impronta a terra)'), Line2D([0],[0], marker='s', color='w', mfc='#ff7f00', ms=8, label='arco (piloni), transenne, incudine'), Line2D([0],[0], color='#f2a900', lw=4, label='percorso di gara')]
ax.legend(handles=leg, loc='lower left', fontsize=7.5, framealpha=0.95)
ax.set_xlim(CX-R, CX+R); ax.set_ylim(CZ+R, CZ-R)   # z cresce verso sud: asse invertito -> nord in alto
ax.set_aspect('equal'); ax.grid(True, color='#ddd', lw=0.5); ax.set_xlabel('x scena (m, est →)'); ax.set_ylabel('z scena (m, sud ↓)')
ax.annotate('N', xy=(CX+R-12, CZ-R+28), xytext=(CX+R-12, CZ-R+8), ha='center', fontsize=12, weight='bold', arrowprops=dict(arrowstyle='<-', lw=2))
ax.set_title("Magliano de' Marsi · zona di partenza — OpenStreetMap (colori pieni) vs SRM Explorer (contorni blu/rosso/arancio)\ngeoreferenziazione: georef.json (residuo mediano ~6 m)", fontsize=11)
plt.tight_layout(); plt.savefig('/tmp/pianta_magliano.png'); print('ok')
