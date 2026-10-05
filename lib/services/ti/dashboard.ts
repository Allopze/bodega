/**
 * Helpers puros del tablero Resumen de TI (sin base de datos, para probarlos
 * sin PGlite).
 */

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

/** "2026-09" -> "sep 2026". */
export function monthLabel(month: string): string {
  const [year, mm] = month.split("-")
  const name = MONTHS_ES[Number(mm) - 1]
  return name ? `${name} ${year}` : month
}

export interface MaintenanceMonthPoint { month: string; label: string; cost: number; count: number }

/**
 * Los últimos `months` meses terminando en el mes de `today` (YYYY-MM-DD, hora
 * de Chile), con ceros donde no hubo intervenciones: omitir los meses vacíos
 * comprimía el eje y hacía parecer continuo un gasto intermitente.
 */
export function fillMaintenanceMonths(
  rows: { month: string; cost: number; count: number }[],
  today: string,
  months = 12,
): MaintenanceMonthPoint[] {
  const byMonth = new Map(rows.map((row) => [row.month, row]))
  let year = Number(today.slice(0, 4))
  let month = Number(today.slice(5, 7))
  const out: MaintenanceMonthPoint[] = []
  for (let i = 0; i < months; i++) {
    const key = `${year}-${String(month).padStart(2, "0")}`
    const row = byMonth.get(key)
    out.unshift({ month: key, label: monthLabel(key), cost: row?.cost ?? 0, count: row?.count ?? 0 })
    month -= 1
    if (month === 0) { month = 12; year -= 1 }
  }
  return out
}

/** Tick de dinero compacto ("$1,2M", "$350 mil") para que el eje no se recorte. */
export function compactCLP(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toLocaleString("es-CL", { maximumFractionDigits: 1 })}M`
  if (abs >= 1_000) return `$${Math.round(value / 1_000).toLocaleString("es-CL")} mil`
  return `$${Math.round(value).toLocaleString("es-CL")}`
}
