import { calculateRe20Deadlines, nextRe20FollowupDueAt, type Re20SlaPolicy } from "@/lib/prevention/incidents"
import type { Re20Data, Re20Incident, Re20QualityReview, Re20StageId } from "./types"
import { re20TaskOf } from "./workspace-data"

/* Plazos por etapa derivados de `calculateRe20Deadlines`: una sola cuenta para
 * la tarjeta «Siguiente paso», los chips de etapa y cada etapa. */

export interface Re20Deadline {
  dueAt: string
  /** «Vence» para plazos internos, «Plazo legal» para la DIAT. */
  kind: "internal" | "legal"
  /** De dónde se cuenta, en lenguaje de la persona: «3 h desde el accidente». */
  rule: string
}

const APPROVING = new Set(["approved", "approved_with_observations"])

/** La última revisión aprobatoria (las dos decisiones que habilitan la difusión). */
export function latestApprovingReview(reviews: Re20QualityReview[]) {
  return reviews.find((review) => APPROVING.has(review.decision)) ?? null
}

export function re20StageDeadlines(args: {
  incident: Re20Incident
  data: Re20Data
  policy: Re20SlaPolicy
  qualityReviews: Re20QualityReview[]
}): Partial<Record<Re20StageId, Re20Deadline>> {
  const { incident, data, policy, qualityReviews } = args
  const preliminary = re20TaskOf(data, "preliminary_report")
  const definitive = re20TaskOf(data, "definitive_report")
  const meeting = re20TaskOf(data, "post_accident_meeting")
  const approved = latestApprovingReview(qualityReviews)
  const base = calculateRe20Deadlines({
    occurredAt: incident.occurredAt,
    knownAt: incident.knownAt,
    preliminaryAt: preliminary.status === "completed" ? preliminary.completedAt ?? null : null,
    qualityApprovedAt: approved?.reviewedAt ?? null,
    eventType: incident.eventType,
    isFatalOrSerious: incident.isFatalOrSerious === true,
    reintegrationAt: meeting.dueAt ?? null,
  }, policy)

  const result: Partial<Record<Re20StageId, Re20Deadline>> = {
    preliminar: { dueAt: base.preliminary.dueAt, kind: "internal", rule: `${policy.preliminaryHours} h desde el evento` },
  }
  // Declaraciones: primero las de testigos (desde el evento); la entrevista cuenta desde el preliminar.
  const witnesses = re20TaskOf(data, "witness_statements")
  if (witnesses.status !== "completed") {
    result.declaraciones = { dueAt: base.witnessStatements.dueAt, kind: "internal", rule: `${policy.witnessStatementsHours} h desde el evento` }
  } else if (base.injuredInterview.dueAt) {
    result.declaraciones = { dueAt: base.injuredInterview.dueAt, kind: "internal", rule: `${policy.injuredInterviewHours} h desde el informe preliminar` }
  }
  if (base.diat) result.diat = { dueAt: base.diat.dueAt, kind: "legal", rule: "24 h desde que se conoce el accidente" }
  if (base.definitive.dueAt) result.investigacion = { dueAt: base.definitive.dueAt, kind: "internal", rule: `${policy.definitiveHours} h desde el informe preliminar` }
  if (base.diffusion.dueAt) result.difusion = { dueAt: base.diffusion.dueAt, kind: "internal", rule: `${policy.diffusionHours} h desde la aprobación` }
  if (definitive.status === "completed" && definitive.completedAt) {
    result.seguimiento = { dueAt: nextRe20FollowupDueAt(definitive.completedAt, policy), kind: "internal", rule: `cada ${policy.followupDays} días` }
  }
  return result
}

export type Re20DeadlineState = "overdue" | "soon" | "ok"

/** «soon» = quedan 2 horas o menos. */
/** `now` es obligatorio: debe ser `ws.now`, igual en servidor y cliente, o la hidratación falla. */
export function re20DeadlineState(dueAt: string, now: number): Re20DeadlineState {
  const remaining = Date.parse(dueAt) - now
  if (remaining < 0) return "overdue"
  if (remaining <= 2 * 3_600_000) return "soon"
  return "ok"
}

/** «en 2 h 15 min», «hace 3 h», «en 4 días». */
export function re20RelativeTime(dueAt: string, now: number) {
  const diff = Date.parse(dueAt) - now
  const abs = Math.abs(diff)
  const minutes = Math.round(abs / 60_000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  const text = days >= 2 ? `${days} días`
    : hours >= 1 ? `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`
      : `${Math.max(1, minutes)} min`
  return diff >= 0 ? `en ${text}` : `hace ${text}`
}
