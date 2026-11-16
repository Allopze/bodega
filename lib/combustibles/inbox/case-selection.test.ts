import { describe, expect, it } from "vitest"
import { summarizeCaseSelection } from "./case-selection"
import type { FuelInboxCaseGroup, FuelInboxCaseMember, FuelInboxOpenCaseStatus } from "./types"

const ME = "u-me"

function member(id: string, status: FuelInboxOpenCaseStatus, assigneeId: string | null = null): FuelInboxCaseMember {
  return { row: { id } as FuelInboxCaseMember["row"], status, assigneeId }
}

function group(ruleCode: string, members: FuelInboxCaseMember[]): FuelInboxCaseGroup {
  return {
    key: `ws|veh|${ruleCode}`, ruleCode, ruleLabel: `Regla ${ruleCode}`, equipmentLabel: "KA-1", vehicleId: "veh", worksiteName: "Pacifico",
    severity: "medium", dueDate: "2026-11-30", waitingSince: "2026-11-01T00:00:00Z", firstMonth: "2026-10", lastMonth: "2026-11", members,
  }
}

describe("qué se puede hacer con los grupos elegidos (paso 4c)", () => {
  it("tomar cuenta los casos sin responsable y los tuyos sin tomar; deja los de otra persona", () => {
    const selection = summarizeCaseSelection([group("salto", [
      member("a", "open"),
      member("b", "reopened", ME),
      member("c", "in_review", ME),
      member("d", "in_review", "u-otra"),
    ])], ME)
    expect(selection).toMatchObject({ groups: 1, cases: 4, takeable: 2, notTaken: 2, heldByOthers: 1 })
    expect(selection.expected).toEqual([
      { id: "a", status: "open", assigneeId: null },
      { id: "b", status: "reopened", assigneeId: ME },
      { id: "c", status: "in_review", assigneeId: ME },
      { id: "d", status: "in_review", assigneeId: "u-otra" },
    ])
  })

  it("resolver exige una misma causa y todos tomados; descartar, sólo la misma causa", () => {
    const taken = summarizeCaseSelection([group("salto", [member("a", "in_review", ME), member("b", "in_review", "u-otra")])], ME)
    expect(taken).toMatchObject({ canResolve: true, canDismiss: true, ruleCode: "salto", ruleLabel: "Regla salto" })

    const pending = summarizeCaseSelection([group("salto", [member("a", "in_review", ME), member("b", "open")])], ME)
    expect(pending).toMatchObject({ canResolve: false, canDismiss: true })

    const mixed = summarizeCaseSelection([group("salto", [member("a", "in_review", ME)]), group("variacion", [member("b", "in_review", ME)])], ME)
    expect(mixed).toMatchObject({ ruleCode: null, canResolve: false, canDismiss: false, takeable: 0 })
  })

  it("sobre el tope de un lote no se ofrece nada", () => {
    const many = Array.from({ length: 201 }, (_, index) => member(`m-${index}`, "in_review", ME))
    expect(summarizeCaseSelection([group("salto", many)], ME)).toMatchObject({ tooMany: true, canResolve: false, canDismiss: false })
    expect(summarizeCaseSelection([group("salto", many.slice(0, 200))], ME)).toMatchObject({ tooMany: false, canResolve: true })
  })

  it("marca las reglas de medidor: en lote se cierran sólo como lectura corregida", () => {
    expect(summarizeCaseSelection([group("kilometraje_regresivo", [member("a", "open")])], ME).meterRule).toBe(true)
    expect(summarizeCaseSelection([group("salto_medidor_implausible", [member("a", "open")])], ME).meterRule).toBe(false)
  })
})
