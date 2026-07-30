import path from "node:path"
import { beforeAll, describe, expect, it } from "vitest"
import {
  extractPdtpCatalogFromWorkbook,
  readPdtpWorkbook,
} from "@/lib/services/prevention-pdtp-catalog"

const workbookPath = path.resolve(process.cwd(), "PROGRAMA_ACTIVIDADES_DEFINITIVO.xlsx")
let baseWorkbook: Awaited<ReturnType<typeof readPdtpWorkbook>>

describe("Base PDTP 2026 definitiva", () => {
  beforeAll(async () => {
    baseWorkbook = await readPdtpWorkbook(workbookPath)
  })

  it("normaliza exactamente 87 actividades numeradas 1–89 sin 4 ni 8", () => {
    const catalog = extractPdtpCatalogFromWorkbook(baseWorkbook)
    const numbers = catalog.activities.map((activity) => activity.n)

    expect(catalog.activities).toHaveLength(87)
    expect(numbers).toEqual(Array.from({ length: 89 }, (_, index) => index + 1).filter((n) => n !== 4 && n !== 8))
    expect("objectives" in catalog).toBe(false)
    expect(Object.values(catalog.sheetActivities).flat()).not.toContain(4)
    expect(Object.values(catalog.sheetActivities).flat()).not.toContain(8)
    expect(Object.keys(catalog.sheetActivities)).toHaveLength(8)
  })

  it("importa solo P: 821 celdas, 1013 unidades y cero ejecuciones", () => {
    const catalog = extractPdtpCatalogFromWorkbook(baseWorkbook)
    const schedule = catalog.activities.flatMap((activity) => activity.schedule)

    expect(schedule).toHaveLength(821)
    expect(schedule.reduce((sum, cell) => sum + cell.plannedQuantity, 0)).toBe(1013)
    expect(catalog.importedExecutions).toEqual([])
    expect(catalog.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/ignoraron 6 celdas de ejecución/i),
    ]))
  })

  it("conserva responsables, las ocho vistas operativas y metadatos auditables", () => {
    const catalog = extractPdtpCatalogFromWorkbook(baseWorkbook)
    const dailyTalk = catalog.activities.find((activity) => activity.n === 38)

    expect(dailyTalk?.responsibleDisplay).toBe("Sup, JT")
    expect(dailyTalk?.schedule.some((cell) => cell.plannedQuantity === 5)).toBe(true)
    expect(catalog.sheetActivities).toMatchObject({
      pdtp_general: expect.arrayContaining([1, 89]),
      cphs: [11, 12, 13, 14],
      adm_contrato: [28, 72],
      subgerente: [5],
      capacitacion: [54, 55, 56, 57, 58, 59, 60, 85, 86, 87, 88, 89],
    })
    expect(catalog.metadata).toMatchObject({
      documentCode: "RE-36",
      indicatorType: "Proceso",
      indicatorTarget: 0.9,
      indicatorPeriodicity: "Mensual",
    })
    expect(catalog.metadata?.roleLegend.length).toBeGreaterThan(0)
  })

  it("rechaza una alteración de la primera pareja P/E del formato definitivo", () => {
    const general = baseWorkbook.getWorksheet("PDTP GENERAL")!
    general.getCell("E12").value = "E"
    expect(() => extractPdtpCatalogFromWorkbook(baseWorkbook)).toThrow(/estructura PDTP alterada.*par P\/E/i)
  })
})
