import { describe, expect, it } from "vitest"
import ExcelJS from "exceljs"
import { buildControlImportTemplateBase64, parserHeaders, templateHeaders } from "./templates"
import { parseSupplyInputsWorkbook } from "./supply-inputs"
import { parseTelemetryWorkbook } from "./telemetry"
import type { ControlImportKind } from "./shared"

const KINDS: ControlImportKind[] = ["telemetry", "supply_inputs"]

async function load(kind: ControlImportKind) {
  const base64 = await buildControlImportTemplateBase64(kind)
  const bytes = new Uint8Array(Buffer.from(base64, "base64"))
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer)
  return { bytes, workbook }
}

describe("plantillas de importación del control", () => {
  it.each(KINDS)("%s: los encabezados son exactamente los que el parser reconoce, en la primera hoja", async (kind) => {
    const { workbook } = await load(kind)
    const headers = (workbook.worksheets[0]!.getRow(1).values as unknown[]).slice(1).map(String)
    expect(headers.slice(0, parserHeaders(kind).length)).toEqual(parserHeaders(kind))
    expect(headers).toEqual(templateHeaders(kind))
  })

  it.each(KINDS)("%s: trae la hoja «Instrucciones» con todas las columnas", async (kind) => {
    const { workbook } = await load(kind)
    const guide = workbook.getWorksheet("Instrucciones")
    expect(guide).toBeDefined()
    const described = new Set<string>()
    guide!.eachRow((row, index) => { if (index > 1) described.add(String(row.getCell(1).value)) })
    for (const header of templateHeaders(kind)) expect(described.has(header)).toBe(true)
  })

  it("la plantilla vacía se lee sin errores de columnas (ninguna fila de datos)", async () => {
    const telemetry = await parseTelemetryWorkbook((await load("telemetry")).bytes)
    expect(telemetry.fileIssue).toBeUndefined()
    expect(telemetry.totalRows).toBe(0)
    const supply = await parseSupplyInputsWorkbook((await load("supply_inputs")).bytes)
    expect(supply.fileIssue).toBeUndefined()
    expect(supply.totalRows).toBe(0)
  })
})
