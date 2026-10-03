import { describe, expect, it } from "vitest"
import { impactSummary, newlyIncomplete, withAddedControl, withControlPatch } from "./bulk-impact"
import { applyEntryValues } from "./entry-values"
import type { MiperControlSnapshot, MiperEntrySnapshot } from "./snapshot"

/** Un riesgo completo: todos los campos, sin medidas y «No» controlado (un Moderado no exige medidas). */
const entry = (id: string, rowNumber: number, overrides: Partial<MiperEntrySnapshot> = {}): MiperEntrySnapshot => ({
  id, rowNumber, activity: "Bodega", task: "Trasvasije", position: "Bodeguero", location: null, exposedFemale: 0, exposedMale: 2, exposedOther: 0,
  riskFactorId: "rf-1", riskFactor: "Químico", isRoutine: true, hazard: "Solvente", risk: "Inhalación", probableDamage: "Intoxicación",
  probability: 2, consequence: 2, magnitude: 4, classification: "moderate", controlledStatus: "no", controls: [], ...overrides,
})
const pending: MiperControlSnapshot = { id: "c-pend", hierarchy: "engineering", description: "Extracción localizada", responsibleUserId: null, responsibleName: "Supervisor", dueDate: "2026-11-30", status: "proposed", isExisting: false, verificationFrequency: null }
const nameOf = (userId: string) => (userId === "u-1" ? "Ana Pérez" : null)

describe("newlyIncomplete: lo que una acción masiva deja con pendientes nuevos", () => {
  it("una medida por implementar sin plazo es un pendiente nuevo; una existente con responsable, no (D5)", () => {
    const before = [entry("a", 1)]
    const sinPlazo = before.map((item) => withAddedControl(item, { hierarchy: "administrative", description: "Charla de trasvasije", responsibleName: "Supervisor", isExisting: false }, nameOf))
    expect(newlyIncomplete(before, sinPlazo).map((item) => item.id)).toEqual(["a"])
    const existente = before.map((item) => withAddedControl(item, { hierarchy: "administrative", description: "Charla de trasvasije", responsibleUserId: "u-1", isExisting: true, verificationFrequency: "Mensual", dueDate: "2026-12-31" }, nameOf))
    expect(newlyIncomplete(before, existente)).toEqual([])
    // D5: la existente nace sin plazo aunque el pedido lo traiga, y propuesta.
    expect(existente[0]!.controls[0]).toMatchObject({ isExisting: true, verificationFrequency: "Mensual", dueDate: null, responsibleName: "Ana Pérez", status: "proposed" })
  })

  it("marcar «ya implementada» la única medida por implementar de un Intolerable rompe la regla crítica", () => {
    const intolerable = entry("b", 2, { probability: 4, consequence: 4, magnitude: 16, classification: "intolerable", controls: [pending] })
    expect(newlyIncomplete([intolerable], [intolerable])).toEqual([])
    const after = withControlPatch(intolerable, new Set(["c-pend"]), { isExisting: true, verificationFrequency: "Trimestral" }, nameOf)
    expect(after.controls[0]).toMatchObject({ isExisting: true, verificationFrequency: "Trimestral", dueDate: null })
    expect(newlyIncomplete([intolerable], [after]).map((item) => item.rowNumber)).toEqual([2])
  })

  it("un plazo en lote no entra a una medida existente (D5) y una medida fuera del lote no cambia", () => {
    const existing = { ...pending, id: "c-ex", isExisting: true, verificationFrequency: "Trimestral", dueDate: null }
    const both = entry("c", 3, { controls: [existing, { ...pending, dueDate: null }] })
    const after = withControlPatch(both, new Set(["c-ex", "c-pend"]), { dueDate: "2026-12-31", responsible: { kind: "user", userId: "u-1" } }, nameOf)
    expect(after.controls.map((control) => [control.id, control.dueDate, control.responsibleName])).toEqual([["c-ex", null, "Ana Pérez"], ["c-pend", "2026-12-31", "Ana Pérez"]])
    expect(withControlPatch(both, new Set(["otra"]), { dueDate: "2026-12-31" }, nameOf)).toBe(both)
  })

  it("«Sí, controlado» sin medidas es un pendiente nuevo; ya pendiente por lo mismo, no se cuenta dos veces", () => {
    const sinMedidas = entry("d", 4)
    expect(newlyIncomplete([sinMedidas], [applyEntryValues(sinMedidas, { controlledStatus: "yes" }, [])]).map((item) => item.id)).toEqual(["d"])
    const yaPendiente = entry("e", 5, { controlledStatus: "yes" })
    expect(newlyIncomplete([yaPendiente], [applyEntryValues(yaPendiente, { controlledStatus: "partial" }, [])])).toEqual([])
  })
})

describe("impactSummary", () => {
  it("nombra los riesgos por N°, en orden, y resume los que no caben", () => {
    expect(impactSummary([])).toBeNull()
    expect(impactSummary([entry("x", 7)])).toBe("1 riesgo queda con pendientes nuevos: #7.")
    expect(impactSummary([entry("y", 9), entry("x", 4), entry("z", 7)])).toBe("3 riesgos quedan con pendientes nuevos: #4, #7 y #9.")
    expect(impactSummary(Array.from({ length: 12 }, (_, index) => entry(`r${index}`, index + 1)))).toBe("12 riesgos quedan con pendientes nuevos: #1, #2, #3, #4, #5 y 7 más.")
  })
})
