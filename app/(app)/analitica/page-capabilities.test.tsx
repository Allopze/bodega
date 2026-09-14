import { beforeEach, describe, expect, it, vi } from "vitest"

const requirePermission = vi.hoisted(() => vi.fn())
const can = vi.hoisted(() => vi.fn())
const getAnalyticsDashboard = vi.hoisted(() => vi.fn())
const getFilterOptions = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ requirePermission, can }))
// ANA-002/PER-T02: la página ya no llama al servicio directo sino a su entrada
// cacheada (`read-model-cache`); el doble se mueve ahí. Lo que esta prueba
// verifica —qué secciones se pintan según permisos— no cambia.
vi.mock("@/lib/services/read-model-cache", () => ({ getCachedAnalyticsDashboard: getAnalyticsDashboard }))
vi.mock("@/lib/services/analytics", () => ({
  normalizeAnalyticsFilters: (filters: Record<string, unknown>) => ({
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    ...filters,
  }),
}))
vi.mock("./analytics-page.helpers", () => ({
  getFilterOptions,
  getParam: () => undefined,
}))

import AnaliticaPage from "./page"

const analyticsOnlySession = {
  user: { id: "analytics-only", permissions: ["analytics:view"], isGlobal: true, worksiteIds: [] },
}

function collectElements(node: unknown, result: Array<{ type: unknown; props: Record<string, unknown> }> = []) {
  if (Array.isArray(node)) {
    node.forEach((child) => collectElements(child, result))
    return result
  }
  if (!node || typeof node !== "object" || !("props" in node)) return result
  const element = node as { type: unknown; props: Record<string, unknown> }
  result.push(element)
  Object.values(element.props).forEach((value) => collectElements(value, result))
  return result
}

function typeName(type: unknown) {
  if (type && typeof type === "object" && "displayName" in type) {
    const displayName = (type as { displayName?: unknown }).displayName
    if (typeof displayName === "string") return displayName
  }
  return typeof type === "function" ? type.name : String(type)
}

beforeEach(() => {
  vi.clearAllMocks()
  requirePermission.mockResolvedValue(analyticsOnlySession)
  can.mockImplementation((session, permission) => session.user.permissions.includes(permission))
  getFilterOptions.mockResolvedValue({ worksites: [], suppliers: [], vehicles: [] })
  getAnalyticsDashboard.mockResolvedValue({
    filters: { fromDate: "2026-08-01", toDate: "2026-08-31" },
    kpis: {
      totalSpend: 0,
      previousTotalSpend: 0,
      spendVariationPct: 0,
      purchaseOrderCount: 0,
      pendingApprovals: 0,
      criticalStockCount: 0,
      fuelLiters: 0,
      fuelLoadCount: 0,
      averageOrderAmount: 0,
    },
    spendByMonth: [],
    spendByModule: [],
    topSuppliers: [{ id: "supplier-1", name: "Proveedor", module: "Compras", totalAmount: 10, count: 1 }],
    topWorksites: [],
    vehicleCosts: [],
    stockRisks: [{ productId: "product-1", productName: "Producto", sku: "SKU", worksiteName: "Faena", currentQty: 1, minStock: 2 }],
    productRotation: [],
    eppDeliveries: [{ productId: "epp-1", productName: "EPP", workerName: "Trabajador", worksiteName: "Faena", totalQty: 1, deliveryCount: 1 }],
    recentOrders: [{ id: "order-1", code: "OC-1", worksiteName: "Faena", supplierName: "Proveedor", totalAmount: 10, createdAt: "2026-08-01" }],
    alerts: [],
    dataGaps: [],
  })
})

describe("AnaliticaPage capability matrix", () => {
  it("analytics:view aislado no presenta combustible como cero ni enlaces a módulos ajenos", async () => {
    const page = await AnaliticaPage({ searchParams: Promise.resolve({}) })
    const elements = collectElements(page)
    const hrefs = elements.flatMap((element) => typeof element.props.href === "string" ? [element.props.href] : [])
    const kpiLabels = elements
      .filter((element) => typeName(element.type) === "KpiCard")
      .map((element) => element.props.label)
    const cardTitles = elements
      .filter((element) => typeName(element.type) === "CardTitle")
      .map((element) => element.props.children)

    expect(kpiLabels).not.toContain("Combustible")
    expect(cardTitles.some((title) => String(title).includes("Vehículos con mayor"))).toBe(false)
    expect(hrefs.some((href) => href.startsWith("/combustibles"))).toBe(false)
    expect(hrefs.some((href) => href.startsWith("/compras"))).toBe(false)
    expect(hrefs.some((href) => href.startsWith("/bodega"))).toBe(false)
    expect(hrefs.some((href) => href.startsWith("/entregas"))).toBe(false)
    expect(hrefs.some((href) => href.startsWith("/reportes"))).toBe(false)
  })
})
