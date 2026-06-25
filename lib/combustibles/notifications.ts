/**
 * Notifications for the Combustibles module.
 *
 * Checks for:
 * - Monthly statements due soon (within 5 days)
 * - Overdue monthly statements
 * - Unassigned fuel loads (loads without a statement after month end)
 */

import { db } from "@/db"
import { fuelMonthlyStatements, fuelLoads, fuelSuppliers } from "@/db/schema"
import { eq, and, sql, lte } from "drizzle-orm"
import { notifySafe, notifyManyUser, getUserIdsWithPermission } from "@/lib/services/notifications"
import { logger } from "@/lib/logger"

/**
 * Check for overdue and soon-due monthly statements.
 * Should be called periodically (e.g., daily via cron or on login).
 */
export async function checkFuelStatementNotifications(): Promise<void> {
  try {
    const today = new Date().toISOString().split("T")[0]!
    const fiveDaysFromNow = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]!

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

    const adminUserIds = await getUserIdsWithPermission("combustibles:view")

    // Notify about due soon
    for (const stmt of dueSoon) {
      const supplierName = stmt.supplier?.name ?? "Proveedor"
      const pending = (stmt.totalAmount ?? 0) - (stmt.paidAmount ?? 0)
      if (pending <= 0) continue

      await notifyManyUser(adminUserIds, {
        type: "fuel_statement_due_soon",
        title: `Resumen ${supplierName} ${stmt.month} vence pronto`,
        body: `Pendiente: $${pending.toLocaleString("es-CL")} — Vence: ${stmt.dueDate}`,
        entityType: "fuel_monthly_statement",
        entityId: stmt.id,
        entityHref: `/combustibles/cuenta-corriente/${stmt.id}`,
      })
    }

    // Notify about overdue
    for (const stmt of overdue) {
      const supplierName = stmt.supplier?.name ?? "Proveedor"
      const pending = (stmt.totalAmount ?? 0) - (stmt.paidAmount ?? 0)
      if (pending <= 0) continue

      await notifyManyUser(adminUserIds, {
        type: "fuel_statement_overdue",
        title: `⚠️ Resumen ${supplierName} ${stmt.month} VENCIDO`,
        body: `Pendiente: $${pending.toLocaleString("es-CL")} — Venció: ${stmt.dueDate}`,
        entityType: "fuel_monthly_statement",
        entityId: stmt.id,
        entityHref: `/combustibles/cuenta-corriente/${stmt.id}`,
      })
    }

    // Check for unassigned loads (loads from previous months without a statement)
    const prevMonth = new Date()
    prevMonth.setMonth(prevMonth.getMonth() - 1)
    const prevMonthStr = prevMonth.toISOString().substring(0, 7)

    const unassignedCount = await db.select({ count: sql<number>`count(*)` })
      .from(fuelLoads)
      .where(and(
        eq(fuelLoads.month, prevMonthStr),
        sql`${fuelLoads.statementId} IS NULL`,
      ))

    const count = unassignedCount[0]?.count ?? 0
    if (count > 0) {
      await notifyManyUser(adminUserIds, {
        type: "fuel_loads_unassigned",
        title: `${count} cargas de ${prevMonthStr} sin resumen`,
        body: "Hay cargas de combustible del mes pasado que no están asignadas a una cuenta corriente mensual.",
        entityHref: "/combustibles",
      })
    }
  } catch (err) {
    logger.error("[fuel-notifications] Error checking fuel notifications", err)
  }
}
