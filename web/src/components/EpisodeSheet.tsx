"use client";

import { useEffect } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, RadioTower, Wind, X } from "lucide-react";
import { LEVELS, NEAR_KM, NORM, compass, fmtDay, fmtHour, levelOf, sourceName, verdictOf, type Episode } from "@/lib/episodes";
import { chart } from "@/lib/chart";
import { num } from "@/lib/format";

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl bg-raised px-3 py-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums tracking-tight text-ink">{value}</div>
      <div className="text-[10.5px] leading-tight text-faint">{hint}</div>
    </div>
  );
}

function explain(e: Episode) {
  const top = e.candidates[0];
  if (e.plateau) return "El instrumento repitió casi el mismo valor durante el episodio. El valor real no se conoce, así que no se señala ninguna fuente.";
  if (e.verdict.startsWith("fuente") && top)
    return `${sourceName(top.name)} concentra el ${num(top.share, 0)} % del origen probable (entre ${num(top.share_lo, 0)} y ${num(top.share_hi, 0)} % al variar el viento y los supuestos).`;
  if (e.verdict.startsWith("origen compartido")) return "Más de una fuente queda en la dirección desde la que venía el viento. No se puede señalar una sola.";
  return "Ninguna fuente del inventario oficial queda en la dirección desde la que venía el viento. El origen puede ser una fuente no inventariada.";
}

export default function EpisodeSheet({ episode: e, onClose, onStation }: { episode: Episode; onClose: () => void; onStation?: () => void }) {
  const lv = LEVELS[levelOf(e)];
  const v = verdictOf(e);
  const shown = e.plateau ? [] : e.candidates.filter((c) => c.share >= 1);
  const h0 = e.wind[0];

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="absolute bottom-4 right-4 top-4 z-10 flex w-[440px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-xl">
      <div className="h-1.5 shrink-0" style={{ background: lv.color }} />
      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: lv.color, color: lv.ink }}>
            {lv.label}
          </span>
          <h2 className="mt-2 truncate text-lg font-semibold tracking-tight text-ink">
            {e.station} · {e.comuna}
          </h2>
          <p className="text-[13px] text-muted">
            {fmtDay(e.peak_time)}, {fmtHour(e.start)}
            {e.hours > 1 ? ` a ${fmtHour(e.end)}` : ""} · Región de {e.region}
          </p>
          {onStation && (
            <button onClick={onStation} className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-medium text-accent-soft hover:underline">
              <RadioTower size={12} /> Ver el registro de esta estación
            </button>
          )}
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-raised hover:text-ink" aria-label="Cerrar detalle">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-5 pt-4">
        <div className="grid grid-cols-3 gap-2">
          <Kpi label="Máximo en 1 hora" value={`${num(e.peak, 0)}`} hint={e.peak >= NORM ? `µg/m³ · ${num(e.peak / NORM, 1)} veces la norma` : `µg/m³ · ${num((e.peak / NORM) * 100, 0)} % de la norma`} />
          {e.peak >= NORM ? <Kpi label="Sobre la norma" value={`${e.hours_norm} h`} hint="horas con 350 o más" /> : <Kpi label="Duración" value={`${e.hours} h`} hint="horas con 150 o más" />}
          <Kpi label="Confianza" value={e.plateau ? "—" : `${e.confidence}`} hint={e.plateau ? "no se evalúa" : "de 100, criterio propio"} />
        </div>

        {e.peak < NORM && !e.plateau && (
          <p className="rounded-xl border border-line px-4 py-2.5 text-xs leading-snug text-ink-soft">
            No superó la norma vigente de 350 µg/m³. Se registra para ver qué fuentes se repiten, no como incumplimiento.
          </p>
        )}

        <div className={`rounded-xl px-4 py-3 ${v.found ? "bg-navy text-white" : "bg-ice text-ink"}`}>
          <div className="flex items-center gap-2 text-sm font-semibold">
            {!v.found && <AlertTriangle size={15} className="shrink-0" />} {v.short}
          </div>
          <p className={`mt-1 text-xs leading-snug ${v.found ? "text-white/80" : "text-ink-soft"}`}>{explain(e)}</p>
        </div>

        <section>
          <h3 className="text-[13px] font-semibold text-ink">SO₂ medido en la estación</h3>
          <p className="text-[11px] text-muted">12 horas antes y después del máximo · µg/m³</p>
          <div className="mt-2 h-40">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={e.series} margin={{ left: -18, right: 8, top: 8 }}>
                <CartesianGrid stroke={chart.grid} vertical={false} />
                <XAxis dataKey="t" tick={chart.tick} interval={5} tickFormatter={(t) => String(t).slice(11, 16)} />
                <YAxis tick={chart.tick} domain={[0, (max: number) => Math.max(400, Math.ceil(max / 100) * 100)]} />
                <Tooltip contentStyle={chart.tooltip} labelFormatter={(t) => `${fmtDay(String(t))}, ${String(t).slice(11, 16)}`} formatter={(val) => [`${num(Number(val), 0)} µg/m³`, "SO₂"]} />
                <ReferenceLine y={NORM} stroke="var(--color-bad)" strokeDasharray="4 3" label={{ value: "norma 350", position: "insideTopRight", fontSize: 10, fill: "var(--color-bad)" }} />
                <Area type="monotone" dataKey="v" stroke={lv.color} strokeWidth={2} fill={lv.color} fillOpacity={0.18} connectNulls={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        {shown.length > 0 && (
          <section>
            <h3 className="text-[13px] font-semibold text-ink">Reparto del origen probable</h3>
            <ul className="mt-2 space-y-2.5">
              {shown.map((c) => (
                <li key={c.id}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-ink">{sourceName(c.name)}</span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{num(c.share, 0)} %</span>
                  </div>
                  <div className="relative mt-1 h-2 rounded-full bg-ice">
                    <div className="absolute inset-y-0 left-0 rounded-full bg-navy" style={{ width: `${c.share}%` }} />
                    <div className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded bg-cyan" style={{ left: `${c.share_lo}%`, width: `${Math.max(1, c.share_hi - c.share_lo)}%` }} />
                  </div>
                  <p className="mt-1 text-[11px] text-muted">
                    A {num(c.km, 1)} km al {compass(c.bearing)} · declara {num(c.so2_t_year, 0)} t de SO₂ al año · rango {num(c.share_lo, 0)}–{num(c.share_hi, 0)} %
                  </p>
                </li>
              ))}
              <li className="flex items-baseline justify-between gap-2 border-t border-line pt-2 text-[12px] text-muted">
                <span>Nivel habitual y fuentes no inventariadas</span>
                <span className="font-semibold tabular-nums text-ink-soft">{num(e.background_share, 0)} %</span>
              </li>
            </ul>
            {e.excess_factor != null && (
              <p className="mt-2 text-[11px] leading-snug text-muted">
                Para explicar el máximo medido, las fuentes señaladas tendrían que haber emitido unas {num(e.excess_factor, 0)} veces su promedio anual declarado.
                Es solo un orden de magnitud.
              </p>
            )}
          </section>
        )}

        {!v.found && !e.plateau && e.candidates.some((c) => c.share < 1 && c.km <= NEAR_KM) && (
          <section>
            <h3 className="text-[13px] font-semibold text-ink">Fuentes cercanas, fuera de la dirección del viento</h3>
            <ul className="mt-1.5 space-y-1 text-[12px] text-ink-soft">
              {e.candidates
                .filter((c) => c.share < 1 && c.km <= NEAR_KM)
                .slice(0, 3)
                .map((c) => (
                  <li key={c.id} className="flex justify-between gap-2">
                    <span className="truncate">{sourceName(c.name)}</span>
                    <span className="shrink-0 tabular-nums text-muted">
                      {num(c.km, 1)} km · {c.off_axis}° de desvío
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        )}

        {!v.found && !e.plateau && e.upwind.length > 0 && (
          <section>
            <h3 className="text-[13px] font-semibold text-ink">Qué había en la dirección del viento</h3>
            <p className="text-[11px] text-muted">Pistas para fiscalizar. No implica que hayan emitido.</p>
            <ul className="mt-1.5 space-y-1 text-[12px] text-ink-soft">
              {e.upwind.map((u) => (
                <li key={u.name + u.km} className="flex justify-between gap-2">
                  <span className="truncate">{sourceName(u.name)}</span>
                  <span className="shrink-0 tabular-nums text-muted">{num(u.km, 1)} km</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-xl border border-line px-4 py-3">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <Wind size={14} className="text-accent-soft" /> Viento en la hora del máximo
          </h3>
          <p className="mt-1 text-xs leading-snug text-ink-soft">
            Venía desde el {compass(e.wind_from)} ({e.wind_from}°) a {num(h0.u, 1)} m/s.{" "}
            {e.wind_source === "medido"
              ? "Medido en la misma estación."
              : e.wind_source === "vecina"
                ? `Esta estación no mide viento: se usó el medido en la estación ${e.wind_station}, a ${num(e.wind_km, 1)} km.`
                : "No hay viento medido en esta estación ni cerca: se usó un modelo (ERA5), menos preciso."}
          </p>
          <p className="mt-1 text-[11px] text-muted">En el mapa, el abanico celeste marca de dónde venía el aire y la línea punteada, su recorrido en las horas previas.</p>
        </section>

        {e.confidence_notes.length > 0 && (
          <section>
            <h3 className="text-[13px] font-semibold text-ink">{e.plateau ? "Por qué no se atribuye" : "Por qué la confianza no es mayor"}</h3>
            <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs leading-snug text-ink-soft">
              {e.confidence_notes.map((n) => (
                <li key={n}>{n[0].toUpperCase() + n.slice(1)}.</li>
              ))}
            </ul>
          </section>
        )}

        <p className="border-t border-line pt-3 text-[11px] leading-snug text-faint">
          Estación operada por {e.station_owner}. Dato {e.status} por la autoridad (SINCA). Este resultado ordena fuentes probables para orientar una fiscalización;
          no determina responsabilidades.
        </p>
      </div>
    </aside>
  );
}
