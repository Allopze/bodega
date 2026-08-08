import { describe, expect, it } from "vitest"
import { mergeTaeCopecChannels, type TaeCopecChannelRow } from "./tae-copec-reconciliation"

function channel(overrides: Partial<TaeCopecChannelRow> = {}): TaeCopecChannelRow {
  return {
    month: "2026-07",
    worksiteId: "ws-1",
    worksiteName: "Masisa",
    vehicleId: "vehicle-1",
    equipment: "KA-90",
    plate: "AAAA-11",
    taeLiters: 0,
    taeLoads: 0,
    tctDieselLiters: 0,
    tctBlueMaxLiters: 0,
    tctRecords: 0,
    tctPartial: false,
    ...overrides,
  }
}

describe("mergeTaeCopecChannels", () => {
  it("combina TAE, Diésel TCT y BlueMax TCT sin tratarlos como documentos espejo", () => {
    const rows = mergeTaeCopecChannels(
      [channel({ taeLiters: 120, taeLoads: 2 })],
      [
        channel({ tctDieselLiters: 80, tctRecords: 1 }),
        channel({ tctBlueMaxLiters: 15, tctRecords: 1 }),
      ],
    )

    expect(rows).toEqual([
      expect.objectContaining({
        taeLiters: 120,
        taeLoads: 2,
        tctDieselLiters: 80,
        tctBlueMaxLiters: 15,
        tctLiters: 95,
        totalLiters: 215,
        tctRecords: 2,
        coverage: "both_channels",
      }),
    ])
  })

  it("mantiene separados los equipos y clasifica la cobertura de cada canal", () => {
    const rows = mergeTaeCopecChannels(
      [channel({ vehicleId: "tae-only", equipment: "TAE-1", taeLiters: 40, taeLoads: 1 })],
      [channel({ vehicleId: "tct-only", equipment: "TCT-1", tctDieselLiters: 60, tctRecords: 1 })],
    )

    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.vehicleId === "tae-only")).toMatchObject({ coverage: "tae_only", totalLiters: 40 })
    expect(rows.find((row) => row.vehicleId === "tct-only")).toMatchObject({ coverage: "tct_only", totalLiters: 60 })
  })

  it("no mezcla el mismo equipo entre faenas o meses distintos", () => {
    const rows = mergeTaeCopecChannels(
      [channel({ taeLiters: 10 })],
      [
        channel({ month: "2026-06", tctDieselLiters: 20 }),
        channel({ worksiteId: "ws-2", worksiteName: "Pacífico", tctDieselLiters: 30 }),
      ],
    )

    expect(rows).toHaveLength(3)
    expect(rows.every((row) => row.coverage !== "both_channels")).toBe(true)
  })

  it("propaga tctPartial si CUALQUIERA de las filas fusionadas es parcial", () => {
    const rows = mergeTaeCopecChannels(
      [],
      [
        channel({ tctDieselLiters: 50, tctRecords: 1, tctPartial: false }),
        channel({ tctBlueMaxLiters: 10, tctRecords: 1, tctPartial: true }),
      ],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.tctPartial).toBe(true)
  })
})
