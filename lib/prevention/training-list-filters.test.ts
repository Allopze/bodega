import { describe, expect, it } from "vitest"
import { isTrainingSessionQuickFilter, matchesTrainingSessionQuickFilter } from "./training-list-filters"

describe("training session quick filters", () => {
  const planned = { status: "planned", attendedCount: 0, acknowledgedCount: 0 }
  const signed = { status: "completed", attendedCount: 3, acknowledgedCount: 3 }
  const missingAcknowledgement = { status: "completed", attendedCount: 3, acknowledgedCount: 2 }

  it("keeps planned sessions and outstanding acknowledgements distinct", () => {
    expect(matchesTrainingSessionQuickFilter(planned, "planned")).toBe(true)
    expect(matchesTrainingSessionQuickFilter(planned, "pending_ack")).toBe(false)
    expect(matchesTrainingSessionQuickFilter(signed, "pending_ack")).toBe(false)
    expect(matchesTrainingSessionQuickFilter(missingAcknowledgement, "pending_ack")).toBe(true)
  })

  it("does not execute unrecognised URL views", () => {
    expect(isTrainingSessionQuickFilter("planned")).toBe(true)
    expect(isTrainingSessionQuickFilter("pending_ack")).toBe(true)
    expect(isTrainingSessionQuickFilter("blocking_gaps")).toBe(false)
    expect(isTrainingSessionQuickFilter("unknown")).toBe(false)
  })
})
