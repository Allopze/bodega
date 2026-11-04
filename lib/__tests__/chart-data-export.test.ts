import ExcelJS from "exceljs"
import type { Session } from "next-auth"
import { describe, expect, it, vi } from "vitest"

// La hoja «Metadatos» consulta las faenas con la base; un usuario global no la toca, pero el módulo la importa.
vi.mock("@/db", () => ({ db: {} }))

import {
  CHART_EXPORT_LIMITS,
  CHART_EXPORT_PERMISSIONS,
  buildChartDataWorkbookBase64,
  chartDataExportSchema,
  chartExportFilename,
  chartExportScreenNote,
} from "@/lib/reports/chart-data-export"

const session = { user: { id: "u1", email: "gerencia@chome.cl", isGlobal: true, worksiteIds: [], permissions: ["combustibles:export"] } } as unknown as Session

describe("chartExportFilename", () => {
  it("deriva del título del gráfico más el día, sin tildes ni signos", () => {
    expect(chartExportFilename("Rendimiento mensual en km/L", "2026-11-03")).toBe("rendimiento_mensual_en_km_l_2026-11-03.xlsx")
    expect(chartExportFilename("Litros por mes, según de dónde salió", "2026-11-03")).toBe("litros_por_mes_segun_de_donde_salio_2026-11-03.xlsx")
  })

  it("un título sin letras ni números no deja un nombre vacío", () => {
    expect(chartExportFilename("¿¿??", "2026-11-03")).toBe("grafico_2026-11-03.xlsx")
  })

  it("un título largo se recorta sin dejar un guion bajo colgando", () => {
    const name = chartExportFilename(`${"Dato ".repeat(40)}final`, "2026-11-03")

    expect(name.endsWith("_2026-11-03.xlsx")).toBe(true)
    expect(name).not.toMatch(/__/)
    expect(name.length).toBeLessThanOrEqual(60 + "_2026-11-03.xlsx".length)
  })
})

describe("chartDataExportSchema", () => {
  const base = { permission: "combustibles:export", title: "Litros por mes", headers: ["Mes", "Litros"], rows: [["Ago", 100]] }

  it("acepta la tabla de un gráfico con su permiso de exportar", () => {
    expect(chartDataExportSchema.safeParse(base).success).toBe(true)
    expect(chartDataExportSchema.safeParse({ ...base, rows: [["Ago", null], ["Sep", 0]], notes: ["Sin datos del proveedor en sep-2026."] }).success).toBe(true)
  })

  it("sólo valen los permisos de exportación general: ni uno inventado, ni uno de ver, ni los sensibles", () => {
    for (const permission of ["combustibles:view", "admin:all", "combustibles:export_sensitive", "prevention:privacy:export_subject", ""]) {
      expect(chartDataExportSchema.safeParse({ ...base, permission }).success, permission).toBe(false)
    }
    for (const permission of CHART_EXPORT_PERMISSIONS) {
      expect(chartDataExportSchema.safeParse({ ...base, permission }).success, permission).toBe(true)
    }
  })

  it("acota el tamaño: la acción no es un conversor de archivos arbitrarios", () => {
    const wide = Array.from({ length: CHART_EXPORT_LIMITS.columns + 1 }, (_, i) => `c${i}`)
    const tall = Array.from({ length: CHART_EXPORT_LIMITS.rows + 1 }, () => ["x"])

    expect(chartDataExportSchema.safeParse({ ...base, headers: wide }).success).toBe(false)
    expect(chartDataExportSchema.safeParse({ ...base, rows: tall }).success).toBe(false)
    expect(chartDataExportSchema.safeParse({ ...base, rows: [["x".repeat(CHART_EXPORT_LIMITS.cell + 1)]] }).success).toBe(false)
    expect(chartDataExportSchema.safeParse({ ...base, title: "t".repeat(CHART_EXPORT_LIMITS.title + 1) }).success).toBe(false)
    expect(chartDataExportSchema.safeParse({ ...base, title: "  " }).success).toBe(false)
    expect(chartDataExportSchema.safeParse({ ...base, headers: [] }).success).toBe(false)
  })

  it("las celdas son texto, número o vacío: un objeto no pasa", () => {
    expect(chartDataExportSchema.safeParse({ ...base, rows: [[{ a: 1 }]] }).success).toBe(false)
    expect(chartDataExportSchema.safeParse({ ...base, rows: [[Number.NaN]] }).success).toBe(false)
  })
})

async function load(base64: string) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(base64, "base64") as unknown as ArrayBuffer)
  return workbook
}

describe("buildChartDataWorkbookBase64", () => {
  const input = chartDataExportSchema.parse({
    permission: "combustibles:export",
    title: "Rendimiento mensual en km/L",
    headers: ["Mes", "Rendimiento (km/L)", "Observación"],
    rows: [["Agosto 2026", 2.5, "n = 8"], ["Septiembre 2026", null, "Sin datos del proveedor"], ["Octubre 2026", 2.8]],
    notes: ["Sin datos del proveedor en sep-2026: las cifras de Copec no incluyen ese mes."],
  })

  it("la hoja lleva exactamente las filas de la tabla: números como números, vacíos como vacíos", async () => {
    const workbook = await load(await buildChartDataWorkbookBase64(session, input))
    const sheet = workbook.worksheets[0]!

    // ExcelJS rechaza «/» en un nombre de hoja: el saneado de `safeWorksheetName` lo vuelve espacio.
    expect(sheet.name).toBe("Rendimiento mensual en km L")
    expect(sheet.getRow(1).values).toEqual([undefined, "Mes", "Rendimiento (km/L)", "Observación"])
    expect(sheet.getRow(2).getCell(2).value).toBe(2.5)
    expect(typeof sheet.getRow(2).getCell(2).value).toBe("number")
    expect(sheet.getRow(3).getCell(1).value).toBe("Septiembre 2026")
    // Una celda sin dato sale vacía (el constructor común escribe «» para null, como el resto de las exportaciones).
    expect(sheet.getRow(3).getCell(2).value).toBe("")
    // La fila corta se completa hasta el ancho de los encabezados.
    expect(sheet.getRow(4).getCell(3).value).toBe("")
    expect(sheet.rowCount).toBe(4)
  })

  it("un texto que empieza como fórmula se neutraliza: el libro no ejecuta lo que vino del navegador", async () => {
    const hostile = chartDataExportSchema.parse({ ...input, rows: [["=HYPERLINK(\"http://x\",\"a\")", "+1", "@SUM(1)"]] })
    const sheet = (await load(await buildChartDataWorkbookBase64(session, hostile))).worksheets[0]!

    expect(String(sheet.getRow(2).getCell(1).value).startsWith("'=")).toBe(true)
    expect(String(sheet.getRow(2).getCell(2).value).startsWith("'+")).toBe(true)
    expect(String(sheet.getRow(2).getCell(3).value).startsWith("'@")).toBe(true)
  })

  it("«Metadatos» dice quién exportó, que es una copia de la pantalla y trae el aviso de cobertura", async () => {
    const meta = (await load(await buildChartDataWorkbookBase64(session, input))).getWorksheet("Metadatos")!
    const entries: Array<[string, string]> = []
    meta.eachRow((row) => entries.push([String(row.getCell(1).value), String(row.getCell(2).value)]))

    expect(entries).toContainEqual(["Generado por", "gerencia@chome.cl"])
    expect(entries).toContainEqual(["Filas incluidas", "3"])
    expect(entries).toContainEqual(["Nota", chartExportScreenNote("Rendimiento mensual en km/L")])
    expect(entries).toContainEqual(["Nota", "Sin datos del proveedor en sep-2026: las cifras de Copec no incluyen ese mes."])
  })
})
