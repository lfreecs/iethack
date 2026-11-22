"""Contraste con mediciones en tierra: NO2 de las estaciones oficiales (SINCA, Ministerio del Medio Ambiente)
frente a la columna de NO2 del satelite sobre la misma estacion.

Descarga los registros horarios de NO2 de las estaciones de la Region de Antofagasta con datos en 2018-2026,
se queda con las horas cercanas a la pasada del satelite (13 a 15 h) y compara promedios mensuales y anuales.
Salida: web/public/data/sinca.json
"""
import json
import math
import re
import urllib.request
from collections import defaultdict

import numpy as np

from common import DAILY, RAW, ROOT
from compute_index import anomalies, fisher_ci, pearson

OUT_RAW = RAW / "sinca"
STATIONS = {  # codigo SINCA: (nombre, comuna)
    "RII/236": ("Estación Centro", "Calama"),
    "RII/209": ("Jardín Infantil Integra", "Mejillones"),
    "RII/252": ("Juan José Latorre", "Mejillones"),
    "RII/251": ("Super Site", "Tocopilla"),
}
UA = {"User-Agent": "Mozilla/5.0"}
HOURS = (1300, 1400, 1500)


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180).read()


def coords(code):
    """Coordenadas de la ficha de la estacion (UTM zona 19 sur -> grados)."""
    page = get(f"https://sinca.mma.gob.cl/index.php/estacion/index/key/{code.split('/')[1]}").decode("utf8", "replace")
    m = re.search(r"(\d{6,7})\s*E\s*[,;]?\s*(\d{7})\s*N", page) or re.search(r"UTM[^0-9]*(\d{6})[^0-9]+(\d{7})", page)
    ll = re.search(r"(-\d{2}\.\d{3,})[^0-9-]+(-\d{2}\.\d{3,})", page)
    if ll:
        a, b = float(ll.group(1)), float(ll.group(2))
        return (a, b) if a > -40 and b < -60 else (b, a)
    if not m:
        return None
    e, n = float(m.group(1)), float(m.group(2))
    # UTM 19S -> lat/lon (WGS84), formula inversa estandar
    a, f, k0, lon0 = 6378137.0, 1 / 298.257223563, 0.9996, math.radians(-69)
    e2 = f * (2 - f)
    x, y = e - 500000, n - 10000000
    mu = y / k0 / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256))
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu) + (151 * e1 ** 3 / 96) * math.sin(6 * mu)
    c1 = e2 / (1 - e2) * math.cos(p1) ** 2
    t1 = math.tan(p1) ** 2
    n1 = a / math.sqrt(1 - e2 * math.sin(p1) ** 2)
    r1 = a * (1 - e2) / (1 - e2 * math.sin(p1) ** 2) ** 1.5
    d = x / (n1 * k0)
    lat = p1 - (n1 * math.tan(p1) / r1) * (d ** 2 / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * e2 / (1 - e2)) * d ** 4 / 24)
    lon = lon0 + (d - (1 + 2 * t1 + c1) * d ** 3 / 6) / math.cos(p1)
    return math.degrees(lat), math.degrees(lon)


def hourly(code):
    path = OUT_RAW / f"no2_{code.replace('/', '_')}.csv"
    if not path.exists():
        url = ("https://sinca.mma.gob.cl/cgi-bin/APUB-MMA/apub.tsindico2.cgi?outtype=xcl&macro=./" + code +
               "/Cal/0003//0003.horario.horario.ic&from=180501&to=261111&path=/usr/airviro/data/CONAMA/&lang=esp&rsrc=&macropath=")
        path.write_bytes(get(url))
    out = defaultdict(list)
    for line in path.read_text(encoding="latin-1").splitlines()[1:]:
        p = line.split(";")
        if len(p) < 5 or not p[0].isdigit() or int(p[1]) not in HOURS:
            continue
        v = next((x for x in p[2:5] if x.strip()), None)
        if v:
            out[f"20{p[0][:2]}-{p[0][2:4]}-{p[0][4:6]}"].append(float(v.replace(",", ".")))
    return {d: float(np.mean(v)) for d, v in out.items()}


def main():
    OUT_RAW.mkdir(parents=True, exist_ok=True)
    grid = json.loads((DAILY / "_grid.json").read_text())
    files = sorted(DAILY.glob("*.npz"))
    result = {"source": "SINCA, Ministerio del Medio Ambiente (registros horarios de NO2, 13 a 15 h)", "stations": []}
    info = {}
    for code, (name, comuna) in STATIONS.items():
        ll = coords(code)
        info[code] = dict(name=name, comuna=comuna, ll=ll, ground=hourly(code), sat={})
        print(f"{code} {name:26s} {comuna:11s} coords={ll and (round(ll[0], 4), round(ll[1], 4))} días con dato en tierra={len(info[code]['ground'])}")
    for f in files:
        a = np.load(f)["no2"]
        for s in info.values():
            if not s["ll"]:
                continue
            r = int((s["ll"][0] - grid["lat0"]) / grid["dlat"])
            c = int((s["ll"][1] - grid["lon0"]) / grid["dlon"])
            v = a[r - 1:r + 2, c - 1:c + 2]
            if np.isfinite(v).sum() >= 4:
                s["sat"][f.stem] = float(np.nanmean(v))
    for code, s in info.items():
        days = sorted(set(s["sat"]) & set(s["ground"]))
        by_m = defaultdict(list)
        for d in days:
            by_m[d[:7]].append((s["sat"][d], s["ground"][d]))
        mon = {m: (float(np.mean([x for x, _ in v])), float(np.mean([y for _, y in v]))) for m, v in by_m.items() if len(v) >= 8}
        ms = sorted(mon)
        sat_m, gr_m = {m: mon[m][0] for m in ms}, {m: mon[m][1] for m in ms}
        r_m, n_m = pearson([sat_m[m] for m in ms], [gr_m[m] for m in ms])
        sa, ga = anomalies(sat_m), anomalies(gr_m)
        r_d, _ = pearson([sa[m] for m in ms], [ga[m] for m in ms]) if n_m >= 24 else (None, 0)
        by_y = defaultdict(list)
        for m in ms:
            by_y[m[:4]].append(mon[m])
        yr = {y: (float(np.mean([x for x, _ in v])), float(np.mean([g for _, g in v]))) for y, v in by_y.items() if len(v) >= 8}
        r_y, n_y = pearson([v[0] for v in yr.values()], [v[1] for v in yr.values()])
        r_day, n_day = pearson([s["sat"][d] for d in days], [s["ground"][d] for d in days])
        rr = lambda v: None if v is None else round(v, 2)
        print(f"  {s['name']:26s} días r={rr(r_day)} (n={n_day}) | meses r={rr(r_m)} (n={n_m}, IC {fisher_ci(r_m, n_m)}) sin estaciones r={rr(r_d)} | años r={rr(r_y)} (n={n_y})")
        result["stations"].append({"code": code, "name": s["name"], "comuna": s["comuna"], "lat": s["ll"] and round(s["ll"][0], 4), "lon": s["ll"] and round(s["ll"][1], 4),
                                   "r_daily": r_day, "n_daily": n_day, "r_monthly": r_m, "n_monthly": n_m, "ci_monthly": fisher_ci(r_m, n_m), "r_monthly_deseason": r_d,
                                   "r_annual": r_y, "n_annual": n_y,
                                   "monthly": {m: {"sat": round(mon[m][0], 3), "ground": round(mon[m][1], 2)} for m in ms}})
    (ROOT / "web" / "public" / "data" / "sinca.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf8")


if __name__ == "__main__":
    main()
