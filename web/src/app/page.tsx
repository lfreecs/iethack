"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import EpisodeSheet from "@/components/EpisodeSheet";
import FilterDock from "@/components/FilterDock";
import PlaceSheet from "@/components/PlaceSheet";
import SearchBox from "@/components/SearchBox";
import TopNav from "@/components/TopNav";
import { LEVELS, TIMELINE, fmtDay, fmtMonth, levelOf, levelOfPeak, loadAttribution, loadPlaces, placeName, verdictOf, type Attribution, type Episode, type LevelKey, type Place } from "@/lib/episodes";
import { num } from "@/lib/format";

const EpisodeMap = dynamic(() => import("@/components/EpisodeMap"), { ssr: false });
const LEGEND: LevelKey[] = ["emergencia", "preemergencia", "alerta", "norma", "propuesta", "alza", "plana"];
const LAST = TIMELINE.length - 1;
const MONTH_INDEX = new Map(TIMELINE.map((m, i) => [m, i]));
/** Episodios que muestra la lista antes de pedir "mostrar mas". */
const PAGE = 100;

export default function Home() {
  const [data, setData] = useState<Attribution | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [minLevel, setMinLevel] = useState<LevelKey>("norma");
  const [range, setRange] = useState<[number, number]>([0, LAST]);
  const [collapsed, setCollapsed] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  /** Abre un episodio y, si los filtros lo dejaban fuera, los amplia lo justo para que se vea. */
  const openEpisode = useCallback((e: Episode) => {
    setMinLevel((cur) => (e.peak < LEVELS[cur].min ? levelOfPeak(e.peak) : cur));
    const m = MONTH_INDEX.get(e.peak_time.slice(0, 7));
    if (m != null) setRange(([lo, hi]) => [Math.min(lo, m), Math.max(hi, m)]);
    setSelectedId(e.id);
  }, []);

  const pickPlace = useCallback((p: Place) => {
    setPlaceId(p.id);
    setSelectedId(null);
    setQuery(placeName(p));
  }, []);

  const clearPlace = useCallback(() => {
    setPlaceId(null);
    setQuery("");
  }, []);

  useEffect(() => {
    loadAttribution()
      .then((d) => {
        setData(d);
        const id = new URLSearchParams(window.location.search).get("episodio");
        const e = id ? d.events.find((x) => x.id === id) : undefined;
        if (e) openEpisode(e);
      })
      .catch((e) => setError(String(e)));
    loadPlaces()
      .then(setPlaces)
      .catch(() => setPlaces([]));
  }, [openEpisode]);

  const byLevel = useMemo(() => data?.events.filter((e) => e.peak >= LEVELS[minLevel].min) ?? [], [data, minLevel]);
  const counts = useMemo(() => {
    const c = new Array<number>(TIMELINE.length).fill(0);
    for (const e of byLevel) {
      const i = MONTH_INDEX.get(e.peak_time.slice(0, 7));
      if (i != null) c[i] += 1;
    }
    return c;
  }, [byLevel]);
  const visible = useMemo(() => {
    const [from, to] = [TIMELINE[range[0]], TIMELINE[range[1]]];
    return byLevel.filter((e) => e.peak_time.slice(0, 7) >= from && e.peak_time.slice(0, 7) <= to);
  }, [byLevel, range]);
  const stats = useMemo(() => {
    const valid = visible.filter((e) => !e.plateau);
    return { total: visible.length, found: valid.filter((e) => verdictOf(e).found).length, flat: visible.length - valid.length };
  }, [visible]);

  if (error) return <div className="p-8 text-bad">Error cargando datos: {error}</div>;

  const selected = visible.find((e) => e.id === selectedId) ?? null;
  const place = places.find((p) => p.id === placeId) ?? null;
  const sheetOpen = !!selected || !!place;
  const stationOf = (e: Episode) => places.find((p) => p.kind === "estación" && p.code === e.code);

  return (
    <div className="flex h-full flex-col">
      <TopNav active="mapa" />
      <main className="relative flex-1 overflow-hidden">
        {!data ? (
          <div className="flex h-full items-center justify-center text-muted">Cargando episodios…</div>
        ) : (
          <>
            <EpisodeMap data={data} events={visible} selected={selected} place={place} places={places} leftInset={collapsed ? 16 : 372} onSelect={setSelectedId} onPlace={pickPlace} />

            <aside className={`absolute left-4 top-4 z-10 flex w-[340px] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-xl ${collapsed ? "" : "bottom-4"}`}>
              <div className={`flex items-start justify-between gap-2 px-4 pt-4 ${collapsed ? "pb-4" : ""}`}>
                <div className="min-w-0">
                  <h1 className="text-[15px] font-semibold tracking-tight text-ink">Episodios de SO₂</h1>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-muted">
                    {collapsed
                      ? `${stats.total} a la vista · ${stats.found} con fuente probable`
                      : `Desde ${LEVELS[minLevel].min} µg/m³ (${LEVELS[minLevel].what}), de ${fmtMonth(TIMELINE[range[0]])} a ${fmtMonth(TIMELINE[range[1]])}. Elige uno para ver de dónde venía el aire.`}
                  </p>
                </div>
                <button
                  onClick={() => setCollapsed((c) => !c)}
                  aria-expanded={!collapsed}
                  aria-label={collapsed ? "Expandir el panel de episodios" : "Minimizar el panel de episodios"}
                  title={collapsed ? "Expandir" : "Minimizar"}
                  className="shrink-0 rounded-lg border border-line p-1.5 text-ink-soft hover:bg-raised"
                >
                  {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                </button>
              </div>

              {!collapsed && (
                <>
                  <div className="mt-3 grid grid-cols-3 gap-1.5 px-4 text-center">
                    {[
                      { n: stats.total, label: "episodios" },
                      { n: stats.found, label: "con fuente probable" },
                      { n: stats.flat, label: "lecturas planas" },
                    ].map((s) => (
                      <div key={s.label} className="rounded-lg bg-raised px-1 py-2">
                        <div className="text-lg font-semibold leading-none tabular-nums text-ink">{s.n}</div>
                        <div className="mt-1 text-[10px] leading-tight text-muted">{s.label}</div>
                      </div>
                    ))}
                  </div>

                  <ul className="mt-3 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
                    {visible.length === 0 && <li className="px-3 py-6 text-center text-[12.5px] text-muted">Ningún episodio con ese nivel en ese período.</li>}
                    {visible.slice(0, limit).map((e) => {
                      const lv = LEVELS[levelOf(e)];
                      const active = e.id === selectedId;
                      return (
                        <li key={e.id}>
                          <button
                            onClick={() => setSelectedId(active ? null : e.id)}
                            className={`flex w-full items-stretch gap-3 rounded-xl px-2.5 py-2 text-left transition-colors ${active ? "bg-ice ring-1 ring-inset ring-cyan" : "hover:bg-raised"}`}
                          >
                            <span className="w-1 shrink-0 rounded-full" style={{ background: lv.color }} />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-baseline justify-between gap-2">
                                <span className="truncate text-[13px] font-medium text-ink">
                                  {e.station.trim()} · {e.comuna}
                                </span>
                                <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink">{num(e.peak, 0)}</span>
                              </span>
                              <span className="mt-0.5 flex items-baseline justify-between gap-2 text-[11px] text-muted">
                                <span className="truncate">{verdictOf(e).short}</span>
                                <span className="shrink-0">{fmtDay(e.peak_time)}</span>
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                    {visible.length > limit && (
                      <li>
                        <button onClick={() => setLimit((n) => n + PAGE)} className="w-full rounded-xl py-2 text-[12.5px] font-medium text-accent-soft hover:bg-raised">
                          Mostrar más ({visible.length - limit} restantes)
                        </button>
                      </li>
                    )}
                  </ul>

                  <div className="border-t border-line px-4 py-3">
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-muted">
                      {LEGEND.map((k) => (
                        <span key={k} className="flex items-center gap-1.5">
                          <span className="size-2.5 rounded-full" style={{ background: LEVELS[k].color }} />
                          {LEVELS[k].label}
                          {LEVELS[k].min ? ` (${LEVELS[k].min}+)` : ""}
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-muted">
                      <span className="flex items-center gap-1.5">
                        <span className="size-2.5 rounded-full bg-cyan ring-1 ring-white" /> Estación
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="size-2.5 rounded-full bg-navy" /> Fundición
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="size-2.5 rounded-full bg-muted" /> Termoeléctrica
                      </span>
                    </div>
                    <p className="mt-2 text-[10.5px] leading-snug text-muted">
                      Cada círculo muestra cuántos episodios a la vista se midieron ahí, con el color del más grave. El de doble anillo reúne estaciones cercanas: haz clic para acercar.
                    </p>
                    <p className="mt-2 text-[10px] leading-snug text-faint">
                      Valores en µg/m³ por hora. Fuentes: SINCA y RETC (Ministerio del Medio Ambiente), Sernageomin, Open-Meteo, OpenStreetMap, Natural Earth.
                    </p>
                  </div>
                </>
              )}
            </aside>

            <div className="absolute left-[372px] top-4 z-20 w-[340px] max-w-[calc(100vw-388px)]">
              <SearchBox places={places} query={query} onQuery={setQuery} onPick={pickPlace} onClear={clearPlace} />
            </div>

            <div className="absolute bottom-4 z-10 transition-[left,right] duration-300" style={{ left: collapsed ? 16 : 372, right: sheetOpen ? 472 : 16 }}>
              <FilterDock minLevel={minLevel} onMinLevel={setMinLevel} range={range} onRange={setRange} counts={counts} shown={visible.length} />
            </div>

            {selected ? (
              <EpisodeSheet
                key={selected.id}
                episode={selected}
                onClose={() => setSelectedId(null)}
                onStation={stationOf(selected) ? () => pickPlace(stationOf(selected)!) : undefined}
              />
            ) : place ? (
              <PlaceSheet key={place.id} place={place} data={data} places={places} onClose={clearPlace} onEpisode={(id) => data.events.filter((e) => e.id === id).forEach(openEpisode)} onPlace={pickPlace} />
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
