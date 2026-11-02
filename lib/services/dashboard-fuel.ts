/**
 * Dashboard-specific aggregates for fuel (combustibles).
 *
 * Lightweight queries designed for the dashboard — NOT the full page data loaders
 * (`getFleetOverview`). These return only the monthly trend needed by dashboard charts.
 */

import { and, count, gte, lt, sql } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import { fuelLoads } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { MONTH_LABELS } from "@/lib/utils"
import { can } from "@/lib/auth/can"
import { accountableFuelLoadsWhere } from "@/lib/combustibles/load-status"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FuelMonthlyPoint {
  month: string
  liters: number
  amount: number | null
  loads: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

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

const fuelScope = (session: Session, worksiteId?: string) =>
  worksiteScopeSql(session, fuelLoads.worksiteId, worksiteId)

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

