"use client";

import { useMemo } from "react";
import Link from "next/link";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ExternalLink, FileUp } from "lucide-react";
import { Card, Chip } from "./ui";
import { DECLARED_NAME, METRIC, annualExcess, compareAnnual, excessMap, toIndex, type Comparison, type Mine, type Source } from "@/lib/data";
import { chart } from "@/lib/chart";
import { compact, monthLabel, num, signed } from "@/lib/format";

const title = (key: string, metric: string) => `${DECLARED_NAME[key] ?? key} · ${METRIC[metric]?.short ?? metric}`;

function SourceLine({ source }: { source: Source }) {
  return (
    <div className="mt-2 border-t border-line pt-2 text-[10.5px] leading-snug text-faint">
      {source.url ? (
        <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 hover:text-ink-soft">
          <ExternalLink size={11} className="mt-0.5 shrink-0" /> {source.doc}
        </a>
      ) : (
        <span>{source.doc}</span>
      )}
      {source.note && <p className="mt-1">{source.note}</p>}
    </div>
  );
}

/** Lectura en una frase del margen de error y de los cambios año a año. */
function reading(s: Comparison) {
  if (!s.ci || s.r == null) return "";
  if (s.ci[0] <= 0 && s.ci[1] >= 0) return "Con tan pocos años el margen incluye el cero: no se puede descartar que el parecido sea azar.";
  if (s.r < 0) return "Se mueven en sentido contrario.";
  if (s.r_changes == null) return "";
  return s.r_changes >= 0.4
    ? "También coinciden, en parte, los cambios de un año al siguiente: no es solo una tendencia común."
    : "Coinciden sobre todo porque ambas series suben con los años; sus cambios de un año al siguiente no se siguen.";
}

function Legend() {
  return (
    <div className="flex gap-3 text-[10.5px] text-muted">
      <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-obs" /> NO₂ observado</span>
      <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-decl" /> Declarado</span>
    </div>
  );
}

export default function DeclaredPanel({ mine }: { mine: Mine }) {
  const annual = useMemo(() => {
    const v = mine.stats.verdict;
    const out = [];
    for (const [key, d] of Object.entries(mine.declared_data)) {
      const obs = annualExcess(mine, d.fiscal_year_end_month);
      for (const [metric, vals] of Object.entries(d.series)) {
        const cmp = compareAnnual(obs, vals);
        if (cmp.rows.length < 2) continue;
        const stat = mine.stats.comparisons.find((c) => c.declared === key && c.metric === metric);
        out.push({ id: `${key}-${metric}`, key, metric, d, ...cmp, stat, primary: key === v.declared && metric === v.metric });
      }
    }
    return out.sort((a, b) => Number(b.primary) - Number(a.primary));
  }, [mine]);

  const monthly = useMemo(() => {
    const ex = excessMap(mine);
    const out = [];
    for (const [key, d] of Object.entries(mine.declared_data)) {
      for (const [metric, vals] of Object.entries(d.monthly ?? {})) {
        const months = Object.keys(vals).filter((m) => m in ex).sort();
        const oi = toIndex(months, ex);
        const di = toIndex(months, vals);
        const stat = mine.stats.monthly_comparisons.find((c) => c.declared === key && c.metric === metric);
        out.push({ id: `${key}-${metric}-m`, key, metric, d, stat, rows: months.map((m) => ({ m, observado: oi[m], declarado: di[m] })) });
      }
    }
    return out;
  }, [mine]);

  return (
    <div className="space-y-3">
      {annual.length === 0 && (
        <Card>
          <p className="text-xs leading-snug text-muted">
            No hay cifras por mina publicadas para comparar. Solo se puede seguir la tendencia de la señal y contrastarla con la producción.
          </p>
        </Card>
      )}

      {annual.map((c) => {
        const last = c.rows.at(-1);
        return (
          <Card key={c.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold leading-tight text-ink">{title(c.key, c.metric)}</h3>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {c.primary && <Chip tone="info">Comparación principal</Chip>}
                  {c.d.derived && <Chip>Cálculo propio</Chip>}
                  {c.d.fiscal_year_end_month && <Chip>Año fiscal jul–jun</Chip>}
                  {c.rows.length < 5 && <Chip tone="warn">Pocos años</Chip>}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xl font-semibold tabular-nums leading-none text-ink">{num(c.stat?.r ?? c.r)}</div>
                <div className="mt-1 text-[10.5px] text-muted">coincidencia · {c.rows.length} años</div>
              </div>
            </div>
            <div className="mt-3 h-36">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={c.rows} margin={{ left: -22, right: 6, top: 6 }}>
                  <CartesianGrid stroke={chart.grid} vertical={false} />
                  <XAxis dataKey="y" tick={chart.tick} />
                  <YAxis tick={chart.tick} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={chart.tooltip} formatter={(v) => num(Number(v), 0)} />
                  <Line type="monotone" dataKey="observado" name="NO₂ observado" stroke={chart.obs} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="declarado" name="Declarado" stroke={chart.decl} strokeWidth={2} strokeDasharray="5 3" dot={{ r: 2.5 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <Legend />
              <span className="text-[10.5px] text-faint">100 = promedio del período</span>
            </div>
            {c.stat?.ci && (
              <dl className="mt-2.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t border-line pt-2 text-[11px]">
                <dt className="text-muted">Margen de error de la coincidencia (95 % de confianza)</dt>
                <dd className="text-right tabular-nums text-ink-soft">{num(c.stat.ci[0])} a {num(c.stat.ci[1])}</dd>
                <dt className="text-muted">Coincidencia de los cambios de un año al siguiente</dt>
                <dd className="text-right tabular-nums text-ink-soft">{num(c.stat.r_changes)}</dd>
              </dl>
            )}
            {c.stat?.ci && <p className="mt-1.5 text-[11px] leading-snug text-muted">{reading(c.stat)}</p>}
            <p className="mt-2 text-[11px] leading-snug text-muted">
              {c.worst && Math.abs(c.worst.brecha) >= 1 && (
                <>
                  Mayor brecha en <b className="font-semibold text-ink-soft">{c.worst.y}</b>: lo observado quedó {signed(c.worst.brecha)} puntos{" "}
                  {c.worst.brecha > 0 ? "sobre" : "bajo"} lo declarado.{" "}
                </>
              )}
              {last && (
                <>
                  Último dato declarado: {compact(last.valor)} {METRIC[c.metric]?.unit} ({last.y}).
                </>
              )}
            </p>
            <SourceLine source={c.d.source} />
          </Card>
        );
      })}

      {monthly.map((c) => (
        <Card key={c.id}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold leading-tight text-ink">{title(c.key, c.metric)} · mes a mes</h3>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Chip>Dato mensual publicado</Chip>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-xl font-semibold tabular-nums leading-none text-ink">{num(c.stat?.r_deseason ?? c.stat?.r)}</div>
              <div className="mt-1 text-[10.5px] text-muted">coincidencia · {c.rows.length} meses</div>
            </div>
          </div>
          <div className="mt-3 h-32">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={c.rows} margin={{ left: -22, right: 6, top: 6 }}>
                <CartesianGrid stroke={chart.grid} vertical={false} />
                <XAxis dataKey="m" tick={chart.tick} interval={5} tickFormatter={(m) => monthLabel(String(m))} />
                <YAxis tick={chart.tick} domain={["auto", "auto"]} />
                <Tooltip contentStyle={chart.tooltip} labelFormatter={(m) => monthLabel(String(m))} formatter={(v) => num(Number(v), 0)} />
                <Line type="monotone" dataKey="observado" name="NO₂ observado" stroke={chart.obs} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="declarado" name="Declarado" stroke={chart.decl} strokeWidth={1.5} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <Legend />
          <p className="mt-2 text-[11px] leading-snug text-muted">
            Mes a mes casi no se siguen (coincidencia {num(c.stat?.r)}; {num(c.stat?.r_deseason)} al quitar el efecto de las estaciones). El viento y las nubes
            mueven la medición de un mes más de lo que cambia el consumo: el método sirve para tendencias de varios años, no para auditar un mes.
          </p>
          <SourceLine source={c.d.source} />
        </Card>
      ))}

      <Link href={`/verificar?mina=${mine.id}`} className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-accent/50 bg-accent/5 px-4 py-2.5 text-xs font-medium text-accent-soft hover:bg-accent/10">
        <FileUp size={14} /> ¿Eres la empresa? Compara tus propios datos con el satélite
      </Link>
    </div>
  );
}
