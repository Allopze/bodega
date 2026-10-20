import { describe, expect, it } from "vitest"
import { RE20_QUALITY_CRITERIA } from "@/lib/prevention/incidents"
import { emptyQualityDraft, qualityBlockers, qualityPayload, readQualityDraft, reviewerRoleLabel, type QualityDraft, type QualityResult } from "./rules"

function draftWith(result: QualityResult, patch: Partial<QualityDraft> = {}): QualityDraft {
  return { ...emptyQualityDraft(), criteria: Object.fromEntries(RE20_QUALITY_CRITERIA.map((criterion) => [criterion.id, { result }])), ...patch }
}

describe("reglas de la revisión de calidad RE-20-13", () => {
  it("pide los 13 resultados y la decisión antes de registrar", () => {
    const blockers = qualityBlockers(emptyQualityDraft())
    expect(blockers).toHaveLength(14)
    expect(blockers.at(-1)?.fieldId).toBe("re20-calidad-decision")
  })

  it("aprobar exige los 13 en «Cumple» y no pide observación", () => {
    expect(qualityBlockers(draftWith("meets", { decision: "approved" }))).toEqual([])
    const partial = draftWith("meets", { decision: "approved" })
    partial.criteria.depth = { result: "partial" }
    expect(qualityBlockers(partial).map((item) => item.label)).toEqual([expect.stringContaining("«Aprobado» exige")])
  })

  it("con observaciones no admite «No cumple» y exige la observación final", () => {
    const review = draftWith("partial", { decision: "approved_with_observations" })
    expect(qualityBlockers(review).map((item) => item.fieldId)).toEqual(["re20-calidad-observation"])
    review.observation = "Completar la trazabilidad de los hechos 3 y 4."
    expect(qualityBlockers(review)).toEqual([])
    review.criteria.traceability = { result: "does_not_meet" }
    expect(qualityBlockers(review).map((item) => item.label)).toEqual([expect.stringContaining("no admite criterios")])
  })

  it("requiere corrección con observación, aunque haya criterios «Cumple»", () => {
    const review = draftWith("meets", { decision: "changes_required" })
    review.criteria.measures = { result: "does_not_meet" }
    expect(qualityBlockers(review).map((item) => item.fieldId)).toEqual(["re20-calidad-observation"])
    review.observation = "Faltan medidas para la causa raíz H4."
    expect(qualityBlockers(review)).toEqual([])
  })

  it("arma la carga con observación por criterio sólo si se escribió", () => {
    const review = draftWith("meets", { decision: "approved" })
    review.criteria.objectivity = { result: "meets", observation: "  Bien redactado  " }
    const payload = qualityPayload(review)
    expect(payload.criteria).toHaveLength(13)
    expect(payload.criteria.find((item) => item.id === "objectivity")?.observation).toBe("Bien redactado")
    expect(payload.criteria.find((item) => item.id === "depth")).toEqual({ id: "depth", result: "meets" })
    expect(payload.observation).toBeNull()
  })

  it("lee borradores anteriores o dañados sin romperse", () => {
    expect(readQualityDraft(null)).toEqual(emptyQualityDraft())
    expect(readQualityDraft("x")).toEqual(emptyQualityDraft())
    expect(readQualityDraft([{ id: "depth", result: "partial", observation: "x" }, { id: "inventado", result: "meets" }]).criteria).toEqual({ depth: { result: "partial", observation: "x" } })
    expect(readQualityDraft({ criteria: { depth: { result: "raro" } }, decision: "nada" }).criteria.depth?.result).toBeNull()
  })

  it("dice «en reemplazo» cuando no firmó la jefa", () => {
    expect(reviewerRoleLabel("jefa_chome")).toBe("Jefa Dpto. Prevención de Riesgos")
    expect(reviewerRoleLabel("prevencionista")).toContain("en reemplazo de la Jefa Dpto. Prevención")
  })
})
