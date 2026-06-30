import { describe, expect, it } from "vitest"
import { ALL_MODULE_PERMISSIONS } from "@/modules/permissions"

describe("prevention module RBAC", () => {
  it("registers the seven prevention permissions in the module registry", () => {
    const expected = [
      "prevention:iper:view",
      "prevention:iper:manage",
      "prevention:incidents:view",
      "prevention:incidents:manage",
      "prevention:incidents:close",
      "prevention:training:view",
      "prevention:training:manage",
    ]
    for (const permission of expected) {
      expect(ALL_MODULE_PERMISSIONS).toContain(permission)
    }
  })
})