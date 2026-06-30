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
})
