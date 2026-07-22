import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockFindMany = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}))

vi.mock("@/lib/auth/scope", () => ({
  canAccessWorksite: vi.fn(() => true),
  worksiteScopeSql: vi.fn(() => undefined),
}))

vi.mock("@/db", () => ({
  db: {
    query: {
      fuelLoads: {
        findMany: (...args: unknown[]) => mockFindMany(...args),
      },
      systemSettings: { findFirst: vi.fn() },
    },
  },
}))

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/id", () => ({ nanoid: () => "id-new" }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

vi.mock("exceljs", () => ({
  Workbook: class {
    addWorksheet() {
      return {
        columns: [],
        getRow: () => ({ font: {}, fill: {} }),
        addRow: () => ({ font: {} }),
        getColumn: () => ({ numFmt: "" }),
      }
    }
    xlsx = { writeBuffer: async () => Buffer.from("xlsx") }
  },
  default: {
    Workbook: class {
      addWorksheet() {
        return {
          columns: [],
          getRow: () => ({ font: {}, fill: {} }),
          addRow: () => ({ font: {} }),
          getColumn: () => ({ numFmt: "" }),
        }
      }
      xlsx = { writeBuffer: async () => Buffer.from("xlsx") }
    },
  },
}))

import { exportFuelLoadsXlsxAction } from "./actions"

describe("exportFuelLoadsXlsxAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequirePermission.mockResolvedValue({
      user: { id: "u-1", permissions: ["combustibles:export"], isGlobal: true, worksiteIds: [] },
    })
  })

  it("reads one extra row to cap the Excel export and report truncation", async () => {
    mockFindMany.mockResolvedValue(Array.from({ length: 10_001 }, (_, index) => ({
      id: `load-${index}`,
      loadDate: "2026-06-01",
      month: "2026-06",
      serviceType: "TCT",
      vehicle: { plate: "AA-BB-11" },
      supplier: { name: "Proveedor" },
      worksite: { name: "Faena" },
      product: "PETROLEO DIESEL",
      receiptNumber: null,
      liters: 1,
      iecFixed: 0,
      iecVariable: 0,
      baseAmount: 1,
      iecTotal: 0,
      ivaAmount: 0,
      totalAmount: 1,
      status: "registered",
    })))

    const result = await exportFuelLoadsXlsxAction()

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ limit: 10_001 }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.truncated).toBe(true)
      expect(result.data.rowLimit).toBe(10_000)
    }
  })
})
