import { JUMP_LIMITS, daysBetween } from "@/lib/mantencion/readings"
import type { MantReading, MantUnit } from "@/lib/mantencion/types"
import { addDaysToPlainDate, todayInChile, trailingDaysRange } from "@/lib/utils"

/**
 * Uso diario y fecha estimada de la próxima mantención. Módulo PURO (sin base de datos): sale de las lecturas que ya
 * trae `loadFleet`. Es una referencia para programar: NUNCA cambia el estado del equipo (vencida, próxima, al día),
 * que sigue saliendo de `equipmentStatus`.
 *
 * - Uso diario = (última lectura − primera lectura) ÷ días entre ambas, sobre los últimos 30 días. Las lecturas son
 *   de un odómetro u horómetro acumulado, así que esa pendiente es el promedio exacto del período. Si el GPS
 *   (o VisionLink) trae una lectura más nueva que la oficial, entra como último punto (`pickGpsEstimateReading` ya
 *   comprobó que es plausible).
 * - La fecha parte de la última lectura conocida, no de hoy: una lectura de hace 10 días ya consumió 10 días del
 *   camino. Con la lectura de hoy es lo mismo que «hoy + faltantes ÷ uso».
 * - Sin estimación (y con la razón escrita) cuando hay menos de 2 lecturas en la ventana, el uso es cero o
 *   negativo, o supera lo que un equipo puede recorrer en un día (`JUMP_LIMITS`: casi seguro un error de lectura).
 */

export const ESTIMATE_WINDOW_DAYS = 30
/** Más allá de esto la fecha no informa nada: se dice «más de 10 años» y no se dibuja. */
const MAX_ESTIMATE_DAYS = 3_650

export interface EstimateInput {
  unit: MantUnit
  /** Lecturas vigentes del equipo (`FleetRow.readings`, de cualquier orden). */
  readings: readonly MantReading[]
  /** Lectura del GPS o de VisionLink más nueva que la oficial. */
  gps: { value: number; at: string } | null
  /** Lectura oficial sobre la que se calculó `remaining`. */
  current: { value: number; date: string } | null
  /** Próxima − lectura oficial. Negativo = vencida. */
  remaining: number | null
  /** Hoy en Chile (`YYYY-MM-DD`). */
  today: string
}

export interface EstimateResult {
  dailyUsage: number | null
  estimatedDate: string | null
  /** Por qué no hay fecha; `null` cuando la hay. */
  note: string | null
}

interface Point {
  value: number
  date: string
}

/** Un punto por día (el mayor: el odómetro no retrocede dentro del día), de la fecha más antigua a la más nueva. */
function windowPoints(input: EstimateInput, from: string): Point[] {
  const byDate = new Map<string, number>()
  const add = (date: string, value: number) => {
    if (date < from || date > input.today) return
    byDate.set(date, Math.max(byDate.get(date) ?? Number.NEGATIVE_INFINITY, value))
  }
  for (const reading of input.readings) add(reading.date, reading.value)
  if (input.gps) add(todayInChile(input.gps.at), input.gps.value)
  return [...byDate.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date))
}

const round1 = (value: number) => Math.round(value * 10) / 10

export function estimateNextDate(input: EstimateInput): EstimateResult {
  const symbol = input.unit === "km" ? "km" : "h"
  const points = windowPoints(input, trailingDaysRange(ESTIMATE_WINDOW_DAYS, input.today).from)
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last || first.date === last.date) {
    return { dailyUsage: null, estimatedDate: null, note: `Sin lecturas suficientes en los últimos ${ESTIMATE_WINDOW_DAYS} días para calcular el uso diario` }
  }
  const usage = (last.value - first.value) / daysBetween(first.date, last.date)
  if (!(usage > 0)) {
    return { dailyUsage: null, estimatedDate: null, note: `El equipo no registra uso en los últimos ${ESTIMATE_WINDOW_DAYS} días` }
  }
  if (usage > JUMP_LIMITS[input.unit].perDay) {
    return { dailyUsage: null, estimatedDate: null, note: `El uso calculado (más de ${JUMP_LIMITS[input.unit].perDay} ${symbol}/día) no es creíble: revisa las lecturas` }
  }
  const dailyUsage = round1(usage)
  if (input.remaining == null || !input.current) {
    return { dailyUsage, estimatedDate: null, note: "Sin pauta o sin lectura: no hay próxima mantención que estimar" }
  }

  // La lectura más nueva que se conoce (la del GPS si es posterior a la oficial) y lo que falta desde ella.
  const gpsDate = input.gps ? todayInChile(input.gps.at) : null
  const useGps = input.gps != null && gpsDate != null && gpsDate > input.current.date && input.gps.value >= input.current.value
  const anchorDate = useGps ? gpsDate : input.current.date
  const remainingAtAnchor = input.remaining - (useGps ? input.gps!.value - input.current.value : 0)
  const days = Math.round(remainingAtAnchor / usage)
  if (Math.abs(days) > MAX_ESTIMATE_DAYS) {
    return { dailyUsage, estimatedDate: null, note: "Al ritmo de los últimos 30 días, la fecha queda a más de 10 años" }
  }
  let estimatedDate = addDaysToPlainDate(anchorDate!, days)
  // Aún no vencida según la última lectura: la estimación no puede quedar antes de hoy.
  if (input.remaining > 0 && estimatedDate < input.today) estimatedDate = input.today
  return { dailyUsage, estimatedDate, note: null }
}
