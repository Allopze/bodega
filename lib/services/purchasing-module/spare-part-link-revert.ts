/**
 * Catálogo de repuestos: deshacer el vínculo que Compras hizo al armar una OC.
 *
 * Al armar la OC, una línea de repuesto pedida en texto libre puede catalogarse
 * (`purchase-orders-create.ts`): el `product_id` se escribe en el ítem de
 * solicitud y en el remanente de una compra parcial, y cada escritura queda en
 * la bitácora con `linkedFrom: "purchase_order"` y el `purchaseOrderId` de la OC.
 * Ese vínculo es una decisión de esa OC; si la OC se elimina (borrador) o se
 * anula, la decisión cae con ella. Sin deshacerlo, un vínculo equivocado quedaba
 * para siempre: la línea ya no ofrecía «Catalogar», el servidor rechazaba otro
 * repuesto y la próxima OC emitida escribía su precio en el repuesto equivocado.
 *
 * Se deshace sólo lo que esa OC vinculó (con los remanentes que lo heredaron, a
 * cualquier profundidad), y sólo si:
 *  - el ítem sigue apuntando al mismo repuesto que vinculó la OC;
 *  - ninguna otra OC viva lo cubre (esa OC ya compra ese repuesto);
 *  - conserva su texto libre, para no dejar una línea sin nombre.
 * El repuesto que eligió quien pidió no tiene esa marca y no se toca nunca.
 */

import { and, eq, inArray, like } from "drizzle-orm"
import type { Tx } from "@/db"
import { auditLog, purchaseRequestItems } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { getActiveOrderedQuantitiesTx, PURCHASE_COVERAGE_EPSILON } from "./purchasable-coverage"

/**
 * Lo que esta OC vinculó, por ítem de solicitud: el repuesto que le puso y, si
 * el ítem no lleva marca propia sino que la heredó al separarse de un ítem
 * vinculado (el remanente de una compra parcial hecha por otra OC), de cuál.
 */
export type OrderSparePartLinks = Map<string, { productId: string; inheritedFrom: string | null }>

/**
 * Los ítems de solicitud que esta OC vinculó a un repuesto, con el repuesto que
 * les puso. Se lee antes de bloquear, para sumar los remanentes (que no tienen
 * línea en la OC) al mismo bloqueo en orden léxico que toman eliminar y anular.
 *
 * Candidatos: los ítems de las líneas de la OC y todos sus descendientes por
 * `splitFromItemId`, a cualquier profundidad. El remanente que deja esta OC
 * lleva su marca; pero si otra OC compra parte de ese remanente, el nuevo
 * remanente copia el repuesto sin marca (esa otra OC no vinculó nada). Ese
 * descendiente hereda el vínculo de su padre y cae con él. La bitácora se
 * consulta sólo para los candidatos (índice por entidad). La marca se filtra
 * con `LIKE` y se confirma en JS en vez de castear `new_state` a `jsonb`: un
 * estado viejo que no fuese JSON válido haría fallar el cast y, con él,
 * eliminar la OC.
 *
 * El mapa sale en orden de árbol (padres antes que hijos), que es el orden en
 * que `revertOrderSparePartLinksTx` decide.
 */
export async function findOrderSparePartLinksTx(
  tx: Tx,
  orderId: string,
  orderRequestItemIds: readonly string[],
): Promise<OrderSparePartLinks> {
  const links: OrderSparePartLinks = new Map()
  const lineItemIds = [...new Set(orderRequestItemIds)]
  if (lineItemIds.length === 0) return links

  const parentOf = new Map<string, string>()
  const treeOrder = [...lineItemIds]
  const seen = new Set(lineItemIds)
  let frontier = lineItemIds
  while (frontier.length > 0) {
    const children = await tx
      .select({ id: purchaseRequestItems.id, parentId: purchaseRequestItems.splitFromItemId })
      .from(purchaseRequestItems)
      .where(inArray(purchaseRequestItems.splitFromItemId, frontier))
      .orderBy(purchaseRequestItems.id)
    frontier = []
    for (const child of children) {
      if (seen.has(child.id) || !child.parentId) continue
      seen.add(child.id)
      parentOf.set(child.id, child.parentId)
      treeOrder.push(child.id)
      frontier.push(child.id)
    }
  }

  const rows = await tx
    .select({ requestItemId: auditLog.entityId, newState: auditLog.newState })
    .from(auditLog)
    .where(and(
      eq(auditLog.entityType, "request_item"),
      inArray(auditLog.entityId, treeOrder),
      like(auditLog.newState, '%"linkedFrom":"purchase_order"%'),
    ))

  const marked = new Map<string, string>()
  for (const row of rows) {
    let state: { productId?: unknown; linkedFrom?: unknown; purchaseOrderId?: unknown }
    try {
      state = JSON.parse(row.newState ?? "{}")
    } catch {
      continue
    }
    if (state.linkedFrom !== "purchase_order" || state.purchaseOrderId !== orderId) continue
    if (typeof state.productId === "string") marked.set(row.requestItemId, state.productId)
  }

  for (const id of treeOrder) {
    const own = marked.get(id)
    if (own) {
      links.set(id, { productId: own, inheritedFrom: null })
      continue
    }
    const parentId = parentOf.get(id)
    const parentLink = parentId ? links.get(parentId) : undefined
    if (parentId && parentLink) links.set(id, { productId: parentLink.productId, inheritedFrom: parentId })
  }
  return links
}

/**
 * Devuelve a texto libre los ítems que esta OC vinculó. Llamar dentro de la
 * transacción que elimina o anula la OC, con los ítems ya bloqueados y con las
 * líneas de la OC ya anuladas (para que la OC no cuente como cobertura viva).
 */
export async function revertOrderSparePartLinksTx(
  tx: Tx,
  input: {
    orderId: string
    links: OrderSparePartLinks
    userId: string
    userEmail?: string
  },
): Promise<string[]> {
  if (input.links.size === 0) return []

  const rows = await tx
    .select({
      id: purchaseRequestItems.id,
      productId: purchaseRequestItems.productId,
      productNameFree: purchaseRequestItems.productNameFree,
    })
    .from(purchaseRequestItems)
    .where(inArray(purchaseRequestItems.id, [...input.links.keys()]))
  const itemById = new Map(rows.map((row) => [row.id, row]))
  const coverage = await getActiveOrderedQuantitiesTx(tx, rows.map((item) => item.id))

  const reverted: string[] = []
  const revertedIds = new Set<string>()
  // Orden de árbol: un descendiente que sólo heredó el vínculo cae si cae su
  // padre. Si el padre lo conserva (otra OC viva lo compra), el remanente que
  // esa compra dejó también lo conserva.
  for (const [itemId, link] of input.links) {
    const item = itemById.get(itemId)
    if (!item || item.productId !== link.productId) continue
    if (link.inheritedFrom && !revertedIds.has(link.inheritedFrom)) continue
    if ((coverage.get(item.id) ?? 0) > PURCHASE_COVERAGE_EPSILON) continue
    if (!item.productNameFree?.trim()) continue

    await tx
      .update(purchaseRequestItems)
      .set({ productId: null, updatedAt: new Date().toISOString() })
      .where(eq(purchaseRequestItems.id, item.id))
    await recordAudit({
      userId:     input.userId,
      userEmail:  input.userEmail,
      action:     "update",
      entityType: "request_item",
      entityId:   item.id,
      oldState:   { productId: link.productId },
      newState:   { productId: null, unlinkedFrom: "purchase_order", purchaseOrderId: input.orderId },
    }, tx)
    reverted.push(item.id)
    revertedIds.add(item.id)
  }
  return reverted
}
