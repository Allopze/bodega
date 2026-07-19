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

/** Prioridad y plazo de la CAPA derivada, alineados con la criticidad. */
export function capaPriorityForCriticality(criticality: string): { priority: "low" | "medium" | "high" | "critical"; dueInDays: number } {
  switch (criticality) {
    case "critical": return { priority: "critical", dueInDays: 3 }
    case "high": return { priority: "high", dueInDays: 7 }
    case "low": return { priority: "low", dueInDays: 30 }
    default: return { priority: "medium", dueInDays: 15 }
  }
}

export interface InspectionItemSpec {
  sectionId: string
  itemId: string
  label: string
  required: boolean
  countsForCompliance: boolean
  danoPotencial?: string | null
}

export interface InspectionAnswerInput {
  sectionId: string
  itemId: string
  result: "conforming" | "non_conforming" | "not_applicable"
  comment?: string | null
}

export interface ComplianceSummary {
  conforming: number
  nonConforming: number
  notApplicable: number
  /**
   * Porcentaje sobre los ítems que cuentan para cumplimiento y fueron
   * respondidos como cumple/no cumple. Los "no aplica" salen del denominador:
   * incluirlos castigaría o premiaría según cuántos ítems no correspondan.
   * Sin ítems evaluables devuelve `null`, no 0: no es cero cumplimiento, es
   * cumplimiento no calculable.
   */
  compliancePercent: number | null
}

export function summarizeCompliance(items: InspectionItemSpec[], answers: InspectionAnswerInput[]): ComplianceSummary {
  const spec = new Map(items.map((item) => [`${item.sectionId}::${item.itemId}`, item]))
  let conforming = 0
  let nonConforming = 0
  let notApplicable = 0
  let scored = 0
  let scoredConforming = 0

  for (const answer of answers) {
    const item = spec.get(`${answer.sectionId}::${answer.itemId}`)
    if (answer.result === "conforming") conforming += 1
    else if (answer.result === "non_conforming") nonConforming += 1
    else notApplicable += 1

    if (!item?.countsForCompliance) continue
    if (answer.result === "not_applicable") continue
    scored += 1
    if (answer.result === "conforming") scoredConforming += 1
  }

  return {
    conforming,
    nonConforming,
    notApplicable,
    compliancePercent: scored === 0 ? null : Math.round((scoredConforming / scored) * 100),
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
  kind: "missing_required" | "missing_na_reason"
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

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
