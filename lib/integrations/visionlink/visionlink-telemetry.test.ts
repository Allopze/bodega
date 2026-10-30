import { describe, expect, it } from "vitest"
import { previousDay, visionLinkDayToTelemetry } from "./visionlink-telemetry"
import { planVisionLinkRows, splitRange } from "./visionlink-sync"

const NO_CALLOUTS = {
  hourCallouts: { runtimeHours: null, idleHours: null, workingHours: null },
  fuelCallouts: { runtimeFuelBurned: null, idleFuelBurned: null, workingFuelBurned: null },
}

// Forma real de un día Performance (GR-10, sondeo del 2026-10-30).
const performanceDay = {
  assetLocalDate: "2026-10-23",
  runtimeHours: 10.552,
  idleHours: 6.95,
  workingHours: 3.602,
  runtimeFuelBurnedLiters: 56.781,
  idleFuelBurnedLiters: 17.034,
  workingFuelBurnedLiters: 39.747,
  ...NO_CALLOUTS,
}

describe("visionLinkDayToTelemetry", () => {
  it("usa runtime como funcionamiento e idle como vacío, con sus litros", () => {
    expect(visionLinkDayToTelemetry(performanceDay, "2026-10-29")).toEqual({
      row: { day: "2026-10-23", operatingHours: 10.55, idleHours: 6.95, litersWorking: 39.747, litersIdle: 17.034 },
    })
  })

  it("deja como faltante —no cero— las horas con callout", () => {
    const flagged = { ...performanceDay, hourCallouts: { runtimeHours: "Invalid value detected in date range", idleHours: null } }
    expect(visionLinkDayToTelemetry(flagged, "2026-10-29")).toEqual({ skip: "missing_hours" })
    expect(visionLinkDayToTelemetry({ ...performanceDay, idleHours: null }, "2026-10-29")).toEqual({ skip: "missing_hours" })
  })

  it("descarta los litros con callout pero conserva las horas", () => {
    const flagged = { ...performanceDay, fuelCallouts: { idleFuelBurned: "Invalid value", workingFuelBurned: "Invalid value", runtimeFuelBurned: null } }
    expect(visionLinkDayToTelemetry(flagged, "2026-10-29")).toEqual({
      row: { day: "2026-10-23", operatingHours: 10.55, idleHours: 6.95, litersWorking: null, litersIdle: null },
    })
  })

  it("deriva los litros trabajando de total − vacío cuando falta el dato directo", () => {
    const result = visionLinkDayToTelemetry({ ...performanceDay, workingFuelBurnedLiters: null }, "2026-10-29")
    expect(result).toMatchObject({ row: { litersWorking: 39.747, litersIdle: 17.034 } })
  })

  it("rechaza vacío mayor que funcionamiento (ConnectPro, TO-37 el 2026-10-23)", () => {
    const day = { ...performanceDay, runtimeHours: 0.882, idleHours: 1, workingHours: null }
    expect(visionLinkDayToTelemetry(day, "2026-10-29")).toEqual({ skip: "idle_over_runtime" })
  })

  it("rechaza más de 24 horas y los días posteriores al último aceptado", () => {
    expect(visionLinkDayToTelemetry({ ...performanceDay, runtimeHours: 24.5 }, "2026-10-29")).toEqual({ skip: "over_24_hours" })
    expect(visionLinkDayToTelemetry(performanceDay, "2026-10-22")).toEqual({ skip: "future_day" })
  })

  it("guarda un día sin uso como cero cuando el proveedor lo informa sin callout", () => {
    const idle = { ...performanceDay, runtimeHours: 0, idleHours: 0, runtimeFuelBurnedLiters: 0, idleFuelBurnedLiters: 0, workingFuelBurnedLiters: 0 }
    expect(visionLinkDayToTelemetry(idle, "2026-10-29")).toEqual({
      row: { day: "2026-10-23", operatingHours: 0, idleHours: 0, litersWorking: 0, litersIdle: 0 },
    })
  })
})

describe("previousDay / splitRange", () => {
  it("cruza meses y años", () => {
    expect(previousDay("2026-03-01")).toBe("2026-02-28")
    expect(previousDay("2026-01-01", 14)).toBe("2025-12-18")
  })

  it("parte rangos largos en ventanas contiguas de hasta 89 días", () => {
    const windows = splitRange("2026-01-01", "2026-10-29")
    expect(windows[0]!.startDate).toBe("2026-01-01")
    expect(windows.at(-1)!.endDate).toBe("2026-10-29")
    for (let index = 1; index < windows.length; index++) {
      expect(previousDay(windows[index]!.startDate)).toBe(windows[index - 1]!.endDate)
    }
    expect(splitRange("2026-10-16", "2026-10-29")).toEqual([{ startDate: "2026-10-16", endDate: "2026-10-29" }])
  })
})

describe("planVisionLinkRows", () => {
  it("cruza por serie sin importar mayúsculas y devuelve los equipos sin vínculo", () => {
    const plan = planVisionLinkRows([
      { equipmentHeader: { make: "CAT", serialNumber: "dkj30153", equipmentId: "GR-10 CH" }, dailyUtilizations: [performanceDay] },
      { equipmentHeader: { make: "CAT", serialNumber: "FDT00314", equipmentId: "TO-37 CH", model: "D6R II XL" }, dailyUtilizations: [performanceDay] },
    ], new Map([["DKJ30153", "veh-gr10"]]), "2026-10-29")

    expect(plan).toMatchObject({ assets: 2, matched: 1, skippedDays: {} })
    expect(plan.unmatched).toEqual([{ serialNumber: "FDT00314", equipmentId: "TO-37 CH", model: "D6R II XL" }])
    expect(plan.rows).toEqual([expect.objectContaining({ vehicleId: "veh-gr10", day: "2026-10-23" })])
  })

  it("cuenta los días descartados por motivo", () => {
    const plan = planVisionLinkRows([{
      equipmentHeader: { serialNumber: "M5K05314" },
      dailyUtilizations: [performanceDay, { ...performanceDay, assetLocalDate: "2026-10-24", idleHours: null }],
    }], new Map([["M5K05314", "veh-cr51"]]), "2026-10-29")
    expect(plan.rows).toHaveLength(1)
    expect(plan.skippedDays).toEqual({ missing_hours: 1 })
  })
})
