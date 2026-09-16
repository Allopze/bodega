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

/** Un SKU ya emitido por este esquema: prefijo conocido y correlativo. */
const CANONICAL_SKU = /^(EPP|SRV)-(\d{3,})$/

/**
 * Asigna SKUs correlativos sin mover los que ya están en circulación.
 *
 * El SKU vive sólo en `products.sku`: guías, trazabilidad y los exportes de EPP
 * lo leen en vivo, así que reescribirlo cambia el código que muestra un
 * documento ya emitido. Por eso la regla es conservar, no reordenar:
 *
 *  1. Todo producto que ya tiene un SKU canónico de su propio prefijo lo
 *     conserva. Es su código; que quede fuera del orden alfabético es el precio
 *     de que un papel impreso siga diciendo la verdad.
 *  2. El resto —productos nuevos, SKUs heredados, o reclasificados a otro
 *     prefijo— toma el menor correlativo libre.
 *
 * Los códigos de productos fuera del conjunto normalizable (los inactivos, que
 * conservan su SKU por trazabilidad histórica) quedan reservados y producen
 * saltos en la secuencia. Un producto dado de baja no devuelve su número.
 *
 * El orden de entrada decide qué correlativo recibe cada producto del paso 2,
 * así que la consulta que alimenta esta función debe desempatar de forma
 * determinista.
 */
export function buildSequentialSkuMap({
  rows,
  existingProducts,
}: {
  rows: readonly SkuMapInput[]
  existingProducts: readonly ExistingProductSku[]
}): SkuMapOutput[] {
  const normalizableIds = new Set(rows.map((row) => row.id))
  const claimed = new Set(
    existingProducts.filter((product) => !normalizableIds.has(product.id)).map((product) => product.sku),
  )

  // Paso 1: anclar antes de repartir. Tiene que ser una pasada completa y
  // previa, porque un correlativo libre para una fila sólo se sabe una vez
  // conocidos todos los códigos que se conservan.
  const anchoredByRowId = new Map<string, string>()
  for (const row of rows) {
    const match = CANONICAL_SKU.exec(row.oldSku)
    // Un producto reclasificado (un SRV que arrastra un código EPP) no ancla:
    // su prefijo dejó de describirlo.
    if (!match || match[1] !== row.prefix) continue
    // `products.sku` es único, así que dos filas no pueden traer el mismo
    // código; la guarda cubre una base inconsistente sin repartir duplicados.
    if (claimed.has(row.oldSku)) continue
    anchoredByRowId.set(row.id, row.oldSku)
    claimed.add(row.oldSku)
  }

  // Paso 2: repartir el menor correlativo libre entre los que no anclaron.
  const nextSequenceByPrefix = new Map<SkuPrefix, number>()

  return rows.map((row) => {
    const anchored = anchoredByRowId.get(row.id)
    if (anchored) return { ...row, newSku: anchored }

    let sequence = nextSequenceByPrefix.get(row.prefix) ?? 1
    let newSku = ""

    do {
      newSku = `${row.prefix}-${String(sequence).padStart(3, "0")}`
      sequence++
    } while (claimed.has(newSku))

    claimed.add(newSku)
    nextSequenceByPrefix.set(row.prefix, sequence)
    return { ...row, newSku }
  })
}
