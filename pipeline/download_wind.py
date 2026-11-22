"""Viento diario a la hora de paso de Sentinel-5P (~13:30 hora local) para cada mina.

Fuente: Open-Meteo Historical Weather API (reanalisis ERA5), sin clave. Atribucion: "Open-Meteo / ERA5".
Guarda data/raw/wind/<id>.json con u, v (m/s) y velocidad, promediando 16-18 UTC.
"""
import json
import math
import time
import urllib.parse
import urllib.request

from common import RAW, ROOT

OUT = RAW / "wind"
START, END = "2018-05-01", "2026-11-11"
HOURS_UTC = (16, 17, 18)


def fetch(lat, lon):
    q = urllib.parse.urlencode({
        "latitude": lat, "longitude": lon, "start_date": START, "end_date": END,
        "hourly": "wind_speed_100m,wind_direction_100m,wind_speed_10m,wind_direction_10m",
        "wind_speed_unit": "ms", "timezone": "GMT",
    })
    url = "https://archive-api.open-meteo.com/v1/archive?" + q
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "ojo-satelital"}), timeout=180).read())


def daily_vector(js, level="100m"):
    h = js["hourly"]
    acc = {}
    for t, spd, dirn in zip(h["time"], h[f"wind_speed_{level}"], h[f"wind_direction_{level}"]):
        if spd is None or dirn is None or int(t[11:13]) not in HOURS_UTC:
            continue
        # direccion meteorologica = de donde viene el viento
        u = -spd * math.sin(math.radians(dirn))
        v = -spd * math.cos(math.radians(dirn))
        acc.setdefault(t[:10], []).append((u, v))
    out = {}
    for d, vals in acc.items():
        u = sum(x for x, _ in vals) / len(vals)
        v = sum(y for _, y in vals) / len(vals)
        out[d] = {"u": round(u, 2), "v": round(v, 2), "speed": round(math.hypot(u, v), 2)}
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    cfg = json.loads((ROOT / "data" / "config" / "mines.json").read_text(encoding="utf8"))
    for s in cfg["mines"] + [cfg["reference"]]:
        path = OUT / f"{s['id']}.json"
        if path.exists():
            print(s["id"], "ya existia")
            continue
        js = fetch(s["lat"], s["lon"])
        data = {"source": "Open-Meteo Historical Weather API (ERA5)", "level": "100m", "hours_utc": HOURS_UTC,
                "lat": s["lat"], "lon": s["lon"], "daily": daily_vector(js)}
        path.write_text(json.dumps(data), encoding="utf8")
        speeds = [x["speed"] for x in data["daily"].values()]
        print(f"{s['id']:16s} dias={len(speeds)} viento medio={sum(speeds) / len(speeds):.1f} m/s")
        time.sleep(1.5)


if __name__ == "__main__":
    main()
