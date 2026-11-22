"""Lectura de series horarias de SINCA (Ministerio del Medio Ambiente): contaminantes y meteorologia.

Cada serie se descarga una vez y queda en data/raw/sinca. Las horas vienen en hora local de invierno (UTC-4).
Se usa el primer valor disponible entre validado, preliminar y no validado, y se guarda cual fue.
"""
import time
import urllib.request

from common import RAW

OUT = RAW / "sinca"
UA = {"User-Agent": "Mozilla/5.0"}
BASE = "https://sinca.mma.gob.cl/cgi-bin/APUB-MMA/apub.tsindico2.cgi?outtype=xcl&macro=./{code}/{kind}/{par}//{macro}.ic&from={d0}&to={d1}&path=/usr/airviro/data/CONAMA/&lang=esp&rsrc=&macropath="
POLLUTANT = {"SO2": "0001", "NO2": "0003", "NOX": "0NOX", "MP10": "PM10", "MP25": "PM25"}
MET = {"WDIR": "horario_010_spec", "WSPD": "horario_010"}  # _spec = serie de tiempo (sin _spec, la direccion viene como rosa)
STATUS = ("validado", "preliminar", "no validado")


def series(code, name, d0="180101", d1="261111"):
    """{(AAMMDD, HHMM): (valor, estado)} de un contaminante (SO2, NO2...) o variable meteorologica (WDIR, WSPD)."""
    if name in MET:
        kind, par, macro = "Met", name, MET[name]
    else:
        kind, par = "Cal", POLLUTANT[name]
        macro = f"{par}.horario.horario"
    path = OUT / f"{name}_{code.replace('/', '_')}_h.csv"
    if not path.exists():
        OUT.mkdir(parents=True, exist_ok=True)
        url = BASE.format(code=code, kind=kind, par=par, macro=macro, d0=d0, d1=d1)
        path.write_bytes(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300).read())
        time.sleep(0.4)
    out = {}
    for line in path.read_text(encoding="latin-1").splitlines()[1:]:
        q = line.split(";")
        if len(q) < 3 or not q[0].isdigit():
            continue
        for k, x in enumerate(q[2:5]):
            if x.strip():
                out[(q[0], q[1])] = (float(x.replace(",", ".")), STATUS[k] if len(q) >= 5 else "medido")
                break
    return out
