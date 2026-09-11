import { describe, expect, it } from "vitest"
import { adminModule } from "@/modules/admin/manifest"
import { registry } from "@/modules/registry"

/**
 * El catálogo maestro de desviaciones tiene permiso propio y no cuelga de
 * `prevention:inspections:manage`: declarar qué desviaciones existen en la
 * organización es transversal, y elegir cuáles ofrece un instrumento es
 * calibrarlo. Son dos actos y hay que poder dar uno sin el otro. Este test fija
 * ese reparto.
 */
describe("RBAC del catálogo maestro de desviaciones", () => {
  it("declara admin:deviation_catalog con su id de permiso", () => {
    expect(adminModule.permissions).toContain("admin:deviation_catalog")
    expect(Object.keys(adminModule.permissionMeta)).toContain("admin:deviation_catalog")
    expect(adminModule.permissionMeta["admin:deviation_catalog"].id).toBe("p-adm-dev")
  })

  it("lo entrega a quien administra y a quien calibra los instrumentos", () => {
    const roles = adminModule.defaultGrants
      .filter((grant) => grant.permission === "admin:deviation_catalog")
      .map((grant) => grant.roleSlug)
      .sort()
    expect(roles).toEqual(["administrador", "prevencionista"])
  })

  it("no duplica el id de permiso con ningún otro del sistema", () => {
    const ids = registry.flatMap((module) =>
      Object.values(module.permissionMeta ?? {}).map((meta) => meta.id))
    expect(ids.filter((id) => id === "p-adm-dev")).toHaveLength(1)
  })
})
