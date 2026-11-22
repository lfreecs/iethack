const cache = new Map<number, Intl.NumberFormat>();

function nf(decimals: number) {
  let f = cache.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat("es-CL", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    cache.set(decimals, f);
  }
  return f;
}

const ok = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** Numero con coma decimal; raya si no hay dato. */
export const num = (v: number | null | undefined, decimals = 2) => (ok(v) ? nf(decimals).format(v) : "—");

/** Igual que num, con signo + cuando es positivo. */
export const signed = (v: number | null | undefined, decimals = 0) => (ok(v) ? `${v > 0 ? "+" : ""}${nf(decimals).format(v)}` : "—");

/** 553149 -> "553 mil"; 1150000 -> "1,15 M". */
export function compact(v: number | null | undefined) {
  if (!ok(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return `${nf(a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2).format(v / 1e6)} M`;
  if (a >= 1e4) return `${nf(0).format(v / 1e3)} mil`;
  return nf(a >= 100 ? 0 : 1).format(v);
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "2024-03" -> "mar 2024" */
export const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
