import { useSyncExternalStore } from "react";

/** true cuando la pantalla cumple la consulta de medios (por ejemplo, "(max-width: 1023px)"). En el servidor siempre es false. */
export function useMedia(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Pantallas angostas (telefonos y tablets en vertical): los paneles pasan a ser hojas que suben desde abajo. */
export const NARROW = "(max-width: 1023px)";
