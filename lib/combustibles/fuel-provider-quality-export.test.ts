import { describe, expect, it } from "vitest"
import ExcelJS from "exceljs"
import { buildFuelProviderQualityWorkbook } from "./fuel-provider-quality-export"

describe("fuel provider quality export", () => {
  it("builds an xlsx with operational fields and no raw payload column", async () => {
    const workbook = await buildFuelProviderQualityWorkbook([{
      tipo: "pendiente",
      proveedor: "aramco",
      cuenta: "fleet",
      identidad: "external:tx-1",
      codigo: "unresolved_mapping",
      motivo: "La fila fue validada pero aún no tiene mapping completo",
      producto: "ProForce Diesel B",
      patente: "SZGB72",
      fecha: "2026-08-18T12:00:00.000Z",
      litros: 42.5,
      monto: 39000,
    }])
    const buffer = await workbook.xlsx.writeBuffer()
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(buffer)
    const sheet = reopened.getWorksheet("Pendientes y rechazos")
    expect(sheet?.getRow(1).values).toEqual(expect.arrayContaining(["Tipo", "Litros", "Monto"]))
    expect(sheet?.getRow(2).getCell(10).value).toBe(42.5)
    expect(sheet?.getRow(1).values).not.toEqual(expect.arrayContaining(["Payload crudo"]))
  })
})
