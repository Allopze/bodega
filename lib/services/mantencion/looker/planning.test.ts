import { describe, expect, it } from "vitest"
import type { FleetRow } from "../fleet"
import { deltaTone, remainingTone, toPlanningRow, unitMismatchMessage } from "./planning"

const period = { from: "2026-10-01", to: "2026-10-31" }

function row(overrides: Partial<FleetRow> = {}): FleetRow {
  return {
    vehicleId: "v-1",
    code: "KA-143",
    plate: "SJFC-66",
    noPlate: false,
    typeId: "t-1",
    typeName: "Camión",
    unit: "km",
    brandId: "b-1",
    brandName: "Scania",
    model: "R450",
    year: 2021,
    worksiteId: "ws-1",
    worksiteName: "Teno",
    scheduleId: "s-1",
    scheduleName: "Camiones",
    intervals: [10_000, 40_000],
    retired: false,
    retiredReason: null,
    initialReading: null,
    readings: [],
    recentPreventives: [{
      id: "p-1", folio: "P-0001", reading: 339_990, date: "2026-10-15", intervalValue: 40_000,
      suggestedIntervalValue: 40_000, manualScheduleReason: null,
    }],
    status: {
      state: "proxima",
      currentReading: { value: 345_000, date: "2026-11-01", source: "P-0002" },
      nextReading: 350_000,
      remaining: 5_000,
      nextIntervalValue: 10_000,
      lastPreventive: { reading: 339_990, date: "2026-10-15", intervalValue: 40_000, origin: "firmada", evidence: "P-0001" },
    },
    gpsStatus: null,
    gpsReading: null,
    gpsReadingAt: null,
    gpsReadingSource: null,
    workshop: null,
    ...overrides,
  }
}

describe("Planificación · A, B, delta y faltantes", () => {
  it("A es el punto programado, B la lectura real y el delta su resta", () => {
    const planned = toPlanningRow(row(), period)
    expect(planned.programmed).toBe(340_000)
    expect(planned.real).toBe(339_990)
    expect(planned.delta).toBe(10)
    expect(planned.next).toBe(350_000)
    expect(planned.remaining).toBe(5_000)
    expect(planned.frequency).toBe(40_000)
    expect(planned.outOfRange).toBe(false)
    expect(planned.manual).toBe(false)
  })

  it("marca el ajuste manual con su motivo", () => {
    const planned = toPlanningRow(row({
      recentPreventives: [{
        id: "p-1", folio: "P-0001", reading: 339_990, date: "2026-10-15", intervalValue: 10_000,
        suggestedIntervalValue: 40_000, manualScheduleReason: "El jefe adelantó el servicio",
      }],
    }), period)
    expect(planned.manual).toBe(true)
    expect(planned.manualReason).toBe("El jefe adelantó el servicio")
  })

  it("rotula la preventiva declarada y su respaldo", () => {
    const planned = toPlanningRow(row({
      status: {
        state: "al_dia",
        currentReading: { value: 100, date: "2026-11-01", source: "x" },
        nextReading: 1_000,
        remaining: 900,
        nextIntervalValue: 100,
        lastPreventive: { reading: 900, date: "2026-09-01", intervalValue: 100, origin: "declarada", evidence: "Factura 123" },
      },
    }), period)
    expect(planned.declared).toBe(true)
    expect(planned.evidence).toBe("Factura 123")
    expect(planned.outOfRange).toBe(true)
  })

  it("sin pauta ni lectura no inventa ceros", () => {
    const planned = toPlanningRow(row({
      intervals: [],
      status: { state: "sin_pauta", currentReading: null, nextReading: null, remaining: null, nextIntervalValue: null, lastPreventive: null },
      recentPreventives: [],
    }), period)
    expect(planned.programmed).toBeNull()
    expect(planned.delta).toBeNull()
    expect(planned.remaining).toBeNull()
    expect(planned.frequency).toBeNull()
  })

  it("semáforo de faltantes y delta", () => {
    expect(remainingTone({ remaining: null, base: 10_000 })).toBe("muted")
    expect(remainingTone({ remaining: 0, base: 10_000 })).toBe("danger")
    expect(remainingTone({ remaining: 1_000, base: 10_000 })).toBe("warn")
    expect(remainingTone({ remaining: 5_000, base: 10_000 })).toBe("ok")
    expect(deltaTone({ delta: 10, base: 10_000 })).toBe("ok")
    expect(deltaTone({ delta: -100, base: 10_000 })).toBe("warn")
    expect(deltaTone({ delta: -600, base: 10_000 })).toBe("danger")
  })

  it("mensaje contextual cuando el equipo elegido se mide en la otra unidad", () => {
    const selected = {
      id: "v-1", code: "KA-143", plate: "SJFC-66", label: "KA-143 · SJFC-66", worksiteId: "ws-1", worksiteName: "Teno",
      unit: "km" as const, intervals: [10_000], frequency: 10_000,
    }
    expect(unitMismatchMessage(selected, "h")).toContain("se controla por km")
    expect(unitMismatchMessage(selected, "km")).toBeNull()
  })
})
