import ExcelJS from "exceljs"
import type { Session } from "next-auth"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/services/spare-parts-catalog", () => ({
  listSpareParts: vi.fn(async () => [
    {
      id: "rpt-1", sku: "RPT-001", name: "Filtro de aceite", partNumber: "1R-0750", partBrand: "Caterpillar",
      unitOfMeasure: "bidon", isActive: true, preferredSupplierId: null, preferredSupplierName: null,
      lastSupplierName: "Repuestos del Sur", lastPrice: 14_000, referencePrice: 12_000,
      lastPurchasedAt: null, vehicleCount: 1, purchasedForVehicleIds: ["v-1"], vehicleMatch: null,
    },
    {
      id: "rpt-2", sku: "RPT-002", name: "Correa", partNumber: null, partBrand: null,
      unitOfMeasure: "juego", isActive: false, preferredSupplierId: null, preferredSupplierName: null,
      lastSupplierName: null, lastPrice: null, referencePrice: null,
      lastPurchasedAt: null, vehicleCount: 0, purchasedForVehicleIds: [], vehicleMatch: null,
    },
  ]),
}))
vi.mock("./unit-options", () => ({
  loadSparePartUnits: vi.fn(async () => [{ code: "bidon", label: "Bidón", isActive: true }, { code: "juego", label: "Juego", isActive: true }]),
}))
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => undefined) }))
vi.mock("@/lib/reports/export-metadata", () => ({ addExportMetadataSheet: vi.fn(async () => undefined) }))

const { exportSpareParts } = await import("./export-spare-parts")

describe("exportSpareParts", () => {
  it("lleva el precio de referencia, el último proveedor y la unidad con su nombre", async () => {
    const result = await exportSpareParts({ user: { id: "u-1", email: "a@b.cl" } } as unknown as Session, "activos")
    expect(result.rowCount).toBe(1)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(result.base64, "base64") as unknown as ArrayBuffer)
    const sheet = workbook.getWorksheet("Repuestos")!
    const headers = (sheet.getRow(1).values as unknown[]).slice(1)
    const row = Object.fromEntries(headers.map((header, index) => [header, sheet.getRow(2).getCell(index + 1).value]))
    expect(row).toMatchObject({
      SKU: "RPT-001",
      Unidad: "Bidón",
      "Último proveedor": "Repuestos del Sur",
      "Último precio (CLP)": 14_000,
      "Precio de referencia (CLP)": 12_000,
    })
  })
})
