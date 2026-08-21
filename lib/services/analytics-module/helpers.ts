import { and, gte, inArray, lte, sql, type SQLWrapper } from "drizzle-orm"
import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { systemSettings } from "@/db/schema"
import { db } from "@/db"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"
import type { AnalyticsFilters, SpendByMonthRow, WorksiteSpendRow, VehicleCostRow } from "./types"

export const ACTIVE_ORDER_STATUSES = ["sent", "partially_office_received", "office_received", "partially_received", "received", "closed"]

export const REQUEST_TYPE_LABELS: Record<string, string> = { epp: "EPP", stock: "Stock", mantencion: "Mantención", otro: "Otros", repuestos: "Repuestos", servicios: "Servicios" }

export interface AnalyticsAlertThresholds {
  vehicleMonthlyAnomalyAmount: number; supplierConcentrationPct: number; eppRecurringDeliveryCount: number
}

export const DEFAULT_ALERT_THRESHOLDS: AnalyticsAlertThresholds = { vehicleMonthlyAnomalyAmount: 5_000_000, supplierConcentrationPct: 60, eppRecurringDeliveryCount: 3 }

export function normalizeAnalyticsFilters(input: AnalyticsFilters, now: Date = new Date()) {
  return {
    fromDate: input.fromDate ?? daysAgo(now, 30), toDate: input.toDate ?? dateOnly(now),
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

export function dateFilter(filters: Required<Pick<AnalyticsFilters, "fromDate" | "toDate">>, column: SQLWrapper) {
  return and(gte(column, filters.fromDate), lte(column, `${filters.toDate}T23:59:59`))
}

export function worksiteFilter(session: Session | null, column: SQLWrapper) {
  if (isGlobalRole(session)) return undefined
  const ids = visibleWorksiteIds(session)
  if (ids.length === 0) return sql`false`
  return inArray(column, ids as never[])
}

export function mergeSpendByMonth(rows: Array<{ month: string; module: string; totalAmount: number }>): SpendByMonthRow[] {
  const byMonth = new Map<string, SpendByMonthRow>()
  for (const row of rows) {
    const current = byMonth.get(row.month) ?? { month: row.month, purchasingAmount: 0, fuelAmount: 0, totalAmount: 0 }
    if (row.module === "Combustible") current.fuelAmount += row.totalAmount
    else current.purchasingAmount += row.totalAmount
    current.totalAmount += row.totalAmount
    byMonth.set(row.month, current)
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
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
/** ISO date `days` before `date` — used as a wider default range than "mes en curso" so a
 * dashboard opened early in the month (or for a faena with sparse recent activity) doesn't
 * land empty. */
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

export function buildDataGaps(vehicleCosts: VehicleCostRow[], options: { includeMaintenanceCosts?: boolean } = {}) {
  const gaps: string[] = []
  if (options.includeMaintenanceCosts && vehicleCosts.length > 0 && vehicleCosts.every((r) => r.totalServiceAmount === 0)) {
    gaps.push("No hay imputaciones de repuestos, servicios o mantenciones para los vehículos del período.")
  }
  if (vehicleCosts.length > 0 && vehicleCosts.every((r) => r.lastOdometerReading == null && r.lastHourMeterReading == null)) {
    gaps.push("No hay lecturas de kilometraje u horómetro en las cargas de combustible del período.")
  }
  return gaps
}
