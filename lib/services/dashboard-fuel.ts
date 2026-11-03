/**
 * Dashboard-specific aggregates for fuel (combustibles).
 *
 * Lightweight queries designed for the dashboard — NOT the full page data loaders
 * (`getFleetOverview`). These return only the monthly trend needed by dashboard charts.
 *
 * Litros y gasto de combustible salen del libro del proveedor (Copec,
 * `fuel_provider_transactions`) con la regla canónica de `load-status.ts`, la misma
 * que usan Analítica y la conciliación (C-9). La serie facturada (`fuel_loads`) es
 * otro concepto —«Facturado», que el módulo de combustibles muestra aparte— y no se
 * mezcla aquí.
 */

import { and, inArray, sql } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import { fuelProviderTransactions } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { MONTH_LABELS, addDaysToPlainDate, todayInChile } from "@/lib/utils"
import { can } from "@/lib/auth/can"
import { accountableProviderTransactionsWhere, providerLoadCountSql } from "@/lib/combustibles/load-status"
import { monthsWithoutProviderData } from "@/lib/combustibles/copec-coverage"
import { listCopecPeriodCoverage } from "@/lib/combustibles/copec-coverage-store"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FuelMonthlyPoint {
  /** Rótulo corto del mes («Sep»). */
  month: string
  /** Clave `YYYY-MM`: el rótulo no dice el año. */
  monthKey: string
  /** `null` = el proveedor no tiene datos del mes (`providerGap`): un hueco, no un cero. */
  liters: number | null
  /** `null` sin `combustibles:view_costs`, o en un mes sin datos del proveedor. */
  amount: number | null
  loads: number | null
  /**
   * Sin transacciones del proveedor ni una cobertura que declare vacío el mes
   * (septiembre de 2026 en producción, C-4). Se dibuja como hueco y se rotula; un
   * `0` en cambio es un mes cubierto en que de verdad no se cargó.
   */
  providerGap: boolean
  /**
   * El mes en curso: aún no termina, así que sus litros y su costo valen sólo los días
   * transcurridos y, sin marca, el gráfico los dibuja como una caída del consumo. Es la
   * misma regla de Analítica (`buildMonthlyTrend`); ver `isPartialMonth`.
   */
  partial: boolean
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

/**
 * `true` si `monthKey` (`YYYY-MM`) es el mes de `today` (`YYYY-MM-DD`, día civil chileno) y
 * todavía no es su último día. Igual que `buildMonthlyTrend` de Analítica: el último día
 * del mes ya no se llama parcial. `today` sale de `todayInChile()`, no de UTC: entre las
 * 21:00 del último día del mes y la medianoche chilena, UTC ya está en el mes siguiente.
 */
export function isPartialMonth(monthKey: string, today: string): boolean {
  return monthKey === today.slice(0, 7) && addDaysToPlainDate(today, 1).slice(0, 7) === monthKey
}

const fuelScope = (session: Session, worksiteId?: string) =>
  worksiteScopeSql(session, fuelProviderTransactions.worksiteId, worksiteId)

// ── Fuel Monthly Trend ────────────────────────────────────────────────────────

export async function getFuelMonthlyTrend(session: Session, months = 6, worksiteId?: string, now = new Date()): Promise<FuelMonthlyPoint[]> {
  const canViewCosts = can(session, "combustibles:view") && can(session, "combustibles:view_costs")
  const bounds = getMonthBounds(months, now)
  const today = todayInChile(now)
  const scope = fuelScope(session, worksiteId)
  const t = fuelProviderTransactions
  // `occurred_at` es texto ISO: el mes son sus 7 primeros caracteres (como en Analítica y en el módulo de combustibles).
  const monthSql = sql<string>`left(${t.occurredAt}, 7)`

  const [rows, coverage] = await Promise.all([
    db
      .select({
        month: monthSql,
        liters: sql<number>`COALESCE(SUM(${t.quantity}), 0)`,
        amount: canViewCosts ? sql<number>`COALESCE(SUM(${t.amount}), 0)` : sql<null>`null`,
        // Un agregado mensual TCT vale las cargas de su `detalle`, no una.
        loads: sql<number>`COALESCE(SUM(${providerLoadCountSql()}), 0)`,
      })
      .from(t)
      .where(and(
        scope,
        accountableProviderTransactionsWhere(),
        inArray(monthSql, bounds.map((b) => b.key)),
      ))
      .groupBy(monthSql),
    listCopecPeriodCoverage(bounds[0]!.start, bounds[bounds.length - 1]!.start),
  ])

  const byMonth = new Map(rows.map((r) => [r.month, r]))
  const gaps = monthsWithoutProviderData(bounds.map((b) => b.key), coverage, new Set(rows.map((r) => r.month)))

  return bounds.map((b) => {
    const row = byMonth.get(b.key)
    if (gaps.has(b.key)) {
      return { month: b.label, monthKey: b.key, liters: null, amount: null, loads: null, providerGap: true, partial: isPartialMonth(b.key, today) }
    }
    return {
      month: b.label,
      monthKey: b.key,
      liters: Number(row?.liters ?? 0),
      amount: canViewCosts ? Number(row?.amount ?? 0) : null,
      loads: Number(row?.loads ?? 0),
      providerGap: false,
      partial: isPartialMonth(b.key, today),
    }
  })
}
