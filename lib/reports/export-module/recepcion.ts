import type { Session } from "next-auth"
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrders, worksites, suppliers } from "@/db/schema"
import { formatDate } from "@/lib/utils"
import { COMPLETED_RECEIPT_ORDER_STATUSES } from "@/lib/work-queue-labels"
import { ocStatusLabel, RECEIVABLE_OC_STATUSES } from "./labels"
import { buildWorksiteFilter } from "./utils"
import type { ReportData, ExportFilters } from "./types"

/**
 * Estados que la pantalla de Recepción puede mostrar: la cola activa más el
 * historial completado. El filtro de estado que llega desde la URL sólo puede
 * recortar dentro de este conjunto.
 */
const RECEPCION_EXPORTABLE_STATUSES = [...RECEIVABLE_OC_STATUSES, ...COMPLETED_RECEIPT_ORDER_STATUSES]

/**
 * Estados que debe traer el archivo, a partir del filtro de la URL.
 *
 * Pura y exportada para poder ejercitarla sin base de datos: es la regla que
 * `REC-004` encontró ausente, y la que hace que el Excel y la pantalla hablen
 * del mismo conjunto de filas.
 */
export function resolveRecepcionExportStatuses(filterStatus: string | undefined): string[] {
  const requested = (filterStatus ?? "")
    .split(",")
    .map((status) => status.trim())
    .filter((status) => RECEPCION_EXPORTABLE_STATUSES.includes(status))
  return requested.length > 0 ? requested : [...RECEIVABLE_OC_STATUSES]
}

export async function recepcionList(session: Session | null, filters: ExportFilters, limit: number): Promise<ReportData> {
  /**
   * REC-004 (auditoría 2026-09-13): esta consulta fijaba
   * `RECEIVABLE_OC_STATUSES` e ignoraba `filters.status`, de modo que exportar
   * desde las tabs "Completadas" o "Todas" entregaba la cola activa —otro
   * conjunto de filas— sin avisar. Además buscaba sólo por código de OC
   * mientras la pantalla también calza por nombre de proveedor, así que buscar
   * un proveedor devolvía filas en pantalla y un archivo vacío.
   */
  const statuses = resolveRecepcionExportStatuses(filters.status)

  const likePattern = filters.q?.trim() ? `%${filters.q.trim().replace(/[\\%_]/g, (character) => `\\${character}`)}%` : null

  const where = and(
    inArray(purchaseOrders.status, statuses),
    buildWorksiteFilter(session, purchaseOrders.worksiteId),
    filters.worksiteId ? eq(purchaseOrders.worksiteId, filters.worksiteId) : undefined,
    filters.supplierId ? eq(purchaseOrders.supplierId, filters.supplierId) : undefined,
    likePattern
      ? or(
          ilike(purchaseOrders.code, likePattern),
          sql`EXISTS (SELECT 1 FROM suppliers s WHERE s.id = ${purchaseOrders.supplierId} AND s.name ILIKE ${likePattern})`,
        )
      : undefined,
  )

  const rows = await db
    .select({
      code:       purchaseOrders.code,
      worksiteId: purchaseOrders.worksiteId,
      supplierId: purchaseOrders.supplierId,
      status:     purchaseOrders.status,
      sentAt:     purchaseOrders.sentAt,
    })
    .from(purchaseOrders)
    .where(where)
    .orderBy(desc(purchaseOrders.sentAt))
    .limit(limit + 1)

  const rowLimitApplied = rows.length > limit
  const limited = rowLimitApplied ? rows.slice(0, limit) : rows

  const wsIds  = [...new Set(limited.map((o) => o.worksiteId))]
  const supIds = [...new Set(limited.map((o) => o.supplierId))]
  const [wsRows, supRows] = await Promise.all([
    wsIds.length  ? db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, wsIds)) : [],
    supIds.length ? db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(inArray(suppliers.id, supIds)) : [],
  ])
  const wsMap  = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))
  const supMap = Object.fromEntries(supRows.map((s) => [s.id, s.name]))

  return {
    filenameBase: "recepcion",
    worksheetName: "Recepción",
    headers: ["Código OC", "Faena", "Proveedor", "Estado", "Enviada"],
    rows: limited.map((o) => [
      o.code,
      wsMap[o.worksiteId] ?? o.worksiteId,
      supMap[o.supplierId] ?? o.supplierId,
      ocStatusLabel(o.status),
      o.sentAt ? formatDate(o.sentAt) : "",
    ]),
    rowLimitApplied,
  }
}
