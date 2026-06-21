import { describe, it, expect } from "vitest"
import { scopeToIds } from "@/lib/ppa/utils"
import type { WorksiteScope } from "@/lib/auth/scope"

describe("scopeToIds", () => {
  it('returns "all" when scope.mode is "all"', () => {
    const scope: WorksiteScope = { mode: "all", ids: [] }
    expect(scopeToIds(scope)).toBe("all")
  })

  it('returns empty array when scope.mode is "none"', () => {
    const scope: WorksiteScope = { mode: "none", ids: [] }
    expect(scopeToIds(scope)).toEqual([])
  })

  it("returns scope.ids when mode is \"some\"", () => {
    const scope: WorksiteScope = { mode: "some", ids: ["ws-1", "ws-2"] }
    expect(scopeToIds(scope)).toEqual(["ws-1", "ws-2"])
  })

  it("returns empty array when mode is \"some\" but ids is empty", () => {
    const scope: WorksiteScope = { mode: "some", ids: [] }
    expect(scopeToIds(scope)).toEqual([])
  })

  it("returns a single-element array when mode is \"some\" with one id", () => {
    const scope: WorksiteScope = { mode: "some", ids: ["ws-1"] }
    expect(scopeToIds(scope)).toEqual(["ws-1"])
  })
})
