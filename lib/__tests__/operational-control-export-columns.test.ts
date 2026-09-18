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
  capabilities: ["fuel", "inspections", "maintenance"],
  maintenanceCount: 3,
  openMaintenanceCount: 1,
  inspectionCount: 2,
  downtimeHours: 5.5,
  maintenanceCost: 120000,
}

function keys(cols: ReturnType<typeof buildOperationalAssetExportColumns>) {
  return cols.map((c) => c.key)
}

describe("buildOperationalAssetExportColumns", () => {
  it("incluye todas las columnas con las tres capacidades", () => {
    expect(keys(buildOperationalAssetExportColumns(true, true, true))).toEqual([
      "key", "kind", "code", "name", "worksite", "status",
      "maintenance", "backlog", "inspections", "downtime", "cost",
    ])
  })

  it("deja sólo las columnas base sin capacidades", () => {
    expect(keys(buildOperationalAssetExportColumns(false, false, false))).toEqual([
      "key", "kind", "code", "name", "worksite", "status",
    ])
  })

  it("incluye inspecciones sin mantención ni costos", () => {
    expect(keys(buildOperationalAssetExportColumns(false, true, false))).toEqual([
      "key", "kind", "code", "name", "worksite", "status", "inspections",
    ])
  })

  it("oculta el costo de mantención sin vista de mantención, aunque tenga permiso de costos", () => {
    expect(keys(buildOperationalAssetExportColumns(false, true, true))).toEqual([
      "key", "kind", "code", "name", "worksite", "status", "inspections",
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
    expect(row).not.toHaveProperty("downtime")
    expect(row).not.toHaveProperty("cost")
  })

  it("omite la clave de costo sin vista de mantención, aunque tenga permiso de costos", () => {
    const row = buildOperationalAssetExportRow(asset, false, true, true)
    expect(row).not.toHaveProperty("cost")
  })

  it("incluye costo null para equipos de servicio", () => {
    const equipment: OperationalAsset = { ...asset, kind: "service_equipment", key: "service_equipment:e1", maintenanceCost: null }
    const row = buildOperationalAssetExportRow(equipment, true, true, true)
    expect(row.cost).toBeNull()
  })
})
