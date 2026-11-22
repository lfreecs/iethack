"""Etapa 1: datos declarados por las empresas y produccion mensual de Cochilco.

Genera data/processed/declared.json y data/processed/production.json.
"""
import datetime as dt
import json
import warnings

import openpyxl

from common import PROCESSED, RAW

warnings.filterwarnings("ignore")

ANTO_FILE = RAW / "anto_databook.xlsx"
COCHILCO_FILE = RAW / "cochilco_mensual.xlsx"

ANTO_OPS = {"Los  Pelambres": "los_pelambres", "Centinela": "centinela", "Antucoya": "antucoya", "Zaldívar": "zaldivar"}


def clean(v):
    return " ".join(str(v).split()) if v is not None else ""


def antofagasta():
    """Lee diesel (GJ) y emisiones directas (t CO2e) por operacion, 2018-2025."""
    ws = openpyxl.load_workbook(ANTO_FILE, read_only=True, data_only=True)["Environment "]
    rows = [list(r) for r in ws.iter_rows(values_only=True)]

    def series_for(label_test, header_idx):
        years_row, names_row = rows[header_idx], rows[header_idx + 1]
        year_cols, year = {}, None
        for c, v in enumerate(years_row):
            if isinstance(v, (int, float)) and 2000 < v < 2100:
                year = int(v)
            if year and c < len(names_row) and clean(names_row[c]) in [clean(k) for k in ANTO_OPS]:
                year_cols[c] = (year, ANTO_OPS[[k for k in ANTO_OPS if clean(k) == clean(names_row[c])][0]])
        for r in rows[header_idx + 2:]:
            if label_test(clean(r[1]) if len(r) > 1 else ""):
                out = {}
                for c, (y, op) in year_cols.items():
                    if c < len(r) and isinstance(r[c], (int, float)):
                        out.setdefault(op, {})[str(y)] = float(r[c])
                return out
        raise RuntimeError("fila no encontrada")

    headers = [i for i, r in enumerate(rows) if clean(r[0] if r else "") == "Indicators"]
    energy_hdr = headers[0]
    emis_hdr = [h for h in headers if h > energy_hdr and any("Emissions" in clean(x) for r in rows[h + 2:h + 4] for x in r if x)][0]
    diesel = series_for(lambda s: s == "Diesel fuel", energy_hdr)
    fuel = series_for(lambda s: s == "Total Fuel Consumption", energy_hdr)
    scope1 = series_for(lambda s: s.startswith("Total direct GHG emissions"), emis_hdr)
    src = {
        "doc": "Antofagasta plc Sustainability Databook 2025 (hoja 'Environment')",
        "url": "https://www.antofagasta.co.uk/media/4937/antofagasta-plc-sustainability-databook-2025-compres.xlsx",
        "note": "Zaldívar se reporta al 100 % aunque Antofagasta posee el 50 %.",
    }
    out = {}
    for op in ANTO_OPS.values():
        out[op] = {"company": "Antofagasta Minerals", "source": src, "frequency": "anual",
                   "series": {"scope1_tco2e": scope1.get(op, {}), "fuel_gj": fuel.get(op, {}), "diesel_gj": diesel.get(op, {})}}
    return out


SG_KWH_PER_LITRE = 10.51  # factor publicado por la empresa (Reporte 2025, pág. 144)
SG_DIESEL_MWH = {"2023": 1344320.85, "2024": 1571377.06, "2025": 1589433.97}  # Reporte 2025, pág. 145
SG_DIESEL_L = {"2019": 105249375.0, "2020": 124423470.0, "2021": 117826307.0, "2022": 121159356.0}  # Reporte 2022, pág. 66 del PDF
# Reporte 2021, pág. 67 del PDF (GRI 302-1): litros de diésel por mes
SG_DIESEL_L_MONTHLY = {
    "2019": [8111752.41, 7488305.74, 8464695.72, 8317154.79, 8943663.60, 8750265.32, 8952205.52, 9384078.32, 9135135.10, 9282399.41, 9064979.79, 9354739.64],
    "2020": [18112293.30, 8580498.21, 9075173.99, 9164343.18, 9670613.12, 9859599.55, 10000030.43, 9770853.07, 9655633.93, 10051768.87, 9989950.04, 10492711.86],
    "2021": [10168194.0, 9187733.0, 9888795.0, 9532926.0, 9975591.0, 9855588.0, 10068735.0, 10142855.0, 10000205.0, 9760269.0, 9657612.0, 9587804.0],
}


def sierra_gorda():
    diesel = {**SG_DIESEL_L, **{y: round(v * 1000 / SG_KWH_PER_LITRE, 0) for y, v in SG_DIESEL_MWH.items()}}
    monthly = {f"{y}-{i + 1:02d}": v for y, vals in SG_DIESEL_L_MONTHLY.items() for i, v in enumerate(vals)}
    for y, vals in SG_DIESEL_L_MONTHLY.items():  # la suma mensual debe calzar con el total anual publicado
        assert abs(sum(vals) - SG_DIESEL_L[y]) < 2, (y, sum(vals), SG_DIESEL_L[y])
    return {"sierra_gorda": {
        "company": "Sierra Gorda SCM", "frequency": "anual",
        "source": {"doc": "Sierra Gorda SCM, Reportes de Sustentabilidad 2025 (págs. 144-148), 2024 (pág. 73 del PDF), 2022 (pág. 66 del PDF) y 2021 (págs. 57 y 67 del PDF)",
                   "url": "https://www.sgscm.cl/wp-content/uploads/2026/09/Sierra-Gorda-SCM-Reporte-de-Sustentabilidad-2025-V05.pdf",
                   "note": "Emisiones: la cifra de 2021 viene de una edición anterior y equivale a 2,7 kg de CO₂e por litro de diésel; desde 2022 equivale a unos 3,1, lo que sugiere un cambio de método. "
                           "Diésel: 2019-2022 publicado en litros; 2023-2025 publicado en MWh y convertido con el factor de la empresa (10,51 kWh por litro). "
                           "Diésel mensual: enero de 2020 (18,1 millones de litros) duplica el nivel normal y el total impreso en esa tabla no calza con la suma."},
        "series": {"scope1_tco2e": {"2021": 318131.0, "2022": 383891.0, "2023": 401571.0, "2024": 448296.0, "2025": 451945.0},
                   "diesel_l": diesel},
        "monthly": {"diesel_l": monthly}}}


BHP_FILE = RAW / "260818_ESGStandardsandDatabook2026.xlsx"
CODELCO_FILE = RAW / "esg_data_book_2025_v2.xlsx"


def bhp():
    """Combustible (TJ) y emisiones directas (kt CO2e, control operacional) por activo, FY2020-FY2025."""
    rows = [list(r) for r in openpyxl.load_workbook(BHP_FILE, read_only=True, data_only=True)["Energy and GHG by asset"].iter_rows(values_only=True)]
    fy_rows = [i for i, r in enumerate(rows) if "FY2020" in [clean(c) for c in r]]

    def grab(asset, metric_prefix, hdr_idx):
        hdr = [clean(c) for c in rows[hdr_idx]]
        cols = []
        for c, h in enumerate(hdr):  # primer bloque = control operacional
            if h.startswith("FY20"):
                if cols and h == cols[0][1]:
                    break
                cols.append((c, h))
        current = None
        for r in rows[hdr_idx + 1:]:
            cells = [clean(c) for c in r]
            if asset in cells:
                current = asset
            elif any(c in ("Escondida", "Pampa Norte", "Copper South Australia", "Western Australia Iron Ore") for c in cells):
                current = None
            if current == asset and any(c.startswith(metric_prefix) for c in cells):
                return {h.replace("FY", ""): float(r[c]) for c, h in cols if isinstance(r[c], (int, float))}
        return {}

    src = {"doc": "BHP ESG Standards and Databook 2026, hoja 'Energy and GHG by asset' (control operacional); FY2019 del Databook 2021",
           "url": "https://www.bhp.com/investor-centre/reports-and-presentations/annual-report"}
    out = {}
    for key, asset, note in (("escondida_bhp", "Escondida", "Año fiscal BHP: FY2025 = julio 2024 a junio 2025."),
                             ("spence_bhp", "Pampa Norte", "Pampa Norte = Spence + Cerro Colorado (cerrada en 2023). Año fiscal julio-junio.")):
        fuel = grab(asset, "Consumption of fuel", fy_rows[0])
        s1 = grab(asset, "Scope 1 emissions", fy_rows[-1])
        out[key] = {"company": "BHP", "frequency": "anual (año fiscal jul-jun)", "fiscal_year_end_month": 6,
                    "source": {**src, "note": note},
                    "series": {"fuel_tj": fuel, "scope1_tco2e": {y: v * 1000 for y, v in s1.items()}}}
    # FY2019 desde "Sustainability and ESG Navigators and Databook 2021", hoja 'Climate change performance data'
    out["escondida_bhp"]["series"]["scope1_tco2e"].setdefault("2019", 930000.0)
    out["spence_bhp"]["series"]["scope1_tco2e"].setdefault("2019", 340000.0)
    return out


def codelco():
    """Emisiones directas (t CO2e) por division, 2024-2025 (2023 solo trae el total)."""
    wb = openpyxl.load_workbook(CODELCO_FILE, read_only=True, data_only=True)
    ws = [w for w in wb.worksheets if w.title.startswith("Emisiones y energ")][0]
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    h = [k for k, r in enumerate(rows) if r and clean(r[0]).lower().startswith("emisiones mundiales brutas de alcance 1")][0]
    names, i = rows[h], h + 1
    years_row = [r for r in rows[:h][::-1] if any("2025" in clean(c) for c in r)][0]
    year, series = None, {}
    for c, v in enumerate(rows[i]):
        y = clean(years_row[c]) if c < len(years_row) else ""
        if "2025" in y or "2024" in y or "2023" in y:
            year = y[-4:]
        name = clean(names[c]) if c < len(names) else ""
        if year and name in ("CHUQUICAMATA", "RADOMIRO TOMIC", "MINISTRO HALES") and isinstance(v, (int, float)):
            series.setdefault(year, {})[name] = float(v)
    total = {y: sum(d.values()) for y, d in series.items() if len(d) == 3}
    return {"codelco_norte": {
        "company": "Codelco", "frequency": "anual",
        "source": {"doc": "Codelco ESG Data Book 2025, hoja 'Emisiones y energía' (suma de Chuquicamata, Radomiro Tomic y Ministro Hales)",
                   "url": "https://www.codelco.com/memorias",
                   "note": "División Chuquicamata incluye su fundición; 2023 solo se publica el total de Codelco."},
        "series": {"scope1_tco2e": total}, "detail": series}}


def pending():
    return {
        "collahuasi": {"company": "Collahuasi", "frequency": "anual",
                       "source": {"doc": "Collahuasi, Reporte de Sustentabilidad 2025 (pág. 100, años 2022-2025) y 2023 (pág. 112, años 2018-2021); cifras leídas de los gráficos",
                                  "url": "https://www.collahuasi.cl/sustentabilidad/reportes-de-sustentabilidad/",
                                  "note": "El reporte 2025 es provisorio (sin verificación externa). Se usan las cifras más recientes publicadas para cada año."},
                       "series": {"scope1_tco2e": {"2018": 547477.0, "2019": 587358.0, "2020": 572861.0, "2021": 582811.0,
                                                   "2022": 583188.0, "2023": 605253.0, "2024": 578113.0, "2025": 553149.0}}},
    }


def cochilco():
    ws = openpyxl.load_workbook(COCHILCO_FILE, read_only=True, data_only=True).worksheets[0]
    header = [clean(h) for h in next(ws.iter_rows(min_row=7, max_row=7, values_only=True))]
    prod = {}
    for r in ws.iter_rows(values_only=True):
        if not r or not isinstance(r[0], dt.datetime):
            continue
        month = r[0].strftime("%Y-%m")
        for c, name in enumerate(header[1:], start=1):
            v = r[c] if c < len(r) else None
            if name and isinstance(v, (int, float)):
                prod.setdefault(name, {})[month] = float(v)
    return {"source": {"doc": "Cochilco, Producción de cobre mina por empresa (mensual)", "unit": "miles de t de cobre fino",
                       "url": "https://www.cochilco.cl/web/download/951/cobre/12683/produccion-de-cobre-mina-por-empresa-mensual.xlsx"},
            "series": prod}


def main():
    PROCESSED.mkdir(parents=True, exist_ok=True)
    declared = {**antofagasta(), **sierra_gorda(), **bhp(), **codelco(), **pending()}
    (PROCESSED / "declared.json").write_text(json.dumps(declared, ensure_ascii=False, indent=1), encoding="utf8")
    prod = cochilco()
    (PROCESSED / "production.json").write_text(json.dumps(prod, ensure_ascii=False), encoding="utf8")
    for k, v in declared.items():
        s = v["series"]
        print(k, {name: dict(sorted(vals.items())) for name, vals in s.items()} if s else v.get("status"))
    print("Cochilco:", len(prod["series"]), "columnas; meses Escondida:", len(prod["series"].get("Escondida", {})))


if __name__ == "__main__":
    main()
