import { describe, expect, it } from "vitest"
import { ROLE_RESPONSIBLE_SLUGS, SHEET_META } from "@/lib/services/pdtp-adapters/sheet-meta-2026"
import { displayNameForSlug } from "@/lib/services/pdtp-adapters/responsible-catalog-2026"
import { SYSTEM_ROLES } from "@/lib/auth/system-rbac"

describe("PDTP role scope", () => {
  it("mapea cada responsable de la planilla a un rol del sistema existente", () => {
    const systemRoleNames = new Set(SYSTEM_ROLES.map((role) => role.name))
    for (const [responsibleSlug, roleName] of ROLE_RESPONSIBLE_SLUGS) {
      expect(systemRoleNames, `${responsibleSlug} apunta a un rol inexistente: ${roleName}`).toContain(roleName)
    }
  })

  it("separa supervisión de jefatura de terreno y de la jefatura general", () => {
    expect(ROLE_RESPONSIBLE_SLUGS.get("sup")).toBe("supervisor_terreno")
    expect(ROLE_RESPONSIBLE_SLUGS.get("jt")).toBe("jefe_terreno")
    expect(ROLE_RESPONSIBLE_SLUGS.get("gerente_legal_rrhh")).toBe("gerente_legal_rrhh")
    expect(ROLE_RESPONSIBLE_SLUGS.get("subgerente_operaciones")).toBe("subgerente_operaciones")
    expect(SHEET_META.sup_jt.defaultScopeRoles).toEqual(["supervisor_terreno", "jefe_terreno"])
  })

  it("usa cargos y no áreas como nombre visible", () => {
    expect(displayNameForSlug("jdpr", "?")).toBe("Jefe del Departamento de Prevención de Riesgos")
    expect(displayNameForSlug("jt", "?")).toBe("Jefe de terreno")
    expect(displayNameForSlug("sup", "?")).toBe("Supervisor de terreno")
    expect(displayNameForSlug("jm", "?")).toBe("Jefe de mantención")
    expect(displayNameForSlug("admin_contrato", "?")).toBe("Administrador de contrato")
    expect(displayNameForSlug("subgerente_operaciones", "?")).toBe("Subgerente de operaciones")
  })

  it("deja el nombre visible del rol del sistema alineado con el del responsable", () => {
    const labelByName = new Map(SYSTEM_ROLES.map((role) => [role.name, role.label]))
    expect(labelByName.get("prevencionista")).toBe(displayNameForSlug("jdpr", "?"))
    expect(labelByName.get("jefe_terreno")).toBe(displayNameForSlug("jt", "?"))
    expect(labelByName.get("supervisor_terreno")).toBe(displayNameForSlug("sup", "?"))
    expect(labelByName.get("jefe_mantencion")).toBe(displayNameForSlug("jm", "?"))
    expect(labelByName.get("admin_contrato")).toBe(displayNameForSlug("admin_contrato", "?"))
    expect(labelByName.get("subgerente_operaciones")).toBe(displayNameForSlug("subgerente_operaciones", "?"))
    expect(labelByName.get("gerente_legal_rrhh")).toBe(displayNameForSlug("gerente_legal_rrhh", "?"))
  })
})
