export type Candidate = {
  id: string; name: string; owner: string; comuna: string; lat: number; lon: number;
  km: number; bearing: number; off_axis: number; so2_t_year: number; q_note: string | null;
  share: number; share_lo: number; share_hi: number; align: number; miss_km: number; travel_h: number; expected: number;
};
export type WindSource = "medido" | "vecina" | "modelo";
export type WindHour = { t: string; u: number; dir: number; src: WindSource; cls: string };
export type Hint = { name: string; owner: string; km: number; off_axis: number; lat: number; lon: number; so2_max: number; nox_max: number };

export type Episode = {
  id: string; station: string; code: string; comuna: string; region: string; station_owner: string; lat: number; lon: number;
  start: string; end: string; hours: number; hours_norm: number; peak: number; peak_time: string; status: string; level: string;
  background: number; plateau: boolean; isolated: boolean;
  wind: WindHour[]; wind_source: WindSource; wind_station: string | null; wind_km: number | null; wind_from: number; trajectory: [number, number][];
  series: { t: string; v: number | null }[];
  candidates: Candidate[]; upwind: Hint[];
  background_share: number; background_range: [number, number]; excess_factor: number | null;
  confidence: number; confidence_notes: string[]; verdict: string; top: string | null;
};

export type Station = { code: string; name: string; comuna: string; region: string; lat: number; lon: number; owner: string; wind: boolean; hours: number; max: number; p99: number; events: number };
export type SourcePoint = { name: string; owner: string; comuna: string; lat: number; lon: number; so2_max: number; so2_last: number; kind: "fundición" | "termoeléctrica" | "otra" };
export type RoseSource = { name: string; km: number; bearing: number; hours_share: number; high_share: number; times_more: number; mean_aligned: number; mean_rest: number };
export type Rose = { code: string; station: string; comuna: string; hours: number; p99: number; sources: RoseSource[] };
export type Attribution = { method: string; n_mc: number; events: Episode[]; roses: Rose[]; stations: Station[]; sources: SourcePoint[] };

export type ClosureStation = {
  code: string; station: string; km: number;
  before: { mean: number; p99: number; max: number; hours: number };
  after: { mean: number; p99: number; max: number; hours: number };
  monthly: { m: string; mean: number; p95: number }[];
};
export type Validation = {
  closure_date: string;
  closure: ClosureStation[];
  satellite_so2: Record<string, Record<string, { excess_du: number; error_du: number; days: number }>>;
  declared: Record<string, { cap_t: number; so2: Record<string, number>; name: string }>;
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo cargar ${url}`);
  return res.json() as Promise<T>;
}
export const loadAttribution = () => getJson<Attribution>("/data/atribucion.json");

/** Lugar del buscador: mina (Sernageomin), fuente de emision (RETC), estacion (SINCA) o localidad (OpenStreetMap). */
export type Place = {
  id: string; kind: "mina" | "fuente" | "estación" | "localidad"; name: string; sub: string; lat: number; lon: number; alt: string;
  tipo?: "fundición" | "termoeléctrica" | "otra"; id_vu?: string; so2?: Record<string, number>; nox?: Record<string, number>; cap_t?: number | null;
  code?: string; pop?: number; rank?: number;
  /** Falso si el lugar esta fuera de Antofagasta y Atacama, las regiones cuyas estaciones estan cargadas. */
  cov?: boolean;
};
export const loadPlaces = () => getJson<{ places: Place[] }>("/data/lugares.json").then((d) => d.places);
export const loadValidation = () => getJson<Validation>("/data/validacion.json");

/** Norma horaria de SO2 (D.S. 104/2018), en ug/m3N, y radio en km para decir que algo esta "cerca" de un lugar. */
export const NORM = 350;
export const NEAR_KM = 30;
export type LevelKey = "emergencia" | "preemergencia" | "alerta" | "norma" | "propuesta" | "alza" | "plana";
/** Niveles segun el maximo de 1 hora. 350 a 950 son del D.S. 104/2018; 262 es la norma propuesta en 2025; 150 es un umbral propio. */
export const LEVELS: Record<LevelKey, { label: string; color: string; ink: string; min: number; what: string }> = {
  emergencia: { label: "Emergencia", color: "#8e2a8e", ink: "#ffffff", min: 950, what: "emergencia" },
  preemergencia: { label: "Preemergencia", color: "#d64545", ink: "#ffffff", min: 650, what: "preemergencia" },
  alerta: { label: "Alerta", color: "#e8742a", ink: "#ffffff", min: 500, what: "alerta" },
  norma: { label: "Sobre la norma", color: "#e0b017", ink: "#0e1b2c", min: 350, what: "norma vigente" },
  propuesta: { label: "Sobre la norma propuesta", color: "#8dbf5a", ink: "#0e1b2c", min: 262, what: "norma propuesta en 2025" },
  alza: { label: "Alza bajo la norma", color: "#4fb6c9", ink: "#0e1b2c", min: 150, what: "alza bajo la norma" },
  plana: { label: "Lectura plana", color: "#8a97a4", ink: "#ffffff", min: 0, what: "lectura plana" },
};
/** Niveles que el usuario puede elegir como minimo, de menor a mayor. */
export const LEVEL_STEPS: LevelKey[] = ["alza", "propuesta", "norma", "alerta", "preemergencia", "emergencia"];

export const levelOfPeak = (peak: number): LevelKey =>
  peak >= 950 ? "emergencia" : peak >= 650 ? "preemergencia" : peak >= 500 ? "alerta" : peak >= 350 ? "norma" : peak >= 262 ? "propuesta" : "alza";
export const levelOf = (e: Episode): LevelKey => (e.plateau ? "plana" : levelOfPeak(e.peak));

/** Texto corto del veredicto y si corresponde a una fuente señalada. */
export function verdictOf(e: Episode): { short: string; found: boolean } {
  if (e.plateau) return { short: "No se atribuye: lectura plana", found: false };
  if (e.verdict.startsWith("fuente única")) return { short: "Fuente única probable", found: true };
  if (e.verdict.startsWith("fuente probable")) return { short: "Fuente probable", found: true };
  if (e.verdict.startsWith("origen compartido")) return { short: "Origen compartido", found: false };
  return { short: "Sin fuente inventariada en el viento", found: false };
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const fmtDay = (t: string) => `${Number(t.slice(8, 10))} ${MONTHS[Number(t.slice(5, 7)) - 1]} ${t.slice(0, 4)}`;
/** "2018-05" -> "may 2018" */
export const fmtMonth = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
/** Meses que cubren los datos, de mayo de 2018 a noviembre de 2026, como "AAAA-MM". */
export const TIMELINE: string[] = (() => {
  const out: string[] = [];
  for (let y = 2018, m = 5; y < 2026 || m <= 11; m === 12 ? (y++, (m = 1)) : m++) out.push(`${y}-${String(m).padStart(2, "0")}`);
  return out;
})();
export const fmtHour = (t: string) => `${t.slice(11, 13)}:00`;

const KEEP_LOWER = new Set(["de", "del", "la", "las", "los", "y", "el"]);
/** "FUNDICION  HERNAN  VIDELA  LIRA" -> "Fundicion Hernan Videla Lira" */
export function title(name: string) {
  return name.toLowerCase().split(/\s+/).filter(Boolean).map((w, i) => (i && KEEP_LOWER.has(w) ? w : w[0].toUpperCase() + w.slice(1))).join(" ");
}

/** Nombres legibles de las fuentes principales (el inventario los trae en mayusculas y sin tildes). */
const SOURCE_NAMES: Record<string, string> = {
  "FUNDICION HERNAN VIDELA LIRA": "Fundición Paipote (Hernán Videla Lira)",
  "DIVISIÓN CHUQUICAMATA": "Fundición Chuquicamata (Codelco)",
  "FUNDICION ALTONORTE": "Fundición Altonorte",
  "DIVISION SALVADOR POTRERILLOS": "Fundición Potrerillos (Codelco)",
  "DIVISIÓN MINISTRO HALES": "Ministro Hales (Codelco)",
  GUACOLDA: "Termoeléctrica Guacolda",
  "CENTRAL TERMOELÉCTRICA NUEVA TOCOPILLA": "Termoeléctrica Nueva Tocopilla",
  "CENTRAL TERMICA TOCOPILLA": "Termoeléctrica Tocopilla",
  "CENTRAL TERMOELÉCTRICA ANGAMOS": "Termoeléctrica Angamos",
  "CENTRAL TERMICA ANDINA": "Termoeléctrica Andina",
  "CENTRAL TERMOELÉCTRICA COCHRANE": "Termoeléctrica Cochrane",
  "CENTRAL TÉRMICA MEJILLONES": "Termoeléctrica Mejillones",
  "PLANTA DE PELLETS": "Planta de Pellets (Huasco)",
};
export const sourceName = (name: string) => SOURCE_NAMES[name] ?? title(name);

const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
/** 68 -> "ENE" */
export const compass = (deg: number) => POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

/** Distancia aproximada en km entre dos puntos cercanos. */
export const distanceKm = (lat1: number, lon1: number, lat2: number, lon2: number) =>
  Math.hypot((lon2 - lon1) * 111.32 * Math.cos((lat1 * Math.PI) / 180), (lat2 - lat1) * 110.57);

export const placeName = (p: Place) => (p.kind === "fuente" ? sourceName(p.name) : p.name);
export const placeKind = (p: Place) =>
  p.kind === "mina" ? "Mina" : p.kind === "estación" ? "Estación" : p.kind === "localidad" ? (p.rank === 0 ? "Ciudad" : "Localidad")
  : p.tipo === "fundición" ? "Fundición" : p.tipo === "termoeléctrica" ? "Termoeléctrica" : "Establecimiento";

/** Minusculas y sin tildes, para comparar textos. */
export const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Lugares cuyo nombre calza con lo escrito, del mas parecido al menos. */
export function searchPlaces(places: Place[], query: string, limit = 8): Place[] {
  const q = fold(query).trim();
  if (q.length < 2) return [];
  const scored: [number, Place][] = [];
  for (const p of places) {
    const name = fold(placeName(p));
    let s = name === q ? 100 : name.startsWith(q) ? 80 : name.split(/[\s(]+/).some((w) => w.startsWith(q)) ? 60 : name.includes(q) ? 45 : p.alt.includes(q) ? 30 : -1;
    if (s < 0) continue;
    s += p.kind === "mina" ? 5 : p.kind === "fuente" ? (p.tipo === "otra" ? 0 : 5) : p.kind === "estación" ? 2 : p.rank === 0 ? 6 : p.rank === 1 ? 4 : 0;
    scored.push([s, p]);
  }
  return scored.sort((a, b) => b[0] - a[0] || placeName(a[1]).length - placeName(b[1]).length).slice(0, limit).map((x) => x[1]);
}

/** Punto a km kilometros de (lat, lon) en el rumbo bearing (grados desde el norte). Devuelve [lon, lat]. */
export function destination(lat: number, lon: number, bearing: number, km: number): [number, number] {
  const b = (bearing * Math.PI) / 180;
  return [lon + (km * Math.sin(b)) / (111.32 * Math.cos((lat * Math.PI) / 180)), lat + (km * Math.cos(b)) / 110.57];
}
