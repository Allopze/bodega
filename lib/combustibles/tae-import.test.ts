import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"
import { parseTaeLegacyExcel, parseTaeLegacyRecord } from "./tae-import"

async function fixture(liters: number | string = 118) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Cargas consolidadas")
  sheet.addRow(["ID", "Faena", "Fecha y hora", "Lugar de carga", "Supervisor / líder", "Conductor", "Equipo", "Odómetro", "Imagen odómetro", "Litros", "Imagen medidor de litros", "N.º sello retirado", "Imagen sello retirado", "N.º sello instalado", "Imagen sello instalado", "Observaciones"])
  sheet.addRow([1, "MASISA", new Date("2026-07-01T08:38:32.100Z"), "TAE", "Luis Riquelme", "Carlos Norambuena", "KA-90", 2098, "https://drive/odo", liters, "https://drive/liters", "0504", "https://drive/removed", "0507", "https://drive/installed", "ok"])
  return workbook.xlsx.writeBuffer()
}

describe("parseTaeLegacyExcel", () => {
  it("parses the TAE manual format while preserving code, seals and evidence URLs", async () => {
    const result = await parseTaeLegacyExcel(await fixture())
    expect(result.errors).toEqual([])
    expect(result.rows[0]).toMatchObject({ legacySourceId: "1", worksiteName: "MASISA", equipmentCode: "KA-90", liters: 118, removedSealNumber: "0504", installedSealNumber: "0507" })
    expect(result.rows[0]?.evidenceUrls.odometer).toBe("https://drive/odo")
  })

  it("observes the malformed liters value instead of coercing it", async () => {
    const result = await parseTaeLegacyExcel(await fixture("Q91"))
    expect(result.rows).toHaveLength(0)
    expect(result.errors[0]).toMatchObject({ field: "Litros" })
  })

  it("can reparse a persisted raw row with the same validation contract", () => {
    const result = parseTaeLegacyRecord({
      ID: 42,
      Faena: "MASISA",
      "Fecha y hora": "2026-07-01T08:38:32.100Z",
      "Lugar de carga": "TAE",
      "Supervisor / líder": "Luis Riquelme",
      Conductor: "Carlos Norambuena",
      Equipo: "KA-90",
      Odómetro: "Sin odómetro",
      Litros: 118,
    }, 43)

    expect(result.error).toBeNull()
    expect(result.row).toMatchObject({ rowIndex: 43, legacySourceId: "42", meterReading: null, meterRaw: "Sin odómetro" })
  })
})
