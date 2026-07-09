import { describe, expect, it } from "vitest"
import { ROLE_RESPONSIBLE_SLUGS, SHEET_META } from "@/lib/services/pdtp/constants"

describe("PDTP role scope", () => {
  it("uses jefe_terreno for the supervision sheet without a separate supervisor_faena role", () => {
    expect(SHEET_META.sup_jt.defaultScopeRoles).toEqual(["jefe_terreno"])
    expect([...ROLE_RESPONSIBLE_SLUGS.values()]).not.toContain("supervisor_faena")
    expect(ROLE_RESPONSIBLE_SLUGS.get("sup")).toBe("jefe_terreno")
  })
})
