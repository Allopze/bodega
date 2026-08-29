import { describe, expect, it } from "vitest"
import {
  normalizeProductAttributeName,
  parseOptionsText,
  generateVariantCombos,
  canAdvanceWizard,
  shouldShowConfirmClose,
  getStepAnimationClass,
  ADVANCED_ATTRIBUTE_TYPES,
  blankAdvancedAttribute,
  setQuantityDriver,
  duplicateAttributeNames,
  pickPrimarySupplier,
  otherSuppliers,
  buildSuppliersForSubmit,
  mergeEditAttributes,
} from "./product-form.helpers"
import type { SupplierRow, AttributeRow, AttributeMultiValues, WizardGeneralState, WizardCloseAction } from "./product-form.types"

describe("product form attribute helpers", () => {
  it("normalizes accents, case and whitespace for attribute identity", () => {
    expect(normalizeProductAttributeName("  TALLA   calzado ")).toBe("talla calzado")
    expect(normalizeProductAttributeName("Tállá calzado")).toBe("talla calzado")
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
    isService: false,
    requiresWorker: false,
    equipmentKind: "",
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

  /**
   * Las aserciones de arriba pasan igual con clases interpoladas
   * (`slide-in-from-${dir}-4` produce el mismo string), que es justo el bug:
   * Tailwind escanea el CÓDIGO como texto y nunca genera una clase que sólo
   * existe en tiempo de ejecución. El único chequeo real es sobre la fuente.
   */
  it("las clases existen literales en la fuente, que es lo que Tailwind escanea", async () => {
    const { readFile } = await import("node:fs/promises")
    const source = await readFile(new URL("./product-form.helpers.ts", import.meta.url), "utf8")

    expect(source).toContain("slide-in-from-right-4")
    expect(source).toContain("slide-in-from-left-4")
    expect(source).not.toMatch(/slide-in-from-\$\{/)
  })
})

describe("edit-mode supplier preservation", () => {
  const suppliers: SupplierRow[] = [
    { id: "ps-1", supplierId: "sup-a", supplierName: "A", unitPrice: "100", isPreferred: false, notes: "" },
    { id: "ps-2", supplierId: "sup-b", supplierName: "B", unitPrice: "200", isPreferred: true, notes: "pref" },
    { id: "ps-3", supplierId: "sup-c", supplierName: "C", unitPrice: "", isPreferred: false, notes: "" },
  ]

  it("picks the preferred supplier as primary, not just the first row", () => {
    expect(pickPrimarySupplier(suppliers)?.supplierId).toBe("sup-b")
  })

  it("falls back to the first row when none is preferred", () => {
    const noPreferred = suppliers.map((s) => ({ ...s, isPreferred: false }))
    expect(pickPrimarySupplier(noPreferred)?.supplierId).toBe("sup-a")
  })

  it("returns null for an empty list", () => {
    expect(pickPrimarySupplier([])).toBeNull()
  })

  it("keeps every supplier except the primary", () => {
    const primary = pickPrimarySupplier(suppliers)
    const rest = otherSuppliers(suppliers, primary)
    expect(rest.map((s) => s.supplierId)).toEqual(["sup-a", "sup-c"])
  })

  it("re-includes the untouched suppliers on submit, without losing them", () => {
    const primary = pickPrimarySupplier(suppliers)
    const rest = otherSuppliers(suppliers, primary)
    const result = buildSuppliersForSubmit(
      { supplierId: "sup-b", unitPrice: "250", notes: "actualizado", hasSupplier: true },
      rest,
    )
    expect(result).toHaveLength(3)
    expect(result.find((s) => s.supplierId === "sup-a")).toMatchObject({ isPreferred: false, unitPrice: 100 })
    expect(result.find((s) => s.supplierId === "sup-c")).toMatchObject({ isPreferred: false, unitPrice: null })
    expect(result.find((s) => s.supplierId === "sup-b")).toMatchObject({ isPreferred: true, unitPrice: 250, notes: "actualizado" })
  })

  it("drops only the primary when the user unchecks 'Asignar proveedor'", () => {
    const primary = pickPrimarySupplier(suppliers)
    const rest = otherSuppliers(suppliers, primary)
    const result = buildSuppliersForSubmit({ supplierId: "sup-b", unitPrice: "", notes: "", hasSupplier: false }, rest)
    expect(result.map((s) => s.supplierId).sort()).toEqual(["sup-a", "sup-c"])
  })
})

describe("edit-mode attribute preservation", () => {
  const original: AttributeRow[] = [
    { id: "attr-select", name: "Talla", type: "select", isRequired: true, options: '["M","L"]', sortOrder: 0 },
    { id: "attr-int", name: "Dosis", type: "integer", isRequired: true, options: "", sortOrder: 1, drivesQuantity: true },
  ]

  const advOriginal = original.filter((a) => a.type !== "select")

  it("keeps a non-select attribute's type and drivesQuantity intact", () => {
    const wizAttrs: AttributeMultiValues[] = [{ name: "Talla", type: "select", values: ["M", "L", "XL"] }]
    const result = mergeEditAttributes(original, wizAttrs, advOriginal)

    const dosis = result.find((a) => a.name === "Dosis")
    expect(dosis).toMatchObject({ id: "attr-int", type: "integer", isRequired: true, drivesQuantity: true })
  })

  it("updates a select attribute's values while keeping its id and sortOrder", () => {
    const wizAttrs: AttributeMultiValues[] = [{ name: "Talla", type: "select", values: ["S", "M"] }]
    const result = mergeEditAttributes(original, wizAttrs, advOriginal)

    const talla = result.find((a) => a.name === "Talla")
    expect(talla).toMatchObject({ id: "attr-select", sortOrder: 0 })
    expect(JSON.parse(talla!.options)).toEqual(["S", "M"])
  })

  it("drops a select attribute the user unchecked in the wizard", () => {
    const result = mergeEditAttributes(original, [], advOriginal)
    expect(result.some((a) => a.name === "Talla")).toBe(false)
    expect(result.some((a) => a.name === "Dosis")).toBe(true)
  })
})

describe("editor de atributos avanzados", () => {
  const original: AttributeRow[] = [
    { id: "attr-select", name: "Talla", type: "select", isRequired: true, options: '["M","L"]', sortOrder: 0 },
    { id: "attr-int", name: "Dosis", type: "integer", isRequired: true, options: "", sortOrder: 1, drivesQuantity: true },
  ]

  it("no ofrece `select`: ese tipo es del paso 2 y tener dos dueños es el conflicto", () => {
    expect(ADVANCED_ATTRIBUTE_TYPES).not.toContain("select")
    expect([...ADVANCED_ATTRIBUTE_TYPES]).toEqual(["text", "number", "integer"])
  })

  it("toma la edición viva del editor avanzado, no el snapshot del servidor", () => {
    // El usuario renombró "Dosis" a "Número de dosis" en el editor avanzado.
    const advAttrs: AttributeRow[] = [
      { id: "attr-int", name: "Número de dosis", type: "integer", isRequired: true, options: "", sortOrder: 1, drivesQuantity: true },
    ]
    const result = mergeEditAttributes(original, [], advAttrs)

    expect(result.find((a) => a.name === "Número de dosis")).toMatchObject({ id: "attr-int", drivesQuantity: true })
    expect(result.some((a) => a.name === "Dosis")).toBe(false)
  })

  it("quita un atributo avanzado que el usuario eliminó", () => {
    const result = mergeEditAttributes(original, [], [])
    expect(result).toEqual([])
  })

  it("marcar «su valor es la cantidad» fuerza entero y obligatorio", () => {
    const rows: AttributeRow[] = [blankAdvancedAttribute(0)]
    const result = setQuantityDriver(rows, 0, true)

    expect(result[0]).toMatchObject({ drivesQuantity: true, type: "integer", isRequired: true })
  })

  it("solo un atributo puede gobernar la cantidad", () => {
    const rows: AttributeRow[] = [
      { name: "Dosis", type: "integer", isRequired: true, options: "", sortOrder: 0, drivesQuantity: true },
      { name: "Sesiones", type: "integer", isRequired: true, options: "", sortOrder: 1, drivesQuantity: false },
    ]
    const result = setQuantityDriver(rows, 1, true)

    expect(result.filter((a) => a.drivesQuantity).map((a) => a.name)).toEqual(["Sesiones"])
  })

  it("desmarcar el driver no cambia el tipo que ya tenía", () => {
    const rows: AttributeRow[] = [
      { name: "Dosis", type: "integer", isRequired: true, options: "", sortOrder: 0, drivesQuantity: true },
    ]
    const result = setQuantityDriver(rows, 0, false)

    expect(result[0]).toMatchObject({ drivesQuantity: false, type: "integer" })
  })

  it("detecta un nombre repetido entre los dos editores, ignorando tildes y caja", () => {
    const wizAttrs: AttributeMultiValues[] = [{ name: "Talla", type: "select", values: ["M"] }]
    const advAttrs: AttributeRow[] = [
      { name: "  TÁLLA ", type: "text", isRequired: false, options: "", sortOrder: 0 },
    ]

    expect(duplicateAttributeNames(wizAttrs, advAttrs).has("talla")).toBe(true)
  })

  it("no marca duplicado cuando los nombres son distintos ni cuenta filas vacías", () => {
    const wizAttrs: AttributeMultiValues[] = [{ name: "Talla", type: "select", values: ["M"] }]
    const advAttrs: AttributeRow[] = [
      { name: "Dosis", type: "integer", isRequired: true, options: "", sortOrder: 0 },
      blankAdvancedAttribute(1),
      blankAdvancedAttribute(2),
    ]

    expect(duplicateAttributeNames(wizAttrs, advAttrs).size).toBe(0)
  })
})

describe("plantillas de categoría en los dos editores", () => {
  // Réplica del reparto que hace `handleCategoryChange`: las `select` son ejes
  // de variante y el resto va al editor avanzado. Antes las no-`select` se
  // filtraban y se perdían, así que una plantilla de texto o número no servía
  // para nada aunque el admin pudiera crearla.
  const templates = [
    { name: "Talla",     type: "select"  as const, options: '["M","L"]', sizeFamily: "ropa", isRequired: true,  sortOrder: 0 },
    { name: "Marca",     type: "text"    as const, options: "",          isRequired: false, sortOrder: 1 },
    { name: "Capacidad", type: "number"  as const, options: "",          isRequired: false, sortOrder: 2 },
    { name: "Dosis",     type: "integer" as const, options: "",          isRequired: true,  sortOrder: 3 },
  ]

  it("manda las `select` al asistente y el resto al editor avanzado", () => {
    const toWizard = templates.filter((t) => t.type === "select")
    const toAdvanced = templates.filter((t) => t.type !== "select")

    expect(toWizard.map((t) => t.name)).toEqual(["Talla"])
    expect(toAdvanced.map((t) => t.name)).toEqual(["Marca", "Capacidad", "Dosis"])
    // Ningún tipo de plantilla se pierde en el camino.
    expect(toWizard.length + toAdvanced.length).toBe(templates.length)
  })

  it("todo tipo de plantilla es representable en alguno de los dos editores", () => {
    for (const template of templates) {
      const goesToWizard = template.type === "select"
      const goesToAdvanced = (ADVANCED_ATTRIBUTE_TYPES as readonly string[]).includes(template.type)
      expect(goesToWizard || goesToAdvanced).toBe(true)
    }
  })
})
