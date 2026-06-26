import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"

let selectCallCount = 0
const selectResults: Array<{ data: unknown[] }> = []

function createChain(data: unknown[] = []) {
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  chain.innerJoin = vi.fn(() => chain)
  chain.leftJoin = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.groupBy = vi.fn(() => chain)
  chain.orderBy = vi.fn(() => chain)
  chain.limit = vi.fn(() => chain)
  chain.then = (resolve: (value: unknown[]) => void, reject?: (error: unknown) => void) =>
    Promise.resolve(data).then(resolve, reject)
  return chain
}

vi.mock("@/db", () => ({
  db: {
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

import { getAnalyticsDashboard, normalizeAnalyticsFilters } from "@/lib/services/analytics"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"

const mockIsGlobalRole = vi.mocked(isGlobalRole)
const mockVisibleWorksiteIds = vi.mocked(visibleWorksiteIds)

function makeSession(overrides?: Partial<Session["user"]>): Session {
  return {
    user: {
      id: "user-1",
      name: "Test User",
      email: "test@example.com",
      permissions: ["analytics:view"],
      roles: ["administrador"],
      worksiteIds: ["ws-1"],
      ...overrides,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as Session
}

beforeEach(() => {
  vi.clearAllMocks()
  selectCallCount = 0
  selectResults.length = 0
  mockIsGlobalRole.mockReturnValue(true)
  mockVisibleWorksiteIds.mockReturnValue([])
})

describe("normalizeAnalyticsFilters", () => {
  it("defaults to the current calendar month when no dates are provided", () => {
    const filters = normalizeAnalyticsFilters({}, new Date("2026-06-26T12:00:00Z"))
    expect(filters).toEqual({
      fromDate: "2026-06-01",
      toDate: "2026-06-26",
    })
  })

  it("keeps explicit date and entity filters", () => {
    const filters = normalizeAnalyticsFilters({
      fromDate: "2026-01-01",
      toDate: "2026-03-31",
      worksiteId: "ws-1",
      supplierId: "sup-1",
      vehicleId: "veh-1",
      requestType: "epp",
    })
    expect(filters).toEqual({
      fromDate: "2026-01-01",
      toDate: "2026-03-31",
      worksiteId: "ws-1",
      supplierId: "sup-1",
      vehicleId: "veh-1",
      requestType: "epp",
    })
  })
})

describe("getAnalyticsDashboard", () => {
  it("combines purchasing and fuel into executive KPIs and cross-module rankings", async () => {
    selectResults.push(
      { data: [{ totalAmount: 1_200_000, orderCount: 4, averageOrderAmount: 300_000 }] },
      { data: [{ totalAmount: 900_000 }] },
      { data: [{ totalAmount: 420_000, loadCount: 7, totalLiters: 350 }] },
      { data: [{ totalAmount: 300_000 }] },
      { data: [{ pendingApprovals: 2 }] },
      { data: [{ criticalStockCount: 3 }] },
      { data: [
        { month: "2026-06", module: "Compras", totalAmount: 1_200_000 },
      ] },
      { data: [
        { month: "2026-06", module: "Combustible", totalAmount: 420_000 },
      ] },
      { data: [
        { module: "EPP", totalAmount: 700_000 },
        { module: "Repuestos", totalAmount: 500_000 },
      ] },
      { data: [{ module: "Combustible", totalAmount: 420_000 }] },
      { data: [
        { id: "sup-1", name: "Proveedor A", module: "Compras", totalAmount: 1_200_000, count: 4 },
      ] },
      { data: [
        { id: "fuel-sup-1", name: "Copec", module: "Combustible", totalAmount: 420_000, count: 7 },
      ] },
      { data: [{ id: "ws-1", name: "Faena Norte", module: "Compras", totalAmount: 1_200_000 }] },
      { data: [{ id: "ws-1", name: "Faena Norte", module: "Combustible", totalAmount: 420_000 }] },
      { data: [{ id: "veh-1", plate: "AA-BB-11", type: "camioneta", totalFuelAmount: 420_000, totalLiters: 350, loadCount: 7 }] },
      { data: [
        { productId: "prod-1", productName: "Guante cabritilla", sku: "EPP-001", worksiteName: "Faena Norte", currentQty: 2, minStock: 10 },
      ] },
      { data: [
        { productId: "prod-2", productName: "Casco", sku: "EPP-002", totalOut: 18, movementCount: 6 },
      ] },
      { data: [
        { productId: "prod-2", productName: "Casco", workerName: "Ada Lovelace", worksiteName: "Faena Norte", totalQty: 5, deliveryCount: 3 },
      ] },
      { data: [
        { id: "oc-1", code: "OC-001", worksiteName: "Faena Norte", supplierName: "Proveedor A", totalAmount: 1_200_000, createdAt: "2026-06-01T00:00:00Z" },
      ] },
    )

    const data = await getAnalyticsDashboard(makeSession(), {
      fromDate: "2026-06-01",
      toDate: "2026-06-30",
    })

    expect(data.kpis.totalSpend).toBe(1_620_000)
    expect(data.kpis.previousTotalSpend).toBe(1_200_000)
    expect(data.kpis.spendVariationPct).toBe(35)
    expect(data.kpis.purchaseOrderCount).toBe(4)
    expect(data.spendByModule).toEqual([
      { module: "EPP", totalAmount: 700_000 },
      { module: "Repuestos", totalAmount: 500_000 },
      { module: "Combustible", totalAmount: 420_000 },
    ])
    expect(data.spendByMonth).toEqual([
      { month: "2026-06", purchasingAmount: 1_200_000, fuelAmount: 420_000, totalAmount: 1_620_000 },
    ])
    expect(data.topSuppliers[0]).toMatchObject({ name: "Proveedor A", totalAmount: 1_200_000 })
    expect(data.topWorksites[0]).toMatchObject({ name: "Faena Norte", totalAmount: 1_620_000 })
    expect(data.vehicleCosts[0]).toMatchObject({ plate: "AA-BB-11", totalOperationalCost: 420_000 })
    expect(data.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "stock_bajo",
        severity: "critical",
        entityLabel: "Guante cabritilla",
      }),
      expect.objectContaining({
        type: "proveedor_concentrado",
        severity: "medium",
        module: "Proveedores",
      }),
    ]))
  })

  it("adds maintenance costs and meter readings to vehicle operational analytics", async () => {
    selectResults.push(
      { data: [{ totalAmount: 0, orderCount: 0, averageOrderAmount: 0 }] },
      { data: [{ totalAmount: 0 }] },
      { data: [{ totalAmount: 100_000, loadCount: 2, totalLiters: 80 }] },
      { data: [{ totalAmount: 0 }] },
      { data: [{ pendingApprovals: 0 }] },
      { data: [{ criticalStockCount: 0 }] },
      { data: [] },
      { data: [{ month: "2026-06", module: "Combustible", totalAmount: 100_000 }] },
      { data: [] },
      { data: [{ module: "Combustible", totalAmount: 100_000 }] },
      { data: [] },
      { data: [] },
      { data: [] },
      { data: [] },
      { data: [
        {
          id: "veh-1",
          plate: "AA-BB-11",
          type: "camioneta",
          totalFuelAmount: 100_000,
          totalLiters: 80,
          loadCount: 2,
          lastOdometerReading: 12_500,
          lastHourMeterReading: 440,
        },
      ] },
      { data: [] },
      { data: [] },
      { data: [] },
      { data: [] },
      { data: [{ vehicleId: "veh-1", totalMaintenanceAmount: 250_000, maintenanceCount: 1 }] },
      { data: [{ vehicleId: "veh-1", totalPartsAmount: 75_000, allocationCount: 2 }] },
    )

    const data = await getAnalyticsDashboard(makeSession(), {
      fromDate: "2026-06-01",
      toDate: "2026-06-30",
      vehicleId: "veh-1",
    })

    expect(data.vehicleCosts[0]).toMatchObject({
      plate: "AA-BB-11",
      totalFuelAmount: 100_000,
      totalServiceAmount: 250_000,
      totalPartsAmount: 75_000,
      totalOperationalCost: 425_000,
      totalLiters: 80,
      loadCount: 2,
      lastOdometerReading: 12_500,
      lastHourMeterReading: 440,
    })
    expect(data.dataGaps.join(" ")).not.toContain("mantenciones no tienen tablas operativas")
    expect(data.dataGaps.join(" ")).not.toContain("no registran kilometraje")
  })

  it("uses no-rows predicates for scoped users without visible worksites", async () => {
    mockIsGlobalRole.mockReturnValue(false)
    mockVisibleWorksiteIds.mockReturnValue([])

    for (let i = 0; i < 19; i++) selectResults.push({ data: [] })

    const data = await getAnalyticsDashboard(makeSession({ roles: ["solicitante_faena"], worksiteIds: [] }), {
      fromDate: "2026-06-01",
      toDate: "2026-06-30",
    })

    expect(data.kpis.totalSpend).toBe(0)
    expect(data.alerts).toContainEqual(expect.objectContaining({
      type: "sin_datos",
      severity: "low",
    }))
  })
})
