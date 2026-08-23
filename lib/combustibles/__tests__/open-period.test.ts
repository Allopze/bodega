import { describe, expect, it } from "vitest"
import { isOpenPeriod } from "../open-period"

describe("isOpenPeriod", () => {
  it("treats the final day as still open", async () => {
    // Una carga puede entrar hoy mismo: el mes recién cierra cuando su último
    // día queda estrictamente en el pasado.
    expect(isOpenPeriod("2026-08-31", "2026-08-31")).toBe(true)
    expect(isOpenPeriod("2026-08-31", "2026-08-22")).toBe(true)
  })

  it("closes the period the day after it ends", () => {
    expect(isOpenPeriod("2026-08-31", "2026-09-01")).toBe(false)
    expect(isOpenPeriod("2026-07-31", "2026-08-22")).toBe(false)
  })

  it("never calls a future period closed", () => {
    expect(isOpenPeriod("2027-01-31", "2026-08-22")).toBe(true)
  })
})
