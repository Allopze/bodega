import { describe, expect, it } from "vitest"
import { mergeFuelControlWorksites, percentVariation } from "./fuel-control-overview.helpers"

describe("mergeFuelControlWorksites", () => {
  it("keeps independent channels separated and sorts by visible activity", () => {
    const rows = mergeFuelControlWorksites({
      billed: [{ worksiteId: "ws-a", worksiteName: "A", liters: 100 }],
      tae: [
        { worksiteId: "ws-a", worksiteName: "A", liters: 40 },
        { worksiteId: "ws-b", worksiteName: "B", liters: 90 },
      ],
      tct: [{ worksiteId: "ws-a", worksiteName: "A", liters: 30 }],
    })

    expect(rows).toEqual([
      { worksiteId: "ws-a", worksiteName: "A", billedLiters: 100, taeLiters: 40, tctLiters: 30 },
      { worksiteId: "ws-b", worksiteName: "B", billedLiters: 0, taeLiters: 90, tctLiters: 0 },
    ])
  })
})
describe("percentVariation", () => {
  it("does not invent a percentage without a previous baseline", () => {
    expect(percentVariation(20, 0)).toBeNull()
    expect(percentVariation(0, 0)).toBe(0)
  })

  it("keeps one decimal of precision", () => {
    expect(percentVariation(115, 100)).toBe(15)
    expect(percentVariation(80, 120)).toBe(-33.3)
  })
})
