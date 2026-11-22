import Link from "next/link";
import { Wind } from "lucide-react";

const LINKS = [
  { href: "/", key: "mapa", label: "Mapa" },
  { href: "/historial", key: "historial", label: "Registro histórico" },
  { href: "/metodo", key: "metodo", label: "Método y límites" },
] as const;

type Props = { active: (typeof LINKS)[number]["key"] };

/** Barra superior comun a todas las pantallas. */
export default function TopNav({ active }: Props) {
  return (
    <header className="z-20 flex shrink-0 items-center justify-between gap-4 border-b border-line bg-panel px-6 py-3">
      <Link href="/" className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-xl bg-navy text-cyan">
          <Wind size={18} />
        </span>
        <span>
          <span className="block text-[15px] font-semibold leading-tight tracking-tight text-ink">Origen SO₂</span>
          <span className="block text-[11px] text-muted">Alerta y atribución de episodios de dióxido de azufre · norte de Chile</span>
        </span>
      </Link>
      <nav className="flex gap-1 rounded-xl bg-raised p-1 text-[13px]">
        {LINKS.map((l) => (
          <Link
            key={l.key}
            href={l.href}
            aria-current={active === l.key ? "page" : undefined}
            className={`rounded-lg px-3.5 py-1.5 font-medium transition-colors ${active === l.key ? "bg-navy text-white shadow-sm" : "text-ink-soft hover:bg-ice"}`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
