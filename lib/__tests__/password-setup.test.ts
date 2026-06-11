import { describe, expect, it } from "vitest"
import { createPendingPasswordMarker, displayNameFromEmail, isPasswordSetupPending } from "@/lib/auth/password-setup"

describe("password setup helpers", () => {
  it("creates pending markers that are detectable but unique", () => {
    const first = createPendingPasswordMarker()
    const second = createPendingPasswordMarker()

    expect(isPasswordSetupPending(first)).toBe(true)
    expect(isPasswordSetupPending(second)).toBe(true)
    expect(first).not.toBe(second)
  })

  it("derives a readable display name from an email", () => {
    expect(displayNameFromEmail("juan.perez@chome.cl")).toBe("Juan Perez")
  })
})
