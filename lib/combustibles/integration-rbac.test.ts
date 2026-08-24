import { describe, expect, it } from "vitest"
import { combustiblesModule } from "@/modules/combustibles/manifest"

describe("combustibles integration permissions", () => {
  it("declares separate permissions for running and managing global integrations", () => {
    expect(combustiblesModule.permissions).toEqual(expect.arrayContaining([
      "combustibles:sync_integrations",
      "combustibles:manage_integrations",
    ]))
  })

  it("grants global integration controls only to global operational roles", () => {
    for (const permission of ["combustibles:sync_integrations", "combustibles:manage_integrations"] as const) {
      const roles = combustiblesModule.defaultGrants
        .filter((grant) => grant.permission === permission)
        .map((grant) => grant.roleSlug)
      expect(roles).toEqual(expect.arrayContaining(["administrador"]))
      expect(roles).not.toContain("admin_contrato")
    }
  })
})
