import { describe, expect, it, vi } from "vitest"

const mockGetStockAlerts = vi.hoisted(() => vi.fn())

vi.mock("@/lib/services/stock-alerts", () => ({
  getStockAlerts: mockGetStockAlerts,
}))

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ id: "prod-epp-1" }]),
      }),
    }),
  },
}))

describe("getStockEppAlerts", () => {
  it("filters general stock alerts to return only those for EPP products", async () => {
    mockGetStockAlerts.mockResolvedValue([
      { productId: "prod-epp-1", productName: "Casco de Seguridad", severity: "critical" },
      { productId: "prod-general-2", productName: "Clavos 2 pulgadas", severity: "warning" },
    ])

    const { getEppStockAlerts } = await import("@/lib/services/stock-epp-alerts")
    const alerts = await getEppStockAlerts()

    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.productId).toBe("prod-epp-1")
  })
})
