export interface ProductAttributeSummary {
  name: string
  sortOrder: number
  options: string | null
  isRequired?: boolean
}

export function formatProductAttributeNames(attributes: ProductAttributeSummary[]) {
  if (attributes.length === 0) return "—"

  return [...attributes]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((attribute) => attribute.name)
    .join(" · ")
}

export interface ProductWarningInput {
  isEpp: boolean
  requiresPrevencion: boolean
  referencePrice: number | null
  hasPreferredSupplier: boolean
  attributes: ProductAttributeSummary[]
}

export interface CategoryFlags {
  isEpp: boolean
  requiresPrevencion: boolean
}

// ponytail: "sin atributos requeridos" only applies to EPP products — Talla/Color
// drive fulfillment for EPP, non-EPP products aren't expected to have any.
export function getProductWarnings(product: ProductWarningInput, category: CategoryFlags | undefined): string[] {
  const warnings: string[] = []
  if (product.referencePrice == null) warnings.push("Sin precio referencial")
  if (!product.hasPreferredSupplier) warnings.push("Sin proveedor preferido")
  if (product.isEpp && !product.attributes.some((a) => a.isRequired)) warnings.push("EPP sin atributos obligatorios")
  if (category && (product.isEpp !== category.isEpp || product.requiresPrevencion !== category.requiresPrevencion)) {
    warnings.push("Difiere de la configuración EPP/Prevención de su categoría")
  }
  return warnings
}

export interface FamilyWarningInput extends ProductWarningInput {
  id: string
}

/** Aggregate warnings across all variants of a family. */
export function getFamilyWarnings(variants: FamilyWarningInput[], category: CategoryFlags | undefined): string[] {
  const familyWarnings: string[] = []

  const someWithoutPrice = variants.some((v) => v.referencePrice == null)
  const someWithoutSupplier = variants.some((v) => !v.hasPreferredSupplier)

  if (someWithoutPrice) familyWarnings.push("Variante(s) sin precio referencial")
  if (someWithoutSupplier) familyWarnings.push("Variante(s) sin proveedor preferido")

  const eppRequired = variants.some((v) => v.isEpp && v.attributes.some((a) => a.isRequired))
  const eppMissing = variants.some((v) => v.isEpp && !v.attributes.some((a) => a.isRequired))
  if (eppRequired && eppMissing && variants.length > 1) {
    familyWarnings.push("Familia con requisitos EPP mixtos entre variantes")
  } else if (eppMissing) {
    familyWarnings.push("EPP sin atributos obligatorios")
  }

  if (category && variants.some((v) => v.isEpp !== category.isEpp || v.requiresPrevencion !== category.requiresPrevencion)) {
    familyWarnings.push("Difiere de la configuración EPP/Prevención de su categoría")
  }

  return familyWarnings
}
