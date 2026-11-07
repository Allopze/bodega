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
  capabilities: ["fuel", "inspections"],
  inspectionCount: 2,
  inspectionCompliancePercent: 85,
  inspectionNonConforming: 2,
  inspectionPartial: 1,
  openFindings: 2,
  criticalOpenFindings: 1,
  openFindingsWithWorkOrder: 1,
  openFindingsWithoutWorkOrder: 1,
  overdueCapa: 1,
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
  maintenanceCost: 50000,
  purchaseAmount: 120000,
  totalCost: 970000,
  idleHours: 4.5,
  idlePct: 22.5,
  litersIdle: 180,
  meterMismatch: true,
  openWorkOrders: 2,
  inWorkshop: true,
  workshopHours: 52.46,
}

function keys(cols: ReturnType<typeof buildOperationalAssetExportColumns>) {
  return cols.map((c) => c.key)
}

// Sin «Contrato» (el `key` interno) ni «Clase» (la hoja sólo lleva vehículos).
const BASE = ["code", "name", "worksite", "status"]
const INSPECTION_KEYS = ["inspections", "inspectionCompliance", "openFindings", "criticalOpenFindings", "openFindingsWithWorkOrder", "openFindingsWithoutWorkOrder"]
const FUEL_KEYS = ["fuelLiters", "fuelLoadCount", "lastFuelLoadAt", "fuelPerformance", "flaggedLoads", "openAnomalyCases", "criticalOpenAnomalyCases", "idlePct", "litersIdle"]
const WORK_ORDER_KEYS = ["openWorkOrders", "inWorkshop", "workshopHours", "maintenanceCost"]
const PURCHASE_KEYS = ["purchaseAmount"]
const FLEET_KEYS = ["nextExpiryDate", "expiredDocuments", "gpsOdometer", "gpsHourMeter", "gpsObservedAt", "gpsFuelLevel", "meterMismatch"]

describe("buildOperationalAssetExportColumns", () => {
  it("incluye todas las columnas con todas las capacidades", () => {
    expect(keys(buildOperationalAssetExportColumns(true, true, true, true, true))).toEqual([
      ...BASE, ...FLEET_KEYS, ...FUEL_KEYS, ...INSPECTION_KEYS, "overdueCapa", "fuelCost",
    ])
  })

  it("las columnas de OT sólo salen con la capacidad de OT, antes del costo de combustible", () => {
    expect(keys(buildOperationalAssetExportColumns(true, true, true, true, true, true))).toEqual([
      ...BASE, ...FLEET_KEYS, ...FUEL_KEYS, ...INSPECTION_KEYS, "overdueCapa", ...WORK_ORDER_KEYS, "fuelCost",
    ])
    expect(keys(buildOperationalAssetExportColumns(false, false, false, false, false, true))).toEqual([...BASE, ...WORK_ORDER_KEYS])
  })

  it("«Repuestos y servicios (OC)» sólo con purchasing:view; «Costo total» exige las tres", () => {
    // Sólo compras: la columna sale sola, sin total (faltan combustible y OT).
    expect(keys(buildOperationalAssetExportColumns(false, false, false, false, false, false, true))).toEqual([...BASE, ...PURCHASE_KEYS])
    // Sin purchasing:view no hay columna ni total, aunque combustible y OT estén completos.
    expect(keys(buildOperationalAssetExportColumns(false, true, true, false, false, true, false))).toEqual([
      ...BASE, ...FUEL_KEYS, ...WORK_ORDER_KEYS, "fuelCost",
    ])
    // Con las tres, la compra va tras la mano de obra y el total cierra la fila.
    expect(keys(buildOperationalAssetExportColumns(true, true, true, true, true, true, true))).toEqual([
      ...BASE, ...FLEET_KEYS, ...FUEL_KEYS, ...INSPECTION_KEYS, "overdueCapa", ...WORK_ORDER_KEYS, ...PURCHASE_KEYS, "fuelCost", "totalCost",
    ])
    // Sin costos de combustible tampoco hay total.
    expect(keys(buildOperationalAssetExportColumns(false, false, true, false, false, true, true))).toEqual([
      ...BASE, ...FUEL_KEYS, ...WORK_ORDER_KEYS, ...PURCHASE_KEYS,
    ])
  })

  it("rotula la mano de obra, las compras y el total con lo que miden", () => {
    const headers = Object.fromEntries(
      buildOperationalAssetExportColumns(true, true, true, true, true, true, true).map((column) => [column.key, column.header]),
    )
    expect(headers.maintenanceCost).toBe("Mano de obra / taller (OT)")
    expect(headers.purchaseAmount).toBe("Repuestos y servicios (OC)")
    expect(headers.totalCost).toBe("Costo total (combustible + mano de obra + compras)")
  })

  it("deja sólo las columnas base sin capacidades", () => {
    expect(keys(buildOperationalAssetExportColumns(false, false))).toEqual(BASE)
  })

  it("incluye inspecciones sin costos", () => {
    expect(keys(buildOperationalAssetExportColumns(true, false))).toEqual([...BASE, ...INSPECTION_KEYS])
  })

  it("oculta el costo de combustible sin vista de combustible, aunque tenga permiso de costos", () => {
    expect(keys(buildOperationalAssetExportColumns(true, true))).toEqual([...BASE, ...INSPECTION_KEYS])
  })

  it("incluye las columnas de combustible y su costo con ambas capacidades", () => {
    expect(keys(buildOperationalAssetExportColumns(true, true, true))).toEqual([
      ...BASE, ...FUEL_KEYS, ...INSPECTION_KEYS, "fuelCost",
    ])
  })

  it("incluye CAPA vencidas sólo con su capacidad", () => {
    expect(keys(buildOperationalAssetExportColumns(true, false, false, true))).toEqual([
      ...BASE, ...INSPECTION_KEYS, "overdueCapa",
    ])
  })

  it("no incluye CAPA si falta la vista de inspecciones", () => {
    expect(keys(buildOperationalAssetExportColumns(false, false, false, true))).toEqual(BASE)
  })

  it("incluye combustible sin costos", () => {
    expect(keys(buildOperationalAssetExportColumns(false, false, true))).toEqual([...BASE, ...FUEL_KEYS])
  })

  it("incluye vencimiento y telemetría con flota:view", () => {
    expect(keys(buildOperationalAssetExportColumns(false, false, false, false, true))).toEqual([...BASE, ...FLEET_KEYS])
  })
})

describe("buildOperationalAssetExportRow", () => {
  it("exporta el estado con etiqueta humana, no el enum crudo", () => {
    const row = buildOperationalAssetExportRow(asset, true, true)
    expect(row.status).toBe("En mantención")
  })

  it("no exporta la clave interna ni una columna Clase constante", () => {
    const row = buildOperationalAssetExportRow(asset, true, true)
    expect(row).not.toHaveProperty("key")
    expect(row).not.toHaveProperty("kind")
  })

  it("omite claves de inspección y costo sin capacidad", () => {
    const row = buildOperationalAssetExportRow(asset, false, false)
    expect(row).not.toHaveProperty("inspections")
    expect(row).not.toHaveProperty("inspectionCompliance")
    expect(row).not.toHaveProperty("openFindings")
    expect(row).not.toHaveProperty("criticalOpenFindings")
    expect(row).not.toHaveProperty("overdueCapa")
    expect(row).not.toHaveProperty("fuelCost")
  })

  it("no exporta claves del módulo de mantenciones retirado", () => {
    const row = buildOperationalAssetExportRow(asset, true, true, true, true, true)
    for (const key of ["maintenance", "backlog", "openSlaOverdue", "unassignedOpen", "nextPlanDue", "downtime", "approvedCost", "committedCost", "operationalCost"]) {
      expect(row).not.toHaveProperty(key)
    }
  })

  it("omite el costo de combustible sin vista de combustible, aunque tenga permiso de costos", () => {
    const row = buildOperationalAssetExportRow(asset, true, true)
    expect(row).not.toHaveProperty("fuelCost")
  })

  it("exporta litros, rendimiento y costo de combustible", () => {
    const row = buildOperationalAssetExportRow(asset, true, true, true)
    expect(row).toMatchObject({
      fuelLiters: 1200,
      fuelLoadCount: 4,
      lastFuelLoadAt: "2026-10-20T15:00:00.000Z",
      fuelPerformance: "12,5 km/L",
      flaggedLoads: 1,
      openAnomalyCases: 2,
      criticalOpenAnomalyCases: 1,
      idlePct: 22.5,
      litersIdle: 180,
      fuelCost: 800000,
    })
  })

  it("omite las claves de combustible sin capacidad", () => {
    const row = buildOperationalAssetExportRow(asset, false, false, false)
    expect(row).not.toHaveProperty("fuelLiters")
    expect(row).not.toHaveProperty("fuelPerformance")
    expect(row).not.toHaveProperty("flaggedLoads")
    expect(row).not.toHaveProperty("openAnomalyCases")
    expect(row).not.toHaveProperty("idlePct")
    expect(row).not.toHaveProperty("litersIdle")
    expect(row).not.toHaveProperty("meterMismatch")
    expect(row).not.toHaveProperty("fuelCost")
  })

  it("exporta cumplimiento, hallazgos y CAPA vencidas con sus capacidades", () => {
    const row = buildOperationalAssetExportRow(asset, true, false, false, true)
    expect(row).toMatchObject({
      inspections: 2,
      inspectionCompliance: 85,
      openFindings: 2,
      criticalOpenFindings: 1,
      openFindingsWithWorkOrder: 1,
      openFindingsWithoutWorkOrder: 1,
      overdueCapa: 1,
    })
  })

  it("omite CAPA vencidas sin la capacidad de CAPA, pero conserva los hallazgos", () => {
    const row = buildOperationalAssetExportRow(asset, true, false, false, false)
    expect(row).not.toHaveProperty("overdueCapa")
    expect(row.openFindings).toBe(2)
    expect(row.criticalOpenFindings).toBe(1)
  })

  it("omite CAPA vencidas si falta la vista de inspecciones", () => {
    const row = buildOperationalAssetExportRow(asset, false, false, false, true)
    expect(row).not.toHaveProperty("overdueCapa")
  })

  it("exporta vencimiento y telemetría con flota:view", () => {
    const row = buildOperationalAssetExportRow(asset, false, false, false, false, true)
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

  it("exporta OT abiertas, si está en taller y las horas del período con la capacidad de OT", () => {
    const row = buildOperationalAssetExportRow(asset, false, false, false, false, false, true)
    expect(row).toMatchObject({ openWorkOrders: 2, inWorkshop: "Sí", workshopHours: 52.5, maintenanceCost: 50000 })
    expect(buildOperationalAssetExportRow({ ...asset, inWorkshop: false, workshopHours: 0 }, false, false, false, false, false, true))
      .toMatchObject({ inWorkshop: "No", workshopHours: 0 })
    // Sin permiso de combustible no hay total: sólo mantención.
    expect(row).not.toHaveProperty("totalCost")
    // Con combustible y OT pero sin compras, tampoco: un total de dos series sería engañoso.
    expect(buildOperationalAssetExportRow(asset, true, true, true, true, true, true)).not.toHaveProperty("totalCost")
    expect(buildOperationalAssetExportRow(asset, true, true, true, true, true, true, true)).toMatchObject({ totalCost: 970000 })
  })

  it("exporta las compras vinculadas sólo con purchasing:view y un null si la consulta falló", () => {
    expect(buildOperationalAssetExportRow(asset, false, false, false, false, false, false, true)).toMatchObject({ purchaseAmount: 120000 })
    expect(buildOperationalAssetExportRow(asset, true, true, true, true, true, true)).not.toHaveProperty("purchaseAmount")
    const failed = buildOperationalAssetExportRow({ ...asset, purchaseAmount: null, totalCost: null }, true, true, true, true, true, true, true)
    expect(failed).toMatchObject({ purchaseAmount: null, totalCost: null })
  })

  it("una consulta de OT que falló exporta vacío, no 0", () => {
    const row = buildOperationalAssetExportRow({ ...asset, openWorkOrders: null, inWorkshop: null, workshopHours: null }, false, false, false, false, false, true)
    expect(row).toMatchObject({ openWorkOrders: null, inWorkshop: null, workshopHours: null })
  })

  it("omite las claves de OT sin la capacidad", () => {
    const row = buildOperationalAssetExportRow(asset, true, true, true, true, true)
    for (const key of WORK_ORDER_KEYS) expect(row).not.toHaveProperty(key)
  })

  it("omite vencimiento y telemetría sin flota:view", () => {
    const row = buildOperationalAssetExportRow(asset, false, false)
    expect(row).not.toHaveProperty("nextExpiryDate")
    expect(row).not.toHaveProperty("gpsOdometer")
  })
})
