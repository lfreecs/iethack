"""Indice de lugares para el buscador del mapa: minas, fuentes de emision, estaciones y localidades del norte.

- Minas: rajos de faenas categoria A del atlas de Sernageomin (data/raw/sernageomin/rajos_categoria_a.json).
- Fuentes: establecimientos del RETC con SO2 o NOx relevante (data/processed/retc_so2_nox.json).
- Estaciones: las de SINCA que miden SO2 y La Negra, de SNIFA (data/processed/episodios_so2.json).
- Localidades: ciudades y pueblos de OpenStreetMap dentro de una comuna chilena (data/raw/comunas).
Salida: web/public/data/lugares.json
"""
import json
import re
import unicodedata
from collections import defaultdict

from common import PROCESSED, RAW, ROOT

LAT_MIN, LAT_MAX = -32.3, -17.4
CAPS = {"DIVISIÓN CHUQUICAMATA": 49700, "FUNDICION ALTONORTE": 24000, "DIVISION SALVADOR POTRERILLOS": 24400, "FUNDICION HERNAN VIDELA LIRA": 12880}  # D.S. 28/2013, t de SO2 al año
MINE_NAMES = {
    "MANTO VERDE": "Mantoverde", "CODELCO CHILE DIVISION SALVADOR": "El Salvador (Codelco)", "FAENA MICHILLA": "Michilla", "MINA FRANKE": "Franke",
    "REFUGIO": "Maricunga (Refugio)", "UJINA": "Collahuasi", "CODELCO CHILE DIVISION CHUQUICAMATA": "Chuquicamata (Codelco)", "MINA ESCONDIDA": "Escondida",
    "MINERA CANDELARIA": "Candelaria", "MINA ANTUCOYA": "Antucoya", "ZALDIVAR": "Zaldívar", "MINA SPENCE": "Spence", "DIVISIÓN GABRIELA MISTRAL": "Gabriela Mistral (Codelco)",
    "CODELCO CHILE DIVISION RADOMIRO TOMIC": "Radomiro Tomic (Codelco)", "CODELCO CHILE DIVISIÓN MINISTRO HALES": "Ministro Hales (Codelco)",
    "FAENA LOS PELAMBRES": "Los Pelambres", "FAENA ANDACOLLO COBRE": "Carmen de Andacollo", "CENTINELA SULFUROS": "Centinela", "CM DEL PACIFICO S.A.": "Compañía Minera del Pacífico (Huasco)",
    "FAENAS EL ROMERAL": "El Romeral", "FAENA TRES VALLES": "Tres Valles", "FAENA TALCUNA": "Talcuna", "FAENA ALGORTA NORTE": "Algorta Norte", "MINA EL WAY": "El Way",
}
MINE_SKIP = {"MANTO VERDE DIVISION", "PROYECTO ANTUCOYA", "CENTINELA OXIDO", "ENCUENTRO", "DESARROLLO MINERA CENTINELA (DMC)"}  # duplicados o partes de otra faena
LOWER = {"de", "del", "la", "las", "los", "y", "el"}
FIX = {"s.a.": "S.A.", "s.a": "S.A.", "sa": "S.A.", "spa": "SpA", "s.p.a.": "SpA", "s.p.a": "SpA", "ltda.": "Ltda.", "ltda": "Ltda.", "scm": "SCM", "s.c.m.": "SCM",
       "cia.": "Cía.", "cia": "Cía.", "cía.": "Cía.", "mra.": "Minera", "mra": "Minera", "(codelco": "(Codelco"}


def title(s):
    """Nombre en mayusculas -> "Tipo Titulo", respetando siglas de sociedades."""
    out = []
    for i, w in enumerate(re.sub(r"\s+", " ", str(s or "")).strip().lower().split(" ")):
        m = re.search(r"[a-záéíóúñ]", w)
        out.append(FIX[w] if w in FIX else w if (i and w in LOWER) or not m else w[: m.start()] + w[m.start()].upper() + w[m.start() + 1:])
    return " ".join(out)


def norm(s):
    return unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()


def inside(lon, lat, ring):
    hit, j = False, len(ring) - 1
    for i in range(len(ring)):
        (xi, yi), (xj, yj) = ring[i][:2], ring[j][:2]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def comuna_finder():
    """Devuelve una funcion (lon, lat) -> nombre de la comuna chilena que contiene el punto, o None."""
    shapes = []
    for f in json.loads((RAW / "comunas" / "comunas_adm3_simplificado.geojson").read_text(encoding="utf8"))["features"]:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        xs = [p[0] for poly in polys for p in poly[0]]
        ys = [p[1] for poly in polys for p in poly[0]]
        if max(ys) < LAT_MIN - 0.5 or min(ys) > LAT_MAX + 0.5:
            continue
        shapes.append((f["properties"]["shapeName"], (min(xs), min(ys), max(xs), max(ys)), polys))

    def find(lon, lat):
        for name, (x0, y0, x1, y1), polys in shapes:
            if x0 <= lon <= x1 and y0 <= lat <= y1 and any(inside(lon, lat, poly[0]) and not any(inside(lon, lat, hole) for hole in poly[1:]) for poly in polys):
                return name
        return None
    return find


def covered_finder():
    """Devuelve una funcion (lon, lat) -> True si el punto esta en Antofagasta o Atacama, las regiones con estaciones cargadas."""
    shapes = []
    for f in json.loads((RAW / "comunas" / "regiones_adm1_simplificado.geojson").read_text(encoding="utf8"))["features"]:
        if any(k in f["properties"]["shapeName"] for k in ("Antofagasta", "Atacama")):
            g = f["geometry"]
            shapes += g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    return lambda lon, lat: any(inside(lon, lat, poly[0]) for poly in shapes)


def main():
    places = []
    # minas
    groups = defaultdict(list)
    for f in json.loads((RAW / "sernageomin" / "rajos_categoria_a.json").read_text(encoding="utf8")):
        a, g = f["attributes"], f.get("geometry") or {}
        if g.get("y") and LAT_MIN < g["y"] < LAT_MAX:
            groups[a["nombre_faena"].strip()].append((g["y"], g["x"], a))
    for faena, v in groups.items():
        if faena in MINE_SKIP:
            continue
        a = v[0][2]
        places.append({"id": "mina-" + re.sub(r"[^a-z0-9]+", "-", norm(faena)).strip("-"), "kind": "mina", "name": MINE_NAMES.get(faena, title(faena)),
                       "sub": f"Mina de {str(a['recurso_principal_instalacion'] or 'minerales').lower()} · {title(a['nombre_empresa'])} · {title(a['comuna_faena'])}",
                       "lat": round(sum(x[0] for x in v) / len(v), 4), "lon": round(sum(x[1] for x in v) / len(v), 4), "alt": norm(f"{faena} {a['nombre_empresa']}")})
    n_minas = len(places)
    # fuentes del RETC
    for e in json.loads((PROCESSED / "retc_so2_nox.json").read_text(encoding="utf8"))["establecimientos"]:
        raw = " ".join(e["name"].split())
        up = raw.upper()
        tipo = "fundición" if any(k in up for k in ("FUNDICION", "CHUQUICAMATA", "POTRERILLOS")) else "termoeléctrica" if any(k in up for k in ("CENTRAL", "TERMO", "GUACOLDA")) else "otra"
        places.append({"id": f"retc-{e['id_vu']}", "kind": "fuente", "tipo": tipo, "name": raw, "id_vu": e["id_vu"], "sub": f"{title(e['owner'])} · {e['comuna']}",
                       "lat": e["lat"], "lon": e["lon"], "alt": norm(f"{raw} {e['owner']} {tipo}"), "so2": e["so2"], "nox": e["nox"], "cap_t": CAPS.get(raw)})
    n_fuentes = len(places) - n_minas
    # estaciones
    stations = [s for s in json.loads((PROCESSED / "episodios_so2.json").read_text(encoding="utf8"))["stations"] if s["lat"] is not None]
    for s in stations:
        places.append({"id": "est-" + s["code"].replace("/", "-"), "kind": "estación", "name": "Estación " + re.sub(r"^estaci[oó]n\s+", "", s["name"].strip(), flags=re.I), "code": s["code"], "sub": f"{s['comuna']} · operada por {s['owner']}",
                       "lat": s["lat"], "lon": s["lon"], "alt": norm(f"{s['name']} {s['comuna']} {s['owner']} sinca snifa")})
    # localidades
    find, seen = comuna_finder(), set()
    els = json.loads((RAW / "comunas" / "osm_places.json").read_text(encoding="utf8"))["elements"]
    rank = {"city": 0, "town": 1, "village": 2}
    for el in sorted(els, key=lambda el: rank.get(el.get("tags", {}).get("place"), 9)):
        t = el.get("tags", {})
        if t.get("place") not in rank or not t.get("name") or not (LAT_MIN < el.get("lat", 0) < LAT_MAX):
            continue
        comuna = find(el["lon"], el["lat"])
        if not comuna or (norm(t["name"]), comuna) in seen:
            continue
        seen.add((norm(t["name"]), comuna))
        pop = int(re.sub(r"\D", "", t.get("population", "")) or 0)
        places.append({"id": f"loc-{el['id']}", "kind": "localidad", "name": t["name"], "sub": f"{'Ciudad' if t['place'] == 'city' else 'Localidad'} · comuna de {comuna}",
                       "lat": round(el["lat"], 4), "lon": round(el["lon"], 4), "alt": norm(f"{t['name']} {comuna}"), "pop": pop, "rank": rank[t["place"]]})
    covered = covered_finder()
    for p in places:
        p["cov"] = covered(p["lon"], p["lat"])
    places = [p for p in places if p["cov"] or p["kind"] != "localidad"]  # las localidades de otras regiones no aportan: no hay estaciones cargadas alla
    out = ROOT / "web" / "public" / "data" / "lugares.json"
    out.write_text(json.dumps({"sources": "Sernageomin (minas), RETC (fuentes), SINCA y SNIFA (estaciones), OpenStreetMap (localidades)", "places": places}, ensure_ascii=False), encoding="utf8")
    print(f"{len(places)} lugares: {n_minas} minas, {n_fuentes} fuentes, {len(stations)} estaciones, {sum(p['kind'] == 'localidad' for p in places)} localidades | {out.stat().st_size // 1024} KB")
    print("fuera de Antofagasta y Atacama:", sum(not p["cov"] for p in places), "| ej.:", [p["name"] for p in places if not p["cov"]][:12])
    print("minas:", [p["name"] for p in places[:n_minas]])
    print("localidades:", [p["name"] for p in places if p["kind"] == "localidad"])


if __name__ == "__main__":
    main()
