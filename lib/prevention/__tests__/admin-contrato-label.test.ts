import { describe, expect, it } from "vitest"
import {
  ADMIN_CONTRATO_DEFAULT_LABEL,
  adminContratoLabel,
  evaluatorRoleLabel,
  ppaResponsibleRoleLabel,
} from "../admin-contrato-label"

describe("adminContratoLabel", () => {
  it("usa el título del contrato de la faena cuando existe", () => {
    expect(adminContratoLabel("Supervisor de faena")).toBe("Supervisor de faena")
  })

  it("cae al nombre por defecto sin faena, en null o en blanco", () => {
    expect(adminContratoLabel()).toBe(ADMIN_CONTRATO_DEFAULT_LABEL)
    expect(adminContratoLabel(null)).toBe(ADMIN_CONTRATO_DEFAULT_LABEL)
    expect(adminContratoLabel("   ")).toBe(ADMIN_CONTRATO_DEFAULT_LABEL)
  })
})

describe("evaluatorRoleLabel", () => {
  it("solo admin_contrato depende de la faena", () => {
    expect(evaluatorRoleLabel("admin_contrato", "Supervisor de faena")).toBe("Supervisor de faena")
    expect(evaluatorRoleLabel("admin_contrato", null)).toBe(ADMIN_CONTRATO_DEFAULT_LABEL)
    expect(evaluatorRoleLabel("prevencionista_faena", "Supervisor de faena")).toBe("Prevencionista de faena")
    expect(evaluatorRoleLabel("conductor_lider", "Supervisor de faena")).toBe("Conductor líder")
  })

  it("nunca devuelve null: un rol desconocido cae a su propio valor", () => {
    expect(evaluatorRoleLabel(null)).toBe("")
    expect(evaluatorRoleLabel("rol_nuevo")).toBe("rol_nuevo")
  })
})

describe("ppaResponsibleRoleLabel", () => {
  it("agrega el vocabulario propio del PPA sobre el de evaluaciones", () => {
    expect(ppaResponsibleRoleLabel("jefe_faena")).toBe("Jefe de faena")
    expect(ppaResponsibleRoleLabel("prevencionista")).toBe("Jefe del Departamento de Prevención de Riesgos")
    expect(ppaResponsibleRoleLabel("admin_contrato", "Supervisor de faena")).toBe("Supervisor de faena")
  })
})
