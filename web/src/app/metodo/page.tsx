import TopNav from "@/components/TopNav";

const STEPS = [
  { t: "Detectar", d: "Se revisan las mediciones horarias de SO₂ de las estaciones oficiales (SINCA). Un episodio son horas seguidas con 150 µg/m³ o más, y se clasifica por su máximo: 350 es la norma horaria del D.S. 104/2018 y 500, 650 y 950 son sus niveles de alerta, preemergencia y emergencia. 262 es la norma propuesta en 2025 y 150, un umbral nuestro para ver alzas menores." },
  { t: "Revisar el instrumento", d: "Si la estación repite casi el mismo valor durante horas, la lectura es plana: el valor real no se conoce y no se señala a nadie." },
  { t: "Reconstruir el viento", d: "Desde la estación se retrocede hora a hora con el viento, hasta 12 horas. Se usa el viento medido en la misma estación; si no existe, el medido en la estación más cercana a menos de 15 km; y si tampoco, el de un modelo (ERA5), que es menos preciso." },
  { t: "Calcular cuánto aportaría cada fuente", d: "Para cada fuente del inventario oficial (RETC) se estima la concentración que llegaría a la estación con una pluma gaussiana: depende de lo que declara emitir, de qué tan alineada está con el viento, de la distancia y del tiempo de viaje." },
  { t: "Repartir el origen", d: "El porcentaje de cada fuente es su concentración esperada dividida por la suma de todas más el nivel habitual de la estación, que representa lo no inventariado." },
  { t: "Medir la incertidumbre", d: "El cálculo se repite 400 veces variando la dirección y velocidad del viento, la duración del gas, la altura de mezcla y la emisión de cada fuente. Se informa el valor central y el rango." },
];

const LIMITS = [
  "No determina responsabilidades. Ordena fuentes probables para orientar una fiscalización.",
  "Las emisiones del inventario son declaradas o estimadas por las empresas, y algunos años están incompletos.",
  "La mayoría de las estaciones con episodios pertenece a las propias empresas, y sus datos figuran como no validados.",
  "Dos fuentes en la misma dirección no se pueden separar. Pasa con Chuquicamata y Ministro Hales vistas desde Calama.",
  "Solo 11 de las 27 estaciones miden viento. En otras 10 se usa el viento de una estación vecina y en las 6 restantes, un modelo; por eso su confianza es menor.",
  "En la mayoría de las alzas bajo la norma, el viento de esa hora no venía desde ninguna fuente inventariada. El viento en superficie no siempre sigue a una pluma emitida en altura.",
  "El cálculo supone terreno plano y no considera la altura de las chimeneas.",
  "El satélite no detecta episodios de un día: su ruido es mucho mayor que la señal de una fundición. Solo sirve en promedios anuales.",
  "La confianza (0 a 100) es un criterio propio, no una probabilidad.",
];

const SOURCES = [
  ["SINCA, Ministerio del Medio Ambiente", "SO₂ y viento por hora de 27 estaciones de Antofagasta y Atacama, 2018–2026"],
  ["RETC, Ministerio del Medio Ambiente", "Emisiones anuales de SO₂ declaradas por establecimiento, 2019–2025"],
  ["Open-Meteo (reanálisis ERA5)", "Viento, radiación y nubes por hora donde no hay viento medido"],
  ["Sentinel-5P, Copernicus", "SO₂ diario desde el espacio, usado solo como contexto anual"],
  ["Sernageomin", "Ubicación de fundiciones y de las minas del buscador"],
  ["OpenStreetMap", "Ciudades y localidades del buscador"],
  ["D.S. 104/2018 y D.S. 28/2013", "Norma de calidad del aire para SO₂ y norma de emisión de fundiciones"],
];

export default function Metodo() {
  return (
    <div className="flex h-full flex-col">
      <TopNav active="metodo" />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-7">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Método y límites</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            Cómo se pasa de una medición alta de SO₂ en una estación a la fuente más probable, y qué no se puede afirmar con este método.
          </p>

          <h2 className="mt-7 text-[15px] font-semibold text-ink">Los seis pasos</h2>
          <ol className="mt-3 grid gap-3 sm:grid-cols-2">
            {STEPS.map((s, i) => (
              <li key={s.t} className="rounded-2xl border border-line bg-panel p-4 shadow-sm">
                <div className="flex items-center gap-2.5">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-navy text-[13px] font-semibold text-white">{i + 1}</span>
                  <h3 className="text-[14px] font-semibold text-ink">{s.t}</h3>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{s.d}</p>
              </li>
            ))}
          </ol>

          <h2 className="mt-8 text-[15px] font-semibold text-ink">La fórmula</h2>
          <div className="mt-3 rounded-2xl border border-line bg-panel p-5 shadow-sm">
            <p className="font-mono text-[13px] leading-relaxed text-ink">C = Q / (√(2π) · u · σ · H) · exp(−y² / 2σ²) · exp(−t / τ)</p>
            <p className="mt-2 font-mono text-[13px] text-ink">P = C / (ΣC + fondo)</p>
            <dl className="mt-4 grid gap-x-6 gap-y-1.5 text-[12.5px] text-ink-soft sm:grid-cols-2">
              {[
                ["C", "concentración esperada de una fuente en la estación"],
                ["Q", "emisión declarada por la fuente"],
                ["u", "velocidad del viento"],
                ["y", "distancia de la fuente al recorrido del aire"],
                ["σ", "ancho de la pluma, según distancia y estabilidad del aire"],
                ["H", "altura hasta donde se mezcla el aire"],
                ["t", "tiempo de viaje del aire"],
                ["τ", "duración del SO₂ en el aire (entre 6 y 48 horas)"],
                ["P", "parte del origen atribuida a la fuente"],
                ["fondo", "nivel habitual de la estación"],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="w-12 shrink-0 font-mono font-semibold text-ink">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-[12.5px] leading-relaxed text-ink-soft">
              Se señala una <b>fuente única probable</b> solo si su parte es de 85 % o más, el piso de su rango es de 50 % o más y la confianza es de 60 o más.
            </p>
          </div>

          <h2 className="mt-8 text-[15px] font-semibold text-ink">Cómo lo comprobamos</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-line bg-panel p-4 shadow-sm">
              <h3 className="text-[14px] font-semibold text-ink">Una fuente que se apagó</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
                La fundición Paipote se detuvo el 23 de febrero de 2024. En la estación a 1,5 km, el máximo horario bajó de 126 a 6 µg/m³ y no hubo más episodios.
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-panel p-4 shadow-sm">
              <h3 className="text-[14px] font-semibold text-ink">Ocho años de viento en Calama</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
                Cuando el viento viene desde la fundición de Chuquicamata, las horas con SO₂ alto son entre 3 y 9 veces más frecuentes, según la estación.
              </p>
            </div>
          </div>

          <h2 className="mt-8 text-[15px] font-semibold text-ink">Límites</h2>
          <ul className="mt-3 space-y-2 rounded-2xl border border-line bg-panel p-5 text-[13px] leading-relaxed text-ink-soft shadow-sm">
            {LIMITS.map((l) => (
              <li key={l} className="flex gap-2.5">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-cyan" />
                {l}
              </li>
            ))}
          </ul>

          <h2 className="mt-8 text-[15px] font-semibold text-ink">Fuentes de datos</h2>
          <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-panel shadow-sm">
            {SOURCES.map(([name, what], i) => (
              <div key={name} className={`grid gap-1 px-5 py-3 text-[13px] sm:grid-cols-[16rem_1fr] ${i ? "border-t border-line" : ""}`}>
                <span className="font-medium text-ink">{name}</span>
                <span className="text-ink-soft">{what}</span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
