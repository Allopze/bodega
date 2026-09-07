import { and, asc, eq, inArray } from "drizzle-orm"
import type { DB } from "@/db"
import { products, worksites, worksiteStock } from "@/db/schema"
import { getProductAttributesByIds } from "@/lib/services/product-sizes"
import { formatVariantProductName } from "@/lib/products/variant-grouping"

/**
 * A read-only subset shared by the root DB client and a Drizzle transaction.
 * Keeping the reader transaction-capable lets the final submission recheck the
 * snapshot immediately before it inserts the request.
 */
export type EppStockReader = Pick<DB, "select">

export type EppStockWorksiteLock = "share" | "no key update"

/**
 * A worksite already locked in the current transaction. Keeping the lock and
 * the subsequent stock read as separate operations lets request creation
 * establish its worksite barrier before it resolves catalog-driven quantities.
 */
export interface LockedEppStockWorksite {
  id: string
  name: string
}

export interface EppStockAvailabilityItem {
  productId?: string | null
  quantity: number
}

export interface EppStockAvailabilityInput {
  worksiteId: string
  /**
   * `no key update` briefly serializes stock movements for a direct request,
   * including the otherwise-unlockable case where a stock row does not exist
   * yet. Other read-only callers can keep the default shared lock.
   */
  worksiteLock?: EppStockWorksiteLock
  items: ReadonlyArray<EppStockAvailabilityItem>
}

export interface EppStockSnapshotLine {
  productId: string
  productName: string
  requestedQuantity: number
  availableQuantity: number
  locationName: string
}

export interface EppStockSnapshot {
  worksiteId: string
  worksiteName: string
  /** Sorted by product ID and includes zero balances for a stable confirmation. */
  lines: EppStockSnapshotLine[]
}

export interface EppStockAvailability {
  worksiteName: string
  snapshot: EppStockSnapshot
}

export interface EppStockWarningItem extends EppStockSnapshotLine {
  coverage: "total" | "partial"
}

/** Expected domain failures are deliberately safe to show in the form. */
export class EppStockAvailabilityError extends Error {
  override name = "EppStockAvailabilityError"
}

/**
 * `real` is single precision in PostgreSQL. Normalize before serializing or
 * comparing it so an unchanged balance cannot make a confirmation stale merely
 * because JavaScript renders a binary float differently.
 */
export function normalizeEppStockQuantity(value: number, field = "cantidad de stock"): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new EppStockAvailabilityError(`La ${field} no es válida.`)
  }
  const rounded = Math.fround(value)
  if (!Number.isFinite(rounded) || rounded < 0) {
    throw new EppStockAvailabilityError(`La ${field} no es válida.`)
  }
  return Object.is(rounded, -0) ? 0 : Number.parseFloat(rounded.toPrecision(7))
}

function normalizeRequestedQuantity(value: number): number {
  const normalized = normalizeEppStockQuantity(value, "cantidad solicitada")
  if (normalized <= 0) throw new EppStockAvailabilityError("La cantidad solicitada debe ser mayor que cero.")
  return normalized
}

/**
 * Establishes the selected-worksite barrier. A final direct request uses
 * `FOR NO KEY UPDATE`, which conflicts with inventory movements' `FOR SHARE`
 * before a movement can insert a formerly absent stock row.
 */
export async function lockActiveEppStockWorksite(
  reader: EppStockReader,
  worksiteId: string,
  worksiteLock: EppStockWorksiteLock = "share",
): Promise<LockedEppStockWorksite> {
  const [worksite] = await reader
    .select({ id: worksites.id, name: worksites.name, isActive: worksites.isActive })
    .from(worksites)
    .where(eq(worksites.id, worksiteId))
    .for(worksiteLock)
    .limit(1)

  if (!worksite) throw new EppStockAvailabilityError("La faena seleccionada ya no existe.")
  if (!worksite.isActive) throw new EppStockAvailabilityError(`La faena ${worksite.name} ya no está activa.`)

  return { id: worksite.id, name: worksite.name }
}

/**
 * Reads only stock physically held by the selected worksite after
 * `lockActiveEppStockWorksite` has established the barrier in this same
 * transaction. It validates the lifecycle of every catalog product so an
 * inactive/missing product cannot be misclassified as "zero stock".
 * Product and current stock rows are selected in deterministic order with
 * `FOR SHARE`.
 */
export async function readEppStockAvailabilityForLockedWorksite(
  reader: EppStockReader,
  input: {
    worksite: LockedEppStockWorksite
    items: ReadonlyArray<EppStockAvailabilityItem>
  },
): Promise<EppStockAvailability> {
  const { worksite } = input

  const requestedByProductId = new Map<string, number>()
  for (const item of input.items) {
    if (!item.productId) continue
    const current = requestedByProductId.get(item.productId) ?? 0
    requestedByProductId.set(item.productId, normalizeRequestedQuantity(current + normalizeRequestedQuantity(item.quantity)))
  }

  const productIds = [...requestedByProductId.keys()].sort()
  if (productIds.length === 0) {
    return {
      worksiteName: worksite.name,
      snapshot: { worksiteId: worksite.id, worksiteName: worksite.name, lines: [] },
    }
  }

  const productRows = await reader
    .select({ id: products.id, name: products.name, isEpp: products.isEpp, isActive: products.isActive })
    .from(products)
    .where(inArray(products.id, productIds))
    .orderBy(asc(products.id))
    .for("share")

  // El aviso nombra el producto del que no hay stock: sin la talla, «no hay
  // stock de Zapato SteelPro» no dice de cuál de las cinco variantes.
  const attributesById = await getProductAttributesByIds(productIds, reader)

  const productById = new Map(productRows.map((product) => [product.id, product]))
  const missingProductIds = productIds.filter((productId) => !productById.has(productId))
  if (missingProductIds.length > 0) {
    throw new EppStockAvailabilityError("Uno o más productos del catálogo ya no están disponibles.")
  }
  const inactiveProducts = productRows.filter((product) => !product.isActive)
  if (inactiveProducts.length > 0) {
    throw new EppStockAvailabilityError(`Los siguientes productos están inactivos y no pueden solicitarse: ${inactiveProducts.map((product) => formatVariantProductName(product.name, attributesById.get(product.id))).join(", ")}`)
  }

  const eppProductIds = productRows.filter((product) => product.isEpp).map((product) => product.id)
  if (eppProductIds.length === 0) {
    return {
      worksiteName: worksite.name,
      snapshot: { worksiteId: worksite.id, worksiteName: worksite.name, lines: [] },
    }
  }

  const stockRows = await reader
    .select({ productId: worksiteStock.productId, quantity: worksiteStock.quantity })
    .from(worksiteStock)
    .where(and(
      eq(worksiteStock.worksiteId, worksite.id),
      inArray(worksiteStock.productId, eppProductIds),
    ))
    .orderBy(asc(worksiteStock.productId))
    .for("share")

  const availableByProductId = new Map(
    stockRows.map((stock) => [stock.productId, normalizeEppStockQuantity(stock.quantity)]),
  )
  const lines = eppProductIds.map((productId) => {
    const product = productById.get(productId)!
    return {
      productId,
      productName: formatVariantProductName(product.name, attributesById.get(product.id)),
      requestedQuantity: requestedByProductId.get(productId)!,
      availableQuantity: availableByProductId.get(productId) ?? 0,
      locationName: worksite.name,
    }
  })

  return {
    worksiteName: worksite.name,
    snapshot: { worksiteId: worksite.id, worksiteName: worksite.name, lines },
  }
}

export async function readEppStockAvailability(
  reader: EppStockReader,
  input: EppStockAvailabilityInput,
): Promise<EppStockAvailability> {
  const worksite = await lockActiveEppStockWorksite(
    reader,
    input.worksiteId,
    input.worksiteLock ?? "share",
  )
  return await readEppStockAvailabilityForLockedWorksite(reader, {
    worksite,
    items: input.items,
  })
}

/** Only positive physical balances require an explicit requester decision. */
export function getEppStockWarnings(snapshot: EppStockSnapshot): EppStockWarningItem[] {
  return snapshot.lines.flatMap((line) => line.availableQuantity > 0 ? [{
    ...line,
    coverage: line.availableQuantity >= line.requestedQuantity ? "total" as const : "partial" as const,
  }] : [])
}

export function sameEppStockSnapshot(left: EppStockSnapshot, right: EppStockSnapshot): boolean {
  if (left.worksiteId !== right.worksiteId || left.worksiteName !== right.worksiteName) return false
  if (left.lines.length !== right.lines.length) return false
  return left.lines.every((line, index) => {
    const other = right.lines[index]
    return !!other
      && line.productId === other.productId
      && line.productName === other.productName
      && line.requestedQuantity === other.requestedQuantity
      && line.availableQuantity === other.availableQuantity
      && line.locationName === other.locationName
  })
}
