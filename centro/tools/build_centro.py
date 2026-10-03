# Dati del centro di Magliano per il branch modellazione_centro: OSM -> coordinate scena (three x, z)
import json, math
g=json.load(open('/home/claude/rig/georef.json')); c,s_=math.cos(g['theta']),math.sin(g['theta']); s=g['s']
def ll2three(lat,lon):
    E=(lon-g['lon0'])*math.cos(math.radians(g['lat0']))*111320; N=(lat-g['lat0'])*110574
    ex=(E-g['tx'])/s; ny=(N-g['ty'])/s
    return round(c*ex+s_*ny,2), round(-(-s_*ex+c*ny),2)
osm=json.load(open('/mnt/user-data/uploads/Skyrace_Lino_Blender_Project/build/dem_ext/magliano_osm.json'))
dem=json.load(open('/tmp/centro_dem.json'))
CX,CZ=-1568,4863; R=330
def near(pts): return any(abs(p[0]-CX)<R and abs(p[1]-CZ)<R for p in pts)
out={'centro':[CX,CZ],'dem':dem,'edifici':[],'strade':[],'aree':[],'alberi':[],'barriere':[],'punti':[]}
for e in osm['elements']:
    t=e.get('tags',{}); ty=e['type']
    if ty=='way':
        pts=[ll2three(p['lat'],p['lon']) for p in e.get('geometry',[]) if 'lat' in p]
        if len(pts)<2 or not near(pts): continue
        if 'building' in t:
            lv=t.get('building:levels'); 
            try: lv=float(lv)
            except: lv=None
            h=t.get('height')
            try: h=float(h)
            except: h=None
            tipo=t.get('building'); 
            if t.get('amenity')=='townhall': tipo='municipio'
            if tipo in ('church',) or t.get('amenity')=='place_of_worship': tipo='chiesa'
            out['edifici'].append({'id':e['id'],'p':pts[:-1] if pts[0]==pts[-1] else pts,'lv':lv,'h':h,'tipo':tipo,'nome':t.get('name'),'tetto':t.get('roof:shape'),'col':t.get('building:colour')})
        elif 'highway' in t:
            hw=t['highway']
            if t.get('area')=='yes' or (hw=='pedestrian' and pts[0]==pts[-1]):
                out['aree'].append({'p':pts,'tipo':'pedonale','nome':t.get('name')})
            else:
                w={'tertiary':6.5,'residential':5.0,'unclassified':5.0,'service':3.5,'pedestrian':3.5,'footway':1.8,'steps':2.0,'path':1.2}.get(hw,4.0)
                out['strade'].append({'p':pts,'tipo':hw,'w':w,'nome':t.get('name'),'oneway':t.get('oneway')})
        elif t.get('natural')=='tree_row':
            out['alberi'].append({'fila':pts})
        elif t.get('leisure') in ('park','garden','playground') or t.get('landuse') in ('grass','village_green','religious') or t.get('amenity')=='parking':
            out['aree'].append({'p':pts,'tipo':'parcheggio' if t.get('amenity')=='parking' else 'verde','nome':t.get('name')})
        elif 'barrier' in t:
            out['barriere'].append({'p':pts,'tipo':t['barrier'],'h':t.get('height')})
        elif t.get('place')=='square':
            out['aree'].append({'p':pts,'tipo':'piazza','nome':t.get('name')})
    elif ty=='node':
        x,z=ll2three(e['lat'],e['lon'])
        if abs(x-CX)>R or abs(z-CZ)>R: continue
        if t.get('natural')=='tree': out['alberi'].append({'p':[x,z]})
        elif t.get('amenity') in ('fountain','drinking_water') or t.get('historic') or 'barrier' in t or (t.get('amenity') and t.get('name')):
            out['punti'].append({'p':[x,z],'tags':{k:v for k,v in t.items() if k in ('amenity','historic','barrier','name','tourism')}})
json.dump(out,open('assets/centro.json','w'),separators=(',',':'))
print({k:(len(v) if isinstance(v,list) else '') for k,v in out.items()})
import os; print(os.path.getsize('assets/centro.json'))
