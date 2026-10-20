import { describe, expect, it } from "vitest"
import { normalizeRe20Data } from "../../workspace-data"
import { ONE_PAGE_MAX_ROWS, buildOnePage, latestReviewApproves } from "./model"
import type { Re20QualityReview } from "../../types"

const incident = { occurredAt: "2026-10-01T14:00:00.000Z", location: "Patio de acopio" }
const people = [{ id: "u1", name: "Ana Rojas", position: "Supervisora" }]

function dataWith(measures: number) {
  return normalizeRe20Data({
    preliminary: { eventDescription: "Un trabajador resbaló en el patio mojado al cargar." },
    causalTree: {
      events: [
        { id: "H1", description: "Caída al mismo nivel", verified: true },
        { id: "H2", description: "Piso sin drenaje en el patio", verified: true },
      ],
      relations: [{ from: "H2", to: "H1", type: "chain" }],
    },
    measures: Array.from({ length: measures }, (_, index) => ({
      id: `M${index}`, rootCauseId: "H2", description: `Instalar drenaje ${index + 1}`, responsibleUserId: index === 0 ? "u1" : null, responsibleRole: "Jefatura", status: "Pendiente",
    })),
  })
}

const review = (decision: string, reviewedAt: string): Re20QualityReview => ({ id: reviewedAt, workspaceVersion: 1, criteria: [], decision, observation: null, reviewerRole: "jefa_chome", reviewedAt })

describe("ONE PAGE RE-20-06", () => {
  it("se arma desde el expediente con causa raíz, medida y responsable", () => {
    const page = buildOnePage({ data: dataWith(2), incident, people })
    expect(page.summary).toContain("resbaló")
    expect(page.rootCauseText).toBe("Piso sin drenaje en el patio")
    expect(page.rows[0]).toMatchObject({ rootCause: "Piso sin drenaje en el patio", measure: "Instalar drenaje 1", responsible: "Ana Rojas" })
    expect(page.rows[1]?.responsible).toBe("Jefatura")
    expect(page.problems).toEqual([])
  })

  it("muestra hasta cuatro filas y cuenta las que no caben", () => {
    const page = buildOnePage({ data: dataWith(6), incident, people })
    expect(page.shown).toHaveLength(ONE_PAGE_MAX_ROWS)
    expect(page.hiddenRows).toBe(2)
  })

  it("dice qué falta cuando el expediente no alcanza", () => {
    const page = buildOnePage({ data: normalizeRe20Data({}), incident, people })
    expect(page.problems).toHaveLength(3)
  })

  it("la difusión se habilita sólo si la última revisión aprobó", () => {
    expect(latestReviewApproves([])).toBe(false)
    expect(latestReviewApproves([review("approved", "2026-10-02T10:00:00Z")])).toBe(true)
    expect(latestReviewApproves([review("approved", "2026-10-02T10:00:00Z"), review("changes_required", "2026-10-03T10:00:00Z")])).toBe(false)
  })
})
