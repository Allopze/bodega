import type { SstEvaluation } from "@/db/schema/sst"

export interface OpenEvaluationVisit {
  id: string
  fecha: string
  context: string
}

/**
 * Una visita permanece disponible para sumar participaciones mientras al menos
 * una de sus evaluaciones está en borrador. No se agrupan registros históricos
 * sin visitId: su relación real no puede reconstruirse con seguridad.
 */
export function listOpenEvaluationVisits(
  evaluations: SstEvaluation[],
  worksiteId: string,
): OpenEvaluationVisit[] {
  const visits = new Map<string, OpenEvaluationVisit>()
  for (const evaluation of evaluations) {
    if (!evaluation.visitId || evaluation.worksiteId !== worksiteId || evaluation.estado !== "borrador") continue
    if (!visits.has(evaluation.visitId)) {
      visits.set(evaluation.visitId, {
        id: evaluation.visitId,
        fecha: evaluation.fechaEvaluacion,
        context: evaluation.motivo ?? (evaluation.tipo === "seguimiento" ? "Seguimiento" : "Evaluación de persona"),
      })
    }
  }
  return [...visits.values()]
}

export function evaluationsForVisit(evaluations: SstEvaluation[], visitId: string | null): SstEvaluation[] {
  return visitId ? evaluations.filter((evaluation) => evaluation.visitId === visitId) : []
}
