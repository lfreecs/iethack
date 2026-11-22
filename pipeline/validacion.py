"""Validaciones independientes del metodo de atribucion.

1. Experimento natural: la fundicion Hernan Videla Lira (Paipote) dejo de operar el 23-02-2024. Se compara el SO2
   medido en las estaciones cercanas durante los 12 meses anteriores y los 12 posteriores.
2. Satelite: exceso anual de SO2 (Sentinel-5P) sobre cada fundicion: nucleo de 12 km menos anillo de 40 a 80 km.
3. Declarado: SO2 anual de cada fundicion en el RETC frente a su limite del D.S. 28/2013.
Salida: web/public/data/validacion.json
"""
import json
import math
from collections import defaultdict

import numpy as np

import sinca
from common import PROCESSED, ROOT

CLOSURE = "2024-02-23"
NEAR = {"RIII/314": ("Paipote", 1.5), "RIII/312": ("Tierra Amarilla", 6.1), "RIII/315": ("Los Volcanes", 7.1), "RIII/311": ("Copiapó", 9.6)}
SMELTERS = {"Chuquicamata": (-22.3137, -68.8859, "DIVISIÓN CHUQUICAMATA", 49700), "Altonorte": (-23.828, -70.3192, "FUNDICION ALTONORTE", 24000),
            "Potrerillos": (-26.4365, -69.4787, "POTRERILLOS", 24400), "Hernán Videla Lira (Paipote)": (-27.4192, -70.26, "VIDELA", 12880),
            "Desierto sin fuentes": (-25.6, -69.6, None, None)}


def closure():
    out = []
    for code, (name, km) in NEAR.items():
        d = sinca.series(code, "SO2")
        by = defaultdict(list)
        for (day, _), (v, _) in d.items():
            if day >= "180501":
                by[f"20{day[:2]}-{day[2:4]}"].append(v)
        pre = [v for (day, _), (v, _) in d.items() if "230223" <= day < "240223"]
        post = [v for (day, _), (v, _) in d.items() if "240301" <= day < "250301"]
        stat = lambda x: {"mean": round(float(np.mean(x)), 2), "p99": round(float(np.percentile(x, 99)), 1), "max": round(float(max(x)), 1), "hours": len(x)}
        out.append({"code": code, "station": name, "km": km, "before": stat(pre), "after": stat(post),
                    "monthly": [{"m": m, "mean": round(float(np.mean(v)), 2), "p95": round(float(np.percentile(v, 95)), 1)} for m, v in sorted(by.items()) if len(v) >= 300]})
        print(f"{name:16s} antes: {out[-1]['before']} | después: {out[-1]['after']}")
    return out


def satellite():
    D = ROOT / "data" / "daily_so2"
    G = json.loads((D / "_grid.json").read_text())
    H, W = G["shape"]
    lat, lon = G["lat0"] + (np.arange(H) + 0.5) * G["dlat"], G["lon0"] + (np.arange(W) + 0.5) * G["dlon"]
    masks, acc = {}, {k: defaultdict(list) for k in SMELTERS}
    for k, (la, lo, _, _) in SMELTERS.items():
        d = np.hypot((lon[None, :] - lo) * 111 * math.cos(math.radians(la)), (lat[:, None] - la) * 111)
        masks[k] = (d <= 12, (d >= 40) & (d <= 80))
    for f in sorted(D.glob("*.npz")):
        a = np.load(f)["so2"].astype("float32")
        if a.shape != (H, W):
            continue
        for k, (core, ring) in masks.items():
            c, r = a[core], a[ring]
            if np.isfinite(c).sum() >= 8 and np.isfinite(r).sum() >= 100:
                acc[k][f.stem[:4]].append(float(np.nanmean(c) - np.nanmedian(r)))
    return {k: {y: {"excess_du": round(float(np.mean(v)), 3), "error_du": round(float(np.std(v) / math.sqrt(len(v))), 3), "days": len(v)} for y, v in sorted(s.items()) if len(v) >= 150} for k, s in acc.items()}


def main():
    retc = json.loads((PROCESSED / "retc_so2_nox.json").read_text(encoding="utf8"))["establecimientos"]
    declared = {}
    for k, (_, _, pat, cap) in SMELTERS.items():
        e = next((x for x in retc if pat and pat in x["name"].upper()), None)
        if e:
            declared[k] = {"cap_t": cap, "so2": e["so2"], "name": " ".join(e["name"].split())}
    out = {"closure_date": CLOSURE, "closure": closure(), "satellite_so2": satellite(), "declared": declared,
           "notes": {"retc": "El RETC es declarado o estimado con factores; desde 2023 incluye el balance de masa de fundiciones (D.S. 28). Valores casi nulos en años anteriores indican registro incompleto.",
                     "satellite": "Un pixel de un dia tiene un ruido de ~1,7 DU; las fundiciones dejan del orden de 0,1 DU. El satelite solo sirve en promedios anuales."}}
    (ROOT / "web" / "public" / "data" / "validacion.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf8")
    for k, s in out["satellite_so2"].items():
        print(f"{k:30s}", " ".join(f"{y[2:]}:{v['excess_du']:+.2f}±{v['error_du']:.2f}" for y, v in s.items()))
    print({k: v["so2"] for k, v in declared.items()})


if __name__ == "__main__":
    main()
