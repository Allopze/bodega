import { describe, expect, it } from "vitest"
import { matchesCapaQuickFilter } from "./capa-list-filters"

const today = "2026-08-02"

const openAction = {
  status: "in_progress",
  targetDate: "2026-08-01",
  reconciliationStatus: "needs_evidence",
  requiresImmediateStop: true,
}

describe("matchesCapaQuickFilter", () => {
  it("matches the operational metric conditions", () => {
    expect(matchesCapaQuickFilter(openAction, "open", today)).toBe(true)
    expect(matchesCapaQuickFilter(openAction, "overdue", today)).toBe(true)
    expect(matchesCapaQuickFilter(openAction, "unreconciled", today)).toBe(true)
    expect(matchesCapaQuickFilter(openAction, "immediate_stop", today)).toBe(true)
    expect(matchesCapaQuickFilter(openAction, "pending_verification", today)).toBe(false)
  })

  it("does not count closed actions as open, overdue, or urgent", () => {
    const closedAction = { ...openAction, status: "closed" }
    expect(matchesCapaQuickFilter(closedAction, "open", today)).toBe(false)
    expect(matchesCapaQuickFilter(closedAction, "overdue", today)).toBe(false)
    expect(matchesCapaQuickFilter(closedAction, "immediate_stop", today)).toBe(false)
  })

  it("keeps verified actions in the open backlog but out of overdue", () => {
    const verifiedAction = { ...openAction, status: "verified" }
    expect(matchesCapaQuickFilter(verifiedAction, "open", today)).toBe(true)
    expect(matchesCapaQuickFilter(verifiedAction, "overdue", today)).toBe(false)
  })
})
