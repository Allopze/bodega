import { describe, expect, it } from "vitest"
import { riskChecks } from "./risk-checks"
import type { MiperEntrySnapshot } from "./snapshot"

const entry = { id: "e", classification: "intolerable" } as MiperEntrySnapshot
const issue = (field: string) => ({ scope: "entry" as const, entryId: "e", field, message: `falta ${field}`, severity: "error" as const })

describe("riskChecks", () => {
  it("un ítem por bloque, con los mensajes del validador y el paso al que lleva", () => {
    const checks = riskChecks(entry, [issue("hazard"), issue("dueDate"), issue("programLink")])
    expect(checks.map((check) => [check.key, check.ok])).toEqual([["identificacion", false], ["evaluacion", true], ["controlado", true], ["medidas", false], ["programa", false]])
    expect(checks[0]!.messages).toEqual(["falta hazard"])
    expect(checks[3]!.step).toBe("medidas")
  })
  it("el vínculo al programa sólo se chequea en un Intolerable", () => {
    expect(riskChecks({ ...entry, classification: "moderate" }, []).map((check) => check.key)).not.toContain("programa")
  })
})
