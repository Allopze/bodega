/**
 * Dashboard-specific aggregates for Fleet, Fuel (combustibles) and Maintenance.
 *
 * Lightweight queries designed for the dashboard — NOT the full page data loaders
 * (`getFleetOverview`, `getMaintenancePageData`). These return only the metrics
 * and monthly trends needed by the dashboard charts.
 */

import { and, count, eq, gte, lt, sql } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import { fuelLoads, fuelVehicles, maintenanceRecords } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { chileDateParts } from "@/lib/utils"
import { can } from "@/lib/auth/can"
import { accountableFuelLoadsWhere } from "@/lib/combustibles/load-status"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FleetDashboardSummary {
  totalVehicles: number
  activeVehicles: number
  inactiveVehicles: number
}

export interface FuelMonthlyPoint {
  month: string
  liters: number
  amount: number | null
  loads: number
}

export interface MaintenanceMonthlyPoint {
  month: string
  completed: number
  scheduled: number
  amount: number | null
}

export interface MaintenanceDashboardSummary {
  scheduledCount: number
  overdueCount: number
  completedThisMonth: number
  totalSpendThisMonth: number | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

// ── Helpers ───────────────────────────────────────────────────────────────────

function getMonthBounds(months: number, now = new Date()): Array<{ label: string; key: string; start: string; end: string }> {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago", year: "numeric", month: "2-digit",
  }).formatToParts(now)
  const currentYear = Number(dateParts.find((p) => p.type === "year")?.value)
  const currentMonth = Number(dateParts.find((p) => p.type === "month")?.value) - 1

  const result: Array<{ label: string; key: string; start: string; end: string }> = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(currentYear, currentMonth - i, 1)
    const year = d.getFullYear()
    const month = d.getMonth()
    const key = `${year}-${String(month + 1).padStart(2, "0")}`
    result.push({
      label: MONTH_LABELS[month] ?? `M${month + 1}`,
      key,
      start: `${key}-01`,
      end: new Date(Date.UTC(year, month + 1, 1)).toISOString().slice(0, 10),
    })
  }
  return result
}

// Los tres alcances salen de `worksiteScopeSql`, que intersecta el permiso del
// rol con la faena elegida en el dashboard. Antes eran tres copias locales que
// sólo se diferenciaban en la columna.
const vehicleScope = (session: Session, worksiteId?: string) =>
  worksiteScopeSql(session, fuelVehicles.worksiteId, worksiteId)

const fuelScope = (session: Session, worksiteId?: string) =>
  worksiteScopeSql(session, fuelLoads.worksiteId, worksiteId)

const maintenanceScope = (session: Session, worksiteId?: string) =>
  worksiteScopeSql(session, maintenanceRecords.worksiteId, worksiteId)

// ── Fleet Summary ─────────────────────────────────────────────────────────────

export async function getFleetDashboardSummary(session: Session): Promise<FleetDashboardSummary> {
  const scope = vehicleScope(session)
  const [totalRow, activeRow] = await Promise.all([
    db.select({ value: count() }).from(fuelVehicles).where(scope),
    db.select({ value: count() }).from(fuelVehicles).where(and(scope, eq(fuelVehicles.isActive, true))),
  ])
  const total = totalRow[0]?.value ?? 0
  const active = activeRow[0]?.value ?? 0
  return {
    totalVehicles: total,
    activeVehicles: active,
    inactiveVehicles: total - active,
  }
}

// ── Fuel Monthly Trend ────────────────────────────────────────────────────────

export async function getFuelMonthlyTrend(session: Session, months = 6, worksiteId?: string): Promise<FuelMonthlyPoint[]> {
  const canViewCosts = can(session, "combustibles:view") && can(session, "combustibles:view_costs")
  const bounds = getMonthBounds(months)
  const scope = fuelScope(session, worksiteId)
  const globalStart = bounds[0]!.start
  const globalEnd = bounds[bounds.length - 1]!.end

  const rows = await db
    .select({
      month: fuelLoads.month,
      liters: sql<number>`COALESCE(SUM(${fuelLoads.liters}), 0)`,
      amount: canViewCosts ? sql<number>`COALESCE(SUM(${fuelLoads.totalAmount}), 0)` : sql<null>`null`,
      loads: count(),
    })
    .from(fuelLoads)
    .where(and(
      scope,
      gte(fuelLoads.loadDate, globalStart),
      lt(fuelLoads.loadDate, globalEnd),
      accountableFuelLoadsWhere(),
    ))
    .groupBy(fuelLoads.month)

  const byMonth = new Map(rows.map((r) => [r.month, r]))

  return bounds.map((b) => {
    const row = byMonth.get(b.key)
    return {
      month: b.label,
      liters: Number(row?.liters ?? 0),
      amount: canViewCosts ? Number(row?.amount ?? 0) : null,
      loads: Number(row?.loads ?? 0),
    }
  })
}

// ── Maintenance Monthly Trend ─────────────────────────────────────────────────

export async function getMaintenanceMonthlyTrend(session: Session, months = 6, worksiteId?: string): Promise<MaintenanceMonthlyPoint[]> {
  const canViewCosts = can(session, "mantenciones:view") && can(session, "combustibles:view_costs")
  const bounds = getMonthBounds(months)
  const scope = maintenanceScope(session, worksiteId)
  const globalStart = bounds[0]!.start
  const globalEnd = bounds[bounds.length - 1]!.end

  const monthExpr = sql<string>`to_char(${maintenanceRecords.maintenanceDate}::date, 'YYYY-MM')`

  const rows = await db
    .select({
      month: monthExpr,
      completed: sql<number>`COUNT(*) FILTER (WHERE ${maintenanceRecords.status} = 'completed')`,
      scheduled: sql<number>`COUNT(*) FILTER (WHERE ${maintenanceRecords.status} = 'scheduled')`,
      amount: canViewCosts ? sql<number>`COALESCE(SUM(${maintenanceRecords.totalAmount}) FILTER (WHERE ${maintenanceRecords.status} <> 'cancelled'), 0)` : sql<null>`null`,
    })
    .from(maintenanceRecords)
    .where(and(
      scope,
      gte(maintenanceRecords.maintenanceDate, globalStart),
      lt(maintenanceRecords.maintenanceDate, globalEnd),
    ))
    .groupBy(monthExpr)

  const byMonth = new Map(rows.map((r) => [r.month, r]))

  return bounds.map((b) => {
    const row = byMonth.get(b.key)
    return {
      month: b.label,
      completed: Number(row?.completed ?? 0),
      scheduled: Number(row?.scheduled ?? 0),
      amount: canViewCosts ? Number(row?.amount ?? 0) : null,
    }
  })
}

// ── Maintenance Summary (current state) ───────────────────────────────────────

export async function getMaintenanceDashboardSummary(session: Session): Promise<MaintenanceDashboardSummary> {
  const canViewCosts = can(session, "mantenciones:view") && can(session, "combustibles:view_costs")
  const scope = maintenanceScope(session)
  // Día y mes en calendario chileno: `maintenance_date` guarda la fecha civil y
  // `toISOString()` rinde UTC, así que durante las últimas horas del día local
  // las mantenciones de hoy se contaban como vencidas.
  const { year, month, day } = chileDateParts()
  const monthLabel = String(month).padStart(2, "0")
  const today = `${year}-${monthLabel}-${String(day).padStart(2, "0")}`
  const monthStart = `${year}-${monthLabel}-01`
  const monthEnd = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10)

  const [scheduledRow, overdueRow, completedRow, spendRow] = await Promise.all([
    db.select({ value: count() }).from(maintenanceRecords).where(and(scope, eq(maintenanceRecords.status, "scheduled"), gte(maintenanceRecords.maintenanceDate, today))),
    db.select({ value: count() }).from(maintenanceRecords).where(and(scope, eq(maintenanceRecords.status, "scheduled"), lt(maintenanceRecords.maintenanceDate, today))),
    db.select({ value: count() }).from(maintenanceRecords).where(and(scope, eq(maintenanceRecords.status, "completed"), gte(maintenanceRecords.maintenanceDate, monthStart), lt(maintenanceRecords.maintenanceDate, monthEnd))),
    canViewCosts
      ? db.select({ value: sql<number>`COALESCE(SUM(${maintenanceRecords.totalAmount}), 0)` }).from(maintenanceRecords).where(and(scope, eq(maintenanceRecords.status, "completed"), gte(maintenanceRecords.maintenanceDate, monthStart), lt(maintenanceRecords.maintenanceDate, monthEnd)))
      : Promise.resolve([{ value: null }]),
  ])

  return {
    scheduledCount: scheduledRow[0]?.value ?? 0,
    overdueCount: overdueRow[0]?.value ?? 0,
    completedThisMonth: completedRow[0]?.value ?? 0,
    totalSpendThisMonth: canViewCosts ? Number(spendRow[0]?.value ?? 0) : null,
  }
}
