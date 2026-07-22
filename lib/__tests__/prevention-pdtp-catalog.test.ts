import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  extractPdtpCatalogFromWorkbook,
  readPdtpWorkbook,
} from "@/lib/services/prevention-pdtp-catalog"

const workbookPath = path.resolve(process.cwd(), "PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx")

describe("prevention PDTP catalog extraction", () => {
  it("extracts the 2026 PDTP catalog with exact objectives and official sheet membership", async () => {
    const workbook = await readPdtpWorkbook(workbookPath)
    const catalog = extractPdtpCatalogFromWorkbook(workbook)

    expect(catalog.activities).toHaveLength(89)
    expect(catalog.activities.map((activity) => activity.n)).toEqual(
      Array.from({ length: 89 }, (_, index) => index + 1),
    )
    expect(catalog.objectives.map((objective) => objective.name)).toEqual([
      "FORTALECER EL LIDERAZGO DE SEGURIDAD Y SALUD EN EL TRABAJO",
      "MANTENER A LA EMPRESA Y SUS SUCURSALES ENTRE LOS MARGENES DE LA NORMATIVA LEGAL VIGENTE",
      "DETECTAR, EVALUAR, MEDIR Y CORREGIR CONDICIONES Y CONDUCTAS SUB-ESTANDAR",
      "REFORZAR LA CULTURA PREVENTIVA DEL PERSONAL",
      "ELEMENTOS DE PROTECCIÓN PERSONAL (EPP)",
      "CONTROLAR LA APLICACIÓN DEL PROCEDIMIENTO DE ACCIDENTES E INCIDENTES",
      "CONTROLAR LA APLICACIÓN DEL PROCEDIMIENTO DE CONTINGENCIA Y SUS INSTRUCTIVOS",
      "CAMPAÑAS DE SEGURIDAD Y SALUD EN EL TRABAJO",
    ])

    expect(catalog.sheetActivities).toMatchObject({
      pdtp_general: expect.arrayContaining([1, 89]),
      cphs: [11, 12, 13, 14],
      prf_adm_contrato: expect.arrayContaining([1, 6, 89]),
      sup_jt: expect.arrayContaining([15, 24, 76]),
      prf: expect.arrayContaining([3, 7, 89]),
      adm_contrato: [28, 72],
      subgerente: [5],
      capacitacion: [54, 55, 56, 57, 58, 59, 60, 85, 86, 87, 88, 89],
    })
    expect(catalog.sheetActivities.prf_adm_contrato).toHaveLength(76)
    expect(catalog.sheetActivities.sup_jt).toHaveLength(18)
    expect(catalog.sheetActivities.prf).toHaveLength(41)
  })

  it("preserves responsible display text and numeric weekly planned quantities", async () => {
    const workbook = await readPdtpWorkbook(workbookPath)
    const catalog = extractPdtpCatalogFromWorkbook(workbook)

    const dailyTalk = catalog.activities.find((activity) => activity.n === 38)
    expect(dailyTalk?.responsibleDisplay).toBe("Sup, JT")
    expect(dailyTalk?.schedule.some((cell) => cell.plannedQuantity === 5)).toBe(true)

    const driverReport = catalog.activities.find((activity) => activity.n === 25)
    expect(driverReport?.responsibleSlugs).toContain("conductores_operadores_choferes")
    expect(driverReport?.responsibleDisplay).toBe("Conductores, operadores y choferes")
  })

  it("extracts historical E cells with coordinates and auditable workbook metadata", async () => {
    const workbook = await readPdtpWorkbook(workbookPath)
    const catalog = extractPdtpCatalogFromWorkbook(workbook)

    expect(catalog.importedExecutions).toEqual([
      expect.objectContaining({ activityNumber: 1, month: 1, week: 4, executedQuantity: 1, sourceCell: "M14" }),
      expect.objectContaining({ activityNumber: 2, month: 2, week: 1, executedQuantity: 1, sourceCell: "O15" }),
      expect.objectContaining({ activityNumber: 6, month: 1, week: 1, executedQuantity: 1, sourceCell: "G19" }),
      expect.objectContaining({ activityNumber: 6, month: 1, week: 2, executedQuantity: 1, sourceCell: "I19" }),
      expect.objectContaining({ activityNumber: 6, month: 1, week: 3, executedQuantity: 1, sourceCell: "K19" }),
      expect.objectContaining({ activityNumber: 6, month: 1, week: 4, executedQuantity: 1, sourceCell: "M19" }),
    ])
    expect(catalog.metadata).toMatchObject({
      documentCode: "RE-36",
      indicatorType: "Proceso",
      indicatorTarget: 0.9,
      indicatorPeriodicity: "Mensual",
      measurementOwner: "Cada faena",
      elaboratedByName: "Lorena Alvarado Cornejo",
      approvedByName: "Paulette Recart Andrades",
    })
    expect(catalog.metadata?.changeControl).toEqual([
      expect.objectContaining({ date: expect.stringContaining("2026-02-12"), description: expect.stringContaining("items 3") }),
    ])
    expect(catalog.metadata?.roleLegend).toEqual([
      { code: "JDPR", label: "Jefa departamento de Prevención de Riesgos" },
      { code: "PRF", label: "Prevención de Riesgos de Faena" },
      { code: "Sup.", label: "Supervisor de Faena" },
      { code: "JT", label: "Jefe de Terreno" },
      { code: "CPHS", label: "Comité Pariatrio de Higiene y Seguridad" },
    ])
    expect(catalog.metadata?.scheduleLegend).toMatch(/cada vez que sea necesario/i)
    expect(catalog.warnings).toEqual([expect.stringContaining("fórmula")])
  })

  it("rejects missing official sheets and altered P/E structure explicitly", async () => {
    const missingSheetWorkbook = await readPdtpWorkbook(workbookPath)
    const cphs = missingSheetWorkbook.getWorksheet("CPHS")
    expect(cphs).toBeDefined()
    missingSheetWorkbook.removeWorksheet(cphs!.id)
    expect(() => extractPdtpCatalogFromWorkbook(missingSheetWorkbook)).toThrow(/no se encontro la hoja CPHS/i)

    const alteredWorkbook = await readPdtpWorkbook(workbookPath)
    alteredWorkbook.getWorksheet("PDTP GENERAL")!.getCell("F12").value = "E"
    expect(() => extractPdtpCatalogFromWorkbook(alteredWorkbook)).toThrow(/estructura PDTP alterada.*par P\/E/i)
  })

  it("reports unknown schedule values and formulas without a cached result", async () => {
    const workbook = await readPdtpWorkbook(workbookPath)
    const general = workbook.getWorksheet("PDTP GENERAL")!
    general.getCell("F14").value = "pendiente"
    general.getCell("H14").value = { formula: "1+1" }
    const catalog = extractPdtpCatalogFromWorkbook(workbook)
    expect(catalog.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/F14.*valor P\/E desconocido/i),
      expect.stringMatching(/H14.*no tiene resultado evaluable/i),
    ]))
  })
})
