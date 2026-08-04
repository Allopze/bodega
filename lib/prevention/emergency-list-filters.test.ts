import { describe, expect, it } from "vitest"
import { isEmergencyListTab, isEmergencyQuickFilter, resolveEmergencyQuickFilter } from "./emergency-list-filters"

describe("emergency list quick filters", () => {
  it("keeps plan and drill views on their own list", () => {
    expect(resolveEmergencyQuickFilter("plans", "approved")).toBe("approved")
    expect(resolveEmergencyQuickFilter("plans", "needs_improvement")).toBe("all")
    expect(resolveEmergencyQuickFilter("drills", "completed")).toBe("completed")
    expect(resolveEmergencyQuickFilter("drills", "draft")).toBe("all")
  })

  it("accepts only declared URL state", () => {
    expect(isEmergencyListTab("drills")).toBe(true)
    expect(isEmergencyListTab("summary")).toBe(false)
    expect(isEmergencyQuickFilter("needs_improvement")).toBe(true)
    expect(isEmergencyQuickFilter("unknown")).toBe(false)
  })
})
