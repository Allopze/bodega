import { describe, expect, it } from "vitest"
import { TRABAJADOR_NUEVO } from "@/lib/sst/definitions"
import { isStatusKind } from "@/lib/sst/checklist"
import { getEvaluationProgress } from "./evaluation-progress"

describe("getEvaluationProgress", () => {
  it("separates answered items from compliance and identifies the first pending item", () => {
    const section = TRABAJADOR_NUEVO.sections.find((candidate) => candidate.id === "documentacion_requisitos")!
    const firstItem = section.items.find((item) => isStatusKind(item.kind))
    if (!firstItem) throw new Error("El fixture requiere un ítem con estado")
    const progress = getEvaluationProgress([section], {
      [section.id]: {
        [firstItem.id]: { estado: "no_cumple", observacion: "Falta documento", accionCorrectiva: "Solicitar" },
      },
    })

    expect(progress.total).toBeGreaterThan(1)
    expect(progress.answered).toBe(1)
    expect(progress.pending[0]).toMatchObject({ sectionId: section.id, sectionTitle: section.title })
  })
})
