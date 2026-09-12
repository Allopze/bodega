import {
  DS44_ART16_CITATION,
  DS44_ART16_MAX_VALIDITY_MONTHS,
  DS44_ART16_MIN_DURATION_MINUTES,
} from "@/lib/validation/prevention-module/training"

export const TRAINING_KIND_LABELS: Record<string, string> = {
  induction_corporate: "Inducción corporativa",
  induction_worksite: "Inducción de faena",
  odi: "ODI (obligación de informar)",
  legal_mandatory: "Curso legal obligatorio",
  operational_talk: "Charla operacional",
  practical_training: "Entrenamiento práctico",
  certification: "Certificación o licencia",
  retraining: "Reentrenamiento",
}

export const TRAINING_VERSION_STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  in_review: "En revisión",
  observed: "Observado",
  approved: "Aprobado",
  published: "Vigente",
  superseded: "Reemplazado",
}

export const TRAINING_SESSION_STATUS_LABELS: Record<string, string> = {
  planned: "Planificada",
  in_progress: "En curso",
  completed: "Realizada",
  cancelled: "Cancelada",
}

export const TRAINING_ATTENDANCE_STATUS_LABELS: Record<string, string> = {
  convened: "Convocado",
  attended: "Asistió",
  absent: "Ausente",
  excused: "Justificado",
}

export const TRAINING_ASSESSMENT_RESULT_LABELS: Record<string, string> = {
  pending: "Pendiente",
  approved: "Aprobada",
  failed: "Reprobada",
  not_required: "No exigida",
}

export const COMPETENCY_STATUS_LABELS: Record<string, string> = {
  valid: "Vigente",
  expired: "Vencida",
  revoked: "Revocada",
  superseded: "Reemplazada",
}

export const TRAINING_MODALITY_LABELS: Record<string, string> = {
  presencial: "Presencial",
  elearning: "E-learning",
  mixta: "Mixta",
  practica: "Práctica",
  teorica: "Teórica",
}

export const COMPETENCY_SCOPE_LABELS: Record<string, string> = {
  global: "Toda la organización",
  worksite: "Faena",
  position: "Cargo",
  task: "Tarea",
  committee: "Integrantes del comité paritario",
}


export function competencyStatusLabel(status: string) {
  return COMPETENCY_STATUS_LABELS[status] ?? status
}

export function competencyStatusBadgeVariant(status: string): "success" | "warning" | "danger" | "outline" {
  if (status === "valid") return "success"
  if (status === "expired") return "warning"
  if (status === "revoked") return "danger"
  return "outline"
}

/** Suma meses conservando el último día válido del mes destino. */
export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number)
  if (!year || !month || !day) throw new Error("Fecha inválida para calcular vigencia.")
  const target = new Date(Date.UTC(year, month - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, lastDay))
  return target.toISOString().slice(0, 10)
}

/**
 * Vencimiento de una competencia. `validityMonths` nulo significa que el curso
 * no caduca; se devuelve `null` en vez de una fecha inventada.
 */
export function competencyExpiry(grantedAt: string, validityMonths: number | null | undefined): string | null {
  if (validityMonths == null) return null
  return addMonths(grantedAt, validityMonths)
}

export interface LegalFloorFinding {
  field: "minimumDurationMinutes" | "validityMonths" | "durationMinutes"
  message: string
}

/**
 * Contrasta un curso legal obligatorio contra el piso del DS 44 art. 16. No
 * decide por sí solo la aplicabilidad — eso lo valida Prevención — pero impide
 * declarar como "legal obligatorio" algo que no alcanza el mínimo citado.
 */
export function assessLegalFloor(input: {
  kind: string
  minimumDurationMinutes: number
  validityMonths: number | null | undefined
  deliveredDurationMinutes?: number | null
}): LegalFloorFinding[] {
  if (input.kind !== "legal_mandatory") return []
  const findings: LegalFloorFinding[] = []
  if (input.minimumDurationMinutes < DS44_ART16_MIN_DURATION_MINUTES) {
    findings.push({ field: "minimumDurationMinutes", message: `La duración declarada (${input.minimumDurationMinutes} min) es inferior al mínimo legal de ${DS44_ART16_MIN_DURATION_MINUTES} min. ${DS44_ART16_CITATION}` })
  }
  if (input.validityMonths == null || input.validityMonths > DS44_ART16_MAX_VALIDITY_MONTHS) {
    findings.push({ field: "validityMonths", message: `La vigencia debe declararse y no superar ${DS44_ART16_MAX_VALIDITY_MONTHS} meses. ${DS44_ART16_CITATION}` })
  }
  if (input.deliveredDurationMinutes != null && input.deliveredDurationMinutes < input.minimumDurationMinutes) {
    findings.push({ field: "durationMinutes", message: `La sesión duró ${input.deliveredDurationMinutes} min y el curso exige ${input.minimumDurationMinutes} min.` })
  }
  return findings
}

export type CompetencyGap = {
  workerId: string
  workerName: string
  worksiteId: string
  position: string | null
  courseId: string
  courseName: string
  requirementId: string
  enforcement: "blocking" | "warning"
  reason: string
  /** `missing` = nunca la obtuvo. `expired` = la tuvo y caducó. */
  gapType: "missing" | "expired" | "revoked"
  expiredAt: string | null
}

export interface CompetencyRequirementRow {
  id: string
  courseId: string
  courseName: string
  scopeType: string
  scopeValue: string | null
  worksiteId: string | null
  enforcement: string
  reason: string
  isActive: boolean
}

export interface WorkerRow {
  id: string
  firstName: string
  lastName: string
  position: string | null
  worksiteId: string
  isActive: boolean
}

export interface CompetencyRow {
  workerId: string
  courseId: string
  status: string
  expiresAt: string | null
}

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase("es-CL")
}

function requirementApplies(
  requirement: CompetencyRequirementRow,
  worker: WorkerRow,
  committeeMembers?: ReadonlyMap<string, ReadonlySet<string>>,
) {
  if (!requirement.isActive) return false
  switch (requirement.scopeType) {
    case "global":
      return true
    case "worksite":
      return requirement.worksiteId === worker.worksiteId
    case "position":
      return normalize(requirement.scopeValue) !== "" && normalize(requirement.scopeValue) === normalize(worker.position)
    case "committee":
      // `scope_value` es el id del comité; aplica sólo a sus integrantes activos.
      // Sin el padrón cargado no se inventa una brecha: se omite.
      return committeeMembers?.get(requirement.scopeValue ?? "")?.has(worker.id) ?? false
    default:
      // `task` se resuelve al asignar la tarea, no por dotación.
      return false
  }
}

/**
 * Cruza dotación activa × requisitos vigentes × competencias y devuelve las
 * brechas. Una competencia cuenta como vigente sólo si su estado es `valid` y
 * su vencimiento (si lo tiene) es posterior a `asOf`; una fila `valid` con
 * fecha pasada se reporta como vencida aunque el job todavía no la marque.
 */
export function computeCompetencyGaps(args: {
  workers: WorkerRow[]
  requirements: CompetencyRequirementRow[]
  competencies: CompetencyRow[]
  asOf: string
  /** Padrón por comité (`committeeId` → ids de integrantes activos). Sólo lo
   *  necesitan los requisitos de alcance `committee`; sin él se omiten. */
  committeeMembers?: ReadonlyMap<string, ReadonlySet<string>>
}): CompetencyGap[] {
  const byWorker = new Map<string, CompetencyRow[]>()
  for (const item of args.competencies) {
    const list = byWorker.get(item.workerId)
    if (list) list.push(item)
    else byWorker.set(item.workerId, [item])
  }

  const gaps: CompetencyGap[] = []
  for (const worker of args.workers) {
    if (!worker.isActive) continue
    const held = byWorker.get(worker.id) ?? []
    for (const requirement of args.requirements) {
      if (!requirementApplies(requirement, worker, args.committeeMembers)) continue
      const matches = held.filter((item) => item.courseId === requirement.courseId)
      const active = matches.find((item) => item.status === "valid" && (item.expiresAt === null || item.expiresAt >= args.asOf))
      if (active) continue

      const lapsed = matches
        .filter((item) => item.status === "valid" || item.status === "expired")
        .sort((a, b) => (b.expiresAt ?? "").localeCompare(a.expiresAt ?? ""))[0]
      const revoked = matches.find((item) => item.status === "revoked")
      const gapType: CompetencyGap["gapType"] = lapsed ? "expired" : revoked ? "revoked" : "missing"

      gaps.push({
        workerId: worker.id,
        workerName: `${worker.firstName} ${worker.lastName}`.trim(),
        worksiteId: worker.worksiteId,
        position: worker.position,
        courseId: requirement.courseId,
        courseName: requirement.courseName,
        requirementId: requirement.id,
        enforcement: requirement.enforcement === "blocking" ? "blocking" : "warning",
        reason: requirement.reason,
        gapType,
        expiredAt: lapsed?.expiresAt ?? null,
      })
    }
  }
  return gaps
}
