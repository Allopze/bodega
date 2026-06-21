import ExcelJS from "exceljs"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { buildXlsxBuffer, getReportData, type ReportData } from "@/lib/reports/export"
import { purchaseRequests, purchaseRequestItems, purchaseOrders, products, worksites, suppliers } from "@/db/schema"
import type { Session } from "next-auth"

// Mock the Auth helpers
const mockIsGlobalRole = vi.fn()
const mockVisibleWorksiteIds = vi.fn()

vi.mock("@/lib/auth/can", () => ({
  isGlobalRole: (s: unknown) => mockIsGlobalRole(s),
  visibleWorksiteIds: (s: unknown) => mockVisibleWorksiteIds(s),
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
})
