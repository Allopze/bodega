import { describe, expect, it } from "vitest"
import { ADMIN_AREAS } from "@/components/layout/admin-nav"
import { GLOBAL_ROLES } from "@/lib/auth/scope"
import { isSensitiveGrant } from "@/lib/auth/sensitive-permissions"
import { SYSTEM_ROLES } from "@/lib/auth/system-rbac"
import { adminModule } from "@/modules/admin/manifest"
import { registry } from "@/modules/registry"

/**
 * La información laboral de Talana (tipo de contrato, término, licencias
 * médicas) tiene permiso propio: ver a un trabajador no da derecho a ver su
 * situación contractual. Este test fija quién lo recibe de fábrica.
 */
describe("RBAC de la información laboral de Talana", () => {
  const PERMISSION = "admin:workers_hr"

  it("declara admin:workers_hr con su id de permiso", () => {
    expect(adminModule.permissions).toContain(PERMISSION)
    expect(Object.keys(adminModule.permissionMeta)).toContain(PERMISSION)
    expect(adminModule.permissionMeta[PERMISSION].id).toBe("p-adm-wrkhr")
  })

  it("no duplica el id de permiso con ningún otro del sistema", () => {
    const ids = registry.flatMap((module) =>
      Object.values(module.permissionMeta ?? {}).map((meta) => meta.id))
    expect(ids.filter((id) => id === "p-adm-wrkhr")).toHaveLength(1)
  })

  it("lo entrega sólo a administración, secretaría, prevención y legal/RR. HH.", () => {
    const roles = adminModule.defaultGrants
      .filter((grant) => grant.permission === PERMISSION)
      .map((grant) => grant.roleSlug)
      .sort()
    expect(roles).toEqual(["administrador", "gerente_legal_rrhh", "prevencionista", "secretaria"])
  })

  it("lo entrega únicamente a roles de alcance global, nunca a los acotados a una faena", () => {
    const roles = adminModule.defaultGrants
      .filter((grant) => grant.permission === PERMISSION)
      .map((grant) => grant.roleSlug)
    for (const slug of roles) {
      expect(GLOBAL_ROLES.has(slug), `${slug} no es un rol global`).toBe(true)
      expect(SYSTEM_ROLES.find((role) => role.name === slug)?.isGlobal, `${slug} no es global en SYSTEM_ROLES`).toBe(true)
    }
    expect(roles).not.toContain("solicitante_faena")
    expect(roles).not.toContain("prevencionista_faena")
  })

  it("es de administración: sólo un administrador puede concederlo a otro usuario", () => {
    expect(isSensitiveGrant({ name: PERMISSION, module: "admin" })).toBe(true)
  })

  it("abre la pantalla /admin/talana desde la navegación de administración", () => {
    const item = ADMIN_AREAS.flatMap((area) => area.items).find((entry) => entry.href === "/admin/talana")
    expect(item?.permissions).toEqual([PERMISSION])
  })
})
