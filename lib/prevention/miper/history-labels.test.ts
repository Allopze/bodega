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
  it("la importación distingue una fila de varias y de la matriz entera", () => {
    expect(historyLabel("import_applied", { object: "entry", count: 1 })).toBe("Fila importada desde el RE-04")
    expect(historyLabel("import_applied", { object: "entry", count: 230 })).toBe("230 filas importadas desde el RE-04")
    expect(historyLabel("import_applied", { object: "entry", count: 1200 })).toMatch(/^1\.200 filas importadas/)
    expect(historyLabel("import_applied", { object: "matrix" })).toBe("Importación del RE-04 aplicada")
    expect(historyLabel("import_applied")).toBe("Fila importada desde el RE-04")
  })
  it("en el borde de la página cargada no afirma un número exacto («o más»)", () => {
    expect(historyLabel("import_applied", { object: "entry", count: 50, atLeast: true })).toBe("50 o más filas importadas desde el RE-04")
    expect(historyLabel("entry_updated", { count: 3, atLeast: true })).toBe("3 o más riesgos modificados")
    expect(historyLabel("header_updated", { count: 4, atLeast: true })).toBe("Antecedentes modificados (4 o más veces)")
  })
  it("pluraliza con el conteo y cae a «(n veces)» sin plural propio", () => {
    expect(historyLabel("entry_created", { count: 1 })).toBe("Riesgo agregado")
    expect(historyLabel("entry_created", { count: 3 })).toBe("3 riesgos agregados")
    expect(historyLabel("controls_linked", { count: 2 })).toBe("2 medidas vinculadas a actividades del programa")
    expect(historyLabel("header_updated", { count: 4 })).toBe("Antecedentes modificados (4 veces)")
  })
  it("la capacidad con que actuó se muestra con el nombre del rol", () => {
    expect(ROLE_CONTEXT_TEXT["prevention:risk:approve_legal"]).toBe("Legal y RRHH")
  })
})
