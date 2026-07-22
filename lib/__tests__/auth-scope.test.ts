import { describe, expect, it } from "vitest"
import {
  isGlobalRole,
  canAccessWorksite,
  visibleWorksiteIds,
  resolveWorksiteScope,
  worksiteScopeSql,
} from "@/lib/auth/scope"
import { sql } from "drizzle-orm"

describe("Auth Worksite Scope (scope.ts)", () => {
  it("returns false for null or undefined session", () => {
    expect(isGlobalRole(null)).toBe(false)
    expect(canAccessWorksite(null, "ws-1")).toBe(false)
    expect(visibleWorksiteIds(null)).toEqual([])
    expect(resolveWorksiteScope(null)).toEqual({ mode: "none", ids: [] })
  })

  it("identifies global role using isGlobal flag on session.user", () => {
    const globalSession: any = {
      user: { id: "u-1", isGlobal: true, worksiteIds: [] },
    }
    expect(isGlobalRole(globalSession)).toBe(true)
    expect(canAccessWorksite(globalSession, "any-worksite")).toBe(true)
    expect(resolveWorksiteScope(globalSession)).toEqual({ mode: "all", ids: [] })
  })

  it("identifies global role using static fallback GLOBAL_ROLES set", () => {
    const fallbackSession: any = {
      user: { id: "u-2", roles: ["prevencionista"], worksiteIds: [] },
    }
    expect(isGlobalRole(fallbackSession)).toBe(true)
    expect(canAccessWorksite(fallbackSession, "ws-faena-99")).toBe(true)
  })

  it("restricts faena-scoped non-global users to their assigned worksiteIds", () => {
    const scopedSession: any = {
      user: { id: "u-3", isGlobal: false, roles: ["solicitante"], worksiteIds: ["ws-norte", "ws-sur"] },
    }
    expect(isGlobalRole(scopedSession)).toBe(false)
    expect(canAccessWorksite(scopedSession, "ws-norte")).toBe(true)
    expect(canAccessWorksite(scopedSession, "ws-centro")).toBe(false)
    expect(visibleWorksiteIds(scopedSession)).toEqual(["ws-norte", "ws-sur"])
    expect(resolveWorksiteScope(scopedSession)).toEqual({ mode: "some", ids: ["ws-norte", "ws-sur"] })
  })

  it("handles empty worksiteIds as mode 'none'", () => {
    const restrictedSession: any = {
      user: { id: "u-4", isGlobal: false, roles: ["solicitante"], worksiteIds: [] },
    }
    expect(resolveWorksiteScope(restrictedSession)).toEqual({ mode: "none", ids: [] })
  })
})
