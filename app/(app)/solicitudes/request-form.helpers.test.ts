import { describe, expect, it } from "vitest"
import type { ProductOption } from "./request-form.types"
import { quotationRequirementMessage } from "@/lib/requests/quotation-requirement"
import {
  buildAttrsFromProduct, blankItem, buildRequestSummaryIssues, evaluateRequestQuotations,
  parseEstimatedPrice, quotationRuleHint,
} from "./request-form.helpers"

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
    isService: true, requiresWorker: true, equipmentKind: null, unitOfMeasure: "servicio", categoryName: "cat",
    referencePrice: null, familyId: null, preferredSupplierId: null,
    attributes: [{ id: "pa-dosis", name: "Número de dosis", type: "integer", isRequired: true, drivesQuantity: false, options: null }],
  }

  function vacunaItem(overrides: { workerId?: string; dosis?: string } = {}) {
    return {
      ...blankItem(), productId: VACUNA.id, productName: VACUNA.name,
      workerId: overrides.workerId ?? "",
      attributes: [{
        attributeId: "pa-dosis", attributeName: "Número de dosis",
        value: overrides.dosis ?? "", isRequired: true, drivesQuantity: false, type: "integer", options: [],
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
      id: "prod-casco", sku: "EPP-1", name: "Casco", isEpp: true, isService: false, requiresWorker: false, equipmentKind: null,
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
    // Sin umbral informado rige la regla legada, con el mismo texto que el servidor.
    expect(issues).toContain(quotationRequirementMessage("needs_three", null))
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
      isService: false, requiresWorker: false, equipmentKind: null,
      unitOfMeasure: "par",
      categoryName: "EPP",
      referencePrice: null,
      familyId: null,
      preferredSupplierId: null,
      attributes: [
        { id: "attr-size", name: "Talla", type: "select", isRequired: true, drivesQuantity: false, options: "S, M, L" },
        { id: "attr-color", name: "Color", type: "select", isRequired: true, drivesQuantity: false, options: "Negro\nAzul" },
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
      id: "casco-amarillo", sku: "CAS-AMA", name: "Casco", isEpp: true, isService: false, requiresWorker: false, equipmentKind: null,
      unitOfMeasure: "unidad", categoryName: "EPP", referencePrice: null, familyId: null, preferredSupplierId: null,
      attributes: [{ id: "color", name: "Color", type: "select", isRequired: true, drivesQuantity: false, options: '["Amarillo"]' }],
    }

    expect(buildAttrsFromProduct(product)[0]).toMatchObject({ attributeName: "Color", value: "Amarillo" })
  })
})

describe("buildRequestSummaryIssues — umbral de cotizaciones de repuestos", () => {
  const base = { worksiteId: "ws-1", requiredDate: "2026-08-10", requestType: "repuestos", quotationThresholdClp: 500_000 }
  const filtro = (overrides: Partial<ReturnType<typeof blankItem>> = {}) => ({
    ...blankItem(), productNameFree: "Filtro hidráulico", quantity: "2", ...overrides,
  })
  const quotationIssues = (issues: string[]) => issues.filter((issue) => /cotizaci|precio/i.test(issue))

  it("bajo el umbral, sin cotizaciones pero con precio estimado, no hay pendientes", () => {
    const issues = buildRequestSummaryIssues({ ...base, notes: "", items: [filtro({ estimatedUnitPrice: "20000" })] })
    expect(quotationIssues(issues)).toEqual([])
  })

  it("sin cotizaciones ni precio estimado pide una de las dos cosas", () => {
    const issues = buildRequestSummaryIssues({ ...base, notes: "", items: [filtro()] })
    expect(issues).toContain(quotationRequirementMessage("no_quotation_or_estimate", 500_000))
  })

  it("el precio estimado debe estar en todos los ítems", () => {
    const issues = buildRequestSummaryIssues({
      ...base, notes: "",
      items: [filtro({ estimatedUnitPrice: "20000" }), filtro()],
    })
    expect(issues).toContain(quotationRequirementMessage("no_quotation_or_estimate", 500_000))
  })

  it("sobre el umbral sólo con precios estimados pide una cotización y nombra el monto", () => {
    const issues = buildRequestSummaryIssues({ ...base, notes: "", items: [filtro({ estimatedUnitPrice: "900000" })] })
    const message = quotationRequirementMessage("needs_quotation", 500_000)
    expect(issues).toContain(message)
    expect(message).toContain("$500.000")
  })

  it("cuenta las cotizaciones ya guardadas en el borrador, no sólo las que se están subiendo", () => {
    // Al guardar, el formulario saca de `item.cotizaciones` lo que subió: en la
    // ficha del borrador esas cotizaciones llegan como `attachedQuotationTotals`.
    const withoutAttached = buildRequestSummaryIssues({ ...base, notes: "Justificado.", items: [filtro()] })
    expect(withoutAttached).toContain(quotationRequirementMessage("no_quotation_or_estimate", 500_000))

    const withAttached = buildRequestSummaryIssues({
      ...base, notes: "Justificado.", items: [filtro()], attachedQuotationTotals: [150_000],
    })
    expect(quotationIssues(withAttached)).toEqual([])
  })

  it("sobre el umbral con una cotización y notas que lo justifican está en regla", () => {
    const issues = buildRequestSummaryIssues({
      ...base, notes: "Único proveedor en la zona.",
      items: [filtro({ cotizaciones: [makeCotizacion({ totalAmount: "900000" })] })],
    })
    expect(quotationIssues(issues)).toEqual([])
  })

  it("con cotizaciones manda la mayor, no el precio estimado", () => {
    const issues = buildRequestSummaryIssues({
      ...base, notes: "",
      items: [filtro({ estimatedUnitPrice: "1000", cotizaciones: [makeCotizacion({ totalAmount: "800000" })] })],
    })
    expect(issues).toContain(quotationRequirementMessage("needs_three", 500_000))
  })

  it("vía rápida: urgencia crítica con una OT vinculada exige justificar, y con notas queda en regla", () => {
    const item = filtro({ estimatedUnitPrice: "900000", vehicleId: "v-1", workOrderId: "ot-1" })
    const sinNotas = buildRequestSummaryIssues({ ...base, urgency: "critical", notes: "", items: [item] })
    expect(sinNotas).toContain(quotationRequirementMessage("needs_justification", 500_000))
    const conNotas = buildRequestSummaryIssues({ ...base, urgency: "critical", notes: "Camión detenido en faena.", items: [item] })
    expect(quotationIssues(conNotas)).toEqual([])
    // Sin urgencia crítica no hay vía rápida aunque haya OT.
    const normal = buildRequestSummaryIssues({ ...base, urgency: "high", notes: "Camión detenido en faena.", items: [item] })
    expect(normal).toContain(quotationRequirementMessage("needs_quotation", 500_000))
  })

  it("vía rápida también cuando el equipo elegido no está operativo", () => {
    const item = filtro({ estimatedUnitPrice: "900000", vehicleId: "v-1" })
    const operativo = buildRequestSummaryIssues({
      ...base, urgency: "critical", notes: "Detenido.", items: [item], vehicles: [{ id: "v-1", operationalStatus: "operativo" }],
    })
    expect(operativo).toContain(quotationRequirementMessage("needs_quotation", 500_000))
    const detenido = buildRequestSummaryIssues({
      ...base, urgency: "critical", notes: "Detenido.", items: [item], vehicles: [{ id: "v-1", operationalStatus: "mantencion" }],
    })
    expect(quotationIssues(detenido)).toEqual([])
  })

  it("umbral 0 nunca exime: vuelve la regla de 3 cotizaciones", () => {
    const issues = buildRequestSummaryIssues({
      ...base, quotationThresholdClp: 0, notes: "",
      items: [filtro({ estimatedUnitPrice: "1000", cotizaciones: [makeCotizacion({ totalAmount: "1000" })] })],
    })
    expect(issues).toContain(quotationRequirementMessage("needs_three", 0))
  })

  it("servicios conserva la regla legada aunque haya umbral: sin cotización no se envía", () => {
    const issues = buildRequestSummaryIssues({
      ...base, requestType: "servicios", notes: "",
      items: [{ ...blankItem(), productNameFree: "Mantención", estimatedUnitPrice: "20000" }],
    })
    expect(issues).toContain(quotationRequirementMessage("needs_quotation", null))
  })

  it("servicios con 2 cotizaciones y sin notas pide 3 o una justificación", () => {
    const issues = buildRequestSummaryIssues({
      ...base, requestType: "servicios", notes: "",
      items: [{ ...blankItem(), productNameFree: "Mantención", cotizaciones: [makeCotizacion(), makeCotizacion()] }],
    })
    expect(issues).toContain(quotationRequirementMessage("needs_three", null))
  })
})

describe("evaluateRequestQuotations", () => {
  it("no aplica a EPP/otro", () => {
    expect(evaluateRequestQuotations({ items: [blankItem()], requestType: "epp" })).toBeNull()
    expect(evaluateRequestQuotations({ items: [blankItem()] })).toBeNull()
  })

  it("devuelve el umbral aplicado y un mensaje sólo cuando la regla falla", () => {
    const item = { ...blankItem(), productNameFree: "Filtro", estimatedUnitPrice: "20000" }
    expect(evaluateRequestQuotations({ items: [item], requestType: "repuestos", quotationThresholdClp: 500_000 }))
      .toEqual({ thresholdClp: 500_000, message: null })
    expect(evaluateRequestQuotations({ items: [item], requestType: "servicios", quotationThresholdClp: 500_000 }))
      .toEqual({ thresholdClp: null, message: quotationRequirementMessage("needs_quotation", null) })
  })
})

describe("parseEstimatedPrice y quotationRuleHint", () => {
  it("vacío o inválido es «sin precio»; cero sí es un precio", () => {
    expect(parseEstimatedPrice("")).toBeNull()
    expect(parseEstimatedPrice("  ")).toBeNull()
    expect(parseEstimatedPrice("abc")).toBeNull()
    expect(parseEstimatedPrice("-5")).toBeNull()
    expect(parseEstimatedPrice("0")).toBe(0)
    expect(parseEstimatedPrice("35000")).toBe(35_000)
  })

  it("la explicación de la regla nombra el umbral de repuestos y no el de servicios", () => {
    expect(quotationRuleHint("repuestos", 500_000)).toContain("$500.000")
    expect(quotationRuleHint("servicios", null)).toMatch(/Mínimo 3 cotizaciones/)
    expect(quotationRuleHint("repuestos", 0)).toMatch(/Mínimo 3 cotizaciones/)
  })
})
