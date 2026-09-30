import { describe, expect, it } from "vitest"
import { ACTING_AS_TEXT, historyLabel } from "./history-labels"

describe("rótulos del historial MIPER", () => {
  it("cada evento del flujo tiene un rótulo en español", () => {
    for (const type of ["created", "header_updated", "entry_created", "entry_updated", "entry_deleted", "control_created", "submitted", "opened", "returned", "technical_approved", "corrections_requested", "version_sealed", "observation_created", "observation_answered", "observation_resolved", "superseded", "deleted"]) {
      expect(historyLabel(type)).not.toBe(type)
    }
    expect(historyLabel("version_sealed")).toBe("Aprobada y sellada por Legal y RRHH")
  })
  it("un evento desconocido no se muestra crudo como enum", () => {
    expect(historyLabel("algo_nuevo")).toBe("Cambio registrado")
  })
  it("la capacidad con que actuó se muestra con el nombre del rol", () => {
    expect(ACTING_AS_TEXT["prevention:risk:approve_legal"]).toBe("Legal y RRHH")
  })
})
