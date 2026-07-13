import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"
import { parseTaeLegacyExcel } from "./tae-import"

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
})
