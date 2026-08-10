/**
 * Purchase order creation service.
 */

import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { products, purchaseOrders, purchaseOrderItems, purchaseRequestItems, purchaseRequests, requestItemAttributes, suppliers } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit } from "@/lib/audit"
import { computeLineSubtotal, computeOrderTotals } from "@/lib/order-totals"
import { addItemToPurchaseOrderTx } from "../item-state"
import { getActiveOrderedQuantityTx, PURCHASE_COVERAGE_EPSILON } from "./purchasable-coverage"

export interface CreateOrderItemInput {
  requestItemId: string
  productId:     string | null
  productNameFree: string | null
  quantity:      number
  unitOfMeasure: string
  /** `null` = costo pendiente; sólo lo admiten los ítems de servicio del catálogo. */
  unitPrice:     number | null
  discount?:     number
  notes?:        string | null
  sortOrder?:    number
}

export interface CreateOrderInput {
  worksiteId:         string
  supplierId:         string
  createdBy:          string
  userEmail?:         string
  paymentTerms?:      string | null
  estimatedDelivery?: string | null
  deliveryAddress?:   string | null
  notes?:             string | null
  /** Effective worksite scope of the authenticated actor. */
  worksiteScope?:     string[] | "all"
  items:              CreateOrderItemInput[]
}

export interface CreateOrderGroupInput {
  supplierId: string
  items:      CreateOrderItemInput[]
}

export interface CreateOrdersBySupplierInput extends Omit<CreateOrderInput, "supplierId" | "items"> {
  orders: CreateOrderGroupInput[]
}

export async function createOrder(input: CreateOrderInput): Promise<string> {
  const [orderId] = await createOrdersBySupplier({
    worksiteId:         input.worksiteId,
    createdBy:          input.createdBy,
    userEmail:          input.userEmail,
    paymentTerms:       input.paymentTerms,
    estimatedDelivery:  input.estimatedDelivery,
    deliveryAddress:    input.deliveryAddress,
    notes:              input.notes,
    worksiteScope:      input.worksiteScope,
    orders: [{
      supplierId: input.supplierId,
      items:      input.items,
    }],
  })
  return orderId!
}

export async function createOrdersBySupplier(input: CreateOrdersBySupplierInput): Promise<string[]> {
  if (input.orders.length === 0) throw new Error("No hay órdenes para crear")
  if (input.orders.some((order) => order.items.length === 0)) {
    throw new Error("No se puede crear una OC sin ítems")
  }

  // Una compra consolidada puede crear varias OC (una por proveedor). Todas
  // comparten la misma transacción, de modo que la validación de duplicados y
  // el orden de sus locks debe abarcar *todos* los grupos, no sólo las líneas
  // de cada proveedor. De otro modo dos consolidaciones con los proveedores en
  // orden inverso podían bloquear A→B y B→A respectivamente.
  const allInputItems = input.orders.flatMap((order) => order.items)
  const seenRequestItemIds = new Set<string>()
  for (const item of allInputItems) {
    if (seenRequestItemIds.has(item.requestItemId)) {
      throw new Error("No se puede incluir el mismo ítem de solicitud más de una vez")
    }
    seenRequestItemIds.add(item.requestItemId)
  }
  const requestItemIdsInLockOrder = [...seenRequestItemIds].sort((a, b) => a.localeCompare(b))

  const now       = new Date().toISOString()
  const year      = new Date().getFullYear()
  const orderIds: string[] = []
  const scopedWorksiteIds = input.worksiteScope && input.worksiteScope !== "all"
    ? new Set(input.worksiteScope)
    : null

  await db.transaction(async (tx) => {
    // DAT-18: el bloqueo es global a todos los grupos de proveedor. Cancelar y
    // eliminar ya usan el mismo orden léxico en `lockPurchaseRequestItemsTx`,
    // así que cualquier carrera sobre los mismos ítems se serializa sin un
    // ciclo de locks entre dos OC consolidadas.
    const lockedSourcesByRequestItemId = new Map<string, {
      requestItem: typeof purchaseRequestItems.$inferSelect
      costCenterId: string | null
      deliveryMode: string
    }>()

    // The request and its parent are locked and resolved inside this transaction:
    // client data may choose an item, never its worksite, product, unit or cost centre.
    // `ORDER BY` keeps the same deterministic lock order as cancellation and
    // deletion without a query per item.
    const lockedSources = await tx
      .select({
        requestItem: purchaseRequestItems,
        worksiteId: purchaseRequests.worksiteId,
        costCenterId: purchaseRequests.costCenterId,
        deliveryMode: purchaseRequests.deliveryMode,
      })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
      .where(inArray(purchaseRequestItems.id, requestItemIdsInLockOrder))
      .orderBy(purchaseRequestItems.id)
      .for("update")
    const sourceByRequestItemId = new Map(
      lockedSources.map((source) => [source.requestItem.id, source]),
    )

    // Un costo pendiente (`unitPrice: null`) es una propiedad del catálogo, no
    // una opción del comprador: sólo los productos marcados `is_service` pueden
    // entrar a la OC sin precio. Se resuelve contra la BD dentro de la
    // transacción para que el cliente no pueda declararlo por su cuenta.
    const pricelessProductIds = [...new Set(allInputItems.flatMap((item) => {
      if (item.unitPrice !== null && item.unitPrice !== undefined) return []
      const productId = sourceByRequestItemId.get(item.requestItemId)?.requestItem.productId
      return productId ? [productId] : [null]
    }))]
    if (pricelessProductIds.some((id) => id === null)) {
      throw new Error("Solo los servicios del catálogo pueden comprarse con costo pendiente")
    }
    if (pricelessProductIds.length > 0) {
      const serviceProducts = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(
          inArray(products.id, pricelessProductIds as string[]),
          eq(products.isService, true),
        ))
      if (serviceProducts.length !== pricelessProductIds.length) {
        throw new Error("Solo los servicios del catálogo pueden comprarse con costo pendiente")
      }
    }

    for (const requestItemId of requestItemIdsInLockOrder) {
      const source = sourceByRequestItemId.get(requestItemId)
      if (!source) throw new Error(`Item ${requestItemId} not found`)
      if (source.worksiteId !== input.worksiteId) {
        throw new Error("El ítem de solicitud pertenece a otra faena")
      }
      if (scopedWorksiteIds && !scopedWorksiteIds.has(source.worksiteId)) {
        throw new Error("No tienes acceso a la faena de este ítem")
      }

      lockedSourcesByRequestItemId.set(requestItemId, {
        requestItem: source.requestItem,
        costCenterId: source.costCenterId,
        deliveryMode: source.deliveryMode,
      })
    }

    for (const orderInput of input.orders) {
      const [activeSupplier] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(and(eq(suppliers.id, orderInput.supplierId), eq(suppliers.isActive, true)))
      if (!activeSupplier) throw new Error("El proveedor seleccionado no está activo")

      const sourceItems: Array<{
        inputItem: CreateOrderItemInput
        requestItem: typeof purchaseRequestItems.$inferSelect
        costCenterId: string | null
        deliveryMode: string
      }> = []

      for (const item of orderInput.items) {
        const source = lockedSourcesByRequestItemId.get(item.requestItemId)
        // La tabla de fuentes se llena sobre el mismo conjunto exacto de ids
        // validado antes de abrir la transacción; la guarda conserva el error
        // útil si la implementación evoluciona y pierde esa correspondencia.
        if (!source) throw new Error(`Item ${item.requestItemId} not found`)
        const requestItem = source.requestItem
        // La misma regla que alimenta el selector se reafirma dentro de la
        // transacción. Las compras parciales válidas se representan como un
        // ítem hermano; por eso una línea activa sobre este mismo ítem nunca se
        // puede abrir de nuevo como si fuese saldo disponible.
        const activeOrderedQuantity = await getActiveOrderedQuantityTx(tx, requestItem.id)
        if (activeOrderedQuantity > PURCHASE_COVERAGE_EPSILON) {
          throw new Error("El ítem ya tiene cobertura en una orden de compra activa")
        }
        if (item.quantity > requestItem.quantity) {
          throw new Error("La cantidad a comprar no puede superar la cantidad aprobada del ítem")
        }

        sourceItems.push({ inputItem: item, requestItem, costCenterId: source.costCenterId, deliveryMode: source.deliveryMode })

        // Compra parcial: el remanente se separa en un ítem hermano que conserva
        // el estado original (approved/pending_purchase), para que vuelva al
        // consolidado de "ítems sin OC" en vez de perderse silenciosamente.
        if (item.quantity < requestItem.quantity) {
          const siblingId = nanoid()
          const remainder = requestItem.quantity - item.quantity

          await tx.insert(purchaseRequestItems).values({
            id:                  siblingId,
            requestId:           requestItem.requestId,
            productId:           requestItem.productId,
            productNameFree:     requestItem.productNameFree,
            quantity:            remainder,
            unitOfMeasure:       requestItem.unitOfMeasure,
            status:              requestItem.status,
            urgency:             requestItem.urgency,
            requiredDate:        requestItem.requiredDate,
            workerId:            requestItem.workerId,
            // Sin esto, comprar parcialmente una mantención dejaba el remanente
            // en la cola sin decir sobre qué instrumento era: el hermano tiene
            // que apuntar al mismo equipo que el ítem del que salió.
            equipmentId:         requestItem.equipmentId,
            suggestedSupplierId: requestItem.suggestedSupplierId,
            supplierHint:        requestItem.supplierHint,
            sortOrder:           requestItem.sortOrder,
            notes:               requestItem.notes,
            splitFromItemId:     requestItem.id,
          })

          const attrs = await tx.query.requestItemAttributes.findMany({
            where: eq(requestItemAttributes.requestItemId, requestItem.id),
          })
          if (attrs.length > 0) {
            await tx.insert(requestItemAttributes).values(
              attrs.map((a) => ({
                id:            nanoid(),
                requestItemId: siblingId,
                attributeId:   a.attributeId,
                attributeName: a.attributeName,
                value:         a.value,
              })),
            )
          }

          await tx
            .update(purchaseRequestItems)
            .set({ quantity: item.quantity, updatedAt: new Date().toISOString() })
            .where(eq(purchaseRequestItems.id, requestItem.id))

          await recordAudit({
            userId:     input.createdBy,
            userEmail:  input.userEmail,
            action:     "update",
            entityType: "request_item",
            entityId:   requestItem.id,
            oldState:   { quantity: requestItem.quantity },
            newState:   { quantity: item.quantity, splitIntoItemId: siblingId, splitRemainder: remainder },
          }, tx)
        }
      }

      if (new Set(sourceItems.map((item) => item.costCenterId)).size > 1) {
        throw new Error("Los ítems de la OC pertenecen a centros de costo distintos; crea órdenes separadas")
      }
      // DAT-14: el modo de despacho se deriva de las solicitudes ya
      // lockeadas en esta transacción, nunca del valor que mandó el cliente
      // — si alguien cambió el modo de despacho de la solicitud justo
      // mientras se armaba esta OC, se ve el valor real, no uno obsoleto.
      if (new Set(sourceItems.map((item) => item.deliveryMode)).size > 1) {
        throw new Error("Los ítems de la OC pertenecen a solicitudes con modo de despacho distinto; crea órdenes separadas")
      }

      const orderId = nanoid()
      const code    = await nextCodeTx(tx, "OC", year)
      const totals  = computeOrderTotals(orderInput.items)
      orderIds.push(orderId)

      const costCenterId = sourceItems[0]!.costCenterId
      const deliveryMode = sourceItems[0]!.deliveryMode

      await tx.insert(purchaseOrders).values({
        id:                orderId,
        code,
        worksiteId:        input.worksiteId,
        costCenterId,
        supplierId:        orderInput.supplierId,
        createdBy:         input.createdBy,
        status:            "draft",
        deliveryMode,
        paymentTerms:      input.paymentTerms ?? null,
        estimatedDelivery: input.estimatedDelivery ?? null,
        deliveryAddress:   input.deliveryAddress ?? null,
        notes:             input.notes ?? null,
        netAmount:         totals.netAmount,
        taxAmount:         totals.taxAmount,
        totalAmount:       totals.totalAmount,
        createdAt:         now,
        updatedAt:         now,
      })

      for (const [i, source] of sourceItems.entries()) {
        const { inputItem: item, requestItem } = source
        const subtotal = computeLineSubtotal(item.quantity, item.unitPrice ?? null, item.discount ?? 0)
        await tx.insert(purchaseOrderItems).values({
          id:              nanoid(),
          purchaseOrderId: orderId,
          requestItemId:   item.requestItemId,
          productId:       requestItem.productId,
          productNameFree: requestItem.productNameFree,
          quantity:        item.quantity,
          unitOfMeasure:   requestItem.unitOfMeasure,
          unitPrice:       item.unitPrice,
          discount:        item.discount ?? 0,
          subtotal,
          quantityReceived: 0,
          status:          "issued",
          sortOrder:       item.sortOrder ?? i,
          notes:           item.notes ?? null,
        })
      }

      await recordAudit({
        userId:     input.createdBy,
        userEmail:  input.userEmail,
        action:     "create",
        entityType: "purchase_order",
        entityId:   orderId,
        entityCode: code,
        newState:   {
          status:      "draft",
          supplierId:  orderInput.supplierId,
          totalAmount: totals.totalAmount,
          itemCount:   orderInput.items.length,
        },
      }, tx)
      for (const { requestItem } of sourceItems) {
        await addItemToPurchaseOrderTx(tx, requestItem.id, orderId, input.createdBy, {
          userEmail: input.userEmail,
        })
      }
    }
  })

  return orderIds
}
