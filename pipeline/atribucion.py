"""Atribucion de origen de episodios de SO2 medidos en tierra (SINCA). Ordena fuentes probables; no prueba responsabilidad.

Para cada episodio (horas seguidas sobre 350 ug/m3N, la norma horaria del D.S. 104/2018):

0. Control del instrumento. Si el valor se repite casi identico (meseta) no es una pluma: es una posible falla o
   calibracion y NO se atribuye. Un pico de una sola hora sin "hombros" baja la confianza.
1. Trayectoria inversa. Desde la estacion se retrocede hora a hora con el viento. Se usa, en este orden: el viento
   medido en la misma estacion; el medido en la estacion mas cercana a menos de 15 km; el reanalisis ERA5 a 100 m:   x(t0 - k h) = x(t0) + suma_k u_k * 3,6 km * (sen th_k, cos th_k),
   con th_k la direccion DESDE la que sopla el viento.
2. Para cada fuente del inventario oficial (RETC): distancia lateral y al paso mas cercano, recorrido s, viaje t.
3. Concentracion esperada (pluma gaussiana mezclada hasta la altura H):
       C_i = Q_i / (raiz(2 pi) u sig_i H) * exp(-y_i^2 / (2 sig_i^2)) * exp(-t_i / tau)
   Q_i emision declarada del año (g/s); u viento (m/s); sig_i = raiz(sig_y(s)^2 + (s tan m)^2), con sig_y de
   Briggs (1973, rural) segun la estabilidad y m la variacion del viento en el trayecto.
4. Reparto:  P_i = C_i / (suma_j C_j + C_fondo),  C_fondo = mediana historica de la estacion
   ("fondo y fuentes no inventariadas" recibe C_fondo / (suma C + C_fondo)).
5. Incertidumbre por Monte Carlo (N sorteos, con semilla fija por episodio): direccion +-12 grados (medida en la
   estacion), +-18 (medida en una estacion vecina) o +-28 (modelo), velocidad +-25 %,
   tau entre 6 y 48 h, altura de mezcla +-40 %, emision de cada fuente +-40 %. Se informa la mediana y el rango 5-95 %.
6. Factor de exceso R = (C_medido - C_fondo) / suma C: cuantas veces la emision promedio declarada explicaria el
   maximo. Solo orden de magnitud; no se calcula con la fuente a menos de 3 km.
7. Confianza (0-100): convencion propia que descuenta por viento de modelo, calma, viento cambiante, dato no
   validado, mala alineacion o pico aislado. No es una probabilidad.

Ademas, por estacion con viento medido, la "rosa de origen" de 8 años: en que direcciones de viento ocurren las horas
altas (sobre el percentil 99) y cuanto mas frecuentes son cuando el viento viene desde cada fuente.
Salida: web/public/data/atribucion.json
"""
import json
import math
import time
import urllib.parse
import zlib
import urllib.request

from concurrent.futures import ThreadPoolExecutor

import numpy as np

import sinca
from common import PROCESSED, RAW, ROOT

HOURS_BACK, MAX_KM, MIN_SIGMA_KM, N_MC, NEIGHBOR_KM = 12, 120, 0.5, 400, 15
SIG_TH = {"medido": 12.0, "vecina": 18.0, "modelo": 28.0}
BRIGGS_Y = {"A": 0.22, "B": 0.16, "C": 0.11, "D": 0.08, "E": 0.06, "F": 0.04}
MIX_H = {"A": 1500, "B": 1500, "C": 1000, "D": 800, "E": 400, "F": 200}   # altura de mezcla por estabilidad (m, supuesto)
G_PER_S = 1e6 / (365 * 24 * 3600)
LEVELS = ((950, "emergencia"), (650, "preemergencia"), (500, "alerta"), (350, "sobre la norma horaria"), (262, "sobre la norma propuesta"), (150, "alza bajo la norma"))
key_of = lambda t: (str(t)[2:4] + str(t)[5:7] + str(t)[8:10], str(t)[11:13] + "00")


def stability(u, sw, cloud):
    """Clase de Pasquill (A muy inestable ... F muy estable) segun viento, radiacion solar y nubes."""
    j = 0 if u < 2 else 1 if u < 3 else 2 if u < 5 else 3 if u < 6 else 4
    if sw > 50:
        row = ("A", "A", "B", "C", "C") if sw >= 600 else ("A", "B", "B", "C", "D") if sw >= 300 else ("B", "C", "C", "D", "D")
    else:
        row = ("E", "E", "D", "D", "D") if cloud >= 50 else ("F", "F", "E", "D", "D")
    return row[j]


def era5(lat, lon, day):
    """Viento a 100 m, radiacion y nubes por hora (UTC) desde Open-Meteo, de 2 dias antes a 1 despues."""
    d = np.datetime64(day)
    path = RAW / "era5_hourly" / f"{lat:.3f}_{lon:.3f}_{day}.json"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        q = urllib.parse.urlencode({"latitude": lat, "longitude": lon, "start_date": str(d - 2), "end_date": str(d + 1), "timezone": "GMT", "wind_speed_unit": "ms",
                                    "hourly": "wind_speed_100m,wind_direction_100m,shortwave_radiation,cloud_cover"})
        for attempt in range(5):  # la API limita las llamadas por minuto: se reintenta con espera
            try:
                body = urllib.request.urlopen(urllib.request.Request("https://archive-api.open-meteo.com/v1/archive?" + q, headers={"User-Agent": "ojo-satelital"}), timeout=120).read()
                json.loads(body)["hourly"]
                path.write_bytes(body)
                break
            except Exception:
                if attempt == 4:
                    raise
                time.sleep(4 * (attempt + 1))
    h = json.loads(path.read_text())["hourly"]
    return {t: {k: h[k][i] for k in h if k != "time"} for i, t in enumerate(h["time"])}


def circ_sd(dirs):
    a = np.radians(dirs)
    return math.degrees(math.sqrt(-2 * math.log(max(math.hypot(np.mean(np.sin(a)), np.mean(np.cos(a))), 1e-6))))


def instrument_check(ev, obs):
    """Meseta (valor repetido) o pico aislado: señales de que la lectura no es una pluma real."""
    t, end, vals = np.datetime64(ev["start"]), np.datetime64(ev["end"]), []
    while t <= end:
        v = obs.get(key_of(t), (None,))[0]
        if v is not None and v >= 0.7 * ev["peak"]:
            vals.append(v)
        t += np.timedelta64(1, "h")
    near = sum(abs(v - ev["peak"]) <= 0.01 * ev["peak"] for v in vals)
    plateau = (near >= 3 and near / len(vals) >= 0.6) or (ev["peak"] >= 350 and len(vals) == 2 and abs(vals[0] - vals[1]) <= 0.001 * ev["peak"])
    t0 = np.datetime64(ev["peak_time"])
    side = [obs.get(key_of(t0 + np.timedelta64(k, "h")), (None,))[0] for k in (-1, 1)]
    isolated = ev["hours"] == 1 and all(v is not None and v < 0.05 * ev["peak"] for v in side)
    return plateau, isolated


def attribute(st, ev, sources, obs, wd, ws, background, lender=None):
    """lender = (nombre, km) de la estacion vecina que presta su viento medido, si esta estacion no lo mide."""
    plateau, isolated = instrument_check(ev, obs)
    rng = np.random.default_rng(zlib.crc32(f"{st['code']} {ev['peak_time']}".encode()))  # mismo resultado en cada ejecucion
    t0 = np.datetime64(ev["peak_time"])                       # hora local de invierno (UTC-4)
    model = era5(st["lat"], st["lon"], str(t0)[:10])
    hours = []
    for k in range(HOURS_BACK):
        t = t0 - np.timedelta64(k, "h")
        m = model.get(str(t + np.timedelta64(4, "h"))[:16], {})
        if key_of(t) in wd and key_of(t) in ws:
            u, th, src = ws[key_of(t)][0], wd[key_of(t)][0], "vecina" if lender else "medido"
        elif m.get("wind_speed_100m") is not None:
            u, th, src = m["wind_speed_100m"], m["wind_direction_100m"], "modelo"
        else:
            break
        u = max(u, 0.3)
        hours.append({"t": str(t)[:16], "u": round(u, 2), "dir": round(th, 1), "src": src, "cls": stability(u, m.get("shortwave_radiation") or 0, m.get("cloud_cover") or 0)})
    if not hours:
        return None
    pts, e, n, s = [(0.0, 0.0, 0.0, 0)], 0.0, 0.0, 0.0        # trayectoria inversa en km (este, norte, recorrido, hora)
    for k, h in enumerate(hours):
        for _ in range(6):
            e, n, s = e + h["u"] * 0.6 * math.sin(math.radians(h["dir"])), n + h["u"] * 0.6 * math.cos(math.radians(h["dir"])), s + h["u"] * 0.6
            pts.append((e, n, s, k))
        if s > MAX_KM:
            break
    P = np.array(pts)
    kind = hours[0]["src"]
    wind_from = math.degrees(math.atan2(np.mean([math.sin(math.radians(h["dir"])) for h in hours[:3]]), np.mean([math.cos(math.radians(h["dir"])) for h in hours[:3]]))) % 360
    year, cands = ev["peak_time"][:4], []
    for so in sources:
        east = (so["lon"] - st["lon"]) * 111.32 * math.cos(math.radians(st["lat"]))
        north = (so["lat"] - st["lat"]) * 110.57
        dist, vals = math.hypot(east, north), so["so2"]
        if dist > MAX_KM or not vals:
            continue
        q_max = max(vals.values())
        ok_year = vals.get(year) and vals[year] >= 0.2 * q_max
        q = vals[year] if ok_year else float(np.median([v for v in vals.values() if v >= 0.2 * q_max]))
        if q < 20:
            continue
        bearing = (math.degrees(math.atan2(east, north)) + 360) % 360
        cands.append({"id": so["id_vu"], "name": " ".join(so["name"].split()), "owner": so["owner"], "comuna": so["comuna"], "lat": so["lat"], "lon": so["lon"], "km": round(dist, 1),
                      "bearing": round(bearing), "off_axis": round(abs((wind_from - bearing + 180) % 360 - 180)), "so2_t_year": round(q),
                      "q_note": None if ok_year else "el RETC de ese año está incompleto para esta fuente: se usa la mediana de los otros años", "_e": east, "_n": north})

    def expected(rot, f, tau, hf, qf):
        """Concentracion esperada de cada fuente con la trayectoria girada rot grados y el viento escalado por f."""
        c, sn = math.cos(math.radians(rot)), math.sin(math.radians(rot))
        X, Y = (P[:, 0] * c + P[:, 1] * sn) * f, (-P[:, 0] * sn + P[:, 1] * c) * f
        out = []
        for j, cd in enumerate(cands):
            d = np.hypot(X - cd["_e"], Y - cd["_n"])
            i = int(np.argmin(d))
            hk, s_km = hours[int(P[i, 3])], max(float(P[i, 2]) * f, 0.3)
            used = [h["dir"] for h in hours[: int(P[i, 3]) + 1]]
            x = min(s_km, 60) * 1000
            sig = max(MIN_SIGMA_KM, math.hypot(BRIGGS_Y[hk["cls"]] * x / math.sqrt(1 + 0.0001 * x) / 1000, s_km * math.tan(math.radians(min(circ_sd(used) if len(used) > 1 else 0, 40)))))
            align = math.exp(-float(d[i]) ** 2 / (2 * sig * sig))
            u = hk["u"] * f
            out.append((cd["so2_t_year"] * qf[j] * G_PER_S * 1e6 / (math.sqrt(2 * math.pi) * u * sig * 1000 * MIX_H[hk["cls"]] * hf) * align * math.exp(-(s_km / (u * 3.6)) / tau), align, float(d[i]), s_km / (u * 3.6)))
        return out

    base = expected(0, 1, 24, 1, np.ones(len(cands)))
    draws = np.array([[x[0] for x in expected(rng.normal(0, SIG_TH[kind]), math.exp(rng.normal(0, 0.25)), rng.uniform(6, 48), math.exp(rng.normal(0, 0.4)), np.exp(rng.normal(0, 0.4, len(cands))))]
                      for _ in range(N_MC)]) if cands else np.zeros((N_MC, 0))
    den = draws.sum(1) + background
    shares = 100 * draws / den[:, None]
    bg = 100 * background / den
    for j, cd in enumerate(cands):
        cd.update(share=round(float(np.median(shares[:, j])), 1), share_lo=round(float(np.percentile(shares[:, j], 5)), 1), share_hi=round(float(np.percentile(shares[:, j], 95)), 1),
                  align=round(base[j][1], 3), miss_km=round(base[j][2], 1), travel_h=round(base[j][3], 1), expected=round(base[j][0], 2))
        del cd["_e"], cd["_n"]
    cands.sort(key=lambda c: (-c["share"], c["km"]))
    cands = [c for c in cands if c["share"] >= 1 or (c["km"] <= 30 and c["so2_t_year"] >= 1000)][:6]
    top = cands[0] if cands and cands[0]["share"] >= 1 else None
    total = float(np.median(draws.sum(1))) if len(cands) else 0.0
    excess = round((ev["peak"] - background) / total, 1) if top and top["km"] >= 3 and total > 0.5 else None

    conf, why = 100, []
    for cond, off, text in (
        (kind == "modelo", 25, "viento de un modelo (ERA5), no medido en la estación"),
        (kind == "vecina", 10, f"viento medido en otra estación ({lender[0]}, a {lender[1]} km)" if lender else ""),
        (hours[0]["u"] < 1.0, 20, "viento en calma: la dirección no es confiable"),
        (circ_sd([h["dir"] for h in hours[:4]]) > 40, 15, "viento cambiante en las horas previas"),
        (ev["status"] != "validado", 5 if ev["status"] == "preliminar" else 10,
         "dato informado por la propia empresa a la SMA; la autoridad no lo valida" if ev["status"].startswith("informado") else f"dato {ev['status']} por la autoridad"),
        (top is not None and top["align"] < 0.3, 20, "la fuente principal no queda bien alineada con el viento"),
        (isolated, 20, "pico de una sola hora, sin subida ni bajada alrededor"),
    ):
        if cond:
            conf, why = conf - off, why + [text]
    bg_med = round(float(np.median(bg)), 1)
    big_near = [c for c in cands if c["km"] <= 30 and c["so2_t_year"] >= 1000]
    if plateau:
        verdict, conf = "lectura plana: instrumento saturado o con falla", 0
        why = ["el instrumento repite casi el mismo valor durante el episodio: el valor real no se conoce"]
    elif top is None or bg_med >= 50:
        verdict = "sin fuente inventariada en la dirección del viento"
    elif top["share"] >= 85 and top["share_lo"] >= 50 and conf >= 60:
        verdict = "fuente única probable"
    elif len(big_near) == 1 and big_near[0] is top and top["share"] >= 50:
        verdict = "fuente probable: única inventariada a menos de 30 km"
    else:
        verdict = "origen compartido o incierto"
    # establecimientos ubicados hacia donde venia el viento, aunque declaren poco SO2 (pistas; no implica que hayan emitido)
    upwind = []
    for so in sources:
        east, north = (so["lon"] - st["lon"]) * 111.32 * math.cos(math.radians(st["lat"])), (so["lat"] - st["lat"]) * 110.57
        off = abs((wind_from - (math.degrees(math.atan2(east, north)) + 360) % 360 + 180) % 360 - 180)
        if 0.3 < math.hypot(east, north) <= 30 and off <= 25:
            upwind.append({"name": " ".join(so["name"].split()), "owner": so["owner"], "km": round(math.hypot(east, north), 1), "off_axis": round(off), "lat": so["lat"], "lon": so["lon"],
                           "so2_max": round(so["max_so2"]), "nox_max": round(so["max_nox"])})
    upwind.sort(key=lambda x: x["km"])
    lon_k = 111.32 * math.cos(math.radians(st["lat"]))
    window = [(t0 + np.timedelta64(k, "h")) for k in range(-12, 13)]
    series = [{"t": str(t)[:16], "v": None if key_of(t) not in obs else round(obs[key_of(t)][0], 1)} for t in window]
    return {"id": f"{st['code'].replace('/', '-')}_{ev['peak_time']}", "series": series, "upwind": upwind[:5], "station": st["name"], "code": st["code"], "comuna": st["comuna"], "region": st["region"], "station_owner": st["owner"], "lat": st["lat"], "lon": st["lon"],
            "start": ev["start"], "end": ev["end"], "hours": ev["hours"], "hours_norm": ev.get("hours_norm", 0), "peak": ev["peak"], "peak_time": ev["peak_time"], "status": ev["status"],
            "level": next(lab for lim, lab in LEVELS if ev["peak"] >= lim), "background": round(background, 1), "plateau": bool(plateau), "isolated": bool(isolated),
            "wind": hours[:4], "wind_source": kind, "wind_station": lender[0] if lender and kind == "vecina" else None, "wind_km": lender[1] if lender and kind == "vecina" else None, "wind_from": round(wind_from), "trajectory": [[round(st["lon"] + p[0] / lon_k, 4), round(st["lat"] + p[1] / 110.57, 4)] for p in pts[::3]],
            "candidates": cands, "background_share": bg_med, "background_range": [round(float(np.percentile(bg, 5)), 1), round(float(np.percentile(bg, 95)), 1)],
            "excess_factor": excess, "confidence": max(conf, 0), "confidence_notes": why, "verdict": verdict, "top": top["name"] if top else None}


def rose(st, sources):
    """Rosa de origen de 8 años: en que direccion de viento ocurren las horas altas de SO2 (sobre el percentil 99)."""
    so2, wd, ws = sinca.series(st["code"], "SO2"), sinca.series(st["code"], "WDIR"), sinca.series(st["code"], "WSPD")
    keys = [k for k in so2 if k in wd and k in ws and k[0] >= "180501" and ws[k][0] >= 0.5]
    if len(keys) < 8000:
        return None
    c, d = np.array([so2[k][0] for k in keys]), np.array([wd[k][0] for k in keys])
    thr = float(np.percentile(c, 99))
    sec = ((d + 11.25) // 22.5).astype(int) % 16
    n_all, n_hi = np.bincount(sec, minlength=16), np.bincount(sec[c >= thr], minlength=16)
    out = {"code": st["code"], "station": st["name"], "comuna": st["comuna"], "lat": st["lat"], "lon": st["lon"], "hours": len(keys), "p99": round(thr, 1),
           "sectors": [{"from_deg": i * 22.5, "hours": int(n_all[i]), "high": int(n_hi[i]), "mean": round(float(c[sec == i].mean()), 2) if n_all[i] else None} for i in range(16)], "sources": []}
    for so in sources:
        east, north = (so["lon"] - st["lon"]) * 111.32 * math.cos(math.radians(st["lat"])), (so["lat"] - st["lat"]) * 110.57
        if math.hypot(east, north) > 40 or max(so["so2"].values(), default=0) < 300:
            continue
        b = (math.degrees(math.atan2(east, north)) + 360) % 360
        al = np.abs((d - b + 180) % 360 - 180) <= 22.5
        if al.sum() >= 100:
            out["sources"].append({"name": " ".join(so["name"].split()), "km": round(math.hypot(east, north), 1), "bearing": round(b), "hours_share": round(100 * float(al.mean()), 1),
                                   "high_share": round(100 * float(al[c >= thr].mean()), 1), "times_more": round(float(al[c >= thr].mean() / al.mean()), 1),
                                   "mean_aligned": round(float(c[al].mean()), 2), "mean_rest": round(float(c[~al].mean()), 2)})
    return out


def main():
    epi = json.loads((PROCESSED / "episodios_so2.json").read_text(encoding="utf8"))
    sources = json.loads((PROCESSED / "retc_so2_nox.json").read_text(encoding="utf8"))["establecimientos"]
    events, roses = [], []
    todo = {(st["lat"], st["lon"], ev["peak_time"][:10]) for st in epi["stations"] if st["lat"] is not None for ev in st["events"]}
    with ThreadPoolExecutor(5) as ex:  # baja antes, en paralelo, el viento de modelo de cada estacion y dia
        list(ex.map(lambda a: era5(*a), todo))
    print(f"viento de modelo listo para {len(todo)} combinaciones de estacion y dia", flush=True)
    for st in epi["stations"]:
        if st["lat"] is None:
            continue
        if st["wind"]:
            r = rose(st, sources)
            if r:
                roses.append(r)
        if not st["events"]:
            continue
        obs = sinca.series(st["code"], "SO2")
        lender, donor = None, st if st["wind"] else None
        if not donor:  # estacion sin viento: se usa el medido en la estacion mas cercana, si esta a menos de NEIGHBOR_KM
            km = lambda o: math.hypot((o["lon"] - st["lon"]) * 111.32 * math.cos(math.radians(st["lat"])), (o["lat"] - st["lat"]) * 110.57)
            near = sorted((o for o in epi["stations"] if o["wind"] and o["lat"] is not None and km(o) <= NEIGHBOR_KM), key=km)
            near = [o for o in near if len(sinca.series(o["code"], "WDIR")) > 20000]
            if near:
                donor, lender = near[0], (near[0]["name"].strip(), round(km(near[0]), 1))
        wd, ws = (sinca.series(donor["code"], "WDIR"), sinca.series(donor["code"], "WSPD")) if donor else ({}, {})
        bg = float(np.median([v for v, _ in obs.values()]))
        events += [r for r in (attribute(st, ev, sources, obs, wd, ws, bg, lender) for ev in st["events"]) if r]
    events.sort(key=lambda r: (r["plateau"], -r["peak"]))
    n_ev = {}
    for r in events:
        n_ev[r["code"]] = n_ev.get(r["code"], 0) + 1
    stations = [{"code": s["code"], "name": s["name"], "comuna": s["comuna"], "region": s["region"], "lat": s["lat"], "lon": s["lon"], "owner": s["owner"], "wind": s["wind"],
                 "hours": s["hours"], "max": s["max"], "p99": s["p99"], "events": n_ev.get(s["code"], 0)} for s in epi["stations"] if s["lat"] is not None]
    kind = lambda n: "fundición" if any(k in n for k in ("FUNDICION", "CHUQUICAMATA", "POTRERILLOS")) else "termoeléctrica" if any(k in n for k in ("CENTRAL", "TERMO", "GUACOLDA")) else "otra"
    src_pts = [{"name": " ".join(s["name"].split()), "owner": s["owner"], "comuna": s["comuna"], "lat": s["lat"], "lon": s["lon"], "so2_max": round(s["max_so2"]),
                "so2_last": round(s["so2"][max(s["so2"])]), "kind": kind(s["name"].upper())} for s in sources if s["max_so2"] >= 300]
    (ROOT / "web" / "public" / "data" / "atribucion.json").write_text(json.dumps({"method": "trayectoria inversa + pluma gaussiana sobre el inventario RETC, con Monte Carlo", "n_mc": N_MC,
                                                                                    "levels": dict((b, a) for a, b in LEVELS), "events": events, "roses": roses, "stations": stations, "sources": src_pts}, ensure_ascii=False), encoding="utf8")
    by = {}
    for r in events:
        by[r["verdict"]] = by.get(r["verdict"], 0) + 1
    print(f"{len(events)} episodios | {by}")
    for r in events:
        txt = " ; ".join(f"{x['name'][:22]} {x['share']:.0f}% [{x['share_lo']:.0f}-{x['share_hi']:.0f}] {x['km']} km, {x['off_axis']}° fuera del eje" for x in r["candidates"][:2])
        print(f"{r['peak_time']} {r['station'][:16]:16s} {r['peak']:5.0f} viento {r['wind_source']:6s} {r['wind'][0]['u']:4.1f} m/s desde {r['wind_from']:3d}° | {r['verdict'][:42]:42s} conf {r['confidence']:3d} | {txt} | fondo {r['background_share']:.0f}% | x{r['excess_factor']}")
    print("\nRosa de origen (8 años, viento medido): cuántas veces más frecuentes son las horas altas cuando el viento viene desde la fuente")
    for r in roses:
        for s in r["sources"]:
            print(f"  {r['station'][:26]:26s} ← {s['name'][:26]:26s} {s['km']:5.1f} km rumbo {s['bearing']:3d}°: {s['hours_share']:4.1f}% de las horas, {s['high_share']:4.1f}% de las horas altas (x{s['times_more']}) | media {s['mean_aligned']} vs {s['mean_rest']}")


if __name__ == "__main__":
    main()
