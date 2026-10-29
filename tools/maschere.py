import numpy as np, json, sys, math
sys.path.insert(0,'/home/claude/reality'); from geo import latlon_to_scene
from PIL import Image, ImageDraw
X0,Y0=-6981.0,-7973.0; W,H=5120,5632; P=2.5
d=json.load(open('/mnt/user-data/uploads/Skyrace_Lino_Blender_Project/build/reality/osm_reality.json'))
def px(lat,lon):
    x,y=latlon_to_scene(lat,lon); return ((x-X0)/P, H-(y-Y0)/P)
def pxs(x,y): return ((x-X0)/P, H-(y-Y0)/P)
wood=Image.new('L',(W,H),0); dw=ImageDraw.Draw(wood)
scrub=Image.new('L',(W,H),0); ds=ImageDraw.Draw(scrub)
build=Image.new('L',(W,H),0); db=ImageDraw.Draw(build)
nw=ns=0
for e in d['elements']:
    t=e.get('tags',{})
    iswood = t.get('natural')=='wood' or t.get('landuse') in ('forest','orchard')
    isscrub = t.get('natural')=='scrub'
    isres = t.get('landuse') in ('residential','industrial','cemetery','quarry')
    ishw = 'highway' in t and t['highway'] in ('motorway','motorway_link','primary','secondary','tertiary','residential','unclassified','service','living_street')
    if ishw and e['type']=='way' and 'geometry' in e:
        db.line([px(g['lat'],g['lon']) for g in e['geometry']], fill=255, width=4 if t['highway'].startswith('motorway') else 2)
        continue
    if not (iswood or isscrub or isres): continue
    polys=[]; inner=[]
    if e['type']=='way' and 'geometry' in e:
        polys.append([px(g['lat'],g['lon']) for g in e['geometry']])
    elif e['type']=='relation':
        for m in e.get('members',[]):
            if m.get('role')=='outer' and 'geometry' in m: polys.append([px(g['lat'],g['lon']) for g in m['geometry']])
            if m.get('role')=='inner' and 'geometry' in m: inner.append([px(g['lat'],g['lon']) for g in m['geometry']])
    for p in polys:
        if len(p)<3: continue
        if iswood: dw.polygon(p,fill=255); nw+=1
        elif isscrub: ds.polygon(p,fill=255); ns+=1
        else: db.polygon(p,fill=255)
    if iswood:
        for p in inner:
            if len(p)>=3: dw.polygon(p,fill=0)
ed=json.load(open('/home/claude/srm/assets/edifici.json'))['e']
for b in ed:
    if isinstance(b,dict):
        pts=[pxs(q[0],-q[1]) for q in b['p']]; db.polygon(pts,fill=255)
    else:
        cx,cz,ang,w,l,h=b[:6]; y=-cz
        c,s=math.cos(ang),math.sin(ang); hw,hl=w/2+5,l/2+5
        pts=[pxs(cx+c*dx-s*dz, y-(s*dx+c*dz)) for dx,dz in [(-hw,-hl),(hw,-hl),(hw,hl),(-hw,hl)]]
        db.polygon(pts,fill=255)
wood=np.array(wood)>0; scrub=np.array(scrub)>0; build=np.array(build)>0
print('poligoni bosco',nw,'arbusteto',ns,'copertura bosco %.1f%% arbusteto %.1f%% edificato/strade %.1f%%'%(wood.mean()*100,scrub.mean()*100,build.mean()*100))
np.savez_compressed('maschere.npz', wood=wood, scrub=scrub, build=build)
mos=np.load('mos25.npy')
ov=mos.copy(); ov[wood]=(ov[wood]*0.5+np.array([0,255,0])*0.5).astype(np.uint8); ov[scrub]=(ov[scrub]*0.5+np.array([255,255,0])*0.5).astype(np.uint8); ov[build]=(ov[build]*0.5+np.array([255,0,0])*0.5).astype(np.uint8)
Image.fromarray(ov).resize((1024,1126)).save('/tmp/ov.png')
