import { chileDateParts, chileWallClockDate } from "@/lib/utils"

/**
 * Fechas para celdas de Excel.
 *
 * Los exports escribían las fechas como texto (`2026-10-19 18:34:14.564+00`): en UTC, sin
 * poder ordenarse ni filtrarse como fechas, y 3 horas adelantadas respecto de la pantalla.
 * Estos helpers entregan un `Date` que ExcelJS escribe como celda de fecha real, mostrando la
 * hora de pared de Chile. Úsalos junto con `columnFormats` del reporte.
 */

export const EXCEL_DATE_FORMAT = "dd-mm-yyyy"
export const EXCEL_DATETIME_FORMAT = "dd-mm-yyyy hh:mm"

const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function parseInstant(value: string | Date): Date | null {
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Instante (`timestamptz` como texto o `Date`) → celda con fecha y hora de Chile.
 * Una fecha calendario («2026-10-19») no tiene hora que convertir: pasa sin desfase.
 * Devuelve `null` si el valor está vacío o no es una fecha.
 */
export function excelDateTime(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "string" && PLAIN_DATE.test(value)) return excelPlainDate(value)
  const instant = parseInstant(value)
  return instant ? chileWallClockDate(instant) : null
}

/**
 * Fecha calendario → celda de fecha sin hora. `«YYYY-MM-DD»` se toma tal cual; un instante se
 * lleva al día civil de Chile. Devuelve `null` si el valor está vacío o no es una fecha.
 */
export function excelPlainDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "string") {
    const match = PLAIN_DATE.exec(value)
    if (match) {
      const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
      return Number.isNaN(date.getTime()) ? null : date
    }
  }
  const instant = parseInstant(value)
  if (!instant) return null
  const { year, month, day } = chileDateParts(instant)
  return new Date(Date.UTC(year, month - 1, day))
}
