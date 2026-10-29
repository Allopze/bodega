import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import type { db } from "@/db"
import {
  auditLog,
  products,
  purchaseOrderInvoiceItemAllocations,
  purchaseOrderInvoiceItems,
  purchaseOrderInvoices,
  purchaseOrderItems,
  purchaseOrders,
  supplierProductAliases,
} from "@/db/schema"
import { getProductSizesByIds } from "@/lib/services/product-sizes"
import { normalizeSupplierProductCode, normalizeSupplierProductName } from "./dte-candidates"
import { matchInvoiceItemsToPurchaseOrderItems } from "./invoice-item-matching"
import { InvoiceLineAllocationError, loadInvoiceLineAllocationsTx, replaceInvoiceLineAllocationsTx } from "./invoice-line-allocations"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Reparte las líneas de DTE que siguen sin reparto cuando la evidencia ya
 * alcanza para identificar UN ítem de la OC: un alias de proveedor confirmado
 * por una persona, o la misma regla que se aplica al registrar la factura
 * (código, nombre, unidad y talla). Corre en cada recálculo de la conciliación,
 * así que una línea que hoy es ambigua se reparte sola cuando aparece la
 * evidencia —un alias aprendido en otra OC, una talla corregida en el catálogo—
 * en vez de quedar esperando a que alguien la vuelva a abrir.
 *
 * Sólo toca líneas que **nunca** tuvieron reparto: si hay historia en el audit
 * log, alguien ya decidió sobre ella (incluido dejarla sin reparto) y esa
 * decisión no se pisa. Lo ambiguo queda como está; nunca se adivina.
 */
export async function autoLinkUnallocatedDteLinesTx(tx: Tx, purchaseOrderId: string): Promise<number> {
  let linked = 0
  for (const link of await planAutoLinksTx(tx, purchaseOrderId)) {
    const context = { purchaseOrderId, invoiceItemId: link.invoiceItemId, worksiteScope: "all" as const }
    try {
      const current = await loadInvoiceLineAllocationsTx(tx, context)
      await replaceInvoiceLineAllocationsTx(tx, {
        ...context,
        expectedFingerprint: current.fingerprint,
        coverage: "complete",
        source: "dte_suggestion",
        // Lo hace el sistema, no una persona: sin autor, y el audit lo dice.
        actor: { userId: null },
        allocations: [{ purchaseOrderItemId: link.purchaseOrderItemId, quantity: link.quantity, subtotal: link.subtotal }],
      })
      linked += 1
    } catch (error) {
      // Una sugerencia que la validación documental rechaza (signo, unidad)
      // queda para una persona; no debe tumbar el recálculo que la pidió.
      if (error instanceof InvoiceLineAllocationError) continue
      throw error
    }
  }
  return linked
}

export interface PlannedAutoLink {
  invoiceItemId: string
  purchaseOrderItemId: string
  quantity: number
  subtotal: number
  via: "alias" | "match"
}

/** Qué repartiría `autoLinkUnallocatedDteLinesTx`, sin escribir nada. */
export async function planAutoLinksTx(tx: Tx, purchaseOrderId: string): Promise<PlannedAutoLink[]> {
  const lines = await tx
    .select({
      id: purchaseOrderInvoiceItems.id,
      productName: purchaseOrderInvoiceItems.productName,
      productCode: purchaseOrderInvoiceItems.productCode,
      unitOfMeasure: purchaseOrderInvoiceItems.unitOfMeasure,
      quantity: purchaseOrderInvoiceItems.quantity,
      unitPrice: purchaseOrderInvoiceItems.unitPrice,
      subtotal: purchaseOrderInvoiceItems.subtotal,
    })
    .from(purchaseOrderInvoiceItems)
    .innerJoin(purchaseOrderInvoices, eq(purchaseOrderInvoiceItems.invoiceId, purchaseOrderInvoices.id))
    .where(and(
      eq(purchaseOrderInvoices.purchaseOrderId, purchaseOrderId),
      isNull(purchaseOrderInvoices.voidedAt),
      isNotNull(purchaseOrderInvoiceItems.sourceDteDocumentItemId),
      sql`NOT EXISTS (SELECT 1 FROM ${purchaseOrderInvoiceItemAllocations} WHERE ${purchaseOrderInvoiceItemAllocations.invoiceItemId} = ${purchaseOrderInvoiceItems.id})`,
      sql`NOT EXISTS (SELECT 1 FROM ${auditLog} WHERE ${auditLog.entityType} = 'purchase_order_invoice_item_allocation' AND ${auditLog.entityId} = ${purchaseOrderInvoiceItems.id})`,
    ))
    .orderBy(purchaseOrderInvoiceItems.id)
  if (lines.length === 0) return []

  const [order] = await tx.select({ supplierId: purchaseOrders.supplierId }).from(purchaseOrders).where(eq(purchaseOrders.id, purchaseOrderId))
  const orderItems = await tx
    .select({
      id: purchaseOrderItems.id,
      productId: purchaseOrderItems.productId,
      productNameFree: purchaseOrderItems.productNameFree,
      productName: products.name,
      productCode: products.sku,
      unitOfMeasure: purchaseOrderItems.unitOfMeasure,
    })
    .from(purchaseOrderItems)
    .leftJoin(products, eq(purchaseOrderItems.productId, products.id))
    .where(eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId))
  const productIds = orderItems.flatMap((item) => item.productId ? [item.productId] : [])
  const sizes = await getProductSizesByIds(productIds, tx)
  const aliases = order?.supplierId && productIds.length > 0
    ? await tx
        .select({ productId: supplierProductAliases.productId, normalizedCode: supplierProductAliases.normalizedCode, normalizedName: supplierProductAliases.normalizedName })
        .from(supplierProductAliases)
        .where(and(eq(supplierProductAliases.supplierId, order.supplierId), inArray(supplierProductAliases.productId, productIds)))
    : []

  const candidates = orderItems.map((item) => ({
    id: item.id,
    productId: item.productId,
    productName: item.productNameFree ?? item.productName ?? item.id,
    productCode: item.productCode ?? null,
    unitOfMeasure: item.unitOfMeasure,
    sizeLabel: item.productId ? sizes.get(item.productId)?.label ?? null : null,
  }))

  // El alias es evidencia confirmada por una persona: va antes que la regla
  // por nombre, y sólo cuenta si apunta a exactamente un ítem de esta OC.
  const viaAlias = new Map<string, string>()
  for (const line of lines) {
    const code = normalizeSupplierProductCode(line.productCode) || null
    const name = normalizeSupplierProductName(line.productName) || null
    const aliasedProducts = new Set(aliases
      .filter((alias) => (code && alias.normalizedCode === code) || (name && alias.normalizedName === name))
      .map((alias) => alias.productId))
    const targets = candidates.filter((item) => item.productId && aliasedProducts.has(item.productId))
    if (targets.length === 1) viaAlias.set(line.id, targets[0]!.id)
  }
  const claimed = new Set(viaAlias.values())
  const rest = lines.filter((line) => !viaAlias.has(line.id))
  const matches = matchInvoiceItemsToPurchaseOrderItems(rest, candidates.filter((item) => !claimed.has(item.id)))
  const plan: PlannedAutoLink[] = []
  for (const line of lines) {
    const viaAliasTarget = viaAlias.get(line.id)
    const target = viaAliasTarget ?? matches.find((match) => match.item.id === line.id)?.ocItemId
    if (target) plan.push({ invoiceItemId: line.id, purchaseOrderItemId: target, quantity: line.quantity, subtotal: line.subtotal, via: viaAliasTarget ? "alias" : "match" })
  }
  return plan
}
