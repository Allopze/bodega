import { describe, expect, it } from "vitest"
import {
  estimatedRequestTotal,
  evaluateQuotationRequirement,
  fastPathCoversRequest,
  quotationRequirementMessage,
  type QuotationRequirementInput,
} from "./quotation-requirement"

const base: QuotationRequirementInput = {
  quotationTotals: [],
  estimatedTotal: null,
  thresholdClp: 500_000,
  urgency: "normal",
  fastPathEligible: false,
  hasJustification: false,
}

describe("estimatedRequestTotal", () => {
  it("suma cantidad × precio estimado", () => {
    expect(estimatedRequestTotal([
      { quantity: 2, estimatedUnitPrice: 10_000 },
      { quantity: 1, estimatedUnitPrice: 5_000 },
    ])).toBe(25_000)
  })

  it("es null si a algún ítem le falta el precio o no hay ítems", () => {
    expect(estimatedRequestTotal([{ quantity: 2, estimatedUnitPrice: 10_000 }, { quantity: 1, estimatedUnitPrice: null }])).toBeNull()
    expect(estimatedRequestTotal([])).toBeNull()
  })
})

describe("evaluateQuotationRequirement · repuestos", () => {
  it("bajo umbral sin cotizaciones pero con estimados → ok", () => {
    expect(evaluateQuotationRequirement({ ...base, estimatedTotal: 20_000 })).toEqual({ ok: true })
  })

  it("bajo umbral con una sola cotización y sin notas → ok", () => {
    expect(evaluateQuotationRequirement({ ...base, quotationTotals: [480_000] })).toEqual({ ok: true })
  })

  it("sin cotizaciones ni estimados → no_quotation_or_estimate", () => {
    expect(evaluateQuotationRequirement(base)).toEqual({ ok: false, reason: "no_quotation_or_estimate" })
  })

  it("con cotizaciones manda la mayor contra el umbral", () => {
    expect(evaluateQuotationRequirement({ ...base, quotationTotals: [100_000, 600_000] }))
      .toEqual({ ok: false, reason: "needs_three" })
  })

  it("sobre umbral con 1 cotización y notas → ok", () => {
    expect(evaluateQuotationRequirement({ ...base, quotationTotals: [900_000], hasJustification: true })).toEqual({ ok: true })
  })

  it("sobre umbral con 3 cotizaciones y sin notas → ok", () => {
    expect(evaluateQuotationRequirement({ ...base, quotationTotals: [900_000, 950_000, 1_000_000] })).toEqual({ ok: true })
  })

  it("sobre umbral sólo estimados sin vía rápida → needs_quotation", () => {
    expect(evaluateQuotationRequirement({ ...base, estimatedTotal: 900_000, hasJustification: true }))
      .toEqual({ ok: false, reason: "needs_quotation" })
  })

  it("vía rápida con estimados y notas → ok aunque supere el umbral", () => {
    expect(evaluateQuotationRequirement({
      ...base, estimatedTotal: 2_000_000, urgency: "critical", fastPathEligible: true, hasJustification: true,
    })).toEqual({ ok: true })
  })

  it("vía rápida sin notas → needs_justification", () => {
    expect(evaluateQuotationRequirement({
      ...base, estimatedTotal: 2_000_000, urgency: "critical", fastPathEligible: true,
    })).toEqual({ ok: false, reason: "needs_justification" })
  })

  it("urgencia crítica sin equipo detenido ni OT no abre la vía rápida", () => {
    expect(evaluateQuotationRequirement({
      ...base, estimatedTotal: 2_000_000, urgency: "critical", fastPathEligible: false, hasJustification: true,
    })).toEqual({ ok: false, reason: "needs_quotation" })
  })

  it("umbral 0 nunca exime", () => {
    expect(evaluateQuotationRequirement({ ...base, thresholdClp: 0, estimatedTotal: 1_000 }))
      .toEqual({ ok: false, reason: "needs_quotation" })
    expect(evaluateQuotationRequirement({ ...base, thresholdClp: 0, quotationTotals: [1_000] }))
      .toEqual({ ok: false, reason: "needs_three" })
  })
})

describe("evaluateQuotationRequirement · servicios (threshold null)", () => {
  const servicios = { ...base, thresholdClp: null }

  it("servicios con 2 cotizaciones y sin notas → needs_three", () => {
    expect(evaluateQuotationRequirement({ ...servicios, quotationTotals: [1_000, 2_000] }))
      .toEqual({ ok: false, reason: "needs_three" })
  })

  it("servicios sin cotización no se exime con estimados ni con la vía rápida", () => {
    expect(evaluateQuotationRequirement({
      ...servicios, estimatedTotal: 1_000, urgency: "critical", fastPathEligible: true, hasJustification: true,
    })).toEqual({ ok: false, reason: "needs_quotation" })
  })

  it("servicios con 1 cotización y notas → ok", () => {
    expect(evaluateQuotationRequirement({ ...servicios, quotationTotals: [1_000], hasJustification: true })).toEqual({ ok: true })
  })
})

describe("quotationRequirementMessage", () => {
  it("nombra el umbral cuando lo hay", () => {
    expect(quotationRequirementMessage("needs_quotation", 500_000)).toMatch(/^Sobre \$500\.000 se necesita al menos una cotización adjunta\.$/)
  })

  it("conserva los textos legados sin umbral", () => {
    expect(quotationRequirementMessage("needs_quotation", null)).toBe("Adjunta al menos una cotización antes de enviar la solicitud.")
    expect(quotationRequirementMessage("needs_three", null)).toBe(
      "Se requieren al menos 3 cotizaciones. Si no es posible, agrega una justificación en las notas de la solicitud.",
    )
  })
})

describe("fastPathCoversRequest", () => {
  const rapido = { quantity: 1, estimatedUnitPrice: 15_000, fastPath: true }
  const normal = (price: number | null) => ({ quantity: 1, estimatedUnitPrice: price, fastPath: false })

  it("sin ningún ítem de vía rápida no cubre", () => {
    expect(fastPathCoversRequest([normal(1_000)], 200_000)).toBe(false)
    expect(fastPathCoversRequest([], 200_000)).toBe(false)
  })

  it("con todos los ítems de vía rápida cubre", () => {
    expect(fastPathCoversRequest([rapido, rapido], 200_000)).toBe(true)
    expect(fastPathCoversRequest([rapido], null)).toBe(true)
  })

  it("un ítem de vía rápida no arrastra a otro sobre el umbral o sin precio", () => {
    expect(fastPathCoversRequest([rapido, normal(2_000_000)], 200_000)).toBe(false)
    expect(fastPathCoversRequest([rapido, normal(null)], 200_000)).toBe(false)
  })

  it("cubre si los ítems fuera de la vía rápida suman, por sí solos, bajo el umbral", () => {
    expect(fastPathCoversRequest([rapido, normal(20_000), normal(30_000)], 200_000)).toBe(true)
    expect(fastPathCoversRequest([rapido, normal(150_000), normal(60_000)], 200_000)).toBe(false)
  })

  it("con umbral 0 o sin umbral los ítems fuera de la vía rápida nunca quedan bajo él", () => {
    expect(fastPathCoversRequest([rapido, normal(1)], 0)).toBe(false)
    expect(fastPathCoversRequest([rapido, normal(1)], null)).toBe(false)
  })
})
