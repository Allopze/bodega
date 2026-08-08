import { describe, expect, it } from "vitest"
import type { ProductOption } from "./request-form.types"
import { buildAttrsFromProduct, blankItem, buildRequestSummaryIssues } from "./request-form.helpers"

function makeCotizacion(overrides: { totalAmount?: string; supplierId?: string; supplierNameFree?: string } = {}) {
  return {
    _id: crypto.randomUUID(), file: new File(["x"], "cot.pdf"), fileName: "cot.pdf", fileSize: 1,
    totalAmount: "1000", supplierId: "", supplierNameFree: "Proveedor X",
    ...overrides,
  }
}

describe("buildRequestSummaryIssues", () => {
  const base = { worksiteId: "ws-1", requiredDate: "2026-08-10" }

  it("does not require cotizaciones for EPP/otro", () => {
    const issues = buildRequestSummaryIssues({
      ...base, requestType: "epp", notes: "",
      items: [{ ...blankItem(), productId: "prod-1" }],
    })
    expect(issues).not.toContain(expect.stringContaining("cotizaciones"))
  })

  it("flags repuestos/servicios with fewer than 3 cotizaciones and no justification", () => {
    const issues = buildRequestSummaryIssues({
      ...base, requestType: "repuestos", notes: "",
      items: [{ ...blankItem(), productNameFree: "Filtro", cotizaciones: [makeCotizacion(), makeCotizacion()] }],
    })
    expect(issues).toContain("Adjunta 3 cotizaciones o justifica en Notas generales por qué no es posible.")
  })

  it("does not flag repuestos/servicios with 3+ cotizaciones", () => {
    const issues = buildRequestSummaryIssues({
      ...base, requestType: "repuestos", notes: "",
      items: [{ ...blankItem(), productNameFree: "Filtro", cotizaciones: [makeCotizacion(), makeCotizacion(), makeCotizacion()] }],
    })
    expect(issues).not.toContain(expect.stringContaining("cotizaciones"))
  })

  it("does not flag repuestos/servicios with fewer than 3 cotizaciones when notes justify it", () => {
    const issues = buildRequestSummaryIssues({
      ...base, requestType: "servicios", notes: "El único proveedor de la zona.",
      items: [{ ...blankItem(), productNameFree: "Mantención", cotizaciones: [makeCotizacion()] }],
    })
    expect(issues).not.toContain(expect.stringContaining("cotizaciones"))
  })

  it("sums cotizaciones across all items of the same request", () => {
    const issues = buildRequestSummaryIssues({
      ...base, requestType: "repuestos", notes: "",
      items: [
        { ...blankItem("k1"), productNameFree: "Filtro", cotizaciones: [makeCotizacion()] },
        { ...blankItem("k2"), productNameFree: "Correa", cotizaciones: [makeCotizacion(), makeCotizacion()] },
      ],
    })
    expect(issues).not.toContain(expect.stringContaining("cotizaciones"))
  })
})

describe("buildAttrsFromProduct", () => {
  it("accepts legacy comma/newline select options for EPP attributes", () => {
    const product: ProductOption = {
      id: "prod-epp",
      sku: "EPP-001",
      name: "Guante nitrilo",
      isEpp: true,
      unitOfMeasure: "par",
      categoryName: "EPP",
      referencePrice: null,
      familyId: null,
      preferredSupplierId: null,
      attributes: [
        { id: "attr-size", name: "Talla", type: "select", isRequired: true, options: "S, M, L" },
        { id: "attr-color", name: "Color", type: "select", isRequired: true, options: "Negro\nAzul" },
      ],
    }

    const attrs = buildAttrsFromProduct(product)

    expect(attrs).toEqual([
      expect.objectContaining({ attributeName: "Talla", options: ["S", "M", "L"] }),
      expect.objectContaining({ attributeName: "Color", options: ["Negro", "Azul"] }),
    ])
  })

  it("preselects the sole attribute values of a catalog variant", () => {
    const product: ProductOption = {
      id: "casco-amarillo", sku: "CAS-AMA", name: "Casco", isEpp: true,
      unitOfMeasure: "unidad", categoryName: "EPP", referencePrice: null, familyId: null, preferredSupplierId: null,
      attributes: [{ id: "color", name: "Color", type: "select", isRequired: true, options: '["Amarillo"]' }],
    }

    expect(buildAttrsFromProduct(product)[0]).toMatchObject({ attributeName: "Color", value: "Amarillo" })
  })
})
