import { describe, expect, it } from "vitest"
import { warehouseModule } from "@/modules/warehouse/manifest"

describe("traceability integrity RBAC manifest", () => {
  it("declares and grants the integrity reconciliation and traceability view permissions", () => {
    expect(warehouseModule.permissions).toContain("warehouse:reconcile_integrity")
    expect(warehouseModule.permissionMeta).toHaveProperty("warehouse:reconcile_integrity")
    expect(warehouseModule.defaultGrants).toContainEqual({
      roleSlug: "administrador",
      permission: "warehouse:reconcile_integrity",
    })

    expect(warehouseModule.permissions).toContain("warehouse:view_traceability")
    expect(warehouseModule.permissionMeta).toHaveProperty("warehouse:view_traceability")
    expect(warehouseModule.defaultGrants).toContainEqual({
      roleSlug: "administrador",
      permission: "warehouse:view_traceability",
    })
  })
})
