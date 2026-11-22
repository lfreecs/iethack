"""Inventario oficial de fuentes: emisiones anuales de SO2 y NOx por establecimiento segun el RETC (2019-2025).

Lee los archivos anuales de "Emisiones al aire de fuentes puntuales" (Ministerio del Medio Ambiente), que cambian
de formato cada año, y deja data/processed/retc_so2_nox.json con los establecimientos del norte (Arica a Coquimbo).
Estas emisiones son declaradas o estimadas con factores de emision; no son mediciones independientes.
"""
import csv
import io
import json
import re
import unicodedata
import warnings
from collections import defaultdict

import openpyxl

from common import PROCESSED, RAW

warnings.filterwarnings("ignore")
SRC = RAW / "retc"
REGIONS = ("arica y parinacota", "tarapaca", "antofagasta", "atacama", "coquimbo")
GAS = (("SO2", re.compile(r"azufre|sulfur dioxide|sulphur dioxide|\bso2\b", re.I)), ("NOX", re.compile(r"\bnox\b|nitrogen oxide|oxidos de nitrogeno", re.I)))


def norm(s):
    return unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().strip().lower()


def num(v):
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v or "").strip().replace(" ", "")
    if not s or s in ("-", "null"):
        return 0.0
    try:
        return float(s.replace(".", "").replace(",", ".") if "," in s else s)
    except ValueError:
        return 0.0


def rows(year):
    """Entrega dicts con claves normalizadas, sea cual sea el formato del año."""
    csv_path, xlsx_path = SRC / f"retc_fp_{year}.csv", SRC / f"retc_fp_{year}.xlsx"
    if csv_path.exists():
        with io.open(csv_path, encoding="utf-8-sig", errors="replace", newline="") as f:
            for r in csv.DictReader(f, delimiter=";"):
                yield r
    elif xlsx_path.exists():
        wb = openpyxl.load_workbook(xlsx_path, read_only=True)
        ws = wb["Data"] if "Data" in wb.sheetnames else wb.worksheets[0]
        it = ws.iter_rows(values_only=True)
        head = [str(h) for h in next(it)]
        for r in it:
            yield dict(zip(head, r))
        wb.close()


def main():
    est = {}
    emis = defaultdict(float)
    names = defaultdict(set)
    for year in range(2019, 2026):
        n = 0
        for r in rows(year):
            if norm(r.get("region")) not in REGIONS:
                continue
            cont = norm(r.get("contaminante") or r.get("contaminantes"))
            gas = next((g for g, rx in GAS if rx.search(cont)), None)
            if not gas:
                continue
            # desde 2023 "emision_retc" es la cifra oficial (incluye el balance de masa de fundiciones, D.S. 28);
            # "emision_total" de esos años solo trae la parte estimada por combustion
            t = num(r.get("emision_retc") if "emision_retc" in r else r.get("cantidad_toneladas"))
            if t <= 0:
                continue
            vu = str(r.get("id_vu")).strip()
            emis[(vu, year, gas)] += t
            names[gas].add(cont)
            if vu not in est:
                est[vu] = {"id_vu": vu, "name": str(r.get("nombre_establecimiento") or "").strip(), "owner": str(r.get("razon_social") or "").strip(),
                           "region": str(r.get("region")).strip(), "comuna": str(r.get("comuna") or "").strip(),
                           "lat": round(num(r.get("latitud")), 5), "lon": round(num(r.get("longitud")), 5), "tipos": set()}
            if r.get("razon_social") and not est[vu]["owner"]:
                est[vu]["owner"] = str(r.get("razon_social")).strip()
            est[vu]["tipos"].add(str(r.get("tipo_fuente") or "").strip())
            n += 1
        print(f"{year}: {n} filas de SO2/NOx en el norte", flush=True)
    out = []
    for vu, e in est.items():
        series = {g: {str(y): round(emis[(vu, y, g)], 1) for y in range(2019, 2026) if emis.get((vu, y, g))} for g in ("SO2", "NOX")}
        top = {g: max(series[g].values(), default=0) for g in series}
        if top["SO2"] >= 50 or top["NOX"] >= 200:
            out.append({**e, "tipos": sorted(t for t in e["tipos"] if t)[:6], "so2": series["SO2"], "nox": series["NOX"], "max_so2": top["SO2"], "max_nox": top["NOX"]})
    out.sort(key=lambda e: -e["max_so2"])
    PROCESSED.mkdir(parents=True, exist_ok=True)
    (PROCESSED / "retc_so2_nox.json").write_text(json.dumps({"source": "RETC, Emisiones al aire de fuentes puntuales (MMA)", "contaminantes": {g: sorted(v) for g, v in names.items()}, "establecimientos": out}, ensure_ascii=False, indent=1), encoding="utf8")
    print(f"{len(out)} establecimientos con SO2 >= 50 t/año o NOx >= 200 t/año | nombres de contaminante: { {g: sorted(v) for g, v in names.items()} }")
    for e in out[:28]:
        print(f"  {e['name'][:44]:44s} {e['comuna'][:16]:16s} ({e['lat']:.3f},{e['lon']:.3f}) SO2 {e['so2']} | NOx máx {e['max_nox']:.0f}")


if __name__ == "__main__":
    main()
