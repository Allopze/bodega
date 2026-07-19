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
      "prevention:docs:submit_review",
      "prevention:docs:review",
      "prevention:docs:approve",
      "prevention:docs:publish",
      "prevention:docs:distribute",
      "prevention:docs:ack",
      "prevention:docs:link",
      "prevention:docs:archive",
      "prevention:docs:manage_sensitive",
      "prevention:docs:manage_restricted",
      "prevention:health:view_restrictions",
      "prevention:health:view_clinical",
      "prevention:health:manage_surveillance",
      "prevention:health:upload_clinical",
      "prevention:reserved_case:view",
      "prevention:reserved_case:investigate",
      "prevention:privacy:audit",
      "prevention:privacy:manage_requests",
      "prevention:privacy:export_subject",
      "prevention:capa:view",
      "prevention:capa:manage",
      "prevention:capa:complete",
      "prevention:capa:verify",
      "prevention:capa:close",
      "prevention:capa:override_segregation",
      "prevention:capa:reconcile",
      "prevention:incidents:view",
      "prevention:incidents:report",
      "prevention:incidents:triage",
      "prevention:incidents:investigate",
      "prevention:incidents:notify",
      "prevention:incidents:authorize_restart",
      "prevention:incidents:close",
      "prevention:incidents:export",
      "prevention:risk:view",
      "prevention:risk:edit",
      "prevention:risk:review",
      "prevention:risk:approve",
      "prevention:risk:publish",
      "prevention:legal:view",
      "prevention:legal:assess",
      "prevention:legal:approve_applicability",
      "prevention:legal:export",
    ]
    for (const permission of expected) {
      expect(ALL_MODULE_PERMISSIONS).toContain(permission)
    }
  })

  it("does not register deleted feature permissions", () => {
    const deleted = [
      "prevention:iper:view",
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

  it("separates document preparation from approval/publication and restricts sensitive files", () => {
    const rolesFor = (permission: string) => preventionModule.defaultGrants
      .filter((grant) => grant.permission === permission)
      .map((grant) => grant.roleSlug)
      .sort()

    expect(rolesFor("prevention:docs:submit_review")).toEqual([
      "administrador",
      "prevencionista",
      "prevencionista_faena",
    ])
    expect(rolesFor("prevention:docs:approve")).toEqual(["administrador", "jefa_chome"])
    expect(rolesFor("prevention:docs:publish")).toEqual(["administrador", "jefa_chome"])
    expect(rolesFor("prevention:docs:manage_sensitive")).toEqual(["administrador", "jefa_chome"])
  })

  it("does not grant clinical or reserved-case access through general prevention roles", () => {
    const rolesFor = (permission: string) => preventionModule.defaultGrants
      .filter((grant) => grant.permission === permission)
      .map((grant) => grant.roleSlug)

    expect(rolesFor("prevention:health:view_clinical")).toEqual([])
    expect(rolesFor("prevention:health:upload_clinical")).toEqual([])
    expect(rolesFor("prevention:health:manage_surveillance")).toEqual([])
    expect(rolesFor("prevention:reserved_case:view")).toEqual([])
    expect(rolesFor("prevention:reserved_case:investigate")).toEqual([])
    expect(rolesFor("prevention:privacy:manage_requests").sort()).toEqual(["administrador", "jefa_chome"])
    expect(rolesFor("prevention:privacy:export_subject")).toEqual(["administrador"])
  })

  it("separates CAPA implementation, verification, closure and overrides", () => {
    const rolesFor = (permission: string) => preventionModule.defaultGrants
      .filter((grant) => grant.permission === permission)
      .map((grant) => grant.roleSlug)
      .sort()

    expect(rolesFor("prevention:capa:complete")).toEqual([
      "administrador", "jefa_chome", "prevencionista", "prevencionista_faena",
    ])
    expect(rolesFor("prevention:capa:verify")).toEqual(["administrador", "jefa_chome", "prevencionista"])
    expect(rolesFor("prevention:capa:close")).toEqual(["administrador", "jefa_chome"])
    expect(rolesFor("prevention:capa:override_segregation")).toEqual(["administrador"])
    expect(rolesFor("prevention:capa:reconcile")).toEqual(["administrador"])
  })
})
