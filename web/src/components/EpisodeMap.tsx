"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GeoJSONSource, LayerSpecification, Map as MLMap, MapLayerMouseEvent, Marker, Popup, SourceSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { LEVELS, NEAR_KM, destination, distanceKm, levelOf, type Attribution, type Episode, type LevelKey, type Place } from "@/lib/episodes";

type Props = {
  data: Attribution;
  /** Episodios a la vista (ya filtrados por nivel y periodo), del mas grave al menos grave. */
  events: Episode[];
  selected: Episode | null;
  place: Place | null;
  places: Place[];
  /** Ancho en px que ocupa el panel izquierdo: el mapa centra lo que muestra en el espacio que queda libre. */
  leftInset: number;
  onSelect: (id: string) => void;
  onPlace: (p: Place) => void;
};

type Pad = { top: number; bottom: number; left: number; right: number };

const DEM_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const ORDER: LevelKey[] = ["emergencia", "preemergencia", "alerta", "norma", "propuesta", "alza", "plana"];
const HALF_CONE = { medido: 12, vecina: 18, modelo: 28 } as const;
/** Espacio que ocupan la ficha derecha, el buscador (arriba) y la barra de filtros (abajo), con sus margenes. */
const SHEET_W = 472;
const TOP_H = 76;
const DOCK_H = 200;
/** Nombres cortos de las fuentes mas grandes, para las etiquetas del mapa. */
const SHORT: Record<string, string> = {
  "DIVISIÓN CHUQUICAMATA": "Fundición Chuquicamata",
  "FUNDICION ALTONORTE": "Fundición Altonorte",
  "DIVISION SALVADOR POTRERILLOS": "Fundición Potrerillos",
  "FUNDICION HERNAN VIDELA LIRA": "Fundición Paipote (detenida en 2024)",
  GUACOLDA: "Termoeléctrica Guacolda",
  "CENTRAL TERMOELÉCTRICA ANGAMOS": "Termoeléctricas de Mejillones",
  "CENTRAL TERMOELÉCTRICA NUEVA TOCOPILLA": "Termoeléctricas de Tocopilla",
};

/** El sombreado del relieve es lo unico que necesita internet; el resto del mapa esta guardado en /data. */
async function hasInternet() {
  try {
    await fetch(DEM_TILES.replace("{z}/{x}/{y}", "5/9/17"), { mode: "no-cors", cache: "no-store", signal: AbortSignal.timeout(2500) });
    return true;
  } catch {
    return false;
  }
}

async function localCities() {
  try {
    const base = (await (await fetch("/data/base.geojson")).json()) as GeoJSON.FeatureCollection;
    return base.features.flatMap((f) =>
      f.geometry.type === "Point" && f.properties?.kind === "city" ? [{ name: String(f.properties.name), at: f.geometry.coordinates as [number, number] }] : [],
    );
  } catch {
    return [];
  }
}

const points = <T extends { lat: number; lon: number }>(items: T[], props: (x: T) => Record<string, string | number | boolean>): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features: items.map((x) => ({ type: "Feature", properties: props(x), geometry: { type: "Point", coordinates: [x.lon, x.lat] } })),
});

const polygon = (ring: [number, number][]): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }],
});

/** Alcance del cono: lo que recorre el aire en 4 horas, entre 6 y 45 km. */
const reachKm = (e: Episode) => Math.min(45, Math.max(6, e.wind.slice(0, 4).reduce((s, h) => s + h.u * 3.6, 0)));

/** Cono de origen: sector hacia donde venia el viento, con la incertidumbre de su direccion. */
function cone(e: Episode) {
  const half = HALF_CONE[e.wind_source];
  const ring: [number, number][] = [[e.lon, e.lat]];
  for (let a = -half; a <= half; a += 2) ring.push(destination(e.lat, e.lon, e.wind_from + a, reachKm(e)));
  ring.push([e.lon, e.lat]);
  return polygon(ring);
}

/** Circulo de radio km alrededor de un punto. */
function circle(lat: number, lon: number, km: number) {
  const ring: [number, number][] = [];
  for (let b = 0; b <= 360; b += 6) ring.push(destination(lat, lon, b, km));
  return polygon(ring);
}

/** Centro y zoom con que un conjunto de puntos cabe en el espacio libre del mapa (Mercator, teselas de 512 px). */
function frame(pts: [number, number][], width: number, height: number, pad: Pad, maxZoom: number) {
  const rad = Math.PI / 180;
  const xs = pts.map((p) => (p[0] + 180) / 360);
  const ys = pts.map((p) => (1 - Math.log(Math.tan(p[1] * rad) + 1 / Math.cos(p[1] * rad)) / Math.PI) / 2);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const w = Math.max(160, width - pad.left - pad.right - 90);
  const h = Math.max(160, height - pad.top - pad.bottom - 90);
  const zoom = Math.min(maxZoom, Math.log2(Math.min(w / Math.max(x1 - x0, 1e-9), h / Math.max(y1 - y0, 1e-9)) / 512));
  const lat = Math.atan(Math.sinh(Math.PI * (1 - (y0 + y1)))) / rad;
  return { center: [((x0 + x1) / 2) * 360 - 180, lat] as [number, number], zoom };
}

/** Estacion con episodios a la vista; first es el episodio que se abre al elegirla. */
type Group = { code: string; name: string; comuna: string; lat: number; lon: number; mine: Episode[]; first: string; worst: LevelKey };
/** Circulo del mapa: una estacion, o varias que en pantalla quedarian encimadas. */
type Blob = { x: number; y: number; n: number; groups: Group[]; solo: boolean };
type Label = { el: HTMLElement; marker: Marker; at: [number, number]; kind: "src" | "city"; spot: number };

const MAX_ZOOM = 13;
/** Diametro en px del circulo segun cuantos episodios reune. */
const sizeOf = (n: number) => Math.round(Math.min(44, 26 + 7 * Math.log10(n)));
const worstOf = (levels: LevelKey[]) => ORDER.find((k) => levels.includes(k)) ?? "plana";

/** Junta las estaciones cuyos circulos se tocarian en pantalla, partiendo por las mas cercanas. La estacion elegida queda siempre sola. */
function cluster(groups: Group[], project: (g: Group) => { x: number; y: number }, keep?: string): Blob[] {
  const blobs = groups.map((g): Blob => {
    const p = project(g);
    return { x: p.x, y: p.y, n: g.mine.length, groups: [g], solo: g.code === keep };
  });
  for (;;) {
    let pair: [number, number] | null = null;
    let near = Infinity;
    for (let i = 0; i < blobs.length; i++)
      for (let j = i + 1; j < blobs.length; j++) {
        const [a, b] = [blobs[i], blobs[j]];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (!a.solo && !b.solo && d < near && d < (sizeOf(a.n) + sizeOf(b.n)) / 2 + 14) [pair, near] = [[i, j], d];
      }
    if (!pair) return blobs;
    const [a, b] = [blobs[pair[0]], blobs[pair[1]]];
    const n = a.n + b.n;
    blobs[pair[0]] = { x: (a.x * a.n + b.x * b.n) / n, y: (a.y * a.n + b.y * b.n) / n, n, groups: [...a.groups, ...b.groups], solo: false };
    blobs.splice(pair[1], 1);
  }
}

export default function EpisodeMap({ data, events, selected, place, places, leftInset, onSelect, onPlace }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const libRef = useRef<typeof import("maplibre-gl") | null>(null);
  const clouds = useRef<Record<string, { el: HTMLElement; marker: Marker }>>({});
  const labels = useRef<Label[]>([]);
  const view = useRef<{ groups: Group[]; selected: Episode | null }>({ groups: [], selected: null });
  const popup = useRef<Popup | null>(null);
  const shareMarkers = useRef<Marker[]>([]);
  const pin = useRef<Marker | null>(null);
  const live = useRef({ onSelect, onPlace, places, leftInset });
  const [loaded, setLoaded] = useState(0); // aumenta cada vez que el estilo de un mapa queda listo

  useEffect(() => {
    live.current = { onSelect, onPlace, places, leftInset };
  }, [onSelect, onPlace, places, leftInset]);

  // Circulos y etiquetas: se recalculan cuando cambian los episodios a la vista, el elegido o el zoom
  const layout = useCallback(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib) return;
    const { groups, selected: sel } = view.current;

    // clic en un grupo: acerca hasta separar sus estaciones; si estan casi en el mismo punto, las lista para elegir
    const openGroup = (members: Group[]) => {
      popup.current?.remove();
      const box = map.getContainer();
      const p = map.getPadding();
      const pad: Pad = { top: p.top ?? 0, bottom: p.bottom ?? 0, left: p.left ?? 0, right: p.right ?? 0 };
      const target = frame(members.map((g): [number, number] => [g.lon, g.lat]), box.clientWidth, box.clientHeight, pad, MAX_ZOOM);
      if (target.zoom > map.getZoom() + 0.3) {
        map.flyTo({ ...target, duration: 900, essential: true });
        return;
      }
      const node = document.createElement("div");
      node.className = "group-pop";
      node.innerHTML = `<p>${members.length} estaciones en el mismo lugar</p>`;
      for (const g of members) {
        const row = document.createElement("button");
        row.style.setProperty("--c", LEVELS[g.worst].color);
        row.innerHTML = "<i></i><span></span><b></b>";
        row.children[1].textContent = `${g.name} · ${g.comuna}`;
        row.children[2].textContent = String(g.mine.length);
        row.onclick = () => {
          popup.current?.remove();
          live.current.onSelect(g.first);
        };
        node.append(row);
      }
      popup.current = new lib.Popup({ offset: 26, closeButton: false, maxWidth: "300px" }).setLngLat([members[0].lon, members[0].lat]).setDOMContent(node).addTo(map);
    };

    const blobs = cluster(groups, (g) => map.project([g.lon, g.lat]), sel?.code);
    const seen = new Set<string>();
    for (const b of blobs) {
      const worst = worstOf(b.groups.map((g) => g.worst));
      const key = `${b.groups.map((g) => g.code).sort().join("|")}:${b.n}:${worst}`;
      seen.add(key);
      if (!clouds.current[key]) {
        const members = [...b.groups].sort((x, y) => ORDER.indexOf(x.worst) - ORDER.indexOf(y.worst) || y.mine.length - x.mine.length);
        const many = members.length > 1;
        const el = document.createElement("button");
        el.className = `cloud${many ? " is-group" : ""}${worst === "plana" ? " is-flat" : ""}`;
        el.style.setProperty("--c", LEVELS[worst].color);
        el.style.setProperty("--ink", LEVELS[worst].ink);
        el.style.setProperty("--d", `${sizeOf(b.n)}px`);
        const count = `${b.n} ${b.n === 1 ? "episodio" : "episodios"} a la vista`;
        el.title = many
          ? `${members.length} estaciones cercanas (${[...new Set(members.map((g) => g.comuna))].join(", ")}): ${count}. Haz clic para acercar.`
          : `${members[0].name} (${members[0].comuna}): ${count}`;
        el.setAttribute("aria-label", el.title);
        el.innerHTML = `<i></i><b>${b.n}</b>`;
        el.onclick = (ev) => {
          ev.stopPropagation(); // sin esto el clic llega al mapa, que cierra la lista recien abierta
          if (many) openGroup(members);
          else live.current.onSelect(members[0].first);
        };
        clouds.current[key] = { el, marker: new lib.Marker({ element: el, anchor: "center" }).setLngLat(map.unproject([b.x, b.y])).addTo(map) };
      }
      const on = !!sel && b.groups.some((g) => g.code === sel.code);
      const { el } = clouds.current[key];
      el.classList.toggle("is-selected", on);
      el.classList.toggle("is-dim", !!sel && !on);
      el.style.zIndex = String(on ? 9 : ORDER.length - ORDER.indexOf(worst)); // las mas graves quedan encima
    }
    for (const [key, c] of Object.entries(clouds.current)) {
      if (seen.has(key)) continue;
      c.marker.remove();
      delete clouds.current[key];
    }

    // Etiquetas: cada una busca un sitio libre junto a su punto, partiendo por arriba, sin salirse bajo los paneles; si no lo hay, se oculta
    const [x0, x1] = [map.getPadding().left ?? 0, map.getContainer().clientWidth - (map.getPadding().right ?? 0)];
    const discs = blobs.map((b) => ({ x: b.x, y: b.y, r: sizeOf(b.n) / 2 + 7 }));
    const taken = (sel && !sel.plateau ? sel.candidates.filter((c) => c.share >= 5) : []).map((c) => {
      const p = map.project([c.lon, c.lat]);
      return [p.x - 28, p.y + 10, p.x + 28, p.y + 38]; // porcentaje que se dibuja bajo cada fuente
    });
    const free = (r: number[]) =>
      r[0] >= x0 &&
      r[2] <= x1 &&
      !taken.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]) &&
      !discs.some((c) => Math.hypot(c.x - Math.max(r[0], Math.min(c.x, r[2])), c.y - Math.max(r[1], Math.min(c.y, r[3]))) < c.r);
    for (const l of labels.current) {
      const p = map.project(l.at);
      const [w, h] = [l.el.offsetWidth, l.el.offsetHeight];
      const spots: [number, number][] =
        l.kind === "city"
          ? [[w / 2, 0]]
          : [14, 28, 42].flatMap((g): [number, number][] => {
              const [side, up] = [w / 2 - 8, g + h / 2];
              return [[0, -up], [side, -up], [-side, -up], [g + w / 2, 0], [-g - w / 2, 0], [0, up], [side, up], [-side, up]];
            });
      const rect = ([dx, dy]: [number, number]) => [p.x + dx - w / 2 - 2, p.y + dy - h / 2 - 1, p.x + dx + w / 2 + 2, p.y + dy + h / 2 + 1];
      const i = spots.findIndex((sp) => free(rect(sp)));
      l.el.style.visibility = i < 0 ? "hidden" : "";
      if (i < 0) continue;
      taken.push(rect(spots[i]));
      if (l.kind === "src" && i !== l.spot) {
        l.marker.setOffset(spots[i]);
        l.spot = i;
      }
    }
  }, []);

  // Mapa base, fuentes y estaciones: se crea una sola vez
  useEffect(() => {
    let cancelled = false;
    let map: MLMap | null = null;
    (async () => {
      const [maplibre, online, cities] = await Promise.all([import("maplibre-gl"), hasInternet(), localCities()]);
      if (cancelled || !ref.current) return;
      maplibre.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      libRef.current = maplibre;
      const css = getComputedStyle(document.documentElement);
      const color = (name: string) => css.getPropertyValue(name).trim();

      const sources: Record<string, SourceSpecification> = {
        local: { type: "geojson", data: "/data/base.geojson" },
        fuentes: { type: "geojson", data: points(data.sources, (s) => ({ name: s.name, kind: s.kind, so2: s.so2_max })) },
        estaciones: { type: "geojson", data: points(data.stations, (s) => ({ code: s.code })) },
        radio: { type: "geojson", data: EMPTY },
        cono: { type: "geojson", data: EMPTY },
        trayectoria: { type: "geojson", data: EMPTY },
        enlaces: { type: "geojson", data: EMPTY },
      };
      const layers: LayerSpecification[] = [
        { id: "sea", type: "background", paint: { "background-color": color("--color-sea") } },
        { id: "land", type: "fill", source: "local", filter: ["==", ["get", "kind"], "land"], paint: { "fill-color": color("--color-land") } },
      ];
      if (online) {
        sources.shade = { type: "raster-dem", tiles: [DEM_TILES], tileSize: 256, encoding: "terrarium", maxzoom: 12 };
        layers.push({
          id: "hillshade", type: "hillshade", source: "shade",
          paint: { "hillshade-exaggeration": 0.28, "hillshade-shadow-color": color("--color-relief-dark"), "hillshade-highlight-color": color("--color-relief-light"), "hillshade-accent-color": color("--color-relief-dark") },
        });
      }
      layers.push(
        { id: "borders", type: "line", source: "local", filter: ["==", ["get", "kind"], "border"], paint: { "line-color": color("--color-line-strong"), "line-width": 1 } },
        { id: "radio", type: "fill", source: "radio", paint: { "fill-color": color("--color-cyan"), "fill-opacity": 0.1 } },
        { id: "radio-borde", type: "line", source: "radio", paint: { "line-color": color("--color-accent-soft"), "line-width": 1.2, "line-dasharray": [2, 2] } },
        { id: "cono", type: "fill", source: "cono", paint: { "fill-color": color("--color-cyan"), "fill-opacity": 0.22 } },
        { id: "cono-borde", type: "line", source: "cono", paint: { "line-color": color("--color-accent-soft"), "line-width": 1, "line-dasharray": [3, 2] } },
        { id: "enlaces", type: "line", source: "enlaces", layout: { "line-cap": "round" }, paint: { "line-color": color("--color-navy"), "line-opacity": 0.55, "line-width": ["interpolate", ["linear"], ["get", "share"], 0, 1, 100, 6] } },
        { id: "trayectoria", type: "line", source: "trayectoria", layout: { "line-cap": "round" }, paint: { "line-color": color("--color-accent-soft"), "line-width": 2.5, "line-dasharray": [1, 1.6] } },
        {
          id: "fuentes", type: "circle", source: "fuentes",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["sqrt", ["get", "so2"]], 15, 4, 150, 11],
            "circle-color": ["match", ["get", "kind"], "fundición", color("--color-navy"), "termoeléctrica", color("--color-muted"), color("--color-faint")],
            "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5,
          },
        },
        { id: "estaciones", type: "circle", source: "estaciones", paint: { "circle-radius": 4.5, "circle-color": color("--color-cyan"), "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5 } },
      );

      // vista inicial: todas las estaciones dentro del espacio que dejan libre los paneles
      const pad: Pad = { top: TOP_H, bottom: DOCK_H, left: live.current.leftInset, right: 16 };
      const start = frame(data.stations.map((s): [number, number] => [s.lon, s.lat]), ref.current.clientWidth, ref.current.clientHeight, pad, 6.2);
      const created = new maplibre.Map({
        container: ref.current, ...start, maxZoom: MAX_ZOOM, attributionControl: false, dragRotate: false, pitchWithRotate: false,
        style: { version: 8, sources, layers },
      });
      map = created;
      mapRef.current = created;
      created.setPadding(pad);
      created.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-left");

      // etiquetas: primero las fuentes mas grandes, que eligen sitio antes; layout() las acomoda o las oculta
      clouds.current = {};
      labels.current = [];
      for (const s of [...data.sources].sort((a, b) => b.so2_max - a.so2_max)) {
        if (!SHORT[s.name]) continue;
        const el = document.createElement("span");
        el.className = "src-label";
        el.textContent = SHORT[s.name];
        const at: [number, number] = [s.lon, s.lat];
        labels.current.push({ el, at, kind: "src", spot: -1, marker: new maplibre.Marker({ element: el, anchor: "center" }).setLngLat(at).addTo(created) });
      }
      for (const c of cities) {
        const el = document.createElement("span");
        el.className = "city-label";
        el.textContent = c.name;
        labels.current.push({ el, at: c.at, kind: "city", spot: 0, marker: new maplibre.Marker({ element: el, anchor: "left" }).setLngLat(c.at).addTo(created) });
      }
      created.on("zoom", layout);

      // clic en una fuente o en una estacion: abre la ficha de ese lugar
      created.on("click", "fuentes", (ev: MapLayerMouseEvent) => {
        const name = ev.features?.[0]?.properties?.name;
        const found = live.current.places
          .filter((p) => p.kind === "fuente" && p.name === name)
          .sort((a, b) => distanceKm(ev.lngLat.lat, ev.lngLat.lng, a.lat, a.lon) - distanceKm(ev.lngLat.lat, ev.lngLat.lng, b.lat, b.lon))[0];
        if (found) live.current.onPlace(found);
      });
      created.on("click", "estaciones", (ev: MapLayerMouseEvent) => {
        const code = ev.features?.[0]?.properties?.code;
        const found = live.current.places.find((p) => p.kind === "estación" && p.code === code);
        if (found) live.current.onPlace(found);
      });
      for (const layer of ["fuentes", "estaciones"]) {
        created.on("mouseenter", layer, () => (created.getCanvas().style.cursor = "pointer"));
        created.on("mouseleave", layer, () => (created.getCanvas().style.cursor = ""));
      }
      // "style.load" llega apenas el estilo esta listo, sin esperar a que bajen las teselas del relieve
      created.on("style.load", () => setLoaded((v) => v + 1));
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Estaciones con episodios a la vista, de la mas grave a la menos grave
  useEffect(() => {
    if (!loaded) return;
    const by = new Map<string, Episode[]>();
    for (const e of events) by.set(e.code, [...(by.get(e.code) ?? []), e]);
    const groups = [...by.entries()].map(([code, mine]): Group => {
      const lead = mine.find((e) => !e.plateau) ?? mine[0];
      return { code, mine, name: lead.station.trim(), comuna: lead.comuna, lat: lead.lat, lon: lead.lon, first: lead.id, worst: worstOf(mine.map(levelOf)) };
    });
    view.current = { selected, groups };
    popup.current?.remove();
    layout();
  }, [events, selected, loaded, layout]);

  // Episodio elegido: cono de origen, recorrido del aire y enlaces a cada fuente con su porcentaje
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || !loaded || !map.getSource("cono")) return;
    const set = (id: string, d: GeoJSON.FeatureCollection) => (map.getSource(id) as GeoJSONSource | undefined)?.setData(d);
    shareMarkers.current.forEach((m) => m.remove());
    shareMarkers.current = [];
    if (!selected) {
      set("cono", EMPTY);
      set("trayectoria", EMPTY);
      set("enlaces", EMPTY);
      return;
    }
    const e = selected;
    const show = e.plateau ? [] : e.candidates.filter((c) => c.share >= 1);
    set("cono", cone(e));
    set("trayectoria", { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: e.trajectory } }] });
    set("enlaces", {
      type: "FeatureCollection",
      features: show.map((c) => ({ type: "Feature", properties: { share: c.share }, geometry: { type: "LineString", coordinates: [[e.lon, e.lat], [c.lon, c.lat]] } })),
    });
    for (const c of show.filter((c) => c.share >= 5)) {
      const el = document.createElement("span");
      el.className = "share-label";
      el.textContent = `${Math.round(c.share)} %`;
      shareMarkers.current.push(new lib.Marker({ element: el, anchor: "top", offset: [0, 12] }).setLngLat([c.lon, c.lat]).addTo(map));
    }
  }, [selected, events, loaded]);

  // Lugar buscado: marca y circulo de "cerca"
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || !loaded || !map.getSource("radio")) return;
    pin.current?.remove();
    pin.current = null;
    (map.getSource("radio") as GeoJSONSource).setData(place ? circle(place.lat, place.lon, NEAR_KM) : EMPTY);
    if (!place) return;
    const el = document.createElement("span");
    el.className = "place-pin";
    pin.current = new lib.Marker({ element: el, anchor: "center" }).setLngLat([place.lon, place.lat]).addTo(map);
  }, [place, loaded]);

  // Camara: vuela al episodio elegido o al lugar buscado, dejando libre el espacio de los paneles
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const pad: Pad = { top: TOP_H, bottom: DOCK_H, left: leftInset, right: selected || place ? SHEET_W : 16 };
    const box = map.getContainer();
    if (selected) {
      const e = selected;
      const pts: [number, number][] = [[e.lon, e.lat], destination(e.lat, e.lon, e.wind_from, reachKm(e)), ...e.candidates.filter((c) => c.km <= 45).map((c): [number, number] => [c.lon, c.lat])];
      map.flyTo({ ...frame(pts, box.clientWidth, box.clientHeight, pad, 11), padding: pad, duration: 1300, essential: true });
    } else if (place) {
      const pts = [0, 90, 180, 270].map((b) => destination(place.lat, place.lon, b, NEAR_KM));
      map.flyTo({ ...frame(pts, box.clientWidth, box.clientHeight, pad, 10.5), padding: pad, duration: 2400, curve: 1.6, essential: true });
    } else map.easeTo({ padding: pad, duration: 400 });
  }, [selected, place, leftInset, loaded]);

  return (
    // MapLibre fuerza position: relative en su contenedor, por eso el tamaño lo da un div exterior
    <div className="absolute inset-0 isolate">
      <div ref={ref} className="h-full w-full" />
    </div>
  );
}
