import { and, inArray, sql, type SQLWrapper } from "drizzle-orm"
import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { systemSettings } from "@/db/schema"
import { db } from "@/db"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"
import { todayInChile, trailingDaysRange } from "@/lib/utils"
import type { AnalyticsFilters, SpendByMonthRow, WorksiteSpendRow, VehicleCostRow } from "./types"

export const ACTIVE_ORDER_STATUSES = ["sent", "partially_office_received", "office_received", "partially_received", "received", "closed"]

export const REQUEST_TYPE_LABELS: Record<string, string> = { epp: "EPP", stock: "Stock", mantencion: "Mantención", otro: "Otros", repuestos: "Repuestos", servicios: "Servicios" }

export interface AnalyticsAlertThresholds {
  vehicleMonthlyAnomalyAmount: number; supplierConcentrationPct: number; eppRecurringDeliveryCount: number
}

export const DEFAULT_ALERT_THRESHOLDS: AnalyticsAlertThresholds = { vehicleMonthlyAnomalyAmount: 5_000_000, supplierConcentrationPct: 60, eppRecurringDeliveryCount: 3 }

/**
 * Sin fechas, los últimos 30 días hasta HOY (día civil de Chile): un rango más ancho
 * que «mes en curso» para que el tablero abierto a principios de mes (o de una faena
 * con poca actividad) no aparezca vacío.
 *
 * Es el mismo rango que el acceso rápido «Últimos 30 días» de `PeriodControl`
 * (`trailingDaysRange`): así la pantalla abre con ese acceso marcado y «Volver a los
 * últimos 30 días» dice exactamente lo que restablece. Antes terminaba en el día del
 * servidor y empezaba 31 días antes (hoy-30), un día más ancho que el acceso rápido,
 * y ninguno aparecía seleccionado.
 */
export function normalizeAnalyticsFilters(input: AnalyticsFilters, now: Date = new Date()) {
  const trailing = trailingDaysRange(30, todayInChile(now))
  return {
    fromDate: input.fromDate ?? trailing.from, toDate: input.toDate ?? trailing.to,
    ...(input.worksiteId ? { worksiteId: input.worksiteId } : {}),
    ...(input.supplierId ? { supplierId: input.supplierId } : {}),
    ...(input.vehicleId ? { vehicleId: input.vehicleId } : {}),
    ...(input.requestType ? { requestType: input.requestType } : {}),
  }
}

export function previousPeriod(fromDate: string, toDate: string) {
  const from = parsePlainDate(fromDate); const to = parsePlainDate(toDate)
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1)
  const previousTo = new Date(from); previousTo.setDate(previousTo.getDate() - 1)
  const previousFrom = new Date(previousTo); previousFrom.setDate(previousFrom.getDate() - days + 1)
  return { fromDate: dateOnly(previousFrom), toDate: dateOnly(previousTo) }
}

/**
 * ANA-001 (auditoría 2026-09-14): el corte de período de Analítica es el **día
 * civil chileno**, no el instante UTC.
 *
 * Antes esto comparaba la columna cruda contra `fromDate` y
 * `` `${toDate}T23:59:59` ``, sin zona: sobre columnas `timestamptz` la
 * comparación ocurre en la zona de la sesión de base de datos (UTC en el
 * despliegue), de modo que el "día" analítico iba de las 21:00 del día anterior
 * a las 20:59 del día chileno. Una OC creada a las 22:00 del último día del mes
 * contaba en el mes siguiente y las cifras no cuadraban con los módulos que sí
 * usan día civil. Misma forma y misma razón que `chileDayRange` en
 * `lib/combustibles/fuel-cycle.ts`.
 */
export function chileDayExpr(column: SQLWrapper) {
  return sql`(${column} at time zone 'America/Santiago')::date`
}

/** Mes civil chileno de una columna `timestamptz`, para las series mensuales. */
export function chileMonthExpr(column: SQLWrapper) {
  return sql<string>`to_char(${column} at time zone 'America/Santiago', 'YYYY-MM')`
}

/** Rango cerrado `[from, to]` en días civiles chilenos. */
export function chileDayRange(column: SQLWrapper, from: string, to: string) {
  return and(
    sql`${chileDayExpr(column)} >= ${from}::date`,
    sql`${chileDayExpr(column)} <= ${to}::date`,
  )
}

export function dateFilter(filters: Required<Pick<AnalyticsFilters, "fromDate" | "toDate">>, column: SQLWrapper) {
  return chileDayRange(column, filters.fromDate, filters.toDate)
}

export function worksiteFilter(session: Session | null, column: SQLWrapper) {
  if (isGlobalRole(session)) return undefined
  const ids = visibleWorksiteIds(session)
  if (ids.length === 0) return sql`false`
  return inArray(column, ids as never[])
}

/** Gasto de un mes tal como sale de las consultas: sin huecos (eso lo decide `buildMonthlyTrend`) ni `partial`. */
export interface MonthlySpend { month: string; purchasingAmount: number; fuelAmount: number; totalAmount: number }

export function mergeSpendByMonth(rows: Array<{ month: string; module: string; totalAmount: number }>): MonthlySpend[] {
  const byMonth = new Map<string, MonthlySpend>()
  for (const row of rows) {
    const current = byMonth.get(row.month) ?? { month: row.month, purchasingAmount: 0, fuelAmount: 0, totalAmount: 0 }
    if (row.module === "Combustible") current.fuelAmount += row.totalAmount
    else current.purchasingAmount += row.totalAmount
    current.totalAmount += row.totalAmount
    byMonth.set(row.month, current)
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
}

/** Meses que dibuja la «Tendencia mensual de gasto». */
export const MONTHLY_TREND_MONTHS = 12

function addMonthsToKey(monthKey: string, delta: number): string {
  const [year = 1970, month = 1] = monthKey.split("-").map(Number)
  const index = year * 12 + (month - 1) + delta
  return `${Math.floor(index / 12)}-${pad2((index % 12) + 1)}`
}

function lastDayOfMonthKey(monthKey: string): string {
  const [year = 1970, month = 1] = monthKey.split("-").map(Number)
  return `${monthKey}-${pad2(new Date(Date.UTC(year, month, 0)).getUTCDate())}`
}

/**
 * C-10: la ventana de la tendencia mensual son los 12 meses civiles que terminan
 * en el mes de `toDate`, **sin importar `desde`**. Con el período por defecto (30
 * días) la serie era uno o dos puntos y no mostraba tendencia alguna; los KPI
 * siguen midiendo el período elegido. La ventana se corta en `toDate`, no en el
 * fin de su mes: es lo mismo que el usuario eligió para el resto de la pantalla.
 */
export function monthlyTrendWindow(toDate: string): { fromDate: string; toDate: string; months: string[] } {
  const lastMonth = toDate.slice(0, 7)
  const months = Array.from({ length: MONTHLY_TREND_MONTHS }, (_, i) => addMonthsToKey(lastMonth, i - (MONTHLY_TREND_MONTHS - 1)))
  return { fromDate: `${months[0]}-01`, toDate, months }
}

/**
 * Serie mensual completa de la ventana: un punto por mes, con ceros donde no
 * hubo movimiento (un eje con huecos uniría con una línea dos meses lejanos), y
 * `partial` en el mes que no está completo. `today` es el día civil chileno de
 * hoy: un `hasta` a fin de mes futuro tampoco hace completo al mes en curso.
 *
 * Las compras se rellenan con ceros porque ahí un cero es real. El combustible
 * no: en `fuelGapMonths` (meses sin datos del proveedor, ver
 * `monthsWithoutProviderData`) su valor es `null`, para que no se lea como «no se
 * compró combustible».
 */
export function buildMonthlyTrend(
  rows: MonthlySpend[],
  toDate: string,
  today: string,
  fuelGapMonths: ReadonlySet<string> = new Set(),
): SpendByMonthRow[] {
  const { months } = monthlyTrendWindow(toDate)
  const byMonth = new Map(rows.map((row) => [row.month, row]))
  const effectiveEnd = toDate < today ? toDate : today
  const cutMonth = effectiveEnd.slice(0, 7)
  const cutIsPartial = effectiveEnd < lastDayOfMonthKey(cutMonth)
  return months.map((month) => {
    const row = byMonth.get(month)
    return {
      month,
      purchasingAmount: row?.purchasingAmount ?? 0,
      fuelAmount: fuelGapMonths.has(month) ? null : row?.fuelAmount ?? 0,
      totalAmount: row?.totalAmount ?? 0,
      partial: month === cutMonth && cutIsPartial,
    }
  })
}

/**
 * Gasto por tipo con una fila por rótulo. Dos claves distintas pueden compartir rótulo (una línea
 * de OC sin solicitud y el tipo «otro» son ambos «Otros»): sin juntarlas la lista repetía la fila.
 */
export function mergeSpendByModule(rows: Array<{ module: string; totalAmount: number }>): Array<{ module: string; totalAmount: number }> {
  const byModule = new Map<string, number>()
  for (const row of rows) byModule.set(row.module, (byModule.get(row.module) ?? 0) + row.totalAmount)
  return [...byModule.entries()]
    .map(([module, totalAmount]) => ({ module, totalAmount }))
    .filter((row) => row.totalAmount > 0)
    .sort((a, b) => b.totalAmount - a.totalAmount)
}

export function mergeWorksiteSpend(rows: Array<{ id: string; name: string; totalAmount: number }>): WorksiteSpendRow[] {
  const byWorksite = new Map<string, WorksiteSpendRow>()
  for (const row of rows) {
    const current = byWorksite.get(row.id) ?? { id: row.id, name: row.name, totalAmount: 0 }
    current.totalAmount += Number(row.totalAmount ?? 0)
    byWorksite.set(row.id, current)
  }
  return [...byWorksite.values()].filter((r) => r.totalAmount > 0).sort((a, b) => b.totalAmount - a.totalAmount).slice(0, 10)
}

export function variationPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return Math.round(((current - previous) / previous) * 100)
}

export function moduleLabel(value: unknown) {
  return REQUEST_TYPE_LABELS[String(value ?? "otro")] ?? String(value ?? "otro")
}

export function dateOnly(date: Date) { return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` }
/**
 * ISO date `days` before `date`, medida con el día del servidor. Ya no la usa el rango por
 * defecto de Analítica (ahora `trailingDaysRange`, día de Chile); la sigue usando el tablero
 * de consumo de combustible (`lib/combustibles/consumption-dashboard.ts`), que tiene su
 * propio rango por defecto.
 */
export function daysAgo(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() - days)
  return dateOnly(d)
}
export function parsePlainDate(value: string) { const [y, m, d] = value.split("-").map(Number); return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1) }
export function pad2(value: number) { return String(value).padStart(2, "0") }

export async function getAnalyticsAlertThresholds(): Promise<AnalyticsAlertThresholds> {
  try {
    const rows = await Promise.all([
      db.query.systemSettings.findFirst({ where: eq(systemSettings.key, "analytics:vehicle_monthly_anomaly_amount") }),
      db.query.systemSettings.findFirst({ where: eq(systemSettings.key, "analytics:supplier_concentration_pct") }),
      db.query.systemSettings.findFirst({ where: eq(systemSettings.key, "analytics:epp_recurring_delivery_count") }),
    ])
    return {
      vehicleMonthlyAnomalyAmount: positiveNumber(rows[0]?.value, DEFAULT_ALERT_THRESHOLDS.vehicleMonthlyAnomalyAmount),
      supplierConcentrationPct: positiveNumber(rows[1]?.value, DEFAULT_ALERT_THRESHOLDS.supplierConcentrationPct),
      eppRecurringDeliveryCount: positiveNumber(rows[2]?.value, DEFAULT_ALERT_THRESHOLDS.eppRecurringDeliveryCount),
    }
  } catch { return DEFAULT_ALERT_THRESHOLDS }
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function buildDataGaps(vehicleCosts: VehicleCostRow[]) {
  const gaps: string[] = []
  if (vehicleCosts.length > 0 && vehicleCosts.every((r) => r.lastOdometerReading == null && r.lastHourMeterReading == null)) {
    gaps.push("No hay lecturas de kilometraje u horómetro en las cargas de combustible del período.")
  }
  return gaps
}
