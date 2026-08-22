import { describe, expect, it } from "vitest"
import { fuelCronContractFor } from "./fuel-cron-contract"

describe("fuelCronContractFor", () => {
  it("succeeds when nothing failed", () => {
    expect(fuelCronContractFor({ failed: 0, total: 8 })).toMatchObject({ outcome: "success", ok: true, httpStatus: 200 })
  })

  it("reports partial when some units failed but not all", () => {
    expect(fuelCronContractFor({ failed: 2, total: 8 })).toMatchObject({ outcome: "partial", ok: false, httpStatus: 503, health: "degraded" })
  })

  it("reports failed when every unit failed", () => {
    expect(fuelCronContractFor({ failed: 8, total: 8 })).toMatchObject({ outcome: "failed", ok: false, httpStatus: 503, health: "critical" })
  })

  it("reports conflict only when there is no failure to report", () => {
    expect(fuelCronContractFor({ conflict: true })).toMatchObject({ outcome: "conflict", ok: false, httpStatus: 409 })
  })

  it("a failure outranks a concurrent conflict", () => {
    expect(fuelCronContractFor({ conflict: true, failed: 1, total: 1 })).toMatchObject({ outcome: "failed" })
  })

  it("unauthorized outranks everything else", () => {
    expect(fuelCronContractFor({ unauthorized: true, failed: 1, total: 1 })).toMatchObject({ outcome: "unauthorized", httpStatus: 401 })
  })

  it("disabled module reports ok:true so the runner does not treat it as a failure", () => {
    expect(fuelCronContractFor({ disabled: true })).toMatchObject({ outcome: "disabled", ok: true, httpStatus: 200 })
  })

  it("every code starts with the FUEL_CRON_ prefix the runner expects", () => {
    for (const contract of [
      fuelCronContractFor({}),
      fuelCronContractFor({ unauthorized: true }),
      fuelCronContractFor({ disabled: true }),
      fuelCronContractFor({ conflict: true }),
      fuelCronContractFor({ failed: 1, total: 2 }),
      fuelCronContractFor({ failed: 2, total: 2 }),
    ]) {
      expect(contract.code.startsWith("FUEL_CRON_")).toBe(true)
    }
  })
})
