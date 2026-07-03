import { describe, expect, it } from "vitest"
import { ALL_MODULE_PERMISSIONS } from "@/modules/permissions"

describe("prevention module RBAC", () => {
  it("registers only pdtp and docs permissions", () => {
    const expected = [
      "prevention:pdtp:view",
      "prevention:pdtp:manage",
      "prevention:pdtp:approve",
      "prevention:pdtp:sign_legal",
      "prevention:docs:view",
      "prevention:docs:manage",
      "prevention:docs:approve",
      "prevention:docs:archive",
      "prevention:docs:ack",
      "prevention:docs:link",
      "prevention:docs:manage_sensitive",
      "prevention:docs:manage_restricted",
    ]
    for (const permission of expected) {
      expect(ALL_MODULE_PERMISSIONS).toContain(permission)
    }
  })

  it("does not register deleted feature permissions", () => {
    const deleted = [
      "prevention:iper:view",
      "prevention:incidents:view",
      "prevention:training:view",
      "prevention:inspections:view",
      "prevention:alcohol_tests:view",
      "prevention:equipment_reports:view",
      "prevention:health:view",
      "prevention:epp_matrix:view",
      "prevention:emergency:view",
      "prevention:kpis:view",
      "prevention:contractors:view",
      "prevention:cphs:view",
      "prevention:permits:view",
      "prevention:docs:export",
    ]
    for (const permission of deleted) {
      expect(ALL_MODULE_PERMISSIONS).not.toContain(permission)
    }
  })
})
