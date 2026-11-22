"""Inventario de fuentes: que dato se usa, de donde viene, que cubre y donde quedo guardado.

Escribe web/public/data/manifest.json (lo muestra la pagina /datos).
"""
import datetime as dt
import json

from common import DAILY, PROCESSED, RAW, ROOT


def files(paths):
    out = []
    for p in paths:
        out.append({"path": str(p.relative_to(ROOT)).replace("\\", "/"), "exists": p.exists(),
                    "mb": round(p.stat().st_size / 1e6, 1) if p.exists() else None})
    return out


def folder(path, pattern):
    fs = sorted(path.glob(pattern))
    return {"path": str(path.relative_to(ROOT)).replace("\\", "/") + "/" + pattern, "n": len(fs),
            "mb": round(sum(f.stat().st_size for f in fs) / 1e6, 1), "first": fs[0].stem if fs else None, "last": fs[-1].stem if fs else None}


def span(series):
    ys = sorted(y for s in series.values() for y in s)
    return f"{ys[0]}–{ys[-1]}" if ys else "—"


def main():
    declared = json.loads((PROCESSED / "declared.json").read_text(encoding="utf8"))
    prod = json.loads((PROCESSED / "production.json").read_text(encoding="utf8"))
    months = sorted(m for s in prod["series"].values() for m in s)
    sat, wind = folder(DAILY, "*.npz"), folder(RAW / "wind", "*.json")
    cfg = json.loads((ROOT / "data" / "config" / "mines.json").read_text(encoding="utf8"))
    sites = [s["id"] for s in cfg["mines"] + [cfg["reference"]]]
    wind["n"] = sum((RAW / "wind" / f"{s}.json").exists() for s in sites)  # solo los sitios vigentes
    days = (dt.date.fromisoformat(sat["last"]) - dt.date.fromisoformat(sat["first"])).days + 1
    sat["missing_days"] = days - sat["n"]
    S = []
    add = lambda **k: S.append(k)
    add(id="s5p", group="Satélite", name="NO₂ troposférico, Sentinel-5P / TROPOMI (producto L2 NO2)", provider="Copernicus / ESA, copia pública en AWS",
        coverage=f"{sat['first']} → {sat['last']}", frequency="diaria (una pasada, ~13:30 hora local)", status="en uso", url="https://meeo-s5p.s3.amazonaws.com/",
        used_for="Señal de cada mina, capas mensuales del mapa y pluma alineada con el viento.", folder=sat,
        note="Reprocesado (RPRO) hasta 2022-07-25 y operacional (OFFL) después; solo mediciones con calidad ≥ 75 %; recortado a Chile entre 18° y 33° S.")
    add(id="viento", group="Viento", name="Viento a 100 m a la hora de la pasada (16–18 UTC), reanálisis ERA5", provider="Open-Meteo Historical Weather API",
        coverage=f"{sat['first']} → {sat['last']}", frequency="diaria, por mina", status="en uso", url="https://open-meteo.com/en/docs/historical-weather-api",
        used_for="Prueba de solidez (días de calma, a favor y en contra del viento) y estimación de toneladas de NOx.", folder=wind)
    add(id="cochilco", group="Producción", name="Producción de cobre de mina por empresa", provider="Cochilco", coverage=f"{months[0]} → {months[-1]}",
        frequency="mensual", status="en uso", url=prod["source"]["url"], used_for="Comparación de la señal con la actividad de cada mina.",
        files=files([RAW / "cochilco_mensual.xlsx"]))
    D = lambda k: declared[k]["series"]
    add(id="antofagasta", group="Declarado por la empresa", name="Sustainability Databook 2025 (hoja Environment)", provider="Antofagasta Minerals",
        coverage=span(D("centinela")), frequency="anual", status="en uso", url=declared["centinela"]["source"]["url"],
        used_for="Emisiones directas, combustible total y diésel de Centinela, Antucoya, Zaldívar y Los Pelambres.", files=files([RAW / "anto_databook.xlsx"]))
    add(id="bhp", group="Declarado por la empresa", name="ESG Standards and Databook 2026 y Databook 2021", provider="BHP",
        coverage="año fiscal " + span(D("escondida_bhp")), frequency="anual (julio a junio)", status="en uso", url=declared["escondida_bhp"]["source"]["url"],
        used_for="Emisiones directas y combustible de Escondida y Pampa Norte (Spence + Cerro Colorado).",
        files=files([RAW / "260818_ESGStandardsandDatabook2026.xlsx", RAW / "210914_Sustainability and ESG Navigators and Databook 2021.xlsx", RAW / "250819_ESGStandardsandDatabook2025.xlsx"]),
        note="El Databook 2025 queda como respaldo: el de 2026 trae los mismos años.")
    add(id="sierra_gorda", group="Declarado por la empresa", name="Reportes de Sustentabilidad 2021, 2022, 2024 y 2025", provider="Sierra Gorda SCM",
        coverage=span(D("sierra_gorda")) + "; diésel mensual 2019–2021", frequency="anual y mensual", status="en uso", url=declared["sierra_gorda"]["source"]["url"],
        used_for="Emisiones directas, litros de diésel por año y por mes.", files=files([RAW / f"sierragorda_{y}.pdf" for y in (2021, 2022, 2024, 2025)]),
        note=declared["sierra_gorda"]["source"]["note"])
    add(id="collahuasi", group="Declarado por la empresa", name="Reportes de Sustentabilidad 2023 (pág. 112) y 2025 (pág. 100)", provider="Collahuasi",
        coverage=span(D("collahuasi")), frequency="anual", status="en uso", url=declared["collahuasi"]["source"]["url"], used_for="Emisiones directas.",
        files=files([RAW / "Reporte-Sustentabilidad-Collahuasi-2023.pdf", RAW / "Collahuasi_Reporte-Sustentabilidad-2025.pdf"]), note=declared["collahuasi"]["source"]["note"])
    add(id="codelco", group="Declarado por la empresa", name="ESG Data Book 2025 (hoja Emisiones y energía)", provider="Codelco", coverage=span(D("codelco_norte")),
        frequency="anual", status="insuficiente", url=declared["codelco_norte"]["source"]["url"], used_for="Emisiones directas de Chuquicamata, Radomiro Tomic y Ministro Hales.",
        files=files([RAW / "esg_data_book_2025_v2.xlsx"]), note="Solo publica el detalle por división para dos años: no alcanza para comparar tendencias.")
    add(id="teck", group="Declarado por la empresa", name="Sustainability Reporting Index & Databook 2025", provider="Teck", coverage="—", frequency="anual",
        status="sin dato por mina", url="https://www.teck.com/media/Teck-Sustainability-ReportingIndex-Databook_2025.xlsx", used_for="Revisado para Quebrada Blanca.",
        files=files([RAW / "teck_databook_2025.xlsx"]), note="No separa emisiones directas ni combustible por mina; Quebrada Blanca queda sin dato declarado.")
    add(id="sernageomin", group="Ubicación", name="Atlas de faenas e instalaciones (rajos activos)", provider="Sernageomin", coverage="vigente", frequency="—", status="en uso",
        url="https://www.sernageomin.cl/", used_for="Coordenadas de cada mina.", files=files([ROOT / "data" / "config" / "mines.json"]))
    add(id="naturalearth", group="Mapa base", name="Países y ciudades 1:10m (dominio público)", provider="Natural Earth", coverage="—", frequency="—", status="en uso",
        url="https://www.naturalearthdata.com/", used_for="Mapa base local, para que la app funcione sin internet.", files=files([ROOT / "web" / "public" / "data" / "base.geojson"]))
    out = {"generated": dt.date.today().isoformat(), "sources": S}
    (ROOT / "web" / "public" / "data" / "manifest.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf8")
    missing = [f["path"] for s in S for f in s.get("files", []) if not f["exists"]]
    print(f"{len(S)} fuentes | satélite {sat['n']} días ({sat['mb']} MB) | viento {wind['n']} sitios | archivos faltantes: {missing or 'ninguno'}")


if __name__ == "__main__":
    main()
