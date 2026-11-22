"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeft, Download, FileUp, Lock, Sparkles } from "lucide-react";
import { annualExcess, excessMap, loadIndex, pearson, toIndex, type IndexData } from "@/lib/data";

type Row = { period: string; value: number };

function normPeriod(v: unknown): string | null {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}`;
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{4})$/);
  if (m) return m[1];
  return null;
}

function toNumber(v: unknown) {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim().replace(/\s/g, "");
  const n = Number(s.includes(",") && !s.includes(".") ? s.replace(",", ".") : s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

function parseRows(table: unknown[][]): Row[] {
  const rows: Row[] = [];
  for (const r of table) {
    if (!r || r.length < 2) continue;
    const p = normPeriod(r[0]);
    const v = toNumber(r[1]);
    if (p && Number.isFinite(v)) rows.push({ period: p, value: v });
  }
  return rows;
}

export default function Verificar() {
  const [data, setData] = useState<IndexData | null>(null);
  const [mineId, setMineId] = useState("centinela");
  const [metric, setMetric] = useState("Diésel (m³ o GJ)");
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [err, setErr] = useState("");
  const [report, setReport] = useState<{ text: string; source: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadIndex().then((d) => {
      setData(d);
      const q = new URLSearchParams(window.location.search).get("mina");
      if (q && d.mines.some((m) => m.id === q)) setMineId(q);
    });
  }, []);

  const mine = data?.mines.find((m) => m.id === mineId);

  const comparison = useMemo(() => {
    if (!mine || !rows.length) return null;
    const monthly = rows[0].period.length === 7;
    const obs = monthly ? excessMap(mine) : annualExcess(mine);
    const decl = Object.fromEntries(rows.map((r) => [r.period, r.value]));
    const periods = rows.map((r) => r.period).filter((p) => p in obs).sort();
    if (periods.length < 3) return { periods, chart: [], r: null, monthly };
    const oi = toIndex(periods, obs as Record<string, number>);
    const di = toIndex(periods, decl);
    return {
      monthly,
      periods,
      r: pearson(periods.map((p) => (obs as Record<string, number>)[p]), periods.map((p) => decl[p])),
      chart: periods.map((p) => ({ p, observado: oi[p], declarado: di[p], brecha: oi[p] - di[p] })),
    };
  }, [mine, rows]);

  async function onFile(f: File) {
    setErr("");
    setReport(null);
    setFileName(f.name);
    try {
      let table: unknown[][];
      if (f.name.toLowerCase().endsWith(".csv")) {
        const text = await f.text();
        const sep = text.split("\n")[0].includes(";") ? ";" : ",";
        table = text.split(/\r?\n/).map((l) => l.split(sep));
      } else {
        const { readSheet } = await import("read-excel-file/browser");
        table = (await readSheet(f)) as unknown[][];
      }
      const parsed = parseRows(table);
      if (!parsed.length) throw new Error("No se encontraron filas con periodo y valor.");
      setRows(parsed);
    } catch (e) {
      setRows([]);
      setErr(String(e instanceof Error ? e.message : e));
    }
  }

  async function analyze() {
    if (!comparison || !mine) return;
    setLoading(true);
    try {
      const res = await fetch("/api/informe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mineId: mine.id,
          uploaded: { metric, r: comparison.r, rows: comparison.chart.map((c) => ({ period: c.p, declared: +c.declarado.toFixed(1), observed: +c.observado.toFixed(1) })) },
        }),
      });
      setReport(await res.json());
    } finally {
      setLoading(false);
    }
  }

  const biggest = comparison?.chart?.length ? [...comparison.chart].sort((a, b) => Math.abs(b.brecha) - Math.abs(a.brecha))[0] : null;

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <Link href="/" className="flex items-center gap-2 text-sm text-slate-400 hover:text-white"><ArrowLeft size={16} /> Volver al mapa</Link>
      <h1 className="mt-4 text-2xl font-semibold">Verificar datos de una empresa</h1>
      <p className="mt-1 text-slate-400">Sube el consumo de diésel o las emisiones de una mina y compáralos con lo que ve el satélite.</p>
      <p className="mt-2 flex items-center gap-2 text-xs text-emerald-300"><Lock size={13} /> El archivo se procesa solo en este navegador; no se envía a ningún servidor (salvo los números agregados si pides el informe con IA).</p>

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <label className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
          <span className="text-slate-400">1. Mina</span>
          <select value={mineId} onChange={(e) => setMineId(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-2">
            {data?.mines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
          <span className="text-slate-400">2. Qué contiene el archivo</span>
          <select value={metric} onChange={(e) => setMetric(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-2">
            <option>Diésel (m³ o GJ)</option>
            <option>Emisiones directas (t CO₂e)</option>
            <option>Material movido (t)</option>
            <option>Horas de operación de camiones</option>
          </select>
        </label>
        <label className="flex cursor-pointer flex-col justify-between rounded-xl border border-dashed border-amber-500/50 bg-amber-500/5 p-4 text-sm hover:bg-amber-500/10">
          <span className="text-slate-400">3. Archivo CSV o Excel</span>
          <span className="mt-2 flex items-center gap-2 font-medium text-amber-300"><FileUp size={16} /> {fileName || "Elegir archivo"}</span>
          <input type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
      </section>
      <p className="mt-2 text-xs text-slate-500">
        Formato: primera columna = periodo (AAAA o AAAA-MM), segunda columna = valor. <a className="inline-flex items-center gap-1 text-amber-300 underline" href="/plantilla_verificacion.csv" download><Download size={12} /> Descargar plantilla</a>
      </p>
      {err && <p className="mt-3 text-sm text-rose-300">{err}</p>}

      {comparison && (
        <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
          {comparison.chart.length === 0 ? (
            <p className="text-sm text-slate-400">Se necesitan al menos 3 periodos que coincidan con la serie satelital (2018–2026).</p>
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{mine?.name}: {metric} vs NO₂ observado</h2>
                  <p className="text-xs text-slate-500">Índice 100 = primer periodo común · {comparison.periods.length} periodos {comparison.monthly ? "mensuales" : "anuales"}</p>
                </div>
                <div className="flex gap-3 text-center">
                  <div className="rounded-xl border border-slate-800 px-4 py-2"><div className="text-xl font-semibold text-amber-300">{comparison.r == null ? "—" : comparison.r.toFixed(2)}</div><div className="text-[11px] text-slate-400">correlación</div></div>
                  {biggest && <div className="rounded-xl border border-slate-800 px-4 py-2"><div className="text-xl font-semibold text-rose-300">{biggest.brecha > 0 ? "+" : ""}{biggest.brecha.toFixed(0)} pts</div><div className="text-[11px] text-slate-400">mayor brecha ({biggest.p})</div></div>}
                </div>
              </div>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={comparison.chart} margin={{ left: -10, right: 10, top: 6 }}>
                    <CartesianGrid stroke="#1e293b" />
                    <XAxis dataKey="p" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} domain={["auto", "auto"]} />
                    <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", fontSize: 12 }} formatter={(v) => (typeof v === "number" ? v.toFixed(0) : v)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="observado" name="NO₂ observado" stroke="#f59e0b" strokeWidth={2} />
                    <Line type="monotone" dataKey="declarado" name="Dato de la empresa" stroke="#a78bfa" strokeWidth={2} strokeDasharray="4 3" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <button onClick={analyze} disabled={loading} className="mt-4 flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-60">
                <Sparkles size={16} /> {loading ? "Analizando…" : "Generar informe de verificación con IA"}
              </button>
              {report && <div className="mt-4 whitespace-pre-wrap rounded-xl border border-slate-700 bg-slate-950/70 p-4 text-sm leading-relaxed">{report.text}</div>}
            </>
          )}
        </section>
      )}
    </main>
  );
}
