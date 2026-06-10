import ExcelJS from "exceljs"
import { describe, it, expect, vi } from "vitest"

import { buildXlsxBuffer } from "@/lib/reports/export"
import { buildTrazabilidadReportData } from "@/lib/services/trazabilidad-export-format"

vi.mock("@/lib/auth/auth", () => ({ auth: vi.fn() }))

describe("trazabilidad XLSX export", () => {
  it("builds workbook-compatible report data", async () => {
    const report = buildTrazabilidadReportData([
      {
        productName: "Producto, con coma",
        productSku: "SKU-001",
        worksiteName: "Faena Mininco",
        requestCode: "SO/2026/0001",
        requested: 4,
        approved: null,
        inOc: 2,
        received: 1,
        status: "approved",
        alert: true,
      },
    ])

    const buffer = await buildXlsxBuffer(report)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(buffer) as never)

    const worksheet = workbook.getWorksheet("Trazabilidad")
    expect(worksheet).toBeDefined()
    expect(worksheet?.getRow(1).values).toEqual([
      undefined,
      "Producto",
      "SKU",
      "Faena",
      "Solicitud",
      "Solicitado",
      "Aprobado",
      "En OC",
      "Recibido",
      "Estado",
      "Alerta",
    ])
    expect(worksheet?.getCell("A2").value).toBe("Producto, con coma")
    expect(worksheet?.getCell("D2").value).toBe("SO/2026/0001")
    expect(worksheet?.getCell("F2").value).toBe("")
    expect(worksheet?.getCell("J2").value).toBe("Sí")
  })
})
