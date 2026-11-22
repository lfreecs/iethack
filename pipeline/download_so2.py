"""Descarga diaria de SO2 (Sentinel-5P, columna vertical total, perfil de capa limite) recortado a Chile.

Guarda data/daily_so2/AAAA-MM-DD.npz en unidades Dobson (1 DU = 4,4615e-4 mol/m2), solo pixeles con calidad >= 50 %.
Se conservan los valores negativos: son ruido alrededor de cero y hacen falta para promediar sin sesgo.
Uso: python download_so2.py [ultimo_dia] [hilos]. Reanudable.
"""
import datetime as dt
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np

from common import ROOT, orbit_files_for_day
from download_daily import FIRST_DAY, read_window

OUT = ROOT / "data" / "daily_so2"
QA_MIN = 50
MOL_M2_PER_DU = 4.4615e-4


def process_day(day: str):
    out = OUT / f"{day}.npz"
    if out.exists():
        return day, "ya existia"
    layers, transform = [], None
    for url, qa_url in orbit_files_for_day(day, "L2__SO2___", "sulfurdioxide_total_vertical_column", kinds=("RPRO", "OFFL")):
        so2, transform, nodata = read_window(url)
        valid = (so2 != nodata) & np.isfinite(so2)
        if not valid.any():
            continue
        qa, _, _ = read_window(qa_url)
        layers.append(np.where(valid & (qa >= QA_MIN), so2 / MOL_M2_PER_DU, np.nan).astype("float32"))
    if not layers:
        np.savez_compressed(out, so2=np.full((1, 1), np.nan, dtype="float16"))
        return day, "sin dato sobre Chile"
    with np.errstate(all="ignore"):
        merged = np.nanmean(np.stack(layers), axis=0)
    np.savez_compressed(out, so2=np.clip(merged, -60, 60).astype("float16"))
    meta = OUT / "_grid.json"
    if transform is not None and not meta.exists():
        meta.write_text(json.dumps({"lon0": transform.c, "lat0": transform.f, "dlon": transform.a, "dlat": transform.e,
                                    "shape": list(merged.shape), "units": "DU", "qa_min": QA_MIN}))
    return day, f"{len(layers)} orbita(s), {np.isfinite(merged).mean():.0%} con dato"


def main():
    last = dt.date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else dt.date.today() - dt.timedelta(days=12)
    workers = int(sys.argv[2]) if len(sys.argv) > 2 else 12
    OUT.mkdir(parents=True, exist_ok=True)
    days = [(FIRST_DAY + dt.timedelta(n)).isoformat() for n in range((last - FIRST_DAY).days + 1)]
    todo = [d for d in days if not (OUT / f"{d}.npz").exists()]
    print(f"{len(days)} dias en total, {len(todo)} por descargar, {workers} en paralelo", flush=True)
    t0, done = time.time(), 0
    with ThreadPoolExecutor(workers) as ex:
        futs = {ex.submit(process_day, d): d for d in todo}
        for f in as_completed(futs):
            done += 1
            try:
                _, msg = f.result()
            except Exception as e:  # se reintenta en la siguiente ejecucion
                msg = f"ERROR {e!r}"[:160]
            if done % 50 == 0 or msg.startswith("ERROR"):
                print(f"[{done}/{len(todo)}] {futs[f]}: {msg} | {done / (time.time() - t0) * 60:.0f} dias/min", flush=True)
    print(f"Listo en {(time.time() - t0) / 60:.1f} min", flush=True)


if __name__ == "__main__":
    main()
