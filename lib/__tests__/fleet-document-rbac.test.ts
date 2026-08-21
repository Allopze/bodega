import { describe, expect, it } from "vitest"
import { flotaModule } from "@/modules/flota/manifest"

describe("flota document RBAC", () => {
  it("declara gestión documental separada de la lectura", () => {
    expect(flotaModule.permissions).toContain("flota:manage_documents")
    expect(flotaModule.permissionMeta).toHaveProperty("flota:manage_documents")
    expect(flotaModule.nav[0].items[0].permissions).toEqual(["flota:view"])
  })

  it("mantiene el grant documental en los roles operativos que antes gestionaban con flota:view", () => {
    const roles = flotaModule.defaultGrants
      .filter((grant) => grant.permission === "flota:manage_documents")
      .map((grant) => grant.roleSlug)

    expect(roles).toEqual(expect.arrayContaining(["administrador", "jefe_mantencion", "jefa_chome"]))
  })
})
