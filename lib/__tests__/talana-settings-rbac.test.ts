import { describe, expect, it } from "vitest"
import { isSensitiveGrant } from "@/lib/auth/sensitive-permissions"
import { adminModule } from "@/modules/admin/manifest"
import { registry } from "@/modules/registry"

/**
 * Token y modo de la sincronización con Talana (`admin:talana_settings`). El
 * token da lectura de toda la nómina y el modo `apply` modifica fichas de
 * trabajadores, así que es infraestructura: sólo administrador. Ver los
 * resultados (`admin:workers_hr`) no lo implica.
 */
describe("RBAC de la configuración de Talana", () => {
  const PERMISSION = "admin:talana_settings"
  const ID = "p-adm-tlnset"

  it("declara admin:talana_settings con su id y su descripción", () => {
    expect(adminModule.permissions).toContain(PERMISSION)
    expect(adminModule.permissionMeta[PERMISSION]).toEqual({
      id: ID,
      description: "Configurar la integración con Talana (token y modo)",
    })
  })

  it("no duplica el id de permiso con ningún otro del sistema", () => {
    const ids = registry.flatMap((module) =>
      Object.values(module.permissionMeta ?? {}).map((meta) => meta.id))
    expect(ids.filter((id) => id === ID)).toHaveLength(1)
  })

  it("lo entrega de fábrica sólo al administrador", () => {
    const roles = adminModule.defaultGrants
      .filter((grant) => grant.permission === PERMISSION)
      .map((grant) => grant.roleSlug)
    expect(roles).toEqual(["administrador"])
  })

  it("quienes ven la información laboral de Talana no reciben la configuración por defecto", () => {
    const configurers = new Set<string>(
      adminModule.defaultGrants.filter((grant) => grant.permission === PERMISSION).map((grant) => grant.roleSlug),
    )
    const viewers = adminModule.defaultGrants
      .filter((grant) => grant.permission === "admin:workers_hr")
      .map((grant) => grant.roleSlug)
    expect(viewers).toEqual(expect.arrayContaining(["secretaria", "prevencionista", "gerente_legal_rrhh"]))
    for (const slug of viewers.filter((viewer) => viewer !== "administrador")) {
      expect(configurers.has(slug), `${slug} no debería configurar Talana`).toBe(false)
    }
  })

  it("es de administración: sólo un administrador puede concederlo a otro usuario", () => {
    expect(isSensitiveGrant({ name: PERMISSION, module: "admin" })).toBe(true)
  })
})
