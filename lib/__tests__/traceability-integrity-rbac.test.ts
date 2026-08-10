import { describe, expect, it } from "vitest"
import { traceabilityModule } from "@/modules/traceability/manifest"

describe("traceability integrity RBAC manifest", () => {
  it("declares and grants the integrity reconciliation permission to administrators", () => {
    expect(traceabilityModule.permissions).toContain("traceability:reconcile_integrity")
    expect(traceabilityModule.permissionMeta).toHaveProperty("traceability:reconcile_integrity")
    expect(traceabilityModule.defaultGrants).toContainEqual({
      roleSlug: "administrador",
      permission: "traceability:reconcile_integrity",
    })
  })
})
