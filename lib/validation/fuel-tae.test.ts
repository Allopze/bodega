import { describe, expect, it } from "vitest"
import { isTaeReviewTransitionAllowed } from "./fuel-tae"

describe("TAE review state machine", () => {
  it("allows operational review paths", () => {
    expect(isTaeReviewTransitionAllowed("submitted", "validated")).toBe(true)
    expect(isTaeReviewTransitionAllowed("submitted", "observed")).toBe(true)
    expect(isTaeReviewTransitionAllowed("observed", "validated")).toBe(true)
    expect(isTaeReviewTransitionAllowed("validated", "observed")).toBe(true)
  })

  it("keeps voided terminal and rejects no-op transitions", () => {
    expect(isTaeReviewTransitionAllowed("voided", "observed")).toBe(false)
    expect(isTaeReviewTransitionAllowed("validated", "validated")).toBe(false)
    expect(isTaeReviewTransitionAllowed("observed", "observed")).toBe(false)
  })
})
