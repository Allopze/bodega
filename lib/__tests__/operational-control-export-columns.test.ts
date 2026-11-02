import { describe, expect, it } from "vitest"
import { buildOperationalAssetExportColumns, buildOperationalAssetExportRow } from "@/lib/operational-control/export-columns"
import type { OperationalAsset } from "@/lib/services/operational-control"

const asset: OperationalAsset = {
  key: "vehicle:v1",
  kind: "vehicle",
  id: "v1",
  code: "KA-63",
  name: "Camión · BPDH-41",
  worksiteId: "w1",
  worksiteName: "Faena Norte",
  operationalStatus: "mantencion",
  operationalStatusLabel: "En mantención",
  stateMismatch: false,
  capabilities: ["fuel", "inspections", "maintenance"],
  maintenanceCount: 3,
  openMaintenanceCount: 1,
  inspectionCount: 2,
  inspectionCompliancePercent: 85,
  inspectionNonConforming: 2,
  inspectionPartial: 1,
  openFindings: 2,
  criticalOpenFindings: 1,
  overdueCapa: 1,
  downtimeHours: 5.5,
  maintenanceCost: 120000,
  maintenanceCostApproved: 90000,
  openSlaOverdue: 1,
  unassignedOpen: 2,
  nextPlanDue: "2026-11-15",
  nextExpiryDate: "2026-12-31",
  expiredDocumentTypes: ["SOAP"],
  gpsOdometer: 123456,
  gpsHourMeter: null,
  gpsObservedAt: "2026-10-30T10:00:00.000Z",
  gpsFuelLevel: 75,
  fuelLiters: 1200,
  fuelLoadCount: 4,
  lastFuelLoadAt: "2026-10-20T15:00:00.000Z",
  fuelPerformanceValue: 12.5,
  fuelPerformanceUnit: "km_per_liter",
  flaggedLoads: 1,
  openAnomalyCases: 2,
  criticalOpenAnomalyCases: 1,
  fuelBilledAmount: 800000,
  idleHours: 4.5,
  idlePct: 22.5,
  litersIdle: 180,
  meterMismatch: true,
}

function keys(cols: ReturnType<typeof buildOperationalAssetExportColumns>) {
  return cols.map((c) => c.key)
}

describe("buildOperationalAssetExportColumns", () => {
  it("incluye todas las columnas con las tres capacidades", () => {
    expect(keys(buildOperationalAssetExportColumns(true, true, true))).toEqual([
      "key", "kind", "code", "name", "worksite", "status",
      "maintenance", "backlog", "openSlaOverdue", "unassignedOpen", "nextPlanDue", "inspections", "inspectionCompliance", "openFindings", "criticalOpenFindings", "downtime", "approvedCost", "committedCost",
    ])
  })

  it("deja sólo las columnas base sin capacidades", () => {
    expect(keys(buildOperationalAssetExportColumns(false, false, false))).toEqual([
      "key", "kind", "code", "name", "worksite", "status",
    ])
  })

  it("incluye inspecciones sin mantención ni costos", () => {
    expect(keys(buildOperationalAssetExportColumns(false, true, false))).toEqual([
      "key", "kind", "code", "name", "worksite", "status",
      "inspections", "inspectionCompliance", "openFindings", "criticalOpenFindings",
    ])
  })

  it("oculta el costo de mantención sin vista de mantención, aunque tenga permiso de costos", () => {
    expect(keys(buildOperationalAssetExportColumns(false, true, true))).toEqual([
      "key", "kind", "code", "name", "worksite", "status",
      "inspections", "inspectionCompliance", "openFindings", "criticalOpenFindings",
    ])
  })

  it("incluye las columnas de combustible y sus costos con las cuatro capacidades", () => {
    expect(keys(buildOperationalAssetExportColumns(true, true, true, true))).toEqual([
      "key", "kind", "code", "name", "worksite", "status",
      "fuelLiters", "fuelPerformance", "flaggedLoads", "openAnomalyCases", "idlePct", "litersIdle",
      "maintenance", "backlog", "openSlaOverdue", "unassignedOpen", "nextPlanDue", "inspections", "inspectionCompliance", "openFindings", "criticalOpenFindings", "downtime",
      "fuelCost", "approvedCost", "committedCost", "operationalCost",
    ])
  })

  it("incluye CAPA vencidas sólo con su capacidad", () => {
    expect(keys(buildOperationalAssetExportColumns(true, true, true, false, true))).toEqual([
      "key", "kind", "code", "name", "worksite", "status",
      "maintenance", "backlog", "openSlaOverdue", "unassignedOpen", "nextPlanDue", "inspections", "inspectionCompliance", "openFindings", "criticalOpenFindings", "overdueCapa", "downtime", "approvedCost", "committedCost",
    ])
  })

  it("no incluye CAPA si falta la vista de inspecciones", () => {
    expect(keys(buildOperationalAssetExportColumns(true, false, true, false, true))).toEqual([
      "key", "kind", "code", "name", "worksite", "status",
      "maintenance", "backlog", "openSlaOverdue", "unassignedOpen", "nextPlanDue", "downtime", "approvedCost", "committedCost",
    ])
  })

  it("incluye combustible sin costos", () => {
    expect(keys(buildOperationalAssetExportColumns(false, false, false, true))).toEqual([
      "key", "kind", "code", "name", "worksite", "status",
      "fuelLiters", "fuelPerformance", "flaggedLoads", "openAnomalyCases", "idlePct", "litersIdle",
    ])
  })

  it("incluye vencimiento y telemetría con flota:view", () => {
    expect(keys(buildOperationalAssetExportColumns(true, false, true, false, false, true))).toEqual([
      "key", "kind", "code", "name", "worksite", "status",
      "nextExpiryDate", "expiredDocuments", "gpsOdometer", "gpsHourMeter", "gpsObservedAt", "gpsFuelLevel", "meterMismatch",
      "maintenance", "backlog", "openSlaOverdue", "unassignedOpen", "nextPlanDue", "downtime", "approvedCost", "committedCost",
    ])
  })
})

describe("buildOperationalAssetExportRow", () => {
  it("exporta el estado con etiqueta humana, no el enum crudo", () => {
    const row = buildOperationalAssetExportRow(asset, true, true, true)
    expect(row.status).toBe("En mantención")
  })

  it("omite claves de mantención, inspección y costo sin capacidad", () => {
    const row = buildOperationalAssetExportRow(asset, false, false, false)
    expect(row).not.toHaveProperty("maintenance")
    expect(row).not.toHaveProperty("backlog")
    expect(row).not.toHaveProperty("inspections")
    expect(row).not.toHaveProperty("inspectionCompliance")
    expect(row).not.toHaveProperty("openFindings")
    expect(row).not.toHaveProperty("criticalOpenFindings")
    expect(row).not.toHaveProperty("overdueCapa")
    expect(row).not.toHaveProperty("openSlaOverdue")
    expect(row).not.toHaveProperty("unassignedOpen")
    expect(row).not.toHaveProperty("nextPlanDue")
    expect(row).not.toHaveProperty("downtime")
    expect(row).not.toHaveProperty("approvedCost")
    expect(row).not.toHaveProperty("committedCost")
  })

  it("omite las claves de costo sin vista de mantención, aunque tenga permiso de costos", () => {
    const row = buildOperationalAssetExportRow(asset, false, true, true)
    expect(row).not.toHaveProperty("approvedCost")
    expect(row).not.toHaveProperty("committedCost")
  })

  it("incluye costo null para equipos de servicio", () => {
    const equipment: OperationalAsset = {
      ...asset,
      kind: "service_equipment",
      key: "service_equipment:e1",
      maintenanceCost: null,
      maintenanceCostApproved: null,
    }
    const row = buildOperationalAssetExportRow(equipment, true, true, true)
    expect(row.approvedCost).toBeNull()
    expect(row.committedCost).toBeNull()
  })

  it("exporta SLA, responsable y próximo plan", () => {
    const row = buildOperationalAssetExportRow(asset, true, false, true)
    expect(row).toMatchObject({
      openSlaOverdue: 1,
      unassignedOpen: 2,
      nextPlanDue: "2026-11-15",
      approvedCost: 90000,
      committedCost: 120000,
    })
  })

  it("exporta litros, rendimiento y costos de combustible", () => {
    const row = buildOperationalAssetExportRow(asset, true, true, true, true)
    expect(row).toMatchObject({
      fuelLiters: 1200,
      fuelPerformance: "12,5 km/L",
      flaggedLoads: 1,
      openAnomalyCases: 2,
      idlePct: 22.5,
      litersIdle: 180,
      fuelCost: 800000,
      approvedCost: 90000,
      committedCost: 120000,
      operationalCost: 890000,
    })
  })

  it("omite las claves de combustible sin capacidad", () => {
    const row = buildOperationalAssetExportRow(asset, false, false, false, false)
    expect(row).not.toHaveProperty("fuelLiters")
    expect(row).not.toHaveProperty("fuelPerformance")
    expect(row).not.toHaveProperty("flaggedLoads")
    expect(row).not.toHaveProperty("openAnomalyCases")
    expect(row).not.toHaveProperty("idlePct")
    expect(row).not.toHaveProperty("litersIdle")
    expect(row).not.toHaveProperty("meterMismatch")
    expect(row).not.toHaveProperty("fuelCost")
    expect(row).not.toHaveProperty("operationalCost")
  })

  it("exporta cumplimiento, hallazgos y CAPA vencidas con sus capacidades", () => {
    const row = buildOperationalAssetExportRow(asset, false, true, false, false, true)
    expect(row).toMatchObject({
      inspections: 2,
      inspectionCompliance: 85,
      openFindings: 2,
      criticalOpenFindings: 1,
      overdueCapa: 1,
    })
  })

  it("omite CAPA vencidas sin la capacidad de CAPA, pero conserva los hallazgos", () => {
    const row = buildOperationalAssetExportRow(asset, false, true, false, false, false)
    expect(row).not.toHaveProperty("overdueCapa")
    expect(row.openFindings).toBe(2)
    expect(row.criticalOpenFindings).toBe(1)
  })

  it("omite CAPA vencidas si falta la vista de inspecciones", () => {
    const row = buildOperationalAssetExportRow(asset, false, false, false, false, true)
    expect(row).not.toHaveProperty("overdueCapa")
  })

  it("exporta vencimiento y telemetría con flota:view", () => {
    const row = buildOperationalAssetExportRow(asset, true, false, true, false, false, true)
    expect(row).toMatchObject({
      nextExpiryDate: "2026-12-31",
      expiredDocuments: "SOAP",
      gpsOdometer: 123456,
      gpsHourMeter: null,
      gpsObservedAt: "2026-10-30T10:00:00.000Z",
      gpsFuelLevel: 75,
      meterMismatch: "Revisar",
    })
  })

  it("omite vencimiento y telemetría sin flota:view", () => {
    const row = buildOperationalAssetExportRow(asset, true, false, true)
    expect(row).not.toHaveProperty("nextExpiryDate")
    expect(row).not.toHaveProperty("gpsOdometer")
  })
})
