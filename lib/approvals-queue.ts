import { and, inArray, sql, type SQL } from "drizzle-orm"
import { purchaseRequests } from "@/db/schema"

/**
 * Estados en los que una solicitud ya no genera trabajo pendiente, por más que a
 * alguno de sus ítems le haya quedado un estado intermedio.
 *
 * Es una constante compartida y no una condición escrita en cada consulta porque
 * la cola de `/pendientes` y el badge del rail son dos consultas distintas sobre
 * el mismo criterio: la auditoría UI/UX 2026-07-29 (A-03, A-13) las encontró
 * derivadas, ofreciendo tareas que la página de destino descartaba.
 */
export const TERMINAL_REQUEST_STATUSES = ["rejected", "closed", "cancelled"] as const

/**
 * Predicado base de la cola de aprobaciones.
 *
 * Existe porque el badge del rail y la página `/aprobaciones` tenían la misma
 * consulta duplicada y **derivaron**: la página excluía `('repuestos','servicios')`
 * y el badge sólo `'repuestos'`, así que una solicitud de servicios se contaba en
 * el badge y no aparecía nunca en la lista (auditoría 2026-07-24, hallazgo A-8).
 *
 * Cualquier cambio de criterio de la cola va aquí y sirve a los dos consumidores.
 * La página añade encima sus filtros de URL (búsqueda, faena, urgencia); el badge no.
 */
export function approvalQueueFilter(scope: {
  isGlobal: boolean
  worksiteIds: string[]
}): SQL | undefined {
  return and(
    inArray(purchaseRequests.status, ["submitted", "in_review", "partially_approved"]),
    // Repuestos y servicios se aprueban por su propio flujo de cotizaciones
    // (selectQuotation aprueba los ítems), no por esta cola ítem-a-ítem.
    sql`${purchaseRequests.requestType} NOT IN ('repuestos', 'servicios')`,
    // Una solicitud sólo pertenece a la cola mientras le quede algún ítem por decidir.
    sql`exists (
      select 1
      from purchase_request_items pending_items
      where pending_items.request_id = ${purchaseRequests.id}
        and pending_items.status = 'requested'
    )`,
    scope.isGlobal
      ? undefined
      : scope.worksiteIds.length > 0
        ? inArray(purchaseRequests.worksiteId, scope.worksiteIds)
        : sql`false`,
  )
}

/** Tipos que se aprueban eligiendo una cotización, no ítem a ítem (ADQ-05). */
export const QUOTATION_APPROVAL_REQUEST_TYPES = ["repuestos", "servicios"] as const
export type QuotationApprovalRequestType = (typeof QUOTATION_APPROVAL_REQUEST_TYPES)[number]

/**
 * Cola complementaria: solicitudes de repuestos/servicios que esperan que alguien
 * ELIJA una cotización en su detalle (`selectQuotation` aprueba los ítems).
 *
 * Es el espejo de `approvalQueueFilter` —mismo estado, mismo "queda algún ítem por
 * decidir", mismo alcance de faena— pero sobre los tipos que aquella excluye a
 * propósito. Va aparte para no tocar el predicado de la cola ítem-a-ítem, que
 * comparte con el badge del rail. `types` son los tipos que el usuario puede
 * aprobar (`repuestos:approve` / `servicios:approve`); vacío = cola vacía.
 */
export function quotationQueueFilter(
  scope: { isGlobal: boolean; worksiteIds: string[] },
  types: readonly QuotationApprovalRequestType[],
): SQL | undefined {
  if (types.length === 0) return sql`false`
  return and(
    inArray(purchaseRequests.status, ["submitted", "in_review", "partially_approved"]),
    inArray(purchaseRequests.requestType, [...types]),
    sql`exists (
      select 1
      from purchase_request_items pending_items
      where pending_items.request_id = ${purchaseRequests.id}
        and pending_items.status = 'requested'
    )`,
    scope.isGlobal
      ? undefined
      : scope.worksiteIds.length > 0
        ? inArray(purchaseRequests.worksiteId, scope.worksiteIds)
        : sql`false`,
  )
}
