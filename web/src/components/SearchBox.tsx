"use client";

import { useMemo, useRef, useState } from "react";
import { Factory, MapPin, Pickaxe, RadioTower, Search, X, type LucideIcon } from "lucide-react";
import { placeKind, placeName, searchPlaces, type Place } from "@/lib/episodes";

const ICON: Record<Place["kind"], LucideIcon> = { mina: Pickaxe, fuente: Factory, estación: RadioTower, localidad: MapPin };

type Props = {
  places: Place[];
  query: string;
  onQuery: (q: string) => void;
  onPick: (p: Place) => void;
  onClear: () => void;
};

/** Buscador de minas, fuentes, estaciones y localidades. Al elegir un resultado, el mapa vuela hasta ese lugar. */
export default function SearchBox({ places, query, onQuery, onPick, onClear }: Props) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchPlaces(places, query), [places, query]);
  const showList = open && query.trim().length >= 2;

  const pick = (p: Place) => {
    onPick(p);
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="relative">
      <div className="flex h-11 items-center gap-2 rounded-xl border border-line bg-panel px-3 shadow-xl focus-within:border-cyan focus-within:ring-2 focus-within:ring-cyan/30">
        <Search size={16} className="shrink-0 text-muted" />
        <input
          ref={inputRef}
          value={query}
          placeholder="Buscar una mina, fundición o localidad"
          aria-label="Buscar un lugar"
          role="combobox"
          aria-expanded={showList}
          aria-controls="resultados-busqueda"
          autoComplete="off"
          onChange={(e) => {
            onQuery(e.target.value);
            setOpen(true);
            setHi(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHi((h) => Math.min(h + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHi((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter" && results[hi]) pick(results[hi]);
            else if (e.key === "Escape") inputRef.current?.blur();
          }}
          className="min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-faint lg:text-[13.5px]"
        />
        {query && (
          <button onMouseDown={(e) => e.preventDefault()} onClick={onClear} aria-label="Borrar la búsqueda" className="rounded-md p-1 text-muted hover:bg-raised hover:text-ink">
            <X size={15} />
          </button>
        )}
      </div>

      {showList && (
        <ul id="resultados-busqueda" role="listbox" className="absolute inset-x-0 top-12 z-30 max-h-80 overflow-y-auto rounded-xl border border-line bg-panel p-1 shadow-xl">
          {results.length === 0 ? (
            <li className="px-3 py-3 text-[12.5px] leading-snug text-muted">
              No encontramos ese lugar. Prueba con el nombre de una mina, una fundición, una estación o una ciudad del norte.
            </li>
          ) : (
            results.map((p, i) => {
              const Icon = ICON[p.kind];
              return (
                <li key={p.id} role="option" aria-selected={i === hi}>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(p)}
                    onMouseEnter={() => setHi(i)}
                    className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left ${i === hi ? "bg-ice" : ""}`}
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-raised text-accent-soft">
                      <Icon size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{placeName(p)}</span>
                      <span className="block truncate text-[11px] text-muted">{p.sub}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-raised px-2 py-0.5 text-[10px] font-medium text-muted">{placeKind(p)}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
