/**
 * Catalogar al comprar: el vínculo de una línea de repuesto con el catálogo, escrito
 * en el ítem de solicitud en el momento de elegirlo en la hoja «Catalogar» del
 * formulario de Nueva OC (FF-6, segundo recorrido 2026-11-09).
 *
 * Antes el vínculo vivía sólo en el estado del formulario y se escribía al crear la
 * OC (`purchase-orders-create.ts`). «Crear y vincular» ya había creado el repuesto
 * en el servidor, así que una recarga antes de crear la OC lo dejaba huérfano y la
 * línea salía a la OC sin `product_id`. Ahora la elección se guarda de inmediato,
 * con las mismas validaciones que la creación de la OC: solicitud de repuestos,
 * repuesto activo del catálogo, misma unidad, ítem sin otro producto y alcance de
 * faenas de quien lo hace.
 *
 * El vínculo lleva su propia marca (`linkedFrom: "catalog_sheet"`) y NO la de una OC
 * (`purchase_order`): no es una decisión de ninguna OC, así que eliminar o anular
 * una OC no lo toca (`spare-part-link-revert.ts` sólo revierte lo marcado con
 * `purchase_order`). A cambio es reversible a mano: mientras el ítem no tenga una OC
 * viva, la línea ofrece «Desvincular» y este servicio lo quita. Lo que eligió quien
 * pidió la solicitud no lleva marca y no se puede quitar desde aquí.
 */

import { and, eq, inArray, like } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import { auditLog, products, purchaseRequestItems, purchaseRequests } from "@/db/schema"
import { PENDING_PURCHASE_ITEM_STATUSES } from "@/lib/adquisiciones/pending-purchase"
import { TERMINAL_REQUEST_STATUSES } from "@/lib/approvals-queue"
import { recordAudit } from "@/lib/audit"
import { createSparePartTx, type SparePartInput } from "../spare-parts-catalog"
import { getActiveOrderedQuantityTx, PURCHASE_COVERAGE_EPSILON } from "./purchasable-coverage"
import { sparePartUnitMismatchMessage } from "./spare-part-unit"

/** La marca con que la bitácora distingue el vínculo hecho en la hoja del que hace una OC. */
export const CATALOG_SHEET_LINK_MARK = "catalog_sheet"

export interface SparePartItemLinkActor {
  userId: string
  userEmail?: string
  /** Faenas que la sesión puede operar; `"all"` para un rol global. */
  worksiteScope: string[] | "all"
}

interface LockedItem {
  id: string
  productId: string | null
  unitOfMeasure: string
  status: string
  worksiteId: string
  requestType: string
  requestStatus: string
}

/**
 * El ítem de solicitud, bloqueado, con lo que hace falta para decidir. Sólo se
 * bloquea la fila del ítem: es la misma que toma la creación de una OC, así que las
 * dos se serializan sin tocar la solicitud padre.
 */
async function lockItemForCatalogingTx(tx: Tx, requestItemId: string, actor: SparePartItemLinkActor): Promise<LockedItem> {
  const [row] = await tx
    .select({
      id: purchaseRequestItems.id,
      productId: purchaseRequestItems.productId,
      unitOfMeasure: purchaseRequestItems.unitOfMeasure,
      status: purchaseRequestItems.status,
      worksiteId: purchaseRequests.worksiteId,
      requestType: purchaseRequests.requestType,
      requestStatus: purchaseRequests.status,
    })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .where(eq(purchaseRequestItems.id, requestItemId))
    .for("update", { of: purchaseRequestItems })
  if (!row) throw new Error("El ítem de solicitud ya no existe: recarga la página")
  if (actor.worksiteScope !== "all" && !actor.worksiteScope.includes(row.worksiteId)) {
    throw new Error("No tienes acceso a la faena de este ítem")
  }
  return row
}

/** Sólo un ítem que todavía espera su OC se puede catalogar o descatalogar. */
async function assertStillPendingPurchaseTx(tx: Tx, item: LockedItem): Promise<void> {
  // Primero la cobertura: un ítem en una OC viva ya no está «aprobado», y el motivo
  // que sirve es la OC, no el estado.
  if ((await getActiveOrderedQuantityTx(tx, item.id)) > PURCHASE_COVERAGE_EPSILON) {
    throw new Error("El ítem ya está en una orden de compra: elimínala o anúlala antes de cambiar el repuesto")
  }
  const pending = (PENDING_PURCHASE_ITEM_STATUSES as readonly string[]).includes(item.status)
    && !(TERMINAL_REQUEST_STATUSES as readonly string[]).includes(item.requestStatus)
  if (!pending) throw new Error("El ítem ya no está pendiente de compra: recarga la página")
}

/**
 * Vincula la línea al repuesto, dentro de la transacción del llamador. Idempotente:
 * elegir el repuesto que la línea ya tiene no escribe nada.
 */
export async function linkSparePartToRequestItemTx(
  tx: Tx,
  input: { requestItemId: string; productId: string; actor: SparePartItemLinkActor },
): Promise<void> {
  const item = await lockItemForCatalogingTx(tx, input.requestItemId, input.actor)
  if (item.requestType !== "repuestos") {
    throw new Error("Sólo las líneas de una solicitud de repuestos se pueden vincular a un repuesto del catálogo")
  }
  await assertStillPendingPurchaseTx(tx, item)
  if (item.productId === input.productId) return
  if (item.productId) {
    throw new Error("El ítem ya está vinculado a otro producto del catálogo: recarga la página")
  }

  const [part] = await tx
    .select({ id: products.id, sku: products.sku, unitOfMeasure: products.unitOfMeasure })
    .from(products)
    .where(and(eq(products.id, input.productId), eq(products.isSparePart, true), eq(products.isActive, true)))
  if (!part) throw new Error("El repuesto elegido no existe, está inactivo o no es un repuesto del catálogo")
  const unitMismatch = sparePartUnitMismatchMessage(part, item.unitOfMeasure)
  if (unitMismatch) throw new Error(unitMismatch)

  await tx
    .update(purchaseRequestItems)
    .set({ productId: part.id, updatedAt: new Date().toISOString() })
    .where(eq(purchaseRequestItems.id, item.id))
  await recordAudit({
    userId:     input.actor.userId,
    userEmail:  input.actor.userEmail,
    action:     "update",
    entityType: "request_item",
    entityId:   item.id,
    oldState:   { productId: null },
    newState:   { productId: part.id, linkedFrom: CATALOG_SHEET_LINK_MARK },
  }, tx)
}

export async function linkSparePartToRequestItem(
  input: { requestItemId: string; productId: string; actor: SparePartItemLinkActor },
): Promise<void> {
  await db.transaction((tx) => linkSparePartToRequestItemTx(tx as unknown as Tx, input))
}

/**
 * Da de alta el repuesto y lo vincula a la línea en UNA transacción: si el vínculo
 * se rechaza (otro producto, otra unidad, ítem ya en una OC…) el repuesto tampoco
 * queda creado, así que el catálogo no gana repuestos huérfanos.
 */
export async function createSparePartAndLinkToRequestItem(input: {
  requestItemId: string
  sparePart: SparePartInput
  actor: SparePartItemLinkActor
}): Promise<{ id: string; sku: string }> {
  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Tx
    const created = await createSparePartTx(tx, { ...input.sparePart, createdByUserId: input.actor.userId })
    await linkSparePartToRequestItemTx(tx, { requestItemId: input.requestItemId, productId: created.id, actor: input.actor })
    return created
  })
}

/**
 * Quita el vínculo hecho desde la hoja y devuelve la línea a texto libre. Sólo lo que
 * la hoja vinculó (`findSheetLinkedItemIds`) y sólo mientras el ítem no esté en una
 * OC viva; conserva el texto libre para que la línea no se quede sin nombre.
 */
export async function unlinkSparePartFromRequestItemTx(
  tx: Tx,
  input: { requestItemId: string; actor: SparePartItemLinkActor },
): Promise<void> {
  const item = await lockItemForCatalogingTx(tx, input.requestItemId, input.actor)
  if (!item.productId) return
  await assertStillPendingPurchaseTx(tx, item)
  if (!(await findSheetLinkedItemIds([item.id], tx)).has(item.id)) {
    throw new Error("Este repuesto lo eligió quien hizo la solicitud: no se puede quitar desde la orden de compra")
  }

  await tx
    .update(purchaseRequestItems)
    .set({ productId: null, updatedAt: new Date().toISOString() })
    .where(eq(purchaseRequestItems.id, item.id))
  await recordAudit({
    userId:     input.actor.userId,
    userEmail:  input.actor.userEmail,
    action:     "update",
    entityType: "request_item",
    entityId:   item.id,
    oldState:   { productId: item.productId },
    newState:   { productId: null, unlinkedFrom: CATALOG_SHEET_LINK_MARK },
  }, tx)
}

export async function unlinkSparePartFromRequestItem(
  input: { requestItemId: string; actor: SparePartItemLinkActor },
): Promise<void> {
  await db.transaction((tx) => unlinkSparePartFromRequestItemTx(tx as unknown as Tx, input))
}

/**
 * De los ítems dados, los que tienen hoy un repuesto vinculado desde la hoja
 * «Catalogar»: la bitácora marca ese mismo repuesto en el ítem o en un ítem del que
 * se separó. El remanente de una compra parcial copia el repuesto sin marca propia,
 * así que hereda la del ítem de origen, a cualquier profundidad.
 *
 * Es lo que decide si la línea ofrece «Desvincular». El repuesto que eligió quien
 * pidió no tiene marca y no entra. La marca se filtra con `LIKE` y se confirma en JS
 * en vez de castear `new_state` a `jsonb`: un estado viejo que no fuese JSON válido
 * haría fallar la lectura de toda la página.
 */
export async function findSheetLinkedItemIds(
  itemIds: readonly string[],
  reader: Pick<DB, "select"> = db,
): Promise<Set<string>> {
  const found = new Set<string>()
  const wanted = [...new Set(itemIds)]
  if (wanted.length === 0) return found

  const rows = await reader
    .select({ id: purchaseRequestItems.id, productId: purchaseRequestItems.productId, parentId: purchaseRequestItems.splitFromItemId })
    .from(purchaseRequestItems)
    .where(inArray(purchaseRequestItems.id, wanted))
  const productOf = new Map(rows.map((row) => [row.id, row.productId]))
  const parentOf = new Map<string, string>()
  for (const row of rows) if (row.parentId) parentOf.set(row.id, row.parentId)

  // Los ancestros, de a un nivel por consulta (las compras parciales anidan poco).
  let frontier = [...new Set(rows.flatMap((row) => (row.parentId && !productOf.has(row.parentId) ? [row.parentId] : [])))]
  const known = new Set(productOf.keys())
  while (frontier.length > 0) {
    const parents = await reader
      .select({ id: purchaseRequestItems.id, parentId: purchaseRequestItems.splitFromItemId })
      .from(purchaseRequestItems)
      .where(inArray(purchaseRequestItems.id, frontier))
    const next: string[] = []
    for (const parent of parents) {
      known.add(parent.id)
      if (parent.parentId) {
        parentOf.set(parent.id, parent.parentId)
        if (!known.has(parent.parentId)) next.push(parent.parentId)
      }
    }
    frontier = [...new Set(next)]
  }

  const marks = await reader
    .select({ entityId: auditLog.entityId, newState: auditLog.newState })
    .from(auditLog)
    .where(and(
      eq(auditLog.entityType, "request_item"),
      inArray(auditLog.entityId, [...known]),
      like(auditLog.newState, `%"linkedFrom":"${CATALOG_SHEET_LINK_MARK}"%`),
    ))
  const markedProducts = new Map<string, Set<string>>()
  for (const mark of marks) {
    let state: { productId?: unknown; linkedFrom?: unknown }
    try {
      state = JSON.parse(mark.newState ?? "{}")
    } catch {
      continue
    }
    if (state.linkedFrom !== CATALOG_SHEET_LINK_MARK || typeof state.productId !== "string") continue
    const set = markedProducts.get(mark.entityId) ?? new Set<string>()
    set.add(state.productId)
    markedProducts.set(mark.entityId, set)
  }

  for (const id of wanted) {
    const productId = productOf.get(id)
    if (!productId) continue
    const seen = new Set<string>()
    for (let current: string | undefined = id; current && !seen.has(current); current = parentOf.get(current)) {
      seen.add(current)
      if (markedProducts.get(current)?.has(productId)) {
        found.add(id)
        break
      }
    }
  }
  return found
}
