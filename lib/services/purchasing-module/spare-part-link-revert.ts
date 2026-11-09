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
 * Se deshace sólo lo que esa OC vinculó, y sólo si:
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
 * Los ítems de solicitud que esta OC vinculó a un repuesto, con el repuesto que
 * les puso. Se lee antes de bloquear, para sumar los remanentes (que no tienen
 * línea en la OC) al mismo bloqueo en orden léxico que toman eliminar y anular.
 *
 * Candidatos: los ítems de las líneas de la OC y sus remanentes; la bitácora se
 * consulta sólo para ellos (índice por entidad). La marca se filtra con `LIKE`
 * y se confirma en JS en vez de castear `new_state` a `jsonb`: un estado viejo
 * que no fuese JSON válido haría fallar el cast y, con él, eliminar la OC.
 */
export async function findOrderSparePartLinksTx(
  tx: Tx,
  orderId: string,
  orderRequestItemIds: readonly string[],
): Promise<Map<string, string>> {
  const links = new Map<string, string>()
  const lineItemIds = [...new Set(orderRequestItemIds)]
  if (lineItemIds.length === 0) return links

  const remainders = await tx
    .select({ id: purchaseRequestItems.id })
    .from(purchaseRequestItems)
    .where(inArray(purchaseRequestItems.splitFromItemId, lineItemIds))
  const candidateIds = [...new Set([...lineItemIds, ...remainders.map((row) => row.id)])]

  const rows = await tx
    .select({ requestItemId: auditLog.entityId, newState: auditLog.newState })
    .from(auditLog)
    .where(and(
      eq(auditLog.entityType, "request_item"),
      inArray(auditLog.entityId, candidateIds),
      like(auditLog.newState, '%"linkedFrom":"purchase_order"%'),
    ))

  for (const row of rows) {
    let state: { productId?: unknown; linkedFrom?: unknown; purchaseOrderId?: unknown }
    try {
      state = JSON.parse(row.newState ?? "{}")
    } catch {
      continue
    }
    if (state.linkedFrom !== "purchase_order" || state.purchaseOrderId !== orderId) continue
    if (typeof state.productId === "string") links.set(row.requestItemId, state.productId)
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
    links: Map<string, string>
    userId: string
    userEmail?: string
  },
): Promise<string[]> {
  if (input.links.size === 0) return []

  const items = await tx
    .select({
      id: purchaseRequestItems.id,
      productId: purchaseRequestItems.productId,
      productNameFree: purchaseRequestItems.productNameFree,
    })
    .from(purchaseRequestItems)
    .where(inArray(purchaseRequestItems.id, [...input.links.keys()]))
  const coverage = await getActiveOrderedQuantitiesTx(tx, items.map((item) => item.id))

  const reverted: string[] = []
  for (const item of items) {
    const linkedProductId = input.links.get(item.id)
    if (!linkedProductId || item.productId !== linkedProductId) continue
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
      oldState:   { productId: linkedProductId },
      newState:   { productId: null, unlinkedFrom: "purchase_order", purchaseOrderId: input.orderId },
    }, tx)
    reverted.push(item.id)
  }
  return reverted
}
