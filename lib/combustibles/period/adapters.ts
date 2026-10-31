import { addDaysToPlainDate, chileLocalDateTimeToUtc } from "@/lib/utils"
import type { ResolvedFuelPeriod } from "./types"

/**
 * Traducen el período compartido al filtro que entiende cada consulta
 * existente, para no reescribirlas. Una consulta nueva debería tomar
 * `from`/`to` directamente.
 */

/** Para `ControlFilters` (`lib/combustibles/control/filters.ts`): mes, trimestre o año como meses; el resto como rango. */
export function toControlPeriod(resolved: ResolvedFuelPeriod): { year: number; months: number[]; from: string | null; to: string | null } {
  const { period } = resolved
  switch (period.kind) {
    case "month":
      return { year: period.year, months: [period.month], from: null, to: null }
    case "quarter": {
      const first = period.quarter * 3 - 2
      return { year: period.year, months: [first, first + 1, first + 2], from: null, to: null }
    }
    case "year":
      return { year: period.year, months: [], from: null, to: null }
    default:
      return { year: Number(resolved.from.slice(0, 4)), months: [], from: resolved.from, to: resolved.to }
  }
}

/** Rango civil inclusivo (cargas, TAE, TCT por solapamiento, ciclo). */
export function toDateRange(resolved: ResolvedFuelPeriod): { from: string; to: string } {
  return { from: resolved.from, to: resolved.to }
}

/** Para `lib/combustibles/queries.ts` (facturas): un mes exacto, o un rango de fechas. */
export function toInvoiceFilters(resolved: ResolvedFuelPeriod): { month?: string; startDate?: string; endDate?: string } {
  if (resolved.period.kind === "month") return { month: resolved.monthKeys[0] }
  return { startDate: resolved.from, endDate: resolved.to }
}

/** Meses "YYYY-MM" de los estados de cuenta y la cobertura de Copec. */
export function toStatementMonths(resolved: ResolvedFuelPeriod): string[] {
  return resolved.monthKeys
}

/**
 * Instantes UTC del inicio y del fin (exclusivo) del período en hora de Chile.
 * Reemplaza `new Date(`${from}T00:00:00.000`).toISOString()`, que mide en la
 * zona del proceso (UTC en producción) y corría los límites del ciclo 3–4 horas.
 */
export function toChileInstantRange(resolved: ResolvedFuelPeriod): { start: string; endExclusive: string } {
  return {
    start: chileLocalDateTimeToUtc(`${resolved.from}T00:00`),
    endExclusive: chileLocalDateTimeToUtc(`${addDaysToPlainDate(resolved.to, 1)}T00:00`),
  }
}

/**
 * Las tarjetas (Copec, Aramco) informan un total por patente y mes. Con una
 * semana o un rango, la consulta trae los meses completos que toca el período;
 * esta nota lo dice en pantalla en vez de mostrar una precisión falsa.
 */
export function monthlyGranularityNote(resolved: ResolvedFuelPeriod): string | null {
  if (resolved.isWholeMonths) return null
  const months = resolved.monthKeys.length
  return months === 1
    ? "Las tarjetas informan un total por mes: se muestra el mes completo que toca el período."
    : `Las tarjetas informan un total por mes: se muestran los ${months} meses completos que toca el período.`
}
