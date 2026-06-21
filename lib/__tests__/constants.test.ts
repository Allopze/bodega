import { describe, it, expect } from "vitest"
import * as constants from "@/lib/constants"

describe("application constants", () => {
  it("exports valid DEFAULT_PAGE_SIZE", () => {
    expect(constants.DEFAULT_PAGE_SIZE).toBe(25)
  })

  it("exports valid TAX_RATE as number", () => {
    expect(typeof constants.TAX_RATE).toBe("number")
    expect(constants.TAX_RATE).toBeGreaterThan(0)
  })

  it("exports per-module page sizes", () => {
    expect(constants.SOLICITUDES_PAGE_SIZE).toBe(25)
    expect(constants.ORDERS_PAGE_SIZE).toBe(25)
    expect(constants.APPROVAL_REQUESTS_PAGE_SIZE).toBe(20)
    expect(constants.HISTORY_PAGE_SIZE).toBe(25)
    expect(constants.KARDEX_PAGE_SIZE).toBe(25)
    expect(constants.RECEPCION_PAGE_SIZE).toBe(25)
    expect(constants.TRACEABILITY_PAGE_SIZE).toBe(50)
  })

  it("exports traceability alert scan limit", () => {
    expect(constants.TRACEABILITY_ALERT_SCAN_LIMIT).toBe(1000)
  })
})
