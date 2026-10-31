import { fuelPeriodBounds } from "@/lib/combustibles/period/parse"
import type { FuelPeriod, FuelPeriodKind } from "@/lib/combustibles/period/types"
import { formatQty, MONTH_LABELS, MONTH_NAMES, todayInChile } from "@/lib/utils"

/**
 * Textos cortos del Panel. Puro: los usan la tira de pasos, las cifras y los
 * Client Components por igual. Las fechas son civiles de Chile ("YYYY-MM-DD") y
 * no pasan por `toLocaleDateString` (su resultado cambia con el navegador).
 */

function parts(plainDate: string): [number, number, number] {
  const [year = 0, month = 1, day = 1] = plainDate.split("-").map(Number)
  return [year, month, day]
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** «31 oct»; con el año («31 oct 2025») cuando no es el año en curso. */
export function formatShortDay(plainDate: string, today = todayInChile()): string {
  const [year, month, day] = parts(plainDate)
  const label = (MONTH_LABELS[month - 1] ?? "").toLowerCase()
  return year === Number(today.slice(0, 4)) ? `${day} ${label}` : `${day} ${label} ${year}`
}

/**
 * «de octubre», «de la semana del 26 de octubre», «del 3.er trimestre»: el
 * complemento «de …» de un período, con la contracción que pide «el».
 */
export function ofPeriod(inLabel: string): string {
  return inLabel.startsWith("el ") ? `del ${inLabel.slice(3)}` : `de ${inLabel}`
}

/** «3,1 %»: un porcentaje dentro de una frase, con el espacio de la prosa en español. */
export function formatPercentText(value: number, maximumFractionDigits = 1): string {
  return `${formatQty(value, undefined, { maximumFractionDigits })} %`
}

/** «septiembre» a partir de «2026-09». */
export function monthNameOfKey(monthKey: string): string {
  const [, month] = parts(`${monthKey}-01`)
  return MONTH_NAMES[month - 1] ?? monthKey
}

/**
 * Desde cuándo espera algo, en palabras. `waitingSince` es un instante; se
 * cuenta por día civil de Chile, no por horas: algo que llegó ayer a las 23:00
 * «espera desde ayer», no «hace 3 horas».
 */
export function waitingPhrase(waitingSince: string, today = todayInChile()): string {
  const day = todayInChile(new Date(waitingSince))
  const days = daysBetween(day, today)
  if (days <= 0) return "Llegó hoy"
  if (days === 1) return "Espera desde ayer"
  return `Espera hace ${days} días`
}

const PERIOD_NOUN_PLURAL: Record<FuelPeriodKind, string> = {
  week: "semanas",
  month: "meses",
  quarter: "trimestres",
  year: "años",
  range: "períodos",
}

/** «meses», «semanas»…: lo que cuentan las barras de la historia. */
export function periodNounPlural(kind: FuelPeriodKind): string {
  return PERIOD_NOUN_PLURAL[kind]
}

/** Rótulo corto bajo cada barra de la historia: «oct», «26 oct», «4T 26», «2026». */
export function historyLabel(period: FuelPeriod, today = todayInChile()): string {
  switch (period.kind) {
    case "month":
      return (MONTH_LABELS[period.month - 1] ?? "").toLowerCase()
    case "quarter":
      return `${period.quarter}T ${String(period.year).slice(2)}`
    case "year":
      return String(period.year)
    case "week":
    case "range":
      return formatShortDay(fuelPeriodBounds(period).from, today).replace(/ \d{4}$/, "")
  }
}

/** Días que tiene un período (inclusivo en ambos extremos). */
export function periodLengthDays(from: string, to: string): number {
  return daysBetween(from, to) + 1
}

/** Días transcurridos de un período en curso, contando hoy; acotado a su largo. */
export function elapsedPeriodDays(from: string, to: string, today = todayInChile()): number {
  return Math.min(periodLengthDays(from, to), Math.max(0, daysBetween(from, today) + 1))
}
