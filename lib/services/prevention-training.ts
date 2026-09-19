import { createHash } from "node:crypto"
import { and, asc, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm"
import { z } from "zod"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { db, type DB, type Tx } from "@/db"
import {
  preventionCapaActions,
  preventionCompetencyRequirements,
  preventionTrainingAttendance,
  preventionTrainingCourseVersions,
  preventionTrainingCourses,
  preventionTrainingHistory,
  preventionTrainingSessions,
  preventionWorkerCompetencies,
  users,
  workers,
  worksites,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import {
  assessLegalFloor,
  competencyExpiry,
  type CompetencyGap,
} from "@/lib/prevention/training"
import { createNotifications } from "@/lib/services/notifications"
import { getUserIdsWithPermission } from "@/lib/services/notification-targeting"
import { createCapaActionWithClient } from "@/lib/services/prevention-capa"
import { resolveOwnWorkSigning } from "@/lib/services/prevention-signing"
import { verifyPreventionAckToken } from "@/lib/services/prevention-ack-token"
import { competencyConvalidationSchema,
  competencyRequirementSchema,
  competencyRevocationSchema,
  trainingAcknowledgementSchema,
  trainingAttendanceRecordSchema,
  trainingCourseSchema,
  trainingCourseVersionSchema,
  trainingSessionCancelSchema,
  trainingSessionCloseSchema,
  trainingSessionSchema,
  trainingVersionTransitionSchema,
} from "@/lib/validation/prevention-module/training"
import { onTrainingSessionCancelled, onTrainingSessionClosed } from "@/lib/services/pdtp-adapters/pdtp-accreditation-connectors"
import { replacePdtpAccreditationBindings, resolvePdtpAccreditationTarget } from "@/lib/services/pdtp/accreditation-bindings"
import { computeCompetencyGapsForScope } from "@/lib/services/prevention-training-gaps"
import { codeYear, todayInChile } from "@/lib/utils"

type Client = DB | Tx

export interface TrainingAccess {
  userId: string
  scope: WorksiteScope
  permissions: readonly string[]
}

const NOT_FOUND = "Registro de capacitación no encontrado o fuera de alcance."

function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

function requireAccess(access: TrainingAccess, permission: string, worksiteId?: string) {
  if (!access.permissions.includes(permission) || (worksiteId && !scopeAllows(access.scope, worksiteId))) {
    throw new Error(NOT_FOUND)
  }
}

function scopeCondition(scope: WorksiteScope, column: AnyPgColumn) {
  if (scope.mode === "all") return undefined
  if (scope.mode === "none" || scope.ids.length === 0) return sql`false`
  return inArray(column, scope.ids)
}

function nowIso() {
  return new Date().toISOString()
}

function sha256(value: unknown) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex")
}

function sessionCode() {
  return `CAP-${codeYear()}-${nanoid(10).toUpperCase()}`
}

async function history(client: Client, args: {
  entityType: string
  entityId: string
  worksiteId?: string | null
  changeType: string
  reason: string
  beforeState?: unknown
  afterState?: unknown
  actorUserId?: string | null
}) {
  await client.insert(preventionTrainingHistory).values({
    id: `ptrh-${nanoid()}`,
    entityType: args.entityType,
    entityId: args.entityId,
    worksiteId: args.worksiteId ?? null,
    changeType: args.changeType,
    reason: args.reason,
    beforeState: args.beforeState ?? null,
    afterState: args.afterState ?? null,
    actorUserId: args.actorUserId ?? null,
  })
}

/* ── Catálogo de cursos ───────────────────────────────────────────────────── */

export async function createTrainingCourse(input: unknown, access: TrainingAccess) {
  requireAccess(access, "prevention:training:manage")
  const data = trainingCourseSchema.parse(input)
  const findings = assessLegalFloor({
    kind: data.kind,
    minimumDurationMinutes: data.minimumDurationMinutes,
    validityMonths: data.validityMonths ?? null,
  })
  if (findings.length > 0) throw new Error(findings.map((item) => item.message).join(" "))

  const id = `trcourse-${nanoid()}`
  return db.transaction(async (tx) => {
  const [created] = await tx.insert(preventionTrainingCourses).values({
    id,
    code: data.code,
    name: data.name,
    kind: data.kind,
    description: data.description ?? null,
    minimumDurationMinutes: data.minimumDurationMinutes,
    validityMonths: data.validityMonths ?? null,
    requiresAssessment: data.requiresAssessment,
    passingScore: data.passingScore,
    legalRequirementId: data.legalRequirementId ?? null,
    riskEntryId: data.riskEntryId ?? null,
    legalBasis: data.legalBasis ?? null,
    pdtpActivityNumbers: data.catalogActivityIds ? [] : data.pdtpActivityNumbers,
    createdByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo crear el curso.")
  if (data.catalogActivityIds) await replacePdtpAccreditationBindings({ sourceType: "capacitacion", sourceId: id, eventType: "close", catalogActivityIds: data.catalogActivityIds, updatedByUserId: access.userId }, tx)
  await history(tx, { entityType: "course", entityId: created.id, changeType: "created", reason: "Curso registrado en el catálogo", afterState: created, actorUserId: access.userId })
  return created
  })
}

export async function createTrainingCourseVersion(input: unknown, access: TrainingAccess) {
  requireAccess(access, "prevention:training:manage")
  const data = trainingCourseVersionSchema.parse(input)
  return db.transaction(async (tx) => {
    const [course] = await tx.select().from(preventionTrainingCourses).where(eq(preventionTrainingCourses.id, data.courseId)).limit(1)
    if (!course) throw new Error(NOT_FOUND)
    const findings = assessLegalFloor({
      kind: course.kind,
      minimumDurationMinutes: course.minimumDurationMinutes,
      validityMonths: course.validityMonths,
      deliveredDurationMinutes: data.durationMinutes,
    })
    if (findings.length > 0) throw new Error(findings.map((item) => item.message).join(" "))

    const outlineMinutes = data.contentOutline.reduce((total, item) => total + item.minutes, 0)
    if (outlineMinutes > data.durationMinutes) {
      throw new Error("El temario declara más minutos que la duración total del curso.")
    }

    const [created] = await tx.insert(preventionTrainingCourseVersions).values({
      id: `trver-${nanoid()}`,
      courseId: data.courseId,
      versionLabel: data.versionLabel,
      status: "draft",
      contentOutline: data.contentOutline,
      durationMinutes: data.durationMinutes,
      modality: data.modality,
      assessmentType: data.assessmentType,
      passingScore: data.passingScore,
      contentHash: sha256({ outline: data.contentOutline, duration: data.durationMinutes, modality: data.modality }),
      effectiveFrom: data.effectiveFrom ?? null,
      authorUserId: access.userId,
    }).returning()
    if (!created) throw new Error("No se pudo crear la versión del curso.")
    await history(tx, { entityType: "course_version", entityId: created.id, changeType: "created", reason: `Versión ${data.versionLabel} en borrador`, afterState: created, actorUserId: access.userId })
    return created
  })
}

/**
 * Máquina de estados de contenido formativo. La aprobación es segregada: quien
 * escribió el temario no puede aprobarlo, igual que en control documental.
 * Publicar reemplaza la versión vigente anterior dentro de la transacción.
 */
export async function transitionTrainingCourseVersion(input: unknown, access: TrainingAccess) {
  const data = trainingVersionTransitionSchema.parse(input)
  const permission = data.toStatus === "approved" || data.toStatus === "published" ? "prevention:training:approve" : "prevention:training:manage"
  requireAccess(access, permission)

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(preventionTrainingCourseVersions)
      .where(eq(preventionTrainingCourseVersions.id, data.versionId)).limit(1)
    if (!current) throw new Error(NOT_FOUND)
    if (current.version !== data.expectedVersion) throw new Error("La versión cambió mientras editabas. Recarga y reintenta.")

    const allowed: Record<string, string[]> = {
      draft: ["in_review"],
      in_review: ["observed", "approved"],
      observed: ["in_review"],
      approved: ["published"],
      published: [],
      superseded: [],
    }
    if (!allowed[current.status]?.includes(data.toStatus)) {
      throw new Error(`No se permite pasar de ${current.status} a ${data.toStatus}.`)
    }
    // Aprobar exige no haber redactado, para todos. Publicar —el último
    // eslabón— admite la única excepción declarada del módulo: la jefatura
    // técnica responde por el contenido y no puede quedar esperando que un
    // tercero firme su propio criterio. Misma regla que MIPER, matriz GRD y
    // documentación SST; ver lib/services/prevention-signing.ts.
    if (data.toStatus === "approved" && current.authorUserId === access.userId) {
      throw new Error("El autor del contenido no puede aprobar su propia versión.")
    }
    // INC-002: la excepción por cargo deja constancia en la bitácora.
    const signing = resolveOwnWorkSigning({
      signedByUserId: data.toStatus === "published" ? current.authorUserId : null,
      actorUserId: access.userId,
      permissions: access.permissions,
      what: "Publicar la versión del contenido",
    })
    if (!signing.ok) {
      throw new Error("El autor del contenido no puede publicar su propia versión.")
    }
    if (data.toStatus === "published" && current.effectiveFrom && current.effectiveFrom > todayInChile()) {
      throw new Error("La versión no puede publicarse antes de su fecha de entrada en vigencia.")
    }

    const now = nowIso()
    const patch: Record<string, unknown> = {
      status: data.toStatus,
      version: current.version + 1,
      updatedAt: now,
      observationComment: data.toStatus === "observed" ? data.reason : null,
    }
    if (data.toStatus === "in_review") { patch.reviewedByUserId = access.userId; patch.reviewedAt = now }
    if (data.toStatus === "approved") { patch.approvedByUserId = access.userId; patch.approvedAt = now }
    if (data.toStatus === "published") { patch.publishedByUserId = access.userId; patch.publishedAt = now }

    if (data.toStatus === "published") {
      const previous = await tx.select().from(preventionTrainingCourseVersions)
        .where(and(
          eq(preventionTrainingCourseVersions.courseId, current.courseId),
          eq(preventionTrainingCourseVersions.status, "published"),
        ))
      for (const item of previous) {
        await tx.update(preventionTrainingCourseVersions)
          .set({ status: "superseded", supersededAt: now, supersededByVersionId: current.id, version: item.version + 1, updatedAt: now })
          .where(eq(preventionTrainingCourseVersions.id, item.id))
        await history(tx, { entityType: "course_version", entityId: item.id, changeType: "superseded", reason: `Reemplazada por ${current.versionLabel}`, beforeState: item, actorUserId: access.userId })
      }
    }

    const [updated] = await tx.update(preventionTrainingCourseVersions).set(patch)
      .where(and(eq(preventionTrainingCourseVersions.id, current.id), eq(preventionTrainingCourseVersions.version, data.expectedVersion)))
      .returning()
    if (!updated) throw new Error("La versión cambió mientras editabas. Recarga y reintenta.")
    await history(tx, { entityType: "course_version", entityId: current.id, changeType: data.toStatus, reason: signing.usedException ? `${data.reason ?? ""} [Firma propia: publicada por su autor, con la excepción prevention:sign_own_work.]`.trim() : data.reason, beforeState: current, afterState: updated, actorUserId: access.userId })
    return updated
  })
}

/* ── Sesiones ─────────────────────────────────────────────────────────────── */

export async function createTrainingSession(input: unknown, access: TrainingAccess) {
  const data = trainingSessionSchema.parse(input)
  requireAccess(access, "prevention:training:manage", data.worksiteId)

  return db.transaction(async (tx) => {
    const [version] = await tx.select().from(preventionTrainingCourseVersions)
      .where(eq(preventionTrainingCourseVersions.id, data.courseVersionId)).limit(1)
    if (!version) throw new Error(NOT_FOUND)
    if (version.status !== "published") throw new Error("Sólo puede dictarse una versión publicada del curso.")

    const id = `trsess-${nanoid()}`
    const [created] = await tx.insert(preventionTrainingSessions).values({
      id,
      code: sessionCode(),
      courseVersionId: data.courseVersionId,
      worksiteId: data.worksiteId,
      scheduledAt: data.scheduledAt,
      modality: data.modality,
      location: data.location ?? null,
      instructorUserId: data.instructorUserId ?? null,
      instructorExternalName: data.instructorExternalName ?? null,
      instructorCompetencyEvidence: data.instructorCompetencyEvidence,
      status: "planned",
      createdByUserId: access.userId,
    }).returning()
    if (!created) throw new Error("No se pudo crear la sesión.")

    if (data.convenedWorkerIds.length > 0) {
      const convened = await tx.select({ id: workers.id, worksiteId: workers.worksiteId, isActive: workers.isActive })
        .from(workers).where(inArray(workers.id, data.convenedWorkerIds))
      const known = new Map(convened.map((item) => [item.id, item]))
      for (const workerId of data.convenedWorkerIds) {
        const worker = known.get(workerId)
        if (!worker || !worker.isActive) throw new Error("Un trabajador convocado no existe o está inactivo.")
        if (worker.worksiteId !== data.worksiteId) throw new Error("No se puede convocar a un trabajador de otra faena.")
      }
      await tx.insert(preventionTrainingAttendance).values(data.convenedWorkerIds.map((workerId) => ({
        id: `trat-${nanoid()}`,
        sessionId: id,
        workerId,
        status: "convened" as const,
        assessmentResult: version.assessmentType === "none" ? "not_required" : "pending",
      })))
    }

    await history(tx, { entityType: "session", entityId: id, worksiteId: data.worksiteId, changeType: "created", reason: `Sesión planificada con ${data.convenedWorkerIds.length} convocados`, afterState: created, actorUserId: access.userId })
    return created
  })
}

export async function recordTrainingAttendance(input: unknown, access: TrainingAccess) {
  const data = trainingAttendanceRecordSchema.parse(input)
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(preventionTrainingSessions)
      .where(eq(preventionTrainingSessions.id, data.sessionId)).limit(1)
    if (!session) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:training:deliver", session.worksiteId)
    if (session.status === "completed" || session.status === "cancelled") {
      throw new Error("No se puede modificar la asistencia de una sesión cerrada o cancelada.")
    }
    const [version] = await tx.select().from(preventionTrainingCourseVersions)
      .where(eq(preventionTrainingCourseVersions.id, session.courseVersionId)).limit(1)
    if (!version) throw new Error(NOT_FOUND)

    const existing = await tx.select().from(preventionTrainingAttendance)
      .where(eq(preventionTrainingAttendance.sessionId, data.sessionId))
    const byWorker = new Map(existing.map((item) => [item.workerId, item]))
    const now = nowIso()
    const results = []

    for (const entry of data.entries) {
      const row = byWorker.get(entry.workerId)
      if (!row) throw new Error("El trabajador no fue convocado a esta sesión.")

      const assessmentRequired = version.assessmentType !== "none"
      let assessmentResult = row.assessmentResult
      let attempts = row.assessmentAttempts
      if (!assessmentRequired) {
        assessmentResult = "not_required"
      } else if (entry.status !== "attended") {
        assessmentResult = "pending"
      } else if (entry.assessmentScore != null) {
        if (entry.assessmentScore !== row.assessmentScore) attempts = row.assessmentAttempts + 1
        assessmentResult = entry.assessmentScore >= version.passingScore ? "approved" : "failed"
      }

      const [updated] = await tx.update(preventionTrainingAttendance).set({
        status: entry.status,
        attendanceMinutes: entry.attendanceMinutes ?? row.attendanceMinutes,
        assessmentScore: entry.assessmentScore ?? row.assessmentScore,
        assessmentAttempts: attempts,
        assessmentResult,
        excuseReason: entry.status === "excused" ? entry.excuseReason ?? null : null,
        evidenceReference: entry.evidenceReference ?? row.evidenceReference,
        recordedByUserId: access.userId,
        updatedAt: now,
      }).where(eq(preventionTrainingAttendance.id, row.id)).returning()
      if (updated) results.push(updated)
    }

    // NO mueve `version` a propósito, a diferencia de `bumpPermitVersion`. Se
    // evaluó hacerlo (auditoría 2026-08-17, HIG-08) y se descartó por ahora: el
    // formulario de asistencia no refresca la sesión tras guardar, así que el
    // bump convertía el flujo normal de un solo usuario —registrar asistencia y
    // luego cerrar— en un falso "la sesión cambió mientras la editabas".
    // Además el caso no es análogo al permiso: `closeTrainingSession` recalcula
    // sobre la asistencia vigente, así que no hay lost update, sólo la
    // posibilidad de aprobar sin haber visto un cambio ajeno. Si se retoma,
    // hay que mover el bump Y refrescar la sesión en la UI a la vez.
    await tx.update(preventionTrainingSessions)
      .set({ status: session.status === "planned" ? "in_progress" : session.status, updatedAt: now })
      .where(eq(preventionTrainingSessions.id, session.id))
    await history(tx, { entityType: "session", entityId: session.id, worksiteId: session.worksiteId, changeType: "attendance", reason: `Asistencia registrada para ${data.entries.length} personas`, actorUserId: access.userId })
    return results
  })
}

/**
 * Cierra la sesión y otorga competencias. Sólo genera competencia quien asistió
 * y aprobó la evaluación cuando el curso la exige: una asistencia sin
 * evaluación aprobada no habilita. El índice único sobre `sourceAttendanceId`
 * hace el otorgamiento idempotente ante un doble cierre.
 */
export async function closeTrainingSession(input: unknown, access: TrainingAccess) {
  const data = trainingSessionCloseSchema.parse(input)
  let accreditation: Parameters<typeof onTrainingSessionClosed>[0] | null = null
  const result = await db.transaction(async (tx) => {
    const [session] = await tx.select().from(preventionTrainingSessions)
      .where(eq(preventionTrainingSessions.id, data.sessionId)).limit(1)
    if (!session) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:training:deliver", session.worksiteId)
    if (session.status === "completed") throw new Error("La sesión ya fue cerrada.")
    if (session.status === "cancelled") throw new Error("Una sesión cancelada no puede cerrarse.")
    if (session.version !== data.expectedVersion) throw new Error("La sesión cambió mientras editabas. Recarga y reintenta.")

    const [version] = await tx.select().from(preventionTrainingCourseVersions)
      .where(eq(preventionTrainingCourseVersions.id, session.courseVersionId)).limit(1)
    if (!version) throw new Error(NOT_FOUND)
    const [course] = await tx.select().from(preventionTrainingCourses)
      .where(eq(preventionTrainingCourses.id, version.courseId)).limit(1)
    if (!course) throw new Error(NOT_FOUND)

    const durationMinutes = Math.round((new Date(data.endedAt).getTime() - new Date(data.startedAt).getTime()) / 60000)
    const findings = assessLegalFloor({
      kind: course.kind,
      minimumDurationMinutes: course.minimumDurationMinutes,
      validityMonths: course.validityMonths,
      deliveredDurationMinutes: durationMinutes,
    })
    if (findings.length > 0) throw new Error(findings.map((item) => item.message).join(" "))

    const attendance = await tx.select().from(preventionTrainingAttendance)
      .where(eq(preventionTrainingAttendance.sessionId, session.id))
    if (attendance.length === 0) throw new Error("No se puede cerrar una sesión sin convocados.")
    if (attendance.some((item) => item.status === "convened")) {
      throw new Error("Hay convocados sin resultado de asistencia. Registra asistencia o ausencia antes de cerrar.")
    }

    const now = nowIso()
    const granted = attendance.filter((item) => item.status === "attended" && (item.assessmentResult === "approved" || item.assessmentResult === "not_required"))
    const grantedAt = data.endedAt.slice(0, 10)
    const expiresAt = competencyExpiry(grantedAt, course.validityMonths)

    if (granted.length > 0) {
      // Las competencias nuevas reemplazan las anteriores del mismo curso/persona.
      await tx.update(preventionWorkerCompetencies)
        .set({ status: "superseded", updatedAt: now })
        .where(and(
          inArray(preventionWorkerCompetencies.workerId, granted.map((item) => item.workerId)),
          eq(preventionWorkerCompetencies.courseId, course.id),
          eq(preventionWorkerCompetencies.status, "valid"),
        ))
      await tx.insert(preventionWorkerCompetencies).values(granted.map((item) => ({
        id: `trcomp-${nanoid()}`,
        workerId: item.workerId,
        courseId: course.id,
        sourceType: "session",
        sourceSessionId: session.id,
        sourceAttendanceId: item.id,
        grantedAt,
        expiresAt,
        status: "valid",
        evidenceReference: item.evidenceReference,
        createdByUserId: access.userId,
      }))).onConflictDoNothing()
    }

    const [updated] = await tx.update(preventionTrainingSessions).set({
      status: "completed",
      startedAt: data.startedAt,
      endedAt: data.endedAt,
      durationMinutes,
      closedByUserId: access.userId,
      closedAt: now,
      version: session.version + 1,
      updatedAt: now,
    }).where(and(eq(preventionTrainingSessions.id, session.id), eq(preventionTrainingSessions.version, data.expectedVersion))).returning()
    if (!updated) throw new Error("La sesión cambió mientras editabas. Recarga y reintenta.")

    await history(tx, {
      entityType: "session",
      entityId: session.id,
      worksiteId: session.worksiteId,
      changeType: "completed",
      reason: `Sesión cerrada: ${granted.length} de ${attendance.length} obtuvieron competencia`,
      beforeState: session,
      afterState: updated,
      actorUserId: access.userId,
    })

    // Se prepara aquí y se dispara DESPUÉS del commit (ver abajo): así una
    // reversión de la transacción no deja una ejecución PDTP huérfana.
    const pdtpActivityNumbers = Array.isArray(course.pdtpActivityNumbers) ? course.pdtpActivityNumbers : []
    const target = await resolvePdtpAccreditationTarget({ sourceType: "capacitacion", sourceId: course.id, eventType: "close", legacyActivityNumbers: pdtpActivityNumbers }, tx)
    if (target.catalogActivityIds?.length || target.activityNumbers?.length) {
      accreditation = {
        sessionId: session.id,
        worksiteId: session.worksiteId,
        closedAt: updated.closedAt ?? now,
        attendedCount: granted.length,
        ...target,
      }
    }

    return { session: updated, grantedCount: granted.length, convenedCount: attendance.length }
  })

  // Auto-acreditación PDTP fuera de la transacción; safeAccredit absorbe errores
  // (programa inactivo, curso no vinculado) sin afectar el cierre ya confirmado.
  if (accreditation) await onTrainingSessionClosed(accreditation)

  return result
}

export async function cancelTrainingSession(input: unknown, access: TrainingAccess) {
  const data = trainingSessionCancelSchema.parse(input)
  const updated = await db.transaction(async (tx) => {
    const [session] = await tx.select().from(preventionTrainingSessions)
      .where(eq(preventionTrainingSessions.id, data.sessionId)).limit(1)
    if (!session) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:training:manage", session.worksiteId)
    if (session.status === "completed") throw new Error("Una sesión cerrada no puede cancelarse.")
    if (session.version !== data.expectedVersion) throw new Error("La sesión cambió mientras editabas. Recarga y reintenta.")

    const now = nowIso()
    const [updated] = await tx.update(preventionTrainingSessions).set({
      status: "cancelled",
      cancellationReason: data.reason,
      cancelledByUserId: access.userId,
      cancelledAt: now,
      version: session.version + 1,
      updatedAt: now,
    }).where(and(eq(preventionTrainingSessions.id, session.id), eq(preventionTrainingSessions.version, data.expectedVersion))).returning()
    if (!updated) throw new Error("La sesión cambió mientras editabas. Recarga y reintenta.")
    await history(tx, { entityType: "session", entityId: session.id, worksiteId: session.worksiteId, changeType: "cancelled", reason: data.reason, beforeState: session, afterState: updated, actorUserId: access.userId })

    return updated
  })

  // Revertir la auto-acreditación PDTP si existía, fuera de la transacción.
  await onTrainingSessionCancelled({
    sessionId: updated.id,
    worksiteId: updated.worksiteId,
    cancelledBy: access.userId,
  })

  return updated
}

/**
 * Acuse del propio trabajador. Firma sesión + contenido + persona + momento,
 * igual que el acuse documental: nadie acusa por otra persona.
 */
export async function acknowledgeTraining(input: unknown, access: TrainingAccess, context: { ip?: string | null; userAgent?: string | null }) {
  requireAccess(access, "prevention:training:ack")
  const data = trainingAcknowledgementSchema.parse(input)

  return db.transaction(async (tx) => {
    const [row] = await tx.select({
      attendance: preventionTrainingAttendance,
      session: preventionTrainingSessions,
      version: preventionTrainingCourseVersions,
      workerUserId: users.id,
    })
      .from(preventionTrainingAttendance)
      .innerJoin(preventionTrainingSessions, eq(preventionTrainingAttendance.sessionId, preventionTrainingSessions.id))
      .innerJoin(preventionTrainingCourseVersions, eq(preventionTrainingSessions.courseVersionId, preventionTrainingCourseVersions.id))
      .leftJoin(users, eq(users.workerId, preventionTrainingAttendance.workerId))
      .where(eq(preventionTrainingAttendance.id, data.attendanceId))
      .limit(1)
    if (!row) throw new Error(NOT_FOUND)
    if (row.workerUserId !== access.userId) throw new Error("Sólo la persona convocada puede acusar recibo de su capacitación.")
    if (row.attendance.acknowledgedAt) throw new Error("Esta capacitación ya fue acusada.")
    if (row.attendance.status !== "attended") throw new Error("Sólo puede acusarse una asistencia registrada.")

    const now = nowIso()
    const signature = sha256({
      attendanceId: row.attendance.id,
      sessionId: row.session.id,
      contentHash: row.version.contentHash,
      workerId: row.attendance.workerId,
      userId: access.userId,
      acknowledgedAt: now,
      method: data.method,
    })
    const [updated] = await tx.update(preventionTrainingAttendance).set({
      acknowledgementSha256: signature,
      acknowledgedAt: now,
      acknowledgementChannel: "account",
      acknowledgementMethod: data.method,
      acknowledgementIp: context.ip ?? null,
      acknowledgementUserAgent: context.userAgent ?? null,
      evidenceReference: data.evidenceReference ?? row.attendance.evidenceReference,
      updatedAt: now,
    }).where(and(eq(preventionTrainingAttendance.id, row.attendance.id), sql`${preventionTrainingAttendance.acknowledgedAt} IS NULL`)).returning()
    if (!updated) throw new Error("Esta capacitación ya fue acusada.")
    await history(tx, { entityType: "attendance", entityId: row.attendance.id, worksiteId: row.session.worksiteId, changeType: "acknowledged", reason: `Acuse por ${data.method}`, actorUserId: access.userId })
    return updated
  })
}

/**
 * `CAP-002` (auditoría 2026-09-14): acuse del trabajador **sin cuenta**.
 *
 * El acuse anterior exigía `row.workerUserId === access.userId`, es decir, que
 * la asistencia estuviera atada a un `users.id` y que esa persona tuviera
 * sesión abierta. La mayoría del personal de faena no es usuario de la
 * plataforma —el propio módulo PPA lo declara—, así que la constancia de haber
 * recibido la información sólo existía para una minoría.
 *
 * Aquí la autorización es la posesión del enlace: un token HMAC derivado del id
 * de la asistencia, el mismo patrón de enlace-capacidad de PPA y TAE. No hay
 * sesión, no hay permiso que comprobar y no se acusa por otra persona, porque
 * el token abre **una sola** asistencia. Lo demás no cambia: una sola vez,
 * sólo sobre una asistencia registrada, con IP, agente de usuario y firma.
 *
 * QUEDA POR DECIDIR (producto, no plataforma): por qué canal se hace llegar el
 * enlace al trabajador (impreso con QR, SMS, WhatsApp) y si un acuse por token
 * tiene el mismo valor probatorio que uno con cuenta. La plataforma no lo
 * declara en ninguna parte, así que aquí se registra el canal
 * (`acknowledgementChannel`) y no se pondera: quien audite decide.
 */
export async function acknowledgeTrainingByPublicToken(
  input: { attendanceId: string; token: string; method?: "platform_click" | "signed_document"; evidenceReference?: string | null },
  context: { ip?: string | null; userAgent?: string | null },
) {
  const attendanceId = String(input.attendanceId ?? "")
  if (!attendanceId || !verifyPreventionAckToken("capacitacion", attendanceId, input.token)) {
    throw new Error(NOT_FOUND)
  }
  const method = input.method ?? "platform_click"

  return db.transaction(async (tx) => {
    const [row] = await tx.select({
      attendance: preventionTrainingAttendance,
      session: preventionTrainingSessions,
      version: preventionTrainingCourseVersions,
    })
      .from(preventionTrainingAttendance)
      .innerJoin(preventionTrainingSessions, eq(preventionTrainingAttendance.sessionId, preventionTrainingSessions.id))
      .innerJoin(preventionTrainingCourseVersions, eq(preventionTrainingSessions.courseVersionId, preventionTrainingCourseVersions.id))
      .where(eq(preventionTrainingAttendance.id, attendanceId))
      .limit(1)
    if (!row) throw new Error(NOT_FOUND)
    if (row.attendance.acknowledgedAt) throw new Error("Esta capacitación ya fue acusada.")
    if (row.attendance.status !== "attended") throw new Error("Sólo puede acusarse una asistencia registrada.")

    const now = nowIso()
    // Misma firma que el acuse con cuenta, salvo que no hay `userId` que
    // firmar: quien acusa es el portador del enlace de esa asistencia.
    const signature = sha256({
      attendanceId: row.attendance.id,
      sessionId: row.session.id,
      contentHash: row.version.contentHash,
      workerId: row.attendance.workerId,
      userId: null,
      channel: "public_token",
      acknowledgedAt: now,
      method,
    })
    const [updated] = await tx.update(preventionTrainingAttendance).set({
      acknowledgementSha256: signature,
      acknowledgedAt: now,
      acknowledgementChannel: "public_token",
      acknowledgementMethod: method,
      acknowledgementIp: context.ip ?? null,
      acknowledgementUserAgent: context.userAgent ?? null,
      evidenceReference: input.evidenceReference ?? row.attendance.evidenceReference,
      updatedAt: now,
    }).where(and(eq(preventionTrainingAttendance.id, row.attendance.id), sql`${preventionTrainingAttendance.acknowledgedAt} IS NULL`)).returning()
    if (!updated) throw new Error("Esta capacitación ya fue acusada.")
    await history(tx, { entityType: "attendance", entityId: row.attendance.id, worksiteId: row.session.worksiteId, changeType: "acknowledged", reason: `Acuse sin cuenta (enlace) por ${method}`, actorUserId: null })
    return updated
  })
}

/* ── Competencias ─────────────────────────────────────────────────────────── */

export async function convalidateCompetency(input: unknown, access: TrainingAccess) {
  requireAccess(access, "prevention:training:convalidate")
  const data = competencyConvalidationSchema.parse(input)

  return db.transaction(async (tx) => {
    const [worker] = await tx.select().from(workers).where(eq(workers.id, data.workerId)).limit(1)
    if (!worker || !worker.isActive) throw new Error(NOT_FOUND)
    if (!scopeAllows(access.scope, worker.worksiteId)) throw new Error(NOT_FOUND)
    const [course] = await tx.select().from(preventionTrainingCourses).where(eq(preventionTrainingCourses.id, data.courseId)).limit(1)
    if (!course) throw new Error(NOT_FOUND)

    const now = nowIso()
    await tx.update(preventionWorkerCompetencies)
      .set({ status: "superseded", updatedAt: now })
      .where(and(
        eq(preventionWorkerCompetencies.workerId, data.workerId),
        eq(preventionWorkerCompetencies.courseId, data.courseId),
        eq(preventionWorkerCompetencies.status, "valid"),
      ))

    const [created] = await tx.insert(preventionWorkerCompetencies).values({
      id: `trcomp-${nanoid()}`,
      workerId: data.workerId,
      courseId: data.courseId,
      sourceType: data.sourceType,
      grantedAt: data.grantedAt,
      expiresAt: data.expiresAt ?? competencyExpiry(data.grantedAt, course.validityMonths),
      status: "valid",
      evidenceReference: data.evidenceReference,
      externalIssuer: data.externalIssuer ?? null,
      externalCertificateNumber: data.externalCertificateNumber ?? null,
      convalidationJustification: data.sourceType === "convalidation" ? data.justification : null,
      convalidationApprovedByUserId: data.sourceType === "convalidation" ? access.userId : null,
      convalidationApprovedAt: data.sourceType === "convalidation" ? now : null,
      createdByUserId: access.userId,
    }).returning()
    if (!created) throw new Error("No se pudo registrar la competencia.")
    await history(tx, { entityType: "competency", entityId: created.id, worksiteId: worker.worksiteId, changeType: data.sourceType, reason: data.justification, afterState: created, actorUserId: access.userId })
    return created
  })
}

export async function revokeCompetency(input: unknown, access: TrainingAccess) {
  requireAccess(access, "prevention:training:revoke")
  const data = competencyRevocationSchema.parse(input)

  return db.transaction(async (tx) => {
    const [row] = await tx.select({ competency: preventionWorkerCompetencies, worksiteId: workers.worksiteId })
      .from(preventionWorkerCompetencies)
      .innerJoin(workers, eq(preventionWorkerCompetencies.workerId, workers.id))
      .where(eq(preventionWorkerCompetencies.id, data.competencyId)).limit(1)
    if (!row) throw new Error(NOT_FOUND)
    if (!scopeAllows(access.scope, row.worksiteId)) throw new Error(NOT_FOUND)
    if (row.competency.status === "revoked") throw new Error("La competencia ya está revocada.")

    const now = nowIso()
    // El estado va también en el WHERE (ver el `!updated` de más abajo): la
    // guarda en memoria no impide que dos revocaciones concurrentes pisen
    // `revokedByUserId`/`revokedAt`, que es la autoría del retiro de una
    // habilitación.
    const [updated] = await tx.update(preventionWorkerCompetencies).set({
      status: "revoked",
      revokedByUserId: access.userId,
      revokedAt: now,
      revocationReason: data.reason,
      updatedAt: now,
    }).where(and(
      eq(preventionWorkerCompetencies.id, data.competencyId),
      ne(preventionWorkerCompetencies.status, "revoked"),
    )).returning()
    if (!updated) throw new Error("La competencia ya está revocada.")
    await history(tx, { entityType: "competency", entityId: data.competencyId, worksiteId: row.worksiteId, changeType: "revoked", reason: data.reason, beforeState: row.competency, afterState: updated, actorUserId: access.userId })
    return updated
  })
}

export async function createCompetencyRequirement(input: unknown, access: TrainingAccess) {
  const data = competencyRequirementSchema.parse(input)
  requireAccess(access, "prevention:training:manage", data.worksiteId ?? undefined)

  const [created] = await db.insert(preventionCompetencyRequirements).values({
    id: `trreq-${nanoid()}`,
    courseId: data.courseId,
    scopeType: data.scopeType,
    scopeValue: data.scopeValue ?? null,
    worksiteId: data.worksiteId ?? null,
    enforcement: data.enforcement,
    reason: data.reason,
    legalRequirementId: data.legalRequirementId ?? null,
    riskEntryId: data.riskEntryId ?? null,
    createdByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo crear el requisito de competencia.")
  await history(db, { entityType: "requirement", entityId: created.id, worksiteId: data.worksiteId ?? null, changeType: "created", reason: data.reason, afterState: created, actorUserId: access.userId })
  return created
}

/* ── Brechas y consultas ──────────────────────────────────────────────────── */

export async function listCompetencyGaps(access: TrainingAccess): Promise<CompetencyGap[]> {
  requireAccess(access, "prevention:training:view")
  return computeCompetencyGapsForScope(access.scope)
}

/**
 * Convierte una brecha bloqueante en CAPA trazable. Es idempotente por
 * trabajador+curso: no abre una segunda acción mientras la primera siga viva.
 */
export async function escalateBlockingGapsToCapa(access: TrainingAccess, args: { targetDate: string; responsibleUserId?: string | null }) {
  requireAccess(access, "prevention:training:manage")
  const gaps = (await listCompetencyGaps(access)).filter((gap) => gap.enforcement === "blocking")
  if (gaps.length === 0) return { created: 0, skipped: 0 }

  const sourceIds = gaps.map((gap) => `${gap.workerId}:${gap.courseId}`)

  let created = 0
  let skipped = 0
  await db.transaction(async (tx) => {
    // La lectura de "ya abiertas" va DENTRO de la transacción: leída fuera, dos
    // escalamientos concurrentes (o un doble clic) veían ambos el conjunto vacío
    // y creaban dos CAPA para la misma brecha. No hay unique que lo impida
    // porque estas acciones no llevan `sourceItemId`.
    const openActions = await tx.select({ sourceId: preventionCapaActions.sourceId })
      .from(preventionCapaActions)
      .where(and(
        eq(preventionCapaActions.sourceType, "training"),
        inArray(preventionCapaActions.sourceId, sourceIds),
        notInArray(preventionCapaActions.status, ["closed", "cancelled"]),
      ))
    const alreadyOpen = new Set(openActions.map((item) => item.sourceId))

    for (const gap of gaps) {
      const sourceId = `${gap.workerId}:${gap.courseId}`
      if (alreadyOpen.has(sourceId)) { skipped += 1; continue }

      await createCapaActionWithClient(tx, {
        sourceType: "training",
        sourceId,
        worksiteId: gap.worksiteId,
        finding: `${gap.workerName} no tiene vigente la competencia obligatoria "${gap.courseName}" (${gap.gapType === "expired" ? "vencida" : gap.gapType === "revoked" ? "revocada" : "nunca obtenida"}).`,
        actionDescription: `Programar y ejecutar "${gap.courseName}" para ${gap.workerName} antes de asignarle tareas que la exijan.`,
        rootCause: gap.reason,
        responsibleUserId: args.responsibleUserId ?? null,
        priority: "high",
        targetDate: args.targetDate,
        evidenceRequired: true,
      }, access.userId)
      created += 1
    }
  })
  return { created, skipped }
}

/** Marca vencidas las competencias cuya fecha ya pasó. Idempotente. */
export async function expireLapsedCompetencies() {
  const today = todayInChile()
  const updated = await db.update(preventionWorkerCompetencies)
    .set({ status: "expired", updatedAt: nowIso() })
    .where(and(
      eq(preventionWorkerCompetencies.status, "valid"),
      sql`${preventionWorkerCompetencies.expiresAt} IS NOT NULL AND ${preventionWorkerCompetencies.expiresAt} < ${today}`,
    ))
    .returning({ id: preventionWorkerCompetencies.id })
  return { expired: updated.length }
}

export async function listTrainingCourses(access: TrainingAccess) {
  requireAccess(access, "prevention:training:view")
  return db.select({
    course: preventionTrainingCourses,
    publishedVersionId: preventionTrainingCourseVersions.id,
    publishedVersionLabel: preventionTrainingCourseVersions.versionLabel,
    publishedDurationMinutes: preventionTrainingCourseVersions.durationMinutes,
  })
    .from(preventionTrainingCourses)
    .leftJoin(preventionTrainingCourseVersions, and(
      eq(preventionTrainingCourseVersions.courseId, preventionTrainingCourses.id),
      eq(preventionTrainingCourseVersions.status, "published"),
    ))
    .orderBy(asc(preventionTrainingCourses.name))
}

export async function listTrainingSessions(access: TrainingAccess) {
  requireAccess(access, "prevention:training:view")
  return db.select({
    session: preventionTrainingSessions,
    courseName: preventionTrainingCourses.name,
    courseKind: preventionTrainingCourses.kind,
    versionLabel: preventionTrainingCourseVersions.versionLabel,
    worksiteName: worksites.name,
    convenedCount: sql<number>`(SELECT COUNT(*)::int FROM prevention_training_attendance a WHERE a.session_id = ${preventionTrainingSessions.id})`,
    attendedCount: sql<number>`(SELECT COUNT(*)::int FROM prevention_training_attendance a WHERE a.session_id = ${preventionTrainingSessions.id} AND a.status = 'attended')`,
    acknowledgedCount: sql<number>`(SELECT COUNT(*)::int FROM prevention_training_attendance a WHERE a.session_id = ${preventionTrainingSessions.id} AND a.acknowledged_at IS NOT NULL)`,
  })
    .from(preventionTrainingSessions)
    .innerJoin(preventionTrainingCourseVersions, eq(preventionTrainingSessions.courseVersionId, preventionTrainingCourseVersions.id))
    .innerJoin(preventionTrainingCourses, eq(preventionTrainingCourseVersions.courseId, preventionTrainingCourses.id))
    .innerJoin(worksites, eq(preventionTrainingSessions.worksiteId, worksites.id))
    .where(scopeCondition(access.scope, preventionTrainingSessions.worksiteId))
    .orderBy(desc(preventionTrainingSessions.scheduledAt))
    .limit(500)
}

export async function getTrainingSessionDetail(sessionId: string, access: TrainingAccess) {
  requireAccess(access, "prevention:training:view")
  const [session] = await db.select({
    session: preventionTrainingSessions,
    courseId: preventionTrainingCourses.id,
    courseName: preventionTrainingCourses.name,
    courseKind: preventionTrainingCourses.kind,
    minimumDurationMinutes: preventionTrainingCourses.minimumDurationMinutes,
    validityMonths: preventionTrainingCourses.validityMonths,
    versionLabel: preventionTrainingCourseVersions.versionLabel,
    contentOutline: preventionTrainingCourseVersions.contentOutline,
    assessmentType: preventionTrainingCourseVersions.assessmentType,
    passingScore: preventionTrainingCourseVersions.passingScore,
    worksiteName: worksites.name,
  })
    .from(preventionTrainingSessions)
    .innerJoin(preventionTrainingCourseVersions, eq(preventionTrainingSessions.courseVersionId, preventionTrainingCourseVersions.id))
    .innerJoin(preventionTrainingCourses, eq(preventionTrainingCourseVersions.courseId, preventionTrainingCourses.id))
    .innerJoin(worksites, eq(preventionTrainingSessions.worksiteId, worksites.id))
    .where(eq(preventionTrainingSessions.id, sessionId))
    .limit(1)
  if (!session || !scopeAllows(access.scope, session.session.worksiteId)) return null

  const attendance = await db.select({
    attendance: preventionTrainingAttendance,
    workerFirstName: workers.firstName,
    workerLastName: workers.lastName,
    workerPosition: workers.position,
  })
    .from(preventionTrainingAttendance)
    .innerJoin(workers, eq(preventionTrainingAttendance.workerId, workers.id))
    .where(eq(preventionTrainingAttendance.sessionId, sessionId))
    .orderBy(asc(workers.lastName))

  return { ...session, attendance }
}

export async function listWorkerCompetencies(access: TrainingAccess, filters?: { workerId?: string }) {
  requireAccess(access, "prevention:training:view")
  const conditions = [scopeCondition(access.scope, workers.worksiteId)]
  if (filters?.workerId) conditions.push(eq(preventionWorkerCompetencies.workerId, filters.workerId))

  return db.select({
    competency: preventionWorkerCompetencies,
    workerFirstName: workers.firstName,
    workerLastName: workers.lastName,
    workerPosition: workers.position,
    worksiteId: workers.worksiteId,
    worksiteName: worksites.name,
    courseName: preventionTrainingCourses.name,
    courseKind: preventionTrainingCourses.kind,
  })
    .from(preventionWorkerCompetencies)
    .innerJoin(workers, eq(preventionWorkerCompetencies.workerId, workers.id))
    .innerJoin(worksites, eq(workers.worksiteId, worksites.id))
    .innerJoin(preventionTrainingCourses, eq(preventionWorkerCompetencies.courseId, preventionTrainingCourses.id))
    .where(and(...conditions))
    .orderBy(asc(workers.lastName), asc(preventionTrainingCourses.name))
    .limit(2000)
}

export async function listCompetencyRequirements(access: TrainingAccess) {
  requireAccess(access, "prevention:training:view")
  return db.select({
    requirement: preventionCompetencyRequirements,
    courseName: preventionTrainingCourses.name,
    courseCode: preventionTrainingCourses.code,
    worksiteName: worksites.name,
  })
    .from(preventionCompetencyRequirements)
    .innerJoin(preventionTrainingCourses, eq(preventionCompetencyRequirements.courseId, preventionTrainingCourses.id))
    .leftJoin(worksites, eq(preventionCompetencyRequirements.worksiteId, worksites.id))
    .orderBy(asc(preventionTrainingCourses.name))
}

/** Faenas visibles para el alcance, para poblar selectores del catálogo. */
export async function listTrainingWorksites(access: TrainingAccess) {
  requireAccess(access, "prevention:training:view")
  if (access.scope.mode === "none") return []
  return db.select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(and(
      eq(worksites.isActive, true),
      access.scope.mode === "some" ? inArray(worksites.id, access.scope.ids) : undefined,
    ))
    .orderBy(asc(worksites.name))
}

/**
 * Dotación activa dentro del alcance, para convocar a una sesión.
 *
 * Devuelve `worksiteId` porque el servicio rechaza convocar a alguien de otra
 * faena: el formulario filtra por la faena elegida y así el error no aparece
 * recién al enviar.
 */
export async function listTrainingWorkers(access: TrainingAccess) {
  requireAccess(access, "prevention:training:view")
  if (access.scope.mode === "none") return []
  return db.select({
    id: workers.id,
    firstName: workers.firstName,
    lastName: workers.lastName,
    position: workers.position,
    worksiteId: workers.worksiteId,
  })
    .from(workers)
    .where(and(
      eq(workers.isActive, true),
      access.scope.mode === "some" ? inArray(workers.worksiteId, access.scope.ids) : undefined,
    ))
    .orderBy(asc(workers.lastName), asc(workers.firstName))
    .limit(2000)
}

/** Todas las versiones de todos los cursos, para la vista de catálogo. */
export async function listAllCourseVersions(access: TrainingAccess) {
  requireAccess(access, "prevention:training:view")
  return db.select({
    version: preventionTrainingCourseVersions,
    courseName: preventionTrainingCourses.name,
    courseCode: preventionTrainingCourses.code,
    courseKind: preventionTrainingCourses.kind,
  })
    .from(preventionTrainingCourseVersions)
    .innerJoin(preventionTrainingCourses, eq(preventionTrainingCourseVersions.courseId, preventionTrainingCourses.id))
    .orderBy(asc(preventionTrainingCourses.name), desc(preventionTrainingCourseVersions.createdAt))
}

export async function listCourseVersions(courseId: string, access: TrainingAccess) {
  requireAccess(access, "prevention:training:view")
  return db.select().from(preventionTrainingCourseVersions)
    .where(eq(preventionTrainingCourseVersions.courseId, courseId))
    .orderBy(desc(preventionTrainingCourseVersions.createdAt))
}

/** Capacitaciones pendientes de acuse de la persona autenticada. */
export async function listMyPendingAcknowledgements(access: TrainingAccess) {
  const [me] = await db.select({ workerId: users.workerId }).from(users).where(eq(users.id, access.userId)).limit(1)
  if (!me?.workerId) return []
  return db.select({
    attendanceId: preventionTrainingAttendance.id,
    sessionCode: preventionTrainingSessions.code,
    courseName: preventionTrainingCourses.name,
    courseKind: preventionTrainingCourses.kind,
    endedAt: preventionTrainingSessions.endedAt,
  })
    .from(preventionTrainingAttendance)
    .innerJoin(preventionTrainingSessions, eq(preventionTrainingAttendance.sessionId, preventionTrainingSessions.id))
    .innerJoin(preventionTrainingCourseVersions, eq(preventionTrainingSessions.courseVersionId, preventionTrainingCourseVersions.id))
    .innerJoin(preventionTrainingCourses, eq(preventionTrainingCourseVersions.courseId, preventionTrainingCourses.id))
    .where(and(
      eq(preventionTrainingAttendance.workerId, me.workerId),
      eq(preventionTrainingAttendance.status, "attended"),
      sql`${preventionTrainingAttendance.acknowledgedAt} IS NULL`,
    ))
    .orderBy(desc(preventionTrainingSessions.endedAt))
}

/**
 * Pedirle a quien sí puede que apruebe o publique una versión de curso.
 *
 * Espeja `remindTemplateApproval` de Inspecciones. La necesidad es la misma y
 * más aguda acá: `prevencionista_faena` tiene `training:manage` pero **no**
 * `training:approve`, así que puede crear la versión que habilita una actividad
 * del programa y no puede habilitarla él mismo. Sin esto, el informe de
 * cobertura le decía que faltaba publicar el curso y no le daba ninguna forma
 * de conseguirlo.
 *
 * El `dedupeKey` lleva la fecha: como máximo un recordatorio por día y por
 * versión. Sin la fecha el recordatorio sería un no-op permanente después del
 * primero.
 */
export async function remindTrainingCourseVersionApproval(input: unknown, access: TrainingAccess) {
  const data = z.object({ versionId: z.string().min(1) }).parse(input)
  requireAccess(access, "prevention:training:manage")

  const [version] = await db.select({
    id: preventionTrainingCourseVersions.id,
    status: preventionTrainingCourseVersions.status,
    versionLabel: preventionTrainingCourseVersions.versionLabel,
    courseName: preventionTrainingCourses.name,
    courseCode: preventionTrainingCourses.code,
  }).from(preventionTrainingCourseVersions)
    .innerJoin(preventionTrainingCourses, eq(preventionTrainingCourses.id, preventionTrainingCourseVersions.courseId))
    .where(eq(preventionTrainingCourseVersions.id, data.versionId))
    .limit(1)
  if (!version) throw new Error("Versión de curso no encontrada.")
  // `published` ya no espera a nadie; `superseded` tampoco.
  if (!["draft", "in_review", "observed", "approved"].includes(version.status)) {
    throw new Error("Esta versión no está esperando aprobación.")
  }

  const approverIds = await getUserIdsWithPermission("prevention:training:approve")
  const approvers = approverIds.length === 0 ? [] : await db.select({ id: users.id, name: users.name }).from(users)
    .where(and(inArray(users.id, approverIds), eq(users.isActive, true)))
  if (approvers.length === 0) throw new Error("Nadie tiene permiso de aprobación. Avisa a un administrador.")

  await createNotifications(approvers.map((approver) => approver.id), {
    type: "system_alert",
    title: "Solicitud de publicación de curso",
    body: `${version.courseName} (${version.courseCode}, ${version.versionLabel}) espera aprobación para habilitarse.`,
    entityType: "training_course_version",
    entityId: version.id,
    entityHref: `/prevencion/capacitacion/catalogo?tab=versions&q=${encodeURIComponent(version.courseCode)}`,
    dedupeKey: `training:version-approval:${version.id}:${todayInChile()}`,
  })
  return { notified: approvers.map((approver) => approver.name) }
}
