import { describe, expect, it } from "vitest"
import {
  EMPTY_COUNTERS,
  buildMonthlyCounters,
  calcRates,
  calculateCanonicalIndicatorPeriod,
  sumCounters,
  type CanonicalIndicatorCase,
  type ControlledIndicatorDenominator,
} from "@/lib/prevention/safety-indicators-calc"

function indicatorCase(overrides: Partial<CanonicalIndicatorCase> = {}): CanonicalIndicatorCase {
  return {
    incidentId: "inc-1",
    personId: "person-1",
    workerId: "worker-1",
    worksiteId: "ws-1",
    year: 2026,
    month: 1,
    eventType: "work_accident",
    absenceAtLeastNormalShift: true,
    absenceDays: 0,
    chargeDays: 0,
    absenceAllocation: "legacy_unallocated",
    inclusionStatus: "included",
    sex: "female",
    ...overrides,
  }
}

function denominator(overrides: Partial<ControlledIndicatorDenominator> = {}): ControlledIndicatorDenominator {
  return {
    id: "den-1",
    worksiteId: "ws-1",
    year: 2026,
    month: 1,
    workerCount: 100,
    workedHours: 200_000,
    status: "approved",
    reconciliationStatus: "matched",
    version: 1,
    ...overrides,
  }
}

describe("calcRates", () => {
  it("returns non-calculable rates when horasHombre is 0", () => {
    const rates = calcRates({ horasHombre: 0, accConTiempoPerdido: 3, accSinTiempoPerdido: 1, diasPerdidos: 10 })
    expect(rates).toEqual({ tasaFrecuencia: null, tasaGravedad: null, totalAccidentes: 4 })
  })

  it("uses the DS 44 million-hour factor for the legacy proxy", () => {
    const rates = calcRates({ horasHombre: 10_000, accConTiempoPerdido: 2, accSinTiempoPerdido: 1, diasPerdidos: 20 })
    expect(rates.tasaFrecuencia).toBeCloseTo((2 / 10_000) * 1_000_000, 5)
    expect(rates.tasaGravedad).toBeCloseTo((20 / 10_000) * 1_000_000, 5)
    expect(rates.totalAccidentes).toBe(3)
  })

  it("matches the documented golden examples", () => {
    const frequency = calcRates({ horasHombre: 200_000, accConTiempoPerdido: 2, accSinTiempoPerdido: 0, diasPerdidos: 0 })
    const severity = calcRates({ horasHombre: 200_000, accConTiempoPerdido: 0, accSinTiempoPerdido: 0, diasPerdidos: 11 })

    expect(frequency.tasaFrecuencia).toBe(10)
    expect(severity.tasaGravedad).toBe(55)
  })
})

describe("sumCounters", () => {
  it("sums all fields across rows", () => {
    const total = sumCounters([
      { ...EMPTY_COUNTERS, trabajadores: 5, horasHombre: 100 },
      { ...EMPTY_COUNTERS, trabajadores: 3, horasHombre: 50, incidentes: 2 },
    ])
    expect(total).toEqual({ ...EMPTY_COUNTERS, trabajadores: 8, horasHombre: 150, incidentes: 2 })
  })

  it("returns all zeros for an empty row set", () => {
    expect(sumCounters([])).toEqual(EMPTY_COUNTERS)
  })
})

describe("buildMonthlyCounters", () => {
  it("fills missing months with zeroed counters", () => {
    const rows = [{ ...EMPTY_COUNTERS, worksiteId: "ws-1", month: 3, trabajadores: 10 }]
    const months = buildMonthlyCounters(rows, "ws-1")
    expect(months).toHaveLength(12)
    expect(months[2]!.trabajadores).toBe(10)
    expect(months[0]).toEqual(EMPTY_COUNTERS)
  })

  it("sums across worksites for the 'total' view", () => {
    const rows = [
      { ...EMPTY_COUNTERS, worksiteId: "ws-1", month: 1, trabajadores: 5 },
      { ...EMPTY_COUNTERS, worksiteId: "ws-2", month: 1, trabajadores: 7 },
    ]
    const months = buildMonthlyCounters(rows, "total")
    expect(months[0]!.trabajadores).toBe(12)
  })

  it("filters other worksites out of a single-faena view", () => {
    const rows = [
      { ...EMPTY_COUNTERS, worksiteId: "ws-1", month: 1, trabajadores: 5 },
      { ...EMPTY_COUNTERS, worksiteId: "ws-2", month: 1, trabajadores: 7 },
    ]
    const months = buildMonthlyCounters(rows, "ws-1")
    expect(months[0]!.trabajadores).toBe(5)
  })
})

describe("calculateCanonicalIndicatorPeriod", () => {
  it("matches the three P0-01 golden formulas from canonical cases and denominators", () => {
    const cases = [
      indicatorCase({ absenceDays: 5 }),
      indicatorCase({ incidentId: "inc-2", personId: "person-2", workerId: "worker-2", chargeDays: 6, sex: "male" }),
    ]
    const result = calculateCanonicalIndicatorPeriod({
      year: 2026,
      startMonth: 1,
      endMonth: 1,
      events: cases.map((item) => ({ incidentId: item.incidentId, worksiteId: item.worksiteId, year: item.year, month: item.month, eventType: item.eventType })),
      cases,
      denominators: [denominator()],
    })

    expect(result.status).toBe("reconciled")
    expect(result.confirmed.frequencyRate).toBe(10)
    expect(result.confirmed.severityRate).toBe(55)
    expect(result.confirmed.accidentabilityRate).toBe(2)
  })

  it("returns non-calculable values and a reconciliation error when numerators have zero hours", () => {
    const result = calculateCanonicalIndicatorPeriod({
      year: 2026, startMonth: 1, endMonth: 1, events: [],
      cases: [indicatorCase({ absenceDays: 1 })],
      denominators: [denominator({ workedHours: 0 })],
    })
    expect(result.status).toBe("error")
    expect(result.confirmed.frequencyRate).toBeNull()
    expect(result.confirmed.severityRate).toBeNull()
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/sin horas/i)]))
  })

  it("excludes absence shorter than a normal shift and keeps pending classifications provisional", () => {
    const result = calculateCanonicalIndicatorPeriod({
      year: 2026, startMonth: 1, endMonth: 1, events: [],
      cases: [
        indicatorCase({ absenceAtLeastNormalShift: false }),
        indicatorCase({ incidentId: "inc-2", personId: "person-2", workerId: "worker-2", inclusionStatus: "pending" }),
      ],
      denominators: [denominator()],
    })
    expect(result.status).toBe("provisional")
    expect(result.confirmed.injuredPeople).toBe(0)
    expect(result.provisional.injuredPeople).toBe(1)
    expect(result.pendingCaseCount).toBe(1)
  })

  it("does not duplicate the same person-event and suppresses small sex groups", () => {
    const duplicated = indicatorCase({ absenceDays: 2 })
    const result = calculateCanonicalIndicatorPeriod({
      year: 2026, startMonth: 1, endMonth: 1, events: [],
      cases: [duplicated, { ...duplicated, personId: "duplicate-row", absenceDays: 3 }],
      denominators: [denominator()],
    })
    expect(result.confirmed.injuredPeople).toBe(1)
    expect(result.confirmed.absenceDays).toBe(3)
    expect(result.sexBreakdown).toEqual([{ sex: "female", value: null, suppressed: true }])
  })

  it("separa el numerador de accidentabilidad (accidentes) del de frecuencia y gravedad (personas)", () => {
    const threeInjured = [
      indicatorCase({ workerId: "worker-3a", personId: "person-3a", absenceDays: 10 }),
      indicatorCase({ workerId: "worker-3b", personId: "person-3b", absenceDays: 10 }),
      indicatorCase({ workerId: "worker-3c", personId: "person-3c", absenceDays: 10 }),
    ]
    const result = calculateCanonicalIndicatorPeriod({
      year: 2026,
      startMonth: 1,
      endMonth: 1,
      events: [{ incidentId: "inc-1", worksiteId: "ws-1", year: 2026, month: 1, eventType: "work_accident" }],
      cases: threeInjured,
      denominators: [denominator({ workedHours: 300_000 })],
    })

    // Un solo evento distinto, pero tres personas lesionadas.
    expect(result.confirmed.accidents).toBe(1)
    expect(result.confirmed.injuredPeople).toBe(3)
    // NORM-02: la accidentabilidad cuenta ACCIDENTES; frecuencia y gravedad
    // cuentan personas. Antes las tres compartían el numerador de personas, lo
    // que sobreestimaba la accidentabilidad en eventos multivíctima y
    // contradecía el rótulo de la propia pantalla.
    expect(result.confirmed.accidentabilityRate).toBe(1) // (1 / 100) * 100
    expect(result.confirmed.frequencyRate).toBe(10) // (3 / 300_000) * 1_000_000
    expect(result.confirmed.severityRate).toBe(100) // (30 / 300_000) * 1_000_000
  })

  it("calculates a semester from six raw months instead of averaging monthly rates", () => {
    const denominators = Array.from({ length: 6 }, (_, index) => denominator({
      id: `den-${index + 1}`,
      month: index + 1,
      workedHours: 10_000,
    }))
    const result = calculateCanonicalIndicatorPeriod({
      year: 2026, startMonth: 1, endMonth: 6, events: [],
      cases: [
        indicatorCase({ month: 1, absenceDays: 5 }),
        indicatorCase({ incidentId: "inc-2", personId: "person-2", workerId: "worker-2", month: 6, chargeDays: 6 }),
      ],
      denominators,
      expectedDenominatorSlots: 6,
    })
    expect(result.confirmed.frequencyRate).toBeCloseTo(33.333333, 5)
    expect(result.confirmed.severityRate).toBeCloseTo(183.333333, 5)
    expect(result.denominatorSlots).toBe(6)
  })
})
