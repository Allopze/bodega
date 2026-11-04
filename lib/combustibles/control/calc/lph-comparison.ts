import { niceAxisMax } from "@/lib/chart-scale"
import type { LitersPerHourComparisonRow } from "../queries/idle-comparison"

/**
 * CHART-021: forma del gráfico «telemetría contra cargas» (L/h). Pura: la consulta
 * (`getLitersPerHourComparison`) ya trajo un L/h de telemetría y uno de cargas por
 * equipo y mes; acá se deciden qué pares se dibujan, cuáles caen fuera de la banda
 * y cuál es la escala común de los dos ejes.
 *
 * Los dos ejes miden lo mismo (L/h), así que comparten escala —es lo que hace que
 * la diagonal y = x sea «coinciden»— y no rompen la regla de una unidad por eje
 * (A5b): no se mezclan magnitudes distintas.
 */

/** Tolerancia de la banda alrededor de la diagonal: qué tanto puede diferir la telemetría de las cargas. */
export const LPH_BAND_PCT = 15

/** Margen contra el error de coma flotante en el borde exacto de la banda. */
const EPSILON = 1e-9

export interface LphPoint {
  key: string
  vehicleId: string
  equipment: string
  month: string
  /** L/h que salen de las cargas del mes (eje x). */
  x: number
  /** L/h que mide la telemetría (eje y). */
  y: number
  /** (telemetría − cargas) ÷ cargas, en %. Calculado acá desde x e y. */
  differencePct: number
  /** Fuera de la banda de ±`LPH_BAND_PCT` %. */
  outside: boolean
  /** `above`: la telemetría mide más que lo cargado; `below`: menos. `null` dentro de la banda. */
  direction: "above" | "below" | null
  loadCount: number
}

export interface LphComparisonView {
  /** Pares con telemetría y cargas, en el orden de la consulta. */
  points: LphPoint[]
  /** Los pares fuera de la banda, del más lejano al más cercano. */
  outside: LphPoint[]
  /** Equipos-mes con telemetría pero sin cargas con L/h para comparar. */
  noLoads: number
  /** Equipos-mes cuya telemetría no informa litros, así que no hay L/h. */
  noTelemetry: number
  equipmentCount: number
  /** Tope común de los dos ejes. */
  axisMax: number
}

export function buildLphComparison(rows: LitersPerHourComparisonRow[], bandPct = LPH_BAND_PCT): LphComparisonView {
  const points: LphPoint[] = []
  let noLoads = 0
  let noTelemetry = 0

  for (const row of rows) {
    if (row.telemetryLph === null) { noTelemetry += 1; continue }
    if (row.loadsLph === null || !(row.loadsLph > 0)) { noLoads += 1; continue }
    const differencePct = ((row.telemetryLph - row.loadsLph) / row.loadsLph) * 100
    const outside = Math.abs(differencePct) > bandPct + EPSILON
    points.push({
      key: `${row.vehicleId}|${row.month}`,
      vehicleId: row.vehicleId,
      equipment: row.equipment,
      month: row.month,
      x: row.loadsLph,
      y: row.telemetryLph,
      differencePct,
      outside,
      direction: outside ? (differencePct > 0 ? "above" : "below") : null,
      loadCount: row.loadCount,
    })
  }

  const biggest = points.reduce((max, point) => Math.max(max, point.x, point.y), 0)
  return {
    points,
    outside: points.filter((point) => point.outside).sort((a, b) => Math.abs(b.differencePct) - Math.abs(a.differencePct)),
    noLoads,
    noTelemetry,
    equipmentCount: new Set(points.map((point) => point.vehicleId)).size,
    axisMax: niceAxisMax(biggest * 1.05),
  }
}

/**
 * La frase que responde el gráfico, o `null` si no hay pares que comparar (la
 * pantalla muestra entonces el estado vacío). Sólo habla de lo que el gráfico
 * dibuja: los equipos-mes sin cargas o sin litros de telemetría van en una nota
 * aparte.
 */
export function describeLphComparison(view: LphComparisonView, bandPct = LPH_BAND_PCT): string | null {
  const total = view.points.length
  if (total === 0) return null
  const outside = view.outside.length
  const above = view.outside.filter((point) => point.direction === "above").length
  const below = outside - above

  if (outside === 0) {
    return total === 1
      ? `El par equipo-mes con telemetría y cargas está dentro de la banda de ±${bandPct} %.`
      : `Los ${total} pares equipo-mes con telemetría y cargas están dentro de la banda de ±${bandPct} %.`
  }
  if (total === 1) {
    return `El par equipo-mes con telemetría y cargas queda fuera de la banda de ±${bandPct} %: la telemetría mide ${above === 1 ? "más" : "menos"} que lo cargado.`
  }
  const parts = [
    above > 0 ? `${above} ${above === 1 ? "mide" : "miden"} más que lo cargado` : null,
    below > 0 ? `${below} ${below === 1 ? "mide" : "miden"} menos` : null,
  ].filter(Boolean).join(" y ")
  return `De ${total} pares equipo-mes con telemetría y cargas, ${outside} ${outside === 1 ? "queda" : "quedan"} fuera de la banda de ±${bandPct} %: ${parts}.`
}
