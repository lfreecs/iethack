"use client";

import { useEffect, useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronRight, Factory, MapPin, Pickaxe, RadioTower, X, type LucideIcon } from "lucide-react";
import { LEVELS, NEAR_KM, NORM, distanceKm, fmtDay, levelOf, placeKind, placeName, sourceName, type Attribution, type LevelKey, type Place } from "@/lib/episodes";
import { chart } from "@/lib/chart";
import { compact, num } from "@/lib/format";

const ICON: Record<Place["kind"], LucideIcon> = { mina: Pickaxe, fuente: Factory, estación: RadioTower, localidad: MapPin };
const ROWS: LevelKey[] = ["emergencia", "preemergencia", "alerta", "norma", "propuesta", "alza", "plana"];
const maxOf = (series?: Record<string, number>) => Math.max(0, ...Object.values(series ?? {}));

type Props = {
  place: Place;
  data: Attribution;
  places: Place[];
  onClose: () => void;
  onEpisode: (id: string) => void;
  onPlace: (p: Place) => void;
};

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl bg-raised px-3 py-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums tracking-tight text-ink">{value}</div>
      <div className="text-[10.5px] leading-tight text-faint">{hint}</div>
    </div>
  );
}

/** Ficha de un lugar buscado: su registro historico de episodios cercanos y, si es una fuente, lo que declara emitir. */
export default function PlaceSheet({ place, data, places, onClose, onEpisode, onPlace }: Props) {
  const Icon = ICON[place.kind];

  const rec = useMemo(() => {
    const km = (x: { lat: number; lon: number }) => distanceKm(place.lat, place.lon, x.lat, x.lon);
    const stations = data.stations.map((s) => ({ s, km: km(s) })).sort((a, b) => a.km - b.km);
    const events = data.events.filter((e) => km(e) <= NEAR_KM);
    const valid = events.filter((e) => !e.plateau);
    const years: Record<string, { y: string; bajo: number; sobre: number }> = {};
    for (let y = 2018; y <= 2026; y++) years[y] = { y: String(y), bajo: 0, sobre: 0 };
    for (const e of valid) years[e.peak_time.slice(0, 4)][e.peak >= NORM ? "sobre" : "bajo"] += 1;
    return {
      nearest: stations[0],
      near: stations.filter((x) => x.km <= NEAR_KM),
      events,
      valid,
      byLevel: ROWS.map((k) => ({ k, n: events.filter((e) => levelOf(e) === k).length })).filter((r) => r.n > 0),
      years: Object.values(years),
      top: [...valid].sort((a, b) => b.peak - a.peak).slice(0, 5),
      sources: places
        .filter((p) => p.kind === "fuente" && p.id !== place.id && maxOf(p.so2) >= 300)
        .map((p) => ({ p, km: km(p) }))
        .filter((x) => x.km <= NEAR_KM)
        .sort((a, b) => a.km - b.km),
      pointed: place.kind === "fuente" ? data.events.filter((e) => !e.plateau && e.verdict.startsWith("fuente") && e.candidates[0]?.id === place.id_vu).length : 0,
      roses:
        place.kind === "fuente"
          ? data.roses.flatMap((r) => r.sources.filter((s) => s.name === place.name).map((s) => ({ label: `en la estación ${r.station.trim()}`, times: s.times_more })))
          : place.kind === "estación"
            ? (data.roses.find((r) => r.code === place.code)?.sources ?? []).map((s) => ({ label: `con viento desde ${sourceName(s.name)}`, times: s.times_more }))
            : [],
      station: place.kind === "estación" ? data.stations.find((s) => s.code === place.code) : undefined,
    };
  }, [place, data, places]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const so2 = place.kind === "fuente" ? ["2019", "2020", "2021", "2022", "2023", "2024", "2025"].map((y) => ({ y, t: place.so2?.[y] ?? 0 })) : [];
  const so2Max = maxOf(place.so2);
  const lastYear = Object.keys(place.so2 ?? {}).sort().at(-1);

  return (
    <aside className="absolute bottom-4 right-4 top-4 z-10 flex w-[440px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-xl">
      <div className="h-1.5 shrink-0 bg-navy" />
      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ice px-2.5 py-1 text-[11px] font-semibold text-ink">
            <Icon size={12} /> {placeKind(place)}
          </span>
          <h2 className="mt-2 truncate text-lg font-semibold tracking-tight text-ink">{placeName(place)}</h2>
          <p className="truncate text-[13px] text-muted">{place.sub}</p>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-raised hover:text-ink" aria-label="Cerrar ficha del lugar">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-5 pt-4">
        <div className="grid grid-cols-3 gap-2">
          <Kpi label="Episodios cerca" value={String(rec.valid.length)} hint={`a menos de ${NEAR_KM} km, 2018–2026`} />
          <Kpi label="Sobre la norma" value={String(rec.valid.filter((e) => e.peak >= NORM).length)} hint="con 350 µg/m³ o más" />
          <Kpi label="Estaciones" value={String(rec.near.length)} hint="que miden SO₂ cerca" />
        </div>

        {place.cov === false ? (
          <div className="rounded-xl bg-ice px-4 py-3 text-xs leading-snug text-ink-soft">
            <b className="text-ink">Fuera de las regiones cargadas.</b> Por ahora la plataforma tiene las estaciones de Antofagasta y Atacama. Este lugar está en otra región, así
            que su registro aparece vacío.
          </div>
        ) : (
          rec.near.length === 0 &&
          rec.nearest && (
            <div className="rounded-xl bg-ice px-4 py-3 text-xs leading-snug text-ink-soft">
              <b className="text-ink">Sin estaciones de SO₂ cerca.</b> La más cercana es {rec.nearest.s.name.trim()} ({rec.nearest.s.comuna}), a {num(rec.nearest.km, 0)} km. Un
              episodio aquí no quedaría registrado por las estaciones de SO₂ que publica SINCA.
            </div>
          )
        )}

        {rec.station && (
          <p className="rounded-xl border border-line px-4 py-3 text-xs leading-snug text-ink-soft">
            Máximo en 1 hora: <b className="text-ink">{num(rec.station.max, 0)} µg/m³</b> · {num(rec.station.hours, 0)} horas medidas ·{" "}
            {rec.station.wind ? "mide viento" : "no mide viento"}
          </p>
        )}

        {rec.events.length > 0 && (
          <>
            <section>
              <h3 className="text-[13px] font-semibold text-ink">Registro histórico cerca de este lugar</h3>
              <p className="text-[11px] text-muted">Episodios por año · en cian bajo la norma (150 a 349), en azul sobre la norma</p>
              <div className="mt-2 h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rec.years} margin={{ left: -24, right: 4, top: 4 }}>
                    <CartesianGrid stroke={chart.grid} vertical={false} />
                    <XAxis dataKey="y" tick={chart.tick} />
                    <YAxis tick={chart.tick} allowDecimals={false} />
                    <Tooltip cursor={{ fill: "var(--color-ice)" }} contentStyle={chart.tooltip} />
                    <Bar dataKey="bajo" name="Bajo la norma" stackId="a" fill="var(--color-cyan)" isAnimationActive={false} />
                    <Bar dataKey="sobre" name="Sobre la norma" stackId="a" fill="var(--color-navy)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-soft">
                {rec.byLevel.map(({ k, n }) => (
                  <span key={k} className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full" style={{ background: LEVELS[k].color }} />
                    {LEVELS[k].label}: <b className="tabular-nums text-ink">{n}</b>
                  </span>
                ))}
              </div>
            </section>

            {rec.top.length > 0 && (
              <section>
                <h3 className="text-[13px] font-semibold text-ink">Casos más graves</h3>
                <ul className="mt-1.5 space-y-1">
                  {rec.top.map((e) => (
                    <li key={e.id}>
                      <button onClick={() => onEpisode(e.id)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-raised">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ background: LEVELS[levelOf(e)].color }} />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                          {e.station.trim()} · {fmtDay(e.peak_time)}
                        </span>
                        <span className="shrink-0 text-[12.5px] font-semibold tabular-nums text-ink">{num(e.peak, 0)}</span>
                        <ChevronRight size={14} className="shrink-0 text-faint" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {place.kind === "fuente" && (
          <section>
            <h3 className="text-[13px] font-semibold text-ink">SO₂ que declara emitir</h3>
            {so2Max >= 50 ? (
              <>
                <p className="text-[11px] text-muted">Toneladas al año, según el RETC{place.cap_t ? " · línea roja: su límite anual (D.S. 28)" : ""}</p>
                <div className="mt-2 h-32">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={so2} margin={{ left: -10, right: 4, top: 8 }}>
                      <CartesianGrid stroke={chart.grid} vertical={false} />
                      <XAxis dataKey="y" tick={chart.tick} />
                      <YAxis tick={chart.tick} tickFormatter={(v) => compact(Number(v))} domain={[0, Math.max(so2Max, place.cap_t ?? 0) * 1.08]} />
                      <Tooltip cursor={{ fill: "var(--color-ice)" }} contentStyle={chart.tooltip} formatter={(v) => [`${num(Number(v), 0)} t`, "SO₂ declarado"]} />
                      {place.cap_t ? <ReferenceLine y={place.cap_t} stroke="var(--color-bad)" strokeDasharray="4 3" /> : null}
                      <Bar dataKey="t" fill="var(--color-navy)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-1.5 text-[11px] leading-snug text-muted">
                  {lastYear ? `En ${lastYear} declaró ${num(place.so2?.[lastYear], 0)} t.` : ""}
                  {place.cap_t ? ` Su límite es de ${num(place.cap_t, 0)} t al año.` : ""} Son cifras declaradas o estimadas, y algunos años están incompletos.
                </p>
              </>
            ) : (
              <p className="mt-1 text-xs leading-snug text-ink-soft">
                Declara muy poco SO₂ (máximo {num(so2Max, 0)} t al año){maxOf(place.nox) >= 200 ? ` y hasta ${num(maxOf(place.nox), 0)} t de óxidos de nitrógeno` : ""}.
              </p>
            )}
            <p className="mt-2 rounded-xl bg-raised px-3 py-2 text-xs leading-snug text-ink-soft">
              Señalada como fuente probable en <b className="text-ink">{rec.pointed}</b> {rec.pointed === 1 ? "episodio" : "episodios"} de todo el registro.
            </p>
          </section>
        )}

        {rec.roses.length > 0 && (
          <section>
            <h3 className="text-[13px] font-semibold text-ink">Qué dice el viento de 8 años</h3>
            <ul className="mt-1.5 space-y-1 text-xs leading-snug text-ink-soft">
              {rec.roses.slice(0, 4).map((r) => (
                <li key={r.label} className="flex justify-between gap-3">
                  <span>Horas con SO₂ alto {r.label}</span>
                  <b className="shrink-0 tabular-nums text-ink">{num(r.times, 1)} veces más</b>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-muted">Comparado con lo esperable si el viento no influyera.</p>
          </section>
        )}

        {place.kind !== "fuente" && (
          <section>
            <h3 className="text-[13px] font-semibold text-ink">Fuentes de SO₂ inventariadas cerca</h3>
            {rec.sources.length ? (
              <ul className="mt-1.5 space-y-1">
                {rec.sources.map(({ p, km }) => (
                  <li key={p.id}>
                    <button onClick={() => onPlace(p)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-raised">
                      <Factory size={14} className="shrink-0 text-accent-soft" />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{placeName(p)}</span>
                      <span className="shrink-0 text-[11.5px] tabular-nums text-muted">
                        {num(km, 0)} km · {compact(maxOf(p.so2))} t/año
                      </span>
                      <ChevronRight size={14} className="shrink-0 text-faint" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs leading-snug text-ink-soft">Ninguna fuente con más de 300 t de SO₂ al año a menos de {NEAR_KM} km.</p>
            )}
            {place.kind === "mina" && (
              <p className="mt-2 text-[11px] leading-snug text-muted">
                En el inventario oficial, las minas sin fundición declaran muy poco SO₂. Esta ficha muestra lo que se mide cerca de la mina.
              </p>
            )}
          </section>
        )}

        <p className="border-t border-line pt-3 text-[11px] leading-snug text-faint">
          “Cerca” es a menos de {NEAR_KM} km (el círculo punteado del mapa). Fuentes: SINCA y RETC (Ministerio del Medio Ambiente), Sernageomin y OpenStreetMap.
        </p>
      </div>
    </aside>
  );
}
