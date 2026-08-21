import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  productSuppliers,
  products,
  purchaseOrderInvoiceItems,
  purchaseOrderInvoiceReconciliationReviews,
  purchaseOrderInvoices,
  purchaseOrderItems,
  purchaseOrders,
  users,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { computeLineSubtotal, computeOrderTotals } from "@/lib/order-totals"
import { setProductSupplierPriceTx } from "@/lib/services/product-supplier-prices"
import {
  formatInvoiceReconciliationIssues,
  reconcileInvoiceEvidence,
  type InvoiceReconciliationEvidence,
  type InvoiceReconciliationReview,
} from "./invoice-reconciliation"

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface AcceptInvoiceReconciliationInput {
  purchaseOrderId: string
  fingerprint: string
  reason: string
  pendingCosts?: Array<{ purchaseOrderItemId: string; invoiceItemId: string }>
  catalogInvoiceItemIds?: string[]
  canUpdateCatalog?: boolean
  userId: string
  userEmail?: string
  worksiteScope?: string[] | "all"
}

export async function reconcilePurchaseOrderInvoicesTx(
  tx: DbTransaction,
  purchaseOrderId: string,
): Promise<InvoiceReconciliationEvidence> {
  const [order] = await tx
    .select({ totalAmount: purchaseOrders.totalAmount, supplierId: purchaseOrders.supplierId })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, purchaseOrderId))
  if (!order) throw new Error("Orden de compra no encontrada")

  const [orderItems, invoices, reviews] = await Promise.all([
    tx
      .select({
        id: purchaseOrderItems.id,
        productId: purchaseOrderItems.productId,
        productNameFree: purchaseOrderItems.productNameFree,
        productName: products.name,
        quantity: purchaseOrderItems.quantity,
        unitOfMeasure: purchaseOrderItems.unitOfMeasure,
        unitPrice: purchaseOrderItems.unitPrice,
        subtotal: purchaseOrderItems.subtotal,
        currentSupplierPrice: productSuppliers.unitPrice,
      })
      .from(purchaseOrderItems)
      .leftJoin(products, eq(purchaseOrderItems.productId, products.id))
      .leftJoin(productSuppliers, and(
        eq(productSuppliers.productId, purchaseOrderItems.productId),
        eq(productSuppliers.supplierId, order.supplierId),
      ))
      .where(eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId)),
    tx.query.purchaseOrderInvoices.findMany({
      where: eq(purchaseOrderInvoices.purchaseOrderId, purchaseOrderId),
      with: { items: true },
    }),
    tx
      .select({
        id: purchaseOrderInvoiceReconciliationReviews.id,
        fingerprint: purchaseOrderInvoiceReconciliationReviews.fingerprint,
        reason: purchaseOrderInvoiceReconciliationReviews.reason,
        evidence: purchaseOrderInvoiceReconciliationReviews.evidence,
        createdAt: purchaseOrderInvoiceReconciliationReviews.createdAt,
        reviewedByName: users.name,
      })
      .from(purchaseOrderInvoiceReconciliationReviews)
      .leftJoin(users, eq(purchaseOrderInvoiceReconciliationReviews.reviewedBy, users.id))
      .where(eq(purchaseOrderInvoiceReconciliationReviews.purchaseOrderId, purchaseOrderId))
      .orderBy(desc(purchaseOrderInvoiceReconciliationReviews.createdAt)),
  ])

  return reconcileInvoiceEvidence({
    totalOC: order.totalAmount,
    orderItems: orderItems.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productNameFree ?? item.productName ?? item.id,
      quantity: item.quantity,
      unitOfMeasure: item.unitOfMeasure,
      unitPrice: item.unitPrice,
      subtotal: item.subtotal,
      currentSupplierPrice: item.currentSupplierPrice,
    })),
    invoices,
    reviews: reviews.map((review): InvoiceReconciliationReview => ({
      ...review,
      evidence: review.evidence,
      reviewedByName: review.reviewedByName,
    })),
  })
}

export async function persistPurchaseOrderInvoiceReconciliationTx(
  tx: DbTransaction,
  purchaseOrderId: string,
) {
  const reconciliation = await reconcilePurchaseOrderInvoicesTx(tx, purchaseOrderId)
  await tx.update(purchaseOrders)
    .set({
      invoiceReconciliationStatus: reconciliation.status,
      invoiceReconciliationFingerprint: reconciliation.fingerprint,
      invoiceReconciliationUpdatedAt: new Date().toISOString(),
    })
    .where(eq(purchaseOrders.id, purchaseOrderId))
  return reconciliation
}

export async function getPurchaseOrderInvoiceReconciliation(purchaseOrderId: string) {
  return db.transaction((tx) => reconcilePurchaseOrderInvoicesTx(tx, purchaseOrderId))
}

/** Recalcula de forma atómica la proyección de todas las OC que ya tienen factura. */
export async function backfillPurchaseOrderInvoiceReconciliations() {
  return db.transaction(async (tx) => {
    const orders = await tx
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(sql`EXISTS (
        SELECT 1 FROM ${purchaseOrderInvoices}
        WHERE ${purchaseOrderInvoices.purchaseOrderId} = ${purchaseOrders.id}
      )`)
      .orderBy(asc(purchaseOrders.id))
      .for("update")
    const counts = { total: orders.length, matched: 0, needsReview: 0, acceptedException: 0 }
    for (const order of orders) {
      const reconciliation = await persistPurchaseOrderInvoiceReconciliationTx(tx, order.id)
      if (reconciliation.status === "matched") counts.matched += 1
      else if (reconciliation.status === "needs_review") counts.needsReview += 1
      else if (reconciliation.status === "accepted_exception") counts.acceptedException += 1
    }
    return counts
  })
}

export async function acceptPurchaseOrderInvoiceReconciliation(
  input: AcceptInvoiceReconciliationInput,
) {
  const reason = input.reason.trim()
  if (reason.length < 10 || reason.length > 1000) {
    throw new Error("El motivo debe tener entre 10 y 1000 caracteres")
  }
  if ((input.catalogInvoiceItemIds?.length ?? 0) > 0 && !input.canUpdateCatalog) {
    throw new Error("No tienes permiso para actualizar precios del catálogo")
  }

  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({
        id: purchaseOrders.id,
        code: purchaseOrders.code,
        worksiteId: purchaseOrders.worksiteId,
        supplierId: purchaseOrders.supplierId,
        status: purchaseOrders.status,
      })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, input.purchaseOrderId))
      .for("update")
    if (!order) throw new Error("Orden de compra no encontrada")
    if (input.worksiteScope && input.worksiteScope !== "all" && !input.worksiteScope.includes(order.worksiteId)) {
      throw new Error("No tienes acceso a la faena de esta orden")
    }
    if (order.status === "cancelled") throw new Error("La orden está anulada")

    const initial = await reconcilePurchaseOrderInvoicesTx(tx, order.id)
    if (!initial.hasInvoices) throw new Error("No se pueden aceptar diferencias sin una factura adjunta")
    if (initial.fingerprint !== input.fingerprint) {
      throw new Error("La conciliación cambió. Recarga la página y revisa la evidencia actual.")
    }
    if (initial.status === "matched") throw new Error("La orden ya está conciliada")
    if (initial.status === "accepted_exception") throw new Error("Las diferencias de esta evidencia ya fueron aceptadas")

    await applyPendingCostsTx(tx, order.id, input.pendingCosts ?? [], input.userId, input.userEmail, order.code)
    const catalogUpdates = await applyCatalogPricesTx(tx, {
      orderId: order.id,
      supplierId: order.supplierId,
      invoiceItemIds: input.catalogInvoiceItemIds ?? [],
      userId: input.userId,
    })

    const beforeReview = await reconcilePurchaseOrderInvoicesTx(tx, order.id)
    const reviewId = nanoid()
    await tx.insert(purchaseOrderInvoiceReconciliationReviews).values({
      id: reviewId,
      purchaseOrderId: order.id,
      fingerprint: beforeReview.fingerprint,
      reason,
      evidence: {
        reconciliation: beforeReview,
        acceptedIssues: beforeReview.issues,
        pendingCosts: input.pendingCosts ?? [],
        catalogUpdates,
      },
      reviewedBy: input.userId,
    }).onConflictDoNothing()

    const reconciliation = await persistPurchaseOrderInvoiceReconciliationTx(tx, order.id)
    await recordAudit({
      userId: input.userId,
      userEmail: input.userEmail,
      action: "update",
      entityType: "purchase_order_invoice_reconciliation",
      entityId: reviewId,
      entityCode: order.code,
      oldState: { fingerprint: initial.fingerprint, status: initial.status },
      newState: {
        fingerprint: reconciliation.fingerprint,
        status: reconciliation.status,
        reason,
        issues: reconciliation.issues,
        catalogUpdates,
      },
    }, tx)
    return reconciliation
  })
}

async function applyPendingCostsTx(
  tx: DbTransaction,
  orderId: string,
  selections: Array<{ purchaseOrderItemId: string; invoiceItemId: string }>,
  userId: string,
  userEmail: string | undefined,
  orderCode: string,
) {
  if (selections.length === 0) return
  const orderItemIds = [...new Set(selections.map((selection) => selection.purchaseOrderItemId))]
  if (orderItemIds.length !== selections.length) throw new Error("Selecciona una sola línea de factura por cada costo pendiente")

  const [orderItems, invoiceLines] = await Promise.all([
    tx.select().from(purchaseOrderItems).where(and(
      eq(purchaseOrderItems.purchaseOrderId, orderId),
      inArray(purchaseOrderItems.id, orderItemIds),
    )).for("update"),
    tx
      .select({
        id: purchaseOrderInvoiceItems.id,
        purchaseOrderItemId: purchaseOrderInvoiceItems.purchaseOrderItemId,
        quantity: purchaseOrderInvoiceItems.quantity,
        subtotal: purchaseOrderInvoiceItems.subtotal,
      })
      .from(purchaseOrderInvoiceItems)
      .innerJoin(purchaseOrderInvoices, eq(purchaseOrderInvoiceItems.invoiceId, purchaseOrderInvoices.id))
      .where(and(
        eq(purchaseOrderInvoices.purchaseOrderId, orderId),
        inArray(purchaseOrderInvoiceItems.id, selections.map((selection) => selection.invoiceItemId)),
      )),
  ])
  const itemById = new Map(orderItems.map((item) => [item.id, item]))
  const lineById = new Map(invoiceLines.map((line) => [line.id, line]))
  const now = new Date().toISOString()

  for (const selection of selections) {
    const item = itemById.get(selection.purchaseOrderItemId)
    const line = lineById.get(selection.invoiceItemId)
    if (!item || item.status === "cancelled") throw new Error("El costo pendiente seleccionado ya no está disponible")
    if (item.unitPrice !== null && item.costRecordedAt === null) throw new Error("Esta línea ya tiene un precio acordado en la orden")
    if (!line || line.purchaseOrderItemId !== item.id) throw new Error("La línea de factura no corresponde al costo pendiente seleccionado")
    const unitPrice = line.subtotal / line.quantity
    await tx.update(purchaseOrderItems).set({
      unitPrice,
      subtotal: computeLineSubtotal(item.quantity, unitPrice, item.discount),
      costRecordedAt: now,
      costRecordedBy: userId,
    }).where(eq(purchaseOrderItems.id, item.id))
    await recordAudit({
      userId,
      userEmail,
      action: "update",
      entityType: "purchase_order_item",
      entityId: item.id,
      entityCode: orderCode,
      oldState: { unitPrice: item.unitPrice, subtotal: item.subtotal },
      newState: {
        unitPrice,
        subtotal: computeLineSubtotal(item.quantity, unitPrice, item.discount),
        sourceInvoiceItemId: line.id,
      },
      reason: "Costo pendiente registrado desde factura durante la conciliación",
    }, tx)
  }

  const liveLines = await tx
    .select({ quantity: purchaseOrderItems.quantity, unitPrice: purchaseOrderItems.unitPrice, discount: purchaseOrderItems.discount })
    .from(purchaseOrderItems)
    .where(and(
      eq(purchaseOrderItems.purchaseOrderId, orderId),
      ne(purchaseOrderItems.status, "cancelled"),
    ))
  const totals = computeOrderTotals(liveLines)
  await tx.update(purchaseOrders).set({
    netAmount: totals.netAmount,
    taxAmount: totals.taxAmount,
    totalAmount: totals.totalAmount,
    updatedAt: now,
  }).where(eq(purchaseOrders.id, orderId))
}

async function applyCatalogPricesTx(
  tx: DbTransaction,
  input: { orderId: string; supplierId: string; invoiceItemIds: string[]; userId: string },
) {
  if (input.invoiceItemIds.length === 0) return []
  const lines = await tx
    .select({
      id: purchaseOrderInvoiceItems.id,
      quantity: purchaseOrderInvoiceItems.quantity,
      subtotal: purchaseOrderInvoiceItems.subtotal,
      productId: purchaseOrderItems.productId,
      issueDate: purchaseOrderInvoices.issueDate,
      uploadedAt: purchaseOrderInvoices.uploadedAt,
    })
    .from(purchaseOrderInvoiceItems)
    .innerJoin(purchaseOrderInvoices, eq(purchaseOrderInvoiceItems.invoiceId, purchaseOrderInvoices.id))
    .innerJoin(purchaseOrderItems, eq(purchaseOrderInvoiceItems.purchaseOrderItemId, purchaseOrderItems.id))
    .where(and(
      eq(purchaseOrderInvoices.purchaseOrderId, input.orderId),
      inArray(purchaseOrderInvoiceItems.id, input.invoiceItemIds),
    ))
  if (lines.length !== new Set(input.invoiceItemIds).size) throw new Error("Una línea elegida para catálogo ya no está disponible")

  const seenProducts = new Set<string>()
  const updates = []
  for (const line of lines) {
    if (!line.productId) throw new Error("Solo se puede actualizar catálogo desde líneas vinculadas a un producto")
    if (seenProducts.has(line.productId)) throw new Error("Selecciona una sola fuente de precio por producto")
    seenProducts.add(line.productId)
    const effectiveAt = line.issueDate ? `${line.issueDate}T00:00:00.000Z` : line.uploadedAt
    const result = await setProductSupplierPriceTx(tx, {
      productId: line.productId,
      supplierId: input.supplierId,
      unitPrice: line.subtotal / line.quantity,
      source: "invoice_reconciliation",
      sourceId: line.id,
      effectiveAt,
      userId: input.userId,
      isPreferredWhenCreated: false,
      rejectOlderThanCurrent: true,
    })
    if (result.stale) throw new Error("La factura es anterior al último precio conocido del catálogo")
    updates.push({ invoiceItemId: line.id, productId: line.productId, ...result })
  }
  return updates
}

export function reconciliationWarnings(reconciliation: InvoiceReconciliationEvidence) {
  if (reconciliation.status === "matched" || reconciliation.status === "accepted_exception") return []
  if (!reconciliation.hasInvoices) return ["No hay facturas adjuntadas a esta orden."]
  return formatInvoiceReconciliationIssues(reconciliation)
}
