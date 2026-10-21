import { describe, expect, it } from "vitest"
import { createVehicleResolver, type DatedProviderVehicleMapping } from "./plate-resolver"

const vehicles = [
  { id: "vehicle-1", plate: "AB-CD12", worksiteId: "current-site", meterType: "odometer" },
]

const mapping = (overrides: Partial<DatedProviderVehicleMapping> = {}): DatedProviderVehicleMapping => ({
  externalKey: "ABCD12",
  vehicleId: "vehicle-1",
  worksiteId: "old-site",
  effectiveFrom: "2022-01-01",
  effectiveTo: "2024-06-30",
  isActive: false,
  version: 1,
  ...overrides,
})

describe("dated provider vehicle resolution", () => {
  it("uses the historical worksite when a dated mapping covers the source date", () => {
    const resolve = createVehicleResolver(vehicles, [mapping()], "2026-10-01")

    expect(resolve("AB CD12", "2023-05-14")).toMatchObject({ id: "vehicle-1", worksiteId: "old-site" })
  })

  it("does not attribute a monthly aggregate across a reassignment", () => {
    const resolve = createVehicleResolver(vehicles, [mapping()], "2026-10-01")

    expect(resolve("ABCD12", "2024-06-01", "2024-06-30")).toMatchObject({ worksiteId: "old-site" })
    expect(resolve("ABCD12", "2024-06-01", "2024-07-31")).toBeUndefined()
  })

  it("leaves historical rows unresolved when no effective mapping exists", () => {
    const resolve = createVehicleResolver(vehicles, [], "2026-10-01")

    expect(resolve("ABCD12", "2021-08-01")).toBeUndefined()
  })

  it("keeps the current fleet assignment as the fallback for the current period", () => {
    const resolve = createVehicleResolver(vehicles, [], "2026-10-01")

    expect(resolve("ABCD12", "2026-10-01", "2026-10-31")).toMatchObject({ worksiteId: "current-site" })
  })
})
