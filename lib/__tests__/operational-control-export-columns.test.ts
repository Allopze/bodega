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
  capabilities: ["fuel", "inspections"],
  inspectionCount: 2,
}

function keys(cols: ReturnType<typeof buildOperationalAssetExportColumns>) {
  return cols.map((column) => column.key)
}

describe("operational-control export", () => {
  it("exports only fleet fields and permitted inspection counts", () => {
    expect(keys(buildOperationalAssetExportColumns(true))).toEqual([
      "key", "kind", "code", "name", "worksite", "status", "inspections",
    ])
    expect(keys(buildOperationalAssetExportColumns(false))).toEqual([
      "key", "kind", "code", "name", "worksite", "status",
    ])
  })

  it("exports the human status label and omits inspection data without access", () => {
    expect(buildOperationalAssetExportRow(asset, true)).toMatchObject({
      status: "En mantención",
      inspections: 2,
    })
    expect(buildOperationalAssetExportRow(asset, false)).not.toHaveProperty("inspections")
  })
})
