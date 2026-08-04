import { describe, expect, it } from "vitest"
import { requiresWorksiteAssignment } from "./role-scope"

describe("requiresWorksiteAssignment", () => {
  it("identifies roles whose access must be bounded to a worksite", () => {
    expect(requiresWorksiteAssignment("prevencionista_faena")).toBe(true)
    expect(requiresWorksiteAssignment("administrador")).toBe(false)
  })
})
