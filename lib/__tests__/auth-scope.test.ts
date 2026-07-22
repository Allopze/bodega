import { describe, expect, it } from "vitest"
import type { Session } from "next-auth"
import {
  isGlobalRole,
  canAccessWorksite,
  visibleWorksiteIds,
  resolveWorksiteScope,
} from "@/lib/auth/scope"

describe("Auth Worksite Scope (scope.ts)", () => {
  it("returns false for null or undefined session", () => {
    expect(isGlobalRole(null)).toBe(false)
    expect(canAccessWorksite(null, "ws-1")).toBe(false)
    expect(visibleWorksiteIds(null)).toEqual([])
    expect(resolveWorksiteScope(null)).toEqual({ mode: "none", ids: [] })
  })

  it("identifies global role using isGlobal flag on session.user", () => {
    const globalSession = {
      user: { id: "u-1", isGlobal: true, worksiteIds: [] },
    } as unknown as Session
    expect(isGlobalRole(globalSession)).toBe(true)
    expect(canAccessWorksite(globalSession, "any-worksite")).toBe(true)
    expect(resolveWorksiteScope(globalSession)).toEqual({ mode: "all", ids: [] })
  })

  it("identifies global role using static fallback GLOBAL_ROLES set", () => {
    const fallbackSession = {
      user: { id: "u-2", roles: ["prevencionista"], worksiteIds: [] },
    } as unknown as Session
    expect(isGlobalRole(fallbackSession)).toBe(true)
    expect(canAccessWorksite(fallbackSession, "ws-faena-99")).toBe(true)
  })

  it("restricts faena-scoped non-global users to their assigned worksiteIds", () => {
    const scopedSession = {
      user: { id: "u-3", isGlobal: false, roles: ["solicitante"], worksiteIds: ["ws-norte", "ws-sur"] },
    } as unknown as Session
    expect(isGlobalRole(scopedSession)).toBe(false)
    expect(canAccessWorksite(scopedSession, "ws-norte")).toBe(true)
    expect(canAccessWorksite(scopedSession, "ws-centro")).toBe(false)
    expect(visibleWorksiteIds(scopedSession)).toEqual(["ws-norte", "ws-sur"])
    expect(resolveWorksiteScope(scopedSession)).toEqual({ mode: "some", ids: ["ws-norte", "ws-sur"] })
  })

  it("handles empty worksiteIds as mode 'none'", () => {
    const restrictedSession = {
      user: { id: "u-4", isGlobal: false, roles: ["solicitante"], worksiteIds: [] },
    } as unknown as Session
    expect(resolveWorksiteScope(restrictedSession)).toEqual({ mode: "none", ids: [] })
  })
})
