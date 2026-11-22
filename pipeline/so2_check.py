"""Que ve el satelite en SO2: ruido de un dia, y promedios anuales sobre las fundiciones (nucleo 12 km menos anillo 40-80 km)."""
import json
import math
from collections import defaultdict

import numpy as np

from common import ROOT

D = ROOT / "data" / "daily_so2"
G = json.loads((D / "_grid.json").read_text())
H, W = G["shape"]
SITES = {"Chuquicamata (fundición)": (-22.3137, -68.8859), "Altonorte (fundición)": (-23.828, -70.3192), "Potrerillos (fundición)": (-26.4365, -69.4787),
         "Paipote / HVL (fundición)": (-27.4192, -70.2600), "Mejillones (termoeléctricas)": (-23.075, -70.39), "Tocopilla (termoeléctricas)": (-22.096, -70.212),
         "Desierto sin fuentes": (-25.6, -69.6)}
lat = G["lat0"] + (np.arange(H) + 0.5) * G["dlat"]
lon = G["lon0"] + (np.arange(W) + 0.5) * G["dlon"]
masks = {}
for k, (la, lo) in SITES.items():
    d = np.hypot((lon[None, :] - lo) * 111 * math.cos(math.radians(la)), (lat[:, None] - la) * 111)
    masks[k] = (d <= 12, (d >= 40) & (d <= 80))
acc = {k: defaultdict(lambda: [0.0, 0, 0.0, 0]) for k in SITES}
daily = {k: [] for k in SITES}
pix_sd = []
for f in sorted(D.glob("*.npz")):
    a = np.load(f)["so2"].astype("float32")
    if a.shape != (H, W):
        continue
    y = f.stem[:4]
    if len(pix_sd) < 400:
        pix_sd.append(float(np.nanstd(a)))
    for k, (core, ring) in masks.items():
        c, r = a[core], a[ring]
        if np.isfinite(c).sum() >= 8 and np.isfinite(r).sum() >= 100:
            v = float(np.nanmean(c) - np.nanmedian(r))
            s = acc[k][y]
            s[0] += v
            s[1] += 1
            daily[k].append(v)
print(f"ruido de un pixel en un dia (desv. estandar del campo): mediana {np.median(pix_sd):.2f} DU")
print("exceso medio anual de SO2 sobre el fondo (DU) y, entre parentesis, dias con dato")
for k in SITES:
    sd = float(np.std(daily[k]))
    line = " ".join(f"{y[2:]}:{acc[k][y][0] / max(acc[k][y][1], 1):+.2f}({acc[k][y][1]})" for y in sorted(acc[k]))
    print(f"  {k:30s} {line} | desv. de un dia {sd:.2f} DU -> error del promedio anual ~{sd / math.sqrt(300):.3f} DU")
