import { isStatusKind } from "@/lib/sst/checklist"
import type { ChecklistSection } from "@/lib/sst/types"
import type { ResponseMap } from "./helpers"

export interface EvaluationPendingItem {
  sectionId: string
  sectionTitle: string
  itemLabel: string
}

export interface EvaluationProgress {
  total: number
  answered: number
  pending: EvaluationPendingItem[]
  percentage: number
}

/**
 * El avance describe respuestas registradas. No es cumplimiento: una respuesta
 * negativa cuenta como avance, pero no como resultado favorable.
 */
export function getEvaluationProgress(sections: ChecklistSection[], responseMap: ResponseMap): EvaluationProgress {
  const pending: EvaluationPendingItem[] = []
  let total = 0
  let answered = 0

  for (const section of sections) {
    if ((section.countsForCompliance ?? true) === false) continue
    for (const item of section.items) {
      if (!isStatusKind(item.kind)) continue
      total += 1
      if (responseMap[section.id]?.[item.id]?.estado) {
        answered += 1
      } else {
        pending.push({ sectionId: section.id, sectionTitle: section.title, itemLabel: item.label })
      }
    }
  }

  return {
    total,
    answered,
    pending,
    percentage: total === 0 ? 0 : (answered / total) * 100,
  }
}
