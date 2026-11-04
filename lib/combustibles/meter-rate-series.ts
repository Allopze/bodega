import { MONTH_NAMES, countOf, formatQty } from "@/lib/utils"
import { PERFORMANCE_UNIT_LABELS, type PerformanceUnit } from "./control/contracts"
import { globalRatio } from "./control/view-helpers"
import { meterSeriesSegments, type MeterSeriesPoint } from "./meter-series"

/**
 * Rendimiento por mes (km/L o L/h) derivado de las lecturas de medidor del
 * detalle de Copec (`fuel_meter_readings`). CHART-016, fase 0b.5 de
 * `AUDITORIA_VISUALIZACIONES_CHOME.md`.
 *
 * Por qué no sale de `fuel_equipment_loads`: esa serie sólo existe con cargas en
 * terreno o planilla, y producción tiene 0; en cambio hay miles de lecturas de
 * odómetro de Copec que nadie leía para esto.
 *
 * El método es el de «de llenado a llenado», el mismo que ya usa el rendimiento
 * por carga (`meter-performance.ts`): entre dos lecturas consecutivas de un mismo
 * equipo el medidor avanzó `Δ` y, para ir de una a otra, el equipo consumió los
 * litros de la carga que cierra el par.
 *
 * - **Qué pares valen** lo decide `meterSeriesSegments`, la misma regla con que el
 *   detector de anomalías objeta una lectura y con que Flota calcula el recorrido:
 *   un retroceso o un salto imposible no se suma, un reset aceptado parte la serie.
 * - **Qué mes es de un par**: el de su lectura final.
 * - **El mes es la razón de las sumas** (Σkm ÷ ΣL; ΣL ÷ Σh), nunca el promedio de
 *   las razones de cada tramo: el promedio de razones deja que una carga chica pese
 *   como una grande.
 * - **Un par que cruza un mes sin datos del proveedor se descarta.** Si la
 *   integración no trajo nada de abril, el par marzo → mayo recorre dos meses con los
 *   litros de una sola carga y daría un rendimiento inflado.
 * - Un par sin litros, sin avance o con un rendimiento fuera de la cota física
 *   (`maxKmPerLiter`, `maxLitersPerHour`) tampoco entra: descartar un par entero
 *   (km y litros a la vez) no sesga la razón del resto.
 * - Con menos de `MIN_RATE_SEGMENTS` tramos el mes no tiene rendimiento
 *   («datos insuficientes»); sus cifras igual se informan.
 *
 * Limitación declarada: sólo se ven las cargas con tarjeta Copec. Si el equipo
 * también carga en otro lado (estanque propio, otra tarjeta), el kilometraje
 * incluye litros que acá no están y el km/L sale más alto que el real.
 */

/** Tramos mínimos para decir un rendimiento. Con menos, una sola carga mueve la cifra. */
export const MIN_RATE_SEGMENTS = 3

export interface RateReading extends MeterSeriesPoint {
  /** Litros de la carga de esta lectura; `null` si el informe no los trae. */
  liters: number | null
}

export interface RateVehicle {
  vehicleId: string
  /** Unidad en que rinde el equipo: odómetro → km/L, horómetro → L/h. */
  unit: PerformanceUnit
  /** Cota diaria de avance del medidor (regla `salto_medidor_implausible`, con su override por tipo). */
  maxPerDay: number
  /** Lecturas de UNA fuente y UN tipo de medidor, ordenadas por instante. Pueden incluir el mes previo a la ventana como base. */
  readings: RateReading[]
}

export interface RateLimits {
  maxKmPerLiter: number
  maxLitersPerHour: number
}

/** `gap`: el proveedor no trajo datos del mes. `insufficient`: hay datos pero menos tramos que el mínimo. */
export type MeterRateMonthStatus = "ok" | "insufficient" | "gap"

export interface MeterRateMonth {
  month: string
  /** Σ avance del medidor (km u horas) de los tramos que cuentan. */
  measure: number
  /** Σ litros de esos mismos tramos. */
  liters: number
  /** n: tramos que cuentan en el mes. */
  segments: number
  /** Equipos distintos que aportan al mes. */
  equipment: number
  /** Pares que no se usaron (objetados por el detector, sin litros, sin avance, imposibles o que cruzan un mes sin datos). */
  discarded: number
  /** km/L o L/h; `null` si el mes es un hueco o tiene datos insuficientes. */
  rate: number | null
  status: MeterRateMonthStatus
  /** El mes todavía no termina. */
  partial: boolean
}

export interface MeterRateSeries {
  unit: PerformanceUnit
  months: MeterRateMonth[]
  /** Global de la ventana (razón de sumas); `null` con datos insuficientes. */
  rate: number | null
  measure: number
  liters: number
  segments: number
  equipment: number
  discarded: number
  /** Lecturas dentro de la ventana (la base del mes previo no cuenta). `0` ⇒ no hay nada que dibujar. */
  readings: number
  status: "ok" | "insufficient" | "empty"
}

export interface BuildMeterRateInput {
  vehicles: RateVehicle[]
  /** Meses «YYYY-MM» de la ventana, en orden. */
  monthKeys: string[]
  /** Primer día («YYYY-MM-DD») de lo que se dibuja, si no es el 1 del primer mes. Un par cuya lectura final es anterior no entra. */
  fromDate?: string
  /** Meses sin datos del proveedor (`monthsWithoutProviderData`), incluido el previo a la ventana si se consultó. */
  gapMonths: ReadonlySet<string>
  /** Mes que aún no termina (`isPartialMonth`). */
  partialMonth?: string | null
  limits: RateLimits
  minSegments?: number
}

const monthOf = (instant: string) => instant.slice(0, 7)

/** Meses estrictamente entre dos meses «YYYY-MM». */
function monthsBetween(from: string, to: string): string[] {
  const keys: string[] = []
  let year = Number(from.slice(0, 4))
  let month = Number(from.slice(5, 7))
  for (let guard = 0; guard < 120; guard++) {
    month += 1
    if (month > 12) { month = 1; year += 1 }
    const key = `${year}-${String(month).padStart(2, "0")}`
    if (key >= to) break
    keys.push(key)
  }
  return keys
}

interface Bucket { measure: number; liters: number; segments: number; discarded: number; vehicles: Set<string> }
const emptyBucket = (): Bucket => ({ measure: 0, liters: 0, segments: 0, discarded: 0, vehicles: new Set() })

export function buildMeterRateSeries(input: BuildMeterRateInput): Record<PerformanceUnit, MeterRateSeries> {
  const { vehicles, monthKeys, fromDate, gapMonths, partialMonth = null, limits, minSegments = MIN_RATE_SEGMENTS } = input
  const inWindow = new Set(monthKeys)
  /** ¿La lectura cae dentro de lo que se dibuja? El mes previo sólo es base del primer par. */
  const inRange = (instant: string) => inWindow.has(monthOf(instant)) && (!fromDate || instant.slice(0, 10) >= fromDate)
  const buckets: Record<PerformanceUnit, Map<string, Bucket>> = { km_per_liter: new Map(), liters_per_hour: new Map() }
  const readings: Record<PerformanceUnit, number> = { km_per_liter: 0, liters_per_hour: 0 }
  const bucketOf = (unit: PerformanceUnit, month: string) => {
    const map = buckets[unit]
    const existing = map.get(month)
    if (existing) return existing
    const created = emptyBucket()
    map.set(month, created)
    return created
  }

  for (const vehicle of vehicles) {
    const { unit } = vehicle
    readings[unit] += vehicle.readings.filter((point) => inRange(point.occurredAt)).length

    for (const segment of meterSeriesSegments(vehicle.readings, vehicle.maxPerDay)) {
      if (segment.status === "reset") continue
      const month = monthOf(segment.to.occurredAt)
      if (!inRange(segment.to.occurredAt)) continue
      const bucket = bucketOf(unit, month)

      if (segment.status === "discarded") { bucket.discarded += 1; continue }

      const liters = (segment.to as RateReading).liters
      const crossesGap = monthsBetween(monthOf(segment.from.occurredAt), month).some((between) => gapMonths.has(between))
      if (crossesGap || liters === null || !(liters > 0) || !(segment.advance > 0)) { bucket.discarded += 1; continue }

      const rate = unit === "km_per_liter" ? segment.advance / liters : liters / segment.advance
      const ceiling = unit === "km_per_liter" ? limits.maxKmPerLiter : limits.maxLitersPerHour
      if (rate > ceiling) { bucket.discarded += 1; continue }

      bucket.measure += segment.advance
      bucket.liters += liters
      bucket.segments += 1
      bucket.vehicles.add(vehicle.vehicleId)
    }
  }

  const build = (unit: PerformanceUnit): MeterRateSeries => {
    const all = new Set<string>()
    const months: MeterRateMonth[] = monthKeys.map((month) => {
      const bucket = buckets[unit].get(month) ?? emptyBucket()
      for (const id of bucket.vehicles) all.add(id)
      const gap = gapMonths.has(month)
      const enough = bucket.segments >= minSegments
      return {
        month,
        measure: bucket.measure,
        liters: bucket.liters,
        segments: bucket.segments,
        equipment: bucket.vehicles.size,
        discarded: bucket.discarded,
        rate: !gap && enough ? globalRatio(unit, bucket.measure, bucket.liters) : null,
        status: gap ? "gap" : enough ? "ok" : "insufficient",
        partial: partialMonth === month,
      }
    })
    // Un mes que es hueco no aporta al global aunque (por construcción no debería) trajera tramos.
    const counted = months.filter((month) => month.status !== "gap")
    const measure = counted.reduce((sum, month) => sum + month.measure, 0)
    const liters = counted.reduce((sum, month) => sum + month.liters, 0)
    const segments = counted.reduce((sum, month) => sum + month.segments, 0)
    const enough = segments >= minSegments
    return {
      unit,
      months,
      rate: enough ? globalRatio(unit, measure, liters) : null,
      measure,
      liters,
      segments,
      equipment: all.size,
      discarded: months.reduce((sum, month) => sum + month.discarded, 0),
      readings: readings[unit],
      status: readings[unit] === 0 ? "empty" : enough ? "ok" : "insufficient",
    }
  }

  return { km_per_liter: build("km_per_liter"), liters_per_hour: build("liters_per_hour") }
}

function lastDayOfMonth(month: string): string {
  const [year = 1970, number = 1] = month.split("-").map(Number)
  return `${month}-${String(new Date(Date.UTC(year, number, 0)).getUTCDate()).padStart(2, "0")}`
}

/**
 * ¿El mes todavía no termina? Es el mes donde cae el corte —el fin de la ventana o
 * hoy, lo que ocurra primero— cuando el corte es antes del último día de ese mes.
 * Sólo ese mes puede ser parcial: los anteriores ya cerraron.
 */
export function isPartialMonth(month: string, windowEnd: string, today: string): boolean {
  const cut = windowEnd < today ? windowEnd : today
  return month === cut.slice(0, 7) && cut < lastDayOfMonth(month)
}

const rateText = (value: number) => formatQty(value, undefined, { maximumFractionDigits: 2 })

/**
 * La frase que responde el gráfico, verdadera también en los casos de borde:
 * sin rendimiento global dice «datos insuficientes» y no una cifra; el «último
 * mes» es el último con datos suficientes, y si es el mes en curso lo dice.
 */
export function describeMeterRate(series: MeterRateSeries): string {
  const unit = PERFORMANCE_UNIT_LABELS[series.unit]
  if (series.rate === null) {
    return series.segments === 0
      ? "Datos insuficientes: ningún par de lecturas consecutivas sirvió para calcular un rendimiento."
      : `Datos insuficientes: sólo ${countOf(series.segments, "tramo", "tramos")} con lecturas utilizables; se necesitan al menos ${MIN_RATE_SEGMENTS} para calcular un rendimiento.`
  }
  const head = `En estos meses los equipos rinden ${rateText(series.rate)} ${unit} en conjunto, con ${countOf(series.segments, "tramo", "tramos")} de ${countOf(series.equipment, "equipo", "equipos")}.`
  const last = [...series.months].reverse().find((month) => month.status === "ok" && month.rate !== null)
  if (!last || last.rate === null) return head
  const name = MONTH_NAMES[Number(last.month.slice(5, 7)) - 1] ?? last.month
  const label = last.partial ? `${name} (en curso)` : name
  const delta = ((last.rate - series.rate) / series.rate) * 100
  const versus = Math.abs(delta) < 0.5
    ? "igual al global"
    : `${formatQty(Math.abs(delta), undefined, { maximumFractionDigits: 0 })} % ${delta > 0 ? "más" : "menos"} que el global`
  return `${head} En ${label}: ${rateText(last.rate)} ${unit}, ${versus}.`
}
