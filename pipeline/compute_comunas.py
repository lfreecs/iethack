"""Exposicion de la poblacion al NO2, por comuna.

Para cada comuna cubierta por el satelite se calcula el NO2 troposferico promedio sobre los lugares donde vive
su gente: cada celda de 1 km pesa segun las personas que viven en ella. El resultado se compara con el aire
limpio del desierto (alrededor del sitio de referencia sin fuentes) y se asigna un nivel.

No es una medicion de calidad del aire a nivel del suelo: el satelite mide el gas en toda la columna de aire
y no distingue si viene de una mina, de una ciudad o de una termoelectrica.

Entradas (data/raw/comunas):
  - limites comunales y regionales: Biblioteca del Congreso Nacional (BCN) via geoBoundaries, CC BY 3.0 IGO
  - poblacion 2020 en grilla de 1 km: WorldPop (ajustada a Naciones Unidas), CC BY 4.0
Salida: web/public/data/comunas.geojson
"""
import json
import math
import re

import numpy as np
import rasterio
from rasterio import features
from rasterio.windows import from_bounds

from common import DAILY, RAW, ROOT
from compute_index import load_grid, monthly_means

SRC = RAW / "comunas"
OUT = ROOT / "web" / "public" / "data" / "comunas.geojson"

# Niveles segun cuantas veces el aire limpio hay sobre la poblacion. Umbrales redondos, fijados por nosotros.
LEVELS = [(1.5, "Similar al aire limpio"), (2.5, "Moderado"), (4.0, "Alto"), (math.inf, "Muy alto")]
MIN_COVERAGE = 0.9     # parte de la poblacion de la comuna que debe tener medicion
MIN_MONTHS = 6         # meses con dato por celda para promediar un periodo
REF_RADIUS_KM = 80     # aire limpio: mediana del NO2 a menos de esta distancia del sitio de referencia
SIMPLIFY_DEG = 0.004   # ~450 m


def fix_text(s):
    """Algunos nombres vienen con tildes mal codificadas (ej. 'ValparaÃ\\xadso')."""
    return re.sub("Ã[\x80-\xbf]", lambda m: m.group().encode("latin-1").decode("utf-8"), s).strip()


def polygons(geom):
    return geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]


def bbox(geom):
    xs = [p[0] for poly in polygons(geom) for p in poly[0]]
    ys = [p[1] for poly in polygons(geom) for p in poly[0]]
    return min(xs), min(ys), max(xs), max(ys)


def simplify_ring(ring, tol):
    """Douglas-Peucker sobre un anillo cerrado."""
    pts = np.asarray(ring, float)[:, :2]
    n = len(pts)
    if n <= 5:
        return pts.round(3).tolist()
    keep = np.zeros(n, bool)
    far = int(np.argmax(np.hypot(*(pts - pts[0]).T)))
    keep[[0, far, n - 1]] = True
    stack = [(0, far), (far, n - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        seg = pts[b] - pts[a]
        rel = pts[a + 1:b] - pts[a]
        length = math.hypot(*seg)
        d = np.abs(seg[0] * rel[:, 1] - seg[1] * rel[:, 0]) / length if length else np.hypot(*rel.T)
        i = int(np.argmax(d))
        if d[i] > tol:
            keep[a + 1 + i] = True
            stack += [(a, a + 1 + i), (a + 1 + i, b)]
    return pts[keep].round(3).tolist()


def simplify(geom):
    out = []
    for poly in polygons(geom):
        rings = []
        for k, ring in enumerate(poly):
            r = simplify_ring(ring, SIMPLIFY_DEG)
            xs, ys = [p[0] for p in r], [p[1] for p in r]
            if len(r) >= 4 and (max(xs) - min(xs) + max(ys) - min(ys)) > 0.03:
                rings.append(r)
            elif k == 0:
                break  # se descarta el poligono completo (isla diminuta)
        if rings:
            out.append(rings)
    if not out:
        return None
    return {"type": "Polygon", "coordinates": out[0]} if len(out) == 1 else {"type": "MultiPolygon", "coordinates": out}


def period_mean(months, keys):
    stack = np.stack([months[k][0] for k in keys])
    ok = np.isfinite(stack)
    with np.errstate(all="ignore"):
        mean = np.where(ok.sum(0) >= min(MIN_MONTHS, len(keys)), np.nansum(stack, 0) / np.maximum(ok.sum(0), 1), np.nan)
    days = np.mean([months[k][1] for k in keys], axis=0)
    return mean, days


def main():
    grid = load_grid()
    H, W = grid["shape"]
    months = monthly_means(grid)
    cfg = json.loads((ROOT / "data" / "config" / "mines.json").read_text(encoding="utf8"))

    # periodos: ultimos 12 meses completos y años calendario completos
    keys = sorted(months)
    per_month = {}
    for f in DAILY.glob("*.npz"):
        per_month[f.stem[:7]] = per_month.get(f.stem[:7], 0) + 1
    if per_month[keys[-1]] < 25:
        keys = keys[:-1]
    last12 = keys[-12:]
    years = [y for y in sorted({k[:4] for k in keys}) if sum(k.startswith(y) for k in keys) == 12]
    fields = {"last12": period_mean(months, last12), **{y: period_mean(months, [k for k in keys if k.startswith(y)]) for y in years}}

    # aire limpio de referencia
    ref = cfg["reference"]
    rows = grid["lat0"] + (np.arange(H) + 0.5) * grid["dlat"]
    cols = grid["lon0"] + (np.arange(W) + 0.5) * grid["dlon"]
    dist = np.hypot((cols[None, :] - ref["lon"]) * 111 * math.cos(math.radians(ref["lat"])), (rows[:, None] - ref["lat"]) * 111)
    clean = {k: float(np.nanmedian(v[0][dist <= REF_RADIUS_KM])) for k, v in fields.items()}

    # poblacion (ventana algo mayor que la del satelite, para conocer la poblacion total de las comunas del borde)
    sat_w, sat_e = grid["lon0"], grid["lon0"] + W * grid["dlon"]
    sat_n, sat_s = grid["lat0"], grid["lat0"] + H * grid["dlat"]
    with rasterio.open(SRC / "chl_ppp_2020_1km_UNadj.tif") as src:
        win = from_bounds(sat_w - 0.5, sat_s - 1.5, min(sat_e + 0.5, src.bounds.right), min(sat_n + 0.5, src.bounds.top), src.transform).round_offsets().round_lengths()
        pop = src.read(1, window=win).astype("float64")
        tr = src.window_transform(win)
        pop[(pop == src.nodata) | ~np.isfinite(pop) | (pop < 0)] = 0
    ph, pw = pop.shape
    lon = tr.c + (np.arange(pw) + 0.5) * tr.a
    lat = tr.f + (np.arange(ph) + 0.5) * tr.e
    sr = np.floor((lat - grid["lat0"]) / grid["dlat"]).astype(int)
    sc = np.floor((lon - grid["lon0"]) / grid["dlon"]).astype(int)
    in_sat = ((sr >= 0) & (sr < H))[:, None] & ((sc >= 0) & (sc < W))[None, :]
    rr = np.clip(sr, 0, H - 1)[:, None].repeat(pw, 1)
    cc = np.clip(sc, 0, W - 1)[None, :].repeat(ph, 0)

    # poblacion en un cuadro de 5 x 5 km, para ubicar el centro poblado principal
    integral = np.pad(pop, ((3, 2), (3, 2))).cumsum(0).cumsum(1)
    box = integral[5:, 5:] - integral[:-5, 5:] - integral[5:, :-5] + integral[:-5, :-5]

    comunas = json.loads((SRC / "comunas_adm3_simplificado.geojson").read_text(encoding="utf8"))["features"]
    cand = [f for f in comunas if not (bbox(f["geometry"])[2] < sat_w or bbox(f["geometry"])[0] > sat_e or bbox(f["geometry"])[3] < sat_s or bbox(f["geometry"])[1] > sat_n)]
    labels = features.rasterize(((f["geometry"], i + 1) for i, f in enumerate(cand)), out_shape=pop.shape, transform=tr, fill=0, dtype="int32")
    regiones = json.loads((SRC / "regiones_adm1_simplificado.geojson").read_text(encoding="utf8"))["features"]
    reg_names = [re.sub(r"^Región (Metropolitana )?(de |del )?", "", fix_text(f["properties"]["shapeName"])) for f in regiones]
    reg_labels = features.rasterize(((f["geometry"], i + 1) for i, f in enumerate(regiones)), out_shape=pop.shape, transform=tr, fill=0, dtype="int32")

    n = len(cand) + 1
    flat = labels.ravel()
    total = np.bincount(flat, weights=pop.ravel(), minlength=n)
    stats = {}
    for k, (mean, days) in fields.items():
        v = mean[rr, cc]
        ok = in_sat & np.isfinite(v)
        w = np.where(ok, pop, 0).ravel()
        covered = np.bincount(flat, weights=w, minlength=n)
        with np.errstate(all="ignore"):
            stats[k] = (np.bincount(flat, weights=w * np.nan_to_num(v).ravel(), minlength=n) / covered,
                        covered / total,
                        np.bincount(flat, weights=w * days[rr, cc].ravel(), minlength=n) / covered)

    feats, skipped = [], []
    for i, f in enumerate(cand):
        k = i + 1
        name = fix_text(f["properties"]["shapeName"])
        no2, cover, days = (s[k] for s in stats["last12"])
        if total[k] < 1 or not np.isfinite(no2) or cover < MIN_COVERAGE:
            skipped.append(name)
            continue
        inside = labels == k
        j = int(np.argmax(np.where(inside, box, -1)))
        ty, tx = divmod(j, pw)
        town = (float(lon[tx]), float(lat[ty]))
        near = min(({"id": m["id"], "name": m.get("label", m["name"]),
                     "km": round(math.hypot((m["lon"] - town[0]) * 111 * math.cos(math.radians(town[1])), (m["lat"] - town[1]) * 111))} for m in cfg["mines"]),
                   key=lambda d: d["km"])
        ratio = no2 / clean["last12"]
        geom = simplify(f["geometry"])
        if not geom:
            skipped.append(name)
            continue
        feats.append({"type": "Feature", "geometry": geom, "properties": {
            "id": f["properties"]["shapeID"], "name": name, "region": reg_names[reg_labels[ty, tx] - 1] if reg_labels[ty, tx] else "",
            "pop": int(round(total[k], -1)), "no2": round(float(no2), 3), "ratio": round(float(ratio), 2),
            "level": next(n_ for n_, (lim, _) in enumerate(LEVELS, start=1) if ratio < lim),
            "days": round(float(days), 1), "town": [round(town[0], 3), round(town[1], 3)], "mine": near,
            "series": {y: round(float(stats[y][0][k]), 3) for y in years if np.isfinite(stats[y][0][k])}}})

    feats.sort(key=lambda f: -f["properties"]["ratio"])
    meta = {"period": [last12[0], last12[-1]], "years": years, "clean": {k: round(v, 3) for k, v in clean.items()},
            "levels": [{"level": i, "max_ratio": None if math.isinf(lim) else lim, "label": lab} for i, (lim, lab) in enumerate(LEVELS, start=1)],
            "units": grid["units"], "min_coverage": MIN_COVERAGE, "ref_radius_km": REF_RADIUS_KM, "population_year": 2020,
            "sources": {"limites": "Biblioteca del Congreso Nacional (BCN) vía geoBoundaries, CC BY 3.0 IGO",
                        "poblacion": "WorldPop 2020, 1 km, ajustada a Naciones Unidas, CC BY 4.0"}}
    OUT.write_text(json.dumps({"type": "FeatureCollection", "meta": meta, "features": feats}, ensure_ascii=False, separators=(",", ":")), encoding="utf8")

    P = lambda f: f["properties"]
    print(f"{OUT.name}: {OUT.stat().st_size // 1024} KB | {len(feats)} comunas | periodo {last12[0]} a {last12[-1]} | años {years[0]}-{years[-1]}")
    print(f"aire limpio (x1e15): {meta['clean']}")
    print("fuera por cobertura insuficiente:", skipped)
    for i, (_, lab) in enumerate(LEVELS, start=1):
        sel = [f for f in feats if P(f)["level"] == i]
        print(f"  nivel {i} {lab:24s} {len(sel):3d} comunas | {sum(P(f)['pop'] for f in sel):>9,d} personas")
    print("Mayor exposición:")
    for f in feats[:22]:
        p = P(f)
        print(f"  {p['name']:22s} {p['region']:20s} pob {p['pop']:>8,d} | NO2 {p['no2']:.2f} = x{p['ratio']:.2f} | {p['days']:.0f} días/mes | {p['mine']['name']} a {p['mine']['km']} km")
    print("Control de población (WorldPop 2020):", {P(f)["name"]: P(f)["pop"] for f in feats if P(f)["name"] in ("Antofagasta", "Calama", "Iquique", "Arica", "Copiapó", "La Serena", "Coquimbo", "Sierra Gorda")})


if __name__ == "__main__":
    main()
