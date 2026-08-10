import type { Session } from "next-auth"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrderItems, purchaseOrders, worksites } from "@/db/schema"
import { formatDate } from "@/lib/utils"
import { buildWorksiteFilter, buildDateFilter } from "./utils"
import type { ReportData, ExportFilters } from "./types"
import { ocStatusLabel } from "./labels"

export async function ocPorEstado(session: Session | null, filters: ExportFilters, limit: number): Promise<ReportData> {
  const orderFilter = buildWorksiteFilter(session, purchaseOrders.worksiteId)
  const dateFilter = buildDateFilter(filters, purchaseOrders.createdAt)
  const statusFilter = filters.status ? eq(purchaseOrders.status, filters.status) : undefined
  const wsFilter = filters.worksiteId ? eq(purchaseOrders.worksiteId, filters.worksiteId) : undefined

  const orders = await db
    .select({
      code:        purchaseOrders.code,
      status:      purchaseOrders.status,
      worksiteId:  purchaseOrders.worksiteId,
      totalAmount: purchaseOrders.totalAmount,
      // El total de la OC sólo cuenta lo cotizado: un servicio con costo
      // pendiente no suma. Sin esta columna el reporte parecería gasto cerrado.
      pendingCostLines: sql<number>`(
        select count(*) from ${purchaseOrderItems}
        where ${purchaseOrderItems.purchaseOrderId} = ${purchaseOrders.id}
          and ${purchaseOrderItems.unitPrice} is null
      )`,
      issuedAt:    purchaseOrders.issuedAt,
      sentAt:      purchaseOrders.sentAt,
      confirmedAt: purchaseOrders.confirmedAt,
    })
    .from(purchaseOrders)
    // Mismo corte que DAT-16 le puso a gasto-faena, por el mismo motivo: una OC
    // eliminada sigue con status "cancelled" y el código mutado a
    // `-DELETED-<id>`, así que exportar por estado="cancelled" mezclaba las
    // anuladas de verdad con las eliminadas y publicaba ese código interno.
    .where(and(isNull(purchaseOrders.deletedAt), orderFilter, dateFilter, statusFilter, wsFilter))
    .limit(limit + 1)

  const rowLimitApplied = orders.length > limit
  const limited = rowLimitApplied ? orders.slice(0, limit) : orders

  const wsIds = [...new Set(limited.map((o) => o.worksiteId))]
  const wsRows = wsIds.length
    ? await db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, wsIds))
    : []
  const wsMap = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))

  return {
    filenameBase: "oc-por-estado",
    worksheetName: "OC por estado",
    headers: ["OC", "Estado", "Faena", "Total conocido", "Servicios con costo pendiente", "Emitida", "Enviada", "Confirmada"],
    rows: limited.map((o) => [
      o.code,
      ocStatusLabel(o.status),
      wsMap[o.worksiteId] ?? o.worksiteId,
      o.totalAmount,
      Number(o.pendingCostLines ?? 0),
      o.issuedAt    ? formatDate(o.issuedAt)    : "",
      o.sentAt      ? formatDate(o.sentAt)      : "",
      o.confirmedAt ? formatDate(o.confirmedAt) : "",
    ]),
    rowLimitApplied,
  }
}
