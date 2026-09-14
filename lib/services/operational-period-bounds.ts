/**
 * Límites de calendario que usa el centro operacional.
 *
 * Este módulo es deliberadamente puro: no importa la base de datos ni ningún
 * servicio server-only. El alcance del dashboard también se consume desde
 * Client Components para construir enlaces, por lo que el cálculo de fechas
 * debe poder viajar al navegador sin arrastrar `postgres`.
 */

/** Largo de la ventana que compara el dashboard. Calendario, no rolling. */
export type OperationalPeriodSpan = "mes" | "trimestre" | "anio"

export interface OperationalPeriodBounds {
  currentStart: string
  currentEnd: string
  previousStart: string
  previousEnd: string
}

function isoStartOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 1)).toISOString()
}

/**
 * Ventanas del período en curso y del inmediatamente anterior, en calendario
 * chileno.
 *
 * `isoStartOfMonth` acepta meses fuera de `0..11` porque `Date.UTC` normaliza el
 * desborde, así que trimestre y año se expresan con la misma primitiva sin
 * aritmética de fechas propia: enero menos un mes cae en diciembre del año
 * anterior solo.
 */
export function getOperationalCalendarBounds(
  now = new Date(),
  period: OperationalPeriodSpan = "mes",
): OperationalPeriodBounds {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago", year: "numeric", month: "2-digit",
  }).formatToParts(now)
  const year = Number(dateParts.find((part) => part.type === "year")?.value)
  const month = Number(dateParts.find((part) => part.type === "month")?.value) - 1

  // Mes de inicio del período que contiene a `month`, y su largo en meses.
  const [startMonth, span] = period === "anio"
    ? [0, 12]
    : period === "trimestre"
      ? [Math.floor(month / 3) * 3, 3]
      : [month, 1]

  const currentStart = isoStartOfMonth(year, startMonth)
  return {
    currentStart,
    currentEnd: isoStartOfMonth(year, startMonth + span),
    previousStart: isoStartOfMonth(year, startMonth - span),
    previousEnd: currentStart,
  }
}
