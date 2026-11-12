import ExcelJS from "exceljs"
import JSZip from "jszip"
import { describe, expect, it } from "vitest"
import { loadXlsxTolerant, unprefixSpreadsheetXml } from "./xlsx-normalize"

const SPREADSHEETML = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"

/**
 * Reproduce lo que escribe OpenXML SDK (la plantilla de equipos completada del
 * 2026-11-11): el espacio de nombres principal con prefijo `x:` en cada etiqueta.
 */
async function prefixedWorkbook(rows: Array<Array<string | number>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Equipos")
  for (const row of rows) sheet.addRow(row)
  const zip = await JSZip.loadAsync(Buffer.from(await workbook.xlsx.writeBuffer()))
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !entry.name.endsWith(".xml")) continue
    const xml = await entry.async("string")
    if (!xml.includes(`xmlns="${SPREADSHEETML}"`)) continue
    zip.file(entry.name, xml
      .replace(`xmlns="${SPREADSHEETML}"`, `xmlns:x="${SPREADSHEETML}"`)
      // Sólo etiquetas sin prefijo propio (las de extensiones, `mc:`/`x14ac:`, no se tocan).
      .replace(/<(\/?)([A-Za-z][\w.-]*)(?=[\s>/])/g, "<$1x:$2"))
  }
  return zip.generateAsync({ type: "nodebuffer" })
}

describe("loadXlsxTolerant", () => {
  it("lee una planilla con el espacio de nombres prefijado que ExcelJS solo rechaza", async () => {
    const buffer = await prefixedWorkbook([["Código", "Patente"], ["KRR-009", "PWTD-82"]])
    await expect(new ExcelJS.Workbook().xlsx.load(buffer as never)).rejects.toThrow()

    const workbook = await loadXlsxTolerant(new Uint8Array(buffer))
    expect(workbook).not.toBeNull()
    const sheet = workbook!.getWorksheet("Equipos")!
    expect(sheet.getRow(2).getCell(1).value).toBe("KRR-009")
    expect(sheet.getRow(2).getCell(2).value).toBe("PWTD-82")
  })

  it("una planilla normal se carga sin reescribirla", async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet("Hoja").addRow(["a", 1])
    const loaded = await loadXlsxTolerant(new Uint8Array(await workbook.xlsx.writeBuffer()))
    expect(loaded?.getWorksheet("Hoja")?.getRow(1).getCell(2).value).toBe(1)
  })

  it("algo que no es un zip devuelve null", async () => {
    expect(await loadXlsxTolerant(new TextEncoder().encode("a,b,c"))).toBeNull()
  })

  it("quita sólo el prefijo del espacio de nombres principal", () => {
    const xml = `<x:worksheet xmlns:x="${SPREADSHEETML}" xmlns:mc="m"><x:sheetData/><mc:Choice/></x:worksheet>`
    expect(unprefixSpreadsheetXml(xml)).toBe(`<worksheet xmlns="${SPREADSHEETML}" xmlns:mc="m"><sheetData/><mc:Choice/></worksheet>`)
  })
})

describe("relativizeRelationshipTargets", () => {
  it("pasa a relativas las rutas absolutas de las hojas y deja la raíz igual", async () => {
    const { relativizeRelationshipTargets } = await import("./xlsx-normalize")
    expect(relativizeRelationshipTargets("xl/worksheets/_rels/sheet1.xml.rels", '<R Target="/xl/tables/table1.xml"/>')).toBe('<R Target="../tables/table1.xml"/>')
    expect(relativizeRelationshipTargets("xl/_rels/workbook.xml.rels", '<R Target="/xl/worksheets/sheet1.xml"/>')).toBe('<R Target="worksheets/sheet1.xml"/>')
    expect(relativizeRelationshipTargets("_rels/.rels", '<R Target="/xl/workbook.xml"/>')).toBe('<R Target="/xl/workbook.xml"/>')
  })
})
