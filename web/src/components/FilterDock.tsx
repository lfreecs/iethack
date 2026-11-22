"use client";

import { LEVELS, LEVEL_STEPS, TIMELINE, fmtMonth, type LevelKey } from "@/lib/episodes";

type Props = {
  minLevel: LevelKey;
  onMinLevel: (k: LevelKey) => void;
  /** Indices de TIMELINE: primer y ultimo mes del periodo elegido. */
  range: [number, number];
  onRange: (r: [number, number]) => void;
  /** Episodios por mes con el nivel elegido, para el histograma. */
  counts: number[];
  /** Episodios que quedan a la vista con el nivel y el periodo elegidos. */
  shown: number;
};

const LAST = TIMELINE.length - 1;
const YEARS = TIMELINE.flatMap((m, i) => (m.endsWith("-01") ? [{ i, y: m.slice(0, 4) }] : []));

/** Barra de filtros del mapa: nivel minimo de SO2 y linea de tiempo con el periodo a mostrar. */
export default function FilterDock({ minLevel, onMinLevel, range, onRange, counts, shown }: Props) {
  const [lo, hi] = range;
  const max = Math.max(1, ...counts);
  const full = lo === 0 && hi === LAST;
  return (
    <div className="@container rounded-2xl border border-line bg-panel px-4 pb-2.5 pt-3 shadow-xl">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-[12px] font-semibold text-ink">
          Nivel mínimo <span className="font-normal text-muted">· µg/m³ por hora</span>
        </span>
        <div className="flex gap-1">
          {LEVEL_STEPS.map((k) => {
            const lv = LEVELS[k];
            const active = k === minLevel;
            const included = lv.min >= LEVELS[minLevel].min;
            return (
              <button
                key={k}
                onClick={() => onMinLevel(k)}
                title={`${lv.min} o más: ${lv.what}`}
                aria-pressed={active}
                className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-semibold tabular-nums transition-colors ${
                  active ? "bg-navy text-white" : included ? "bg-ice text-ink hover:bg-line" : "text-faint hover:bg-raised"
                }`}
              >
                <span className="size-2 rounded-full" style={{ background: lv.color, opacity: included ? 1 : 0.45 }} />
                {lv.min}
              </button>
            );
          })}
        </div>
        <span className="hidden text-[11.5px] text-muted @[640px]:inline">desde {LEVELS[minLevel].what}</span>
      </div>

      <div className="mt-2.5 flex h-8 items-end gap-px px-2" aria-hidden>
        {counts.map((c, i) => (
          <span
            key={i}
            className="flex-1 rounded-t-[2px]"
            style={{
              height: c ? `${Math.max(14, Math.sqrt(c / max) * 100)}%` : "2px",
              background: i >= lo && i <= hi ? "var(--color-navy)" : "var(--color-line-strong)",
            }}
          />
        ))}
      </div>
      <div className="dual-range">
        <div className="absolute inset-x-2 top-1/2 h-1 -translate-y-1/2 rounded-full bg-ice" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-cyan"
          style={{ left: `calc(8px + (100% - 16px) * ${lo / LAST})`, width: `calc((100% - 16px) * ${(hi - lo) / LAST})` }}
        />
        <input type="range" min={0} max={LAST} value={lo} aria-label="Inicio del período" onChange={(e) => onRange([Math.min(Number(e.target.value), hi), hi])} style={{ zIndex: lo > LAST - 6 ? 3 : 1 }} />
        <input type="range" min={0} max={LAST} value={hi} aria-label="Fin del período" onChange={(e) => onRange([lo, Math.max(Number(e.target.value), lo)])} style={{ zIndex: 2 }} />
      </div>
      <div className="relative mx-2 h-3.5 text-[10px] text-faint" aria-hidden>
        {YEARS.map(({ i, y }) => (
          <span key={y} className="absolute -translate-x-1/2" style={{ left: `${(i / LAST) * 100}%` }}>
            {y}
          </span>
        ))}
      </div>

      <div className="mt-1 flex items-center justify-between gap-3 text-[12px]">
        <span className="text-muted">
          Período:{" "}
          <b className="text-ink">
            {fmtMonth(TIMELINE[lo])} – {fmtMonth(TIMELINE[hi])}
          </b>{" "}
          · <b className="tabular-nums text-ink">{shown}</b> {shown === 1 ? "caso" : "casos"}
        </span>
        <div className="flex gap-1">
          <button onClick={() => onRange([LAST - 11, LAST])} className="rounded-lg px-2 py-1 text-ink-soft hover:bg-raised">
            Último año
          </button>
          <button onClick={() => onRange([0, LAST])} disabled={full} className="rounded-lg px-2 py-1 text-ink-soft hover:bg-raised disabled:text-faint disabled:hover:bg-transparent">
            Todo el período
          </button>
        </div>
      </div>
    </div>
  );
}
