import { describe, expect, it } from "vitest"
import {
  expandPdtpScheduleDefinition,
  getPdtpIsoWeek,
  listPdtpIsoWeeksIntersectingMonth,
  assertPdtpScheduleDefinitionWithinPeriod,
  type PdtpScheduleDefinition,
} from "@/lib/services/pdtp/schedule-definition"

describe("PDTP schedule definitions", () => {
  it("expands a one-time date and keeps the civil date stable", () => {
    const definition: PdtpScheduleDefinition = { version: 1, kind: "one_time", date: "2027-05-15" }
    expect(expandPdtpScheduleDefinition(definition, { startDate: "2027-01-01", endDate: "2027-12-31" })).toEqual([
      { scheduledFor: "2027-05-15", isoWeekYear: 2027, isoWeek: 19, plannedQuantity: 1 },
    ])
  })

  it("expands a recurring monthly activity and clamps an impossible day to month end", () => {
    const definition: PdtpScheduleDefinition = {
      version: 1,
      kind: "recurring",
      startDate: "2028-01-31",
      endDate: "2028-04-30",
      every: 1,
      unit: "month",
      dayOfMonth: 31,
    }
    expect(expandPdtpScheduleDefinition(definition, { startDate: "2028-01-01", endDate: "2028-12-31" }).map((item) => item.scheduledFor))
      .toEqual(["2028-01-31", "2028-02-29", "2028-03-31", "2028-04-30"])
  })

  it("supports every X days and never emits dates outside the program period", () => {
    const definition: PdtpScheduleDefinition = {
      version: 1,
      kind: "recurring",
      startDate: "2027-01-01",
      endDate: "2027-01-31",
      every: 10,
      unit: "day",
    }
    expect(expandPdtpScheduleDefinition(definition, { startDate: "2027-01-05", endDate: "2027-01-25" }).map((item) => item.scheduledFor))
      .toEqual(["2027-01-11", "2027-01-21"])
  })

  it("expands weekly ISO weekdays with a configurable interval", () => {
    const definition: PdtpScheduleDefinition = {
      version: 1,
      kind: "recurring",
      startDate: "2027-01-04",
      endDate: "2027-01-31",
      every: 2,
      unit: "week",
      weekdays: [1, 3],
    }
    expect(expandPdtpScheduleDefinition(definition, { startDate: "2027-01-01", endDate: "2027-01-31" }).map((item) => item.scheduledFor))
      .toEqual(["2027-01-04", "2027-01-06", "2027-01-18", "2027-01-20"])
  })

  it("returns ISO week-year values across a year boundary", () => {
    expect(getPdtpIsoWeek("2021-01-01")).toEqual({ isoWeekYear: 2020, isoWeek: 53 })
    expect(getPdtpIsoWeek("2021-01-04")).toEqual({ isoWeekYear: 2021, isoWeek: 1 })
  })

  it("lists all ISO weeks intersecting a month, including a six-week month", () => {
    expect(listPdtpIsoWeeksIntersectingMonth(2026, 8)).toEqual([
      { isoWeekYear: 2026, isoWeek: 31 },
      { isoWeekYear: 2026, isoWeek: 32 },
      { isoWeekYear: 2026, isoWeek: 33 },
      { isoWeekYear: 2026, isoWeek: 34 },
      { isoWeekYear: 2026, isoWeek: 35 },
      { isoWeekYear: 2026, isoWeek: 36 },
    ])
    expect(listPdtpIsoWeeksIntersectingMonth(2020, 3)).toHaveLength(6)
  })

  it("does not materialize event, on-demand or legacy-grid definitions", () => {
    const definitions: PdtpScheduleDefinition[] = [
      { version: 1, kind: "event", triggerConnectorKey: "workers", triggerEventKey: "created", dueValue: 24, dueUnit: "hour" },
      { version: 1, kind: "on_demand", dueValue: 24, dueUnit: "hour" },
      { version: 1, kind: "legacy_grid" },
    ]
    for (const definition of definitions) {
      expect(expandPdtpScheduleDefinition(definition, { startDate: "2027-01-01", endDate: "2027-12-31" })).toEqual([])
    }
  })

  it("rejects new calendar definitions that escape the program period", () => {
    expect(() => assertPdtpScheduleDefinitionWithinPeriod(
      { version: 1, kind: "one_time", date: "2027-12-31" },
      { startDate: "2027-01-01", endDate: "2027-12-30" },
    )).toThrow("fecha planificada")

    expect(() => assertPdtpScheduleDefinitionWithinPeriod(
      {
        version: 1,
        kind: "recurring",
        startDate: "2026-12-15",
        endDate: "2027-12-15",
        every: 1,
        unit: "month",
      },
      { startDate: "2027-01-01", endDate: "2027-12-31" },
    )).toThrow("rango de recurrencia")

    expect(() => assertPdtpScheduleDefinitionWithinPeriod(
      { version: 1, kind: "event", triggerConnectorKey: "worker", triggerEventKey: "worker_created", dueValue: 24, dueUnit: "hour" },
      { startDate: "2027-01-01", endDate: "2027-12-31" },
    )).not.toThrow()
  })
})
