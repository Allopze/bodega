/**
 * Purchase order status transitions: issue+send (fused), cancel.
 * All DB mutations here, never in Server Actions or UI components.
 */

import { eq, and, desc, gt, inArray, isNotNull } from "drizzle-orm"
import { db } from "@/db"
import {
  productSupplierPriceHistory,
  productSuppliers,
  products,
  purchaseOrders,
  purchaseOrderItems,
  purchaseRequestItems,
  suppliers,
} from "@/db/schema"
import { recordAudit, recordStatusChange, recordStatusChanges } from "@/lib/audit"
import { setProductSupplierPriceTx } from "@/lib/services/product-supplier-prices"
import { lockRequestsForRollupTx, rollupRequestStatus } from "@/lib/services/item-state-module/rollup"
import {
  getActiveOrderedQuantitiesTx,
  lockPurchaseRequestItemsTx,
  PURCHASE_COVERAGE_EPSILON,
} from "./purchasable-coverage"
import { findOrderSparePartLinksTx, revertOrderSparePartLinksTx } from "./spare-part-link-revert"
import { normalizeUnitOfMeasure } from "./spare-part-unit"

/* ── Emitir y enviar (draft → sent) ─────────────────────────────────────────────
 * Fusión 2026-08-07: "emitir" y "enviar al proveedor" eran dos pasos (draft →
 * issued → sent); el estado `issued` se retiró. issuedAt/issuedBy y sentAt se
 * registran juntos en la única transición. */

/**
 * OC-002 (auditoría 2026-09-14): constancia de que la OC salió al proveedor.
 *
 * `dispatchEvidence` es lo que el operador declara haber hecho (nº de correo,
 * acuse, "entregada en mano al vendedor"…). No es obligatorio: exigirlo, o
 * partir «Emitir» de «Enviar» en dos estados, es una decisión de producto que
 * la plataforma no declara en ninguna parte. Lo que sí se puede afirmar sin
 * decidir nada es a qué contacto registrado se dirige la orden, y que cuando no
 * hay contacto ni declaración la plataforma NO puede sostener que la compra
 * salió.
 */
export interface OrderDispatchRecord {
  /** Canal de contacto del proveedor vigente al emitir, o null si no hay. */
  sentTo: string | null
  /** Constancia declarada por quien emite, si la aportó. */
  evidence: string | null
  /** False cuando no hay ni contacto registrado ni constancia declarada. */
  hasDispatchEvidence: boolean
  /** Frase que se guarda en historial y auditoría; la usa también el aviso. */
  summary: string
}

type PriceTx = Parameters<typeof setProductSupplierPriceTx>[0]

/**
 * Catálogo de repuestos: emitir la OC deja constancia del precio que se acordó
 * con el proveedor. Cada línea cuyo producto es un repuesto de catálogo
 * (`is_spare_part`) registra su precio unitario en `product_suppliers` y en su
 * historial con fuente `purchase_order`; así «¿cuánto pagamos la última vez y a
 * quién?» se responde desde la ficha del repuesto. EPP y demás productos no se
 * tocan: su precio sigue viniendo de la ficha del producto y de la conciliación.
 *
 * - Se registra el precio neto de descuento (`subtotal / cantidad`), el mismo
 *   criterio de la conciliación de facturas, para que ambas fuentes sean
 *   comparables. Una línea sin precio o con precio 0 no informa nada y se omite.
 * - `rejectOlderThanCurrent`: si el catálogo ya trae un precio más reciente (una
 *   factura conciliada con fecha posterior), la OC no lo pisa.
 * - Si una misma OC repite un repuesto con precios distintos, se registra uno
 *   solo, el de la última línea: cada OC tiene a lo más una fila de historial
 *   por repuesto y proveedor, y anularla deshace exactamente esa.
 * - Repetir el precio vigente también deja fila (precio igual antes y después):
 *   es la constancia de que esta OC lo sostiene.
 * - Una línea cuya unidad no es la del repuesto se omite: su precio es por otra
 *   magnitud. El vínculo hecho al armar la OC ya lo impide; esto cubre el
 *   repuesto elegido al pedir con otra unidad.
 */
async function recordSparePartPricesTx(
  tx: PriceTx,
  input: { orderId: string; supplierId: string; userId: string; effectiveAt: string },
): Promise<void> {
  const lines = await tx
    .select({
      productId:  purchaseOrderItems.productId,
      quantity:   purchaseOrderItems.quantity,
      unitPrice:  purchaseOrderItems.unitPrice,
      discount:   purchaseOrderItems.discount,
      lineUnit:   purchaseOrderItems.unitOfMeasure,
      partUnit:   products.unitOfMeasure,
    })
    .from(purchaseOrderItems)
    .innerJoin(products, eq(products.id, purchaseOrderItems.productId))
    .where(and(
      eq(purchaseOrderItems.purchaseOrderId, input.orderId),
      eq(products.isSparePart, true),
      isNotNull(purchaseOrderItems.unitPrice),
      gt(purchaseOrderItems.unitPrice, 0),
    ))
    .orderBy(purchaseOrderItems.sortOrder, purchaseOrderItems.id)

  // Un precio por repuesto: si la OC lo repite, vale la última línea. Escribir
  // una fila por línea dejaba varias filas de la misma OC con la misma vigencia,
  // y al anularla el orden entre ellas (y el precio restaurado) era al azar.
  const priceByProduct = new Map<string, number>()
  for (const line of lines) {
    if (!line.productId || line.unitPrice === null || line.quantity <= 0) continue
    // Precio por «juego» no es precio por «unidad»: una línea en otra unidad que
    // la del repuesto no informa su precio. Se compara en JS con el mismo
    // normalizador que valida el vínculo al armar la OC: `trim()` de Postgres
    // sólo quita espacios y dejaba fuera una unidad con tabulación o espacio
    // duro que el vínculo sí había aceptado.
    if (normalizeUnitOfMeasure(line.lineUnit) !== normalizeUnitOfMeasure(line.partUnit)) continue
    const netUnitPrice = line.unitPrice * (1 - (line.discount ?? 0) / 100)
    if (!(netUnitPrice > 0)) continue
    priceByProduct.delete(line.productId)
    priceByProduct.set(line.productId, netUnitPrice)
  }
  for (const [productId, unitPrice] of priceByProduct) {
    await setProductSupplierPriceTx(tx, {
      productId,
      supplierId: input.supplierId,
      unitPrice,
      source:     "purchase_order",
      sourceId:   input.orderId,
      effectiveAt: input.effectiveAt,
      userId:     input.userId,
      rejectOlderThanCurrent: true,
      // Repetir el precio vigente lo confirma: si se anula la OC que lo escribió
      // antes, esta lo sigue sosteniendo.
      recordSamePrice: true,
    })
  }
}

/**
 * Catálogo de repuestos: anular una OC emitida retira el precio que escribió.
 *
 * Una OC anulada no es un precio acordado; dejarlo vigente hacía que «¿cuánto
 * pagamos la última vez?» respondiera con una compra que no ocurrió. El
 * historial de cada repuesto y proveedor es una cadena: cada fila anota el
 * precio que reemplazó (`previous_price`) y el que dejó (`new_price`). Para cada
 * fila de esta OC (fuente `purchase_order` con su id; una por repuesto y
 * proveedor, ver `recordSparePartPricesTx`):
 *
 * - Si no es la más reciente, otra fuente escribió o confirmó un precio después
 *   (otra OC, una factura conciliada, la ficha del producto). El precio vigente
 *   es de esa fuente y no se toca, pero la cadena se empalma: la fila siguiente
 *   pasa a reemplazar lo que había antes de esta OC. Sin el empalme, anular
 *   después la OC siguiente «restauraba» el precio de una OC ya anulada.
 * - Si es la más reciente y su precio es el vigente, el precio vino de esta OC:
 *   vuelve el que reemplazó, con la vigencia de la fila anterior. Si no había
 *   precio, la relación la creó esta OC y se elimina, salvo que alguien la haya
 *   marcado preferida o anotado algo en ella desde entonces: en ese caso se
 *   conserva sin precio. Sin fila anterior (un precio previo al historial) la
 *   vigencia queda como está: no hay de dónde saber la original.
 *
 * El orden es el de vigencia y, a igual vigencia, el de escritura: una factura
 * del mismo día que corrige la OC se fecha en la vigencia de la OC (ver
 * `effectiveDay`) y queda después por haberse escrito después.
 */
async function revertSparePartPricesTx(tx: PriceTx, orderId: string): Promise<void> {
  const written = await tx
    .selectDistinct({
      productId:  productSupplierPriceHistory.productId,
      supplierId: productSupplierPriceHistory.supplierId,
    })
    .from(productSupplierPriceHistory)
    .where(and(
      eq(productSupplierPriceHistory.source, "purchase_order"),
      eq(productSupplierPriceHistory.sourceId, orderId),
    ))
    .orderBy(productSupplierPriceHistory.productId, productSupplierPriceHistory.supplierId)

  for (const { productId, supplierId } of written) {
    let [relation] = await tx
      .select()
      .from(productSuppliers)
      .where(and(eq(productSuppliers.productId, productId), eq(productSuppliers.supplierId, supplierId)))
      .for("update")
    // Del más nuevo al más viejo.
    const history = await tx
      .select()
      .from(productSupplierPriceHistory)
      .where(and(
        eq(productSupplierPriceHistory.productId, productId),
        eq(productSupplierPriceHistory.supplierId, supplierId),
      ))
      .orderBy(
        desc(productSupplierPriceHistory.effectiveDate),
        desc(productSupplierPriceHistory.createdAt),
        desc(productSupplierPriceHistory.id),
      )
    const isOwn = (row: (typeof history)[number]) => row.source === "purchase_order" && row.sourceId === orderId

    // Las propias, de la más nueva a la más vieja: al llegar a cada una, toda
    // fila propia más nueva ya salió de la cadena.
    for (const own of history.filter(isOwn)) {
      const index = history.indexOf(own)
      const newer = index > 0 ? history[index - 1]! : null
      const older = history[index + 1] ?? null

      if (newer) {
        await tx.update(productSupplierPriceHistory)
          .set({ previousPrice: own.previousPrice })
          .where(eq(productSupplierPriceHistory.id, newer.id))
        newer.previousPrice = own.previousPrice
      } else if (relation && relation.unitPrice === own.newPrice) {
        if (own.previousPrice !== null) {
          const lastUpdated = older?.effectiveDate ?? relation.lastUpdated
          await tx.update(productSuppliers)
            .set({ unitPrice: own.previousPrice, lastUpdated })
            .where(eq(productSuppliers.id, relation.id))
          relation = { ...relation, unitPrice: own.previousPrice, lastUpdated }
        } else if (!relation.isPreferred && !relation.notes) {
          await tx.delete(productSuppliers).where(eq(productSuppliers.id, relation.id))
          relation = undefined
        } else {
          await tx.update(productSuppliers)
            .set({ unitPrice: null })
            .where(eq(productSuppliers.id, relation.id))
          relation = { ...relation, unitPrice: null }
        }
      }

      await tx.delete(productSupplierPriceHistory).where(eq(productSupplierPriceHistory.id, own.id))
      history.splice(index, 1)
    }
  }
}

export async function issueAndSendOrder(
  orderId: string,
  userId: string,
  worksiteIds: string[] | 'all' = 'all',
  opts?: { userEmail?: string; dispatchEvidence?: string },
): Promise<OrderDispatchRecord> {
  let dispatch!: OrderDispatchRecord
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(purchaseOrders)
      .where(eq(purchaseOrders.id, orderId)).for("update")
    if (!order) throw new Error(`Order ${orderId} not found`)
    if (worksiteIds !== 'all' && !worksiteIds.includes(order.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }
    if (order.status !== "draft") {
      throw new Error(`Cannot issue and send order in state '${order.status}'`)
    }

    /*
     * OC-001 (auditoría 2026-09-14): el proveedor activo se exigía sólo al crear
     * el borrador. Entre el borrador y la emisión un administrador puede
     * desactivarlo, y emitir comprometía la compra igual —con recepción, costo y
     * facturación— contra una contraparte que la administración ya retiró.
     *
     * Se lee bajo bloqueo, dentro de la misma transacción que la OC: leerlo sin
     * bloquear dejaría abierta justo la carrera que el hallazgo describe.
     */
    const [supplier] = await tx
      .select({
        id: suppliers.id,
        name: suppliers.name,
        isActive: suppliers.isActive,
        // OC-002: el destinatario se congela al emitir. Si mañana cambia la
        // ficha del proveedor, la traza debe seguir diciendo a dónde se dijo
        // que salió esta orden.
        email: suppliers.email,
        phone: suppliers.phone,
      })
      .from(suppliers)
      .where(eq(suppliers.id, order.supplierId))
      .for("update")
    if (!supplier) {
      throw new Error("El proveedor de esta orden ya no existe: no se puede emitir")
    }
    if (!supplier.isActive) {
      throw new Error(
        `${supplier.name} está desactivado como proveedor: no se puede emitir esta orden. `
        + "Reactívalo o crea la orden con otro proveedor.",
      )
    }

    // A-03: an empty OC must never reach 'sent'. The receipt rollup keys off
    // OC items, so a 0-item order would otherwise sit in 'sent' forever.
    const ocItems = await tx
      .select({ requestItemId: purchaseOrderItems.requestItemId })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, orderId))
    if (ocItems.length === 0) {
      throw new Error("No se puede emitir y enviar una orden de compra sin ítems")
    }

    const now = new Date().toISOString()
    await tx
      .update(purchaseOrders)
      .set({ status: "sent", issuedAt: now, issuedBy: userId, sentAt: now, updatedAt: now })
      .where(eq(purchaseOrders.id, orderId))

    await recordSparePartPricesTx(tx, {
      orderId,
      supplierId: order.supplierId,
      userId,
      effectiveAt: now,
    })

    // Move request items to "purchased" status
    const requestItemIds = ocItems
      .map((i) => i.requestItemId)
      .filter((id): id is string => id !== null)

    if (requestItemIds.length > 0) {
      // DAT-10: trazar sólo los ítems que la guarda realmente movió — si alguno
      // ya no estaba en 'in_purchase_order' (carrera con otra transición), la
      // guarda del WHERE no lo toca y el historial no debe fingir que sí.
      const updatedItems = await tx
        .update(purchaseRequestItems)
        .set({ status: "purchased", updatedAt: now })
        .where(
          and(
            inArray(purchaseRequestItems.id, requestItemIds),
            eq(purchaseRequestItems.status, "in_purchase_order"),
          )
        )
        .returning({ id: purchaseRequestItems.id })

      await recordStatusChanges(
        updatedItems.map(({ id }) => ({
          entityType: "request_item" as const,
          entityId:   id,
          fromStatus: "in_purchase_order",
          toStatus:   "purchased",
          changedBy:  userId,
        })),
        tx,
      )
    }

    /*
     * OC-002 (auditoría 2026-09-14): «Emitir y enviar» declaraba la compra
     * enviada al proveedor y abría Recepción, pero la transacción sólo movía
     * estados y fechas. No quedaba destinatario, canal ni acuse, así que
     * auditoría no podía distinguir una emisión administrativa de un despacho
     * efectivo, y Recepción podía preparar mercadería de una OC que el
     * proveedor no conocía.
     *
     * La plataforma no despacha por sí misma —no hay integración de correo ni
     * portal—, de modo que lo único honesto que puede registrar es a qué
     * contacto registrado se dirige y qué declara el emisor. Cuando no hay ni
     * lo uno ni lo otro, se deja escrito que la OC se emitió SIN constancia en
     * vez de afirmar un envío que nadie puede sostener.
     *
     * QUEDA POR DECIDIR (producto, no se inventa aquí): si la ausencia de
     * constancia debe bloquear la transición, si Recepción debe esperar al
     * acuse, y cuál es el catálogo de canales válidos con su adjunto
     * obligatorio.
     */
    const evidence = opts?.dispatchEvidence?.trim() || null
    const sentTo = supplier.email?.trim() || supplier.phone?.trim() || null
    const summary = evidence
      ? (sentTo
          ? `Enviada a ${supplier.name} (${sentTo}). Constancia: ${evidence}`
          : `Enviada a ${supplier.name}. Constancia: ${evidence}`)
      : (sentTo
          ? `Emitida hacia ${supplier.name} (${sentTo}); el envío es manual y no se registró constancia`
          : `Emitida sin constancia de envío: ${supplier.name} no tiene contacto registrado`)
    dispatch = { sentTo, evidence, hasDispatchEvidence: evidence !== null, summary }

    await recordStatusChange({
      entityType: "purchase_order",
      entityId:   orderId,
      fromStatus: "draft",
      toStatus:   "sent",
      changedBy:  userId,
      reason:     summary,
    }, tx)
    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "purchase_order",
      entityId:   orderId,
      entityCode: order.code,
      oldState:   { status: "draft" },
      newState:   { status: "sent", sentTo, dispatchEvidence: evidence },
    }, tx)
  })

  return dispatch
}

/* ── Cancel Order (draft/sent → cancelled) ───────────────────────────────────── */

export async function cancelOrder(
  orderId: string,
  userId: string,
  reason: string,
  worksiteIds: string[] | 'all' = 'all',
  opts?: { userEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(purchaseOrders)
      .where(eq(purchaseOrders.id, orderId)).for("update")
    if (!order) throw new Error(`Order ${orderId} not found`)
    if (worksiteIds !== 'all' && !worksiteIds.includes(order.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }
    if (!["draft", "sent"].includes(order.status)) {
      throw new Error(`Cannot cancel order in status '${order.status}'`)
    }

    const now = new Date().toISOString()

    // Lock the same source rows as createOrder, in a stable order, before
    // removing coverage. Otherwise a concurrent create could legitimately
    // cover the item and this cancellation would still reopen it afterwards.
    const ocItems = await tx
      .select({ requestItemId: purchaseOrderItems.requestItemId })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, orderId))

    const requestItemIds = ocItems
      .map((i) => i.requestItemId)
      .filter((id): id is string => id !== null)
    // Catálogo de repuestos: lo que esta OC vinculó al armarse (incluidos los
    // remanentes de compras parciales, que no tienen línea en ella) entra al
    // mismo bloqueo en orden léxico; más abajo vuelve a texto libre.
    const sparePartLinks = await findOrderSparePartLinksTx(tx, orderId, requestItemIds)
    const orderRequestItemIds = new Set(requestItemIds)
    const lockedRequestItems = (await lockPurchaseRequestItemsTx(tx, [...requestItemIds, ...sparePartLinks.keys()]))
      .filter((item) => orderRequestItemIds.has(item.id))
    // DAT-1: los padres, después de sus ítems y antes de devolverlos a la cola.
    await lockRequestsForRollupTx(tx, lockedRequestItems.map((item) => item.requestId))

    await tx
      .update(purchaseOrders)
      .set({ status: "cancelled", updatedAt: now })
      .where(eq(purchaseOrders.id, orderId))

    await tx
      .update(purchaseOrderItems)
      .set({ status: "cancelled" })
      .where(eq(purchaseOrderItems.purchaseOrderId, orderId))

    const activeCoverageByRequestItem = await getActiveOrderedQuantitiesTx(
      tx,
      lockedRequestItems.map((item) => item.id),
    )
    const uncoveredRequestItemIds: string[] = []
    for (const item of lockedRequestItems) {
      if ((activeCoverageByRequestItem.get(item.id) ?? 0) <= PURCHASE_COVERAGE_EPSILON) {
        uncoveredRequestItemIds.push(item.id)
      }
    }

    if (uncoveredRequestItemIds.length > 0) {
      const updatedItems = await tx
        .update(purchaseRequestItems)
        .set({ status: "pending_purchase", updatedAt: now })
        .where(
          and(
            inArray(purchaseRequestItems.id, uncoveredRequestItemIds),
            inArray(purchaseRequestItems.status, ["in_purchase_order", "purchased"])
          )
        )
        .returning({ id: purchaseRequestItems.id })
      const updatedIds = new Set(updatedItems.map((item) => item.id))

      await recordStatusChanges(
        lockedRequestItems
          .filter((item) => updatedIds.has(item.id))
          .map((item) => ({
          entityType: "request_item" as const,
          entityId:   item.id,
          fromStatus: item.status,
          toStatus:   "pending_purchase",
          changedBy:  userId,
        })),
        tx,
      )
    }

    // El precio que esta OC escribió al emitirse cae con ella.
    await revertSparePartPricesTx(tx, orderId)

    // Con las líneas de esta OC ya anuladas, el vínculo que ella hizo cae.
    await revertOrderSparePartLinksTx(tx, {
      orderId,
      links: sparePartLinks,
      userId,
      userEmail: opts?.userEmail,
    })

    const affectedRequestIds = [...new Set(
      lockedRequestItems.map((item) => item.requestId),
    )]
    for (const rid of affectedRequestIds) {
      await rollupRequestStatus(rid, tx, userId)
    }

    await recordStatusChange({
      entityType: "purchase_order",
      entityId:   orderId,
      fromStatus: order.status,
      toStatus:   "cancelled",
      changedBy:  userId,
    }, tx)

    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "purchase_order",
      entityId:   orderId,
      entityCode: order.code,
      oldState:   { status: order.status },
      newState:   { status: "cancelled" },
      reason,
    }, tx)
  })
}
