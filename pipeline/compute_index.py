"""Etapa 1: indice mensual de NO2 por mina, estadisticas y capas del mapa.

Lee data/daily/*.npz y genera:
- web/public/data/index.json  (series por mina, produccion y declarado)
- web/public/no2/AAAA-MM.png  (capa mensual del mapa, en proyeccion Web Mercator)
"""
import json
import math
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

from common import DAILY, PROCESSED, ROOT

WEB_DATA = ROOT / "web" / "public" / "data"
WEB_NO2 = ROOT / "web" / "public" / "no2"
CONFIG = ROOT / "data" / "config" / "mines.json"

CORE_KM = 10      # radio sobre la mina
RING_KM = (40, 80)  # anillo de fondo
MIN_DAYS = 3      # dias minimos con dato por pixel para promediar el mes

# Paleta: valor (1e15 molec/cm2) -> RGBA
STOPS = [(0.55, (255, 230, 120, 0)), (0.9, (255, 214, 0, 110)), (1.4, (255, 140, 0, 175)),
         (2.2, (235, 45, 45, 215)), (3.4, (200, 0, 160, 235))]


def load_grid():
    return json.loads((DAILY / "_grid.json").read_text())


def monthly_means(grid):
    sums, counts = {}, {}
    for f in sorted(DAILY.glob("*.npz")):
        a = np.load(f)["no2"].astype("float32")
        if a.shape != tuple(grid["shape"]):
            continue
        m = f.stem[:7]
        ok = np.isfinite(a)
        if m not in sums:
            sums[m] = np.zeros(a.shape, "float64")
            counts[m] = np.zeros(a.shape, "int32")
        sums[m][ok] += a[ok]
        counts[m] += ok
    out = {}
    for m in sorted(sums):
        with np.errstate(all="ignore"):
            mean = np.where(counts[m] >= MIN_DAYS, sums[m] / counts[m], np.nan)
        out[m] = (mean.astype("float32"), counts[m])
    return out


def pixel_dist_km(grid, lat, lon):
    h, w = grid["shape"]
    lats = grid["lat0"] + (np.arange(h) + 0.5) * grid["dlat"]
    lons = grid["lon0"] + (np.arange(w) + 0.5) * grid["dlon"]
    dy = (lats[:, None] - lat) * 111.0
    dx = (lons[None, :] - lon) * 111.0 * math.cos(math.radians(lat))
    return np.hypot(dx, dy)


def to_mercator_png(mean, grid, path):
    h, w = mean.shape
    lat_top, lat_bot = grid["lat0"], grid["lat0"] + h * grid["dlat"]
    merc = lambda la: math.log(math.tan(math.pi / 4 + math.radians(la) / 2))
    out_h = h * 3
    ys = np.linspace(merc(lat_top), merc(lat_bot), out_h)
    lats = np.degrees(2 * np.arctan(np.exp(ys)) - math.pi / 2)
    src_rows = np.clip(((lats - lat_top) / grid["dlat"]).astype(int), 0, h - 1)
    v = mean[src_rows, :]
    rgba = np.zeros(v.shape + (4,), "float32")
    vv = np.nan_to_num(v, nan=0.0)
    for (v0, c0), (v1, c1) in zip(STOPS[:-1], STOPS[1:]):
        sel = (vv >= v0) & (vv < v1)
        t = ((vv - v0) / (v1 - v0))[sel][:, None]
        rgba[sel] = np.array(c0) * (1 - t) + np.array(c1) * t
    rgba[vv >= STOPS[-1][0]] = STOPS[-1][1]
    img = Image.fromarray(rgba.clip(0, 255).astype("uint8"), "RGBA").resize((w * 3, out_h), Image.BICUBIC)
    img.save(path, optimize=True)


def pearson(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    ok = np.isfinite(a) & np.isfinite(b)
    if ok.sum() < 3 or np.std(a[ok]) == 0 or np.std(b[ok]) == 0:
        return None, int(ok.sum())
    return float(np.corrcoef(a[ok], b[ok])[0, 1]), int(ok.sum())


def anomalies(vals):
    """Quita el ciclo de las estaciones: resta a cada mes el promedio de ese mes del año."""
    by = defaultdict(list)
    for m, v in vals.items():
        by[m[5:7]].append(v)
    clim = {k: float(np.mean(v)) for k, v in by.items()}
    return {m: v - clim[m[5:7]] for m, v in vals.items()}


def rebase(vals, src_fy, dst_fy):
    """Pasa una serie anual de un calendario a otro repartiendo proporcionalmente (12 = año calendario)."""
    src, dst = src_fy or 12, dst_fy or 12
    if src == dst:
        return dict(vals)
    out = {}
    for y in vals:
        if dst == 12:  # de año fiscal a calendario: los meses 1..src del año Y están en FY(Y); el resto, en FY(Y+1)
            a, b, w = y, str(int(y) + 1), src / 12
        else:          # de calendario a año fiscal: FY(Y) = meses dst+1..12 de Y-1 más meses 1..dst de Y
            a, b, w = y, str(int(y) - 1), dst / 12
        if a in vals and b in vals:
            out[y] = w * vals[a] + (1 - w) * vals[b]
    return out


def zone_total(decl):
    """Suma de emisiones directas declaradas por las minas de una zona, en el calendario de la mayor."""
    parts = {k: d for k, d in decl.items() if len(d.get("series", {}).get("scope1_tco2e", {})) >= 3}
    if len(parts) < 2:
        return None
    lead = max(parts, key=lambda k: np.mean(list(parts[k]["series"]["scope1_tco2e"].values())))
    fy = parts[lead].get("fiscal_year_end_month")
    conv = {k: rebase(d["series"]["scope1_tco2e"], d.get("fiscal_year_end_month"), fy) for k, d in parts.items()}
    years = sorted(set.intersection(*(set(v) for v in conv.values())))
    if len(years) < 3:
        return None
    basis = "año fiscal julio-junio" if fy else "año calendario"
    companies = list(dict.fromkeys(d["company"] for d in parts.values()))
    return {"company": " + ".join(companies), "frequency": f"anual ({basis})", "derived": True,
            **({"fiscal_year_end_month": fy} if fy else {}),
            "source": {"doc": "Suma de las emisiones directas declaradas por las minas de la zona (cálculo propio)",
                       "note": f"Se usa el calendario de {parts[lead]['company']} ({basis}); los datos de la otra empresa se reparten proporcionalmente entre los años."},
            "series": {"scope1_tco2e": {y: round(sum(v[y] for v in conv.values()), 0) for y in years}}}


def fisher_ci(r, n):
    """Intervalo de confianza del 95 % de una correlacion (transformacion de Fisher). Con pocos años es muy ancho."""
    if r is None or n < 4:
        return None
    z, se = math.atanh(max(-0.999999, min(0.999999, r))), 1 / math.sqrt(n - 3)
    return [round(math.tanh(z - 1.96 * se), 3), round(math.tanh(z + 1.96 * se), 3)]


def changes_r(years, obs, decl):
    """Correlacion de los cambios de un año al siguiente: descarta que la coincidencia venga solo de una tendencia comun."""
    pairs = [(a, b) for a, b in zip(years, years[1:]) if int(b) == int(a) + 1]
    return pearson([obs[b] - obs[a] for a, b in pairs], [decl[b] - decl[a] for a, b in pairs])


def verdict(comparisons):
    """Regla fija, decidida antes de mirar los resultados.

    Se usa la comparacion principal (suma de la zona si existe; si no, emisiones directas de la mina).
    'coincide' exige r >= 0,7 y que el intervalo de confianza del 95 % no incluya el cero.
    """
    main_c = (next((c for c in comparisons if c["declared"] == "zona_total"), None)
              or next((c for c in comparisons if c["metric"] == "scope1_tco2e"), None))
    if not main_c:
        return {"code": "sin_dato"}
    r, n, ci = main_c["r"], main_c["n"], main_c["ci"]
    if r is None or n < 5:
        code = "insuficiente"
    elif r >= 0.7 and ci and ci[0] > 0:
        code = "coincide"
    elif r >= 0.4:
        code = "no_concluyente"
    else:
        code = "revisar"
    return {"code": code, "declared": main_c["declared"], "metric": main_c["metric"], "r": r, "n": n, "ci": ci}


def main():
    grid = load_grid()
    cfg = json.loads(CONFIG.read_text(encoding="utf8"))
    declared = json.loads((PROCESSED / "declared.json").read_text(encoding="utf8"))
    production = json.loads((PROCESSED / "production.json").read_text(encoding="utf8"))
    months = monthly_means(grid)
    WEB_DATA.mkdir(parents=True, exist_ok=True)
    WEB_NO2.mkdir(parents=True, exist_ok=True)

    sites = cfg["mines"] + [cfg["reference"]]
    masks = {}
    for s in sites:
        d = pixel_dist_km(grid, s["lat"], s["lon"])
        masks[s["id"]] = (d <= CORE_KM, (d >= RING_KM[0]) & (d <= RING_KM[1]))

    series = {s["id"]: {} for s in sites}
    for m, (mean, cnt) in months.items():
        to_mercator_png(mean, grid, WEB_NO2 / f"{m}.png")
        for s in sites:
            core, ring = masks[s["id"]]
            c = mean[core]
            r = mean[ring]
            if np.isfinite(c).sum() < 3 or np.isfinite(r).sum() < 20:
                continue
            core_v, bg_v = float(np.nanmean(c)), float(np.nanmedian(r))
            series[s["id"]][m] = {"core": round(core_v, 4), "bg": round(bg_v, 4), "excess": round(core_v - bg_v, 4),
                                  "days": int(np.median(cnt[core]))}

    def annual(monthly, fy_end=None):
        acc = defaultdict(list)
        for m, v in monthly.items():
            y, mo = int(m[:4]), int(m[5:7])
            key = y if not fy_end else (y + 1 if mo > fy_end else y)
            acc[key].append(v["excess"])
        return {str(k): {"excess": round(float(np.mean(v)), 4), "months": len(v)} for k, v in sorted(acc.items()) if len(v) >= 8}

    prod_series = production["series"]
    out_mines = []
    for s in cfg["mines"]:
        monthly = series[s["id"]]
        cols = [c for c in s.get("cochilco", []) if c in prod_series]
        prod = defaultdict(float)
        for c in cols:
            for m, v in prod_series[c].items():
                prod[m] += v
        if s["id"] == "chuquicamata":  # antes de la separacion, Cochilco reporta Chuqui y R.Tomic juntos
            for m, v in prod_series.get("Chuqui y R.Tomic", {}).items():
                if not any(m in prod_series.get(c, {}) for c in ("Chuquicamata", "Radomiro Tomic")):
                    prod[m] += v
        prod = {m: round(v, 3) for m, v in sorted(prod.items())}

        decl = {k: declared[k] for k in s.get("declared", []) if k in declared}
        total = zone_total(decl)
        if total:
            decl = {"zona_total": total, **decl}
        comparisons = []
        for k, d in decl.items():
            fy_end = d.get("fiscal_year_end_month")
            ann = annual(monthly, fy_end)
            for metric, vals in d.get("series", {}).items():
                years = sorted(y for y in vals if y in ann)
                obs = {y: ann[y]["excess"] for y in years}
                r, n = pearson([obs[y] for y in years], [vals[y] for y in years])
                r_ch, n_ch = changes_r(years, obs, vals)
                comparisons.append({"declared": k, "metric": metric, "years": years, "r": r, "n": n, "ci": fisher_ci(r, n),
                                    "r_changes": r_ch, "n_changes": n_ch, "confidence": "baja" if n < 5 else "normal"})
        def monthly_r(vals):  # correlacion mensual con la señal: tal cual y sin el ciclo de las estaciones
            ms = sorted(m for m in vals if m in monthly)
            ex = {m: monthly[m]["excess"] for m in ms}
            r, n = pearson([ex[m] for m in ms], [vals[m] for m in ms])
            ea, va = anomalies(ex), anomalies({m: vals[m] for m in ms})
            r_des = pearson([ea[m] for m in ms], [va[m] for m in ms])[0] if n >= 24 else None
            return r, r_des, n
        r_prod, r_des, n_prod = monthly_r(prod)
        monthly_cmp = []
        for k, d in decl.items():
            for metric, vals in d.get("monthly", {}).items():
                r, rd, n = monthly_r(vals)
                monthly_cmp.append({"declared": k, "metric": metric, "r": r, "r_deseason": rd, "n": n})
        out_mines.append({**s, "monthly": monthly, "annual": annual(monthly), "production": prod,
                          "declared_data": decl, "stats": {"r_production_deseason": r_des, "r_production_monthly": r_prod, "n_production_monthly": n_prod,
                                                           "comparisons": comparisons, "monthly_comparisons": monthly_cmp, "verdict": verdict(comparisons)}})

    h, w = grid["shape"]
    bounds = [grid["lon0"], grid["lat0"] + h * grid["dlat"], grid["lon0"] + w * grid["dlon"], grid["lat0"]]
    index = {
        "generated_from": "Sentinel-5P TROPOMI NO2 troposferico (RPRO hasta 2022-07-25, OFFL despues), calidad >= 75 %",
        "units": "1e15 moleculas/cm2", "core_km": CORE_KM, "ring_km": RING_KM,
        "bounds": bounds, "months": sorted(months), "mines": out_mines,
        "reference": {**cfg["reference"], "monthly": series[cfg["reference"]["id"]]},
        "production_source": production["source"],
    }
    (WEB_DATA / "index.json").write_text(json.dumps(index, ensure_ascii=False), encoding="utf8")
    print(f"{len(months)} meses | {len(out_mines)} minas | capas en {WEB_NO2}")
    for mm in out_mines:
        st = mm["stats"]
        rr = lambda v: None if v is None else round(v, 2)
        print(f"  {mm['id']:20s} veredicto={st['verdict']['code']:12s} prod: r={rr(st['r_production_monthly'])} sin estaciones={rr(st['r_production_deseason'])}")
        for c in st["comparisons"]:
            print(f"      anual   {c['declared']:14s} {c['metric']:13s} r={rr(c['r'])} n={c['n']} IC95={c['ci']} | cambios año a año r={rr(c['r_changes'])} n={c['n_changes']}")
        for c in st["monthly_comparisons"]:
            print(f"      mensual {c['declared']:14s} {c['metric']:13s} r={rr(c['r'])} sin estaciones={rr(c['r_deseason'])} n={c['n']}")


if __name__ == "__main__":
    main()
