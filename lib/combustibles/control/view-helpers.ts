import { MONTH_LABELS } from "@/lib/utils"
import type { PerformanceUnit } from "./contracts"
import { CONTROL_FILTER_PARAMS, controlFiltersToParams, type ControlFilters } from "./filters"

/**
 * Funciones puras de las vistas G y R: ordenan en tablas cruzadas lo que SQL ya
 * agregó, y calculan las razones y diferencias que se muestran. Nada aquí
 * promedia ni suma datos crudos: solo reordena agregados.
 */

export const NO_MEDIUM_KEY = "_none"
export const NO_MEDIUM_LABEL = "Sin medio informado"

/** Dispersión: sobre este coeficiente de variación la fila se marca (ámbar + texto). */
export const CV_ALERT_THRESHOLD = 0.25
/** Un equipo "rinde peor" cuando se aleja más de este % de su referencia, en la dirección mala. */
export const WORSE_PERFORMANCE_THRESHOLD_PCT = 10

/* ── Meses ───────────────────────────────────────────────────────────────── */

export function monthShortLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-")
  const label = MONTH_LABELS[Number(month) - 1] ?? monthKey
  return `${label} ${String(year).slice(2)}`
}

export function monthFullLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-")
  const label = MONTH_LABELS[Number(month) - 1] ?? monthKey
  return `${label} ${year}`
}

/** Todos los meses "YYYY-MM" entre el primero y el último, sin huecos. */
export function fillMonthKeys(keys: string[]): string[] {
  if (keys.length === 0) return []
  const sorted = [...new Set(keys)].sort()
  const [startYear, startMonth] = sorted[0]!.split("-").map(Number) as [number, number]
  const [endYear, endMonth] = sorted[sorted.length - 1]!.split("-").map(Number) as [number, number]
  const out: string[] = []
  let year = startYear
  let month = startMonth
  while (year < endYear || (year === endYear && month <= endMonth)) {
    out.push(`${year}-${String(month).padStart(2, "0")}`)
    month += 1
    if (month > 12) { month = 1; year += 1 }
  }
  return out
}

/* ── Litros por mes y medio (G-02) ───────────────────────────────────────── */

export interface MonthMediumRow {
  month: string
  mediumId: string | null
  mediumName: string | null
  mediumOrder: number | null
  liters: number
}

export interface MonthlyMediumChartData {
  /** `key` es un identificador seguro para `dataKey` (m0, m1…); `label` es el nombre del medio. */
  series: Array<{ key: string; label: string }>
  points: Array<{ month: string; label: string; fullLabel: string; total: number } & Record<string, number | string>>
}

export function pivotMonthlyByMedium(rows: MonthMediumRow[]): MonthlyMediumChartData {
  const media = new Map<string, { label: string; order: number }>()
  for (const row of rows) {
    const key = row.mediumId ?? NO_MEDIUM_KEY
    if (!media.has(key)) {
      media.set(key, {
        label: row.mediumId ? (row.mediumName ?? row.mediumId) : NO_MEDIUM_LABEL,
        order: row.mediumId ? (row.mediumOrder ?? 0) : Number.MAX_SAFE_INTEGER,
      })
    }
  }
  const ordered = [...media.entries()].sort((left, right) => left[1].order - right[1].order || left[1].label.localeCompare(right[1].label, "es"))
  const seriesKey = new Map(ordered.map(([mediumKey], index) => [mediumKey, `m${index}`]))
  const series = ordered.map(([mediumKey, value]) => ({ key: seriesKey.get(mediumKey)!, label: value.label }))

  const byMonth = new Map<string, Record<string, number>>()
  for (const row of rows) {
    const bucket = byMonth.get(row.month) ?? {}
    const key = seriesKey.get(row.mediumId ?? NO_MEDIUM_KEY)!
    bucket[key] = (bucket[key] ?? 0) + row.liters
    byMonth.set(row.month, bucket)
  }
  const points = fillMonthKeys([...byMonth.keys()]).map((month) => {
    const bucket = byMonth.get(month) ?? {}
    const point: MonthlyMediumChartData["points"][number] = { month, label: monthShortLabel(month), fullLabel: monthFullLabel(month), total: 0 }
    for (const { key } of series) {
      const value = bucket[key] ?? 0
      point[key] = value
      point.total += value
    }
    return point
  })
  return { series, points }
}

/* ── Tabla cruzada faena × medio (G-03, G-04) ────────────────────────────── */

export interface CrosstabInputRow {
  worksiteId: string
  worksiteName: string
  mediumId: string | null
  mediumName: string | null
  mediumOrder: number | null
  liters: number
}

export interface Crosstab {
  columns: Array<{ key: string; label: string }>
  rows: Array<{ worksiteId: string; worksiteName: string; cells: Record<string, number>; total: number }>
  columnTotals: Record<string, number>
  grandTotal: number
}

/** El orden de las filas es el de entrada (SQL ya las trae por total descendente). */
export function buildCrosstab(rows: CrosstabInputRow[]): Crosstab {
  const media = new Map<string, { label: string; order: number }>()
  const worksiteRows = new Map<string, Crosstab["rows"][number]>()
  for (const row of rows) {
    const key = row.mediumId ?? NO_MEDIUM_KEY
    if (!media.has(key)) {
      media.set(key, {
        label: row.mediumId ? (row.mediumName ?? row.mediumId) : NO_MEDIUM_LABEL,
        order: row.mediumId ? (row.mediumOrder ?? 0) : Number.MAX_SAFE_INTEGER,
      })
    }
    const entry = worksiteRows.get(row.worksiteId) ?? { worksiteId: row.worksiteId, worksiteName: row.worksiteName, cells: {}, total: 0 }
    entry.cells[key] = (entry.cells[key] ?? 0) + row.liters
    entry.total += row.liters
    worksiteRows.set(row.worksiteId, entry)
  }
  const columns = [...media.entries()]
    .sort((left, right) => left[1].order - right[1].order || left[1].label.localeCompare(right[1].label, "es"))
    .map(([key, value]) => ({ key, label: value.label }))
  const columnTotals: Record<string, number> = {}
  let grandTotal = 0
  for (const entry of worksiteRows.values()) {
    for (const [key, liters] of Object.entries(entry.cells)) columnTotals[key] = (columnTotals[key] ?? 0) + liters
    grandTotal += entry.total
  }
  return { columns, rows: [...worksiteRows.values()], columnTotals, grandTotal }
}

/* ── Razones globales (G-06, G-07 y cabecera) ────────────────────────────── */

/** km/L = Σkm ÷ Σlitros; L/h = Σlitros ÷ Σhoras. `null` si el divisor no es positivo. */
export function globalRatio(unit: PerformanceUnit, measureSum: number, litersSum: number): number | null {
  if (unit === "km_per_liter") return litersSum > 0 ? measureSum / litersSum : null
  return measureSum > 0 ? litersSum / measureSum : null
}

/* ── Dispersión y comparaciones (R-02, R-06) ─────────────────────────────── */

export function coefficientOfVariation(mean: number | null, sd: number | null): number | null {
  if (mean === null || sd === null || !(mean > 0)) return null
  return sd / mean
}

/** Variación porcentual de `value` respecto de `reference`; `null` si no hay referencia utilizable. */
export function deltaPct(value: number | null, reference: number | null): number | null {
  if (value === null || reference === null || !(reference > 0)) return null
  return ((value - reference) / reference) * 100
}

/** km/L: menos es peor. L/h: más es peor. */
export function isWorsePerformance(unit: PerformanceUnit, delta: number | null, thresholdPct = WORSE_PERFORMANCE_THRESHOLD_PCT): boolean {
  if (delta === null) return false
  return unit === "km_per_liter" ? delta < -thresholdPct : delta > thresholdPct
}

/* ── Período (para el histórico del equipo) ──────────────────────────────── */

/** Primer día del período en "YYYY-MM-DD": el `desde` del rango, o el 1.º del primer mes elegido. */
export function periodStartPlainDate(filters: Pick<ControlFilters, "year" | "months" | "from">): string {
  if (filters.from) return filters.from
  const month = filters.months.length ? Math.min(...filters.months) : 1
  return `${filters.year}-${String(month).padStart(2, "0")}-01`
}

/** Resta meses a una fecha "YYYY-MM-DD" (el día se acota al fin del mes destino). */
export function shiftPlainDateByMonths(plain: string, months: number): string {
  const [year, month, day] = plain.split("-").map(Number) as [number, number, number]
  const index = year * 12 + (month - 1) + months
  const targetYear = Math.floor(index / 12)
  const targetMonth = (index % 12) + 1
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate()
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`
}

/* ── Enlaces entre vistas ────────────────────────────────────────────────── */

type SearchParams = Record<string, string | string[] | undefined>

/** Parámetros de filtro de la URL como cadenas simples (para exportar); descarta la paginación. */
export function pickControlParams(sp: SearchParams): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of CONTROL_FILTER_PARAMS) {
    if (key === "pagina") continue
    const raw = Array.isArray(sp[key]) ? sp[key]![0] : sp[key]
    if (typeof raw === "string" && raw.trim()) out[key] = raw.trim()
  }
  return out
}

/** Cola de revisión con los mismos filtros de la vista (la familia viaja como `familia`). */
export function revisionHref(filters: ControlFilters): string {
  const params = controlFiltersToParams({ ...filters, page: 1 })
  if (filters.family) params.set("familia", filters.family)
  return `/combustibles/control/revision?${params.toString()}`
}
