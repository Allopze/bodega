import { and, eq, isNull, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  deliveries,
  deliveryItems,
  products,
  purchaseOrderItems,
  stockReturns,
  worksites,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { revertDeliveredItemTx } from "@/lib/services/item-state"
import { recordPdtpFulfillmentRevocation } from "@/lib/services/pdtp/fulfillment"
import { applyMovementTx } from "@/lib/services/stock"
import { enqueueGeneratedDocumentTx } from "@/lib/services/generated-documents/enqueue"

/**
 * Anula una entrega a trabajador y devuelve el stock a la bodega de origen.
 *
 * Anular no es devolver. Una devolución (`stock_returns`) documenta que el
 * material volvió físicamente; una anulación dice que la entrega **nunca debió
 * registrarse** —la talla equivocada, el trabajador equivocado, un duplicado— y
 * por eso emite su propio tipo de movimiento (`ingreso_anulacion`) en vez de
 * disfrazarse de devolución en el kardex.
 *
 * La entrega no se borra: se marca. Las líneas y sus movimientos originales
 * siguen ahí, y el reverso queda como un segundo movimiento. Lo que sí cambia
 * es que toda suma de "cuánto se entregó" deja de contarla.
 *
 * El stock vuelve a la **variante** exacta de cada línea (`product_id`), que es
 * lo que fija la talla: anular una entrega de la talla 42 repone la 42.
 */
export interface VoidDeliveryInput {
  deliveryId: string
  reason: string
  voidedBy: string
  userEmail?: string
}

export async function voidWorkerStockDelivery(
  input: VoidDeliveryInput,
  worksiteIds: string[] | "all" = "all",
): Promise<void> {
  const reason = input.reason?.trim() ?? ""
  // El mismo mínimo que exige el CHECK de la tabla: anular sin explicar por qué
  // deja un descuadre de inventario que nadie puede reconstruir después.
  if (reason.length < 10) {
    throw new Error("La anulación requiere un motivo de al menos 10 caracteres")
  }

  let sourceWorksiteId: string | null = null
  // Espejo de `deliveries-worker-stock.ts`: la acreditación sólo dispara
  // `if (product.isEpp)`, así que su reverso tiene que respetar la misma
  // condición — revocar una entrega que nunca tuvo EPP fabricaría un evento en
  // el libro de cumplimiento que no corresponde a ningún hecho acreditado.
  let deliveredEpp = false

  await db.transaction(async (tx) => {
    const [delivery] = await tx
      .select()
      .from(deliveries)
      .where(eq(deliveries.id, input.deliveryId))
      .for("update")

    if (!delivery) throw new Error("Entrega no encontrada")
    if (delivery.voidedAt) throw new Error("Esta entrega ya fue anulada")
    if (delivery.destinationType !== "worker") {
      throw new Error("Solo se pueden anular entregas a trabajador")
    }

    // El stock vuelve a donde salió. Sin bodega de origen conocida no hay a
    // dónde reponer, y adivinarla inventaría existencias en una faena.
    sourceWorksiteId = delivery.sourceWorksiteId
    if (!sourceWorksiteId) {
      throw new Error("La entrega no registra bodega de origen: no se puede reponer el stock")
    }
    if (worksiteIds !== "all" && !worksiteIds.includes(sourceWorksiteId)) {
      throw new Error("No tienes acceso a la bodega de esta entrega")
    }

    const [sourceWorksite] = await tx
      .select({ id: worksites.id, name: worksites.name, isActive: worksites.isActive })
      .from(worksites)
      .where(eq(worksites.id, sourceWorksiteId))
    if (!sourceWorksite?.isActive) {
      throw new Error("La bodega de origen está inactiva: no se puede reponer el stock")
    }

    const items = await tx
      .select({
        id: deliveryItems.id,
        productId: deliveryItems.productId,
        requestItemId: deliveryItems.requestItemId,
        quantity: deliveryItems.quantity,
      })
      .from(deliveryItems)
      .where(eq(deliveryItems.deliveryId, delivery.id))
      // Orden estable de bloqueo, igual que al registrar: dos anulaciones
      // simultáneas de entregas que comparten productos no se cruzan.
      .orderBy(deliveryItems.productId)

    if (items.length === 0) throw new Error("La entrega no tiene líneas que reponer")

    // Una línea ya devuelta contó una vez en el stock: reponerla otra vez por
    // anulación la duplicaría. Se exige deshacer la devolución primero.
    const [returned] = await tx
      .select({ total: sql<number>`count(*)` })
      .from(stockReturns)
      .innerJoin(deliveryItems, eq(stockReturns.deliveryItemId, deliveryItems.id))
      .where(eq(deliveryItems.deliveryId, delivery.id))
    if (Number(returned?.total ?? 0) > 0) {
      throw new Error("Esta entrega tiene devoluciones registradas: anula o revierte la devolución antes")
    }

    const now = new Date().toISOString()
    const auditItems: Array<{ productId: string | null; quantity: number }> = []

    for (const item of items) {
      // Una línea de texto libre no movió stock de catálogo y no tiene qué
      // reponer, pero igual deja de contar como entregada.
      if (item.productId) {
        const [product] = await tx
          .select({ id: products.id, name: products.name, isEpp: products.isEpp })
          .from(products)
          .where(eq(products.id, item.productId))
        if (!product) throw new Error("El producto de una línea ya no existe")
        if (product.isEpp) deliveredEpp = true

        await applyMovementTx(tx, {
          worksiteId: sourceWorksiteId,
          productId: item.productId,
          type: "ingreso_anulacion",
          quantity: item.quantity,
          referenceType: "delivery_void",
          referenceId: delivery.id,
          performedBy: input.voidedBy,
          userEmail: input.userEmail,
          reason: `Anulación de entrega ${delivery.code}`,
          notes: reason,
        })
      }

      if (item.requestItemId) {
        // El saldo entregado que queda vigente excluye esta entrega — que aún no
        // está marcada como anulada, así que se descuenta explícitamente.
        const [remaining] = await tx
          .select({ total: sql<number>`coalesce(sum(${deliveryItems.quantity}), 0)` })
          .from(deliveryItems)
          .innerJoin(deliveries, eq(deliveryItems.deliveryId, deliveries.id))
          .where(and(
            eq(deliveryItems.requestItemId, item.requestItemId),
            ne(deliveries.id, delivery.id),
            isNull(deliveries.voidedAt),
          ))

        const [receivedRow] = await tx
          .select({ received: sql<number>`coalesce(sum(${purchaseOrderItems.quantityReceived}), 0)` })
          .from(purchaseOrderItems)
          .where(eq(purchaseOrderItems.requestItemId, item.requestItemId))

        await revertDeliveredItemTx(tx, item.requestItemId, input.voidedBy, {
          userEmail: input.userEmail,
          totalDelivered: Number(remaining?.total ?? 0),
          receivedAtFaena: Number(receivedRow?.received ?? 0),
          reason: `Anulación de entrega ${delivery.code}`,
        })
      }

      auditItems.push({ productId: item.productId, quantity: item.quantity })
    }

    await tx
      .update(deliveries)
      .set({ voidedAt: now, voidedBy: input.voidedBy, voidReason: reason })
      .where(and(eq(deliveries.id, delivery.id), isNull(deliveries.voidedAt)))

    await recordAudit({
      userId: input.voidedBy,
      userEmail: input.userEmail,
      action: "update",
      entityType: "delivery",
      entityId: delivery.id,
      entityCode: delivery.code,
      oldState: { voidedAt: null },
      newState: { voidedAt: now, voidReason: reason, restoredItems: auditItems },
      reason,
    }, tx)

    // La anulación cambia lo que dice el comprobante: es una copia nueva en
    // Cloudreve, junto a la de «registrada». Misma condición que el alta.
    if (deliveredEpp) {
      await enqueueGeneratedDocumentTx(tx, {
        kind: "entrega",
        entityId: delivery.id,
        milestone: "anulada",
        worksiteId: delivery.worksiteId,
        occurredAt: now,
        actorUserId: input.voidedBy,
      })
    }
  })

  // Revierte la N°62. Mismo patrón que `cancelTrainingSession`: post-commit,
  // sin propagar, con el motivo de la anulación como evidencia del evento para
  // que la revocación se audite sin volver a la guía. Sólo si la entrega
  // acreditó algo en primer lugar (ver `deliveredEpp` arriba).
  if (deliveredEpp) {
    await recordPdtpFulfillmentRevocation({
      sourceType: "epp",
      sourceId: input.deliveryId,
      worksiteId: sourceWorksiteId!,
      revokedBy: input.voidedBy,
      reason: `Entrega anulada: ${reason}`,
    })
  }
}
