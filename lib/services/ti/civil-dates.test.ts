import { describe, expect, it } from "vitest"
import { civilDaysUntil, isCivilDateBefore } from "./civil-dates"

describe("fechas civiles TI", () => {
  it("no marca vencido el mismo día y calcula diferencias sin desfase UTC", () => {
    expect(isCivilDateBefore("2026-09-03", "2026-09-03")).toBe(false)
    expect(civilDaysUntil("2026-09-03", "2026-09-03")).toBe(0)
    expect(civilDaysUntil("2026-09-04", "2026-09-03")).toBe(1)
    expect(civilDaysUntil("2026-09-02", "2026-09-03")).toBe(-1)
  })
})
