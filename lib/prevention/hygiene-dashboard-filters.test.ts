import { describe, expect, it } from "vitest"
import {
  isHygieneDashboardTab,
  isHygieneQuickFilter,
  matchesHygieneGroupQuickFilter,
  matchesHygieneProgramQuickFilter,
} from "./hygiene-dashboard-filters"

describe("hygiene dashboard filters", () => {
  const surveillance = { surveillanceRequired: true, latestOutcome: "above_limit" }
  const noDeclaredLimit = { surveillanceRequired: false, latestOutcome: "not_comparable" }

  it("maps each group KPI to its own operational condition", () => {
    expect(matchesHygieneGroupQuickFilter(surveillance, "surveillance")).toBe(true)
    expect(matchesHygieneGroupQuickFilter(surveillance, "above_limit")).toBe(true)
    expect(matchesHygieneGroupQuickFilter(surveillance, "not_comparable")).toBe(false)
    expect(matchesHygieneGroupQuickFilter(noDeclaredLimit, "not_comparable")).toBe(true)
    expect(matchesHygieneGroupQuickFilter(noDeclaredLimit, "overdue")).toBe(false)
  })

  it("filters overdue programs and validates URL state", () => {
    expect(matchesHygieneProgramQuickFilter({ overdue: 1 }, "overdue")).toBe(true)
    expect(matchesHygieneProgramQuickFilter({ overdue: 0 }, "overdue")).toBe(false)
    expect(isHygieneDashboardTab("summary")).toBe(true)
    expect(isHygieneDashboardTab("unknown")).toBe(false)
    expect(isHygieneQuickFilter("above_limit")).toBe(true)
    expect(isHygieneQuickFilter("unknown")).toBe(false)
  })
})
