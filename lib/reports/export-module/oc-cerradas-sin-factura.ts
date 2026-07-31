import type { Session } from "next-auth"
import { and, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrders, statusHistory, suppliers, worksites } from "@/db/schema"
import { formatDate } from "@/lib/utils"
import { orderHasNoInvoice } from "@/lib/services/operational-work-queue"
import { buildWorksiteFilter, buildDateFilter } from "./utils"
import type { ReportData, ExportFilters } from "./types"

/**
 * OC cerradas sin factura adjunta.
 *
 * La cola operacional deja de perseguir una OC al cerrarse —cerrada no admite
 * trabajo pendiente—, así que una orden que se cerró sin respaldo tributario
 * desaparecía de toda vista. El cierre exige confirmarlo a mano y deja el motivo
 * en el historial; este reporte es el que permite auditar esas confirmaciones
 * después, que es distinto de una tarea por hacer.
 */
export async function ocCerradasSinFactura(session: Session | null, filters: ExportFilters, limit: number): Promise<ReportData> {
  const orders = await db
    .select({
      id:          purchaseOrders.id,
      code:        purchaseOrders.code,
      worksiteId:  purchaseOrders.worksiteId,
      supplierId:  purchaseOrders.supplierId,
      totalAmount: purchaseOrders.totalAmount,
      closedAt:    purchaseOrders.closedAt,
      createdAt:   purchaseOrders.createdAt,
    })
    .from(purchaseOrders)
    .where(and(
      buildWorksiteFilter(session, purchaseOrders.worksiteId),
      buildDateFilter(filters, purchaseOrders.createdAt),
      filters.worksiteId ? eq(purchaseOrders.worksiteId, filters.worksiteId) : undefined,
      filters.supplierId ? eq(purchaseOrders.supplierId, filters.supplierId) : undefined,
      eq(purchaseOrders.status, "closed"),
      orderHasNoInvoice,
    ))
    .orderBy(desc(purchaseOrders.closedAt))
    .limit(limit + 1)

  const rowLimitApplied = orders.length > limit
  const limited = rowLimitApplied ? orders.slice(0, limit) : orders

  const ids = limited.map((order) => order.id)
  const wsIds = [...new Set(limited.map((order) => order.worksiteId))]
  const supIds = [...new Set(limited.map((order) => order.supplierId))]

  // El motivo del cierre es la evidencia de quién y por qué asumió cerrar sin
  // factura: sin él, el reporte lista números sin explicación.
  const [wsRows, supRows, closures] = await Promise.all([
    wsIds.length ? db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, wsIds)) : [],
    supIds.length ? db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(inArray(suppliers.id, supIds)) : [],
    ids.length
      ? db
          .select({
            entityId: statusHistory.entityId,
            reason: statusHistory.reason,
            changedAt: statusHistory.changedAt,
          })
          .from(statusHistory)
          .where(and(
            eq(statusHistory.entityType, "purchase_order"),
            eq(statusHistory.toStatus, "closed"),
            inArray(statusHistory.entityId, ids),
          ))
          .orderBy(desc(statusHistory.changedAt))
      : [],
  ])

  const wsMap = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))
  const supMap = Object.fromEntries(supRows.map((s) => [s.id, s.name]))
  const reasonMap = new Map<string, string>()
  for (const closure of closures) {
    if (!reasonMap.has(closure.entityId)) reasonMap.set(closure.entityId, closure.reason ?? "")
  }

  return {
    filenameBase: "oc-cerradas-sin-factura",
    worksheetName: "OC cerradas sin factura",
    headers: ["Código OC", "Faena", "Proveedor", "Total OC", "Cierre", "Motivo del cierre"],
    rows: limited.map((order) => [
      order.code,
      wsMap[order.worksiteId] ?? order.worksiteId,
      supMap[order.supplierId] ?? order.supplierId,
      order.totalAmount,
      order.closedAt ? formatDate(order.closedAt) : "",
      reasonMap.get(order.id) ?? "",
    ]),
    rowLimitApplied,
  }
}
