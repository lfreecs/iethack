/* eslint-disable @typescript-eslint/no-explicit-any */
import { promises as fs } from "fs";
import path from "path";

type Body = { mineId: string; uploaded?: { metric: string; rows: { period: string; declared: number; observed: number }[]; r: number | null } };

const CACHE_DIR = path.join(process.cwd(), "..", "data", "informes");

async function readIndex() {
  const raw = await fs.readFile(path.join(process.cwd(), "public", "data", "index.json"), "utf8");
  return JSON.parse(raw);
}

function annual(monthly: Record<string, { excess: number }>, fyEnd?: number) {
  const acc: Record<string, number[]> = {};
  for (const [m, v] of Object.entries(monthly)) {
    const y = Number(m.slice(0, 4));
    const mo = Number(m.slice(5, 7));
    const k = String(fyEnd ? (mo > fyEnd ? y + 1 : y) : y);
    (acc[k] ||= []).push(v.excess);
  }
  return Object.fromEntries(Object.entries(acc).filter(([, v]) => v.length >= 8).map(([k, v]) => [k, +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3)]));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildFacts(index: any, mine: any, uploaded?: Body["uploaded"]) {
  const declared = Object.entries(mine.declared_data || {}).map(([k, d]: [string, any]) => ({
    id: k, company: d.company, frequency: d.frequency, source: d.source?.doc, note: d.source?.note,
    observed_annual_excess: annual(mine.monthly, d.fiscal_year_end_month), series: d.series,
  }));
  return {
    mina: mine.name, empresa: mine.company, nota: mine.note ?? null,
    unidad_senal: index.units, metodo: `exceso de NO2 = promedio en ${index.core_km} km alrededor de la mina menos mediana del anillo ${index.ring_km[0]}-${index.ring_km[1]} km`,
    senal_anual_calendario: annual(mine.monthly),
    correlacion_mensual_con_produccion: mine.stats?.r_production_monthly,
    comparaciones_con_declarado: mine.stats?.comparisons,
    declarado: declared,
    datos_subidos_por_la_empresa: uploaded ?? null,
  };
}

function fallbackText(facts: ReturnType<typeof buildFacts>) {
  const years = Object.entries(facts.senal_anual_calendario);
  const first = years[0];
  const last = years.at(-1);
  const change = first && last ? ((Number(last[1]) / Number(first[1]) - 1) * 100).toFixed(0) : "—";
  return [
    `Resumen automático para ${facts.mina} (${facts.empresa}).`,
    first && last ? `La señal de NO₂ sobre la mina pasó de ${first[1]} (${first[0]}) a ${last[1]} (${last[0]}) ${facts.unidad_senal}, un cambio de ${change} %.` : "",
    facts.comparaciones_con_declarado?.length
      ? `Comparación con lo declarado: ${facts.comparaciones_con_declarado.map((c: any) => `${c.metric} r=${c.r == null ? "—" : c.r.toFixed(2)} con ${c.n} años`).join("; ")}.`
      : "No hay datos declarados por mina para comparar.",
    facts.nota ? `Precaución: ${facts.nota}` : "",
    "El NO₂ es un indicador de actividad diésel, no una medición de CO₂. Use estos resultados para decidir dónde revisar, no como auditoría.",
  ].filter(Boolean).join("\n\n");
}

export async function POST(request: Request) {
  const body = (await request.json()) as Body;
  const index = await readIndex();
  const mine = index.mines.find((m: { id: string }) => m.id === body.mineId);
  if (!mine) return Response.json({ text: "Mina no encontrada.", source: "error" }, { status: 404 });
  const facts = buildFacts(index, mine, body.uploaded);
  const cacheFile = path.join(CACHE_DIR, `${mine.id}${body.uploaded ? "-subido" : ""}.json`);

  const base = process.env.OPENAI_BASE_URL;
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "anthropic/claude-sonnet-5.5";
  if (base && key) {
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 700,
          messages: [
            {
              role: "system",
              content:
                "Eres un analista de verificación ambiental para la minería chilena. Escribes en español claro, para un banco, una auditora o el Estado. " +
                "Reglas: usa SOLO los números del JSON entregado; no inventes causas ni cifras; el NO2 satelital es un indicador de actividad diésel (camiones y maquinaria), no mide CO2; " +
                "si las series van en direcciones distintas, descríbelo como una diferencia que conviene revisar, nunca como incumplimiento; menciona las limitaciones que aparezcan en 'nota'. " +
                "Formato: 4 secciones breves con títulos: 'Lo que muestra el satélite', 'Comparación con lo declarado', 'Precauciones', 'Qué revisar'. Máximo 220 palabras.",
            },
            { role: "user", content: JSON.stringify(facts) },
          ],
        }),
        signal: AbortSignal.timeout(45000),
      });
      if (res.ok) {
        const json = await res.json();
        const text: string = json.choices?.[0]?.message?.content ?? "";
        if (text) {
          await fs.mkdir(CACHE_DIR, { recursive: true });
          await fs.writeFile(cacheFile, JSON.stringify({ text, date: new Date().toISOString() }), "utf8");
          return Response.json({ text, source: "ia" });
        }
      }
    } catch {
      // se usa el respaldo
    }
  }
  try {
    const cached = JSON.parse(await fs.readFile(cacheFile, "utf8"));
    return Response.json({ text: cached.text, source: "cache" });
  } catch {
    return Response.json({ text: fallbackText(facts), source: "respaldo" });
  }
}
