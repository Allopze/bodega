import ExcelJS from "exceljs"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { buildXlsxBuffer, getReportData, type ReportData } from "@/lib/reports/export"
import { purchaseRequests, purchaseRequestItems, purchaseOrders, products, worksites, suppliers } from "@/db/schema"
import type { Session } from "next-auth"

// Mock the Auth helpers
const mockIsGlobalRole = vi.fn()
const mockVisibleWorksiteIds = vi.fn()
const mockGetAnalyticsDashboard = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  isGlobalRole: (s: unknown) => mockIsGlobalRole(s),
  visibleWorksiteIds: (s: unknown) => mockVisibleWorksiteIds(s),
}))

vi.mock("@/lib/services/analytics", () => ({
  getAnalyticsDashboard: (...args: unknown[]) => mockGetAnalyticsDashboard(...args),
  normalizeAnalyticsFilters: (filters: Record<string, string | undefined>) => ({
    fromDate: filters.fromDate ?? "2026-06-01",
    toDate: filters.toDate ?? "2026-06-30",
    ...(filters.worksiteId ? { worksiteId: filters.worksiteId } : {}),
    ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
    ...(filters.vehicleId ? { vehicleId: filters.vehicleId } : {}),
  }),
}))

// Mock the Database
const mockSelect = vi.fn()
vi.mock("@/db", () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
  },
}))

function getTableMockData(table: unknown) {
  if (table === purchaseOrders) {
    return [
      { id: "po-1", code: "OC-1", worksiteId: "ws-1", totalAmount: 1000, status: "sent", createdAt: "2026-01-01T10:00:00Z", supplierId: "sup-1", issuedAt: "2026-01-01T10:00:00Z", sentAt: "2026-01-02T10:00:00Z", confirmedAt: null },
      { id: "po-2", code: "OC-2", worksiteId: "ws-2", totalAmount: 2000, status: "confirmed", createdAt: "2026-01-03T10:00:00Z", supplierId: "sup-2", issuedAt: "2026-01-03T10:00:00Z", sentAt: "2026-01-04T10:00:00Z", confirmedAt: "2026-01-05T10:00:00Z" }
    ]
  }
  if (table === worksites) {
    return [
      { id: "ws-1", name: "Faena Uno" },
      { id: "ws-2", name: "Faena Dos" }
    ]
  }
  if (table === suppliers) {
    return [
      { id: "sup-1", name: "Proveedor Uno" },
      { id: "sup-2", name: "Proveedor Dos" }
    ]
  }
  if (table === purchaseRequestItems) {
    return [
      { id: "pri-1", requestId: "pr-1", productId: "p-1", productNameFree: null, quantity: 5, unitOfMeasure: "un", status: "approved", createdAt: "2026-01-01T10:00:00Z" },
      { id: "pri-2", requestId: "pr-2", productId: null, productNameFree: "Clavos", quantity: 100, unitOfMeasure: "kg", status: "pending_purchase", createdAt: "2026-01-02T10:00:00Z" }
    ]
  }
  if (table === purchaseRequests) {
    return [
      { id: "pr-1", code: "SOL-1", worksiteId: "ws-1" },
      { id: "pr-2", code: "SOL-2", worksiteId: "ws-2" }
    ]
  }
  if (table === products) {
    return [
      { id: "p-1", name: "Martillo", sku: "MART-123" }
    ]
  }
  return []
}

class MockQueryChain {
  table: unknown
  constructor(table: unknown) {
    this.table = table
  }
  innerJoin() { return this }
  where() { return this }
  limit() { return this }
  then(resolve: (val: unknown) => void, reject?: (err: unknown) => void) {
    return Promise.resolve(getTableMockData(this.table)).then(resolve, reject)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsGlobalRole.mockReturnValue(true)
  mockVisibleWorksiteIds.mockReturnValue([])
  mockGetAnalyticsDashboard.mockResolvedValue({
    filters: { fromDate: "2026-06-01", toDate: "2026-06-30" },
    kpis: {
      totalSpend: 1_620_000,
      previousTotalSpend: 1_200_000,
      spendVariationPct: 35,
      purchaseOrderCount: 4,
      pendingApprovals: 2,
      criticalStockCount: 3,
      fuelLiters: 350,
      fuelLoadCount: 7,
      averageOrderAmount: 300_000,
    },
    spendByMonth: [{ month: "2026-06", purchasingAmount: 1_200_000, fuelAmount: 420_000, totalAmount: 1_620_000 }],
    spendByModule: [{ module: "EPP", totalAmount: 700_000 }, { module: "Combustible", totalAmount: 420_000 }],
    topSuppliers: [{ id: "sup-1", name: "Proveedor Uno", module: "Compras", totalAmount: 1_200_000, count: 4 }],
    topWorksites: [{ id: "ws-1", name: "Faena Uno", totalAmount: 1_620_000 }],
    vehicleCosts: [{ id: "veh-1", plate: "AA-BB-11", type: "camioneta", totalFuelAmount: 420_000, totalServiceAmount: 0, totalPartsAmount: 0, totalOperationalCost: 420_000, totalLiters: 350, loadCount: 7 }],
    stockRisks: [{ productId: "prod-1", productName: "Guante", sku: "EPP-001", worksiteName: "Faena Uno", currentQty: 2, minStock: 10 }],
    productRotation: [],
    eppDeliveries: [],
    recentOrders: [],
    alerts: [{ type: "stock_bajo", severity: "critical", module: "Bodega", entityLabel: "Guante", reason: "Stock bajo", action: "Reponer", detectedAt: "2026-06-26" }],
    dataGaps: ["Sin kilometraje u horómetro en combustible."],
  })
  
  mockSelect.mockImplementation(() => ({
    from: (table: unknown) => new MockQueryChain(table)
  }))
})

const testReport: ReportData = {
  filenameBase: "reporte-test",
  worksheetName: "Reporte test",
  headers: ["OC", "Proveedor", "Monto"],
  rows: [
    ["OC-1", "Proveedor, con coma", 1000],
    ["OC-2", "Proveedor \"quoted\"", null],
  ],
}

describe("report export helpers", () => {
  it("builds a parseable XLSX workbook with headers and rows", async () => {
    const buffer = await buildXlsxBuffer(testReport)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(buffer) as never)

    const worksheet = workbook.getWorksheet("Reporte test")
    expect(worksheet).toBeDefined()
    expect(worksheet?.getRow(1).values).toEqual([undefined, "OC", "Proveedor", "Monto"])
    expect(worksheet?.getCell("B2").value).toBe("Proveedor, con coma")
    expect(worksheet?.getCell("C2").value).toBe(1000)
    expect(worksheet?.getCell("C3").value).toBe("")
  })

  it("gasto_faena report data (global role, no filters)", async () => {
    const session = { user: { id: "user-1", email: "admin@test.com" } } as Session
    const data = await getReportData("gasto_faena", session, {})
    expect(data.filenameBase).toBe("gasto-por-faena")
    expect(data.headers).toEqual(["OC", "Faena", "Proveedor", "Estado", "Monto Total", "Fecha"])
    expect(data.rows).toHaveLength(2)
    expect(data.rows[0]).toEqual(["OC-1", "Faena Uno", "Proveedor Uno", "sent", 1000, "01-01-2026"])
  })

  it("gasto_faena report data (scoped role, date and worksite filters)", async () => {
    mockIsGlobalRole.mockReturnValue(false)
    mockVisibleWorksiteIds.mockReturnValue(["ws-1"])
    const session = { user: { id: "user-1", email: "user@test.com" } } as Session
    const data = await getReportData("gasto_faena", session, {
      fromDate: "2026-01-01",
      toDate: "2026-01-10",
      worksiteId: "ws-1",
      status: "sent"
    })
    expect(data.filenameBase).toBe("gasto-por-faena")
    expect(data.rows).toHaveLength(2)
  })

  it("gasto_faena report data (scoped role, no worksites visible)", async () => {
    mockIsGlobalRole.mockReturnValue(false)
    mockVisibleWorksiteIds.mockReturnValue([])
    const session = { user: { id: "user-1", email: "user@test.com" } } as Session
    const data = await getReportData("gasto_faena", session, {})
    expect(data.rows).toHaveLength(2) // Mock returns hardcoded data regardless, but exercises buildWorksiteFilter false branch
  })

  it("items_sin_oc report data (global role)", async () => {
    const session = { user: { id: "user-1", email: "admin@test.com" } } as Session
    const data = await getReportData("items_sin_oc", session, {})
    expect(data.filenameBase).toBe("items-sin-oc")
    expect(data.headers).toEqual(["Producto", "SKU", "Faena", "Solicitud", "Cantidad", "U/M", "Estado", "Fecha creación"])
    expect(data.rows).toHaveLength(2)
    expect(data.rows[0]).toEqual(["Martillo", "MART-123", "Faena Uno", "SOL-1", 5, "un", "approved", "01-01-2026"])
    expect(data.rows[1]).toEqual(["Clavos", "", "Faena Dos", "SOL-2", 100, "kg", "pending_purchase", "02-01-2026"])
  })

  it("items_sin_oc report data returning empty rows", async () => {
    mockSelect.mockImplementation(() => ({
      from: () => ({
        innerJoin() { return this },
        where() { return this },
        limit() { return this },
        then(resolve: (val: unknown) => void) {
          resolve([])
        }
      })
    }))
    const session = { user: { id: "user-1", email: "admin@test.com" } } as Session
    const data = await getReportData("items_sin_oc", session, {})
    expect(data.rows).toEqual([])
  })

  it("oc_por_estado report data (global role)", async () => {
    const session = { user: { id: "user-1", email: "admin@test.com" } } as Session
    const data = await getReportData("oc_por_estado", session, {})
    expect(data.filenameBase).toBe("oc-por-estado")
    expect(data.headers).toEqual(["OC", "Estado", "Faena", "Total", "Emitida", "Enviada", "Confirmada"])
    expect(data.rows).toHaveLength(2)
    expect(data.rows[0]).toEqual(["OC-1", "sent", "Faena Uno", 1000, "01-01-2026", "02-01-2026", ""])
    expect(data.rows[1]).toEqual(["OC-2", "confirmed", "Faena Dos", 2000, "03-01-2026", "04-01-2026", "05-01-2026"])
  })

  it("defaults to gasto_faena for other values", async () => {
    const session = { user: { id: "user-1", email: "admin@test.com" } } as Session
    const data = await getReportData("unknown_report", session, {})
    expect(data.filenameBase).toBe("gasto-por-faena")
  })

  it("analitica_resumen report data uses the analytics dashboard DTO", async () => {
    const session = { user: { id: "user-1", email: "admin@test.com" } } as Session
    const data = await getReportData("analitica_resumen", session, {
      fromDate: "2026-06-01",
      toDate: "2026-06-30",
      worksiteId: "ws-1",
      vehicleId: "veh-1",
    })

    expect(mockGetAnalyticsDashboard).toHaveBeenCalledWith(session, {
      fromDate: "2026-06-01",
      toDate: "2026-06-30",
      worksiteId: "ws-1",
      vehicleId: "veh-1",
    })
    expect(data.filenameBase).toBe("analitica-transversal")
    expect(data.headers).toEqual(["Sección", "Indicador", "Detalle", "Monto/Cantidad"])
    expect(data.rows).toEqual(expect.arrayContaining([
      ["KPI", "Gasto total", "2026-06-01 a 2026-06-30", 1_620_000],
      ["Gasto por tipo", "EPP", "", 700_000],
      ["Vehículos", "AA-BB-11", "camioneta · 350 L · 7 cargas", 420_000],
      ["Alertas", "Bodega · Guante", "Stock bajo · Acción: Reponer", "critical"],
    ]))
  })

  it("analitica_resumen returns separate sheets for operational sections", async () => {
    const session = { user: { id: "user-1", email: "admin@test.com" } } as Session
    const data = await getReportData("analitica_resumen", session, {})

    expect(data.sheets?.map((sheet) => sheet.worksheetName)).toEqual([
      "KPIs",
      "Gasto mensual",
      "Proveedores",
      "Faenas",
      "Vehículos",
      "Stock",
      "EPP",
      "Alertas",
      "Brechas",
    ])

    const buffer = await buildXlsxBuffer(data)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(buffer) as never)
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "KPIs",
      "Gasto mensual",
      "Proveedores",
      "Faenas",
      "Vehículos",
      "Stock",
      "EPP",
      "Alertas",
      "Brechas",
    ])
  })

  // ── buildXlsxBuffer edge cases ───────────────────────────────────────

  it("builds XLSX with empty rows", async () => {
    const report: ReportData = {
      filenameBase: "empty",
      worksheetName: "Empty",
      headers: ["Col A", "Col B"],
      rows: [],
    }
    const buffer = await buildXlsxBuffer(report)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(buffer) as never)
    const ws = workbook.getWorksheet("Empty")
    expect(ws).toBeDefined()
    expect(ws?.actualRowCount).toBe(1) // header only
    const values = ws?.getRow(1).values
    expect(Array.isArray(values) ? values.slice(1) : []).toEqual(["Col A", "Col B"])
  })

  it("builds XLSX with rowLimitApplied flag set", async () => {
    const report: ReportData = {
      filenameBase: "limited",
      worksheetName: "Limited",
      headers: ["ID"],
      rows: [[1], [2]],
      rowLimitApplied: true,
    }
    const buffer = await buildXlsxBuffer(report)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(buffer) as never)
    const ws = workbook.getWorksheet("Limited")
    expect(ws?.actualRowCount).toBe(3) // header + 2 rows
  })

  // ── gasto_faena edge cases ───────────────────────────────────────────

  it("gasto_faena returns empty rows when no orders match", async () => {
    mockSelect.mockImplementation(() => ({
      from: () => ({
        where() { return this },
        limit() { return this },
        then(resolve: (val: unknown) => void) { resolve([]) },
      })
    }))
    const session = { user: { id: "user-1", email: "admin@test.com" } } as Session
    const data = await getReportData("gasto_faena", session, {})
    expect(data.rows).toEqual([])
    expect(data.rowLimitApplied).toBe(false)
  })

  it("gasto_faena with only fromDate filter", async () => {
    const session = { user: { id: "user-1", email: "admin@test.com" } } as Session
    const data = await getReportData("gasto_faena", session, { fromDate: "2026-01-01" })
    expect(data.filenameBase).toBe("gasto-por-faena")
    // Mock returns hardcoded data; exercises buildDateFilter fromDate-only branch
    expect(data.rows).toHaveLength(2)
  })

  it("gasto_faena with only toDate filter", async () => {
    const session = { user: { id: "user-1", email: "admin@test.com" } } as Session
    const data = await getReportData("gasto_faena", session, { toDate: "2026-12-31" })
    expect(data.filenameBase).toBe("gasto-por-faena")
    // Exercises buildDateFilter toDate-only branch
    expect(data.rows).toHaveLength(2)
  })

  it("gasto_faena with maxRows=1 truncates to 1 row", async () => {
    const session = { user: { id: "user-1", email: "admin@test.com" } } as Session
    const data = await getReportData("gasto_faena", session, {}, 1)
    expect(data.rows).toHaveLength(1)
    expect(data.rowLimitApplied).toBe(true)
  })

  it("gasto_faena with null session applies no RBAC filter", async () => {
    const data = await getReportData("gasto_faena", null, {})
    expect(data.rows).toHaveLength(2)
  })

  // ── items_sin_oc edge cases ──────────────────────────────────────────

  it("items_sin_oc with custom status filter", async () => {
    const session = { user: { id: "user-1", email: "admin@test.com" } } as Session
    const data = await getReportData("items_sin_oc", session, { status: "approved" })
    expect(data.filenameBase).toBe("items-sin-oc")
    // Mock returns both items; status filter is applied via inArray
    expect(data.rows).toHaveLength(2)
  })

  it("items_sin_oc with date range filter", async () => {
    const session = { user: { id: "user-1", email: "admin@test.com" } } as Session
    const data = await getReportData("items_sin_oc", session, {
      fromDate: "2026-01-01",
      toDate: "2026-01-10",
    })
    expect(data.filenameBase).toBe("items-sin-oc")
    // Exercises buildDateFilter with both fromDate and toDate
    expect(data.rows).toHaveLength(2)
  })

  it("items_sin_oc with maxRows=1 truncates", async () => {
    const session = { user: { id: "user-1", email: "admin@test.com" } } as Session
    const data = await getReportData("items_sin_oc", session, {}, 1)
    expect(data.rows).toHaveLength(1)
    expect(data.rowLimitApplied).toBe(true)
  })

  it("items_sin_oc with null session applies no RBAC filter", async () => {
    const data = await getReportData("items_sin_oc", null, {})
    expect(data.rows).toHaveLength(2)
  })

  // ── oc_por_estado edge cases ─────────────────────────────────────────

  it("oc_por_estado returns empty rows when no orders match", async () => {
    mockSelect.mockImplementation(() => ({
      from: () => ({
        where() { return this },
        limit() { return this },
        then(resolve: (val: unknown) => void) { resolve([]) },
      })
    }))
    const session = { user: { id: "user-1", email: "admin@test.com" } } as Session
    const data = await getReportData("oc_por_estado", session, {})
    expect(data.rows).toEqual([])
  })

  it("oc_por_estado with status filter", async () => {
    const session = { user: { id: "user-1", email: "admin@test.com" } } as Session
    const data = await getReportData("oc_por_estado", session, { status: "sent" })
    expect(data.filenameBase).toBe("oc-por-estado")
    // Mock returns hardcoded data; exercises statusFilter branch
    expect(data.rows).toHaveLength(2)
  })

  it("oc_por_estado with date range filter", async () => {
    const session = { user: { id: "user-1", email: "admin@test.com" } } as Session
    const data = await getReportData("oc_por_estado", session, {
      fromDate: "2026-01-01",
      toDate: "2026-01-10",
    })
    expect(data.filenameBase).toBe("oc-por-estado")
    expect(data.rows).toHaveLength(2)
  })

  it("oc_por_estado with maxRows=1 truncates", async () => {
    const session = { user: { id: "user-1", email: "admin@test.com" } } as Session
    const data = await getReportData("oc_por_estado", session, {}, 1)
    expect(data.rows).toHaveLength(1)
    expect(data.rowLimitApplied).toBe(true)
  })

  it("oc_por_estado with null confirmedAt renders empty string", async () => {
    const session = { user: { id: "user-1", email: "admin@test.com" } } as Session
    const data = await getReportData("oc_por_estado", session, {})
    // PO-1 has confirmedAt: null, PO-2 has confirmedAt set
    expect(data.rows[0]?.[6]).toBe("") // confirmedAt empty for PO-1
    expect(data.rows[1]?.[6]).toBe("05-01-2026") // confirmedAt for PO-2
  })

  // ── Scoped session edge cases ────────────────────────────────────────

  it("gasto_faena scoped to specific worksite", async () => {
    mockIsGlobalRole.mockReturnValue(false)
    mockVisibleWorksiteIds.mockReturnValue(["ws-1"])
    const session = { user: { id: "user-1", email: "user@test.com" } } as Session
    const data = await getReportData("gasto_faena", session, { worksiteId: "ws-1" })
    expect(data.filenameBase).toBe("gasto-por-faena")
    // Mock returns hardcoded data regardless; exercises both wsScope and wsFilter
    expect(data.rows).toHaveLength(2)
  })

  it("items_sin_oc scoped to specific worksite", async () => {
    mockIsGlobalRole.mockReturnValue(false)
    mockVisibleWorksiteIds.mockReturnValue(["ws-1"])
    const session = { user: { id: "user-1", email: "user@test.com" } } as Session
    const data = await getReportData("items_sin_oc", session, { worksiteId: "ws-1" })
    expect(data.filenameBase).toBe("items-sin-oc")
    expect(data.rows).toHaveLength(2)
  })

  it("oc_por_estado scoped to specific worksite", async () => {
    mockIsGlobalRole.mockReturnValue(false)
    mockVisibleWorksiteIds.mockReturnValue(["ws-1"])
    const session = { user: { id: "user-1", email: "user@test.com" } } as Session
    const data = await getReportData("oc_por_estado", session, { worksiteId: "ws-1" })
    expect(data.filenameBase).toBe("oc-por-estado")
    expect(data.rows).toHaveLength(2)
  })
})
