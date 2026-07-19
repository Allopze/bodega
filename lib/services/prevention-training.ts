import { createHash } from "node:crypto"
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm"
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
  computeCompetencyGaps,
  type CompetencyGap,
} from "@/lib/prevention/training"
import { createCapaActionWithClient } from "@/lib/services/prevention-capa"
import {
  competencyConvalidationSchema,
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

const CHILE_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" })

function todayInChile() {
  return CHILE_DATE_FORMAT.format(new Date())
}

function nowIso() {
  return new Date().toISOString()
}

function sha256(value: unknown) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex")
}

function sessionCode() {
  return `CAP-${new Date().getUTCFullYear()}-${nanoid(10).toUpperCase()}`
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

  const [created] = await db.insert(preventionTrainingCourses).values({
    id: `trcourse-${nanoid()}`,
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
    createdByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo crear el curso.")
  await history(db, { entityType: "course", entityId: created.id, changeType: "created", reason: "Curso registrado en el catálogo", afterState: created, actorUserId: access.userId })
  return created
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
    if ((data.toStatus === "approved" || data.toStatus === "published") && current.authorUserId === access.userId) {
      throw new Error("El autor del contenido no puede aprobar ni publicar su propia versión.")
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
    await history(tx, { entityType: "course_version", entityId: current.id, changeType: data.toStatus, reason: data.reason, beforeState: current, afterState: updated, actorUserId: access.userId })
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
  return db.transaction(async (tx) => {
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

    for (const item of granted) {
      // Una competencia nueva reemplaza la anterior del mismo curso/persona.
      await tx.update(preventionWorkerCompetencies)
        .set({ status: "superseded", updatedAt: now })
        .where(and(
          eq(preventionWorkerCompetencies.workerId, item.workerId),
          eq(preventionWorkerCompetencies.courseId, course.id),
          eq(preventionWorkerCompetencies.status, "valid"),
        ))
      await tx.insert(preventionWorkerCompetencies).values({
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
      }).onConflictDoNothing()
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
    return { session: updated, grantedCount: granted.length, convenedCount: attendance.length }
  })
}

export async function cancelTrainingSession(input: unknown, access: TrainingAccess) {
  const data = trainingSessionCancelSchema.parse(input)
  return db.transaction(async (tx) => {
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
    const [updated] = await tx.update(preventionWorkerCompetencies).set({
      status: "revoked",
      revokedByUserId: access.userId,
      revokedAt: now,
      revocationReason: data.reason,
      updatedAt: now,
    }).where(eq(preventionWorkerCompetencies.id, data.competencyId)).returning()
    if (!updated) throw new Error("No se pudo revocar la competencia.")
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
  const workerScope = scopeCondition(access.scope, workers.worksiteId)

  const [workerRows, requirementRows, competencyRows] = await Promise.all([
    db.select({ id: workers.id, firstName: workers.firstName, lastName: workers.lastName, position: workers.position, worksiteId: workers.worksiteId, isActive: workers.isActive })
      .from(workers).where(and(eq(workers.isActive, true), workerScope)),
    db.select({
      id: preventionCompetencyRequirements.id,
      courseId: preventionCompetencyRequirements.courseId,
      courseName: preventionTrainingCourses.name,
      scopeType: preventionCompetencyRequirements.scopeType,
      scopeValue: preventionCompetencyRequirements.scopeValue,
      worksiteId: preventionCompetencyRequirements.worksiteId,
      enforcement: preventionCompetencyRequirements.enforcement,
      reason: preventionCompetencyRequirements.reason,
      isActive: preventionCompetencyRequirements.isActive,
    }).from(preventionCompetencyRequirements)
      .innerJoin(preventionTrainingCourses, eq(preventionCompetencyRequirements.courseId, preventionTrainingCourses.id))
      .where(and(eq(preventionCompetencyRequirements.isActive, true), eq(preventionTrainingCourses.isActive, true))),
    db.select({ workerId: preventionWorkerCompetencies.workerId, courseId: preventionWorkerCompetencies.courseId, status: preventionWorkerCompetencies.status, expiresAt: preventionWorkerCompetencies.expiresAt })
      .from(preventionWorkerCompetencies)
      .innerJoin(workers, eq(preventionWorkerCompetencies.workerId, workers.id))
      .where(workerScope),
  ])

  return computeCompetencyGaps({
    workers: workerRows,
    requirements: requirementRows,
    competencies: competencyRows,
    asOf: todayInChile(),
  })
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
  const openActions = await db.select({ sourceId: preventionCapaActions.sourceId })
    .from(preventionCapaActions)
    .where(and(
      eq(preventionCapaActions.sourceType, "training"),
      inArray(preventionCapaActions.sourceId, sourceIds),
      notInArray(preventionCapaActions.status, ["closed", "cancelled"]),
    ))
  const alreadyOpen = new Set(openActions.map((item) => item.sourceId))

  let created = 0
  let skipped = 0
  for (const gap of gaps) {
    const sourceId = `${gap.workerId}:${gap.courseId}`
    if (alreadyOpen.has(sourceId)) { skipped += 1; continue }

    await db.transaction(async (tx) => {
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
    })
    created += 1
  }
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

/** Todas las versiones de todos los cursos, para la vista de catálogo. */
export async function listAllCourseVersions(access: TrainingAccess) {
  requireAccess(access, "prevention:training:view")
  return db.select({
    version: preventionTrainingCourseVersions,
    courseName: preventionTrainingCourses.name,
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
