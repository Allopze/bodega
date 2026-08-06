import type { ChecklistDefinition, StatusValue, ChecklistSection } from "@/lib/sst/types"
import type { SstResponse } from "@/db/schema/sst"
import type { ItemResponse } from "../checklist-section"

export type ResponseMap = Record<string, Record<string, ItemResponse>>

export function buildInitialResponseMap(responses: SstResponse[]): ResponseMap {
  const map: ResponseMap = {}
  for (const r of responses) {
    ;(map[r.seccionId] ??= {})[r.itemId] = {
      estado: r.estado as StatusValue ?? null,
      observacion: r.observacion ?? "",
      accionCorrectiva: r.accionCorrectiva ?? "",
    }
  }
  return map
}

export function getApplicableSections(
  definition: ChecklistDefinition,
  cargos: string[],
): ChecklistSection[] {
  return definition.sections.filter((sec) => {
    if (!sec.appliesWhen || sec.appliesWhen.length === 0) return true
    return cargos.some((c) => sec.appliesWhen!.includes(c))
  })
}

