import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"

let selectCallCount = 0
const selectResults: Array<{ data: unknown[] }> = []
const findManyVehicles = vi.fn()

function createChain(data: unknown[] = []) {
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.groupBy = vi.fn(() => chain)
  chain.then = (resolve: (value: unknown[]) => void, reject?: (error: unknown) => void) =>
    Promise.resolve(data).then(resolve, reject)
  return chain
}

vi.mock("@/db", () => ({
  db: {
    query: { fuelVehicles: { findMany: () => findManyVehicles() } },
    select: () => {
      const idx = selectCallCount++
      return createChain(selectResults[idx]?.data ?? [])
    },
  },
}))

vi.mock("@/lib/auth/scope", () => ({
  isGlobalRole: vi.fn(),
  visibleWorksiteIds: vi.fn(),
}))

import { getFleetOverview } from "@/lib/services/fleet"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"

const mockIsGlobalRole = vi.mocked(isGlobalRole)
const mockVisibleWorksiteIds = vi.mocked(visibleWorksiteIds)

const session = { user: { id: "user-1" } } as Session

beforeEach(() => {
  vi.clearAllMocks()
  selectCallCount = 0
  selectResults.length = 0
  mockIsGlobalRole.mockReturnValue(true)
  mockVisibleWorksiteIds.mockReturnValue([])
})

describe("getFleetOverview", () => {
  it("operational cost = fuel + maintenance (no allocations)", async () => {
    findManyVehicles.mockResolvedValue([
      { id: "veh-1", plate: "AA-BB-11", type: "camioneta", brand: "Toyota", model: "Hilux", year: 2022, isActive: true, worksite: { name: "Faena Uno" } },
    ])
    selectResults.push(
      { data: [{ vehicleId: "veh-1", totalFuelAmount: 100_000, totalLiters: 80, loadCount: 2, lastOdometerReading: 12_500, lastHourMeterReading: null }] },
      { data: [{ vehicleId: "veh-1", totalMaintenanceAmount: 250_000, maintenanceCount: 1, lastMaintenanceDate: "2026-06-01" }] },
    )

    const overview = await getFleetOverview(session)

    expect(overview).toHaveLength(1)
    const vehicle = overview[0]!
    expect(vehicle.totalFuelAmount).toBe(100_000)
    expect(vehicle.totalMaintenanceAmount).toBe(250_000)
    expect(vehicle.totalOperationalCost).toBe(350_000)
    // La imputación de costos fue retirada: no debe existir ese campo.
    expect("totalAllocatedAmount" in vehicle).toBe(false)
    expect("allocationCount" in vehicle).toBe(false)
  })

  it("returns no rows when a scoped user has no visible vehicles", async () => {
    mockIsGlobalRole.mockReturnValue(false)
    mockVisibleWorksiteIds.mockReturnValue([])
    findManyVehicles.mockResolvedValue([])
    selectResults.push({ data: [] }, { data: [] })

    const overview = await getFleetOverview(session)
    expect(overview).toEqual([])
  })
})
