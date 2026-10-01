import { describe, expect, it } from "vitest"
import { ROLE_CONTEXT_TEXT, historyLabel } from "./history-labels"

describe("rótulos del historial MIPER", () => {
  it("cada evento del flujo tiene un rótulo en español", () => {
    for (const type of ["created", "header_updated", "entry_created", "entry_updated", "entry_deleted", "control_created", "submitted", "opened", "returned", "technical_approved", "corrections_requested", "version_sealed", "observation_created", "observation_answered", "observation_resolved", "superseded", "deleted"]) {
      expect(historyLabel(type)).not.toBe(type)
    }
    expect(historyLabel("version_sealed")).toBe("Aprobada y sellada por Legal y RRHH")
  })
  it("los eventos del Programa de Trabajo también, sin caer en el genérico", () => {
    for (const type of ["program_header_updated", "action_created", "action_updated", "action_retired", "controls_linked", "controls_unlinked", "occurrence_done", "occurrence_not_done", "occurrence_record_voided", "evidence_added", "evidence_withdrawn"]) {
      expect(historyLabel(type)).not.toBe("Cambio registrado")
    }
    expect(historyLabel("occurrence_not_done")).toBe("Ocurrencia registrada: no se hizo")
  })
  it("un evento desconocido no se muestra crudo como enum", () => {
    expect(historyLabel("algo_nuevo")).toBe("Cambio registrado")
  })
  it("la capacidad con que actuó se muestra con el nombre del rol", () => {
    expect(ROLE_CONTEXT_TEXT["prevention:risk:approve_legal"]).toBe("Legal y RRHH")
  })
})
