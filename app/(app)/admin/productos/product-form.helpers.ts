import type { AttributeRow, SupplierRow } from "./product-form.types"

export function normalizeProductAttributeName(value: string) {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
}

export function mergeProductAttribute(rows: AttributeRow[], next: AttributeRow): AttributeRow[] {
  const existingIndex = rows.findIndex(
    (row) => normalizeProductAttributeName(row.name) === normalizeProductAttributeName(next.name),
  )
  const existing = existingIndex >= 0 ? rows[existingIndex] : undefined
  const merged = {
    ...next,
    id: existing?.id ?? next.id ?? crypto.randomUUID(),
    sortOrder: existing?.sortOrder ?? next.sortOrder ?? rows.length,
  }

  if (existingIndex < 0) return [...rows, merged]
  return rows.map((row, index) => (index === existingIndex ? merged : row))
}

// Only one supplier can be preferred per product (DB-enforced). Checking one
// row's "preferred" unchecks every other row instead of allowing multiple.
export function setPreferredSupplier(rows: SupplierRow[], index: number, checked: boolean): SupplierRow[] {
  return rows.map((row, idx) => ({ ...row, isPreferred: idx === index ? checked : (checked ? false : row.isPreferred) }))
}
