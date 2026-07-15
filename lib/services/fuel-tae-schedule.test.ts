import { describe, it, expect } from "vitest"
import { isOutsideOperatingSchedule } from "./fuel-tae"

// Horario tipo: lunes a viernes (ISO 1-5), 08:00-18:00, América/Santiago.
const WEEKDAY_SCHEDULE = { timezone: "America/Santiago", days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" }

describe("isOutsideOperatingSchedule", () => {
  it("returns false for a load within days and hours", () => {
    // 2026-01-05 es lunes.
    expect(isOutsideOperatingSchedule("2026-01-05T10:00:00-03:00", WEEKDAY_SCHEDULE)).toBe(false)
  })

  it("returns true for a load after the end hour", () => {
    expect(isOutsideOperatingSchedule("2026-01-05T20:00:00-03:00", WEEKDAY_SCHEDULE)).toBe(true)
  })

  it("returns true for a load before the start hour", () => {
    expect(isOutsideOperatingSchedule("2026-01-05T05:00:00-03:00", WEEKDAY_SCHEDULE)).toBe(true)
  })

  it("returns true for a load on a day outside the schedule (Saturday)", () => {
    // 2026-01-10 es sábado.
    expect(isOutsideOperatingSchedule("2026-01-10T10:00:00-03:00", WEEKDAY_SCHEDULE)).toBe(true)
  })

  it("treats the start and end boundaries as inclusive", () => {
    expect(isOutsideOperatingSchedule("2026-01-05T08:00:00-03:00", WEEKDAY_SCHEDULE)).toBe(false)
    expect(isOutsideOperatingSchedule("2026-01-05T18:00:00-03:00", WEEKDAY_SCHEDULE)).toBe(false)
  })
})
