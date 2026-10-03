import { describe, expect, it } from "vitest"
import type { CompletenessIssue } from "./completeness"
import { errorCountByStep, firstPendingBySeverity, firstStepWithErrors, isEditorStep, nextPendingId, siblingsInTask, stepOfField } from "./entry-navigation"
import type { MiperEntrySnapshot } from "./snapshot"

const row = (id: string, rowNumber: number, overrides: Partial<MiperEntrySnapshot> = {}) => ({
  id, rowNumber, activity: "A", task: "T", position: null, location: null, exposedFemale: 0, exposedMale: 0, exposedOther: 0,
  riskFactorId: null, riskFactor: null, isRoutine: null, hazard: null, risk: null, probableDamage: null, probability: null,
  consequence: null, magnitude: null, classification: null, controlledStatus: null, controls: [], ...overrides,
}) as MiperEntrySnapshot
const issue = (field: string, severity: "error" | "warning" = "error"): CompletenessIssue => ({ scope: "entry", entryId: "e", field, message: field, severity })

describe("pasos del editor", () => {
  it("asigna cada campo del validador a su paso", () => {
    expect(stepOfField("hazard")).toBe("identificacion")
    expect(stepOfField("consequence")).toBe("evaluacion")
    expect(stepOfField("dueDate")).toBe("medidas")
    expect(stepOfField("programLink")).toBe("seguimiento")
    expect(stepOfField("desconocido")).toBe("medidas")
  })
  it("abre en el primer paso con errores; sin errores, en Identificación; ignora advertencias", () => {
    expect(firstStepWithErrors([issue("controls"), issue("probability")])).toBe("evaluacion")
    expect(firstStepWithErrors([issue("classification", "warning")])).toBe("identificacion")
    expect(errorCountByStep([issue("controls"), issue("dueDate"), issue("hazard")])).toEqual({ identificacion: 1, evaluacion: 0, medidas: 2, seguimiento: 0 })
  })
  it("valida el paso que viene en la URL", () => {
    expect(isEditorStep("medidas")).toBe(true)
    expect(isEditorStep("x")).toBe(false)
    expect(isEditorStep(null)).toBe(false)
  })
})

describe("recorrido", () => {
  const rows = [row("a", 1), row("b", 2, { task: "Otra" }), row("c", 3), row("d", 4)]
  it("anterior y siguiente dentro de la misma tarea, por N°", () => {
    expect(siblingsInTask(rows, "c")).toEqual({ previousId: "a", nextId: "d", position: 2, total: 3 })
    expect(siblingsInTask(rows, "zzz")).toBeNull()
  })
  it("siguiente pendiente: el próximo por N°, da la vuelta y respeta el filtro", () => {
    const incomplete = new Set(["a", "b", "d"])
    expect(nextPendingId(rows, "b", incomplete, null)).toBe("d")
    expect(nextPendingId(rows, "d", incomplete, null)).toBe("a")
    expect(nextPendingId(rows, "a", incomplete, new Set(["d"]))).toBe("d")
    expect(nextPendingId(rows, "a", new Set(["a"]), null)).toBeNull()
  })
  it("primer pendiente por gravedad y luego por N°", () => {
    const graded = [row("a", 1, { classification: "moderate" }), row("b", 2, { classification: "intolerable" }), row("c", 3, { classification: "intolerable" }), row("d", 4)]
    expect(firstPendingBySeverity(graded, new Set(["a", "c", "d"]))).toBe("c")
    expect(firstPendingBySeverity(graded, new Set())).toBeNull()
  })
  it("sin riesgo actual (desde la matriz) empieza por el primer pendiente por N°, respetando el filtro", () => {
    expect(nextPendingId(rows, null, new Set(["c", "b"]), null)).toBe("b")
    expect(nextPendingId(rows, null, new Set(["c", "b"]), new Set(["c"]))).toBe("c")
    expect(nextPendingId(rows, null, new Set(), null)).toBeNull()
  })
})
