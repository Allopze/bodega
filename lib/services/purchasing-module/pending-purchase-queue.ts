/**
 * La cola de trabajo de Compras, leída como registros y no como un número.
 *
 * `/compras` conocía sus pendientes sólo a través de un `count()` ("8 ítems
 * aprobados sin incluir en ninguna OC") y la única forma de llegar a ellos era
 * el formulario de creación, donde aparecían como casillas. No había ninguna
 * pantalla que respondiera "¿QUÉ solicitudes están esperando una OC?". Esta
 * consulta la responde, agrupada por solicitud, que es la unidad con la que se
 * trabaja: un comprador arma la OC de una solicitud, no de un ítem suelto.
 *
 * Todo sale del mismo predicado que el contador (`pendingPurchaseWhere`), así
 * que el resumen y la tabla no pueden discrepar.
 */

import { and, asc, count, countDistinct, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  products, purchaseOrderItems, purchaseOrders, purchaseRequestItems, purchaseRequests,
  suppliers, users, worksites,
} from "@/db/schema"
import { pendingPurchaseWhere } from "@/lib/adquisiciones/pending-purchase"
import { getProductSizesByIds } from "@/lib/services/product-sizes"
import { formatSizedProductName } from "@/lib/products/product-size"

/** Cómo se clasifica cada ítem dentro de una solicitud que espera OC. */
export type PendingPurchaseItemStage =
  /** Aprobado y sin OC: sobre esto actúa Compras. */
  | "pending_order"
  /** Ya incorporado a una OC activa. */
  | "in_order"
  /** Rechazado en Aprobaciones: nunca es trabajo de Compras. */
  | "rejected"
  /** Todavía esperando decisión de Aprobaciones. */
  | "awaiting_approval"
  /** Ya recibido o entregado: fuera del alcance de Compras. */
  | "done"

export type PendingPurchaseItem = {
  id:            string
  productName:   string
  productSku:    string | null
  quantity:      number
  unitOfMeasure: string
  status:        string
  stage:         PendingPurchaseItemStage
  /** Código de la OC activa que lo cubre, cuando la hay. */
  orderCode:     string | null
  orderId:       string | null
  supplierName:  string | null
}

export type PendingPurchaseRequest = {
  id:               string
  code:             string
  status:           string
  urgency:          string
  requestType:      string
  worksiteId:       string
  worksiteName:     string
  requesterName:    string
  /** Fecha de envío a aprobación; cae en la de creación si nunca se envió. */
  date:             string
  pendingItemCount: number
  /** Proveedores sugeridos de los ítems pendientes (puede haber más de uno). */
  supplierNames:    string[]
  items:            PendingPurchaseItem[]
}

export type PendingPurchaseQueueFilters = {
  /** Texto libre: código de solicitud o nombre de producto de un ítem pendiente. */
  q?:          string
  worksiteId?: string
  /** Proveedor sugerido de alguno de los ítems pendientes. */
  supplierId?: string
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

/**
 * Filtros de la pantalla traducidos a SQL sobre el ítem pendiente. El texto
 * matchea el código de la solicitud o el nombre del producto del ítem — que es
 * lo que se busca cuando se persigue "¿dónde quedaron los guantes?".
 */
function filterSql(filters: PendingPurchaseQueueFilters): SQL | undefined {
  const q = filters.q?.trim()
  const pattern = q ? `%${escapeLike(q)}%` : null
  return and(
    filters.worksiteId ? eq(purchaseRequests.worksiteId, filters.worksiteId) : undefined,
    filters.supplierId ? eq(purchaseRequestItems.suggestedSupplierId, filters.supplierId) : undefined,
    pattern
      ? or(
          ilike(purchaseRequests.code, pattern),
          ilike(purchaseRequestItems.productNameFree, pattern),
          sql`EXISTS (SELECT 1 FROM products p WHERE p.id = ${purchaseRequestItems.productId} AND p.name ILIKE ${pattern})`,
        )
      : undefined,
  )
}

/** Ítems aprobados sin OC — el número del resumen. */
export async function countPendingPurchaseItems(
  scope: SQL | undefined,
  filters: PendingPurchaseQueueFilters = {},
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .where(pendingPurchaseWhere(scope, filterSql(filters)))
  return row?.total ?? 0
}

/** Solicitudes distintas con al menos un ítem aprobado sin OC — el total de la tabla. */
export async function countPendingPurchaseRequests(
  scope: SQL | undefined,
  filters: PendingPurchaseQueueFilters = {},
): Promise<number> {
  const [row] = await db
    .select({ total: countDistinct(purchaseRequests.id) })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .where(pendingPurchaseWhere(scope, filterSql(filters)))
  return row?.total ?? 0
}

const URGENCY_RANK = sql`CASE ${purchaseRequests.urgency} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END`

/**
 * Una página de solicitudes con ítems aprobados sin OC, con el desglose
 * completo de cada una: la solicitud sigue visible mientras le quede un ítem
 * aprobado sin OC, y el desglose distingue los que ya entraron a una de los que
 * fueron rechazados o siguen en aprobación.
 */
export async function listPendingPurchaseRequests(
  scope: SQL | undefined,
  filters: PendingPurchaseQueueFilters,
  page: { limit: number; offset: number },
): Promise<PendingPurchaseRequest[]> {
  const pendingWhere = pendingPurchaseWhere(scope, filterSql(filters))

  const requestRows = await db
    .select({
      id:               purchaseRequests.id,
      code:             purchaseRequests.code,
      status:           purchaseRequests.status,
      urgency:          purchaseRequests.urgency,
      requestType:      purchaseRequests.requestType,
      worksiteId:       purchaseRequests.worksiteId,
      worksiteName:     worksites.name,
      requesterName:    users.name,
      requesterEmail:   users.email,
      submittedAt:      purchaseRequests.submittedAt,
      createdAt:        purchaseRequests.createdAt,
      pendingItemCount: count(purchaseRequestItems.id),
    })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .innerJoin(worksites, eq(worksites.id, purchaseRequests.worksiteId))
    .innerJoin(users, eq(users.id, purchaseRequests.requesterId))
    .where(pendingWhere)
    .groupBy(
      purchaseRequests.id, purchaseRequests.code, purchaseRequests.status, purchaseRequests.urgency,
      purchaseRequests.requestType, purchaseRequests.worksiteId, worksites.name, users.name,
      users.email, purchaseRequests.submittedAt, purchaseRequests.createdAt,
    )
    // Lo más urgente primero y, dentro de la misma urgencia, lo que lleva más
    // tiempo esperando. El código desempata: sin él, dos solicitudes enviadas en
    // el mismo instante quedan en un orden que decide el plan de la consulta, y
    // un orden inestable puede repetir una fila en una página y saltársela en la
    // siguiente.
    .orderBy(asc(URGENCY_RANK), asc(purchaseRequests.createdAt), asc(purchaseRequests.code))
    .limit(page.limit)
    .offset(page.offset)

  if (requestRows.length === 0) return []

  const requestIds = requestRows.map((row) => row.id)

  // El desglose trae TODOS los ítems de esas solicitudes, no sólo los
  // pendientes: la pantalla tiene que poder distinguir "aprobado sin OC" de
  // "ya en una OC", "rechazado" y "en aprobación" — si sólo trajera los
  // pendientes, la aprobación parcial se leería como si la solicitud entera
  // estuviese esperando compra.
  const [itemRows, pendingIdRows] = await Promise.all([
    db
      .select({
        id:              purchaseRequestItems.id,
        requestId:       purchaseRequestItems.requestId,
        productId:       purchaseRequestItems.productId,
        productName:     products.name,
        productSku:      products.sku,
        productNameFree: purchaseRequestItems.productNameFree,
        quantity:        purchaseRequestItems.quantity,
        unitOfMeasure:   purchaseRequestItems.unitOfMeasure,
        status:          purchaseRequestItems.status,
        sortOrder:       purchaseRequestItems.sortOrder,
        supplierName:    suppliers.name,
        orderId:         purchaseOrders.id,
        orderCode:       purchaseOrders.code,
      })
      .from(purchaseRequestItems)
      .leftJoin(products, eq(products.id, purchaseRequestItems.productId))
      .leftJoin(suppliers, eq(suppliers.id, purchaseRequestItems.suggestedSupplierId))
      // La OC que se muestra es la activa: una anulada o eliminada no cubre
      // nada, y mostrarla haría creer que el ítem ya se compró.
      .leftJoin(purchaseOrderItems, and(
        eq(purchaseOrderItems.requestItemId, purchaseRequestItems.id),
        sql`${purchaseOrderItems.status} <> 'cancelled'`,
      ))
      .leftJoin(purchaseOrders, and(
        eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId),
        sql`${purchaseOrders.status} <> 'cancelled'`,
        sql`${purchaseOrders.deletedAt} IS NULL`,
      ))
      .where(inArray(purchaseRequestItems.requestId, requestIds))
      .orderBy(asc(purchaseRequestItems.sortOrder), asc(purchaseRequestItems.id)),

    // Qué ítems concretos entran en la cola, con el predicado canónico: la
    // clasificación de la pantalla no puede reinventarlo o volvería la misma
    // divergencia que este módulo existe para cerrar.
    db
      .select({ id: purchaseRequestItems.id })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
      .where(and(inArray(purchaseRequestItems.requestId, requestIds), pendingPurchaseWhere(scope))),
  ])

  const pendingIds = new Set(pendingIdRows.map((row) => row.id))
  const sizeById = await getProductSizesByIds(
    itemRows.map((row) => row.productId).filter((id): id is string => Boolean(id)),
  )
  const itemsByRequest = new Map<string, PendingPurchaseItem[]>()
  const suppliersByRequest = new Map<string, Set<string>>()
  // El LEFT JOIN a la OC puede devolver más de una fila por ítem si un
  // histórico dejó dos líneas activas sobre el mismo ítem. El desglose lista
  // ítems, no líneas: se queda con la primera y no duplica el ítem en pantalla.
  const seenItemIds = new Set<string>()

  for (const row of itemRows) {
    if (seenItemIds.has(row.id)) continue
    seenItemIds.add(row.id)
    const isPending = pendingIds.has(row.id)
    const stage: PendingPurchaseItemStage = isPending
      ? "pending_order"
      : row.status === "rejected"
        ? "rejected"
        : ["draft", "requested"].includes(row.status)
          ? "awaiting_approval"
          : ["in_purchase_order", "purchased"].includes(row.status)
            ? "in_order"
            : "done"

    const list = itemsByRequest.get(row.requestId) ?? []
    list.push({
      id:            row.id,
      // Comprar sin la talla obliga a abrir la solicitud para saber cuál pedir.
      productName:   row.productName
        ? formatSizedProductName(row.productName, row.productId ? sizeById.get(row.productId) : null)
        : row.productNameFree ?? "(sin nombre)",
      productSku:    row.productSku,
      quantity:      row.quantity,
      unitOfMeasure: row.unitOfMeasure,
      status:        row.status,
      stage,
      orderCode:     row.orderCode,
      orderId:       row.orderId,
      supplierName:  row.supplierName,
    })
    itemsByRequest.set(row.requestId, list)

    if (isPending && row.supplierName) {
      const names = suppliersByRequest.get(row.requestId) ?? new Set<string>()
      names.add(row.supplierName)
      suppliersByRequest.set(row.requestId, names)
    }
  }

  return requestRows.map((row) => ({
    id:               row.id,
    code:             row.code,
    status:           row.status,
    urgency:          row.urgency,
    requestType:      row.requestType,
    worksiteId:       row.worksiteId,
    worksiteName:     row.worksiteName,
    requesterName:    row.requesterName ?? row.requesterEmail ?? "—",
    date:             row.submittedAt ?? row.createdAt,
    pendingItemCount: row.pendingItemCount,
    supplierNames:    [...(suppliersByRequest.get(row.id) ?? [])].sort(),
    items:            itemsByRequest.get(row.id) ?? [],
  }))
}
