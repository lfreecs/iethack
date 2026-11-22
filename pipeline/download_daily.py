"""Etapa 1: descarga diaria de NO2 troposferico (Sentinel-5P) recortado a Chile.

Guarda un archivo por dia en data/daily/AAAA-MM-DD.npz con el NO2 en unidades
de 1e15 moleculas/cm2, usando solo pixeles con calidad >= 75 %. Se puede
interrumpir y volver a ejecutar: salta los dias ya descargados.
"""
import datetime as dt
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import rasterio
from rasterio.windows import from_bounds

from common import DAILY, LAT_MAX, LAT_MIN, LON_MAX, LON_MIN, MOL_M2_TO_MOLEC_CM2, orbit_files_for_day

QA_MIN = 75
FIRST_DAY = dt.date(2018, 5, 1)


def read_window(url):
    with rasterio.open("/vsicurl/" + url) as src:
        win = from_bounds(LON_MIN, LAT_MIN, LON_MAX, LAT_MAX, src.transform)
        return src.read(1, window=win), src.window_transform(win), src.nodata


def process_day(day: str):
    out = DAILY / f"{day}.npz"
    if out.exists():
        return day, "ya existia"
    layers = []
    transform = None
    for no2_url, qa_url in orbit_files_for_day(day):
        no2, transform, nodata = read_window(no2_url)
        valid = no2 != nodata
        if not valid.any():
            continue
        qa, _, _ = read_window(qa_url)
        good = valid & (qa >= QA_MIN)
        layers.append(np.where(good, no2 * MOL_M2_TO_MOLEC_CM2 / 1e15, np.nan).astype("float32"))
    if layers:
        with np.errstate(all="ignore"):
            merged = np.nanmean(np.stack(layers), axis=0)
        np.savez_compressed(out, no2=merged.astype("float16"))
        meta = DAILY / "_grid.json"
        if transform is not None and not meta.exists():
            meta.write_text(json.dumps({
                "lon0": transform.c, "lat0": transform.f, "dlon": transform.a, "dlat": transform.e,
                "shape": list(merged.shape), "units": "1e15 molec/cm2", "qa_min": QA_MIN,
            }))
        return day, f"{len(layers)} orbita(s), {np.isfinite(merged).mean():.0%} con dato"
    np.savez_compressed(out, no2=np.full((1, 1), np.nan, dtype="float16"))
    return day, "sin dato sobre Chile"


def main():
    last = dt.date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else dt.date.today() - dt.timedelta(days=12)
    workers = int(sys.argv[2]) if len(sys.argv) > 2 else 12
    DAILY.mkdir(parents=True, exist_ok=True)
    days = [(FIRST_DAY + dt.timedelta(n)).isoformat() for n in range((last - FIRST_DAY).days + 1)]
    todo = [d for d in days if not (DAILY / f"{d}.npz").exists()]
    print(f"{len(days)} dias en total, {len(todo)} por descargar, {workers} en paralelo", flush=True)
    t0 = time.time()
    done = 0
    with ThreadPoolExecutor(workers) as ex:
        futs = {ex.submit(process_day, d): d for d in todo}
        for f in as_completed(futs):
            d = futs[f]
            done += 1
            try:
                _, msg = f.result()
            except Exception as e:  # se reintenta en la siguiente ejecucion
                msg = f"ERROR {e!r}"[:160]
            if done % 25 == 0 or msg.startswith("ERROR"):
                rate = done / (time.time() - t0)
                print(f"[{done}/{len(todo)}] {d}: {msg} | {rate * 60:.0f} dias/min", flush=True)
    print(f"Listo en {(time.time() - t0) / 60:.1f} min", flush=True)


if __name__ == "__main__":
    main()
