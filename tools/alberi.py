import numpy as np, json, sys, math, struct
from scipy.ndimage import gaussian_filter, maximum_filter, binary_dilation
from scipy.spatial import cKDTree
X0,Y0=-6981.0,-7973.0; W,H=5120,5632; P=2.5
mos=np.load('mos25.npy').astype(np.float32); R,G,B=mos[...,0],mos[...,1],mos[...,2]; L=0.299*R+0.587*G+0.114*B
m=np.load('maschere.npz'); wood=m['wood']; scrub=m['scrub']
build=binary_dilation(m['build'], iterations=10)       # case, strade e aree residenziali con 25 m di margine
# il centro di Magliano fatto a mano (tigli compresi): niente alberi entro 450 m dalla piazza
yy,xx=np.mgrid[0:H,0:W]; build|=np.hypot(X0+(xx+0.5)*P+1515.5, Y0+(H-yy-0.5)*P+4868)<450
# quota e pendenza dalla griglia dem10 (10 m, riga 0 = sud) ricampionata a 2,5 m
dj=json.load(open('/home/claude/srm/assets/dem10.json')); dem=np.fromfile('/home/claude/srm/assets/dem10.bin',dtype='<u2').reshape(dj['ny'],dj['nx'])*dj['scala']+dj['off']
A,Bq=0.8948,726.2
elev_sc=dem*A+Bq                                   # metri reali
ys=np.arange(H); xs=np.arange(W)
gi=np.clip(((xs+0.5)*P/10).astype(int),0,dj['nx']-1); gj=np.clip(((H-ys-0.5)*P/10).astype(int),0,dj['ny']-1)
E=elev_sc[gj][:,gi]                                  # [H,W]
gy,gx=np.gradient(elev_sc,10.0); slope=np.hypot(gx,gy)[gj][:,gi]
# copertura boschiva dall'ortofoto
ind=((L<80)&(G-R>2)).astype(np.float32)
cover=gaussian_filter(ind,2.0)
GR=gaussian_filter(G-R,2.0)
basso=((cover>0.30)|(wood&(L<100))|(scrub&(L<90)))&(E<1400)
alto=((wood&(L<100))|((cover>0.5)&(GR>5)))&(E>=1400)&(E<1780)&(slope<0.9)   # in quota solo bosco OSM o foto chiaramente verde-scura (non ombra di parete)
allowed=(basso|alto)&(~build)
print('area ammessa %.1f%% (orto %.1f%%, osm %.1f%%)'%(allowed.mean()*100,(cover>0.3).mean()*100,wood.mean()*100))
# candidati: minimi locali di L lisciata, passo minimo 12,5 m
Ls=gaussian_filter(L,1.0)
mn=(Ls==-maximum_filter(-Ls,size=5))&allowed
cy,cx=np.nonzero(mn); print('candidati',len(cx))
X=X0+(cx+0.5)*P; Y=Y0+(H-cy-0.5)*P
# distanza dal percorso
r=json.load(open('/home/claude/srm/assets/route.json'))
tree=cKDTree(np.c_[r['x'],r['y']]); dist,idx=tree.query(np.c_[X,Y]); km=np.array(idx)/len(r['x'])*r['total_km']
for a,b in [(0,400),(400,1200),(1200,2500),(2500,4500),(4500,1e9)]:
    s=(dist>=a)&(dist<b); print('fascia %d-%d: %d'%(a,b,s.sum()))
rng=np.random.default_rng(7)
# due livelli: alberi 3D low-poly entro 500 m dal percorso (p 0,38), sprite incrociati oltre
D3=500.0
p=np.where(dist<D3,0.26,np.where(dist<1200,0.40,np.where(dist<2500,0.15,np.where(dist<4500,0.05,0.015))))
cv=cover[cy,cx]; p=p*np.clip(0.45+cv,0.45,1.0)
keep=rng.random(len(X))<p
X,Y,E2,km,cv,dist=X[keep],Y[keep],E[cy,cx][keep],km[keep],cv[keep],dist[keep]
tier=(dist>=D3).astype(np.uint8)
print('alberi tenuti',len(X),'3D',(tier==0).sum(),'sprite',(tier==1).sum())
# specie: quercia (roverella) sotto i 1.200; pino nero nel settore sud 1.150-1.450 (rimboschimenti);
# faggio sopra i 1.300 (1.200 nei valloni freschi: esposizione nord); 0=quercia 1=faggio 2=pino
asp=np.arctan2(gy,gx)[gj][:,gi]   # non usato finemente: esposizione nord se gy<0 (quota cresce verso sud)
north=(gy[gj][:,gi]<0)
nmask=north[((H-(Y-Y0)/P-0.5).astype(int)).clip(0,H-1),(((X-X0)/P-0.5).astype(int)).clip(0,W-1)]
tipo=np.zeros(len(X),np.uint8)
sud=(km>20.5)&(km<27)
tipo[(E2>=1150)&(E2<1450)&sud&(rng.random(len(X))<0.8)]=2
fag=(E2>=1300)|((E2>=1180)&nmask)
tipo[fag&(tipo!=2)]=1
tipo[(E2>=1450)&(tipo==2)]=1
ordine=np.lexsort((dist,tier)); X,Y,E2,km,cv,dist,tipo,tier=[v[ordine] for v in (X,Y,E2,km,cv,dist,tipo,tier)]
print('specie: querce',(tipo==0).sum(),'faggi',(tipo==1).sum(),'pini',(tipo==2).sum())
scala=(0.8+0.5*rng.random(len(X))).astype(np.float32); rot=(rng.random(len(X))*2*np.pi).astype(np.float32)
# file binario: int16 x, int16 y, uint8 tipo, uint8 scala*100, uint8 rot*40 (7 byte)
out=bytearray()
for i in range(len(X)):
    out+=struct.pack('<hhBBB',int(round(X[i])),int(round(Y[i])),int(tipo[i])+8*int(tier[i]),int(round(scala[i]*100)),int(rot[i]*40.5))
open('/home/claude/srm/assets/alberi.bin','wb').write(out)
json.dump({'n':len(X),'n3d':int((tier==0).sum()),'file':'alberi.bin','rec':'<hhBBB: x, y nord (m scena), tipo (0 quercia,1 faggio,2 pino; +8 = sprite lontano), scala*100, rot*40.5; ordinati per distanza dal percorso, prima i 3D','fonte':'ortofoto PCN 2012 (chiome = minimi di luminanza nelle zone scure e verdi) + boschi OSM; specie per quota/settore secondo il Piano di gestione RNO Velino'},open('/home/claude/srm/assets/alberi.json','w'))
print('scritti', len(out)/1e3, 'KB')
# anteprima
from PIL import Image
ov=mos.astype(np.uint8).copy()
px_=((X-X0)/P).astype(int); py_=(H-(Y-Y0)/P).astype(int)
col=np.array([[255,200,0],[0,255,80],[60,120,255]],np.uint8)
for dx in (-1,0,1):
    for dy in (-1,0,1): ov[np.clip(py_+dy,0,H-1),np.clip(px_+dx,0,W-1)]=col[tipo]
Image.fromarray(ov).resize((1280,1408)).save('/tmp/alberi.png')
Image.fromarray(ov[int(H*0.52):int(H*0.75), int(W*0.1):int(W*0.33)]).save('/tmp/alberi_zoom.png')
