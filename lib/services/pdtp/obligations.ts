import { existsSync } from "node:fs"
import { and, asc, eq, inArray, isNotNull, lte, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpActivities,
  pdtpExecutions,
  pdtpObligationReminders,
  pdtpObligations,
  pdtpPrograms,
  worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordOperationalActivity } from "@/lib/services/operational-activity"
import { resolvePdtpEvidenceFile } from "@/lib/storage/config"
import { addPdtpChangeLogEntry, assertWorksiteAccess, isActivePdtpWorksite, type WorksiteScope } from "./helpers"
import { assertPdtpWorksiteCanOperateProgram } from "./worksites"

export type PdtpObligationOrigin = "manual" | "integration"
export type PdtpObligationStatus = "pending" | "overdue" | "reported" | "completed" | "cancelled"
export type PdtpReminderWindow = "due_7d" | "due_1d" | "overdue"

function validIso(value: string | undefined, fallback: Date) {
  if (!value) return fallback
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error("La fecha de origen no es válida.")
  return parsed
}

function dueDate(occurredAt: Date, days: number | null) {
  if (days === null) return null
  const result = new Date(occurredAt)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString()
}

const CHILE_MONTH_DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Santiago", month: "numeric", day: "numeric",
})

function periodSlot(at: Date) {
  const parts = Object.fromEntries(CHILE_MONTH_DAY_FORMAT.formatToParts(at).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]))
  return { month: parts.month!, week: Math.min(4, Math.ceil(parts.day! / 7)) }
}

function effectiveStatus(status: string, dueAt: string | null, now: Date): PdtpObligationStatus {
  if (status === "pending" && dueAt && new Date(dueAt).getTime() < now.getTime()) return "overdue"
  return status as PdtpObligationStatus
}

export async function createPdtpObligation(input: {
  activityId: string
  worksiteId: string
  origin: PdtpObligationOrigin
  sourceType?: string
  sourceId?: string
  sourceOccurredAt?: string
  plannedQuantity?: number
  manualReason?: string
  clientRequestId?: string
  sourceMetadata?: Record<string, unknown>
  userId: string
  scope: WorksiteScope
}) {
  assertWorksiteAccess(input.worksiteId, input.scope)
  if (!await isActivePdtpWorksite(input.worksiteId)) throw new Error("La faena no existe o está inactiva.")
  const [activity] = await db.select().from(pdtpActivities).where(eq(pdtpActivities.id, input.activityId)).limit(1)
  if (!activity) throw new Error("Actividad PDTP no encontrada.")
  if (activity.scheduleClassificationStatus !== "confirmed") throw new Error("Confirma la modalidad de la actividad antes de crear obligaciones.")
  if (activity.scheduleMode !== "on_demand" && activity.scheduleMode !== "triggered") {
    throw new Error("Las obligaciones sólo corresponden a actividades a demanda o disparadas.")
  }
  if (activity.dueDays === null) throw new Error("La actividad debe tener un plazo objetivo configurado.")
  if (!activity.evidenceRequirement?.trim()) throw new Error("La actividad debe definir su evidencia mínima antes de crear obligaciones.")
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, activity.programId)).limit(1)
  if (!program || program.status !== "active") throw new Error("Las obligaciones sólo se crean en programas activos.")
  // Si el programa declara membresía de faenas, una faena fuera de ella no
  // puede generar obligaciones — el alcance del programa nunca se amplía
  // por omisión (ver lib/services/pdtp/worksites.ts).
  await assertPdtpWorksiteCanOperateProgram(activity.programId, input.worksiteId)
  const plannedQuantity = input.plannedQuantity ?? 1
  if (!Number.isFinite(plannedQuantity) || plannedQuantity <= 0) throw new Error("La cantidad planificada debe ser mayor que cero.")

  const sourceType = input.sourceType?.trim() || null
  const sourceId = input.sourceId?.trim() || null
  const manualReason = input.manualReason?.trim() || null
  let idempotencyKey: string
  if (activity.scheduleMode === "triggered" && (!sourceType || !sourceId)) {
    throw new Error("Una actividad disparada exige tipo e identificador de la fuente operacional.")
  }
  if (input.origin === "integration") {
    if (!sourceType || !sourceId) throw new Error("Una obligación integrada exige tipo e identificador de fuente.")
    if (!input.sourceOccurredAt) throw new Error("Una obligación integrada exige la fecha y hora del evento de origen.")
    idempotencyKey = `pdtp-obligation:${activity.id}:${input.worksiteId}:${sourceType}:${sourceId}`
  } else {
    if ((manualReason?.length ?? 0) < 10) throw new Error("La creación manual exige un motivo de al menos 10 caracteres.")
    const requestId = input.clientRequestId?.trim()
    if (!requestId || requestId.length < 8) throw new Error("La creación manual exige un identificador de solicitud estable.")
    idempotencyKey = `pdtp-obligation:${activity.id}:${input.worksiteId}:manual:${requestId}`
  }

  const [existing] = await db.select().from(pdtpObligations).where(eq(pdtpObligations.idempotencyKey, idempotencyKey)).limit(1)
  if (existing) {
    if (existing.activityId !== activity.id || existing.worksiteId !== input.worksiteId) throw new Error("La clave idempotente ya pertenece a otra obligación.")
    return { obligation: existing, created: false }
  }

  const occurredAt = validIso(input.sourceOccurredAt, new Date())
  const now = new Date().toISOString()
  const [created] = await db.insert(pdtpObligations).values({
    id: `pdtp-obligation-${nanoid()}`,
    programId: program.id,
    activityId: activity.id,
    worksiteId: input.worksiteId,
    mode: activity.scheduleMode,
    status: "pending",
    triggerType: activity.triggerType,
    sourceType,
    sourceId,
    sourceOccurredAt: occurredAt.toISOString(),
    dueAt: dueDate(occurredAt, activity.dueDays),
    plannedQuantity,
    completedQuantity: 0,
    idempotencyKey,
    origin: input.origin,
    manualReason,
    sourceMetadataJson: input.sourceMetadata ?? {},
    createdByUserId: input.userId,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing({ target: pdtpObligations.idempotencyKey }).returning()
  if (created) {
    await addPdtpChangeLogEntry(
      program.id, program.version, input.userId, `obligation:${created.id}`, null,
      { obligationId: created.id, mode: created.mode, worksiteId: created.worksiteId, sourceType: created.sourceType, sourceId: created.sourceId, dueAt: created.dueAt },
      "Obligación preventiva generada desde una necesidad o evento real.",
    )
    return { obligation: created, created: true }
  }
  const [concurrent] = await db.select().from(pdtpObligations).where(eq(pdtpObligations.idempotencyKey, idempotencyKey)).limit(1)
  if (!concurrent) throw new Error("No se pudo crear ni recuperar la obligación.")
  return { obligation: concurrent, created: false }
}

export async function refreshPdtpObligationStatuses(now = new Date()) {
  const updated = await db.update(pdtpObligations).set({ status: "overdue", updatedAt: now.toISOString() }).where(and(
    eq(pdtpObligations.status, "pending"),
    lte(pdtpObligations.dueAt, now.toISOString()),
  )).returning({ id: pdtpObligations.id })
  return { markedOverdue: updated.length }
}

export async function reportPdtpObligation(input: {
  obligationId: string
  executedQuantity: number
  evidenceText?: string
  evidenceUrl?: string
  evidencePhotos?: string[]
  reportedAt?: string
  userId: string
  scope: WorksiteScope
}) {
  if (!Number.isFinite(input.executedQuantity) || input.executedQuantity <= 0) throw new Error("La cantidad ejecutada debe ser mayor que cero.")
  const reportedAt = validIso(input.reportedAt, new Date())
  const photos = (input.evidencePhotos ?? []).filter(Boolean)
  const evidenceUrl = input.evidenceUrl?.trim() || null
  if (evidenceUrl) {
    const absolutePath = resolvePdtpEvidenceFile(evidenceUrl)
    if (!absolutePath || !existsSync(absolutePath)) throw new Error("La evidencia adjunta no existe en el almacenamiento autorizado.")
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${pdtpObligations} WHERE id = ${input.obligationId} FOR UPDATE`)
    const [obligation] = await tx.select().from(pdtpObligations).where(eq(pdtpObligations.id, input.obligationId)).limit(1)
    if (!obligation) throw new Error("Obligación PDTP no encontrada.")
    assertWorksiteAccess(obligation.worksiteId, input.scope)
    if (obligation.status === "cancelled") throw new Error("La obligación está cancelada.")
    const [existing] = await tx.select().from(pdtpExecutions).where(eq(pdtpExecutions.obligationId, obligation.id)).limit(1)
    if (obligation.status === "completed" || (obligation.status === "reported" && existing?.status !== "rejected")) {
      if (!existing) throw new Error("La obligación figura reportada sin ejecución asociada.")
      return { obligation, execution: existing, created: false }
    }
    const [[program], [activity]] = await Promise.all([
      tx.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, obligation.programId)).limit(1),
      tx.select().from(pdtpActivities).where(eq(pdtpActivities.id, obligation.activityId)).limit(1),
    ])
    if (!program || program.status !== "active") throw new Error("El programa ya no está activo.")
    if (!activity) throw new Error("La actividad de la obligación ya no existe.")
    const hasEvidence = Boolean(input.evidenceText?.trim()) || Boolean(evidenceUrl) || photos.length > 0
    if (activity.evidenceRequirement?.trim() && !hasEvidence) {
      throw new Error(`Adjunta o describe la evidencia requerida: ${activity.evidenceRequirement}`)
    }
    const slot = periodSlot(reportedAt)
    const now = new Date().toISOString()
    const [execution] = await tx.insert(pdtpExecutions).values({
      id: existing?.id ?? `pdtp-obligation-execution-${nanoid()}`,
      activityId: obligation.activityId,
      worksiteId: obligation.worksiteId,
      year: program.year,
      month: slot.month,
      week: slot.week,
      executedQuantity: input.executedQuantity,
      status: "submitted",
      evidenceText: input.evidenceText?.trim() || null,
      evidenceUrl,
      evidencePhotos: photos,
      executedByUserId: input.userId,
      executedAt: reportedAt.toISOString(),
      origin: obligation.origin,
      sourceType: obligation.sourceType,
      sourceId: obligation.sourceId,
      idempotencyKey: `pdtp-obligation-execution:${obligation.id}`,
      sourceMetadataJson: { obligationId: obligation.id, ...((obligation.sourceMetadataJson ?? {}) as Record<string, unknown>) },
      evidenceStatus: hasEvidence ? "provided" : "not_required",
      obligationId: obligation.id,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: pdtpExecutions.obligationId,
      set: {
        executedQuantity: input.executedQuantity,
        status: "submitted",
        evidenceText: input.evidenceText?.trim() || null,
        evidenceUrl,
        evidencePhotos: photos,
        executedByUserId: input.userId,
        executedAt: reportedAt.toISOString(),
        evidenceStatus: hasEvidence ? "provided" : "not_required",
        rejectedByUserId: null,
        rejectedAt: null,
        rejectionReason: null,
        updatedAt: now,
      },
      setWhere: ne(pdtpExecutions.status, "approved"),
    }).returning()
    if (!execution) {
      const [concurrent] = await tx.select().from(pdtpExecutions).where(eq(pdtpExecutions.obligationId, obligation.id)).limit(1)
      if (!concurrent) throw new Error("No se pudo crear ni recuperar la ejecución de la obligación.")
      return { obligation, execution: concurrent, created: false }
    }
    const [updated] = await tx.update(pdtpObligations).set({
      status: "reported",
      completedQuantity: input.executedQuantity,
      reportedAt: reportedAt.toISOString(),
      updatedAt: now,
    }).where(and(
      eq(pdtpObligations.id, obligation.id),
      inArray(pdtpObligations.status, ["pending", "overdue", "reported"]),
    )).returning()
    if (!updated) throw new Error("La obligación cambió de estado antes de poder reportarse.")
    await addPdtpChangeLogEntry(
      program.id, program.version, input.userId, `obligation:${obligation.id}`,
      { status: obligation.status }, { status: "reported", executionId: execution.id, completedQuantity: input.executedQuantity },
      "Trabajo reportado; queda pendiente la aprobación formal de su ejecución.", tx,
    )
    await recordOperationalActivity({
      eventType: "pdtp.obligation_reported",
      module: "pdtp",
      entityType: "pdtp_obligation",
      entityId: updated.id,
      worksiteId: updated.worksiteId,
      actorUserId: input.userId,
      payload: { status: updated.status, completedQuantity: updated.completedQuantity },
    }, tx)
    return { obligation: updated, execution, created: !existing }
  })
}

export async function cancelPdtpObligation(input: {
  obligationId: string
  userId: string
  reason: string
  scope: WorksiteScope
}) {
  const reason = input.reason.trim()
  if (reason.length < 10) throw new Error("Indica un motivo de cancelación de al menos 10 caracteres.")
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${pdtpObligations} WHERE ${pdtpObligations.id} = ${input.obligationId} FOR UPDATE`)
    const [obligation] = await tx.select().from(pdtpObligations).where(eq(pdtpObligations.id, input.obligationId)).limit(1)
    if (!obligation) throw new Error("Obligación PDTP no encontrada.")
    assertWorksiteAccess(obligation.worksiteId, input.scope)
    if (obligation.status === "cancelled") return obligation
    if (obligation.status === "reported" || obligation.status === "completed") {
      throw new Error("Una obligación reportada debe corregirse mediante su ejecución, no cancelarse.")
    }
    const now = new Date().toISOString()
    const [updated] = await tx.update(pdtpObligations).set({
      status: "cancelled",
      cancelledByUserId: input.userId,
      cancelledAt: now,
      cancellationReason: reason,
      updatedAt: now,
    }).where(and(
      eq(pdtpObligations.id, obligation.id),
      inArray(pdtpObligations.status, ["pending", "overdue"]),
    )).returning()
    if (!updated) throw new Error("La obligación cambió de estado antes de cancelarse.")
    const [program] = await tx.select({ version: pdtpPrograms.version }).from(pdtpPrograms)
      .where(eq(pdtpPrograms.id, obligation.programId)).limit(1)
    if (!program) throw new Error("Programa PDTP no encontrado.")
    await addPdtpChangeLogEntry(
      obligation.programId,
      program.version,
      input.userId,
      `obligation:${obligation.id}:cancellation`,
      { status: obligation.status, cancellationReason: obligation.cancellationReason },
      { status: updated.status, cancellationReason: updated.cancellationReason },
      "Obligación preventiva cancelada con motivo trazable.",
      tx,
    )
    await recordOperationalActivity({
      eventType: "pdtp.obligation_cancelled",
      module: "pdtp",
      entityType: "pdtp_obligation",
      entityId: updated.id,
      worksiteId: updated.worksiteId,
      actorUserId: input.userId,
      payload: { status: updated.status },
    }, tx)
    return updated
  })
}

export async function listPdtpObligations(input: {
  scope: WorksiteScope
  programId?: string
  worksiteId?: string
  statuses?: PdtpObligationStatus[]
  now?: Date
}) {
  if (input.worksiteId) assertWorksiteAccess(input.worksiteId, input.scope)
  if (input.scope !== "all" && input.scope.length === 0) return []
  const rows = await db.select({
    obligation: pdtpObligations,
    activityNumber: pdtpActivities.n,
    activityName: pdtpActivities.activity,
    worksiteName: worksites.name,
  }).from(pdtpObligations)
    .innerJoin(pdtpActivities, eq(pdtpObligations.activityId, pdtpActivities.id))
    .innerJoin(worksites, eq(pdtpObligations.worksiteId, worksites.id))
    .where(and(
      input.programId ? eq(pdtpObligations.programId, input.programId) : undefined,
      input.worksiteId ? eq(pdtpObligations.worksiteId, input.worksiteId) : undefined,
      input.scope === "all" ? undefined : inArray(pdtpObligations.worksiteId, input.scope),
      input.statuses?.length ? inArray(pdtpObligations.status, input.statuses) : undefined,
    )).orderBy(asc(pdtpObligations.dueAt), asc(pdtpActivities.n))
  const now = input.now ?? new Date()
  return rows.map((row) => ({ ...row, effectiveStatus: effectiveStatus(row.obligation.status, row.obligation.dueAt, now) }))
}

export async function listPdtpDemandActivities() {
  return db.select({
    id: pdtpActivities.id,
    n: pdtpActivities.n,
    activity: pdtpActivities.activity,
    mode: pdtpActivities.scheduleMode,
    triggerDescription: pdtpActivities.triggerDescription,
    dueDays: pdtpActivities.dueDays,
    evidenceRequirement: pdtpActivities.evidenceRequirement,
    programId: pdtpPrograms.id,
    programTitle: pdtpPrograms.title,
    programYear: pdtpPrograms.year,
  }).from(pdtpActivities)
    .innerJoin(pdtpPrograms, eq(pdtpActivities.programId, pdtpPrograms.id))
    .where(and(
      eq(pdtpPrograms.status, "active"),
      eq(pdtpActivities.scheduleClassificationStatus, "confirmed"),
      inArray(pdtpActivities.scheduleMode, ["on_demand", "triggered"]),
    ))
    .orderBy(asc(pdtpPrograms.year), asc(pdtpActivities.n))
}

export async function getPdtpDemandIndicator(input: { programId: string; worksiteId: string; scope: WorksiteScope; now?: Date }) {
  const obligations = await listPdtpObligations({
    programId: input.programId,
    worksiteId: input.worksiteId,
    scope: input.scope,
    now: input.now,
  })
  const relevant = obligations.filter((row) => row.effectiveStatus !== "cancelled")
  const completed = relevant.filter((row) => row.effectiveStatus === "completed").length
  const onTime = relevant.filter((row) => row.effectiveStatus === "completed"
    && (!row.obligation.dueAt || (!!row.obligation.reportedAt && row.obligation.reportedAt <= row.obligation.dueAt))).length
  const overdue = relevant.filter((row) => row.effectiveStatus === "overdue").length
  const reported = relevant.filter((row) => row.effectiveStatus === "reported").length
  const pending = relevant.filter((row) => row.effectiveStatus === "pending").length
  return {
    caseCount: relevant.length,
    completed,
    onTime,
    reported,
    pending,
    overdue,
    rate: relevant.length === 0 ? null : onTime / relevant.length,
    state: relevant.length === 0 ? "no_cases" as const : "with_cases" as const,
  }
}

export async function listPdtpObligationReminderCandidates(input: { scope: WorksiteScope; asOf?: Date }) {
  const asOf = input.asOf ?? new Date()
  await refreshPdtpObligationStatuses(asOf)
  const maxDueAt = new Date(asOf.getTime() + 7 * 86_400_000).toISOString()
  const rows = await db.select({
    obligation: pdtpObligations,
    activityNumber: pdtpActivities.n,
    activityName: pdtpActivities.activity,
    responsibleSlugs: pdtpActivities.responsibleSlugs,
    worksiteName: worksites.name,
  }).from(pdtpObligations)
    .innerJoin(pdtpActivities, eq(pdtpObligations.activityId, pdtpActivities.id))
    .innerJoin(worksites, eq(pdtpObligations.worksiteId, worksites.id))
    .where(and(
      input.scope === "all" ? undefined : inArray(pdtpObligations.worksiteId, input.scope),
      inArray(pdtpObligations.status, ["pending", "overdue"]),
      isNotNull(pdtpObligations.dueAt),
      lte(pdtpObligations.dueAt, maxDueAt),
    )).orderBy(asc(pdtpObligations.dueAt))
  return rows.map((row) => {
    const days = Math.ceil((new Date(row.obligation.dueAt!).getTime() - asOf.getTime()) / 86_400_000)
    return { ...row, window: days < 0 ? "overdue" as const : days <= 1 ? "due_1d" as const : "due_7d" as const }
  })
}

export async function recordPdtpObligationReminder(input: {
  obligationId: string
  recipientUserId: string
  window: PdtpReminderWindow
  status?: "sent" | "failed"
  errorMessage?: string
}) {
  const now = new Date().toISOString()
  const [created] = await db.insert(pdtpObligationReminders).values({
    id: `pdtp-obligation-reminder-${nanoid()}`,
    obligationId: input.obligationId,
    recipientUserId: input.recipientUserId,
    reminderWindow: input.window,
    status: input.status ?? "sent",
    sentAt: input.status === "failed" ? null : now,
    errorMessage: input.errorMessage?.trim() || null,
    createdAt: now,
  }).onConflictDoNothing({
    target: [pdtpObligationReminders.obligationId, pdtpObligationReminders.recipientUserId, pdtpObligationReminders.reminderWindow],
  }).returning()
  return { reminder: created ?? null, created: Boolean(created) }
}
