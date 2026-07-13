import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"
import { buildTaeImportReport, renderTaeImportReportXlsx, type VehicleCatalogEntry, type WorkerCatalogEntry } from "./tae-import-report"
import type { ParsedTaeLegacyRow } from "./tae-import"

function row(overrides: Partial<ParsedTaeLegacyRow>): ParsedTaeLegacyRow {
  return {
    rowIndex: 2,
    legacySourceId: "1",
    worksiteName: "MASISA",
    loadedAt: "2026-07-01T08:38:32.100Z",
    loadingPointName: "TAE",
    supervisorName: "Luis Riquelme",
    driverName: "Carlos Norambuena",
    equipmentCode: "KA-90",
    meterReading: 2098,
    meterRaw: "2098",
    liters: 118,
    removedSealNumber: "0504",
    installedSealNumber: "0507",
    notes: null,
    evidenceUrls: { odometer: null, liter_meter: null, removed_seal: null, installed_seal: null },
    rawRow: {},
    ...overrides,
  }
}

const vehicles: VehicleCatalogEntry[] = [
  { id: "veh-1", code: "KA-90", plate: "AAAA-11", worksiteName: "Masisa" },
  { id: "veh-2", code: "KA-91", plate: "BBBB-22", worksiteName: "Masisa" },
]

const workers: WorkerCatalogEntry[] = [
  { id: "wk-1", name: "Carlos Norambuena", worksiteId: "ws-masisa", worksiteName: "Masisa" },
  { id: "wk-2", name: "Luis Riquelme", worksiteId: "ws-masisa", worksiteName: "Masisa" },
]

const worksites = [{ id: "ws-masisa", name: "Masisa" }, { id: "ws-pacifico", name: "Pacifico" }]

describe("buildTaeImportReport", () => {
  it("matches an exact equipment code and worker names", () => {
    const report = buildTaeImportReport({ rows: [row({})], errors: [], worksites, vehicles, workers })
    expect(report.equipment[0]).toMatchObject({ legacyCode: "KA-90", confidence: "exacta", matchedVehicleId: "veh-1" })
    expect(report.drivers[0]).toMatchObject({ legacyName: "Carlos Norambuena", confidence: "exacta", matchedWorkerId: "wk-1" })
    expect(report.supervisors[0]).toMatchObject({ legacyName: "Luis Riquelme", confidence: "exacta", matchedWorkerId: "wk-2" })
  })

  it("suggests a fuzzy equipment match for a typo'd code and flags codes with no match", () => {
    const report = buildTaeImportReport({ rows: [row({ equipmentCode: "KA90" }), row({ rowIndex: 3, equipmentCode: "ZZ-999" })], errors: [], worksites, vehicles, workers })
    const typo = report.equipment.find((item) => item.legacyCode === "KA90")
    expect(typo?.matchedVehicleId).toBe("veh-1")
    expect(typo?.confidence).not.toBe("sin_match")
    const noMatch = report.equipment.find((item) => item.legacyCode === "ZZ-999")
    expect(noMatch?.confidence).toBe("sin_match")
    expect(noMatch?.matchedVehicleId).toBeNull()
  })

  it("resolves the Fase 0 worksite aliases, including MININCO -> Pacifico", () => {
    const report = buildTaeImportReport({
      rows: [row({ worksiteName: "SANTA FE" }), row({ rowIndex: 3, worksiteName: "MININCO" })],
      errors: [], worksites, vehicles, workers,
    })
    const mininco = report.worksites.find((item) => item.legacyName === "MININCO")
    expect(mininco?.resolvedName).toBe("Pacifico")
    expect(mininco?.worksiteId).toBe("ws-pacifico")
    const santaFe = report.worksites.find((item) => item.legacyName === "SANTA FE")
    expect(santaFe?.resolvedName).toBe("Santa Fe Gruas")
    expect(santaFe?.worksiteId).toBeNull() // no está en el catálogo de prueba
  })

  it("flags seal continuity breaks and rows with missing readings/seals", () => {
    const report = buildTaeImportReport({
      rows: [
        row({ rowIndex: 2, loadedAt: "2026-07-01T00:00:00.000Z", installedSealNumber: "0507" }),
        row({ rowIndex: 3, loadedAt: "2026-07-02T00:00:00.000Z", removedSealNumber: "9999", meterReading: null, meterRaw: "Sin Odometro" }),
      ],
      errors: [], worksites, vehicles, workers,
    })
    expect(report.sealObservations).toEqual([
      { equipmentCode: "KA-90", previousRowIndex: 2, nextRowIndex: 3, previousInstalledSeal: "0507", nextRemovedSeal: "9999" },
    ])
    expect(report.missingReadingRows).toEqual([{ rowIndex: 3, equipmentCode: "KA-90", meterRaw: "Sin Odometro" }])
  })

  it("renders a readable XLSX workbook with one sheet per dimension", async () => {
    const report = buildTaeImportReport({ rows: [row({})], errors: [{ rowIndex: 5, field: "Litros", message: "Fila incompleta" }], worksites, vehicles, workers })
    const buffer = await renderTaeImportReportXlsx(report)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as never)
    expect(wb.worksheets.map((sheet) => sheet.name)).toEqual([
      "Resumen", "Faenas", "Equipos", "Conductores", "Supervisores", "Errores", "Continuidad de sello", "Lecturas observadas", "Sellos faltantes",
    ])
    expect(wb.getWorksheet("Equipos")?.getRow(2).getCell(1).value).toBe("KA-90")
  })
})
