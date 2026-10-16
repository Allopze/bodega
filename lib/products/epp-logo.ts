/**
 * Las prendas EPP de la empresa llevan logo **siempre**: no es una opción de
 * quien pide sino una característica del tipo de prenda, y tiene que llegar a
 * la OC para que el proveedor la confeccione con logo.
 *
 * Se representa como un atributo `select` de un solo valor (`Logo: Con logo`)
 * en cada variante. Así viaja por el mismo camino que la talla: Solicitudes lo
 * copia a `request_item_attributes` y la OC impresa lo junta con el catálogo
 * (`mergeVariantAttributes`). Diseño: docs/superpowers/specs/2026-10-15-epp-con-logo-design.md
 *
 * Sin dependencias de servidor a propósito: lo usan las escrituras del catálogo
 * (fuente de verdad) y el asistente de productos (vista previa).
 */
import { normalizeAttributeName } from "./attribute-names"
import { EPP_TYPES, inferEppItemType } from "./epp-item-type"
import { parseSizeOptions } from "./product-size"

export const LOGO_ATTRIBUTE_NAME = "Logo"
export const LOGO_VALUE = "Con logo"

/**
 * Fase 1 (2026-10-15). La regla es por tipo y sin excepción: no hay override
 * por producto. Overol, jardinera, casco, gorro, traje y capa quedan para una
 * decisión posterior; calzado, guantes y la protección ocular, respiratoria y
 * auditiva no llevan logo.
 */
export const EPP_TYPES_WITH_LOGO: ReadonlySet<(typeof EPP_TYPES)[number]> = new Set([
  "chaleco", "polera", "camisa", "blusa", "pantalon", "chaqueta", "primera capa",
] as const)

export interface LogoProduct {
  name: string
  isEpp: boolean
}

/** La prenda lleva logo. Se infiere del nombre: 2/3 del catálogo no tiene familia. */
export function requiresLogo(product: LogoProduct): boolean {
  if (!product.isEpp) return false
  const type = inferEppItemType(product.name)
  return type != null && EPP_TYPES_WITH_LOGO.has(type)
}

export interface LogoRuleRow {
  name: string
  type: string
  options?: string | null
  sortOrder?: number
}

/** Lo mínimo de un atributo `Logo` nuevo; cada camino de escritura le pone sus ids. */
export interface LogoSeed {
  name: typeof LOGO_ATTRIBUTE_NAME
  type: "select"
  options: string
  isRequired: true
  sortOrder: number
}

const LOGO_OPTIONS = JSON.stringify([LOGO_VALUE])

function isLogoRow(row: LogoRuleRow) {
  return normalizeAttributeName(row.name) === normalizeAttributeName(LOGO_ATTRIBUTE_NAME)
}

/**
 * Antes de este atributo, el logo se anotaba como `Modelo: Con logo` (o «Con
 * logo Chome»), desplazando el modelo real. Sólo cuenta si es el único valor.
 */
function isLegacyLogoModelo(row: LogoRuleRow) {
  if (normalizeAttributeName(row.name) !== "modelo" || row.type !== "select") return false
  const values = parseSizeOptions(row.options)
  return values.length === 1 && /^con logo\b/.test(normalizeAttributeName(values[0]!))
}

/**
 * Atributos de la prenda con exactamente un `Logo: Con logo`.
 *
 * - Un `Logo` existente se normaliza (conserva su id).
 * - Si no hay `Logo`, un `Modelo: Con logo…` heredado se convierte en el lugar:
 *   renombrar y no borrar, porque `request_item_attributes.attribute_id` apunta
 *   a esa fila y una FK sin cascada impide quitarla.
 * - Si no hay ninguno, se agrega uno con `createRow` al final.
 *
 * Un producto que no lleva logo vuelve intacto: nunca se quita un `Logo` (la
 * misma FK lo impediría, y renombrar un producto no debe romper su edición).
 */
export function applyLogoRule<T extends LogoRuleRow>(
  product: LogoProduct,
  rows: readonly T[],
  createRow: (seed: LogoSeed) => T,
): T[] {
  if (!requiresLogo(product)) return [...rows]

  if (rows.some(isLogoRow)) {
    return rows.map((row) => isLogoRow(row) ? { ...row, name: LOGO_ATTRIBUTE_NAME, type: "select", options: LOGO_OPTIONS } : row)
  }

  const legacyIndex = rows.findIndex(isLegacyLogoModelo)
  if (legacyIndex >= 0) {
    return rows.map((row, index) => index === legacyIndex ? { ...row, name: LOGO_ATTRIBUTE_NAME, type: "select", options: LOGO_OPTIONS } : row)
  }

  const lastSortOrder = rows.reduce((max, row, index) => Math.max(max, row.sortOrder ?? index), -1)
  return [...rows, createRow({
    name: LOGO_ATTRIBUTE_NAME, type: "select", options: LOGO_OPTIONS, isRequired: true, sortOrder: lastSortOrder + 1,
  })]
}
