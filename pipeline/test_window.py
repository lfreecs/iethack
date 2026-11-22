"""Etapa 0: prueba de lectura parcial (solo Chile) de un dia de Sentinel-5P."""
import sys
import time

import numpy as np
import rasterio
from rasterio.windows import from_bounds

from common import LAT_MAX, LAT_MIN, LON_MAX, LON_MIN, MOL_M2_TO_MOLEC_CM2, orbit_files_for_day

day = sys.argv[1] if len(sys.argv) > 1 else "2025-08-15"
t0 = time.time()
files = orbit_files_for_day(day)
print(f"{day}: {len(files)} orbitas candidatas ({time.time() - t0:.1f} s listando)")

for no2_url, qa_url in files:
    t = time.time()
    with rasterio.open("/vsicurl/" + no2_url) as src:
        win = from_bounds(LON_MIN, LAT_MIN, LON_MAX, LAT_MAX, src.transform)
        no2 = src.read(1, window=win)
        tf = src.window_transform(win)
        nod = src.nodata
    with rasterio.open("/vsicurl/" + qa_url) as src:
        qa = src.read(1, window=from_bounds(LON_MIN, LAT_MIN, LON_MAX, LAT_MAX, src.transform))
    valid = no2 != nod
    vals, counts = np.unique(qa[valid], return_counts=True)
    top = sorted(zip(counts, vals), reverse=True)[:6]
    print(f"  orbita {no2_url.split('____')[1][:15]} | {time.time() - t:.1f} s | forma {no2.shape} | validos {valid.mean():.0%}")
    print(f"    qa mas comunes (valor: n): {[(int(v), int(c)) for c, v in top]}")
    good = valid & (qa >= 75)
    if good.any():
        print(f"    NO2 bueno: mediana {np.median(no2[good]) * MOL_M2_TO_MOLEC_CM2:.2e} molec/cm2 | pixeles {good.sum()}")

