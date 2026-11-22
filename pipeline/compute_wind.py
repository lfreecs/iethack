"""Integracion del viento (Open-Meteo / ERA5) con el NO2 diario de Sentinel-5P.

Reglas fijadas ANTES de mirar resultados:
- calm:    exceso (nucleo 10 km - anillo 40-80 km) usando solo dias con viento <= 6 m/s.
- updown:  dias con viento >= 2 m/s; cada dia se rota para que el viento apunte a +x;
           NO2 a favor del viento (x 0..20 km, |y| <= 10 km) menos en contra (x -40..-15 km).
- emision: ajuste de una pluma con decaimiento (EMG) a la densidad de linea anual del campo rotado;
           E = a * w, convertido a toneladas de NOx por dia (NOx = 1.32 x NO2).

Salida: web/public/data/wind.json e informe por consola (con y sin viento, todas las minas).
"""
import json
import math
from collections import defaultdict

import numpy as np

from common import DAILY, PROCESSED, RAW, ROOT

CALM_MAX, ROT_MIN = 6.0, 2.0
HALF = 24                     # ventana sin rotar: +-24 px (~ +-94 km)
STEP_KM, EXT_KM = 3.0, 60.0   # grilla rotada
XS = np.arange(-EXT_KM, EXT_KM + 0.1, STEP_KM)
NOX_PER_NO2, M_NO2, AVOGADRO = 1.32, 46.0, 6.022e23


def emg_fit(x, L):
    """Ajusta L(x) = a * (exp(-(x-mu)/x0) H(x-mu) * Gauss(sigma)) + b. Devuelve a, x0, r2."""
    fine = np.arange(-150.0, 200.0, 1.0)
    best = None
    for x0 in (4, 6, 8, 12, 16, 20, 26, 34, 44, 56, 72, 90, 120, 160):
        for sigma in (4, 6, 8, 10, 13):
            k = np.exp(-0.5 * (np.arange(-40, 41) / sigma) ** 2)
            k /= k.sum()
            for mu in (-6, -3, 0, 3, 6):
                e = np.where(fine >= mu, np.exp(-(fine - mu) / x0), 0.0)
                m = np.interp(x, fine, np.convolve(e, k, mode="same"))
                A = np.column_stack([m, np.ones_like(m)])
                coef, *_ = np.linalg.lstsq(A, L, rcond=None)
                if coef[0] <= 0:
                    continue
                res = float(((A @ coef - L) ** 2).sum())
                if best is None or res < best[0]:
                    best = (res, coef[0], x0)
    if best is None:
        return None
    tot = float(((L - L.mean()) ** 2).sum())
    return {"a": float(best[1]), "x0_km": best[2], "r2": 1 - best[0] / tot if tot else 0.0}


def pearson(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    ok = np.isfinite(a) & np.isfinite(b)
    if ok.sum() < 3 or np.std(a[ok]) == 0 or np.std(b[ok]) == 0:
        return None
    return float(np.corrcoef(a[ok], b[ok])[0, 1])


def period_key(m, fy_end):
    y, mo = int(m[:4]), int(m[5:7])
    return str(y + 1 if (fy_end and mo > fy_end) else y)


def main():
    grid = json.loads((DAILY / "_grid.json").read_text())
    cfg = json.loads((ROOT / "data" / "config" / "mines.json").read_text(encoding="utf8"))
    declared = json.loads((PROCESSED / "declared.json").read_text(encoding="utf8"))
    sites = cfg["mines"] + [cfg["reference"]]
    H, W = grid["shape"]
    px_km_y = 111.0 * abs(grid["dlat"])
    side = 2 * HALF + 1

    geo = {}
    for s in sites:
        r0 = int((s["lat"] - grid["lat0"]) / grid["dlat"])
        c0 = int((s["lon"] - grid["lon0"]) / grid["dlon"])
        px_km_x = 111.0 * math.cos(math.radians(s["lat"])) * grid["dlon"]
        yy, xx = np.mgrid[-HALF:HALF + 1, -HALF:HALF + 1]
        dist = np.hypot(xx * px_km_x, yy * px_km_y)
        wind = json.loads((RAW / "wind" / f"{s['id']}.json").read_text())["daily"]
        geo[s["id"]] = dict(r0=r0, c0=c0, px_km_x=px_km_x, core=dist <= 10, ring=(dist >= 40) & (dist <= 80), wind=wind)

    n = len(XS)
    gx, gy = np.meshgrid(XS, XS)  # gx: a favor del viento, gy: transversal
    calm = {s["id"]: {} for s in sites}
    rot = {s["id"]: {} for s in sites}

    for f in sorted(DAILY.glob("*.npz")):
        a = np.load(f)["no2"].astype("float32")
        if a.shape != (H, W):
            continue
        day, month = f.stem, f.stem[:7]
        for s in sites:
            sid = s["id"]
            g = geo[sid]
            w = g["wind"].get(day)
            if not w:
                continue
            if w["speed"] <= CALM_MAX:
                rs, cs = g["r0"] - HALF, g["c0"] - HALF
                if rs >= 0 and cs >= 0 and rs + side <= H and cs + side <= W:
                    win = a[rs:rs + side, cs:cs + side]
                    ok = np.isfinite(win)
                    acc = calm[sid].setdefault(month, [np.zeros((side, side)), np.zeros((side, side))])
                    acc[0][ok] += win[ok]
                    acc[1] += ok
            if w["speed"] >= ROT_MIN:
                ux, uy = w["u"] / w["speed"], w["v"] / w["speed"]
                east = gx * ux - gy * uy
                north = gx * uy + gy * ux
                rr = np.rint(g["r0"] - north / px_km_y).astype(int)
                cc = np.rint(g["c0"] + east / g["px_km_x"]).astype(int)
                inside = (rr >= 0) & (rr < H) & (cc >= 0) & (cc < W)
                v = np.full((n, n), np.nan, "float32")
                v[inside] = a[rr[inside], cc[inside]]
                ok = np.isfinite(v)
                acc = rot[sid].setdefault(month, [np.zeros((n, n)), np.zeros((n, n)), 0.0, 0])
                acc[0][ok] += v[ok]
                acc[1] += ok
                acc[2] += w["speed"]
                acc[3] += 1

    down = (gx >= 0) & (gx <= 20) & (np.abs(gy) <= 10)
    up = (gx >= -40) & (gx <= -15) & (np.abs(gy) <= 10)
    frame = np.abs(gy) >= 45
    band = np.abs(XS) <= 30  # integracion transversal

    out = {"rules": {"calm_max_ms": CALM_MAX, "rot_min_ms": ROT_MIN,
                     "source": "Open-Meteo Historical Weather API (ERA5), viento a 100 m, 16-18 UTC"},
           "xs_km": XS.tolist(), "sites": {}}

    for s in sites:
        sid = s["id"]
        g = geo[sid]
        monthly = {}
        for m in sorted(set(calm[sid]) | set(rot[sid])):
            rec = {}
            if m in calm[sid]:
                sm, ct = calm[sid][m]
                with np.errstate(all="ignore"):
                    mean = np.where(ct >= 2, sm / ct, np.nan)
                c, r = mean[g["core"]], mean[g["ring"]]
                if np.isfinite(c).sum() >= 3 and np.isfinite(r).sum() >= 20:
                    rec["calm"] = round(float(np.nanmean(c) - np.nanmedian(r)), 4)
            if m in rot[sid]:
                sm, ct, ws, nd = rot[sid][m]
                with np.errstate(all="ignore"):
                    mean = np.where(ct >= 2, sm / ct, np.nan)
                if np.isfinite(mean[down]).sum() >= 10 and np.isfinite(mean[up]).sum() >= 10:
                    rec["updown"] = round(float(np.nanmean(mean[down]) - np.nanmean(mean[up])), 4)
                rec["wind"] = round(ws / max(nd, 1), 2)
                rec["days"] = nd
            monthly[m] = rec

        def annual(fy_end=None):
            groups = defaultdict(list)
            for m in monthly:
                groups[period_key(m, fy_end)].append(m)
            res = {}
            for k, ms in sorted(groups.items()):
                if len(ms) < 8:
                    continue
                rec = {}
                for metric in ("calm", "updown"):
                    vals = [monthly[m][metric] for m in ms if metric in monthly[m]]
                    if len(vals) >= 8:
                        rec[metric] = round(float(np.mean(vals)), 4)
                rm = [m for m in ms if m in rot[sid]]
                if rm:
                    sm = sum(rot[sid][m][0] for m in rm)
                    ct = sum(rot[sid][m][1] for m in rm)
                    ws = sum(rot[sid][m][2] for m in rm)
                    nd = sum(rot[sid][m][3] for m in rm)
                    with np.errstate(all="ignore"):
                        mean = np.where(ct >= 5, sm / ct, np.nan)
                    if np.isfinite(mean).mean() > 0.9 and nd:
                        bg = np.nanmedian(mean[frame])
                        # densidad de linea en moleculas por metro (NO2 en 1e15 molec/cm2 = 1e19 molec/m2)
                        L = np.nansum((mean - bg)[band, :], axis=0) * STEP_KM * 1000 * 1e19
                        fit = emg_fit(XS, L)
                        if fit:
                            wbar = ws / nd
                            tpd = fit["a"] * wbar * NOX_PER_NO2 / AVOGADRO * M_NO2 * 86400 / 1e6
                            rec.update(nox_tpd=round(tpd, 2), fit_r2=round(fit["r2"], 3), x0_km=fit["x0_km"], wind=round(wbar, 2))
                res[k] = rec
            return res

        sm = sum(v[0] for v in rot[sid].values())
        ct = sum(v[1] for v in rot[sid].values())
        with np.errstate(all="ignore"):
            plume = np.where(ct >= 20, sm / ct, np.nan)
        out["sites"][sid] = {
            "monthly": monthly, "annual": annual(), "annual_fy6": annual(6),
            "plume": [[None if not np.isfinite(v) else round(float(v), 3) for v in row] for row in plume],
        }

    (ROOT / "web" / "public" / "data" / "wind.json").write_text(json.dumps(out), encoding="utf8")

    base = json.loads((ROOT / "web" / "public" / "data" / "index.json").read_text(encoding="utf8"))
    fmt = lambda r: "   —  " if r is None else f"{r:6.2f}"
    rob = {}
    print("Coincidencia anual con lo declarado (r de Pearson). base = sin viento.")
    print(f"{'mina / dato declarado':42s} {'n':>2s} {'base':>6s} {'calma':>6s} {'viento':>6s} {'NOx':>6s}")
    for mine in base["mines"]:
        for key, d in mine.get("declared_data", {}).items():
            fy = d.get("fiscal_year_end_month")
            groups = defaultdict(list)
            for m, v in mine["monthly"].items():
                groups[period_key(m, fy)].append(v["excess"])
            ann_base = {k: float(np.mean(v)) for k, v in groups.items() if len(v) >= 8}
            ann_w = out["sites"][mine["id"]]["annual_fy6" if fy else "annual"]
            vals = d.get("series", {}).get("scope1_tco2e", {})
            years = sorted(y for y in vals if y in ann_base and y in ann_w)
            if len(years) < 5:
                continue
            ref = [vals[y] for y in years]
            cols = [pearson([ann_base[y] for y in years], ref)]
            cols += [pearson([ann_w[y].get(metric, np.nan) for y in years], ref) for metric in ("calm", "updown", "nox_tpd")]
            rob.setdefault(mine["id"], []).append({"declared": key, "n": len(years), "base": cols[0], "calm": cols[1], "updown": cols[2], "nox": cols[3]})
            print(f"{(mine['id'] + ' / ' + key):42s} {len(years):2d} " + " ".join(fmt(c) for c in cols))

    print("\nEmision estimada de NOx (t/dia) y calidad del ajuste, ultimo año calendario completo:")
    for s in sites:
        ann = out["sites"][s["id"]]["annual"]
        ys = [y for y in sorted(ann) if "nox_tpd" in ann[y]]
        if ys:
            a = ann[ys[-1]]
            print(f"  {s['id']:16s} {ys[-1]}: {a['nox_tpd']:6.1f} t/dia | r2 {a['fit_r2']:.2f} | x0 {a['x0_km']} km | viento {a['wind']} m/s")

    # piso de ruido (sitio sin fuentes) y confiabilidad de cada estimacion en toneladas
    floor = max((v.get("nox_tpd", 0) for v in out["sites"][cfg["reference"]["id"]]["annual"].values()), default=0)
    out["noise_floor_tpd"] = floor
    for sid, site in out["sites"].items():
        for key in ("annual", "annual_fy6"):
            for rec in site[key].values():
                if "nox_tpd" in rec:
                    rec["tau_h"] = round(rec["x0_km"] * 1000 / rec["wind"] / 3600, 2)  # permanencia aparente del NO2
                    rec["reliable"] = bool(rec["fit_r2"] >= 0.9 and rec["x0_km"] not in (4, 160) and 0.5 <= rec["tau_h"] <= 10
                                           and rec["nox_tpd"] > 1.5 * floor)
        site["robustness"] = rob.get(sid, [])
    (ROOT / "web" / "public" / "data" / "wind.json").write_text(json.dumps(out), encoding="utf8")


if __name__ == "__main__":
    main()
