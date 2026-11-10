import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { productSupplierPriceHistory, productSuppliers } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { todayInChile } from "@/lib/utils"

export type ProductSupplierPriceSource =
  | "product_form"
  | "variant_creator"
  | "epp_import"
  | "invoice_reconciliation"
  | "baseline"
  /** Precio unitario de una línea de repuesto de catálogo al emitir la OC. */
  | "purchase_order"

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
  /**
   * Evidencia que sólo trae fecha (una factura, `YYYY-MM-DD`). Del mismo día
   * civil chileno que el precio vigente no es «anterior» a él aunque su
   * medianoche UTC lo sea: una factura emitida el día de la OC tiene que poder
   * corregirla. Se fecha entonces en la vigencia actual, para quedar después de
   * lo que corrige también en el historial.
   */
  effectiveDay?: string
  /**
   * La OC emitida y la factura conciliada que repiten el precio vigente lo
   * confirman: queda una fila de historial con el mismo precio antes y después
   * y la vigencia avanza. Sin esa constancia, anular la OC que escribió primero
   * el precio lo retiraba aunque otra fuente viva lo sostuviera. La ficha del
   * repuesto no muestra estas filas (no son un cambio de precio).
   */
  recordSamePrice?: boolean
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
  let effectiveAt = input.effectiveAt ?? new Date().toISOString()
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
    if (!input.effectiveDay || input.effectiveDay !== todayInChile(existing.lastUpdated)) {
      return { changed: false, stale: true, relationId: existing.id, previousPrice, newPrice }
    }
    effectiveAt = existing.lastUpdated
  }

  if (existing && newPrice === null && input.deleteRelationWhenNull) {
    await tx.delete(productSuppliers).where(eq(productSuppliers.id, existing.id))
    if (previousPrice === null) {
      return { changed: false, stale: false, relationId: existing.id, previousPrice, newPrice }
    }
  } else if (existing && previousPrice === newPrice) {
    const confirms = input.recordSamePrice === true && newPrice !== null
    await tx.update(productSuppliers).set({
      isPreferred: input.isPreferred ?? existing.isPreferred,
      notes: input.notes ?? existing.notes,
      ...(confirms && new Date(effectiveAt).getTime() > currentTimestamp ? { lastUpdated: effectiveAt } : {}),
    }).where(eq(productSuppliers.id, existing.id))
    if (confirms) {
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
    }
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

/**
 * Fecha de una factura conciliada como evidencia de precio: su día de emisión
 * (o, sin él, el momento en que se subió), que confirma el precio vigente
 * cuando lo repite. La usa la conciliación de facturas; vive aquí para que el
 * criterio de «del mismo día» sea uno solo.
 */
export function invoicePriceEvidence(invoice: { issueDate: string | null; uploadedAt: string }): Pick<
  SetProductSupplierPriceInput,
  "effectiveAt" | "effectiveDay" | "recordSamePrice"
> {
  return invoice.issueDate
    ? { effectiveAt: `${invoice.issueDate}T00:00:00.000Z`, effectiveDay: invoice.issueDate, recordSamePrice: true }
    : { effectiveAt: invoice.uploadedAt, recordSamePrice: true }
}

export async function setProductSupplierPrice(input: SetProductSupplierPriceInput) {
  return db.transaction((tx) => setProductSupplierPriceTx(tx, input))
}
