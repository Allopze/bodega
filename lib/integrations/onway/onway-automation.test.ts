import { describe, expect, it } from "vitest"
import { onwayCapaPolicy } from "./onway-automation"

describe("onway CAPA policy", () => {
  it("uses conservative due dates without requesting operational stop", () => {
    expect(onwayCapaPolicy("critical")).toEqual({ priority: "critical", dueInDays: 1 })
    expect(onwayCapaPolicy("high")).toEqual({ priority: "high", dueInDays: 7 })
    expect(onwayCapaPolicy(null)).toEqual({ priority: "medium", dueInDays: 14 })
  })
})
