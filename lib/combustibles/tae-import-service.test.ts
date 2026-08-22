import { describe, expect, it } from "vitest"
import { buildTaeImportReport } from "./tae-import-report"
import { buildTaeImportPlan, buildTaeImportReview, safeTaeEvidenceUrl, vehicleMappingKey, workerMappingKey, type TaeImportMappings } from "./tae-import-service"
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
    expect(safeTaeEvidenceUrl("https://plataforma.portalchome.cl/photo")).toBe("https://plataforma.portalchome.cl/photo")
    expect(safeTaeEvidenceUrl("javascript:alert(1)")).toBeNull()
    expect(safeTaeEvidenceUrl("not-a-url")).toBeNull()
  })
  // CO-040: sin allowlist de host, cualquier URL con protocolo válido pasaba
  // — el endpoint que la sirve se volvía un redirect abierto.
  it("rejects a host outside the allowlist even with a valid protocol", () => {
    expect(safeTaeEvidenceUrl("https://evil.example/photo")).toBeNull()
    expect(safeTaeEvidenceUrl("http://drive.example/photo")).toBeNull()
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

  it("carries legacySourceId and rawRow on rejected rows for later inspection", () => {
    const rows = [legacyRow({ legacySourceId: "row-42", rawRow: { Faena: "MASISA" } })]
    const report = buildTaeImportReport({ rows, errors: [], ...catalogs })
    const plan = buildTaeImportPlan(rows, report, new Set())
    expect(plan.rejected[0]).toMatchObject({ legacySourceId: "row-42", rawRow: { Faena: "MASISA" } })
  })

  it("applies a saved manual decision instead of the fuzzy match", () => {
    const rows = [legacyRow({ equipmentCode: "KA-99" })] // sin match en el catálogo fuzzy
    const report = buildTaeImportReport({ rows, errors: [], ...catalogs })
    const mappings: TaeImportMappings = {
      vehicles: new Map([[vehicleMappingKey("ws-masisa", "KA-99"), "veh-legacy-assigned"]]),
      drivers: new Map(),
      supervisors: new Map(),
    }
    const plan = buildTaeImportPlan(rows, report, undefined, mappings)
    expect(plan.planned[0]).toMatchObject({ vehicleId: "veh-legacy-assigned" })
    expect(plan.planned[0]?.observations).not.toContain("Equipo sin match confiable en la misma faena")
  })

  it("treats a decision of 'sin equivalente' (null) as resolved, not as pending review", () => {
    const rows = [legacyRow({ driverName: "Chofer Desconocido" })]
    const report = buildTaeImportReport({ rows, errors: [], ...catalogs })
    const mappings: TaeImportMappings = {
      vehicles: new Map(),
      drivers: new Map([[workerMappingKey("ws-masisa", "Chofer Desconocido"), null]]),
      supervisors: new Map(),
    }
    const plan = buildTaeImportPlan(rows, report, undefined, mappings)
    expect(plan.planned[0]?.driverWorkerId).toBeNull()
    expect(plan.planned[0]?.observations).toContain("Conductor sin equivalente (decisión manual confirmada)")
    expect(plan.planned[0]?.observations).not.toContain("Conductor conservado como texto histórico")
  })

  it("builds explicit pre-import decisions only for ambiguous identities", () => {
    const rows = [legacyRow({ equipmentCode: "SIN-EQUIVALENTE", driverName: "Chofer Desconocido" })]
    const report = buildTaeImportReport({ rows, errors: [], ...catalogs })
    const preview = buildTaeImportReview({
      rows,
      report,
      catalogs: {
        worksites: catalogs.worksites,
        vehicles: [{ ...catalogs.vehicles[0]!, worksiteId: "ws-masisa" }],
        workers: catalogs.workers,
      },
    })

    expect(preview.reviewItems.map((item) => item.kind)).toEqual(expect.arrayContaining(["vehicle", "driver"]))
    expect(preview.reviewItems.find((item) => item.kind === "vehicle")).toMatchObject({ legacyValue: "SIN-EQUIVALENTE", options: [{ id: "veh-1" }] })
    expect(preview.planned.rejectedRows).toBe(0)
  })

  it("does not ask again for a previously saved identity decision", () => {
    const rows = [legacyRow({ equipmentCode: "SIN-EQUIVALENTE" })]
    const report = buildTaeImportReport({ rows, errors: [], ...catalogs })
    const preview = buildTaeImportReview({
      rows,
      report,
      catalogs: {
        worksites: catalogs.worksites,
        vehicles: [{ ...catalogs.vehicles[0]!, worksiteId: "ws-masisa" }],
        workers: catalogs.workers,
      },
      mappings: { vehicles: new Map([[vehicleMappingKey("ws-masisa", "SIN-EQUIVALENTE"), null]]), drivers: new Map(), supervisors: new Map() },
    })

    expect(preview.reviewItems.some((item) => item.kind === "vehicle")).toBe(false)
  })
})
