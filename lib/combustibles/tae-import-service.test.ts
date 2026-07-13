import { describe, expect, it } from "vitest"
import { buildTaeImportReport } from "./tae-import-report"
import { buildTaeImportPlan, safeTaeEvidenceUrl } from "./tae-import-service"
import type { ParsedTaeLegacyRow } from "./tae-import"

function legacyRow(overrides: Partial<ParsedTaeLegacyRow> = {}): ParsedTaeLegacyRow {
  return {
    rowIndex: 2,
    legacySourceId: "1",
    worksiteName: "MASISA",
    loadedAt: "2026-07-01T08:00:00.000Z",
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

const catalogs = {
  worksites: [{ id: "ws-masisa", name: "Masisa" }],
  vehicles: [{ id: "veh-1", code: "KA-90", plate: "AAAA-11", worksiteName: "Masisa" }],
  workers: [
    { id: "worker-driver", name: "Carlos Norambuena", worksiteId: "ws-masisa", worksiteName: "Masisa" },
    { id: "worker-supervisor", name: "Luis Riquelme", worksiteId: "ws-masisa", worksiteName: "Masisa" },
  ],
}

describe("buildTaeImportPlan", () => {
  it("accepts only web URLs for historical evidence", () => {
    expect(safeTaeEvidenceUrl("https://drive.example/photo")).toBe("https://drive.example/photo")
    expect(safeTaeEvidenceUrl("javascript:alert(1)")).toBeNull()
    expect(safeTaeEvidenceUrl("not-a-url")).toBeNull()
  })
  it("validates a fully matched historical row", () => {
    const rows = [legacyRow()]
    const report = buildTaeImportReport({ rows, errors: [], ...catalogs })
    const plan = buildTaeImportPlan(rows, report)
    expect(plan.rejected).toEqual([])
    expect(plan.planned[0]).toMatchObject({ status: "validated", vehicleId: "veh-1", driverWorkerId: "worker-driver", supervisorWorkerId: "worker-supervisor", observations: [] })
  })

  it("imports uncertain identities as observed without inventing relational links", () => {
    const rows = [legacyRow({ driverName: "Persona histórica", meterReading: null, meterRaw: "Sin odómetro" })]
    const report = buildTaeImportReport({ rows, errors: [], ...catalogs })
    const plan = buildTaeImportPlan(rows, report)
    expect(plan.planned[0]?.status).toBe("observed")
    expect(plan.planned[0]?.driverWorkerId).toBeNull()
    expect(plan.planned[0]?.observations).toContain("Lectura no numérica o ausente")
  })

  it("rejects rows outside the importer's worksite scope", () => {
    const rows = [legacyRow()]
    const report = buildTaeImportReport({ rows, errors: [], ...catalogs })
    const plan = buildTaeImportPlan(rows, report, new Set())
    expect(plan.planned).toEqual([])
    expect(plan.rejected[0]?.message).toBe("Faena fuera del alcance autorizado")
  })
})
