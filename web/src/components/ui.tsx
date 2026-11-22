import type { ReactNode } from "react";
import type { Tone } from "@/lib/data";

const CHIP: Record<Tone, string> = {
  ok: "bg-ok/10 text-ok ring-ok/35",
  warn: "bg-warn/10 text-warn ring-warn/35",
  bad: "bg-bad/10 text-bad ring-bad/35",
  info: "bg-info/10 text-info ring-info/35",
  muted: "bg-muted/10 text-muted ring-muted/30",
};
const DOT: Record<Tone, string> = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", info: "bg-info", muted: "bg-faint" };
export const TONE_TEXT: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad", info: "text-info", muted: "text-muted" };

export function Chip({ tone = "muted", title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <span title={title} className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${CHIP[tone]}`}>
      {children}
    </span>
  );
}

export function Dot({ tone }: { tone: Tone }) {
  return <span className={`inline-block size-2 shrink-0 rounded-full ${DOT[tone]}`} />;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-raised/60 px-3 py-2.5">
      <div className="text-[11px] leading-tight text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-[10.5px] leading-tight text-faint">{hint}</div>}
    </div>
  );
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-xl border border-line bg-raised/50 p-3.5 ${className}`}>{children}</div>;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string }[] }) {
  return (
    <div role="tablist" className="flex gap-1 rounded-xl border border-line bg-panel p-1 text-[13px]">
      {items.map((it) => (
        <button
          key={it.id}
          role="tab"
          aria-selected={value === it.id}
          onClick={() => onChange(it.id)}
          className={`flex-1 rounded-lg px-2 py-1.5 font-medium transition-colors ${value === it.id ? "bg-raised text-ink ring-1 ring-line-strong" : "text-muted hover:text-ink-soft"}`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
