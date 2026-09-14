import type { Session } from "next-auth"
import { and, count, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { purchaseRequests, purchaseRequestItems, worksites } from "@/db/schema"
import { can } from "@/lib/auth/can"
import { statusSql } from "@/lib/adquisiciones/list-query"
import { parseEstadosParam, solicitudesSearchSql } from "@/lib/adquisiciones/solicitudes-filter"
import { formatDate } from "@/lib/utils"
import { REQUEST_TYPE_LABELS, URGENCY_LABELS, requestStatusLabel } from "./labels"
import { buildWorksiteFilter, buildDateFilter } from "./utils"
import type { ReportData, ExportFilters } from "./types"

export async function solicitudesList(session: Session | null, filters: ExportFilters, limit: number): Promise<ReportData> {
  // Espeja el filtro de la pantalla: quien solo tiene view_own exporta únicamente
  // sus propias solicitudes, no las de sus compañeros de faena (H-3).
  const ownOnly = !can(session, "requests:view_all")
  const where = and(
    buildWorksiteFilter(session, purchaseRequests.worksiteId),
    ownOnly && session?.user?.id ? eq(purchaseRequests.requesterId, session.user.id) : undefined,
    buildDateFilter(filters, purchaseRequests.createdAt),
    /*
     * REQ-003 (auditoría 2026-09-14): esto era
     * `eq(purchaseRequests.status, filters.status)`. La barra de pestañas
     * agrupa estados y los serializa separados por coma, así que exportar «En
     * aprobación» comparaba el estado con la cadena `"submitted,in_review"`:
     * una igualdad imposible, y el archivo salía vacío con la lista llena.
     */
    statusSql(purchaseRequests.status, parseEstadosParam(filters.status)),
    filters.worksiteId ? eq(purchaseRequests.worksiteId, filters.worksiteId) : undefined,
    // Y la búsqueda mira el nombre del producto además del código, como la
    // pantalla: es el mismo predicado, no una copia parecida.
    solicitudesSearchSql(filters.q ?? ""),
  )

  const rows = await db
    .select({
      id:          purchaseRequests.id,
      code:        purchaseRequests.code,
      requestType: purchaseRequests.requestType,
      worksiteId:  purchaseRequests.worksiteId,
      urgency:     purchaseRequests.urgency,
      status:      purchaseRequests.status,
      submittedAt: purchaseRequests.submittedAt,
      createdAt:   purchaseRequests.createdAt,
    })
    .from(purchaseRequests)
    .where(where)
    .orderBy(desc(purchaseRequests.createdAt))
    .limit(limit + 1)

  const rowLimitApplied = rows.length > limit
  const limited = rowLimitApplied ? rows.slice(0, limit) : rows

  const ids   = limited.map((r) => r.id)
  const wsIds = [...new Set(limited.map((r) => r.worksiteId))]
  const [wsRows, itemCounts] = await Promise.all([
    wsIds.length ? db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, wsIds)) : [],
    ids.length ? db.select({ requestId: purchaseRequestItems.requestId, total: count() }).from(purchaseRequestItems).where(inArray(purchaseRequestItems.requestId, ids)).groupBy(purchaseRequestItems.requestId) : [],
  ])
  const wsMap  = Object.fromEntries(wsRows.map((w) => [w.id, w.name]))
  const cntMap = Object.fromEntries(itemCounts.map((c) => [c.requestId, c.total]))

  return {
    filenameBase: "solicitudes",
    worksheetName: "Solicitudes",
    headers: ["Código", "Tipo", "Faena", "Urgencia", "Ítems", "Estado", "Fecha"],
    rows: limited.map((r) => [
      r.code,
      REQUEST_TYPE_LABELS[r.requestType] ?? r.requestType,
      wsMap[r.worksiteId] ?? r.worksiteId,
      URGENCY_LABELS[r.urgency ?? ""] ?? r.urgency ?? "",
      cntMap[r.id] ?? 0,
      requestStatusLabel(r.status),
      formatDate(r.submittedAt ?? r.createdAt),
    ]),
    rowLimitApplied,
  }
}
