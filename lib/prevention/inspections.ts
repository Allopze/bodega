import { PARTIAL_STATUS_WEIGHT } from "@/lib/sst/compliance"
import type { FieldKind } from "@/lib/sst/types"

export const INSPECTION_KIND_LABELS: Record<string, string> = {
  inspection: "Inspección",
  observation: "Observación planeada",
  audit: "Auditoría",
}

export const INSPECTION_RUN_STATUS_LABELS: Record<string, string> = {
  planned: "Planificada",
  in_progress: "En ejecución",
  completed: "Ejecutada",
  reviewed: "Revisada y cerrada",
  cancelled: "Cancelada",
}

export const INSPECTION_RESULT_LABELS: Record<string, string> = {
  conforming: "Cumple",
  // "Regular" (escala B/R/M): puntúa 0,5 — ver PARTIAL_STATUS_WEIGHT en
  // lib/sst/compliance.ts. H-04, AUDITORIA_BUGS_2026-08-05.md.
  partial: "Regular",
  non_conforming: "No cumple",
  not_applicable: "No aplica",
}

export const FINDING_CRITICALITY_LABELS: Record<string, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
}

export const FINDING_STATUS_LABELS: Record<string, string> = {
  open: "Abierto",
  capa_linked: "Con CAPA",
  closed: "Cerrado",
}

export const INSPECTION_FREQUENCY_LABELS: Record<string, string> = {
  daily: "Diaria",
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual",
  quarterly: "Trimestral",
  biannual: "Semestral",
  annual: "Anual",
  on_demand: "A demanda",
}

/** Días entre ejecuciones por frecuencia. Es el default; el programa lo puede sobrescribir. */
export const FREQUENCY_INTERVAL_DAYS: Record<string, number> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  quarterly: 90,
  biannual: 182,
  annual: 365,
  on_demand: 365,
}

export function runStatusBadgeVariant(status: string): "default" | "info" | "success" | "warning" | "outline" {
  if (status === "reviewed") return "success"
  if (status === "completed") return "info"
  if (status === "in_progress") return "warning"
  if (status === "cancelled") return "outline"
  return "default"
}

/**
 * Variante del badge de una respuesta. 'partial' tiene su propia rama a
 * propósito: antes de H-04 un estado no reconocido caía al `else` de
 * "success" (verde) por accidente — exactamente el riesgo que introducir un
 * estado nuevo sin actualizar este mapeo habría repetido.
 */
export function resultBadgeVariant(result: string): "success" | "warning" | "danger" | "outline" {
  if (result === "non_conforming") return "danger"
  if (result === "partial") return "warning"
  if (result === "not_applicable") return "outline"
  return "success"
}

export function criticalityBadgeVariant(criticality: string): "default" | "warning" | "danger" {
  if (criticality === "critical" || criticality === "high") return "danger"
  if (criticality === "medium") return "warning"
  return "default"
}

/**
 * El daño potencial declarado en la plantilla define la criticidad del
 * hallazgo. No la decide quien ejecuta en terreno: así dos personas frente al
 * mismo incumplimiento producen la misma severidad.
 *
 * Un ítem sin `danoPotencial` cae a `medium`, igual que el default histórico
 * del checklist PDTP.
 */
export function criticalityFromDanoPotencial(dano: string | null | undefined): "low" | "medium" | "high" | "critical" {
  switch (dano) {
    case "fatal": return "critical"
    case "grave": return "high"
    case "leve": return "low"
    case "moderado": return "medium"
    default: return "medium"
  }
}

/**
 * Prioridad, plazo y respuesta de terreno de la CAPA derivada.
 *
 * `requiresImmediateStop` separa dos cosas que no son la misma: detener la
 * tarea en el acto —respuesta inmediata por definición— y el plazo
 * administrativo para cerrar la acción con evidencia. Expresar la urgencia
 * como un plazo de cero días sólo produce acciones vencidas al nacer.
 */
export function capaPriorityForCriticality(criticality: string): {
  priority: "low" | "medium" | "high" | "critical"
  dueInDays: number
  requiresImmediateStop: boolean
} {
  switch (criticality) {
    case "critical": return { priority: "critical", dueInDays: 3, requiresImmediateStop: true }
    case "high": return { priority: "high", dueInDays: 7, requiresImmediateStop: false }
    case "low": return { priority: "low", dueInDays: 30, requiresImmediateStop: false }
    default: return { priority: "medium", dueInDays: 15, requiresImmediateStop: false }
  }
}

/** Ítems con escala B/R/M (Bueno/Regular/Malo): los únicos que admiten 'partial'. */
const BRM_KINDS: readonly FieldKind[] = [
  "bueno_regular_malo_obs",
  "bueno_regular_malo_na_obs",
  "bueno_regular_malo_na_nt_obs",
]

/** ¿Este tipo de ítem admite la respuesta intermedia 'partial' (Regular)? */
export function fieldKindAcceptsPartial(kind: FieldKind | null | undefined): boolean {
  return kind !== null && kind !== undefined && BRM_KINDS.includes(kind)
}

export interface InspectionItemSpec {
  sectionId: string
  itemId: string
  label: string
  required: boolean
  countsForCompliance: boolean
  danoPotencial?: string | null
  /**
   * Tipo de campo del catálogo SST (lib/sst/types.ts). Determina si el ítem
   * admite 'partial' — sin esto se perdía la escala B/R/M al aplanar la
   * definición (H-04, AUDITORIA_BUGS_2026-08-05.md).
   */
  kind?: FieldKind
}

export interface InspectionAnswerInput {
  sectionId: string
  itemId: string
  result: "conforming" | "partial" | "non_conforming" | "not_applicable"
  comment?: string | null
}

export interface ComplianceSummary {
  conforming: number
  /** Respuestas 'partial' (Regular, escala B/R/M). Puntúan 0,5 en `compliancePercent`. */
  partial: number
  nonConforming: number
  notApplicable: number
  /**
   * Porcentaje sobre los ítems que cuentan para cumplimiento y fueron
   * respondidos como cumple/regular/no cumple. Los "no aplica" salen del
   * denominador: incluirlos castigaría o premiaría según cuántos ítems no
   * correspondan. Sin ítems evaluables devuelve `null`, no 0: no es cero
   * cumplimiento, es cumplimiento no calculable.
   *
   * Misma fórmula que `calculateCompliance` en lib/sst/compliance.ts —
   * (cumplidos + 0,5·regulares) / total — para que un mismo checklist B/R/M
   * puntúe igual sin importar por qué motor pasó (H-04).
   */
  compliancePercent: number | null
}

export function summarizeCompliance(items: InspectionItemSpec[], answers: InspectionAnswerInput[]): ComplianceSummary {
  const spec = new Map(items.map((item) => [`${item.sectionId}::${item.itemId}`, item]))
  let conforming = 0
  let partial = 0
  let nonConforming = 0
  let notApplicable = 0
  let scored = 0
  let scoredPoints = 0

  for (const answer of answers) {
    const item = spec.get(`${answer.sectionId}::${answer.itemId}`)
    if (answer.result === "conforming") conforming += 1
    else if (answer.result === "partial") partial += 1
    else if (answer.result === "non_conforming") nonConforming += 1
    else notApplicable += 1

    if (!item?.countsForCompliance) continue
    if (answer.result === "not_applicable") continue
    scored += 1
    if (answer.result === "conforming") scoredPoints += 1
    else if (answer.result === "partial") scoredPoints += PARTIAL_STATUS_WEIGHT
  }

  return {
    conforming,
    partial,
    nonConforming,
    notApplicable,
    compliancePercent: scored === 0 ? null : Math.round((scoredPoints / scored) * 100),
  }
}

export interface DerivedFinding {
  sectionId: string
  itemId: string
  description: string
  criticality: "low" | "medium" | "high" | "critical"
}

/** Cada respuesta no conforme produce un hallazgo con su criticidad derivada. */
export function deriveFindings(items: InspectionItemSpec[], answers: InspectionAnswerInput[]): DerivedFinding[] {
  const spec = new Map(items.map((item) => [`${item.sectionId}::${item.itemId}`, item]))
  const findings: DerivedFinding[] = []
  for (const answer of answers) {
    if (answer.result !== "non_conforming") continue
    const item = spec.get(`${answer.sectionId}::${answer.itemId}`)
    if (!item) continue
    findings.push({
      sectionId: answer.sectionId,
      itemId: answer.itemId,
      description: answer.comment?.trim() ? `${item.label}: ${answer.comment.trim()}` : item.label,
      criticality: criticalityFromDanoPotencial(item.danoPotencial),
    })
  }
  return findings
}

export interface CompletionBlocker {
  kind: "missing_required" | "missing_na_reason" | "missing_partial_reason"
  detail: string
}

/**
 * Una inspección no se declara ejecutada con ítems obligatorios sin responder.
 *
 * Piso de seguridad: el catálogo SST heredado no declara `required` en ningún
 * ítem, así que confiar sólo en esa marca dejaría el gate inerte y permitiría
 * cerrar una inspección sin una sola respuesta. Cuando la plantilla no declara
 * obligatorios, se exigen todos los ítems que cuentan para cumplimiento. En
 * cuanto Prevención marque obligatorios reales, manda la marca por ítem.
 */
export function assessRunCompletion(items: InspectionItemSpec[], answers: InspectionAnswerInput[]): { allowed: boolean; blockers: CompletionBlocker[] } {
  const answered = new Map(answers.map((answer) => [`${answer.sectionId}::${answer.itemId}`, answer]))
  const blockers: CompletionBlocker[] = []
  const declaresRequired = items.some((item) => item.required)

  for (const item of items) {
    const mustAnswer = declaresRequired ? item.required : item.countsForCompliance
    if (!mustAnswer) continue
    const answer = answered.get(`${item.sectionId}::${item.itemId}`)
    if (!answer) {
      blockers.push({ kind: "missing_required", detail: item.label })
      continue
    }
    if (answer.result === "not_applicable" && (answer.comment?.trim().length ?? 0) < 3) {
      blockers.push({ kind: "missing_na_reason", detail: item.label })
    }
    // 'Regular' (escala B/R/M) exige justificarse por escrito, igual que en
    // el motor SST — ver requiresObservation en lib/sst/compliance.ts.
    if (answer.result === "partial" && (answer.comment?.trim().length ?? 0) < 3) {
      blockers.push({ kind: "missing_partial_reason", detail: item.label })
    }
  }
  return { allowed: blockers.length === 0, blockers }
}

export interface ReviewBlocker {
  kind: "executor_is_reviewer" | "critical_finding_without_capa"
  detail: string
}

/**
 * Revisar y cerrar exige independencia de quien ejecutó y que todo hallazgo
 * alto o crítico tenga una CAPA enlazada. Un hallazgo grave sin acción es
 * exactamente lo que la auditoría no acepta como cierre.
 */
export function assessRunReview(args: {
  executedByUserId: string | null
  reviewerUserId: string
  findings: { id: string; description: string; criticality: string; capaActionId: string | null }[]
}): { allowed: boolean; blockers: ReviewBlocker[] } {
  const blockers: ReviewBlocker[] = []
  if (args.executedByUserId && args.executedByUserId === args.reviewerUserId) {
    blockers.push({ kind: "executor_is_reviewer", detail: "Quien ejecutó la inspección no puede revisarla y cerrarla." })
  }
  for (const finding of args.findings) {
    if (["high", "critical"].includes(finding.criticality) && !finding.capaActionId) {
      blockers.push({ kind: "critical_finding_without_capa", detail: `El hallazgo "${finding.description}" es ${FINDING_CRITICALITY_LABELS[finding.criticality] ?? finding.criticality} y no tiene CAPA.` })
    }
  }
  return { allowed: blockers.length === 0, blockers }
}

export interface EnrichmentCoverage {
  totalItems: number
  withDanoPotencial: number
  withRequired: number
  /** `true` cuando ningún ítem declara daño potencial. */
  criticalityInert: boolean
}

/**
 * Mide cuánto de la plantilla está realmente calibrado.
 *
 * El catálogo SST heredado no declara `danoPotencial` en ningún ítem, y ese
 * campo es el que gobierna la criticidad del hallazgo aquí y la prioridad y el
 * plazo de la acción correctiva en PDTP. Sin él todo cae al default medio,
 * incluidos incumplimientos de consecuencia fatal.
 *
 * Esta función no inventa severidades —eso lo decide Prevención— pero deja el
 * vacío a la vista en la bandeja y en la exportación, en vez de degradarse en
 * silencio.
 */
export function assessEnrichmentCoverage(items: InspectionItemSpec[]): EnrichmentCoverage {
  const withDanoPotencial = items.filter((item) => Boolean(item.danoPotencial)).length
  return {
    totalItems: items.length,
    withDanoPotencial,
    withRequired: items.filter((item) => item.required).length,
    criticalityInert: items.length > 0 && withDanoPotencial === 0,
  }
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

/* ── Origen de la inspección y oportunidad del cierre ──────────────────────
 * La certificación Mutual distingue las inspecciones del comité paritario de
 * las del Departamento de Prevención, y pide demostrar seguimiento de las
 * medidas que generan. El indicador de cierre oportuno responde eso: no cuántos
 * hallazgos hubo, sino cuántos se cerraron dentro del plazo comprometido.
 */

export const INSPECTION_ORIGIN_LABELS: Record<string, string> = {
  prevencion: "Departamento de Prevención",
  cphs: "Comité Paritario",
  mandante: "Mandante",
}

export interface FindingClosureRow {
  /** Plazo comprometido de la acción correctiva, `YYYY-MM-DD`. */
  targetDate: string | null
  /** Fecha de cierre efectivo, `YYYY-MM-DD`; `null` si sigue abierto. */
  closedOn: string | null
}

export interface TimelyClosureSummary {
  /** Hallazgos con acción correctiva y plazo comprometido. */
  tracked: number
  closedOnTime: number
  closedLate: number
  /** Abiertos cuyo plazo ya venció. */
  overdue: number
  openOnTime: number
  /** Porcentaje de cierre oportuno sobre lo ya resuelto o vencido; `null` si nada venció aún. */
  timelyPct: number | null
}

/**
 * Un hallazgo cerrado después de su plazo cuenta como cerrado, pero no como
 * cerrado a tiempo: si no se distinguen, un módulo que cierra todo con seis
 * meses de atraso se ve idéntico a uno que cumple.
 */
export function summarizeTimelyClosure(findings: FindingClosureRow[], asOf: string): TimelyClosureSummary {
  const tracked = findings.filter((finding) => finding.targetDate !== null)
  let closedOnTime = 0
  let closedLate = 0
  let overdue = 0
  let openOnTime = 0

  for (const finding of tracked) {
    const target = finding.targetDate!
    if (finding.closedOn) {
      if (finding.closedOn <= target) closedOnTime++
      else closedLate++
    } else if (target < asOf) {
      overdue++
    } else {
      openOnTime++
    }
  }

  // El denominador es lo que ya se puede juzgar: cerrado o vencido. Lo que
  // sigue abierto dentro de plazo no es ni cumplimiento ni incumplimiento.
  const judged = closedOnTime + closedLate + overdue
  return {
    tracked: tracked.length,
    closedOnTime,
    closedLate,
    overdue,
    openOnTime,
    timelyPct: judged === 0 ? null : Math.round((closedOnTime / judged) * 100),
  }
}
