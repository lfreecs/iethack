import os
import re
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"
DAILY = ROOT / "data" / "daily"

BUCKET = "https://meeo-s5p.s3.amazonaws.com/"
HEADERS = {"User-Agent": "Mozilla/5.0"}

# Region del norte y centro de Chile (incluye Los Pelambres)
LON_MIN, LON_MAX = -72.0, -66.0
LAT_MIN, LAT_MAX = -33.0, -18.0

# Hasta esta fecha se usa el reprocesado (RPRO); despues, el operacional (OFFL)
RPRO_LAST_DAY = "2022-07-25"  # recomendado por el equipo TROPOMI

MOL_M2_TO_MOLEC_CM2 = 6.02214e19

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
os.environ.setdefault("GDAL_HTTP_MULTIRANGE", "YES")
os.environ.setdefault("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "4")
os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "2")


def list_keys(prefix: str) -> list[str]:
    keys: list[str] = []
    token = None
    while True:
        url = f"{BUCKET}?list-type=2&max-keys=1000&prefix={prefix}"
        if token:
            url += "&continuation-token=" + urllib.parse.quote(token)
        xml = urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=60).read().decode()
        keys += re.findall(r"<Key>([^<]+)</Key>", xml)
        m = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", xml)
        if not m:
            return keys
        token = m.group(1)


def orbit_files_for_day(day: str, product: str = "L2__NO2___", layer: str = "nitrogendioxide_tropospheric_column",
                        kinds: tuple[str, ...] | None = None) -> list[tuple[str, str]]:
    """Devuelve (dato_url, qa_url) de las orbitas que pasan sobre Chile ese dia.

    kinds: colecciones a probar en orden (la primera que tenga archivos). Por defecto, la regla del NO2:
    reprocesado (RPRO) hasta RPRO_LAST_DAY y operacional (OFFL) despues.
    """
    suffix = f"_PRODUCT_{layer}_4326.tif"
    y, m, d = day.split("-")
    keys: list[str] = []
    for kind in kinds or (("RPRO",) if day <= RPRO_LAST_DAY else ("OFFL",)):
        keys = [k for k in list_keys(f"COGT/{kind}/{product}/{y}/{m}/{d}/") if k.endswith(suffix)]
        if keys:
            break
    best: dict[str, str] = {}
    for k in keys:
        m = re.search(r"_\d{8}T(\d{6})_\d{8}T\d{6}_(\d{5})_\d{2}_\d{6}_(\d{8}T\d{6})_", k)
        hhmmss, orbit, processed = m.group(1), m.group(2), m.group(3)
        # Sentinel-5P pasa sobre Chile entre ~16:00 y ~20:30 UTC
        if not ("155000" <= hhmmss <= "203000"):
            continue
        if orbit not in best or processed > re.search(r"_(\d{8}T\d{6})_PRODUCT", best[orbit]).group(1):
            best[orbit] = k
    out = []
    for orbit in sorted(best):
        k = best[orbit]
        qa = k.replace(suffix, "_PRODUCT_qa_value_4326.tif")
        out.append((BUCKET + k, BUCKET + qa))
    return out
