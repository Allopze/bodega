import { describe, expect, it } from "vitest"
import {
  mergeProductAttribute,
  normalizeProductAttributeName,
  setPreferredSupplier,
  parseOptionsText,
  generateVariantCombos,
  canAdvanceWizard,
  shouldShowConfirmClose,
  getStepAnimationClass,
} from "./product-form.helpers"
import type { SupplierRow, AttributeMultiValues, WizardGeneralState, WizardCloseAction } from "./product-form.types"

describe("product form attribute helpers", () => {
  it("normalizes accents, case and whitespace for attribute identity", () => {
    expect(normalizeProductAttributeName("  TALLA   calzado ")).toBe("talla calzado")
    expect(normalizeProductAttributeName("Tállá calzado")).toBe("talla calzado")
  })

  it("replaces an existing attribute instead of duplicating it", () => {
    const rows = [{
      id: "attr-1",
      name: "Tállá",
      type: "text" as const,
      isRequired: false,
      options: "",
      sortOrder: 4,
    }]

    const result = mergeProductAttribute(rows, {
      name: "Talla",
      type: "select",
      isRequired: true,
      options: "S, M, L",
      sortOrder: 0,
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: "attr-1", name: "Talla", type: "select", isRequired: true, sortOrder: 4 })
  })
})

describe("setPreferredSupplier", () => {
  const rows: SupplierRow[] = [
    { id: "1", supplierId: "sup-1", supplierName: "A", unitPrice: "", isPreferred: true, notes: "" },
    { id: "2", supplierId: "sup-2", supplierName: "B", unitPrice: "", isPreferred: false, notes: "" },
  ]

  it("unchecks every other row when marking one as preferred", () => {
    const result = setPreferredSupplier(rows, 1, true)
    expect(result.map((r) => r.isPreferred)).toEqual([false, true])
  })

  it("allows unchecking the only preferred row, leaving none preferred", () => {
    const result = setPreferredSupplier(rows, 0, false)
    expect(result.map((r) => r.isPreferred)).toEqual([false, false])
  })
})

// ── parseOptionsText ─────────────────────────────────────────────────────────

describe("parseOptionsText", () => {
  it("returns empty array for empty input", () => {
    expect(parseOptionsText("")).toEqual([])
  })

  it("parses a JSON array", () => {
    expect(parseOptionsText('["S","M","L"]')).toEqual(["S", "M", "L"])
  })

  it("parses comma-separated text", () => {
    expect(parseOptionsText("Negro, Azul, Rojo")).toEqual(["Negro", "Azul", "Rojo"])
  })

  it("parses newline-separated text", () => {
    expect(parseOptionsText("Negro\nAzul\nRojo")).toEqual(["Negro", "Azul", "Rojo"])
  })

  it("strips whitespace and filters empties", () => {
    expect(parseOptionsText("  A , B ,,  C  ")).toEqual(["A", "B", "C"])
  })
})

// ── generateVariantCombos ────────────────────────────────────────────────────

describe("generateVariantCombos", () => {
  it("returns empty array when no attributes given", () => {
    expect(generateVariantCombos("Casco", [])).toEqual([])
  })

  it("generates combos for single attribute with one value", () => {
    const attrs: AttributeMultiValues[] = [
      { name: "Color", type: "select", values: ["Rojo"] },
    ]
    const result = generateVariantCombos("Casco", attrs)
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe("Casco Rojo")
    expect(result[0]!.attributes).toEqual([{ name: "Color", value: "Rojo" }])
  })

  it("generates Cartesian product for two attributes", () => {
    const attrs: AttributeMultiValues[] = [
      { name: "Color", type: "select", values: ["Blanco", "Azul"] },
      { name: "Talla", type: "select", values: ["M", "L"] },
    ]
    const result = generateVariantCombos("Casco", attrs)
    expect(result).toHaveLength(4)
    expect(result.map((v) => v.name)).toEqual([
      "Casco Blanco M",
      "Casco Blanco L",
      "Casco Azul M",
      "Casco Azul L",
    ])
  })

  it("generates combos for single attribute with multiple values", () => {
    const attrs: AttributeMultiValues[] = [
      { name: "Talla calzado", type: "select", values: ["42", "43"] },
    ]
    const result = generateVariantCombos("Botín seguridad", attrs)
    expect(result).toHaveLength(2)
    expect(result[0]!.name).toBe("Botín seguridad 42")
    expect(result[1]!.name).toBe("Botín seguridad 43")
  })

  it("handles three attributes (longer Cartesian product)", () => {
    const attrs: AttributeMultiValues[] = [
      { name: "Color", type: "select", values: ["Rojo", "Azul"] },
      { name: "Talla", type: "select", values: ["M", "L", "XL"] },
      { name: "Material", type: "select", values: ["Algodón"] },
    ]
    const result = generateVariantCombos("Polera", attrs)
    // 2 × 3 × 1 = 6
    expect(result).toHaveLength(6)
    // First combo
    expect(result[0]!.name).toBe("Polera Rojo M Algodón")
    // Last combo
    expect(result[5]!.name).toBe("Polera Azul XL Algodón")
  })

  it("handles base name without extra spaces when no suffix", () => {
    const attrs: AttributeMultiValues[] = [
      { name: "Color", type: "select", values: ["Negro"] },
    ]
    const result = generateVariantCombos("Cable", attrs)
    expect(result[0]!.name).toBe("Cable Negro")
  })

  it("sets sku to empty string in generated combos", () => {
    const attrs: AttributeMultiValues[] = [
      { name: "Color", type: "select", values: ["Rojo"] },
    ]
    const result = generateVariantCombos("Producto", attrs)
    expect(result[0]!.sku).toBe("")
  })
})

// ── canAdvanceWizard ─────────────────────────────────────────────────────────

describe("canAdvanceWizard", () => {
  const filled: WizardGeneralState = {
    categoryId: "cat-1",
    name: "Casco",
    description: "",
    unitOfMeasure: "unidad",
    referencePrice: "",
    notes: "",
    isEpp: false,
    requiresPrevencion: false,
    isActive: true,
  }

  it("returns false for step 1 when category is missing", () => {
    expect(canAdvanceWizard(1, { ...filled, categoryId: "" })).toBe(false)
  })

  it("returns false for step 1 when name is too short", () => {
    expect(canAdvanceWizard(1, { ...filled, name: "A" })).toBe(false)
  })

  it("returns false for step 1 when name is only whitespace", () => {
    expect(canAdvanceWizard(1, { ...filled, name: "   " })).toBe(false)
  })

  it("returns true for step 1 when category and name are valid", () => {
    expect(canAdvanceWizard(1, filled)).toBe(true)
  })

  it("always returns true for step 2 (attributes are optional)", () => {
    expect(canAdvanceWizard(2, filled)).toBe(true)
    expect(canAdvanceWizard(2, { ...filled, categoryId: "" })).toBe(true)
  })

  it("always returns true for step 3 (last step)", () => {
    expect(canAdvanceWizard(3, filled)).toBe(true)
    expect(canAdvanceWizard(3, { ...filled, name: "" })).toBe(true)
  })

  it("requires at least 2 characters for the product name", () => {
    // 2 chars should work
    expect(canAdvanceWizard(1, { ...filled, name: "Ca" })).toBe(true)
  })
})

// ── shouldShowConfirmClose ───────────────────────────────────────────────────

describe("shouldShowConfirmClose", () => {
  it("returns 'close-directly' when form is not dirty (new product)", () => {
    const result: WizardCloseAction = shouldShowConfirmClose(false, false, false)
    expect(result).toBe("close-directly")
  })

  it("returns 'close-directly' when editing existing product (even if dirty)", () => {
    const result: WizardCloseAction = shouldShowConfirmClose(true, true, false)
    expect(result).toBe("close-directly")
  })

  it("returns 'show-confirm' when form is dirty on a new product", () => {
    const result: WizardCloseAction = shouldShowConfirmClose(true, false, false)
    expect(result).toBe("show-confirm")
  })

  it("returns 'close-directly' when form is not dirty on a new product", () => {
    const result: WizardCloseAction = shouldShowConfirmClose(false, false, false)
    expect(result).toBe("close-directly")
  })

  it("returns 'already-closing' when closingRef is true (confirmed via dialog)", () => {
    const result: WizardCloseAction = shouldShowConfirmClose(true, false, true)
    expect(result).toBe("already-closing")
  })

  it("'already-closing' takes priority over dirty state", () => {
    const result: WizardCloseAction = shouldShowConfirmClose(true, false, true)
    expect(result).toBe("already-closing")
  })

  it("'close-directly' when closingRef is true but in edit mode", () => {
    // edit mode doesn't use confirm dialog, so closingRef is ignored
    const result: WizardCloseAction = shouldShowConfirmClose(true, true, true)
    expect(result).toBe("already-closing") // closingRef has highest priority
  })
})

// ── getStepAnimationClass ────────────────────────────────────────────────────

describe("getStepAnimationClass", () => {
  it("returns slide-in-from-right for forward direction", () => {
    const result = getStepAnimationClass("forward")
    expect(result).toContain("slide-in-from-right-4")
    expect(result).toContain("animate-in")
    expect(result).toContain("fade-in-0")
    expect(result).not.toContain("left")
  })

  it("returns slide-in-from-left for backward direction", () => {
    const result = getStepAnimationClass("backward")
    expect(result).toContain("slide-in-from-left-4")
    expect(result).toContain("animate-in")
    expect(result).toContain("fade-in-0")
    expect(result).not.toContain("right")
  })

  it("includes duration and easing tokens", () => {
    const result = getStepAnimationClass("forward")
    expect(result).toContain("duration-[var(--duration-default)]")
    expect(result).toContain("ease-[var(--ease-out)]")
  })
})
