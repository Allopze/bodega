import { describe, expect, it } from "vitest"
import { adminModule } from "@/modules/admin/manifest"
import { registry } from "@/modules/registry"

/**
 * El catálogo de contenedores tiene permiso propio y no cuelga del inventario
 * de emergencias: son dos padrones distintos y hay que poder dar uno sin el
 * otro. Este test fija ese reparto.
 */
describe("RBAC del catálogo de contenedores", () => {
  it("declara admin:containers con su id de permiso", () => {
    expect(adminModule.permissions).toContain("admin:containers")
    expect(Object.keys(adminModule.permissionMeta)).toContain("admin:containers")
    expect(adminModule.permissionMeta["admin:containers"].id).toBe("p-adm-cont")
  })

  it("lo entrega a los mismos roles que mantienen el inventario de faena", () => {
    const roles = adminModule.defaultGrants
      .filter((grant) => grant.permission === "admin:containers")
      .map((grant) => grant.roleSlug)
      .sort()
    expect(roles).toEqual(["administrador", "prevencionista", "secretaria"])
  })

  it("no duplica el id de permiso con ningún otro del sistema", () => {
    const ids = registry.flatMap((module) =>
      Object.values(module.permissionMeta ?? {}).map((meta) => meta.id))
    expect(ids.filter((id) => id === "p-adm-cont")).toHaveLength(1)
  })
})
