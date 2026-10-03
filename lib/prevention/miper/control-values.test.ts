import { describe, expect, it } from "vitest"
import { controlColumns, patchedControlValues } from "./control-values"

const responsible = { responsibleUserId: null, responsibleSnapshot: "Supervisor de turno" }
const pending = { hierarchy: "administrative" as const, description: "Charla de inicio de turno", isExisting: false, verificationFrequency: null, dueDate: "2026-11-30" }
const existing = { hierarchy: "ppe" as const, description: "Uso de casco", isExisting: true, verificationFrequency: "Trimestral", dueDate: null }

describe("controlColumns (D5)", () => {
  it("una existente se guarda sin plazo y una por implementar sin frecuencia, aunque el pedido los traiga", () => {
    expect(controlColumns({ ...pending, isExisting: true, verificationFrequency: " Mensual ", dueDate: "2026-12-31" }, responsible, null))
      .toMatchObject({ isExisting: true, verificationFrequency: "Mensual", dueDate: null })
    expect(controlColumns({ ...existing, isExisting: false, dueDate: "2026-12-31" }, responsible, null))
      .toMatchObject({ isExisting: false, verificationFrequency: null, dueDate: "2026-12-31" })
  })
  it("sin «¿ya está implementada?» ni frecuencia en el pedido, se conservan los de la medida; una nueva nace por implementar", () => {
    expect(controlColumns({ hierarchy: "ppe", description: "Uso de casco" }, responsible, { isExisting: true, verificationFrequency: "Trimestral" }))
      .toMatchObject({ isExisting: true, verificationFrequency: "Trimestral", dueDate: null })
    expect(controlColumns({ hierarchy: "ppe", description: "Uso de casco", dueDate: "2026-11-30" }, responsible, null))
      .toMatchObject({ isExisting: false, verificationFrequency: null, dueDate: "2026-11-30" })
  })
})

describe("patchedControlValues (Fase D)", () => {
  it("lo que el lote no trae sale de la medida; el tipo y la descripción nunca cambian", () => {
    expect(patchedControlValues(pending, {})).toEqual({ ...pending })
    expect(patchedControlValues(pending, { dueDate: "2026-12-31" })).toEqual({ ...pending, dueDate: "2026-12-31" })
    expect(patchedControlValues(existing, { verificationFrequency: null })).toEqual({ ...existing, verificationFrequency: null })
  })
  it("pasado por controlColumns rige D5: un plazo no entra a una existente y pasar a existente borra el plazo", () => {
    const keep = (current: typeof pending | typeof existing) => ({ isExisting: current.isExisting, verificationFrequency: current.verificationFrequency })
    expect(controlColumns(patchedControlValues(existing, { dueDate: "2026-12-31" }), responsible, keep(existing)))
      .toMatchObject({ isExisting: true, verificationFrequency: "Trimestral", dueDate: null })
    expect(controlColumns(patchedControlValues(pending, { isExisting: true, verificationFrequency: "Semestral" }), responsible, keep(pending)))
      .toMatchObject({ isExisting: true, verificationFrequency: "Semestral", dueDate: null })
    expect(controlColumns(patchedControlValues(existing, { isExisting: false, dueDate: "2026-12-31" }), responsible, keep(existing)))
      .toMatchObject({ isExisting: false, verificationFrequency: null, dueDate: "2026-12-31" })
  })
})
