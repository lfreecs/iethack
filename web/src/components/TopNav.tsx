import Image from "next/image";
import Link from "next/link";

const LINKS = [
  { href: "/", key: "mapa", label: "Mapa", short: "Mapa" },
  { href: "/historial", key: "historial", label: "Registro histórico", short: "Registro" },
  { href: "/metodo", key: "metodo", label: "Método y límites", short: "Método" },
] as const;

type Props = { active: (typeof LINKS)[number]["key"] };

/** Barra superior comun a todas las pantallas. */
export default function TopNav({ active }: Props) {
  return (
    <header className="z-20 flex shrink-0 items-center justify-between gap-3 border-b border-line bg-panel px-3 py-2.5 sm:px-6 sm:py-3">
      <Link href="/" className="flex min-w-0 items-center gap-2.5 sm:gap-3">
        <Image src="/logo.png" alt="" width={40} height={40} unoptimized priority className="size-9 shrink-0 sm:size-10" />
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold leading-tight tracking-tight text-ink">4GAS</span>
          <span className="hidden text-[11px] text-muted md:block">Alerta y atribución de episodios de dióxido de azufre · norte de Chile</span>
        </span>
      </Link>
      <nav className="flex shrink-0 gap-1 rounded-xl bg-raised p-1 text-[13px]">
        {LINKS.map((l) => (
          <Link
            key={l.key}
            href={l.href}
            aria-current={active === l.key ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 font-medium transition-colors sm:px-3.5 ${active === l.key ? "bg-navy text-white shadow-sm" : "text-ink-soft hover:bg-ice"}`}
          >
            <span className="sm:hidden">{l.short}</span>
            <span className="hidden sm:inline">{l.label}</span>
          </Link>
        ))}
      </nav>
    </header>
  );
}
