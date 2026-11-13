import { maxMeterRatePerDayOf } from "@/lib/combustibles/meter-series"
import { todayInChile } from "@/lib/utils"
import { daysBetween } from "./readings"
import type { MantUnit } from "./types"

/**
 * De dónde sale la lectura con que se estima la próxima mantención cuando es
 * más nueva que la oficial: `gps` (último valor del GPS) o `visionlink`
 * (horómetro acumulado de Cat, un valor por día). La estimación nunca reemplaza
 * la lectura registrada; sólo es una referencia para programar.
 */
export type MantGpsReadingSource = "gps" | "visionlink"

export const MANT_GPS_SOURCE_LABEL: Record<MantGpsReadingSource, string> = {
  gps: "GPS",
  visionlink: "VisionLink",
}

export interface MeterSample {
  value: number
  /** Instante ISO de la lectura. */
  at: string
}

export interface GpsEstimateReading {
  value: number
  at: string
  source: MantGpsReadingSource
}

/**
 * Elige la lectura de la estimación o `null` si no corresponde estimar.
 *
 * - Sólo equipos activos y con pauta (intervalos): un equipo retirado o sin
 *   pauta no tiene próxima mantención que estimar.
 * - VisionLink sólo informa horómetro. Se usa si es más nueva que la lectura
 *   oficial y no más vieja que la del GPS (a igual día gana el acumulado de
 *   Cat, que es el oficial del equipo); si no, la del GPS.
 * - La elegida tiene que ser estrictamente más nueva que la oficial (si es
 *   igual o anterior, el estado oficial ya la contiene) y plausible: no menor
 *   que la oficial ni con un avance mayor que la tasa máxima × los días
 *   transcurridos. Un medidor que partió en 0 o va muy adelantado no comparte
 *   calibración con la lectura del mecánico; no se proyecta. No se mezclan
 *   fuentes: si la elegida no es plausible no se cae a la otra.
 */
export function pickGpsEstimateReading(input: {
  unit: MantUnit
  official: { value: number; date: string } | null
  gps: MeterSample | null
  visionlink: MeterSample | null
  active: boolean
  hasIntervals: boolean
}): GpsEstimateReading | null {
  if (!input.active || !input.hasIntervals) return null
  const { official } = input
  const dayOf = (sample: MeterSample) => todayInChile(sample.at)
  const newerThanOfficial = (sample: MeterSample) => official == null || dayOf(sample) > official.date

  const visionlink = input.unit === "h" ? input.visionlink : null
  const useVisionlink = visionlink != null
    && newerThanOfficial(visionlink)
    && (input.gps == null || dayOf(visionlink) >= dayOf(input.gps))
  const chosen = useVisionlink ? visionlink : input.gps
  if (!chosen || !newerThanOfficial(chosen)) return null

  if (official != null) {
    const days = Math.max(1, daysBetween(official.date, dayOf(chosen)))
    const maxAdvance = maxMeterRatePerDayOf({ config: null }, input.unit === "km" ? "km" : "hora") * days
    if (chosen.value < official.value || chosen.value - official.value > maxAdvance) return null
  }
  return { value: chosen.value, at: chosen.at, source: useVisionlink ? "visionlink" : "gps" }
}
