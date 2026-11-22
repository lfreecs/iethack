/** Estilo comun de los graficos (Recharts). Los colores salen de las variables de globals.css. */
export const chart = {
  grid: "var(--color-line)",
  tick: { fontSize: 10, fill: "var(--color-muted)" },
  tooltip: {
    background: "var(--color-raised)",
    border: "1px solid var(--color-line-strong)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--color-ink)",
  },
  legend: { fontSize: 11, color: "var(--color-muted)" },
  obs: "var(--color-obs)",
  decl: "var(--color-decl)",
  prod: "var(--color-prod)",
} as const;
