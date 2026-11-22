# 4GEN (antes 4GAS y Ojo Satelital del Diésel)

Hackatón ie&t Chile 2026, track Minería y Sustentabilidad. App web que muestra el NO2 de Sentinel-5P (TROPOMI) sobre las grandes minas a rajo del norte de Chile y lo compara con producción (Cochilco) y con lo que declaran las empresas.

## Estructura
- `pipeline/` scripts Python (entorno en `.venv/`).
  - `download_daily.py [ultimo_dia] [hilos]`: baja NO2 diario recortado a Chile desde `meeo-s5p.s3.amazonaws.com` (RPRO hasta 2022-07-25, OFFL después) a `data/daily/*.npz`. Reanudable.
  - `extract_declared.py`: lee `data/raw/` (Antofagasta, BHP, Codelco, Sierra Gorda, Cochilco) y escribe `data/processed/declared.json` y `production.json`.
  - `compute_index.py`: genera `web/public/data/index.json` y `web/public/no2/AAAA-MM.png`.
  - `download_wind.py`: viento diario por mina (Open-Meteo/ERA5, 16-18 UTC) a `data/raw/wind/`.
  - `compute_wind.py`: señal con filtro de calma, diferencia a favor/en contra del viento y estimación de NOx (t/día); escribe `web/public/data/wind.json` e imprime la comparación con y sin viento.
  - `build_basemap.py`: mapa base local (Natural Earth) a `web/public/data/base.geojson`.
  - `build_manifest.py`: inventario de fuentes a `web/public/data/manifest.json`.
  - `sinca_check.py`: baja NO2 horario de estaciones SINCA (Antofagasta) y lo compara con el satélite; escribe `web/public/data/sinca.json`.
  - `compute_comunas.py`: EN PAUSA. Usa WorldPop, que asigna población a las faenas mineras (Escondida 127 mil hab.); no usar su salida hasta cambiar la fuente de población.
- `data/config/mines.json`: minas, coordenadas (atlas Sernageomin), columnas Cochilco y fuentes declaradas.
- `web/`: Next.js 16 (Turbopack), Tailwind 4, MapLibre 6.18, Recharts 3.10.

## Comandos
- Recalcular datos: `cd pipeline && ../.venv/Scripts/python.exe extract_declared.py && ../.venv/Scripts/python.exe -W ignore compute_index.py`
- App: `cd web && npm run dev -- --port 3000`
- Verificación: `cd web && npx tsc --noEmit && npx eslint src`

## Notas
- La clave de la IA va en `web/.env.local` (ver `.env.example`); nunca en el código.
- MapLibre necesita su worker en `web/public/maplibre/maplibre-gl-worker.mjs` (copiado desde `node_modules/maplibre-gl/dist/`); si se actualiza maplibre-gl hay que volver a copiarlo.
- `next.config.ts` permite el origen `127.0.0.1` para la vista previa.

## Reglas de análisis
- Veredicto por zona (`verdict` en `compute_index.py`, `classify` en `web/src/lib/data.ts`): coincide = r >= 0,7 y el IC 95 % no incluye 0; no concluyente = r >= 0,4; revisar = r < 0,4; insuficiente = menos de 5 años.
- La señal principal no usa viento; el viento es prueba de solidez (`compute_wind.py`).
- Colores: solo variables de `web/src/app/globals.css` (`@theme`).
- Capturas para revisar la interfaz: `cd web && node scripts/shot.mjs <url> <salida.png> [--steps=...]`.

## Giro del proyecto (22 nov): atribución de origen de episodios de SO2
Idea vigente del equipo: detectar episodios de SO2 medidos en tierra (SINCA), atribuirlos a la fuente más probable y armar un expediente de evidencia. El satélite queda como respaldo anual, no como detector diario (ruido de 1 píxel-día ~1,7 DU; una fundición deja ~0,1 DU).
- `pipeline/sinca.py`: series horarias de SINCA (SO2, NO2, viento WDIR/WSPD) a `data/raw/sinca/`.
- `pipeline/episodios.py`: estaciones de Antofagasta y Atacama, horas sobre los niveles del D.S. 104/2018 (350/500/650/950 µg/m3N) y episodios -> `data/processed/episodios_so2.json`.
- `pipeline/build_sources.py`: inventario RETC 2019-2025 (SO2 y NOx por establecimiento del norte) -> `data/processed/retc_so2_nox.json`. Desde 2023 usar `emision_retc` (incluye balance de masa D.S. 28).
- `pipeline/atribucion.py`: control del instrumento, trayectoria inversa, pluma gaussiana, Monte Carlo, rosa de origen -> `web/public/data/atribucion.json`.
- `pipeline/validacion.py`: cierre de Paipote (23-02-2024), SO2 satelital anual y declarado vs límite D.S. 28 -> `web/public/data/validacion.json`.
- `pipeline/download_so2.py`: SO2 diario de Sentinel-5P a `data/daily_so2/` (unidades Dobson).
- Orden: `episodios.py` -> `build_sources.py` -> `atribucion.py` -> `validacion.py`.
- Lenguaje: "fuente probable", nunca "culpable"; lecturas planas (valor repetido) no se atribuyen.
- Pantallas (hechas): `/` mapa con un círculo por estación (número de episodios a la vista), lista de episodios y detalle (`EpisodeMap.tsx`, `EpisodeSheet.tsx`, `lib/episodes.ts`); `/historial` registro con tarjetas, filtros y gráfico del cierre de Paipote; `/metodo`. Abrir un episodio por URL: `/?episodio=<id>`.
- Paleta en modo claro: azul marino #0E1B2C, cian #4FB6C9, gris hielo #E6EBEE (bloque `@theme` de `globals.css`). Los colores de nivel (norma, alerta, preemergencia, emergencia) están en `LEVELS` de `lib/episodes.ts`.
- Si Turbopack sigue sirviendo el CSS anterior tras reescribir `globals.css`, volver a guardarlo (basta agregar un salto de línea).
- De la idea anterior quedan sin enlace en el menú: `/verificar`, `/api/informe`, `MapView`, `MineSheet`, `DeclaredPanel`, `WindPanel`, `PlumeCanvas`.
- Pendiente: IA para redactar el expediente (falta clave en `web/.env.local`), expediente descargable, huella química NO2/SO2.
- Niveles (22 nov): un episodio son horas seguidas con 150 µg/m3 o más; se clasifica por su máximo (150 alza, 262 norma propuesta 2025, 350 norma, 500, 650, 950). Son 676 episodios; 24 sobre la norma. `LEVELS` y `LEVEL_STEPS` en `lib/episodes.ts`.
- Viento: propio de la estación; si no mide, el de la estación más cercana a menos de 15 km (`wind_source: "vecina"`); si no, ERA5. El Monte Carlo usa semilla fija por episodio.
- `pipeline/build_places.py`: índice del buscador (minas categoría A de Sernageomin, fuentes RETC, estaciones, localidades OSM de Antofagasta y Atacama) -> `web/public/data/lugares.json`. Correr después de `atribucion.py`.
- Mapa: `SearchBox.tsx` (buscador con vuelo al lugar), `PlaceSheet.tsx` (ficha del lugar: episodios a menos de 30 km, SO2 declarado), `FilterDock.tsx` (nivel mínimo y línea de tiempo), panel izquierdo minimizable. La cámara se calcula en `frame()` de `EpisodeMap.tsx` con el espacio que dejan libres los paneles.
- El comando de `exec` se corta cerca de los 8.000 caracteres: los archivos largos hay que escribirlos con la herramienta de escritura, no con heredoc.
- Círculos del mapa (`layout()` en `EpisodeMap.tsx`): las estaciones cuyos círculos se tocarían en pantalla se juntan en uno de doble anillo (`cluster()`), que se recalcula en cada cambio de zoom; clic en un grupo acerca hasta separarlo y, si las estaciones están casi en el mismo punto, abre una lista. La estación del episodio elegido nunca se junta. Las etiquetas de fuentes y ciudades buscan sitio libre o se ocultan. Estilos en `.cloud` de `globals.css`.
- Logo: `web/public/logo.png` (fondo transparente, recortado de la imagen que entregó el equipo) y `web/src/app/favicon.ico`; se usa en `TopNav.tsx`.
- Nombre del proyecto: 4GEN (encabezado en `TopNav.tsx` y título en `layout.tsx`). El repositorio es `lfreecs/iethack` y Vercel publica desde `web/`.
- Teléfono (menos de 1024 px de ancho, `useMedia(NARROW)` en `lib/useMedia.ts`): el panel de episodios es una hoja inferior que parte minimizada y lleva dentro los filtros (`FilterDock embedded`); las fichas ocupan el 58 % inferior (`SHEET_FRAC` en `EpisodeMap.tsx` debe coincidir con `h-[58dvh]`); se ocultan los botones de zoom. El espacio libre del mapa lo calcula `padFor()`.
- `scripts/shot.mjs` acepta `--mobile=1` (emula teléfono táctil) y pasos `click:x,y` y `tap:x,y` para probar clics reales sobre el mapa.
- Estación La Negra (red de Altonorte, 3 km al norte de la fundición): no está en SINCA. `pipeline/snifa_altonorte.py` baja de SNIFA las planillas mensuales de seguimiento ambiental (unidad fiscalizable 674, RCA 39/2000) y deja SO2 y viento con el formato de SINCA (`data/raw/sinca/*_SNIFA_LNE_h.csv`); `episodios.py` la suma con `EXTRA` y estado "informado por la empresa". Viene en ppb (×2,62 a µg/m3N). Solo marzo 2022 a septiembre 2026: antes las planillas vienen en .zip/.7z y no se leen. SNIFA responde 429 con más de 3 hilos. Orden: `snifa_altonorte.py` -> `episodios.py` -> `atribucion.py` -> `build_places.py`.
- Totales con La Negra: 795 episodios desde 150 µg/m3 en 24 de 28 estaciones; 55 sobre la norma (350).
- Clic en el círculo de una estación: abre su ficha (`PlaceSheet`) con la lista de sus episodios a la vista (`visible`, mismos filtros del mapa); desde ahí se abre cada episodio y "Ver el registro de esta estación" vuelve a la lista. El círculo de la estación abierta queda resaltado (`view.current.station`).
- Vercel: la CLI está instalada pero sin sesión (`vercel whoami` dice "Logged out"); el despliegue lo hace el usuario importando `lfreecs/iethack` con Root Directory `web`.

## PROBLEMAS DE DATOS DETECTADOS (22 nov, sin corregir todavía)
- Unidades: la ficha de cada estación en SINCA (`data/raw/sinca/estacion_*.html`, texto "Dióxido de azufre (SO2 - ppb)" o "(SO2 - μg/m3N)") dice en qué unidad viene la serie. 19 de las 27 estaciones de SINCA cargadas vienen en ppb (todo Calama, Super Site y Escuela E-10 de Tocopilla, toda la red de Guacolda, Copiapó Sivica) y `episodios.py` las trata como µg/m3N. Hay que multiplicar por 2,62. Comprobado en Quintero: 506 ppb en SINCA = 1.327 µg/m3N oficial (SMA, 6 jun 2022). En µg/m3N: Antofagasta, Gobernación, red de Paipote (ENAMI), Huasco II. La Negra (SNIFA) ya está convertida.
- Calibraciones: en la red de Guacolda (SM1-SM8, EME F, EME M), Huasco II y Tocopilla (Gobernación, Super Site, Escuela E-10) casi todos los "episodios" duran 1 hora, ocurren de lunes a viernes entre 08 y 17 h (0-8 % en fin de semana, contra 29 % esperado) y recorren las estaciones en secuencia el mismo día: son chequeos de calibración en datos no validados, no plumas. Las estaciones con patrón de pluma real (29-42 % en fin de semana) son Calama, la red de Paipote y La Negra.
- Consecuencia: los totales (795 episodios, 55 sobre la norma), "Guacolda fuente más repetida" y los casos de "origen compartido" de Tocopilla no son confiables. Siguen firmes La Negra y Paipote.
