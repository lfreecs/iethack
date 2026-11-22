export type MonthPoint = { core: number; bg: number; excess: number; days: number };

export type Source = { doc: string; url?: string; note?: string };

export type DeclaredData = {
  company: string;
  frequency: string;
  /** true cuando la serie es un calculo propio (suma de la zona), no una cifra publicada tal cual */
  derived?: boolean;
  fiscal_year_end_month?: number;
  source: Source;
  series: Record<string, Record<string, number>>;
  monthly?: Record<string, Record<string, number>>;
};

export type Comparison = {
  declared: string;
  metric: string;
  years: string[];
  r: number | null;
  n: number;
  /** intervalo de confianza del 95 % de r */
  ci: [number, number] | null;
  /** coincidencia de los cambios de un año al siguiente (descarta el efecto de una tendencia comun) */
  r_changes: number | null;
  n_changes: number;
  confidence: "baja" | "normal";
};
export type MonthlyComparison = { declared: string; metric: string; r: number | null; r_deseason: number | null; n: number };

export type VerdictCode = "coincide" | "no_concluyente" | "revisar" | "insuficiente" | "sin_dato";
export type Verdict = { code: VerdictCode; declared?: string; metric?: string; r?: number | null; n?: number; ci?: [number, number] | null };

export type Mine = {
  id: string;
  name: string;
  company: string;
  lat: number;
  lon: number;
  note?: string;
  neighbors?: string[];
  /** nombre corto y posicion de la etiqueta en el mapa */
  label?: string;
  anchor?: "top" | "bottom" | "left" | "right";
  monthly: Record<string, MonthPoint>;
  annual: Record<string, { excess: number; months: number }>;
  production: Record<string, number>;
  declared_data: Record<string, DeclaredData>;
  stats: {
    r_production_monthly: number | null;
    r_production_deseason: number | null;
    n_production_monthly: number;
    comparisons: Comparison[];
    monthly_comparisons: MonthlyComparison[];
    verdict: Verdict;
  };
};

export type IndexData = {
  generated_from: string;
  units: string;
  core_km: number;
  ring_km: [number, number];
  bounds: [number, number, number, number];
  months: string[];
  mines: Mine[];
  reference: { id: string; name: string; lat: number; lon: number; monthly: Record<string, MonthPoint> };
  production_source: { doc: string; unit: string; url: string };
};

export type WindYear = { calm?: number; updown?: number; nox_tpd?: number; fit_r2?: number; x0_km?: number; wind?: number; tau_h?: number; reliable?: boolean };
export type Robustness = { declared: string; n: number; base: number | null; calm: number | null; updown: number | null; nox: number | null };
export type WindSite = {
  monthly: Record<string, { calm?: number; updown?: number; wind?: number; days?: number }>;
  annual: Record<string, WindYear>;
  annual_fy6: Record<string, WindYear>;
  plume: (number | null)[][];
  robustness: Robustness[];
};
export type WindData = {
  rules: { calm_max_ms: number; rot_min_ms: number; source: string };
  xs_km: number[];
  noise_floor_tpd: number;
  sites: Record<string, WindSite>;
};

export type ManifestSource = {
  id: string;
  group: string;
  name: string;
  provider: string;
  coverage: string;
  frequency: string;
  status: string;
  url?: string;
  used_for: string;
  note?: string;
  files?: { path: string; exists: boolean; mb: number | null }[];
  folder?: { path: string; n: number; mb: number; first: string | null; last: string | null; missing_days?: number };
};
export type Manifest = { generated: string; sources: ManifestSource[] };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo cargar ${url}`);
  return res.json() as Promise<T>;
}

export const loadIndex = () => getJson<IndexData>("/data/index.json");
export const loadWind = () => getJson<WindData>("/data/wind.json");
export const loadManifest = () => getJson<Manifest>("/data/manifest.json");

export const METRIC: Record<string, { label: string; short: string; unit: string }> = {
  scope1_tco2e: { label: "Emisiones directas declaradas", short: "Emisiones directas", unit: "t CO₂e" },
  fuel_gj: { label: "Combustible total declarado", short: "Combustible total", unit: "GJ" },
  fuel_tj: { label: "Combustible total declarado", short: "Combustible total", unit: "TJ" },
  diesel_gj: { label: "Diésel declarado", short: "Diésel", unit: "GJ" },
  diesel_l: { label: "Diésel declarado", short: "Diésel", unit: "litros" },
};

export const DECLARED_NAME: Record<string, string> = {
  zona_total: "Suma de la zona",
  escondida_bhp: "Escondida",
  zaldivar: "Zaldívar",
  spence_bhp: "Pampa Norte (Spence + Cerro Colorado)",
  sierra_gorda: "Sierra Gorda",
  centinela: "Centinela",
  antucoya: "Antucoya",
  collahuasi: "Collahuasi",
  codelco_norte: "Chuquicamata + R. Tomic + M. Hales",
  los_pelambres: "Los Pelambres",
};

export type Tone = "ok" | "warn" | "bad" | "info" | "muted";

/** Texto de cada veredicto. La regla esta en pipeline/compute_index.py (verdict) y en classify(). */
export const VERDICT: Record<VerdictCode, { label: string; tone: Tone; help: string }> = {
  coincide: {
    label: "Coincide con lo declarado",
    tone: "ok",
    help: "El NO₂ observado sube y baja junto con las emisiones que declara la empresa: coincidencia de 0,7 o más, y con los años disponibles es poco probable que se deba al azar.",
  },
  no_concluyente: {
    label: "No concluyente",
    tone: "warn",
    help: "Lo observado y lo declarado se parecen (coincidencia de 0,4 o más), pero con tan pocos años no se puede descartar que sea azar.",
  },
  revisar: {
    label: "Diferencia a revisar",
    tone: "bad",
    help: "Lo observado y lo declarado no se mueven juntos (coincidencia menor a 0,4). No implica un incumplimiento: puede ser que el satélite vea mal esta mina. Indica dónde conviene mirar.",
  },
  insuficiente: {
    label: "Evidencia insuficiente",
    tone: "muted",
    help: "Hay menos de 5 años comparables entre el satélite y lo declarado.",
  },
  sin_dato: {
    label: "Sin dato declarado",
    tone: "muted",
    help: "La empresa no publica emisiones ni combustible separados para esta mina.",
  },
};

/** Intervalo de confianza del 95 % de una correlacion (transformacion de Fisher). Con pocos periodos es muy ancho. */
export function fisherCI(r: number | null, n: number): [number, number] | null {
  if (r == null || n < 4) return null;
  const z = Math.atanh(Math.max(-0.999999, Math.min(0.999999, r)));
  const se = 1 / Math.sqrt(n - 3);
  return [Math.tanh(z - 1.96 * se), Math.tanh(z + 1.96 * se)];
}

/** Misma regla que el pipeline (verdict en compute_index.py), para datos subidos por la empresa. */
export function classify(r: number | null, n: number): VerdictCode {
  const ci = fisherCI(r, n);
  if (r == null || n < 5) return "insuficiente";
  if (r >= 0.7 && ci && ci[0] > 0) return "coincide";
  if (r >= 0.4) return "no_concluyente";
  return "revisar";
}

const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / Math.max(1, x.length);

export function rollingMean(months: string[], values: Record<string, number>, window = 12) {
  return months.map((_, i) => {
    const slice = months.slice(Math.max(0, i - window + 1), i + 1).map((k) => values[k]).filter((v) => Number.isFinite(v));
    return slice.length >= Math.ceil(window * 0.6) ? mean(slice) : null;
  });
}

export function excessMap(mine: Mine) {
  return Object.fromEntries(Object.entries(mine.monthly).map(([m, v]) => [m, v.excess]));
}

/** Promedio de la señal por año calendario o fiscal (fyEnd = mes en que termina el año fiscal). */
export function annualExcess(mine: Mine, fyEnd?: number) {
  const acc: Record<string, number[]> = {};
  for (const [m, v] of Object.entries(mine.monthly)) {
    const y = Number(m.slice(0, 4));
    const mo = Number(m.slice(5, 7));
    const key = String(fyEnd && mo > fyEnd ? y + 1 : y);
    (acc[key] ||= []).push(v.excess);
  }
  return Object.fromEntries(Object.entries(acc).filter(([, v]) => v.length >= 8).map(([k, v]) => [k, mean(v)]));
}

export function pearson(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : null;
}

/** Indice 100 = promedio de los periodos comparados (ningun año queda como referencia privilegiada). */
export function toIndex(periods: string[], values: Record<string, number>) {
  const base = mean(periods.map((p) => values[p]).filter((v) => Number.isFinite(v)));
  return Object.fromEntries(periods.map((p) => [p, base && Number.isFinite(values[p]) ? (values[p] / base) * 100 : NaN]));
}

/** Quita el ciclo de las estaciones: resta a cada mes el promedio de ese mes del año. */
export function deseason(values: Record<string, number>) {
  const by: Record<string, number[]> = {};
  for (const [m, v] of Object.entries(values)) (by[m.slice(5, 7)] ||= []).push(v);
  return Object.fromEntries(Object.entries(values).map(([m, v]) => [m, v - mean(by[m.slice(5, 7)])]));
}

export type AnnualRow = { y: string; observado: number; declarado: number; valor: number; brecha: number };

/** Observado y declarado por año, en indice 100, con su coincidencia y el año de mayor brecha. */
export function compareAnnual(obs: Record<string, number>, declared: Record<string, number>) {
  const years = Object.keys(declared).filter((y) => y in obs).sort();
  const oi = toIndex(years, obs);
  const di = toIndex(years, declared);
  const rows: AnnualRow[] = years.map((y) => ({ y, observado: oi[y], declarado: di[y], valor: declared[y], brecha: oi[y] - di[y] }));
  const worst = rows.length ? rows.reduce((a, b) => (Math.abs(b.brecha) > Math.abs(a.brecha) ? b : a)) : null;
  return { years, rows, worst, r: pearson(years.map((y) => obs[y]), years.map((y) => declared[y])) };
}

/** Señal media de los ultimos 12 meses, cambio contra los primeros 12 y veces sobre el aire de alrededor. */
export function summary(mine: Mine) {
  const months = Object.keys(mine.monthly).sort();
  const pts = months.map((m) => mine.monthly[m]);
  const last = pts.slice(-12);
  const first = pts.slice(0, 12);
  const lastMean = mean(last.map((p) => p.excess));
  const firstMean = mean(first.map((p) => p.excess));
  const bg = mean(last.map((p) => p.bg));
  return {
    lastMean,
    firstMean,
    change: firstMean ? (lastMean / firstMean - 1) * 100 : 0,
    ratio: bg ? mean(last.map((p) => p.core)) / bg : NaN,
    lastMonth: months.at(-1),
  };
}

/** Escala de color del NO2 (la misma de las capas del mapa): t entre 0 y 1 -> [r, g, b, a]. */
const NO2_STOPS: [number, [number, number, number, number]][] = [
  [0, [255, 230, 120, 0]],
  [0.12, [255, 214, 0, 110]],
  [0.3, [255, 140, 0, 175]],
  [0.58, [235, 45, 45, 215]],
  [1, [200, 0, 160, 235]],
];

export function no2Ramp(t: number): [number, number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < NO2_STOPS.length; i++) {
    const [t0, c0] = NO2_STOPS[i - 1];
    const [t1, c1] = NO2_STOPS[i];
    if (x <= t1) {
      const k = (x - t0) / (t1 - t0);
      return [0, 1, 2, 3].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * k)) as [number, number, number, number];
    }
  }
  return NO2_STOPS[NO2_STOPS.length - 1][1];
}

export const NO2_GRADIENT = `linear-gradient(90deg, ${NO2_STOPS.map(([t, [r, g, b, a]]) => `rgba(${r},${g},${b},${Math.max(0.12, a / 255).toFixed(2)}) ${t * 100}%`).join(", ")})`;
/** Valores de la capa del mapa en los extremos de la escala (ver STOPS en pipeline/compute_index.py). */
export const NO2_SCALE = { min: 0.55, max: 3.4 };
