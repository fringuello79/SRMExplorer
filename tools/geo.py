import json, math, numpy as np
from pyproj import Transformer
G = json.load(open('/mnt/user-data/uploads/Skyrace_Lino_Blender_Project/build/dem_ext/georef.json'))
_tr = Transformer.from_crs('EPSG:4326', 'EPSG:32632', always_xy=True)
_c0 = math.cos(math.radians(G['lat0'])) * 111320
ELEV_A, ELEV_B = 0.8948, 726.2
def scene_to_utm(x, y):
    """x est, y nord (scena blender) -> E,N EPSG:32632 (array ok)"""
    th, s = G['theta'], G['s']
    E = s * (math.cos(th) * x - math.sin(th) * y) + G['tx']; N = s * (math.sin(th) * x + math.cos(th) * y) + G['ty']
    lat = G['lat0'] + N / 110574; lon = G['lon0'] + E / _c0
    return _tr.transform(lon, lat)

def scene_to_latlon(x, y):
    th, s = G['theta'], G['s']
    E = s * (math.cos(th) * x - math.sin(th) * y) + G['tx']; N = s * (math.sin(th) * x + math.cos(th) * y) + G['ty']
    return G['lat0'] + N / 110574, G['lon0'] + E / _c0
def latlon_to_scene(lat, lon):
    th, s = G['theta'], G['s']
    E = ((lon - G['lon0']) * _c0 - G['tx']) / s; N = ((lat - G['lat0']) * 110574 - G['ty']) / s
    return math.cos(th) * E + math.sin(th) * N, -math.sin(th) * E + math.cos(th) * N
