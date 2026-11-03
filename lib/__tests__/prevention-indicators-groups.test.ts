import { describe, expect, it, vi } from "vitest"

vi.mock("@/db", () => ({ db: {} }))

import { buildCanonicalIndicatorGroups, type CanonicalSourceRows } from "@/lib/services/prevention-indicadores"
import type { CanonicalIndicatorCase, ControlledIndicatorDenominator } from "@/lib/prevention/safety-indicators-calc"

const WORKSITE = { id: "ws-1", name: "Faena uno" }

function denominator(month: number): ControlledIndicatorDenominator {
  return {
    id: `den-${month}`,
    worksiteId: WORKSITE.id,
    year: 2026,
    month,
    workerCount: 50,
    workedHours: 10_000,
    status: "approved",
    reconciliationStatus: "matched",
    version: 1,
  }
}

/** Accidente de junio cuyo reposo cruza a julio: 6 días en junio y 19 en julio. */
function juneAccidentWithLeaveIntoJuly(): CanonicalSourceRows {
  const injured: CanonicalIndicatorCase = {
    incidentId: "inc-1",
    personId: "person-1",
    workerId: "worker-1",
    worksiteId: WORKSITE.id,
    year: 2026,
    month: 6,
    eventType: "work_accident",
    absenceAtLeastNormalShift: true,
    absenceDays: 25,
    chargeDays: 0,
    absenceAllocation: "periods",
    inclusionStatus: "included",
    sex: "male",
  }
  return {
    events: [],
    cases: [injured],
    absenceAllocations: [
      { incidentId: "inc-1", personId: "person-1", worksiteId: WORKSITE.id, year: 2026, month: 6, days: 6 },
      { incidentId: "inc-1", personId: "person-1", worksiteId: WORKSITE.id, year: 2026, month: 7, days: 19 },
    ],
    denominators: Array.from({ length: 12 }, (_, index) => denominator(index + 1)),
    legacyRows: [],
  }
}

describe("buildCanonicalIndicatorGroups — días de reposo en el mes real (NORM-07)", () => {
  const [group] = buildCanonicalIndicatorGroups(2026, [WORKSITE], juneAccidentWithLeaveIntoJuly())

  it("imputa al mes siguiente los días de un reposo que cruza de mes", () => {
    expect(group!.monthly[5]!.confirmed.absenceDays).toBe(6)
    expect(group!.monthly[6]!.confirmed.absenceDays).toBe(19)
  })

  it("los semestres suman lo mismo que el año", () => {
    const [first, second] = group!.semesters
    expect(first!.confirmed.absenceDays).toBe(6)
    expect(second!.confirmed.absenceDays).toBe(19)
    expect(group!.annual.confirmed.absenceDays).toBe(25)
  })

  it("el lesionado cuenta sólo en el mes del accidente", () => {
    expect(group!.monthly[5]!.confirmed.injuredPeople).toBe(1)
    expect(group!.monthly[6]!.confirmed.injuredPeople).toBe(0)
  })
})
