"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import PlumeCanvas from "./PlumeCanvas";
import { Card, Chip } from "./ui";
import { DECLARED_NAME, NO2_GRADIENT, type Mine, type WindData } from "@/lib/data";
import { chart } from "@/lib/chart";
import { num } from "@/lib/format";

const METHODS = [
  { key: "base", label: "Señal principal, sin usar el viento" },
  { key: "calm", label: "Solo días de poco viento" },
  { key: "updown", label: "A favor menos en contra del viento" },
  { key: "nox", label: "Toneladas de NOx estimadas" },
] as const;

/** Minimo de años confiables para mostrar la estimacion en toneladas. */
const MIN_RELIABLE_YEARS = 3;

export default function WindPanel({ mine, wind }: { mine: Mine; wind: WindData }) {
  const site = wind.sites[mine.id];
  if (!site) return <p className="text-sm text-muted">No hay datos de viento para esta zona.</p>;

  const rob = site.robustness.find((r) => r.declared === mine.stats.verdict.declared) ?? null;
  const values = rob ? METHODS.map((m) => rob[m.key]).filter((v): v is number => v != null) : [];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const stable = values.length > 1 && hi - lo <= 0.25;

  const threshold = wind.noise_floor_tpd * 1.5;
  const nox = Object.entries(site.annual)
    .filter(([, v]) => v.nox_tpd != null)
    .map(([y, v]) => ({ y, t: v.nox_tpd as number, ok: !!v.reliable }));
  const reliable = nox.filter((d) => d.ok);
  const belowNoise = nox.filter((d) => d.t <= threshold).length > nox.length / 2;
  const days = Object.values(site.monthly).reduce((s, m) => s + (m.days ?? 0), 0);

  return (
    <div className="space-y-3">
      <Card>
        <h3 className="text-sm font-semibold text-ink">¿Cambia el resultado según cómo se trate el viento?</h3>
        {rob ? (
          <>
            <p className="mt-0.5 text-[11px] text-muted">
              Coincidencia con lo declarado ({DECLARED_NAME[rob.declared] ?? rob.declared}, {rob.n} años), calculada de cuatro formas.
            </p>
            <ul className="mt-3 space-y-2">
              {METHODS.map((m) => {
                const v = rob[m.key];
                return (
                  <li key={m.key} className="grid grid-cols-[1fr_7rem_2.5rem] items-center gap-2 text-xs">
                    <span className="text-ink-soft">{m.label}</span>
                    <span className="relative h-2 rounded-full bg-line">
                      <span className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
                      {v != null && (
                        <span
                          className={`absolute inset-y-0 rounded-full ${v >= 0 ? "bg-obs" : "bg-bad"}`}
                          style={{ left: `${v >= 0 ? 50 : 50 + v * 50}%`, width: `${Math.abs(v) * 50}%` }}
                        />
                      )}
                    </span>
                    <span className="text-right font-semibold tabular-nums text-ink">{num(v)}</span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex items-start gap-2 text-[11px] leading-snug text-muted">
              <Chip tone={stable ? "ok" : "warn"}>{stable ? "Resultado estable" : "Resultado inestable"}</Chip>
              <span>
                {stable
                  ? `Va de ${num(lo)} a ${num(hi)}: la conclusión no depende de cómo se trate el viento.`
                  : `Va de ${num(lo)} a ${num(hi)} según el método: conviene tomarlo con cautela.`}
              </span>
            </div>
          </>
        ) : (
          <p className="mt-1 text-xs leading-snug text-muted">Esta prueba necesita una serie declarada de al menos 5 años, y esta zona no la tiene.</p>
        )}
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-ink">Pluma promedio alineada con el viento</h3>
        <p className="mt-0.5 text-[11px] leading-snug text-muted">
          Cada día se gira la imagen para que el viento sople hacia la derecha y se promedian {num(days, 0)} días. Si el NO₂ sale de la mina, la mancha nace en
          el centro y se alarga a la derecha.
        </p>
        <div className="mt-3">
          <PlumeCanvas grid={site.plume} xs={wind.xs_km} />
        </div>
        <div className="mt-2 h-1.5 rounded-full" style={{ background: NO2_GRADIENT }} />
        <div className="mt-1 flex justify-between text-[10px] text-faint">
          <span>menos NO₂</span>
          <span>escala propia de esta zona</span>
          <span>más NO₂</span>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">Toneladas de NOx por día</h3>
          <Chip tone="info">Estimación experimental</Chip>
        </div>
        {reliable.length >= MIN_RELIABLE_YEARS ? (
          <>
            <div className="mt-3 h-36">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={reliable} margin={{ left: -22, right: 6, top: 6 }}>
                  <CartesianGrid stroke={chart.grid} vertical={false} />
                  <XAxis dataKey="y" tick={chart.tick} />
                  <YAxis tick={chart.tick} domain={[0, "auto"]} />
                  <Tooltip cursor={{ fill: "var(--color-line)" }} contentStyle={chart.tooltip} formatter={(v) => [`${num(Number(v), 1)} t/día`, "NOx"]} />
                  <ReferenceLine y={threshold} stroke="var(--color-faint)" strokeDasharray="4 3" />
                  <Bar dataKey="t" fill={chart.obs} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-muted">
              Se ajusta la forma de la pluma y se multiplica por la velocidad del viento. La línea punteada ({num(threshold, 0)} t/día) es el umbral de ruido:
              un sitio de desierto sin fuentes llega a dar {num(wind.noise_floor_tpd, 0)} t/día.
            </p>
          </>
        ) : (
          <p className="mt-2 text-xs leading-snug text-muted">
            No estimable con confianza en esta zona:{" "}
            {belowNoise
              ? `la señal queda bajo el umbral de ruido (${num(threshold, 0)} t/día).`
              : "la pluma no se ajusta a una sola fuente (ajuste pobre o tiempo de permanencia del gas poco creíble)."}{" "}
            Se prefiere no mostrar una cifra antes que mostrar una dudosa.
          </p>
        )}
      </Card>

      <p className="px-1 text-[10.5px] leading-snug text-faint">Viento: {wind.rules.source}.</p>
    </div>
  );
}
