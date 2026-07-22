import type { AttributeRow, SupplierRow, AttributeMultiValues, VariantCombo, WizardStep, WizardGeneralState, WizardCloseAction } from "./product-form.types"

// ── Text helpers ─────────────────────────────────────────────────────────────

export function normalizeProductAttributeName(value: string) {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
}

/**
 * Parse attribute options stored as JSON array or comma/newline-separated text.
 */
export function parseOptionsText(text: string): string[] {
  if (!text) return []
  try {
    const parsed: unknown = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed.map(String)
  } catch {
    // fall through
  }
  return text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
}

// ── Attribute helpers ────────────────────────────────────────────────────────

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
    const suffix = attrs.map((a) => a.value).join(" ")
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
  const from = direction === "forward" ? "right" : "left"
  return `animate-in fade-in-0 slide-in-from-${from}-4 duration-[var(--duration-default)] ease-[var(--ease-out)]`
}
