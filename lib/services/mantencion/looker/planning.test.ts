import { describe, expect, it } from "vitest"
import type { FleetRow } from "../fleet"
import { buildPlanningData, matchesDateRange, planningStateOf, remainingTone, toPlanningRow } from "./planning"
import { isOnTime, remainingText, timingDetail, timingText, timingTone } from "./planning-rules"
import type { PlanningRow } from "./types"

const period = { from: "2026-10-01", to: "2026-10-31" }
const TODAY = "2026-11-27"

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
    cyclic: false,
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

  it("semáforo de faltantes", () => {
    expect(remainingTone({ remaining: null, base: 10_000 })).toBe("muted")
    expect(remainingTone({ remaining: 0, base: 10_000 })).toBe("danger")
    expect(remainingTone({ remaining: 1_000, base: 10_000 })).toBe("warn")
    expect(remainingTone({ remaining: 5_000, base: 10_000 })).toBe("ok")
  })

  it("calcula el uso diario y la fecha estimada desde las lecturas de la flota", () => {
    const planned = toPlanningRow(row({
      readings: [
        { value: 345_000, date: "2026-11-27", source: "P-2" },
        { value: 342_600, date: "2026-11-17", source: "P-1" },
      ],
      status: {
        state: "proxima",
        currentReading: { value: 345_000, date: "2026-11-27", source: "P-2" },
        nextReading: 347_400,
        remaining: 2_400,
        nextIntervalValue: 10_000,
        lastPreventive: { reading: 339_990, date: "2026-10-15", intervalValue: 40_000, origin: "firmada", evidence: "P-0001" },
      },
    }), period, TODAY)
    expect(planned.dailyUsage).toBe(240)
    expect(planned.estimatedDate).toBe("2026-12-07")
    expect(planned.estimateNote).toBeNull()
    // La estimación no toca el estado.
    expect(planned.state).toBe("proxima")
  })

  it("sin lecturas recientes deja la razón en `estimateNote`", () => {
    const planned = toPlanningRow(row(), period, TODAY)
    expect(planned.estimatedDate).toBeNull()
    expect(planned.dailyUsage).toBeNull()
    expect(planned.estimateNote).toMatch(/Sin lecturas suficientes/)
  })
})

describe("Planificación · ¿se hizo a tiempo?", () => {
  it("dice cuánto tarde o antes, y «A tiempo» dentro del 1 % del intervalo", () => {
    expect(timingText({ delta: -14_394, base: 40_000 }, "km")).toBe("14.394 km tarde")
    expect(timingText({ delta: 360, base: 10_000 }, "km")).toBe("360 km antes")
    expect(timingText({ delta: -12.5, base: 250 }, "h")).toBe("12,5 h tarde")
    expect(timingText({ delta: 0, base: 40_000 }, "km")).toBe("A tiempo")
    expect(timingText({ delta: null, base: 40_000 }, "km")).toBe("Sin dato")
  })

  it("el 1 % exacto es a tiempo; un poco más ya es tarde o antes", () => {
    expect(isOnTime({ delta: -400, base: 40_000 })).toBe(true)
    expect(isOnTime({ delta: 400, base: 40_000 })).toBe(true)
    expect(timingText({ delta: -400, base: 40_000 }, "km")).toBe("A tiempo")
    expect(timingText({ delta: -401, base: 40_000 }, "km")).toBe("401 km tarde")
    expect(timingText({ delta: 401, base: 40_000 }, "km")).toBe("401 km antes")
    // Sin intervalo base no hay margen: sólo el cero exacto.
    expect(isOnTime({ delta: 1, base: null })).toBe(false)
    expect(isOnTime({ delta: 0, base: null })).toBe(true)
  })

  it("tono: a tiempo y antes en verde, poco tarde ámbar, muy tarde rojo", () => {
    expect(timingTone({ delta: 10, base: 10_000 })).toBe("ok")
    expect(timingTone({ delta: -100, base: 10_000 })).toBe("ok")
    expect(timingTone({ delta: -300, base: 10_000 })).toBe("warn")
    expect(timingTone({ delta: -600, base: 10_000 })).toBe("danger")
    expect(timingTone({ delta: null, base: 10_000 })).toBe("muted")
  })

  it("el detalle nombra los dos puntos", () => {
    expect(timingDetail({ programmed: 400_000, real: 414_394 }, "km")).toBe("Tocaba a los 400.000 km y se hizo a los 414.394 km")
    expect(timingDetail({ programmed: null, real: 10 }, "km")).toBeNull()
  })

  it("«Faltan» y «Vencida por»", () => {
    expect(remainingText(3_144, "km")).toBe("Faltan 3.144 km")
    expect(remainingText(-11_801, "km")).toBe("Vencida por 11.801 km")
    expect(remainingText(0, "h")).toBe("Vencida por 0 h")
    expect(remainingText(null, "km")).toBeNull()
  })
})

function planned(overrides: Partial<PlanningRow>): PlanningRow {
  return { ...toPlanningRow(row(), period, TODAY), ...overrides }
}

const NO_FILTER = { dateField: "proxima" as const, dateFrom: null, dateTo: null, planningState: null }

describe("Planificación · rango de fechas y cifras", () => {
  const rows = [
    planned({ vehicleId: "a", code: "A", remaining: -500, base: 10_000, estimatedDate: "2026-11-10", lastDate: "2026-01-10" }),
    planned({ vehicleId: "b", code: "B", remaining: 1_000, base: 10_000, estimatedDate: "2026-12-05", lastDate: "2026-06-10" }),
    planned({ vehicleId: "c", code: "C", remaining: 9_000, base: 10_000, estimatedDate: "2027-03-01", lastDate: "2026-09-10" }),
    planned({ vehicleId: "d", code: "D", remaining: 9_000, base: 10_000, estimatedDate: null, lastDate: null }),
    planned({ vehicleId: "e", code: "E", remaining: null, base: null, estimatedDate: null, lastDate: null }),
  ]

  it("sin rango no filtra por fecha: las filas sin fecha entran", () => {
    const data = buildPlanningData(rows, NO_FILTER, null)
    expect(data.rows.map((r) => r.code)).toEqual(["A", "B", "C", "D", "E"])
    expect(data.counts).toEqual({ total: 5, vencida: 1, proxima: 1, al_dia: 2, sin_dato: 1 })
  })

  it("con `hasta` (atajo) entran las vencidas y las que caen antes del término", () => {
    const data = buildPlanningData(rows, { ...NO_FILTER, dateTo: "2026-12-27" }, null)
    expect(data.rows.map((r) => r.code)).toEqual(["A", "B"])
    expect(data.counts).toEqual({ total: 2, vencida: 1, proxima: 1, al_dia: 0, sin_dato: 0 })
  })

  it("con un rango, una fila sin fecha estimada queda fuera", () => {
    const data = buildPlanningData(rows, { ...NO_FILTER, dateFrom: "2026-11-01", dateTo: "2027-12-31" }, null)
    expect(data.rows.map((r) => r.code)).toEqual(["A", "B", "C"])
  })

  it("`ultima` filtra por la fecha de la última mantención", () => {
    const filters = { ...NO_FILTER, dateField: "ultima" as const, dateFrom: "2026-06-01", dateTo: "2026-09-30" }
    expect(buildPlanningData(rows, filters, null).rows.map((r) => r.code)).toEqual(["B", "C"])
    expect(matchesDateRange(rows[3]!, filters)).toBe(false)
    expect(matchesDateRange(rows[1]!, { ...filters, dateFrom: "2026-06-10", dateTo: "2026-06-10" })).toBe(true)
  })

  it("el estado filtra la tabla pero no las cifras, que sí llevan el rango", () => {
    const data = buildPlanningData(rows, { ...NO_FILTER, dateTo: "2026-12-27", planningState: "vencida" }, "a")
    expect(data.rows.map((r) => r.code)).toEqual(["A"])
    expect(data.counts).toEqual({ total: 2, vencida: 1, proxima: 1, al_dia: 0, sin_dato: 0 })
    expect(data.selectedId).toBe("a")
  })

  it("ordena por faltantes: lo vencido primero y sin dato al final", () => {
    const data = buildPlanningData([...rows].reverse(), NO_FILTER, null)
    expect(data.rows.map((r) => r.code)).toEqual(["A", "B", "C", "D", "E"])
    expect(planningStateOf(data.rows[4]!)).toBe("sin_dato")
  })
})
