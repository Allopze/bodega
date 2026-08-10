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

  const VACUNA: ProductOption = {
    id: "prod-srv-vacuna", sku: "SRV-VACUNA", name: "Vacuna", isEpp: false,
    isService: true, requiresWorker: true, unitOfMeasure: "servicio", categoryName: "cat",
    referencePrice: null, familyId: null, preferredSupplierId: null,
    attributes: [{ id: "pa-dosis", name: "Número de dosis", type: "integer", isRequired: true, options: null }],
  }

  function vacunaItem(overrides: { workerId?: string; dosis?: string } = {}) {
    return {
      ...blankItem(), productId: VACUNA.id, productName: VACUNA.name,
      workerId: overrides.workerId ?? "",
      attributes: [{
        attributeId: "pa-dosis", attributeName: "Número de dosis",
        value: overrides.dosis ?? "", isRequired: true, type: "integer", options: [],
      }],
    }
  }

  it("avisa por el colaborador y la dosis que faltan en una vacuna", () => {
    const issues = buildRequestSummaryIssues({
      ...base, requestType: "otro", items: [vacunaItem()], products: [VACUNA],
    })
    expect(issues).toContain("Ítem 1: selecciona el colaborador para Vacuna.")
    expect(issues).toContain("Ítem 1: completa Número de dosis.")
  })

  it("avisa por una dosis que no es un entero ≥ 1", () => {
    const issues = buildRequestSummaryIssues({
      ...base, requestType: "otro",
      items: [vacunaItem({ workerId: "w-1", dosis: "2.5" })], products: [VACUNA],
    })
    expect(issues).toContain("Ítem 1: Número de dosis debe ser un número entero mayor o igual a 1.")
  })

  it("no avisa nada cuando la vacuna está completa", () => {
    const issues = buildRequestSummaryIssues({
      ...base, requestType: "otro",
      items: [vacunaItem({ workerId: "w-1", dosis: "2" })], products: [VACUNA],
    })
    expect(issues).toEqual([])
  })

  it("una solicitud mixta sólo reporta el ítem incompleto", () => {
    const casco: ProductOption = {
      id: "prod-casco", sku: "EPP-1", name: "Casco", isEpp: true, isService: false, requiresWorker: false,
      unitOfMeasure: "unidad", categoryName: "cat", referencePrice: null, familyId: null,
      preferredSupplierId: null, attributes: [],
    }
    const issues = buildRequestSummaryIssues({
      ...base, requestType: "otro",
      items: [
        { ...blankItem(), productId: casco.id, productName: casco.name },
        vacunaItem({ workerId: "w-1" }),
      ],
      products: [casco, VACUNA],
    })
    expect(issues).toEqual(["Ítem 2: completa Número de dosis."])
  })

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
      isService: false, requiresWorker: false,
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
      id: "casco-amarillo", sku: "CAS-AMA", name: "Casco", isEpp: true, isService: false, requiresWorker: false,
      unitOfMeasure: "unidad", categoryName: "EPP", referencePrice: null, familyId: null, preferredSupplierId: null,
      attributes: [{ id: "color", name: "Color", type: "select", isRequired: true, options: '["Amarillo"]' }],
    }

    expect(buildAttrsFromProduct(product)[0]).toMatchObject({ attributeName: "Color", value: "Amarillo" })
  })
})
