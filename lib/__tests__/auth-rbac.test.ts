import { describe, expect, it } from "vitest"
import { applyRbacToToken, type UserRbacSnapshot } from "@/lib/auth/rbac"

const activeSnapshot: UserRbacSnapshot = {
  id: "user-1",
  name: "User One",
  email: "user@example.com",
  avatarColor: "120",
  isActive: true,
  isGlobal: true,
  roles: ["administrador"],
  permissions: ["reports:view"],
  worksiteIds: ["ws-1"],
  primaryWorksiteId: "ws-1",
  // AUTH-003: la marca de revocación de sesiones viaja en el snapshot; nula =
  // esta persona nunca restableció su contraseña.
  sessionsValidFrom: null,
}

describe("applyRbacToToken", () => {
  it("hydrates current RBAC fields into the token", () => {
    const token: Record<string, unknown> = {}
    applyRbacToToken(token, activeSnapshot)

    expect(token.roles).toEqual(["administrador"])
    expect(token.permissions).toEqual(["reports:view"])
    expect(token.worksiteIds).toEqual(["ws-1"])
    expect(token.isActive).toBe(true)
  })

  it("strips effective permissions for inactive or missing users", () => {
    const token: Record<string, unknown> = {
      roles: ["administrador"],
      permissions: ["admin:users"],
      worksiteIds: ["ws-1"],
    }

    applyRbacToToken(token, { ...activeSnapshot, isActive: false })

    expect(token.roles).toEqual([])
    expect(token.permissions).toEqual([])
    expect(token.worksiteIds).toEqual([])
    expect(token.primaryWorksiteId).toBeNull()
    expect(token.isActive).toBe(false)
  })
})
