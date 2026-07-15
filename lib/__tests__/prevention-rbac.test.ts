import { describe, expect, it } from "vitest"
import { ALL_MODULE_PERMISSIONS } from "@/modules/permissions"
import { preventionModule } from "@/modules/prevention/manifest"

describe("prevention module RBAC", () => {
  it("registers current pdtp and docs permissions", () => {
    const expected = [
      "prevention:pdtp:view",
      "prevention:pdtp:execute",
      "prevention:pdtp:program:manage",
      "prevention:pdtp:approve",
      "prevention:pdtp:sign_legal",
      "prevention:docs:view",
      "prevention:docs:manage",
      "prevention:docs:archive",
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
      "prevention:docs:approve",
      "prevention:docs:ack",
      "prevention:docs:link",
      "prevention:pdtp:manage",
    ]
    for (const permission of deleted) {
      expect(ALL_MODULE_PERMISSIONS).not.toContain(permission)
    }
  })

  it("grants execution in terreno and centralizes program administration", () => {
    const rolesFor = (permission: string) => preventionModule.defaultGrants
      .filter((grant) => grant.permission === permission)
      .map((grant) => grant.roleSlug)
      .sort()

    expect(rolesFor("prevention:pdtp:execute")).toEqual([
      "admin_contrato",
      "administrador",
      "jefe_terreno",
      "prevencionista",
      "prevencionista_faena",
    ])
    expect(rolesFor("prevention:pdtp:program:manage")).toEqual([
      "administrador",
      "prevencionista",
    ])
  })
})
