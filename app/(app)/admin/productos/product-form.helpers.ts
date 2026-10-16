import { duplicateNormalizedNames, normalizeAttributeName } from "@/lib/products/attribute-names"
import { isSizeAttributeName, normalizeSizeLabel } from "@/lib/products/product-size"
import { applyLogoRule, LOGO_ATTRIBUTE_NAME, LOGO_VALUE, type LogoProduct } from "@/lib/products/epp-logo"
import type { AttributeRow, SupplierRow, AttributeMultiValues, VariantCombo, WizardStep, WizardGeneralState, WizardCloseAction } from "./product-form.types"

// ── Text helpers ─────────────────────────────────────────────────────────────

export { normalizeAttributeName as normalizeProductAttributeName } from "@/lib/products/attribute-names"

/** Un par que es el logo: `Logo` o el `Modelo: Con logo…` con que se anotaba antes. */
function isLogoPair(name: string, value: string): boolean {
  const normalized = normalizeAttributeName(name)
  if (normalized === normalizeAttributeName(LOGO_ATTRIBUTE_NAME)) return true
  return normalized === "modelo" && /^con logo\b/.test(normalizeAttributeName(value))
}

/**
 * La misma firma sin el eje del logo, para claves ya calculadas (las de las
 * variantes existentes llegan del servidor como texto).
 */
function stripLogoFromKey(key: string): string {
  try {
    const pairs: unknown = JSON.parse(key)
    if (!Array.isArray(pairs)) return key
    return JSON.stringify(pairs.filter((pair) => !(Array.isArray(pair) && isLogoPair(String(pair[0]), String(pair[1])))))
  } catch {
    return key
  }
}

/** Firma canónica de una combinación de valores: pares nombre→valor ordenados.
 *  Es la misma forma que usa `createProductVariantBatch` para comparar contra
 *  las variantes ya existentes de una familia, así que el cliente y el servidor
 *  siempre hablan del mismo identificador. */
export function variantComboKey(attributes: Array<{ name: string; value: string }>): string {
  // La talla se compara canonizada: `T/L` histórica y `L` nueva son la misma
  // talla, y sin esto «Agregar tallas» ofrecía y creaba una segunda L.
  return JSON.stringify(
    attributes.filter((a) => !isLogoPair(a.name, a.value)).map((a) => [
      normalizeAttributeName(a.name),
      isSizeAttributeName(a.name) ? normalizeSizeLabel(a.value) : a.value.trim(),
    ]).sort(),
  )
}

/** Filtra las combinaciones del preview que ya existen en la familia. Cada
 *  variante es un producto con su historial, así que no se puede volver a crear
 *  una combinación idéntica: se quita del preview y se avisa. */
export function filterNewVariantCombos(
  combos: VariantCombo[],
  existingVariantKeys: readonly string[],
): { kept: VariantCombo[]; removed: VariantCombo[] } {
  // El logo no distingue variantes: es igual en toda la familia. Se ignora de
  // ambos lados porque las variantes anteriores al backfill no lo tienen y las
  // nuevas sí; comparándolo, una talla ya existente se ofrecería como nueva.
  const existing = new Set(existingVariantKeys.map(stripLogoFromKey))
  const kept: VariantCombo[] = []
  const removed: VariantCombo[] = []
  for (const combo of combos) {
    if (existing.has(variantComboKey(combo.attributes))) removed.push(combo)
    else kept.push(combo)
  }
  return { kept, removed }
}

/**
 * Parse attribute options stored as JSON array or comma/newline-separated text.
 */
export function parseOptionsText(text: string): string[] {
  if (!text) return []
  try {
    const parsed: unknown = JSON.parse(text)
    if (Array.isArray(parsed)) return [...new Set(parsed.flatMap((value) => { const trimmed = String(value).trim(); return trimmed ? [trimmed] : [] }))]
  } catch {
    // fall through
  }
  return text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
}

// ── Attribute helpers ────────────────────────────────────────────────────────

// ── Edit-mode attribute/supplier preservation ──────────────────────────────
//
// The wizard UI only edits ONE supplier slot and only creates/edits `select`
// attributes. Saving an edited product must not silently drop every other
// supplier or every non-select attribute (e.g. an `integer` quantity driver)
// that the product already had from another path (import, seed, API).

/**
 * The supplier the wizard's single "Proveedor" step edits: the preferred one
 * if there is one, else the first. Everything else is carried through
 * untouched by `buildSuppliersForSubmit`.
 */
export function pickPrimarySupplier(suppliers: SupplierRow[]): SupplierRow | null {
  return suppliers.find((s) => s.isPreferred) ?? suppliers[0] ?? null
}

export function otherSuppliers(suppliers: SupplierRow[], primary: SupplierRow | null): SupplierRow[] {
  if (!primary) return suppliers
  return suppliers.filter((s) => s !== primary)
}

export interface SupplierSubmitRow {
  supplierId: string
  unitPrice: number | null
  isPreferred: boolean
  notes: string | null
}

export function buildSuppliersForSubmit(
  primary: { supplierId: string; unitPrice: string; notes: string; hasSupplier: boolean },
  others: SupplierRow[],
): SupplierSubmitRow[] {
  const rest: SupplierSubmitRow[] = others.map((s) => ({
    supplierId: s.supplierId,
    unitPrice: s.unitPrice ? parseFloat(s.unitPrice) : null,
    isPreferred: false,
    notes: s.notes || null,
  }))
  if (!primary.hasSupplier || !primary.supplierId) return rest
  return [
    { supplierId: primary.supplierId, unitPrice: primary.unitPrice ? parseFloat(primary.unitPrice) : null, isPreferred: true, notes: primary.notes || null },
    ...rest.filter((row) => row.supplierId !== primary.supplierId),
  ]
}

/**
 * Une los dos editores de atributos en la lista que se envía al servidor.
 *
 * La propiedad se reparte por **tipo**, no por editor, que es lo que evita que
 * peleen por la misma fila: los chips del paso 2 son dueños de los `select`
 * (los ejes de variante), y el editor avanzado es dueño de todo lo demás
 * (`text`/`number`/`integer`, incluido el atributo que gobierna la cantidad).
 * Los `select` se casan por nombre normalizado contra el snapshot para
 * conservar su `id` y `sortOrder`.
 */
export function mergeEditAttributes(
  original: AttributeRow[],
  wizAttrs: AttributeMultiValues[],
  advAttrs: AttributeRow[],
  product?: LogoProduct,
): AttributeRow[] {
  // La mitad no-`select` sale del editor avanzado (estado vivo), no del
  // snapshot del servidor: si se leyera `original` como antes, cualquier
  // edición del editor avanzado se descartaría en silencio al guardar.
  const nonSelect = advAttrs.filter((a) => a.type !== "select" && a.name.trim())
  // Si la prenda lleva logo, un `Modelo: Con logo` heredado se vuelve `Logo` en
  // el eje del asistente: se casa contra la fila renombrada para conservar su id
  // (la FK de las solicitudes apunta a ella).
  const comparable = product
    ? applyLogoRule<AttributeRow>(product, original, (seed) => seed)
    : original
  const existingByName = new Map(
    comparable.filter((a) => a.type === "select").map((a) => [normalizeAttributeName(a.name), a]),
  )
  const selectAttrs = wizAttrs.map((attr, i) => {
    const existing = existingByName.get(normalizeAttributeName(attr.name))
    return {
      id: existing?.id,
      name: attr.name,
      type: "select" as const,
      isRequired: existing?.isRequired ?? true,
      options: JSON.stringify(attr.values),
      sizeFamily: attr.sizeFamily,
      sortOrder: existing?.sortOrder ?? original.length + i,
    }
  })
  return [...nonSelect, ...selectAttrs]
}

// ── Variant generation (Cartesian product) ────────────────────────────────────

type AttrPair = { name: string; value: string }

/**
 * Compute the Cartesian product of attribute values to generate variant combos.
 *
 * Example: Talla=[M,L] × Color=[Blanco,Azul] → 4 combos:
 *   "Casco M Blanco", "Casco M Azul", "Casco L Blanco", "Casco L Azul"
 */
export function generateVariantCombos(
  baseName: string,
  attributes: AttributeMultiValues[],
): VariantCombo[] {
  if (attributes.length === 0) return []
  const attrSets: AttrPair[][] = attributes.map((attr) =>
    attr.values.map((v) => ({ name: attr.name, value: v })),
  )
  const cartesian: AttrPair[][] = attrSets.reduce<AttrPair[][]>(
    (acc, values) => acc.flatMap((combo) => values.map((v) => [...combo, v])),
    [[]],
  )
  return cartesian.map((attrs) => {
    // El logo no va en el nombre: es igual en toda la familia y sólo lo alargaría.
    const suffix = attrs.filter((a) => !isLogoPair(a.name, a.value)).map((a) => a.value).join(" ")
    return { sku: "", name: `${baseName} ${suffix}`.trim(), attributes: attrs }
  })
}

// ── Wizard step validation ───────────────────────────────────────────────────

/**
 * Determines whether the user can advance from the current step.
 */
export function canAdvanceWizard(
  step: WizardStep,
  general: WizardGeneralState,
): boolean {
  if (step === 1) return general.categoryId !== "" && general.name.trim().length >= 2
  if (step === 2) return true // attributes are optional
  return true
}

// ── Dirty state / confirm-close logic ────────────────────────────────────────

/**
 * Determines what should happen when the user attempts to close the form.
 *
 * - `"close-directly"`: no unsaved changes or editing existing product — close immediately.
 * - `"show-confirm"`: unsaved changes on a new product — show confirmation dialog.
 * - `"already-closing"`: we're mid-close (confirmed via ref) — close without re-prompting.
 */
export function shouldShowConfirmClose(
  isDirty: boolean,
  isEdit: boolean,
  closingRef: boolean,
): WizardCloseAction {
  if (closingRef) return "already-closing"
  if (isDirty && !isEdit) return "show-confirm"
  return "close-directly"
}

// ── Step animation classes ───────────────────────────────────────────────────

/**
 * Returns the animation class string for the step content wrapper,
 * providing a direction-aware slide-in effect.
 */
export function getStepAnimationClass(direction: "forward" | "backward"): string {
  // Clases literales y no interpoladas: Tailwind escanea el código fuente como
  // texto, así que una clase armada en tiempo de ejecución (interpolando la
  // dirección dentro del nombre) nunca llegaba al CSS compilado y la animación
  // simplemente no existía. La prueba afirmaba el string resultante, por eso
  // pasaba igual; el chequeo de verdad mira la fuente.
  return direction === "forward"
    ? "animate-in fade-in-0 slide-in-from-right-4 duration-[var(--duration-default)] ease-[var(--ease-out)]"
    : "animate-in fade-in-0 slide-in-from-left-4 duration-[var(--duration-default)] ease-[var(--ease-out)]"
}

// ── Editor de atributos avanzados ────────────────────────────────────────────

/**
 * El editor avanzado **no** ofrece `select` a propósito: ese tipo es el que
 * genera variantes y ya tiene su propia UI en el paso 2. Si ambos editores
 * pudieran crear `select`, los dos serían dueños de la misma fila.
 */
export const ADVANCED_ATTRIBUTE_TYPES = ["text", "number", "integer"] as const
export type AdvancedAttributeType = (typeof ADVANCED_ATTRIBUTE_TYPES)[number]

export function blankAdvancedAttribute(sortOrder: number): AttributeRow {
  return { name: "", type: "text", isRequired: false, options: "", sortOrder, drivesQuantity: false }
}

/**
 * Marca (o desmarca) el atributo que gobierna la cantidad.
 *
 * `productAttributeSchema` exige que un driver sea `integer` **y** obligatorio,
 * y la BD sólo admite uno por producto (índice único parcial). Aplicar las tres
 * reglas acá evita que el usuario reciba un error de campo que no puede
 * explicarse desde lo que ve.
 */
export function setQuantityDriver(rows: AttributeRow[], index: number, checked: boolean): AttributeRow[] {
  return rows.map((row, i) => {
    if (i !== index) return checked ? { ...row, drivesQuantity: false } : row
    return checked
      ? { ...row, drivesQuantity: true, type: "integer" as const, isRequired: true }
      : { ...row, drivesQuantity: false }
  })
}

/**
 * Nombres normalizados que aparecen en más de un atributo, mirando los dos
 * editores juntos. Dos atributos con el mismo nombre se pisan al resolverse
 * por nombre en la solicitud (`quantityFromAttributes` y `catalogItemIssues`
 * caen al nombre cuando no hay id).
 */
export function duplicateAttributeNames(wizAttrs: AttributeMultiValues[], advAttrs: AttributeRow[]): Set<string> {
  return duplicateNormalizedNames([
    ...wizAttrs.map((a) => a.name),
    ...advAttrs.map((a) => a.name),
  ])
}

/** Preserve the selected variant and its size family on the single-create path. */
export function buildSingleVariantAttributes(wizAttrs: AttributeMultiValues[], variant?: VariantCombo): AttributeRow[] {
  const selected = new Map(variant?.attributes.map((a) => [normalizeAttributeName(a.name), a.value]))
  return wizAttrs.map((attr, i) => ({
    name: attr.name, type: "select", isRequired: true,
    options: JSON.stringify(variant
      ? [selected.get(normalizeAttributeName(attr.name))].filter((value): value is string => value !== undefined)
      : attr.values),
    sizeFamily: attr.sizeFamily, sortOrder: i,
  }))
}

// ── Eje del logo ─────────────────────────────────────────────────────────────

/**
 * Los ejes del asistente tal como los verá el usuario y como se guardarán.
 *
 * Si la prenda lleva logo, el eje `Logo` es siempre `Con logo`: se agrega, o se
 * convierte el `Modelo: Con logo` heredado (lo decide `applyLogoRule`, la misma
 * regla del servidor). Se **deriva** del estado en vez de guardarse en él: si el
 * nombre cambia y la prenda deja de ser elegible, el eje simplemente desaparece
 * sin que un efecto tenga que adivinar si lo puso el asistente o el producto ya
 * lo tenía (en ese caso el estado lo conserva como cualquier eje).
 */
export function withLogoAxis(attrs: AttributeMultiValues[], product: LogoProduct): AttributeMultiValues[] {
  const rows = attrs.map((a) => ({ ...a, options: JSON.stringify(a.values) }))
  const result = applyLogoRule(product, rows, (seed) => ({ name: seed.name, type: seed.type, options: seed.options, values: [LOGO_VALUE] }))
  return result.map((row) => ({
    name: row.name,
    type: "select" as const,
    values: isLogoAxis(row) ? [LOGO_VALUE] : row.values,
    sizeFamily: row.sizeFamily,
  }))
}

/** El eje de logo no se edita en el asistente: es de la regla, no de quien captura. */
export function isLogoAxis(attr: { name: string }): boolean {
  return normalizeAttributeName(attr.name) === normalizeAttributeName(LOGO_ATTRIBUTE_NAME)
}
