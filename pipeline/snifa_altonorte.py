"""Estacion La Negra (red de la fundicion Altonorte, Antofagasta): SO2 y viento por hora desde SNIFA.

SINCA no publica esta estacion. La empresa entrega cada mes a la Superintendencia del Medio Ambiente (seguimiento
ambiental, RCA 39/2000) una planilla con los promedios horarios, que queda publica en snifa.sma.gob.cl.
1. Lista los expedientes de seguimiento de la unidad fiscalizable 674 (Fundicion Altonorte).
2. Se queda con los de la "red de monitoreo de calidad del aire" y baja las planillas de La Negra (calidad del aire y
   meteorologia), prefiriendo los datos validados por el operador.
3. Lee SO2 (viene en ppb; se pasa a ug/m3N con 2,62, a 25 C y 1 atm) y viento, y los deja con el mismo formato que
   las series de SINCA: data/raw/sinca/{SO2,WDIR,WSPD}_SNIFA_LNE_h.csv
Es dato informado por la propia empresa; la autoridad no lo valida.
"""
import datetime as dt
import html
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import openpyxl

from common import RAW

OUT = RAW / "snifa" / "altonorte"
UA = {"User-Agent": "Mozilla/5.0"}
UF, CODE = 674, "SNIFA/LNE"
PPB_TO_UG = 2.62
API = "https://api-ssa.sma.gob.cl/api/v1/"


def get(url, timeout=120):
    for attempt in range(6):  # SNIFA responde 429 si se le pide muy rapido: se espera y se reintenta
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()
        except Exception:
            if attempt == 5:
                raise
            time.sleep(5 * (attempt + 1))


def cached(path, url):
    if not path.exists():
        path.write_bytes(get(url))
    return path


def expedientes():
    """Expedientes mensuales de la RCA 39/2000 entregados desde junio de 2018 (candidatos a ser de la red de aire)."""
    p = html.unescape(cached(OUT / "uf.html", f"https://snifa.sma.gob.cl/UnidadFiscalizable/Ficha/{UF}").read_text(encoding="utf8", errors="replace"))
    out = []
    for r in re.findall(r"<tr[^>]*>(.*?)</tr>", p, flags=re.S):
        m = re.search(r"/SeguimientoAmbiental/Ficha/(\d+)", r)
        c = [" ".join(re.sub(r"<[^>]+>", " ", x).split()) for x in re.findall(r"<td[^>]*>(.*?)</td>", r, flags=re.S)]
        if m and len(c) >= 5 and "39-2000" in c[1] and c[2] in ("", "Calidad del aire") and c[4] == "Mensual" and c[0][6:] + c[0][3:5] >= "201806":
            out.append(m.group(1))
    return out


def documentos(exp):
    """(periodo AAAA-MM, [(id, nombre)]) si el expediente es de la red de calidad del aire; si no, None."""
    p = html.unescape(cached(OUT / f"exp_{exp}.html", f"https://snifa.sma.gob.cl/SeguimientoAmbiental/Ficha/{exp}").read_text(encoding="utf8", errors="replace"))
    if "CALIDAD DEL AIRE" not in p.upper():
        return None
    per = re.search(r"odo:(?:\s|<[^>]+>)*\d{2}-(\d{2})-(\d{4})", p)
    docs = []
    for r in re.findall(r"<tr[^>]*>(.*?)</tr>", p, flags=re.S):
        m = re.search(r"/General/DescargarInformeSeguimiento/(\d+)", r)
        c = [" ".join(re.sub(r"<[^>]+>", " ", x).split()) for x in re.findall(r"<td[^>]*>(.*?)</td>", r, flags=re.S)]
        if m and len(c) >= 2:
            docs.append((m.group(1), c[1]))
    return (f"{per.group(2)}-{per.group(1)}" if per else None, docs)


def pick(docs, meteo):
    """Planilla de La Negra: validada si existe; si no, la de datos crudos."""
    norm = lambda s: s.lower().replace("ó", "o").replace("í", "i")
    mine = [(i, n) for i, n in docs if n.lower().endswith((".xlsx", ".xlsm", ".xls")) and re.search(r"lne|negra", norm(n)) and ("meteo" in norm(n)) == meteo]
    mine.sort(key=lambda d: "valid" not in norm(d[1]))
    return mine[0] if mine else None


def download(doc):
    path = OUT / f"doc_{doc}.xlsx"
    if not path.exists():
        info = json.loads(get(API + f"GetDocumentoById/{doc}"))["data"]
        path.write_bytes(get(API + "documentos/incidente/descargar?nombre=" + urllib.parse.quote(info["InternalFileName"]), 300))
    return path


def hourly(path, want):
    """{hoja: [(fecha, [celdas])]} de las filas con fecha y hora de las hojas cuyo nombre cumple want."""
    out = {}
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    for ws in wb.worksheets:
        if not want(ws.title.lower()):
            continue
        head, rows = None, []
        for row in ws.iter_rows(values_only=True):
            if row and isinstance(row[0], dt.datetime):
                rows.append((row[0], row[1:8]))
            elif row and isinstance(row[0], str) and row[0].lower().startswith("fecha"):
                head = [str(c or "").lower().replace("\n", " ") for c in row[:8]]
        out[ws.title.lower()] = (head, rows)
    wb.close()
    return out


num = lambda v: float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else None


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    exps = expedientes()
    with ThreadPoolExecutor(3) as ex:
        found = [d for d in ex.map(documentos, exps) if d and d[0]]
    jobs = {}
    for per, docs in found:  # si un mes se entrego dos veces, queda la ultima entrega (la lista viene de la mas nueva a la mas antigua)
        jobs.setdefault(per, (pick(docs, False), pick(docs, True)))
    print(f"{len(exps)} expedientes candidatos | {len(found)} de calidad del aire | {len(jobs)} meses", flush=True)
    todo = [d[0] for pair in jobs.values() for d in pair if d]
    with ThreadPoolExecutor(3) as ex:
        list(ex.map(lambda d: download(d) if not (OUT / f"doc_{d}.xlsx").exists() else None, todo))
    so2, wd, ws, bad = {}, {}, {}, []
    for per in sorted(jobs):
        air, met = jobs[per]
        try:
            if air:
                for head, rows in hourly(OUT / f"doc_{air[0]}.xlsx", lambda t: "so2" in t).values():
                    for t, c in rows:  # columnas: dato sin validar, dato validado, codigo de invalidacion
                        v = num(c[1]) if "valid" in air[1].lower() else num(c[0])
                        if v is not None and t.strftime("%Y-%m") == per:
                            so2[t] = v * PPB_TO_UG
            if met:
                for title, (head, rows) in hourly(OUT / f"doc_{met[0]}.xlsx", lambda t: "registros" in t and ("vel" in t or "dir" in t)).items():
                    store = ws if "vel" in title else wd  # hojas "Registros Vel" y "Registros Dir": fecha, dato valido, codigo
                    for t, c in rows:
                        v = num(c[0])
                        if v is not None and t.strftime("%Y-%m") == per:
                            store[t] = v
        except Exception as e:
            bad.append(f"{per}: {e!r}"[:160])
    for name, d in (("SO2", so2), ("WDIR", wd), ("WSPD", ws)):  # mismo formato que la descarga de SINCA; el valor va en la columna "no validados"
        lines = ["FECHA (YYMMDD);HORA (HHMM);Registros validados;Registros preliminares;Registros no validados;"]
        lines += [f"{t:%y%m%d};{t:%H}00;;;{d[t]:.2f};" for t in sorted(d)]
        (RAW / "sinca" / f"{name}_{CODE.replace('/', '_')}_h.csv").write_text("\n".join(lines) + "\n", encoding="latin-1")
    vals = sorted(so2.values())
    print(f"SO2: {len(so2)} horas, de {min(so2):%Y-%m} a {max(so2):%Y-%m} | máx {vals[-1]:.0f} µg/m³ | horas con 150 o más: {sum(v >= 150 for v in vals)}, con 350 o más: {sum(v >= 350 for v in vals)}")
    print(f"viento: {len(wd)} horas de dirección y {len(ws)} de velocidad | meses sin planilla de aire: {sorted(p for p, j in jobs.items() if not j[0])[:12]} | sin meteorología: {sum(1 for j in jobs.values() if not j[1])}")
    print("errores:", bad[:8], file=sys.stderr if bad else sys.stdout)


if __name__ == "__main__":
    main()
