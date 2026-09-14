import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"
import { buildXlsxBuffer, safeWorksheetName } from "./excel-builder"
import type { ReportData } from "./types"

/**
 * `buildXlsxBuffer` es el generador Excel compartido por todos los reportes
 * de la app (recepción, compras, PDTP export/reporte de gestión/expediente
 * auditor…). Estas pruebas verifican que el archivo generado se pueda
 * volver a abrir sin errores — la mejor aproximación automatizable a "Excel
 * abre el Excel sin reparaciones" — y que texto de usuario que parece una
 * fórmula (`=SUM(...)`) se guarde como texto literal, nunca como celda de
 * fórmula evaluable.
 */
describe("buildXlsxBuffer", () => {
  it("produces a workbook that reopens cleanly with the same sheet, headers and rows", async () => {
    const report: ReportData = {
      filenameBase: "reporte-prueba",
      worksheetName: "Datos",
      headers: ["Código", "Descripción", "Cantidad"],
      rows: [
        ["A-001", "Primera fila", 10],
        ["A-002", "Segunda fila", null],
        ["A-003", "Tercera fila", undefined],
      ],
    }

    const buffer = await buildXlsxBuffer(report)
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(buffer)

    const sheet = reopened.getWorksheet("Datos")
    expect(sheet).toBeDefined()
    expect(sheet!.getRow(1).values).toEqual([undefined, "Código", "Descripción", "Cantidad"])
    expect(sheet!.getRow(2).values).toEqual([undefined, "A-001", "Primera fila", 10])
    // null/undefined se guardan como celda de texto vacía, no como el texto literal "null"/"undefined".
    expect(sheet!.getCell("C3").value).toBe("")
    expect(sheet!.getCell("C4").value).toBe("")
  })

  // `sheets` agrega hojas, no reemplaza la primaria. La regresión que esto fija: los
  // cuatro reportes que declaraban una hoja suplementaria (conciliación DTE, valorización
  // de bodega, cobranza y analítica) se descargaban sin su propia hoja de detalle.
  it("emits the primary sheet first and the declared sheets after it", async () => {
    const report: ReportData = {
      filenameBase: "reporte-multi",
      worksheetName: "Resumen",
      headers: ["Objetivo", "Avance"],
      rows: [["Objetivo 1", 0.8]],
      sheets: [
        { worksheetName: "Detalle", headers: ["Actividad"], rows: [["Actividad 1"], ["Actividad 2"]] },
      ],
    }

    const buffer = await buildXlsxBuffer(report)
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(buffer)

    expect(reopened.worksheets.map((ws) => ws.name)).toEqual(["Resumen", "Detalle"])
    expect(reopened.getWorksheet("Resumen")!.getRow(1).values).toEqual([undefined, "Objetivo", "Avance"])
    expect(reopened.getWorksheet("Resumen")!.getRow(2).values).toEqual([undefined, "Objetivo 1", 0.8])
    expect(reopened.getWorksheet("Detalle")!.rowCount).toBe(3) // header + 2 filas
  })

  it("omits the primary sheet when the report declares no top-level headers", async () => {
    const report: ReportData = {
      filenameBase: "reporte-solo-hojas",
      worksheetName: "Resumen",
      headers: [],
      rows: [],
      sheets: [
        { worksheetName: "Objetivos", headers: ["Objetivo", "Avance"], rows: [["Objetivo 1", 0.8]] },
        { worksheetName: "Detalle", headers: ["Actividad"], rows: [["Actividad 1"]] },
      ],
    }

    const buffer = await buildXlsxBuffer(report)
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(buffer)

    expect(reopened.worksheets.map((ws) => ws.name)).toEqual(["Objetivos", "Detalle"])
  })

  // Un reporte que reusa el nombre de la hoja primaria en `sheets` no puede abortar la
  // exportación: ExcelJS lanza ante nombres duplicados, así que el segundo se desambigua.
  it("disambiguates a declared sheet that repeats the primary sheet name", async () => {
    const report: ReportData = {
      filenameBase: "reporte-colision",
      worksheetName: "Resumen",
      headers: ["A"],
      rows: [["fila primaria"]],
      sheets: [{ worksheetName: "Resumen", headers: ["B"], rows: [["fila declarada"]] }],
    }

    const buffer = await buildXlsxBuffer(report)
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(buffer)

    expect(reopened.worksheets.map((ws) => ws.name)).toEqual(["Resumen", "Resumen (2)"])
  })

  it("stores user text that looks like a formula as a literal string, never as an evaluable formula cell", async () => {
    const maliciousLookingText = "=SUM(A1:A10)"
    const report: ReportData = {
      filenameBase: "reporte-seguro",
      worksheetName: "Datos",
      headers: ["Actividad"],
      rows: [[maliciousLookingText], ["+2+5"], ["-2+5"], ["@SUM(1,2)"]],
    }

    const buffer = await buildXlsxBuffer(report)
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(buffer)
    const sheet = reopened.getWorksheet("Datos")!

    for (const rowNumber of [2, 3, 4, 5]) {
      const cell = sheet.getCell(`A${rowNumber}`)
      expect(cell.type).not.toBe(ExcelJS.ValueType.Formula)
      expect(cell.formula).toBeUndefined()
    }
    // El valor se guarda con un apóstrofe inicial: es el texto literal que ExcelJS/Excel
    // interpretan como "fuerza texto", nunca la fórmula evaluable original sin marcar.
    expect(sheet.getCell("A2").value).toBe(`'${maliciousLookingText}`)
  })

  it("passes numeric cells through unchanged, never coerced to string", async () => {
    const report: ReportData = {
      filenameBase: "reporte-numerico",
      worksheetName: "Datos",
      headers: ["Cantidad"],
      rows: [[10]],
    }

    const buffer = await buildXlsxBuffer(report)
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(buffer)
    const sheet = reopened.getWorksheet("Datos")!

    const value = sheet.getRow(2).values as unknown[]
    expect(value[1]).toBe(10)
    expect(typeof value[1]).toBe("number")
  })

  it("sanea nombres de hoja derivados de datos en vez de abortar la exportación", async () => {
    // Los reportes que abren una hoja por entidad toman el nombre de datos de
    // usuario. ExcelJS lanza ante caracteres reservados, duplicados, nombre
    // vacío o >31 caracteres, y con eso se perdía el archivo completo.
    const report: ReportData = {
      filenameBase: "inventario-por-faena",
      worksheetName: "TI",
      headers: [],
      rows: [],
      sheets: [
        { worksheetName: "Planta Norte / Sur", headers: ["Código"], rows: [["A-1"]] },
        { worksheetName: "Faena [Alfa] * ?", headers: ["Código"], rows: [["A-2"]] },
        { worksheetName: "María Fernanda González Rodríguez", headers: ["Código"], rows: [["A-3"]] },
        { worksheetName: "María Fernanda González Rodrígueza", headers: ["Código"], rows: [["A-4"]] },
        { worksheetName: "", headers: ["Código"], rows: [["A-5"]] },
      ],
    }

    const buffer = await buildXlsxBuffer(report)
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(buffer)

    expect(reopened.worksheets).toHaveLength(5)
    const names = reopened.worksheets.map((w) => w.name)
    expect(new Set(names).size).toBe(5)
    for (const name of names) {
      expect(name.length).toBeGreaterThan(0)
      expect(name.length).toBeLessThanOrEqual(31)
      expect(name).not.toMatch(/[*?:\\/[\]]/)
    }
  })

  it("safeWorksheetName recorta, desambigua y respeta el nombre reservado", () => {
    const used = new Set<string>()
    expect(safeWorksheetName("Faena Norte", used)).toBe("Faena Norte")
    expect(safeWorksheetName("Faena Norte", used)).toBe("Faena Norte (2)")
    expect(safeWorksheetName("Faena Norte", used)).toBe("Faena Norte (3)")
    expect(safeWorksheetName("", new Set())).toBe("Hoja")
    expect(safeWorksheetName("History", new Set())).toBe("Historial")
    expect(safeWorksheetName("a".repeat(50), new Set())).toHaveLength(31)
  })

  it("safeWorksheetName desambigua sin distinguir mayúsculas, como ExcelJS", () => {
    // ExcelJS compara duplicados con toLowerCase(): si acá se dejaran pasar
    // como distintos, addWorksheet lanzaría y se perdería el archivo entero.
    const used = new Set<string>()
    expect(safeWorksheetName("Faena Norte", used)).toBe("Faena Norte")
    expect(safeWorksheetName("FAENA NORTE", used)).toBe("FAENA NORTE (2)")
    expect(safeWorksheetName("faena norte", used)).toBe("faena norte (3)")
  })

  it("safeWorksheetName no deja comillas simples en los extremos", () => {
    // Los dos casos que el saneado dejaba pasar por hacer el recorte de
    // comillas antes de trimear y de cortar a 31 caracteres. Excel rechaza
    // ambos y aborta la exportación completa.
    expect(safeWorksheetName("/'Faena A", new Set())).toBe("Faena A")
    const largo = safeWorksheetName("Faena Central Sector Norte Sur'B", new Set())
    expect(largo.endsWith("'")).toBe(false)
    expect(largo).toBe("Faena Central Sector Norte Sur")
  })
})

/**
 * REP-001 y REP-002 (auditoría 2026-09-14): el truncado a 10.000 filas sólo
 * viajaba en la cabecera `X-Row-Limit-Applied`, que el enlace de descarga no
 * lee, y el centro de reportes era el único exportador sin hoja de metadatos.
 */
describe("buildXlsxBuffer — trazabilidad del archivo", () => {
  const session = {
    user: {
      id: "u-1", name: "Auditor", email: "auditor@chome.cl",
      isGlobal: false, worksiteIds: ["ws-1", "ws-2"], permissions: [],
    },
    expires: "2099-01-01",
  } as unknown as Parameters<typeof buildXlsxBuffer>[1] extends infer C
    ? C extends { session: infer S } ? S : never
    : never

  const baseReport: ReportData = {
    filenameBase: "reporte-truncado",
    worksheetName: "Datos",
    headers: ["Código"],
    rows: [["OC-1"], ["OC-2"]],
  }

  async function sheetNames(buffer: ArrayBuffer): Promise<string[]> {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)
    return workbook.worksheets.map((sheet) => sheet.name)
  }

  it("agrega una hoja de advertencia cuando el reporte vino truncado", async () => {
    const buffer = await buildXlsxBuffer(
      { ...baseReport, rowLimitApplied: true },
      { session, rowLimit: 10_000 },
    )
    const names = await sheetNames(buffer)
    expect(names).toContain("Advertencias")

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)
    const warning = workbook.getWorksheet("Advertencias")!
    expect(String(warning.getRow(2).getCell(2).value)).toContain("10000")
  })

  it("no agrega advertencia cuando el reporte está completo", async () => {
    const buffer = await buildXlsxBuffer(baseReport, { session })
    expect(await sheetNames(buffer)).not.toContain("Advertencias")
  })

  it("adjunta la hoja de metadatos cuando hay sesión", async () => {
    const buffer = await buildXlsxBuffer(baseReport, {
      session, filters: { faena: "ws-1" }, from: "2026-01-01", to: "2026-01-31",
    })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)
    const metadata = workbook.getWorksheet("Metadatos")
    expect(metadata).toBeTruthy()
    const values = metadata!.getColumn(2).values.map((value) => String(value ?? ""))
    expect(values.some((value) => value.includes("auditor@chome.cl"))).toBe(true)
    expect(values.some((value) => value.includes("2026-01-01"))).toBe(true)
    expect(values.some((value) => value.includes("ws-1"))).toBe(true)
  })

  it("sin contexto se comporta como antes (sin metadatos)", async () => {
    const buffer = await buildXlsxBuffer(baseReport)
    expect(await sheetNames(buffer)).toEqual(["Datos"])
  })
})
