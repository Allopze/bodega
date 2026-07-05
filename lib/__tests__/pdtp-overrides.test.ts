import { describe, expect, it } from "vitest"
import { applyOverridesToSchedule } from "@/lib/services/pdtp/overrides"
import type { PdtpActivitySchedule, PdtpActivityScheduleOverride } from "@/db/schema"

const makeSchedule = (overrides: Array<Partial<PdtpActivitySchedule>>): PdtpActivitySchedule[] =>
  overrides.map((cell, i) => ({
    id: `s-${i}`,
    activityId: "act-1",
    year: 2026,
    month: 1,
    week: 1,
    plannedQuantity: 1,
    sourceColumn: "xlsx",
    ...cell,
  })) as PdtpActivitySchedule[]

const makeOverride = (overrides: Array<Partial<PdtpActivityScheduleOverride>>): PdtpActivityScheduleOverride[] =>
  overrides.map((cell, i) => ({
    id: `ov-${i}`,
    activityId: "act-1",
    worksiteId: "ws-1",
    year: 2026,
    month: 1,
    week: 1,
    plannedQuantity: 5,
    updatedByUserId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...cell,
  })) as PdtpActivityScheduleOverride[]

describe("applyOverridesToSchedule", () => {
  it("returns the global schedule unchanged when there are no overrides", () => {
    const global = makeSchedule([{ month: 3, week: 1, plannedQuantity: 1 }])
    const result = applyOverridesToSchedule(global, [])
    expect(result).toEqual(global)
  })

  it("prefers the override over the global cell for matching activity/year/month/week", () => {
    const global = makeSchedule([{ month: 3, week: 1, plannedQuantity: 1 }])
    const overrides = makeOverride([{ month: 3, week: 1, plannedQuantity: 4 }])
    const result = applyOverridesToSchedule(global, overrides)
    expect(result).toHaveLength(1)
    expect(result[0]!.plannedQuantity).toBe(4)
    expect(result[0]!.sourceColumn).toMatch(/^override:/)
  })

  it("adds an override-only cell that did not exist in the global schedule", () => {
    const global = makeSchedule([{ month: 3, week: 1, plannedQuantity: 1 }])
    const overrides = makeOverride([{ month: 5, week: 2, plannedQuantity: 7 }])
    const result = applyOverridesToSchedule(global, overrides)
    expect(result).toHaveLength(2)
    const byMonth = new Map(result.map((c) => [c.month, c]))
    expect(byMonth.get(3)!.plannedQuantity).toBe(1)
    expect(byMonth.get(5)!.plannedQuantity).toBe(7)
  })

  it("does not duplicate cells when an override matches a global cell", () => {
    const global = makeSchedule([{ month: 7, week: 2, plannedQuantity: 2 }])
    const overrides = makeOverride([{ month: 7, week: 2, plannedQuantity: 9 }])
    const result = applyOverridesToSchedule(global, overrides)
    expect(result).toHaveLength(1)
    expect(result[0]!.plannedQuantity).toBe(9)
  })

  it("leaves untouched cells at their global value", () => {
    const global = makeSchedule([
      { month: 1, week: 1, plannedQuantity: 1 },
      { month: 2, week: 1, plannedQuantity: 1 },
    ])
    const overrides = makeOverride([{ month: 2, week: 1, plannedQuantity: 3 }])
    const result = applyOverridesToSchedule(global, overrides)
    const byMonth = new Map(result.map((c) => [c.month, c]))
    expect(byMonth.get(1)!.plannedQuantity).toBe(1)
    expect(byMonth.get(2)!.plannedQuantity).toBe(3)
  })
})
