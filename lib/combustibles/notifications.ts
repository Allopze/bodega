/**
 * Avisos del módulo de Combustible, con el vocabulario del rediseño
 * («estado de cuenta», no «cartola» ni «cuenta corriente»):
 * - estados de cuenta que vencen pronto (dentro de 5 días);
 * - estados de cuenta vencidos;
 * - cargas del mes pasado que todavía no están en ningún estado de cuenta.
 */

import { db } from "@/db"
import { fuelMonthlyStatements, fuelLoads } from "@/db/schema"
import { eq, and, sql, lte } from "drizzle-orm"
import { notifyManyUser } from "@/lib/services/notifications"
import { getGlobalUserIdsWithAllPermissions } from "@/lib/services/notification-targeting"
import { logger } from "@/lib/logger"
import { chileDateParts, todayInChile, addDaysToPlainDate, formatCLP, formatDate } from "@/lib/utils"
import { FUEL_PATHS, fuelStatementHref } from "@/lib/combustibles/routes"
import { accountableFuelLoadsWhere } from "@/lib/combustibles/load-status"
import { fuelMonthLabel, statementPendingAmount } from "@/lib/combustibles/calculations"

/**
 * Mes anterior a `year`-`month` (mes 1-based) como "YYYY-MM".
 *
 * Se normaliza sobre el día 1, que siempre existe: `setMonth` sobre la fecha de
 * hoy desborda los días 29-31 cuando el mes destino es más corto y devuelve el
 * mes en curso (2026-03-31 → "2026-03").
 */
export function previousMonth(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7)
}

/**
 * Check for overdue and soon-due monthly statements.
 * Should be called periodically (e.g., daily via cron or on login).
 */
export async function checkFuelStatementNotifications(): Promise<void> {
  try {
    // Fecha civil chilena, no UTC: entre las 21:00 y la medianoche de Chile
    // `toISOString()` ya está en el día siguiente y un estado de cuenta que vence hoy
    // se notificaba VENCIDO con horas de anticipación.
    const today = todayInChile()
    const fiveDaysFromNow = addDaysToPlainDate(today, 5)

    // Find open/partial statements due soon or overdue
    const dueSoon = await db.query.fuelMonthlyStatements.findMany({
      where: and(
        sql`${fuelMonthlyStatements.status} IN ('open', 'partial')`,
        lte(fuelMonthlyStatements.dueDate, fiveDaysFromNow),
        sql`${fuelMonthlyStatements.dueDate} >= ${today}`,
      ),
      with: { supplier: true },
    })

    const overdue = await db.query.fuelMonthlyStatements.findMany({
      where: and(
        sql`${fuelMonthlyStatements.status} IN ('open', 'partial')`,
        sql`${fuelMonthlyStatements.dueDate} < ${today}`,
      ),
      with: { supplier: true },
    })

    // La notificación lleva monto y enlace a un estado de cuenta global:
    // su audiencia replica exactamente el guard de la pantalla destino.
    const adminUserIds = await getGlobalUserIdsWithAllPermissions(
      "combustibles:view",
      "combustibles:view_costs",
    )

    // Notify about due soon
    for (const stmt of dueSoon) {
      const supplierName = stmt.supplier?.name ?? "Proveedor"
      const pending = statementPendingAmount(stmt)
      if (pending <= 0) continue

      await notifyManyUser(adminUserIds, {
        type: "fuel_statement_due_soon",
        title: `El estado de cuenta de ${supplierName} de ${fuelMonthLabel(stmt.month)} vence pronto`,
        body: `Por pagar: ${formatCLP(pending)} · Vence el ${formatDate(stmt.dueDate ?? "")}`,
        entityType: "fuel_monthly_statement",
        entityId: stmt.id,
        entityHref: fuelStatementHref(stmt.id),
      })
    }

    // Notify about overdue
    for (const stmt of overdue) {
      const supplierName = stmt.supplier?.name ?? "Proveedor"
      const pending = statementPendingAmount(stmt)
      if (pending <= 0) continue

      await notifyManyUser(adminUserIds, {
        type: "fuel_statement_overdue",
        title: `El estado de cuenta de ${supplierName} de ${fuelMonthLabel(stmt.month)} está vencido`,
        body: `Por pagar: ${formatCLP(pending)} · Venció el ${formatDate(stmt.dueDate ?? "")}`,
        entityType: "fuel_monthly_statement",
        entityId: stmt.id,
        entityHref: fuelStatementHref(stmt.id),
      })
    }

    // Cargas del mes pasado que todavía no están en un estado de cuenta. Sólo
    // las contabilizables: un borrador o una carga anulada no entra nunca a un
    // estado de cuenta, así que contarlas avisaba para siempre de algo que no
    // se puede resolver.
    const { year, month } = chileDateParts()
    const prevMonthStr = previousMonth(year, month)

    const unassignedCount = await db.select({ count: sql<number>`count(*)` })
      .from(fuelLoads)
      .where(and(
        accountableFuelLoadsWhere(),
        eq(fuelLoads.month, prevMonthStr),
        sql`${fuelLoads.statementId} IS NULL`,
      ))

    const count = Number(unassignedCount[0]?.count ?? 0)
    if (count > 0) {
      await notifyManyUser(adminUserIds, {
        type: "fuel_loads_unassigned",
        title: `${count} ${count === 1 ? "carga" : "cargas"} de ${fuelMonthLabel(prevMonthStr)} sin estado de cuenta`,
        body: "Hay cargas del mes pasado que todavía no están en un estado de cuenta. Créalo para dejar el mes cerrado.",
        // Abre el mes pasado, que es donde está el botón «Crear».
        entityHref: `${FUEL_PATHS.estados}?periodo=${prevMonthStr}`,
      })
    }
  } catch (err) {
    logger.error("[fuel-notifications] Error checking fuel notifications", err)
  }
}
