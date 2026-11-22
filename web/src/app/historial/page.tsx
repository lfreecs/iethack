"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRight } from "lucide-react";
import TopNav from "@/components/TopNav";
import { LEVELS, LEVEL_STEPS, NORM, fmtDay, fmtHour, levelOf, loadAttribution, loadValidation, sourceName, verdictOf, type Attribution, type Episode, type LevelKey, type Validation } from "@/lib/episodes";
import { chart } from "@/lib/chart";
import { num } from "@/lib/format";

type Filter = "todos" | "fuente" | "sin" | "plana";
/** Tarjetas que se muestran antes de pedir "mostrar mas". */
const PAGE = 30;
type Sort = "graves" | "recientes";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "fuente", label: "Con fuente probable" },
  { id: "sin", label: "Sin fuente señalada" },
  { id: "plana", label: "Lecturas planas" },
];

/** Curva del SO2 medido alrededor del maximo, con la norma como linea punteada. */
function Spark({ e, color }: { e: Episode; color: string }) {
  const W = 240;
  const H = 46;
  const max = Math.max(NORM * 1.15, ...e.series.map((p) => p.v ?? 0));
  const y = (v: number) => H - 2 - (v / max) * (H - 6);
  let d = "";
  let pen = false;
  e.series.forEach((p, i) => {
    if (p.v == null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${((i / (e.series.length - 1)) * W).toFixed(1)},${y(p.v).toFixed(1)} `;
    pen = true;
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-12 w-full" preserveAspectRatio="none" aria-hidden>
      <line x1="0" x2={W} y1={y(NORM)} y2={y(NORM)} stroke="var(--color-bad)" strokeDasharray="3 3" strokeWidth="1" opacity="0.55" vectorEffect="non-scaling-stroke" />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Card({ e }: { e: Episode }) {
  const lv = LEVELS[levelOf(e)];
  const v = verdictOf(e);
  const top = !e.plateau && e.candidates[0]?.share >= 1 ? e.candidates[0] : null;
  return (
    <Link
      href={`/?episodio=${encodeURIComponent(e.id)}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-xl"
    >
      <div className="h-1.5" style={{ background: lv.color }} />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: lv.color, color: lv.ink }}>
            {lv.label}
          </span>
          <span className="text-[11.5px] text-muted">
            {fmtDay(e.peak_time)} · {fmtHour(e.peak_time)}
          </span>
        </div>

        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums tracking-tight text-ink">{num(e.peak, 0)}</span>
          <span className="text-[11.5px] text-muted">
            µg/m³ en 1 hora · {e.peak >= NORM ? `${num(e.peak / NORM, 1)} veces la norma` : `${num((e.peak / NORM) * 100, 0)} % de la norma`}
          </span>
        </div>
        <div className="mt-1">
          <Spark e={e} color={lv.color} />
        </div>

        <h3 className="mt-2 truncate text-[14px] font-semibold text-ink">
          {e.station} · {e.comuna}
        </h3>
        <p className="text-[12px] text-muted">
          {e.peak >= NORM ? `${e.hours_norm} ${e.hours_norm === 1 ? "hora" : "horas"} sobre la norma` : `${e.hours} ${e.hours === 1 ? "hora" : "horas"} con 150 o más`} · Región de {e.region}
        </p>

        <div className={`mt-3 rounded-xl px-3 py-2 ${v.found ? "bg-navy text-white" : "bg-ice text-ink"}`}>
          <div className="text-[12px] font-semibold">{v.short}</div>
          {top ? (
            <div className={`mt-0.5 truncate text-[11.5px] ${v.found ? "text-white/80" : "text-ink-soft"}`}>
              {sourceName(top.name)} · {num(top.share, 0)} % (rango {num(top.share_lo, 0)}–{num(top.share_hi, 0)})
            </div>
          ) : (
            <div className="mt-0.5 text-[11.5px] text-ink-soft">{e.plateau ? "El instrumento repitió el mismo valor" : "El viento no venía desde una fuente inventariada"}</div>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between pt-3 text-[11.5px]">
          <span className="text-muted">{e.plateau ? "Sin evaluar" : `Confianza ${e.confidence} de 100`}</span>
          <span className="flex items-center gap-1 font-medium text-accent-soft group-hover:gap-2">
            Ver en el mapa <ArrowRight size={13} />
          </span>
        </div>
      </div>
    </Link>
  );
}

export default function Historial() {
  const [data, setData] = useState<Attribution | null>(null);
  const [val, setVal] = useState<Validation | null>(null);
  const [filter, setFilter] = useState<Filter>("todos");
  const [sort, setSort] = useState<Sort>("graves");
  const [minLevel, setMinLevel] = useState<LevelKey>("norma");
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    loadAttribution().then(setData).catch(() => setData(null));
    loadValidation().then(setVal).catch(() => setVal(null));
  }, []);

  const list = useMemo(() => {
    if (!data) return [];
    const keep = data.events.filter((e) => e.peak >= LEVELS[minLevel].min && (filter === "todos" ? true : filter === "plana" ? e.plateau : filter === "fuente" ? !e.plateau && verdictOf(e).found : !e.plateau && !verdictOf(e).found));
    return [...keep].sort((a, b) => (sort === "graves" ? Number(a.plateau) - Number(b.plateau) || b.peak - a.peak : b.peak_time.localeCompare(a.peak_time)));
  }, [data, filter, sort, minLevel]);

  const byYear = useMemo(() => {
    if (!data) return [];
    const acc: Record<string, { y: string; validos: number; planas: number }> = {};
    for (let y = 2018; y <= 2026; y++) acc[y] = { y: String(y), validos: 0, planas: 0 };
    for (const e of data.events) if (e.peak >= LEVELS[minLevel].min) acc[e.peak_time.slice(0, 4)][e.plateau ? "planas" : "validos"] += 1;
    return Object.values(acc);
  }, [data, minLevel]);

  const paipote = val?.closure[0];

  return (
    <div className="flex h-full flex-col">
      <TopNav active="historial" />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-7">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Registro histórico</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            Episodios de SO₂ medidos en estaciones de monitoreo entre 2018 y 2026, con la fuente más probable según el viento y el inventario oficial de emisiones.
            Al abrir se muestran los que superaron la norma horaria (350 µg/m³); baja el nivel mínimo para ver alzas menores.
          </p>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-line bg-panel p-5 shadow-sm">
              <h2 className="text-[14px] font-semibold text-ink">Episodios por año</h2>
              <p className="text-[11.5px] text-muted">Con máximo de {LEVELS[minLevel].min} µg/m³ o más. En gris, lecturas planas del instrumento, que no se atribuyen.</p>
              <div className="mt-3 h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byYear} margin={{ left: -24, right: 4, top: 4 }}>
                    <CartesianGrid stroke={chart.grid} vertical={false} />
                    <XAxis dataKey="y" tick={chart.tick} />
                    <YAxis tick={chart.tick} allowDecimals={false} />
                    <Tooltip cursor={{ fill: "var(--color-ice)" }} contentStyle={chart.tooltip} />
                    <Bar dataKey="validos" name="Episodios" stackId="a" fill="var(--color-navy)" radius={[0, 0, 0, 0]} isAnimationActive={false} />
                    <Bar dataKey="planas" name="Lecturas planas" stackId="a" fill="var(--color-line-strong)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="rounded-2xl border border-line bg-panel p-5 shadow-sm">
              <h2 className="text-[14px] font-semibold text-ink">Qué pasó cuando la fundición Paipote se detuvo</h2>
              <p className="text-[11.5px] text-muted">SO₂ en la estación Paipote, a 1,5 km · nivel alto de cada mes (percentil 95), µg/m³</p>
              <div className="mt-3 h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={paipote?.monthly ?? []} margin={{ left: -24, right: 8, top: 4 }}>
                    <CartesianGrid stroke={chart.grid} vertical={false} />
                    <XAxis dataKey="m" tick={chart.tick} interval={11} tickFormatter={(m) => String(m).slice(0, 4)} />
                    <YAxis tick={chart.tick} />
                    <Tooltip contentStyle={chart.tooltip} formatter={(v) => [`${num(Number(v), 0)} µg/m³`, "Nivel alto del mes"]} />
                    <ReferenceLine x="2024-02" stroke="var(--color-bad)" strokeDasharray="4 3" label={{ value: "se detiene", position: "insideTopRight", fontSize: 10, fill: "var(--color-bad)" }} />
                    <Line type="monotone" dataKey="p95" stroke="var(--color-accent-soft)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {paipote && (
                <p className="mt-2 text-[12px] leading-snug text-ink-soft">
                  El máximo horario bajó de <b>{num(paipote.before.max, 0)}</b> a <b>{num(paipote.after.max, 0)}</b> µg/m³ entre el año anterior y el posterior al 23 de
                  febrero de 2024, y no hubo más episodios. Es la mejor comprobación de que la estación medía a esa fuente.
                </p>
              )}
            </section>
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-[13px] font-semibold text-ink">
              Nivel mínimo <span className="font-normal text-muted">· µg/m³ en 1 hora</span>
            </span>
            <div className="flex flex-wrap gap-1">
              {LEVEL_STEPS.map((k) => (
                <button
                  key={k}
                  onClick={() => setMinLevel(k)}
                  title={`${LEVELS[k].min} o más: ${LEVELS[k].what}`}
                  aria-pressed={k === minLevel}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[13px] font-semibold tabular-nums transition-colors ${
                    k === minLevel ? "bg-navy text-white" : LEVELS[k].min >= LEVELS[minLevel].min ? "bg-ice text-ink hover:bg-line" : "text-faint hover:bg-ice"
                  }`}
                >
                  <span className="size-2 rounded-full" style={{ background: LEVELS[k].color }} />
                  {LEVELS[k].min}
                </button>
              ))}
            </div>
            <span className="text-[12px] text-muted">desde {LEVELS[minLevel].what}</span>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-ice p-1 text-[13px]">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 font-medium transition-colors ${filter === f.id ? "bg-panel text-ink shadow-sm" : "text-muted hover:text-ink"}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-[13px] text-muted">
              Ordenar por
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-lg border border-line bg-panel px-2.5 py-1.5 text-ink max-lg:text-[16px]">
                <option value="graves">Más graves primero</option>
                <option value="recientes">Más recientes primero</option>
              </select>
            </div>
          </div>

          {!data ? (
            <p className="mt-10 text-center text-muted">Cargando registro…</p>
          ) : (
            <>
              <p className="mt-3 text-[12px] text-muted">
                {list.length} {list.length === 1 ? "caso" : "casos"}
              </p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {list.slice(0, limit).map((e) => (
                  <Card key={e.id} e={e} />
                ))}
              </div>
              {list.length > limit && (
                <div className="mt-5 text-center">
                  <button onClick={() => setLimit((n) => n + PAGE)} className="rounded-xl border border-line bg-panel px-4 py-2 text-[13px] font-medium text-ink shadow-sm hover:bg-raised">
                    Mostrar más ({list.length - limit} restantes)
                  </button>
                </div>
              )}
            </>
          )}

          <p className="mt-8 text-[11.5px] leading-snug text-faint">
            Mediciones: SINCA, Ministerio del Medio Ambiente; la estación La Negra viene de las planillas que Altonorte entrega a la SMA (SNIFA), desde marzo de 2022. La mayoría de las estaciones con episodios pertenece a las propias empresas y sus datos figuran como no
            validados. Los resultados ordenan fuentes probables para orientar una fiscalización; no determinan responsabilidades.
          </p>
        </div>
      </main>
    </div>
  );
}
