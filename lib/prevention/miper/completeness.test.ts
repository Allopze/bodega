import { describe, expect, it } from "vitest"
import { checkMiperCompleteness, issuesByEntry } from "./completeness"
import type { MiperEntrySnapshot, MiperSnapshot } from "./snapshot"

const header: MiperSnapshot["header"] = {
  period: 2026, iperCode: "RE-04", elaboratedOn: "2026-04-30", updatedOn: "2026-05-02",
  companyName: "Chome", companyRut: "78.023.530-6", companyAddress: "Lagart 175", companyCommune: "Cabrero",
  economicActivity: "Transporte", adherentNumber: null, worksiteName: "Biodiversa",
  siteRepresentativeUserId: "u1", siteRepresentativeName: "JP", headcountTotal: 16, headcountMale: 14, headcountFemale: 2, headcountOther: 0,
  participationSummary: "", consultationEvidenceReference: "",
}

function row(over: Partial<MiperEntrySnapshot>): MiperEntrySnapshot {
  return {
    id: "e1", rowNumber: 1, activity: "A", task: "T", position: "P", location: null,
    exposedFemale: 0, exposedMale: 1, exposedOther: 0, riskFactorId: "rf", riskFactor: "Mecánico", isRoutine: true,
    hazard: "H", risk: "R", probableDamage: "D", probability: 1, consequence: 2, magnitude: 2, classification: "tolerable",
    controlledStatus: "no", controls: [], ...over,
  }
}
const control = { id: "c1", hierarchy: "administrative" as const, description: "Procedimiento", responsibleUserId: null, responsibleName: "Supervisor", dueDate: "2026-12-31", status: "proposed" }

const errors = (snapshot: MiperSnapshot, opts?: Parameters<typeof checkMiperCompleteness>[1]) =>
  checkMiperCompleteness(snapshot, opts).filter((i) => i.severity === "error")

describe("completitud RE-04 (§5.1)", () => {
  it("una matriz completa y tolerable sin medidas no tiene errores", () => {
    expect(errors({ header, entries: [row({})] })).toEqual([])
  })
  it("una matriz sin filas no se puede enviar", () => {
    expect(errors({ header, entries: [] }).map((i) => i.field)).toContain("entries")
  })
  it("encabezado: actualización antes de elaboración y dotación que no suma", () => {
    const fields = errors({ header: { ...header, updatedOn: "2026-01-01", headcountMale: 10 }, entries: [row({})] }).map((i) => i.field)
    expect(fields).toEqual(expect.arrayContaining(["updatedOn", "headcountTotal"]))
  })
  it("fila incompleta: exige P, C, factor, peligro, riesgo, daño, actividad, tarea, puesto y controlado", () => {
    const fields = errors({ header, entries: [row({ probability: null, riskFactorId: null, hazard: null, controlledStatus: null, task: null })] }).map((i) => i.field)
    expect(fields).toEqual(expect.arrayContaining(["probability", "riskFactorId", "hazard", "controlledStatus", "task"]))
  })
  it("'Sí' o 'Parcialmente' controlado exige al menos una medida", () => {
    expect(errors({ header, entries: [row({ controlledStatus: "yes" })] }).map((i) => i.field)).toContain("controls")
    expect(errors({ header, entries: [row({ controlledStatus: "partial", controls: [control] })] })).toEqual([])
  })
  it("Importante: exige medida, y si no está controlado, una con responsable y plazo", () => {
    const important = row({ probability: 2, consequence: 4, magnitude: 8, classification: "important", controlledStatus: "no" })
    expect(errors({ header, entries: [important] }).map((i) => i.field)).toContain("controls")
    const noDeadline = { ...important, controls: [{ ...control, dueDate: null }] }
    expect(errors({ header, entries: [noDeadline] }).map((i) => i.field)).toContain("dueDate")
    expect(errors({ header, entries: [{ ...important, controls: [control] }] })).toEqual([])
  })
  it("Intolerable: exige medida con responsable y plazo; el vínculo al programa sólo si se pide", () => {
    const intolerable = row({ probability: 4, consequence: 4, magnitude: 16, classification: "intolerable", controlledStatus: "no", controls: [control] })
    expect(errors({ header, entries: [intolerable] })).toEqual([])
    expect(checkMiperCompleteness({ header, entries: [intolerable] }).some((i) => i.severity === "warning" && i.field === "classification")).toBe(true)
    expect(errors({ header, entries: [intolerable] }, { requireProgramLink: true, linkedControlIds: new Set() }).map((i) => i.field)).toContain("programLink")
    expect(errors({ header, entries: [intolerable] }, { requireProgramLink: true, linkedControlIds: new Set(["c1"]) })).toEqual([])
  })
  it("toda medida exige descripción, tipo y plazo; responsable salvo en Tolerable", () => {
    const moderate = row({ probability: 2, consequence: 2, magnitude: 4, classification: "moderate", controlledStatus: "partial", controls: [{ ...control, responsibleName: null, dueDate: null }] })
    const fields = errors({ header, entries: [moderate] }).map((i) => i.field)
    expect(fields).toEqual(expect.arrayContaining(["responsible", "dueDate"]))
    const tolerable = row({ controlledStatus: "yes", controls: [{ ...control, responsibleName: null }] })
    expect(errors({ header, entries: [tolerable] })).toEqual([])
  })
  it("agrupa los problemas por fila", () => {
    const issues = checkMiperCompleteness({ header, entries: [row({ hazard: null })] })
    expect(issuesByEntry(issues).get("e1")?.length).toBeGreaterThan(0)
  })
  it("D5: una medida existente no pide plazo; una por implementar, sí (y una foto vieja se lee como por implementar)", () => {
    const moderate = row({ probability: 2, consequence: 2, magnitude: 4, classification: "moderate", controlledStatus: "partial" })
    const existing = { ...control, dueDate: null, isExisting: true, verificationFrequency: "Trimestral" }
    expect(errors({ header, entries: [{ ...moderate, controls: [existing] }] })).toEqual([])
    // Sin frecuencia también vale: D5 pide tipo, descripción y responsable.
    expect(errors({ header, entries: [{ ...moderate, controls: [{ ...existing, verificationFrequency: null }] }] })).toEqual([])
    expect(errors({ header, entries: [{ ...moderate, controls: [{ ...control, dueDate: null, isExisting: false }] }] }).map((i) => [i.field, i.message]))
      .toEqual([["dueDate", "La medida por implementar necesita un plazo."]])
    // `control` no trae `isExisting`: es la forma de una foto sellada antes de la Fase C.
    expect(errors({ header, entries: [{ ...moderate, controls: [{ ...control, dueDate: null }] }] }).map((i) => i.field)).toEqual(["dueDate"])
  })
  it("una medida existente sigue pidiendo responsable, salvo en un Tolerable", () => {
    const moderate = row({ probability: 2, consequence: 2, magnitude: 4, classification: "moderate", controlledStatus: "partial" })
    const existing = { ...control, dueDate: null, isExisting: true, responsibleName: null }
    expect(errors({ header, entries: [{ ...moderate, controls: [existing] }] }).map((i) => i.field)).toEqual(["responsible"])
    expect(errors({ header, entries: [row({ controlledStatus: "yes", controls: [existing] })] })).toEqual([])
  })
  it("regla crítica: un Importante no controlado y un Intolerable exigen una medida POR IMPLEMENTAR con responsable y plazo", () => {
    const important = row({ probability: 2, consequence: 4, magnitude: 8, classification: "important", controlledStatus: "partial" })
    const existing = { ...control, id: "c-ex", dueDate: null, isExisting: true, verificationFrequency: "Trimestral" }
    const toImplement = { ...control, id: "c-new", dueDate: "2026-12-31", isExisting: false }
    expect(errors({ header, entries: [{ ...important, controls: [existing] }] }).map((i) => [i.field, i.message]))
      .toEqual([["dueDate", "Un riesgo Importante no controlado exige una medida por implementar con responsable y plazo."]])
    expect(errors({ header, entries: [{ ...important, controls: [existing, toImplement] }] })).toEqual([])
    // Por implementar pero sin responsable: no cuenta, y además la medida pide su responsable.
    expect(errors({ header, entries: [{ ...important, controls: [existing, { ...toImplement, responsibleName: null }] }] }).map((i) => i.field))
      .toEqual(["dueDate", "responsible"])
    // Un Importante «Sí, controlado» con medidas existentes ya cumple.
    expect(errors({ header, entries: [{ ...important, controlledStatus: "yes", controls: [existing] }] })).toEqual([])
    const intolerable = row({ probability: 4, consequence: 4, magnitude: 16, classification: "intolerable", controlledStatus: "yes", controls: [existing] })
    expect(errors({ header, entries: [intolerable] }).map((i) => i.message)).toEqual(["Un riesgo Intolerable exige una medida por implementar con responsable y plazo."])
    expect(errors({ header, entries: [{ ...intolerable, controls: [existing, toImplement] }] })).toEqual([])
  })
})
