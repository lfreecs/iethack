"use client";

import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, FileText, X } from "lucide-react";
import DeclaredPanel from "./DeclaredPanel";
import WindPanel from "./WindPanel";
import { Card, Chip, Dot, Stat, Tabs } from "./ui";
import { VERDICT, excessMap, rollingMean, summary, type IndexData, type Mine, type WindData } from "@/lib/data";
import { chart } from "@/lib/chart";
import { monthLabel, num, signed } from "@/lib/format";

type Props = { data: IndexData; wind: WindData | null; mine: Mine; onClose: () => void };
type Tab = "resumen" | "declarado" | "viento" | "informe";
type Report = { text: string; source: string };

const TABS: { id: Tab; label: string }[] = [
  { id: "resumen", label: "Resumen" },
  { id: "declarado", label: "Declarado" },
  { id: "viento", label: "Viento" },
  { id: "informe", label: "Informe" },
];

const REPORT_SOURCE: Record<string, string> = {
  ia: "Redactado por IA a partir de los números calculados por la plataforma.",
  cache: "Informe guardado (disponible sin conexión).",
  respaldo: "Resumen automático, sin IA.",
};

const toIndex = (v: number | null, base: number | null) => (v != null && base ? (v / base) * 100 : null);

function follows(r: number | null) {
  if (r == null) return null;
  return r >= 0.6 ? "sigue de cerca" : r >= 0.3 ? "sigue solo en parte" : "casi no sigue";
}

export default function MineSheet({ data, wind, mine, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("resumen");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const sum = summary(mine);
  const v = mine.stats.verdict;
  const meta = VERDICT[v.code];
  const hasProduction = Object.keys(mine.production).length > 0;
  const rel = follows(mine.stats.r_production_deseason);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const trend = useMemo(() => {
    const months = data.months.filter((m) => m in mine.monthly);
    const ex = rollingMean(months, excessMap(mine));
    const pr = rollingMean(months, mine.production);
    const exBase = ex.find((x) => x != null) ?? null;
    const prBase = pr.find((x) => x != null) ?? null;
    return months.map((m, i) => ({ m, senal: toIndex(ex[i], exBase), produccion: toIndex(pr[i], prBase) }));
  }, [data.months, mine]);

  async function generate() {
    setLoading(true);
    setReport(null);
    try {
      const res = await fetch("/api/informe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mineId: mine.id }) });
      setReport((await res.json()) as Report);
    } catch {
      setReport({ text: "No se pudo generar el informe.", source: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside className="absolute bottom-28 right-4 top-[4.75rem] z-20 flex w-[480px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl border border-line-strong/70 bg-panel/95 shadow-2xl backdrop-blur">
      <div className="px-5 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold tracking-tight text-ink">{mine.name}</h2>
            <p className="text-sm text-muted">{mine.company}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-raised hover:text-ink" aria-label="Cerrar ficha">
            <X size={18} />
          </button>
        </div>
        <div className="mt-3">
          <Chip tone={meta.tone} title={meta.help}>
            <Dot tone={meta.tone} /> {meta.label}
          </Chip>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat label="NO₂ sobre la mina" value={`×${num(sum.ratio, 1)}`} hint="veces el aire de alrededor, últimos 12 meses" />
          <Stat label="Cambio de la señal" value={`${signed(sum.change)} %`} hint="últimos 12 meses frente a los primeros 12" />
          <Stat
            label="Coincidencia con lo declarado"
            value={num(v.r)}
            hint={v.n && v.declared ? `${v.n} años${v.ci ? ` · margen ${num(v.ci[0])} a ${num(v.ci[1])}` : ""}` : "sin serie comparable"}
          />
        </div>
        <div className="mt-4">
          <Tabs value={tab} onChange={setTab} items={TABS} />
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {tab === "resumen" && (
          <>
            {mine.note && (
              <p className="flex gap-2 rounded-xl bg-warn/10 p-3 text-xs leading-snug text-warn ring-1 ring-inset ring-warn/25">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {mine.note}
              </p>
            )}
            <Card>
              <h3 className="text-sm font-semibold text-ink">Señal del satélite{hasProduction ? " y producción de cobre" : ""}</h3>
              <p className="mt-0.5 text-[11px] text-muted">Promedio móvil de 12 meses · 100 = primer año</p>
              <div className="mt-3 h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend} margin={{ left: -22, right: 6, top: 6 }}>
                    <CartesianGrid stroke={chart.grid} vertical={false} />
                    <XAxis dataKey="m" tick={chart.tick} interval={23} tickFormatter={(m) => String(m).slice(0, 4)} />
                    <YAxis tick={chart.tick} domain={["auto", "auto"]} />
                    <Tooltip contentStyle={chart.tooltip} labelFormatter={(m) => monthLabel(String(m))} formatter={(val) => num(Number(val), 0)} />
                    <Line type="monotone" dataKey="senal" name="NO₂ observado" stroke={chart.obs} dot={false} strokeWidth={2} connectNulls isAnimationActive={false} />
                    {hasProduction && (
                      <Line type="monotone" dataKey="produccion" name="Cobre producido" stroke={chart.prod} dot={false} strokeWidth={1.5} connectNulls isAnimationActive={false} />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-1 flex gap-3 text-[10.5px] text-muted">
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-obs" /> NO₂ observado</span>
                {hasProduction && <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-prod" /> Cobre producido (Cochilco)</span>}
              </div>
              {rel && (
                <p className="mt-2 text-[11px] leading-snug text-muted">
                  Mes a mes, la señal {rel} a la producción (coincidencia {num(mine.stats.r_production_deseason)} al quitar el efecto de las estaciones). El
                  método sirve para tendencias de varios años, no para auditar un mes.
                </p>
              )}
            </Card>
            <Card>
              <h3 className="text-sm font-semibold text-ink">Cómo leer el veredicto</h3>
              <p className="mt-1 text-xs leading-snug text-muted">{meta.help}</p>
              <p className="mt-2 text-xs leading-snug text-muted">
                En el mapa, el círculo marca los {data.core_km} km donde se mide la señal y el anillo punteado ({data.ring_km[0]}–{data.ring_km[1]} km), el aire de
                referencia que se le resta.
              </p>
            </Card>
          </>
        )}

        {tab === "declarado" && <DeclaredPanel mine={mine} />}

        {tab === "viento" && (wind ? <WindPanel mine={mine} wind={wind} /> : <p className="text-sm text-muted">Cargando datos de viento…</p>)}

        {tab === "informe" && (
          <Card>
            <h3 className="text-sm font-semibold text-ink">Informe de verificación</h3>
            <p className="mt-1 text-xs leading-snug text-muted">
              Resume lo que muestra el satélite, la comparación con lo declarado y qué conviene revisar. Usa solo los números calculados por la plataforma.
            </p>
            <button
              onClick={generate}
              disabled={loading}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent hover:brightness-110 disabled:opacity-60"
            >
              <FileText size={16} /> {loading ? "Generando…" : report ? "Generar de nuevo" : "Generar informe"}
            </button>
            {report && (
              <div className="mt-4 border-t border-line pt-3">
                <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-soft">{report.text}</div>
                <p className="mt-3 text-[10.5px] text-faint">{REPORT_SOURCE[report.source] ?? ""}</p>
              </div>
            )}
          </Card>
        )}
      </div>
    </aside>
  );
}
