import { describe, expect, it } from "vitest"
import { adminModule } from "@/modules/admin/manifest"
import { registry } from "@/modules/registry"

/**
 * El catálogo de tipos de activo TI vive bajo un permiso `admin:*` propio
 * (no un `ti:*`), igual que `admin:fleet_catalog` o `admin:worker_positions`:
 * administrar qué categorías de activo existen es una tarea de catálogo
 * administrativo, separada de operar el inventario día a día.
 */
describe("RBAC del catálogo de tipos de activo TI", () => {
  it("declara admin:it_asset_types con su id de permiso", () => {
    expect(adminModule.permissions).toContain("admin:it_asset_types")
    expect(Object.keys(adminModule.permissionMeta)).toContain("admin:it_asset_types")
    expect(adminModule.permissionMeta["admin:it_asset_types"].id).toBe("p-adm-itat")
  })

  it("lo entrega a quien administra el sistema y a técnico TI", () => {
    const roles = adminModule.defaultGrants
      .filter((grant) => grant.permission === "admin:it_asset_types")
      .map((grant) => grant.roleSlug)
      .sort()
    expect(roles).toEqual(["administrador", "tecnico_ti"])
  })

  it("no duplica el id de permiso con ningún otro del sistema", () => {
    const ids = registry.flatMap((module) =>
      Object.values(module.permissionMeta ?? {}).map((meta) => meta.id))
    expect(ids.filter((id) => id === "p-adm-itat")).toHaveLength(1)
  })
})
