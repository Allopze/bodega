import { describe, expect, it } from "vitest"
import {
  calculateCanonicalIndicatorPeriod,
  type CanonicalIndicatorCase,
  type ControlledIndicatorDenominator,
} from "@/lib/prevention/safety-indicators-calc"
import { allocateAbsenceDaysByMonth, totalAbsenceDays } from "@/lib/prevention/absence-allocation"
import { automaticChargeDaysForSeverity, FATAL_CHARGE_DAYS } from "@/lib/prevention/charge-days"

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
    id: "den-1", worksiteId: "ws-1", year: 2026, month: 1,
    workerCount: 100, workedHours: 200_000,
    status: "approved", reconciliationStatus: "matched", version: 1,
    ...overrides,
  }
}

const eventsFor = (cases: CanonicalIndicatorCase[]) =>
  cases.map((item) => ({ incidentId: item.incidentId, worksiteId: item.worksiteId, year: item.year, month: item.month, eventType: item.eventType }))

/** NORM-01 */
describe("fatalidad y días de cargo", () => {
  it("la tabla normativa fija 6.000 días de cargo por muerte", () => {
    expect(FATAL_CHARGE_DAYS).toBe(6000)
    expect(automaticChargeDaysForSeverity("fatal")).toBe(6000)
  })

  it("no deriva días de cargo para severidades que no son fatales", () => {
    for (const severity of ["none", "minor", "medical_treatment", "lost_time", "serious"]) {
      expect(automaticChargeDaysForSeverity(severity)).toBeNull()
    }
  })

  it("incluye al fallecido con cero días de ausencia y 6.000 de cargo", () => {
    // El caso decisivo: exigir ausencia dejaba la fatalidad fuera de TODAS las
    // tasas, o forzaba a inventarle días perdidos.
    const cases = [indicatorCase({ absenceAtLeastNormalShift: false, absenceDays: 0, chargeDays: FATAL_CHARGE_DAYS })]
    const result = calculateCanonicalIndicatorPeriod({
      year: 2026, startMonth: 1, endMonth: 1,
      events: eventsFor(cases), cases, denominators: [denominator()],
    })

    expect(result.confirmed.injuredPeople).toBe(1)
    expect(result.confirmed.chargeDays).toBe(6000)
    // 6.000 días × 1.000.000 / 200.000 HH
    expect(result.confirmed.severityRate).toBe(30_000)
    expect(result.confirmed.accidentabilityRate).toBe(1)
  })
})

/** NORM-02 */
describe("numerador de la tasa de accidentabilidad", () => {
  it("cuenta accidentes, no lesionados, en un evento multivíctima", () => {
    const cases = [
      indicatorCase({ personId: "p1", workerId: "w1", absenceDays: 1 }),
      indicatorCase({ personId: "p2", workerId: "w2", absenceDays: 1 }),
      indicatorCase({ personId: "p3", workerId: "w3", absenceDays: 1 }),
    ]
    const result = calculateCanonicalIndicatorPeriod({
      year: 2026, startMonth: 1, endMonth: 1,
      events: eventsFor(cases), cases, denominators: [denominator()],
    })

    expect(result.confirmed.accidents).toBe(1)
    expect(result.confirmed.injuredPeople).toBe(3)
    // Un accidente en 100 trabajadores: 1,0 — no 3,0.
    expect(result.confirmed.accidentabilityRate).toBe(1)
    // La frecuencia sí usa lesionados: son indicadores distintos.
    expect(result.confirmed.frequencyRate).toBe(15)
  })
})

/** NORM-07 */
describe("reparto de días perdidos por período real", () => {
  it("cuenta ambos extremos del período", () => {
    expect(totalAbsenceDays([{ startDate: "2026-06-01", endDate: "2026-06-01" }], "2026-12-31")).toBe(1)
    expect(totalAbsenceDays([{ startDate: "2026-06-01", endDate: "2026-06-10" }], "2026-12-31")).toBe(10)
  })

  it("reparte un reposo que cruza el mes", () => {
    const allocation = allocateAbsenceDaysByMonth([{ startDate: "2026-06-25", endDate: "2026-08-08" }], "2026-12-31")
    expect(allocation).toEqual([
      { year: 2026, month: 6, days: 6 },
      { year: 2026, month: 7, days: 31 },
      { year: 2026, month: 8, days: 8 },
    ])
    expect(allocation.reduce((total, item) => total + item.days, 0)).toBe(45)
  })

  it("un reposo abierto se corta en la fecha de corte y sigue creciendo", () => {
    expect(totalAbsenceDays([{ startDate: "2026-08-01", endDate: null }], "2026-08-10")).toBe(10)
    expect(totalAbsenceDays([{ startDate: "2026-08-01", endDate: null }], "2026-08-20")).toBe(20)
  })

  it("atribuye al SEGUNDO semestre los días de un accidente de junio", () => {
    // Es el escenario que motivó el cambio: 45 días desde el 25 de junio
    // cargaban íntegros al primer semestre y dejaban el segundo en cero.
    const cases = [indicatorCase({ month: 6, absenceAllocation: "periods", absenceDays: 45 })]
    const absenceAllocations = allocateAbsenceDaysByMonth(
      [{ startDate: "2026-06-25", endDate: "2026-08-08" }], "2026-12-31",
    ).map((item) => ({ incidentId: "inc-1", personId: "person-1", worksiteId: "ws-1", ...item }))

    const secondHalf = calculateCanonicalIndicatorPeriod({
      year: 2026, startMonth: 7, endMonth: 12,
      events: [], cases, absenceAllocations,
      denominators: Array.from({ length: 6 }, (_, index) => denominator({ id: `den-${index + 7}`, month: index + 7 })),
    })
    // 31 de julio + 8 de agosto, aunque el accidente ocurrió en junio.
    expect(secondHalf.confirmed.absenceDays).toBe(39)

    const firstHalf = calculateCanonicalIndicatorPeriod({
      year: 2026, startMonth: 1, endMonth: 6,
      events: eventsFor(cases), cases, absenceAllocations,
      denominators: Array.from({ length: 6 }, (_, index) => denominator({ id: `den-${index + 1}`, month: index + 1 })),
    })
    expect(firstHalf.confirmed.absenceDays).toBe(6)
  })

  it("un registro heredado conserva la imputación al mes del accidente", () => {
    const cases = [indicatorCase({ month: 6, absenceAllocation: "legacy_unallocated", absenceDays: 45 })]
    const firstHalf = calculateCanonicalIndicatorPeriod({
      year: 2026, startMonth: 1, endMonth: 6,
      events: eventsFor(cases), cases,
      denominators: Array.from({ length: 6 }, (_, index) => denominator({ id: `den-${index + 1}`, month: index + 1 })),
    })
    expect(firstHalf.confirmed.absenceDays).toBe(45)
  })
})
