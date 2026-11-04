import { countOf, formatDate, formatQty } from "@/lib/utils"

const MISSING = "—"
const hoursText = (value: number) => formatQty(value, undefined, { maximumFractionDigits: 1 })

/**
 * CHART-024: forma del gráfico «Día a día» del motor en vacío. Lo usan la ficha del
 * equipo y la pantalla de Motor en vacío, para que los dos dibujen igual.
 *
 * Un día con menos de 1 hora de motor no dibuja porcentaje: con minutos de motor
 * andando el cociente da 100 % (o 0 %) sin significar nada. Es el mismo umbral de los
 * «días con más vacío» de la pantalla de Motor en vacío (`getIdleTopDays`). Las horas
 * del día sí se dibujan: la barra existe, lo que engaña es el porcentaje.
 */
export const MIN_IDLE_DAY_HOURS = 1

export interface IdleDay {
  /** «YYYY-MM-DD». */
  day: string
  operatingHours: number
  idleHours: number
  idlePct: number | null
}

/** Lo que recibe `IdleDailyChart` (misma forma que su `IdleDailyPoint`). */
export interface IdleDailyChartPoint { label: string; operatingHours: number; idlePct: number | null }

export function idleDailyChartData(days: readonly IdleDay[]): IdleDailyChartPoint[] {
  return days.map((point) => ({
    label: `${point.day.slice(8, 10)}/${point.day.slice(5, 7)}`,
    operatingHours: point.operatingHours,
    idlePct: point.operatingHours >= MIN_IDLE_DAY_HOURS ? point.idlePct : null,
  }))
}

/**
 * La frase que responde el gráfico: el día con más tiempo en vacío entre los que
 * cuentan (al menos 1 h de motor), y cuántos días quedaron fuera por cortos.
 * `null` sin días.
 */
export function describeIdleDaily(days: readonly IdleDay[]): string | null {
  if (days.length === 0) return null
  const counting = days.filter((point) => point.operatingHours >= MIN_IDLE_DAY_HOURS && point.idlePct !== null)
  if (counting.length === 0) {
    return "Ningún día del período tuvo al menos 1 hora de motor: con menos, el porcentaje en vacío no significa nada y no se dibuja."
  }
  const worst = counting.reduce((best, point) => {
    if (point.idlePct! !== best.idlePct!) return point.idlePct! > best.idlePct! ? point : best
    if (point.operatingHours !== best.operatingHours) return point.operatingHours > best.operatingHours ? point : best
    return point.day < best.day ? point : best
  })
  const short = days.length - counting.length
  const shortNote = short === 0
    ? ""
    : short === 1
      ? " 1 día tuvo menos de 1 h de motor y no dibuja porcentaje."
      : ` ${countOf(short, "día")} tuvieron menos de 1 h de motor y no dibujan porcentaje.`
  return `El día con más tiempo en vacío fue el ${formatDate(worst.day)}: ${formatQty(worst.idlePct!, undefined, { maximumFractionDigits: 0 })} % de ${formatQty(worst.operatingHours, undefined, { maximumFractionDigits: 1 })} h de motor.${shortNote}`
}

/** «Ver datos» del gráfico diario: las horas de cada día y el % sólo donde el gráfico lo dibuja (≥ 1 h de motor). */
export function idleDailyTable(days: readonly IdleDay[]): { headers: string[]; rows: string[][] } {
  return {
    headers: ["Día", "Horas de motor", "Horas en vacío", "% en vacío"],
    rows: days.map((point) => [
      formatDate(point.day),
      hoursText(point.operatingHours),
      hoursText(point.idleHours),
      point.operatingHours >= MIN_IDLE_DAY_HOURS && point.idlePct !== null ? `${formatQty(point.idlePct, undefined, { maximumFractionDigits: 1 })} %` : MISSING,
    ]),
  }
}
