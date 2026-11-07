import { describe, expect, it } from "vitest"
import { quotationRequirementMessage } from "@/lib/requests/quotation-requirement"
import { buildRequirementHint } from "./requirement-hint"

const base = {
  requestType: "repuestos", status: "submitted", urgency: "normal", notes: null as string | null, thresholdClp: 500_000,
  quotationTotals: [] as number[],
  items: [{ quantity: 2, estimatedUnitPrice: 20_000 as number | null, vehicleId: null as string | null, workOrderId: null as string | null }],
  vehicleStatusById: new Map<string, string>(),
}

describe("buildRequirementHint", () => {
  it("repuestos bajo el umbral: avisa que la jefatura puede aprobar con una cotización o sin ella", () => {
    expect(buildRequirementHint(base)).toBe("Bajo $500.000: la jefatura puede aprobar con una cotización o sin ella.")
  })

  it("con cotizaciones manda la mayor: sobre el umbral no hay aviso de exención", () => {
    const hint = buildRequirementHint({ ...base, quotationTotals: [900_000], notes: "Único proveedor." })
    expect(hint).toBeNull()
  })

  it("si la regla falla, entrega el mensaje del servidor con el monto", () => {
    const hint = buildRequirementHint({
      ...base, status: "draft",
      items: [{ ...base.items[0]!, estimatedUnitPrice: 900_000 }],
    })
    expect(hint).toBe(quotationRequirementMessage("needs_quotation", 500_000))
    expect(hint).toContain("$500.000")
  })

  it("sin cotizaciones ni precios estimados pide una de las dos cosas", () => {
    const hint = buildRequirementHint({
      ...base, status: "draft",
      items: [{ ...base.items[0]!, estimatedUnitPrice: null }],
    })
    expect(hint).toBe(quotationRequirementMessage("no_quotation_or_estimate", 500_000))
  })

  it("vía rápida: urgencia crítica con una OT vinculada y sin notas pide justificar", () => {
    const hint = buildRequirementHint({
      ...base, status: "draft", urgency: "critical",
      items: [{ ...base.items[0]!, estimatedUnitPrice: 900_000, vehicleId: "v-1", workOrderId: "ot-1" }],
    })
    expect(hint).toBe(quotationRequirementMessage("needs_justification", 500_000))
  })

  it("el equipo que no está operativo habilita la vía rápida", () => {
    const hint = buildRequirementHint({
      ...base, status: "draft", urgency: "critical", notes: "Equipo detenido en faena.",
      items: [{ ...base.items[0]!, estimatedUnitPrice: 900_000, vehicleId: "v-1" }],
      vehicleStatusById: new Map([["v-1", "mantencion"]]),
    })
    expect(hint).toBeNull()
  })

  it("umbral 0 nunca exime: sin aviso de exención", () => {
    expect(buildRequirementHint({ ...base, thresholdClp: 0, quotationTotals: [1_000, 1_000, 1_000] })).toBeNull()
  })

  it("servicios usa la regla legada: sin cotización, falla con el mensaje sin umbral", () => {
    const hint = buildRequirementHint({ ...base, requestType: "servicios", status: "draft" })
    expect(hint).toBe(quotationRequirementMessage("needs_quotation", null))
  })

  it("servicios con una cotización y sin umbral no recibe aviso de exención", () => {
    expect(buildRequirementHint({ ...base, requestType: "servicios", quotationTotals: [1_000], notes: "Único." })).toBeNull()
  })

  it("una solicitud ya aprobada, o de otro tipo, no recibe texto", () => {
    expect(buildRequirementHint({ ...base, status: "approved" })).toBeNull()
    expect(buildRequirementHint({ ...base, status: "closed" })).toBeNull()
    expect(buildRequirementHint({ ...base, requestType: "epp" })).toBeNull()
  })
})
