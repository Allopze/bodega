import { describe, expect, it } from "vitest"
import { onwayCronContractFor } from "./onway-cron-contract"

describe("onwayCronContractFor", () => {
  it("keeps disabled integrations healthy", () => {
    expect(onwayCronContractFor("disabled")).toEqual({
      ok: true,
      outcome: "disabled",
      code: "FLEET_GPS_CRON_DISABLED",
      health: "healthy",
      httpStatus: 200,
    })
  })

  it("distinguishes auth, overlap and provider failures", () => {
    expect(onwayCronContractFor("unauthorized").httpStatus).toBe(401)
    expect(onwayCronContractFor("conflict")).toMatchObject({
      ok: false,
      code: "FLEET_GPS_CRON_ACTIVE_RUN",
      httpStatus: 409,
    })
    expect(onwayCronContractFor("partial")).toMatchObject({ httpStatus: 503, health: "degraded" })
    expect(onwayCronContractFor("failed")).toMatchObject({ httpStatus: 503, health: "unhealthy" })
  })
})
