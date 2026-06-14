import type { Session } from "next-auth"
import { describe, expect, it } from "vitest"
import { resolveWorksiteScope } from "@/lib/auth/scope"

function session(roles: string[], worksiteIds: string[] = []): Session {
  return {
    user: {
      id: "user-1",
      name: "User",
      email: "user@example.com",
      roles,
      permissions: [],
      worksiteIds,
      primaryWorksiteId: worksiteIds[0] ?? null,
      avatarColor: null,
      isActive: true,
    },
    expires: "2099-01-01T00:00:00.000Z",
  }
}

describe("worksite scope", () => {
  it("treats global roles as unscoped SQL access", () => {
    expect(resolveWorksiteScope(session(["administrador"]))).toEqual({
      mode: "all",
      ids: [],
    })
  })

  it("carries restricted worksite ids for SQL filters", () => {
    expect(resolveWorksiteScope(session(["solicitante_faena"], ["ws-1", "ws-2"]))).toEqual({
      mode: "some",
      ids: ["ws-1", "ws-2"],
    })
  })

  it("represents restricted users without worksites as a no-rows scope", () => {
    expect(resolveWorksiteScope(session(["solicitante_faena"]))).toEqual({
      mode: "none",
      ids: [],
    })
  })
})
