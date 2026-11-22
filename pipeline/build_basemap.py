"""Mapa base local (sin internet): paises, fronteras y ciudades de Natural Earth 1:10m.

Lee data/raw/basemap/*.geojson (dominio publico, naturalearthdata.com) y escribe web/public/data/base.geojson
con poligonos de tierra recortados a la region, lineas de frontera/costa y ciudades principales.
"""
import json

from common import RAW, ROOT

SRC = RAW / "basemap"
OUT = ROOT / "web" / "public" / "data" / "base.geojson"
X0, X1, Y0, Y1 = -80.0, -58.0, -40.0, -10.0   # region que se conserva
MIN_STEP = 0.008                               # ~1 km: se descartan vertices mas cercanos
CITIES = ["Arica", "Iquique", "Calama", "Antofagasta", "Copiapó", "La Serena", "Santiago", "Salta", "Tacna"]


def thin(points):
    out = [points[0]]
    for p in points[1:-1]:
        if abs(p[0] - out[-1][0]) + abs(p[1] - out[-1][1]) >= MIN_STEP:
            out.append(p)
    out.append(points[-1])
    return out


def clamp_ring(ring):
    pts = []
    for x, y in ring:
        p = [round(min(max(x, X0), X1), 3), round(min(max(y, Y0), Y1), 3)]
        if not pts or pts[-1] != p:
            pts.append(p)
    if len(pts) < 3:
        return None
    if pts[0] != pts[-1]:
        pts.append(pts[0])
    pts = thin(pts)
    area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(pts, pts[1:])) / 2
    return pts if len(pts) >= 4 and abs(area) > 1e-4 else None


def inside_runs(ring):
    run = []
    for x, y in ring:
        if X0 < x < X1 and Y0 < y < Y1:
            run.append([round(x, 3), round(y, 3)])
        else:
            if len(run) >= 2:
                yield thin(run)
            run = []
    if len(run) >= 2:
        yield thin(run)


def main():
    countries = json.loads((SRC / "ne_10m_admin_0_countries.geojson").read_text(encoding="utf8"))
    feats = []
    for f in countries["features"]:
        g, p = f["geometry"], f["properties"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        for poly in polys:
            xs, ys = [c[0] for c in poly[0]], [c[1] for c in poly[0]]
            if max(xs) < X0 or min(xs) > X1 or max(ys) < Y0 or min(ys) > Y1:
                continue
            rings = [r for r in (clamp_ring(r) for r in poly) if r]
            if rings and rings[0]:
                feats.append({"type": "Feature", "properties": {"kind": "land", "iso": p["ADM0_A3"], "name": p.get("NAME_ES") or p["ADMIN"]},
                              "geometry": {"type": "Polygon", "coordinates": rings}})
            for ring in poly:
                for run in inside_runs(ring):
                    feats.append({"type": "Feature", "properties": {"kind": "border", "iso": p["ADM0_A3"]},
                                  "geometry": {"type": "LineString", "coordinates": run}})
    places = json.loads((SRC / "ne_10m_populated_places_simple.geojson").read_text(encoding="utf8"))
    best = {}
    for f in places["features"]:
        p = f["properties"]
        x, y = f["geometry"]["coordinates"][:2]
        if p["name"] in CITIES and X0 < x < X1 and Y0 < y < Y1 and p["adm0name"] in ("Chile", "Argentina", "Peru"):
            if p["name"] not in best or (p.get("pop_max") or 0) > best[p["name"]][0]:
                best[p["name"]] = (p.get("pop_max") or 0, x, y)
    for name, (_, x, y) in best.items():
        feats.append({"type": "Feature", "properties": {"kind": "city", "name": name},
                      "geometry": {"type": "Point", "coordinates": [round(x, 3), round(y, 3)]}})
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False, separators=(",", ":")), encoding="utf8")
    kinds = {}
    for f in feats:
        kinds[f["properties"]["kind"]] = kinds.get(f["properties"]["kind"], 0) + 1
    print(f"{OUT.name}: {OUT.stat().st_size // 1024} KB", kinds, sorted({f['properties']['name'] for f in feats if f['properties']['kind'] == 'city'}))


if __name__ == "__main__":
    main()
