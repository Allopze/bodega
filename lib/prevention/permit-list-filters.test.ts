import { describe, expect, it } from "vitest"
import { isPermitQuickFilter, matchesPermitQuickFilter } from "./permit-list-filters"

describe("permit quick filters", () => {
  const active = { status: "active", openIsolationCount: 0 }
  const pendingWithIsolation = { status: "pending_approval", openIsolationCount: 1 }
  const suspended = { status: "suspended", openIsolationCount: 0 }

  it("keeps each metric attached to its own business condition", () => {
    expect(matchesPermitQuickFilter(active, "active")).toBe(true)
    expect(matchesPermitQuickFilter(active, "pending")).toBe(false)
    expect(matchesPermitQuickFilter(pendingWithIsolation, "pending")).toBe(true)
    expect(matchesPermitQuickFilter(pendingWithIsolation, "isolations")).toBe(true)
    expect(matchesPermitQuickFilter(suspended, "suspended")).toBe(true)
    expect(matchesPermitQuickFilter(suspended, "all")).toBe(true)
  })

  it("accepts only views that the list can execute", () => {
    expect(isPermitQuickFilter("suspended")).toBe(true)
    expect(isPermitQuickFilter("active")).toBe(true)
    expect(isPermitQuickFilter("unknown")).toBe(false)
    expect(isPermitQuickFilter(null)).toBe(false)
  })
})
