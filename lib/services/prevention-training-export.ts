import { asc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionTrainingAttendance,
  preventionTrainingCourseVersions,
  preventionTrainingSessions,
  workers,
} from "@/db/schema"
import {
  COMPETENCY_SCOPE_LABELS,
  TRAINING_ASSESSMENT_RESULT_LABELS,
  TRAINING_ATTENDANCE_STATUS_LABELS,
  TRAINING_KIND_LABELS,
  TRAINING_MODALITY_LABELS,
  TRAINING_SESSION_STATUS_LABELS,
  TRAINING_VERSION_STATUS_LABELS,
  competencyStatusLabel,
} from "@/lib/prevention/training"
import type { ReportCell, ReportData, ReportSheet } from "@/lib/reports/export"
import { sanitizeCell as safeCell } from "@/lib/reports/export-module/excel-builder"
import {
  listCompetencyGaps,
  listCompetencyRequirements,
  listTrainingSessions,
  listWorkerCompetencies,
  type TrainingAccess,
} from "@/lib/services/prevention-training"
import { todayInChile } from "@/lib/utils"

function sheet(worksheetName: string, headers: string[], rows: ReportCell[][]): ReportSheet {
  return { worksheetName, headers, rows }
}

function label(map: Record<string, string>, key: string | null | undefined) {
  if (!key) return ""
  return map[key] ?? key
}

/**
 * Expediente formativo. Entrega la matriz de competencias, las brechas y el
 * detalle de sesiones con su denominador real (convocados vs. asistentes vs.
 * acuses), que es lo que permite demostrar cumplimiento del DS 44 art. 16.
 */
export async function buildTrainingExport(access: TrainingAccess): Promise<ReportData> {
  if (!access.permissions.includes("prevention:training:export")) {
    throw new Error("Registro de capacitación no encontrado o fuera de alcance.")
  }

  const [competencies, gaps, sessions, requirements] = await Promise.all([
    listWorkerCompetencies(access),
    listCompetencyGaps(access),
    listTrainingSessions(access),
    listCompetencyRequirements(access),
  ])

  const sessionIds = sessions.map((row) => row.session.id)
  const attendance = sessionIds.length === 0 ? [] : await db.select({
    attendance: preventionTrainingAttendance,
    sessionCode: preventionTrainingSessions.code,
    workerFirstName: workers.firstName,
    workerLastName: workers.lastName,
    workerPosition: workers.position,
  })
    .from(preventionTrainingAttendance)
    .innerJoin(preventionTrainingSessions, eq(preventionTrainingAttendance.sessionId, preventionTrainingSessions.id))
    .innerJoin(workers, eq(preventionTrainingAttendance.workerId, workers.id))
    .where(inArray(preventionTrainingAttendance.sessionId, sessionIds))
    .orderBy(asc(preventionTrainingSessions.code), asc(workers.lastName))

  const versions = sessionIds.length === 0 ? [] : await db.select()
    .from(preventionTrainingCourseVersions)
    .where(inArray(preventionTrainingCourseVersions.id, [...new Set(sessions.map((row) => row.session.courseVersionId))]))

  const sheets: ReportSheet[] = [
    sheet(
      "Matriz de competencias",
      ["Trabajador", "Cargo", "Faena", "Curso", "Tipo", "Estado", "Origen", "Otorgada", "Vence", "Emisor externo", "N° certificado", "Evidencia", "Justificación convalidación", "Motivo revocación"],
      competencies.map((row) => [
        safeCell(`${row.workerLastName}, ${row.workerFirstName}`),
        safeCell(row.workerPosition),
        safeCell(row.worksiteName),
        safeCell(row.courseName),
        label(TRAINING_KIND_LABELS, row.courseKind),
        competencyStatusLabel(row.competency.status),
        row.competency.sourceType === "session" ? "Sesión interna" : row.competency.sourceType === "convalidation" ? "Convalidación" : "Certificado externo",
        row.competency.grantedAt,
        row.competency.expiresAt ?? "Sin vencimiento",
        safeCell(row.competency.externalIssuer),
        safeCell(row.competency.externalCertificateNumber),
        safeCell(row.competency.evidenceReference),
        safeCell(row.competency.convalidationJustification),
        safeCell(row.competency.revocationReason),
      ]),
    ),
    sheet(
      "Brechas de competencia",
      ["Trabajador", "Cargo", "Faena", "Curso exigido", "Tipo de brecha", "Exigibilidad", "Venció el", "Fundamento del requisito"],
      gaps.map((gap) => [
        safeCell(gap.workerName),
        safeCell(gap.position),
        safeCell(gap.worksiteId),
        safeCell(gap.courseName),
        gap.gapType === "missing" ? "Nunca obtenida" : gap.gapType === "expired" ? "Vencida" : "Revocada",
        gap.enforcement === "blocking" ? "Bloqueante" : "Advertencia",
        gap.expiredAt ?? "",
        safeCell(gap.reason),
      ]),
    ),
    sheet(
      "Sesiones",
      ["Código", "Curso", "Tipo", "Versión", "Faena", "Estado", "Modalidad", "Programada", "Inicio", "Término", "Duración (min)", "Relator interno", "Relator externo", "Evidencia competencia relator", "Convocados", "Asistentes", "Acuses", "Motivo cancelación"],
      sessions.map((row) => [
        safeCell(row.session.code),
        safeCell(row.courseName),
        label(TRAINING_KIND_LABELS, row.courseKind),
        safeCell(row.versionLabel),
        safeCell(row.worksiteName),
        label(TRAINING_SESSION_STATUS_LABELS, row.session.status),
        label(TRAINING_MODALITY_LABELS, row.session.modality),
        row.session.scheduledAt,
        row.session.startedAt,
        row.session.endedAt,
        row.session.durationMinutes,
        safeCell(row.session.instructorUserId),
        safeCell(row.session.instructorExternalName),
        safeCell(row.session.instructorCompetencyEvidence),
        row.convenedCount,
        row.attendedCount,
        row.acknowledgedCount,
        safeCell(row.session.cancellationReason),
      ]),
    ),
    sheet(
      "Asistencia y evaluación",
      ["Sesión", "Trabajador", "Cargo", "Asistencia", "Minutos", "Nota", "Intentos", "Resultado", "Acuse", "Método acuse", "Firma SHA-256", "Motivo justificación", "Evidencia"],
      attendance.map((row) => [
        safeCell(row.sessionCode),
        safeCell(`${row.workerLastName}, ${row.workerFirstName}`),
        safeCell(row.workerPosition),
        label(TRAINING_ATTENDANCE_STATUS_LABELS, row.attendance.status),
        row.attendance.attendanceMinutes,
        row.attendance.assessmentScore,
        row.attendance.assessmentAttempts,
        label(TRAINING_ASSESSMENT_RESULT_LABELS, row.attendance.assessmentResult),
        row.attendance.acknowledgedAt ?? "Pendiente",
        safeCell(row.attendance.acknowledgementMethod),
        safeCell(row.attendance.acknowledgementSha256),
        safeCell(row.attendance.excuseReason),
        safeCell(row.attendance.evidenceReference),
      ]),
    ),
    sheet(
      "Requisitos de competencia",
      ["Curso", "Alcance", "Valor del alcance", "Faena", "Exigibilidad", "Activo", "Fundamento"],
      requirements.map((row) => [
        safeCell(row.courseName),
        label(COMPETENCY_SCOPE_LABELS, row.requirement.scopeType),
        safeCell(row.requirement.scopeValue),
        safeCell(row.worksiteName),
        row.requirement.enforcement === "blocking" ? "Bloqueante" : "Advertencia",
        row.requirement.isActive ? "Sí" : "No",
        safeCell(row.requirement.reason),
      ]),
    ),
    sheet(
      "Contenidos dictados",
      ["Versión", "Estado", "Duración (min)", "Modalidad", "Evaluación", "Nota aprobación", "Hash contenido", "Vigente desde", "Aprobada", "Publicada"],
      versions.map((version) => [
        safeCell(version.versionLabel),
        label(TRAINING_VERSION_STATUS_LABELS, version.status),
        version.durationMinutes,
        label(TRAINING_MODALITY_LABELS, version.modality),
        version.assessmentType,
        version.passingScore,
        safeCell(version.contentHash),
        version.effectiveFrom,
        version.approvedAt,
        version.publishedAt,
      ]),
    ),
  ]

  return {
    filenameBase: `capacitacion_competencias_${todayInChile()}`,
    worksheetName: sheets[0]!.worksheetName,
    headers: sheets[0]!.headers,
    rows: sheets[0]!.rows,
    sheets,
  }
}
