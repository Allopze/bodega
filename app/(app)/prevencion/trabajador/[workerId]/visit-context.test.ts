import { describe, expect, it } from "vitest"
import { evaluationsForVisit, listOpenEvaluationVisits } from "./visit-context"

const evaluation = (overrides: Record<string, unknown>) => ({
  id: "evaluation-1",
  visitId: "visit-1",
  worksiteId: "worksite-1",
  fechaEvaluacion: "2026-07-16",
  estado: "borrador",
  motivo: null,
  tipo: "nuevo",
  ...overrides,
}) as never

describe("visit context", () => {
  it("mantiene separadas las visitas persistentes de una misma persona", () => {
    const evaluations = [
      evaluation({ id: "a", visitId: "visit-a" }),
      evaluation({ id: "b", visitId: "visit-b", fechaEvaluacion: "2026-07-16", motivo: "reincidencia" }),
      evaluation({ id: "legacy", visitId: null }),
    ]

    expect(listOpenEvaluationVisits(evaluations, "worksite-1").map((visit) => visit.id)).toEqual(["visit-a", "visit-b"])
    expect(evaluationsForVisit(evaluations, "visit-b").map((item) => item.id)).toEqual(["b"])
  })

  it("no ofrece como visita abierta un caso cerrado ni una faena distinta", () => {
    const evaluations = [
      evaluation({ estado: "cerrada" }),
      evaluation({ id: "other-worksite", visitId: "visit-other", worksiteId: "worksite-2" }),
    ]

    expect(listOpenEvaluationVisits(evaluations, "worksite-1")).toEqual([])
  })
})
