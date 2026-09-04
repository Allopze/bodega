export type SkuPrefix = "EPP" | "SRV"

export type SkuMapInput = {
  id: string
  name: string
  prefix: SkuPrefix
  oldSku: string
}

export type ExistingProductSku = {
  id: string
  sku: string
}

export type SkuMapOutput = SkuMapInput & {
  newSku: string
}

/**
 * Assigns sequential SKUs while preserving codes owned by products outside
 * the normalizable set (for example inactive historical products).
 *
 * The input order is significant and must already match the canonical order
 * used by the database query. Current SKUs of input rows are deliberately not
 * reserved: the caller stages those rows before applying the final values.
 */
export function buildSequentialSkuMap({
  rows,
  existingProducts,
}: {
  rows: readonly SkuMapInput[]
  existingProducts: readonly ExistingProductSku[]
}): SkuMapOutput[] {
  const normalizableIds = new Set(rows.map((row) => row.id))
  const reservedSkus = new Set(
    existingProducts.filter((product) => !normalizableIds.has(product.id)).map((product) => product.sku),
  )
  const nextSequenceByPrefix = new Map<SkuPrefix, number>()

  return rows.map((row) => {
    let sequence = nextSequenceByPrefix.get(row.prefix) ?? 1
    let newSku = ""

    do {
      newSku = `${row.prefix}-${String(sequence).padStart(3, "0")}`
      sequence++
    } while (reservedSkus.has(newSku))

    nextSequenceByPrefix.set(row.prefix, sequence)
    return { ...row, newSku }
  })
}
