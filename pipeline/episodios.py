"""Episodios de SO2 medidos en tierra (SINCA), regiones de Antofagasta y Atacama, 2018-2026.

Para cada estacion con SO2 en el periodo: descarga la serie horaria, cuenta las horas sobre cada nivel y agrupa
en episodios las horas seguidas con 150 ug/m3N o mas. Cada episodio se clasifica despues segun su maximo:
  150 alza bajo la norma (umbral propio) | 262 norma propuesta en el anteproyecto de 2025 | 350 norma horaria vigente
  (D.S. 104/2018) | 500 alerta | 650 preemergencia | 950 emergencia.
Salida: data/processed/episodios_so2.json
"""
import html
import json
import re
import time
import urllib.request
from collections import Counter

import numpy as np

import sinca
from common import PROCESSED, RAW

LEVELS = (("alza", 150), ("propuesta", 262), ("norma", 350), ("alerta", 500), ("preemergencia", 650), ("emergencia", 950))
MIN_LEVEL, NORM = 150, 350
REGIONS = {"II": "Antofagasta", "III": "Atacama"}
# Estaciones que SINCA no publica: la serie la arma snifa_altonorte.py con las planillas que la empresa entrega a la SMA.
# Coordenadas de la planilla (UTM 19S 365787 E, 7367902 N). Cubre desde marzo de 2022; antes viene en archivos comprimidos.
EXTRA = [{"code": "SNIFA/LNE", "name": "La Negra", "region": "Antofagasta", "status": "informado por la empresa",
          "info": {"lat": -23.7945, "lon": -70.3174, "owner": "Complejo Metalúrgico Altonorte", "comuna": "Antofagasta", "wind": True}}]


def stations(region):
    path = RAW / "sinca" / f"region_{region}.html"
    if not path.exists():
        path.write_bytes(urllib.request.urlopen(urllib.request.Request(f"https://sinca.mma.gob.cl/index.php/region/index/id/{region}", headers=sinca.UA), timeout=60).read())
    out = {}
    for href in re.findall(r'href="([^"]*macropath=[^"]*)"', path.read_text(encoding="utf8", errors="replace")):
        m = re.search(r"header=([^&]*)&macropath=\./(R[IVX]+/\w+)/Cal/0001&macro=[^&]*&from=(\d+)&to=(\d+)", html.unescape(href))
        if m and int(m.group(4)[:2]) >= 18 and int(m.group(4)[:2]) < 90:
            out[m.group(2)] = m.group(1)
    return out


def ficha(code):
    key = code.split("/")[1]
    path = RAW / "sinca" / f"estacion_{key}.html"
    if not path.exists():
        path.write_bytes(urllib.request.urlopen(urllib.request.Request(f"https://sinca.mma.gob.cl/index.php/estacion/index/key/{key}", headers=sinca.UA), timeout=60).read())
        time.sleep(0.3)
    p = html.unescape(path.read_text(encoding="utf8", errors="replace"))
    ll = re.findall(r"(-\d{2}\.\d{4,})", p)[:2]
    owner = re.search(r"Propietario[^<]*</th>\s*<td[^>]*>([^<]+)", p)
    comuna = re.search(r"Comuna[^<]*</th>\s*<td[^>]*>([^<]+)", p)
    wind = bool(re.search(r"macropath=\./" + code + r"/Met/WDIR&macro=horario_010&from=\d+&to=(1[89]|2\d)", p))
    return {"lat": float(ll[0]) if len(ll) == 2 else None, "lon": float(ll[1]) if len(ll) == 2 else None,
            "owner": owner.group(1).strip() if owner else "", "comuna": comuna.group(1).strip() if comuna else "", "wind": wind}


def main():
    out = []
    todo = [(code, name, rname, None) for region, rname in REGIONS.items() for code, name in stations(region).items()]
    todo += [(x["code"], x["name"], x["region"], x) for x in EXTRA]
    if True:
        for code, name, rname, extra in todo:
            try:
                d = sinca.series(code, "SO2")
                info = extra["info"] if extra else ficha(code)
                if extra:
                    d = {k: (v, extra["status"]) for k, (v, _) in d.items()}
            except Exception as e:
                print(f"{code} {name}: ERROR {e!r}"[:140], flush=True)
                continue
            d = {k: v for k, v in d.items() if k[0] >= "180501"}
            if len(d) < 2000:
                continue
            keys = sorted(d)
            vals = np.array([d[k][0] for k in keys])
            counts = {lab: int((vals >= lim).sum()) for lab, lim in LEVELS}
            events, cur = [], None
            for k in keys:  # horas seguidas (o separadas por una hora) con MIN_LEVEL o mas
                v = d[k][0]
                if v >= MIN_LEVEL:
                    stamp = f"20{k[0][:2]}-{k[0][2:4]}-{k[0][4:6]}T{k[1][:2]}:00"
                    if cur and (np.datetime64(stamp) - np.datetime64(cur["end"])) <= np.timedelta64(2, "h"):
                        cur["end"], cur["hours"], cur["hours_norm"] = stamp, cur["hours"] + 1, cur["hours_norm"] + int(v >= NORM)
                        if v > cur["peak"]:
                            cur["peak"], cur["peak_time"], cur["status"] = round(v, 1), stamp, d[k][1]
                    else:
                        cur = {"start": stamp, "end": stamp, "hours": 1, "hours_norm": int(v >= NORM), "peak": round(v, 1), "peak_time": stamp, "status": d[k][1]}
                        events.append(cur)
            top = sorted(keys, key=lambda k: -d[k][0])[:5]
            years = Counter("20" + k[0][:2] for k in keys if d[k][0] >= NORM)
            rec = {"code": code, "name": name, "region": rname, **info, "hours": len(keys), "first": keys[0][0], "last": keys[-1][0],
                   "mean": round(float(vals.mean()), 2), "p99": round(float(np.percentile(vals, 99)), 1), "max": round(float(vals.max()), 1),
                   "counts": counts, "by_year": dict(sorted(years.items())), "events": events,
                   "top": [{"time": f"20{k[0][:2]}-{k[0][2:4]}-{k[0][4:6]}T{k[1][:2]}:00", "value": round(d[k][0], 1), "status": d[k][1]} for k in top]}
            out.append(rec)
            print(f"{code:9s} {name[:28]:28s} {info['comuna'][:14]:14s} horas {len(keys):6d} máx {rec['max']:7.1f} p99 {rec['p99']:6.1f} | {counts} | eventos {len(events)} | viento medido: {info['wind']}", flush=True)
    PROCESSED.mkdir(parents=True, exist_ok=True)
    (PROCESSED / "episodios_so2.json").write_text(json.dumps({"levels": dict(LEVELS), "source": "SINCA, Ministerio del Medio Ambiente; La Negra: seguimiento ambiental en SNIFA (SMA)", "stations": out}, ensure_ascii=False, indent=1), encoding="utf8")
    peaks = [e["peak"] for s in out for e in s["events"]]
    print(f"episodios (150 o mas): {len(peaks)} en {sum(1 for s in out if s['events'])} estaciones |", {lab: sum(p >= lim for p in peaks) for lab, lim in LEVELS})


if __name__ == "__main__":
    main()
