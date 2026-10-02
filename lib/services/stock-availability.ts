import type { Session } from "next-auth"
import { and, eq, inArray, notInArray, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  products,
  purchaseOrderItems,
  purchaseRequestItems,
  purchaseRequests,
  worksites,
  worksiteStock,
} from "@/db/schema"
import { TERMINAL_REQUEST_STATUSES } from "@/lib/approvals-queue"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { textSearchSql } from "@/lib/adquisiciones/list-query"

export interface StockAvailabilityRow {
  worksiteId: string
  productId: string
  /** Lo aprobado en solicitudes que todavía no llega a la faena. */
  incoming: number
}

export interface PendingRequestItem {
  worksiteId: string
  productId: string
  quantity: number
  /** Recibido en la faena por las líneas de OC del ítem. Lo recibido en
   *  oficina no cuenta: todavía no está en la bodega de destino. */
  receivedAtFaena: number
}

export interface StockAvailabilityFilters {
  worksiteId?: string
}

/** Lo por recibir de un producto que la faena todavía no tiene en bodega. */
export interface IncomingWithoutStockRow extends StockAvailabilityRow {
  productName: string
  productSku: string | null
  unitOfMeasure: string
}

/**
 * Ítems de una solicitud aprobada que todavía pueden tener saldo sin llegar a
 * la faena. `received` y `delivered` ya llegaron; `partially_delivered` sí
 * entra porque se puede entregar parte de lo recibido antes de que llegue el
 * resto, y su saldo lo dice el contador de la OC, no el estado.
 */
const NOT_YET_AT_FAENA_ITEM_STATUSES = [
  "approved",
  "pending_purchase",
  "in_purchase_order",
  "purchased",
  "partially_office_received",
  "office_received",
  "partially_received",
  "partially_delivered",
] as const

function availabilityKey(worksiteId: string, productId: string): string {
  return `${worksiteId}\u0000${productId}`
}

/**
 * Suma, por faena y producto, lo que a cada ítem le falta por llegar. El tope
 * en cero es por ítem: un ítem con recepción de más no puede esconder lo que
 * a otro todavía le falta.
 */
export function sumIncomingByStock(items: PendingRequestItem[]): StockAvailabilityRow[] {
  const byKey = new Map<string, StockAvailabilityRow>()
  for (const item of items) {
    const key = availabilityKey(item.worksiteId, item.productId)
    const row = byKey.get(key) ?? { worksiteId: item.worksiteId, productId: item.productId, incoming: 0 }
    row.incoming += Math.max(0, item.quantity - item.receivedAtFaena)
    byKey.set(key, row)
  }
  return [...byKey.values()].sort((left, right) => left.worksiteId.localeCompare(right.worksiteId)
    || left.productId.localeCompare(right.productId))
}

/**
 * Lo que está por recibir en cada faena, a partir de las solicitudes
 * aprobadas. Es de sólo lectura: los movimientos siguen aplicando sus propias
 * guardas de stock y de ciclo de vida.
 */
export async function getStockAvailability(
  session: Session | null,
  filters: StockAvailabilityFilters = {},
): Promise<StockAvailabilityRow[]> {
  const requestScope = worksiteScopeSql(session, purchaseRequests.worksiteId, filters.worksiteId)

  // Misma forma que el rollup de solicitudes: lo recibido se agrega desde las
  // líneas de OC del ítem, una fila por ítem para poder topar cada uno.
  const rows = await db
    .select({
      worksiteId: purchaseRequests.worksiteId,
      productId: purchaseRequestItems.productId,
      quantity: purchaseRequestItems.quantity,
      receivedAtFaena: sql<number>`coalesce(sum(${purchaseOrderItems.quantityReceived}), 0)`,
    })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequests.id, purchaseRequestItems.requestId))
    .innerJoin(worksites, eq(worksites.id, purchaseRequests.worksiteId))
    .innerJoin(products, eq(products.id, purchaseRequestItems.productId))
    .leftJoin(purchaseOrderItems, eq(purchaseOrderItems.requestItemId, purchaseRequestItems.id))
    .where(and(
      requestScope,
      eq(worksites.isActive, true),
      eq(products.isService, false),
      notInArray(purchaseRequests.status, [...TERMINAL_REQUEST_STATUSES]),
      inArray(purchaseRequestItems.status, [...NOT_YET_AT_FAENA_ITEM_STATUSES]),
    ))
    .groupBy(purchaseRequestItems.id, purchaseRequests.worksiteId, purchaseRequestItems.productId, purchaseRequestItems.quantity)

  return sumIncomingByStock(rows.flatMap((row) => row.productId ? [{
    worksiteId: row.worksiteId,
    productId: row.productId,
    quantity: Number(row.quantity),
    receivedAtFaena: Number(row.receivedAtFaena ?? 0),
  }] : []))
}

/**
 * Lo por recibir de productos que nunca entraron a su faena. La tabla de stock
 * lista registros de `worksite_stock`, que nacen con el primer ingreso; sin
 * esto, lo pedido para una faena que nunca tuvo el producto no aparecía en
 * ninguna parte. Se pregunta a la base y no a la lista ya cargada: esa se
 * recorta, y un registro fuera del recorte se pintaría como "En bodega 0".
 */
export async function getIncomingWithoutStock(
  rows: StockAvailabilityRow[],
  options: { q?: string } = {},
): Promise<IncomingWithoutStockRow[]> {
  const pending = rows.filter((row) => row.incoming > 0)
  if (pending.length === 0) return []

  const worksiteIds = [...new Set(pending.map((row) => row.worksiteId))]
  const productIds = [...new Set(pending.map((row) => row.productId))]
  const [records, productRows] = await Promise.all([
    db
      .select({ worksiteId: worksiteStock.worksiteId, productId: worksiteStock.productId })
      .from(worksiteStock)
      .where(and(inArray(worksiteStock.worksiteId, worksiteIds), inArray(worksiteStock.productId, productIds))),
    db
      .select({ id: products.id, name: products.name, sku: products.sku, unitOfMeasure: products.unitOfMeasure })
      .from(products)
      .where(and(inArray(products.id, productIds), textSearchSql(options.q ?? "", [products.name, products.sku]))),
  ])

  const withRecord = new Set(records.map((record) => availabilityKey(record.worksiteId, record.productId)))
  const productById = new Map(productRows.map((product) => [product.id, product]))
  return pending.flatMap((row) => {
    const product = productById.get(row.productId)
    if (!product || withRecord.has(availabilityKey(row.worksiteId, row.productId))) return []
    return [{
      ...row,
      productName: product.name,
      productSku: product.sku,
      unitOfMeasure: product.unitOfMeasure,
    }]
  })
}
