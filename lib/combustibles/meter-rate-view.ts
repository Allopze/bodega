import { MONTH_NAMES, countOf, formatQty } from "@/lib/utils"
import { PERFORMANCE_UNIT_LABELS } from "./control/contracts"
import { monthFullLabel, monthShortLabel } from "./control/view-helpers"
import { MIN_RATE_SEGMENTS, type MeterRateMonth, type MeterRateSeries } from "./meter-rate-series"

/**
 * Presentación del rendimiento por mes (CHART-016): lo que el gráfico y su «Ver
 * datos» muestran, en funciones puras para que los dos digan lo mismo y se puedan
 * probar sin dibujar SVG. El cálculo está en `meter-rate-series.ts`.
 */

const MISSING = "—"
const num = (value: number, digits = 0) => formatQty(value, undefined, { maximumFractionDigits: digits })

/** Banda alrededor del global que se dibuja: ±10 %, la tolerancia con que el resto de Consumo juzga «rinde peor». */
export const RATE_BAND_PCT = 10

/** Rótulo bajo cada mes del eje: su n, o por qué no hay rendimiento. */
export function monthCaption(month: MeterRateMonth): string {
  return month.status === "gap" ? "sin datos" : `n=${month.segments}`
}

function monthTitle(month: string): string {
  const name = MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${month.slice(0, 4)}`
}

export interface MeterRateChartRow extends MeterRateMonth {
  /** «Oct 26», para el eje. */
  label: string
  /** «Octubre 2026 (en curso)», para el tooltip. */
  fullLabel: string
  caption: string
}

export function meterRateChartData(series: MeterRateSeries): { data: MeterRateChartRow[]; partialFrom: number } {
  const data = series.months.map((month) => ({
    ...month,
    label: monthShortLabel(month.month),
    fullLabel: `${monthTitle(month.month)}${month.partial ? " (en curso)" : ""}`,
    caption: monthCaption(month),
  }))
  return { data, partialFrom: data.findIndex((row) => row.partial) }
}

/**
 * Dominio del eje del rendimiento: encierra la serie y la banda del global con
 * aire. Una línea no necesita partir en 0 —la pregunta es si se degrada, y con un
 * eje desde 0 una caída de 10 % no se vería—, pero nunca baja de 0.
 */
export function rateAxisDomain(rates: readonly number[], globalRate: number | null): [number, number] {
  const values = [...rates]
  if (globalRate !== null) values.push(globalRate * (1 - RATE_BAND_PCT / 100), globalRate * (1 + RATE_BAND_PCT / 100))
  if (values.length === 0) return [0, 1]
  const low = Math.min(...values)
  const high = Math.max(...values)
  const pad = Math.max((high - low) * 0.2, high * 0.05)
  return [Math.max(0, Math.floor((low - pad) * 10) / 10), Math.ceil((high + pad) * 10) / 10]
}

function observation(month: MeterRateMonth): string {
  const parts: string[] = []
  if (month.status === "gap") parts.push("Sin datos del proveedor")
  else if (month.status === "insufficient") parts.push("Datos insuficientes")
  if (month.partial) parts.push("mes en curso")
  if (month.discarded > 0) parts.push(`${countOf(month.discarded, "par descartado", "pares descartados")}`)
  if (parts.length === 0) return MISSING
  return `${parts[0]!.charAt(0).toUpperCase()}${parts[0]!.slice(1)}${parts.slice(1).map((part) => ` · ${part}`).join("")}`
}

/** «Ver datos»: la tabla que respalda el gráfico, mes por mes. */
export function meterRateTable(series: MeterRateSeries): { headers: string[]; rows: string[][] } {
  const unit = PERFORMANCE_UNIT_LABELS[series.unit]
  const measureHeader = series.unit === "km_per_liter" ? "Kilómetros" : "Horas"
  const rows = series.months.map((month) => {
    const gap = month.status === "gap"
    return [
      monthFullLabel(month.month),
      month.rate === null ? MISSING : num(month.rate, 2),
      gap ? MISSING : num(month.segments),
      gap ? MISSING : num(month.equipment),
      gap ? MISSING : num(month.measure),
      gap ? MISSING : num(month.liters),
      observation(month),
    ]
  })
  return { headers: ["Mes", `Rendimiento (${unit})`, "Tramos (n)", "Equipos", measureHeader, "Litros", "Observación"], rows }
}

/** Avisos bajo el gráfico: qué es n, qué meses quedaron en blanco y por qué, y el alcance de la fuente. */
export function meterRateNotes(series: MeterRateSeries): string[] {
  const gaps = series.months.filter((month) => month.status === "gap").length
  const insufficient = series.months.filter((month) => month.status === "insufficient").length
  const discarded = series.months.reduce((sum, month) => sum + month.discarded, 0)
  const notes = [`n = tramos: pares de cargas consecutivas con lectura del medidor. Un mes necesita al menos ${MIN_RATE_SEGMENTS} para mostrar su rendimiento.`]
  if (gaps > 0) notes.push(`${countOf(gaps, "mes sin datos del proveedor", "meses sin datos del proveedor")}: queda en blanco, no es un rendimiento de cero.`)
  if (insufficient > 0) notes.push(`${countOf(insufficient, "mes con datos insuficientes", "meses con datos insuficientes")}.`)
  if (discarded > 0) notes.push(`${countOf(discarded, "par de lecturas descartado", "pares de lecturas descartados")} por lectura dudosa, sin litros o sin datos entre medio.`)
  notes.push("Sólo cuenta lo cargado con tarjeta Copec: si el equipo también carga en otro lado, el rendimiento real es menor.")
  return notes
}
