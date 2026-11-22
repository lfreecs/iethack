"use client";

import { useEffect, useRef, useState } from "react";
import type { ExpressionSpecification, GeoJSONSource, ImageSource, LayerSpecification, Map as MLMap, MapLayerMouseEvent, SourceSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { WifiOff } from "lucide-react";
import type { IndexData } from "@/lib/data";

type Props = {
  data: IndexData;
  month: string;
  selected: string | null;
  onSelect: (id: string) => void;
  terrain3d: boolean;
};

type Corners = [[number, number], [number, number], [number, number], [number, number]];
type Anchor = "top" | "bottom" | "left" | "right";

const DEM_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const LABEL_OFFSET: Record<Anchor, [number, number]> = { top: [0, 10], bottom: [0, -10], left: [10, 0], right: [-10, 0] };

/** El relieve (sombreado y 3D) es lo unico que necesita internet; el resto del mapa esta guardado en /data. */
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

const corners = ([w, s, e, n]: IndexData["bounds"]): Corners => [[w, n], [e, n], [e, s], [w, s]];

/** Espacio que tapan los paneles: el ranking a la izquierda y, con una zona abierta, su ficha a la derecha. */
function padding(width: number, sheetOpen: boolean) {
  return { top: 70, bottom: 100, left: Math.min(340, width * 0.25), right: sheetOpen ? Math.min(500, width * 0.38) : 0 };
}

function minesGeo(data: IndexData): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: data.mines.map((m) => ({ type: "Feature", properties: { id: m.id, name: m.name }, geometry: { type: "Point", coordinates: [m.lon, m.lat] } })),
  };
}

/** Circulo de la señal (core) y anillo de aire de referencia (bg) alrededor de la zona elegida. */
function ringsGeo(lon: number, lat: number, core: number, bg: [number, number]): GeoJSON.FeatureCollection {
  const line = (km: number, kind: string): GeoJSON.Feature => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * 2 * Math.PI;
      pts.push([lon + (km * Math.sin(a)) / (111 * Math.cos((lat * Math.PI) / 180)), lat + (km * Math.cos(a)) / 111]);
    }
    return { type: "Feature", properties: { kind }, geometry: { type: "LineString", coordinates: pts } };
  };
  return { type: "FeatureCollection", features: [line(core, "core"), line(bg[0], "bg"), line(bg[1], "bg")] };
}

export default function MapView({ data, month, selected, onSelect, terrain3d }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const labelsRef = useRef<Record<string, HTMLElement>>({});
  const onSelectRef = useRef(onSelect);
  const prev3d = useRef(terrain3d);
  const [loaded, setLoaded] = useState(0); // aumenta cada vez que el estilo de un mapa queda listo
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    let cancelled = false;
    let map: MLMap | null = null;
    (async () => {
      const [maplibre, online, cities] = await Promise.all([import("maplibre-gl"), hasInternet(), localCities()]);
      if (cancelled || !ref.current) return;
      maplibre.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      const css = getComputedStyle(document.documentElement);
      const color = (name: string) => css.getPropertyValue(name).trim();

      const sources: Record<string, SourceSpecification> = {
        local: { type: "geojson", data: "/data/base.geojson" },
        no2: { type: "image", url: `/no2/${month}.png`, coordinates: corners(data.bounds) },
        mines: { type: "geojson", data: minesGeo(data) },
        rings: { type: "geojson", data: EMPTY },
      };
      const layers: LayerSpecification[] = [
        { id: "sea", type: "background", paint: { "background-color": color("--color-sea") } },
        { id: "land", type: "fill", source: "local", filter: ["==", ["get", "kind"], "land"], paint: { "fill-color": color("--color-land") } },
      ];
      if (online) {
        // dos fuentes separadas: una para el sombreado y otra para el relieve 3D
        const dem: SourceSpecification = { type: "raster-dem", tiles: [DEM_TILES], tileSize: 256, encoding: "terrarium", maxzoom: 12 };
        sources.shade = dem;
        sources.dem = dem;
        layers.push({
          id: "hillshade",
          type: "hillshade",
          source: "shade",
          paint: {
            "hillshade-exaggeration": 0.6,
            "hillshade-shadow-color": color("--color-relief-dark"),
            "hillshade-highlight-color": color("--color-relief-light"),
            "hillshade-accent-color": color("--color-relief-dark"),
          },
        });
      }
      layers.push(
        { id: "borders", type: "line", source: "local", filter: ["==", ["get", "kind"], "border"], paint: { "line-color": color("--color-line-strong"), "line-width": 0.9 } },
        { id: "no2", type: "raster", source: "no2", paint: { "raster-opacity": 0.85, "raster-fade-duration": 0 } },
        { id: "ring-bg", type: "line", source: "rings", filter: ["==", ["get", "kind"], "bg"], paint: { "line-color": color("--color-ink-soft"), "line-width": 1, "line-dasharray": [2, 2], "line-opacity": 0.7 } },
        { id: "ring-core", type: "line", source: "rings", filter: ["==", ["get", "kind"], "core"], paint: { "line-color": color("--color-accent"), "line-width": 1.8 } },
        { id: "mine-halo", type: "circle", source: "mines", paint: { "circle-radius": 7, "circle-color": color("--color-info"), "circle-opacity": 0.18, "circle-stroke-color": color("--color-info"), "circle-stroke-width": 1.5 } },
      );

      const created = new maplibre.Map({
        container: ref.current,
        center: [-69.2, -22.6],
        zoom: 6.6,
        pitch: terrain3d ? 45 : 0,
        bearing: -12,
        maxPitch: 70,
        attributionControl: false,
        style: { version: 8, sources, layers },
      });
      map = created;
      mapRef.current = created;
      created.setPadding(padding(ref.current.clientWidth, false));
      created.addControl(new maplibre.NavigationControl({ visualizePitch: true }), "top-left");

      for (const c of cities) {
        const el = document.createElement("span");
        el.className = "city-label";
        el.textContent = c.name;
        new maplibre.Marker({ element: el, anchor: "left" }).setLngLat(c.at).addTo(created);
      }
      labelsRef.current = {};
      for (const m of data.mines) {
        const el = document.createElement("button");
        el.className = "mine-label";
        el.textContent = m.label ?? m.name;
        el.title = m.name;
        el.onclick = () => onSelectRef.current(m.id);
        labelsRef.current[m.id] = el;
        const anchor = m.anchor ?? "top";
        new maplibre.Marker({ element: el, anchor, offset: LABEL_OFFSET[anchor] }).setLngLat([m.lon, m.lat]).addTo(created);
      }

      created.on("click", "mine-halo", (ev: MapLayerMouseEvent) => {
        const id = ev.features?.[0]?.properties?.id;
        if (id) onSelectRef.current(String(id));
      });
      created.on("mouseenter", "mine-halo", () => (created.getCanvas().style.cursor = "pointer"));
      created.on("mouseleave", "mine-halo", () => (created.getCanvas().style.cursor = ""));
      // "style.load" llega apenas el estilo esta listo, sin esperar a que bajen las teselas del relieve
      created.on("style.load", () => {
        if (online && terrain3d) created.setTerrain({ source: "dem", exaggeration: 1.6 });
        setOffline(!online);
        setLoaded((v) => v + 1);
      });
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const src = mapRef.current?.getSource("no2") as ImageSource | undefined;
    if (loaded && src) src.updateImage({ url: `/no2/${month}.png`, coordinates: corners(data.bounds) });
  }, [month, loaded, data.bounds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !map.getLayer("mine-halo")) return;
    const css = getComputedStyle(document.documentElement);
    const info = css.getPropertyValue("--color-info").trim();
    const accent = css.getPropertyValue("--color-accent").trim();
    const isSel: ExpressionSpecification = ["==", ["get", "id"], selected ?? ""];
    map.setPaintProperty("mine-halo", "circle-color", ["case", isSel, accent, info]);
    map.setPaintProperty("mine-halo", "circle-stroke-color", ["case", isSel, accent, info]);
    map.setPaintProperty("mine-halo", "circle-opacity", ["case", isSel, 0.9, 0.18]);
    map.setPaintProperty("mine-halo", "circle-radius", ["case", isSel, 4, 7]);
    for (const [id, el] of Object.entries(labelsRef.current)) el.classList.toggle("is-selected", id === selected);

    const m = data.mines.find((x) => x.id === selected);
    const width = map.getContainer().clientWidth;
    (map.getSource("rings") as GeoJSONSource | undefined)?.setData(m ? ringsGeo(m.lon, m.lat, data.core_km, data.ring_km) : EMPTY);
    if (m) map.flyTo({ center: [m.lon, m.lat], zoom: 7.3, speed: 0.8, padding: padding(width, true) });
    else map.easeTo({ padding: padding(width, false), duration: 500 });
  }, [selected, loaded, data]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || prev3d.current === terrain3d) return;
    prev3d.current = terrain3d;
    if (map.getSource("dem")) map.setTerrain(terrain3d ? { source: "dem", exaggeration: 1.6 } : null);
    map.easeTo({ pitch: terrain3d ? 50 : 0 });
  }, [terrain3d, loaded]);

  return (
    <>
      {/* MapLibre fuerza position: relative en su contenedor, por eso el tamaño lo da un div exterior */}
      <div className="absolute inset-0">
        <div ref={ref} className="h-full w-full" />
      </div>
      {offline && (
        <div className="absolute bottom-[6.5rem] left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-panel/90 px-3 py-1 text-[11px] text-muted backdrop-blur">
          <WifiOff size={12} /> Sin internet: mapa sin relieve
        </div>
      )}
    </>
  );
}
