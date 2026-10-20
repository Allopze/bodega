import { RE20_QUALITY_CRITERIA, RE20_REVIEW_DECISIONS } from "@/lib/prevention/incidents"

/* Reglas de la revisión de calidad RE-20-13. Espejo de lo que exige el servicio
 * (`reviewPreventionIncidentRe20Quality`): la decisión la elige quien revisa, no
 * se calcula; el servidor sólo comprueba que sea coherente con los 13 criterios.
 * Sin React: se prueba por sí sola. */

export type QualityResult = "meets" | "partial" | "does_not_meet"
export type QualityDecision = (typeof RE20_REVIEW_DECISIONS)[number]["id"]

export interface QualityCriterionDraft {
  result?: QualityResult | null
  observation?: string
}

export interface QualityDraft {
  criteria: Record<string, QualityCriterionDraft>
  decision: QualityDecision | null
  observation: string
}

export const QUALITY_DRAFT_KEY = "qualityCriteria"
export const QUALITY_ID = (field: string) => `re20-calidad-${field}`
export const QUALITY_CRITERION_ID = (criterionId: string) => QUALITY_ID(`criterion-${criterionId}`)

const RESULTS: readonly string[] = ["meets", "partial", "does_not_meet"]
const DECISIONS: readonly string[] = RE20_REVIEW_DECISIONS.map((decision) => decision.id)

export function emptyQualityDraft(): QualityDraft {
  return { criteria: {}, decision: null, observation: "" }
}

/** Lee el borrador guardado en `ws.extras` (o en la bóveda); tolera formas anteriores o dañadas. */
export function readQualityDraft(raw: unknown): QualityDraft {
  const draft = emptyQualityDraft()
  if (!raw || typeof raw !== "object") return draft
  const source = raw as Record<string, unknown>
  const rawCriteria = source.criteria ?? (Array.isArray(raw) ? raw : source)
  const entries: Array<[string, unknown]> = Array.isArray(rawCriteria)
    ? rawCriteria.map((item) => [String((item as { id?: unknown })?.id ?? ""), item])
    : Object.entries(rawCriteria as Record<string, unknown>)
  for (const [id, value] of entries) {
    if (!RE20_QUALITY_CRITERIA.some((criterion) => criterion.id === id) || !value || typeof value !== "object") continue
    const { result, observation } = value as { result?: unknown; observation?: unknown }
    draft.criteria[id] = {
      result: typeof result === "string" && RESULTS.includes(result) ? (result as QualityResult) : null,
      observation: typeof observation === "string" ? observation : "",
    }
  }
  if (typeof source.decision === "string" && DECISIONS.includes(source.decision)) draft.decision = source.decision as QualityDecision
  if (typeof source.observation === "string") draft.observation = source.observation
  return draft
}

export interface QualityBlocker {
  label: string
  fieldId: string
}

/** Qué impide registrar la revisión tal como está. Vacío = se puede registrar. */
export function qualityBlockers(draft: QualityDraft): QualityBlocker[] {
  const blockers: QualityBlocker[] = []
  const results = RE20_QUALITY_CRITERIA.map((criterion) => draft.criteria[criterion.id]?.result ?? null)
  RE20_QUALITY_CRITERIA.forEach((criterion, index) => {
    if (!results[index]) blockers.push({ label: `Resultado de «${criterion.criterion}»`, fieldId: QUALITY_CRITERION_ID(criterion.id) })
  })
  if (!draft.decision) {
    blockers.push({ label: "La decisión de la revisión", fieldId: QUALITY_ID("decision") })
    return blockers
  }
  if (draft.decision === "approved" && results.some((result) => result && result !== "meets")) {
    blockers.push({ label: "«Aprobado» exige los 13 criterios en «Cumple»: cambia la decisión o corrige los resultados", fieldId: QUALITY_ID("decision") })
  }
  if (draft.decision === "approved_with_observations" && results.includes("does_not_meet")) {
    blockers.push({ label: "«Aprobado con observaciones» no admite criterios que «No cumplen»: pide correcciones", fieldId: QUALITY_ID("decision") })
  }
  if (draft.decision !== "approved" && draft.observation.trim().length === 0) {
    blockers.push({ label: "La observación final de la revisión", fieldId: QUALITY_ID("observation") })
  }
  return blockers
}

/** Cuántos de los 13 criterios ya tienen resultado. */
export function evaluatedCount(draft: QualityDraft) {
  return RE20_QUALITY_CRITERIA.filter((criterion) => draft.criteria[criterion.id]?.result).length
}

/** Lo que viaja a la acción del servidor (observación del criterio sólo si se escribió). */
export function qualityPayload(draft: QualityDraft) {
  return {
    decision: draft.decision as QualityDecision,
    observation: draft.observation.trim() || null,
    criteria: RE20_QUALITY_CRITERIA.map((criterion) => {
      const entry = draft.criteria[criterion.id]
      const observation = entry?.observation?.trim()
      return { id: criterion.id, result: entry?.result as QualityResult, ...(observation ? { observation } : {}) }
    }),
  }
}

export const DECISION_LABELS: Record<string, string> = Object.fromEntries(RE20_REVIEW_DECISIONS.map((decision) => [decision.id, decision.label]))
export const isApprovingDecision = (decision: string) => decision === "approved" || decision === "approved_with_observations"

/** Quién firmó, como lo muestra la impresión: sin ser la jefa, firma «en reemplazo». */
export function reviewerRoleLabel(role: string) {
  return role === "jefa_chome" ? "Jefa Dpto. Prevención de Riesgos" : `${role} · en reemplazo de la Jefa Dpto. Prevención`
}
