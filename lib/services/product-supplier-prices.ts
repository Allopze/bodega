import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { productSupplierPriceHistory, productSuppliers } from "@/db/schema"
import { nanoid } from "@/lib/id"

export type ProductSupplierPriceSource =
  | "product_form"
  | "variant_creator"
  | "epp_import"
  | "invoice_reconciliation"
  | "baseline"

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface SetProductSupplierPriceInput {
  productId: string
  supplierId: string
  unitPrice: number | null
  source: ProductSupplierPriceSource
  sourceId?: string | null
  effectiveAt?: string
  userId?: string | null
  isPreferredWhenCreated?: boolean
  notes?: string | null
  /** Supplier removal from admin forms is a real price deletion. */
  deleteRelationWhenNull?: boolean
  /** Invoice evidence must never overwrite a later known catalog price. */
  rejectOlderThanCurrent?: boolean
  /** Keep a supplier relation even when its current price is unknown. */
  ensureRelation?: boolean
  /** Relation metadata may change without creating a price-history entry. */
  isPreferred?: boolean
}

export interface SetProductSupplierPriceResult {
  changed: boolean
  stale: boolean
  relationId: string | null
  previousPrice: number | null
  newPrice: number | null
}

function normalizedPrice(value: number | null) {
  if (value === null) return null
  if (!Number.isFinite(value) || value < 0) throw new Error("El precio proveedor debe ser válido y no negativo")
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export async function setProductSupplierPriceTx(
  tx: DbTransaction,
  input: SetProductSupplierPriceInput,
): Promise<SetProductSupplierPriceResult> {
  const newPrice = normalizedPrice(input.unitPrice)
  const effectiveAt = input.effectiveAt ?? new Date().toISOString()
  const [existing] = await tx
    .select()
    .from(productSuppliers)
    .where(and(
      eq(productSuppliers.productId, input.productId),
      eq(productSuppliers.supplierId, input.supplierId),
    ))
    .for("update")
  const previousPrice = existing?.unitPrice ?? null

  const effectiveTimestamp = new Date(effectiveAt).getTime()
  if (!Number.isFinite(effectiveTimestamp)) throw new Error("La fecha efectiva del precio no es válida")
  const currentTimestamp = existing ? new Date(existing.lastUpdated).getTime() : Number.NEGATIVE_INFINITY
  if (existing && input.rejectOlderThanCurrent && effectiveTimestamp < currentTimestamp) {
    return { changed: false, stale: true, relationId: existing.id, previousPrice, newPrice }
  }

  if (existing && newPrice === null && input.deleteRelationWhenNull) {
    await tx.delete(productSuppliers).where(eq(productSuppliers.id, existing.id))
    if (previousPrice === null) {
      return { changed: false, stale: false, relationId: existing.id, previousPrice, newPrice }
    }
  } else if (existing && previousPrice === newPrice) {
    await tx.update(productSuppliers).set({
      isPreferred: input.isPreferred ?? existing.isPreferred,
      notes: input.notes ?? existing.notes,
    }).where(eq(productSuppliers.id, existing.id))
    return { changed: false, stale: false, relationId: existing.id, previousPrice, newPrice }
  } else if (!existing && newPrice === null && !input.ensureRelation) {
    return { changed: false, stale: false, relationId: null, previousPrice, newPrice }
  }

  const relationId = existing?.id ?? nanoid()
  if (existing && !(newPrice === null && input.deleteRelationWhenNull)) {
    await tx.update(productSuppliers)
      .set({
        unitPrice: newPrice,
        lastUpdated: effectiveAt,
        notes: input.notes ?? existing.notes,
        isPreferred: input.isPreferred ?? existing.isPreferred,
      })
      .where(eq(productSuppliers.id, existing.id))
  } else if (!existing) {
    await tx.insert(productSuppliers).values({
      id: relationId,
      productId: input.productId,
      supplierId: input.supplierId,
      unitPrice: newPrice,
      isPreferred: input.isPreferred ?? input.isPreferredWhenCreated ?? false,
      lastUpdated: effectiveAt,
      notes: input.notes ?? null,
    })
  }

  if (previousPrice === newPrice) {
    return { changed: false, stale: false, relationId, previousPrice, newPrice }
  }

  await tx.insert(productSupplierPriceHistory).values({
    id: nanoid(),
    productId: input.productId,
    supplierId: input.supplierId,
    previousPrice,
    newPrice,
    source: input.source,
    sourceId: input.sourceId ?? null,
    effectiveDate: effectiveAt,
    createdByUserId: input.userId ?? null,
  })

  return { changed: true, stale: false, relationId, previousPrice, newPrice }
}

export async function setProductSupplierPrice(input: SetProductSupplierPriceInput) {
  return db.transaction((tx) => setProductSupplierPriceTx(tx, input))
}
