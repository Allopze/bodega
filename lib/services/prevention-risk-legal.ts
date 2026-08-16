import { createHash } from "node:crypto"
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm"
import { z } from "zod"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { db, type DB, type Tx } from "@/db"
import {
  eppTypes,
  pdtpActivities,
  pdtpPrograms,
  preventionCapaActions,
  preventionCommittees,
  preventionCampaigns,
  preventionEmergencyPlans,
  preventionEppRequirements,
  preventionExternalEngagements,
  preventionInspectionRuns,
  preventionInspectionTemplates,
  preventionProtocolApplicabilities,
  preventionLegalApplicabilities,
  preventionLegalAssessments,
  preventionLegalRequirements,
  preventionPdtpSourceLinks,
  preventionPdtpUpdateObligations,
  preventionRiskControls,
  preventionRiskEntries,
  preventionRiskImportBatches,
  preventionRiskLegalHistory,
  preventionRiskMatrices,
  preventionRiskMethodologies,
  preventionRiskPositions,
  preventionRiskProcesses,
  preventionRiskReviewTriggers,
  preventionRiskTasks,
  preventionTrainingCourseVersions,
  preventionTrainingCourses,
  preventionTrainingSessions,
  users,
  worksites,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { MINSAL_PROTOCOL_LABELS } from "@/lib/prevention/minsal-protocols"
import { createCapaActionWithClient } from "@/lib/services/prevention-capa"
import {
  legalApplicabilityApprovalSchema,
  legalApplicabilityProposalSchema,
  legalComplianceAssessmentSchema,
  legalRequirementDraftSchema,
  legalRequirementTransitionSchema,
  pdtpObligationResolutionSchema,
  pdtpSourceLinkSchema,
  riskEntrySchema,
  riskMatrixDraftSchema,
  riskMatrixTransitionSchema,
  riskMethodologySchema,
  riskReviewTriggerSchema,
} from "@/lib/validation/prevention-module/risk-legal"

type Client = DB | Tx

export interface RiskLegalAccess {
  userId: string
  scope: WorksiteScope
  permissions: readonly string[]
}

function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

function requireAccess(access: RiskLegalAccess, permission: string, worksiteId?: string) {
  if (!access.permissions.includes(permission) || (worksiteId && !scopeAllows(access.scope, worksiteId))) {
    throw new Error("Registro preventivo no encontrado o fuera de alcance.")
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

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

async function history(client: Client, args: {
  domain: "risk" | "legal" | "pdtp_coverage" | "import"
  entityType: string
  entityId: string
  worksiteId?: string | null
  changeType: string
  reason: string
  beforeState?: unknown
  afterState?: unknown
  actorUserId?: string | null
}) {
  await client.insert(preventionRiskLegalHistory).values({
    id: `prlh-${nanoid()}`,
    domain: args.domain,
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

async function assertActiveUsers(client: Client, userIds: readonly (string | null | undefined)[]) {
  const uniqueIds = [...new Set(userIds.filter((userId): userId is string => Boolean(userId)))]
  if (uniqueIds.length === 0) return
  const activeUsers = await client.select({ id: users.id }).from(users).where(and(
    inArray(users.id, uniqueIds),
    eq(users.isActive, true),
  ))
  if (activeUsers.length !== uniqueIds.length) throw new Error("La persona responsable no existe o está inactiva.")
}

async function assertActiveUser(client: Client, userId: string | null | undefined) {
  await assertActiveUsers(client, [userId])
}

export async function createRiskMethodology(input: unknown, access: RiskLegalAccess) {
  requireAccess(access, "prevention:risk:edit")
  const data = riskMethodologySchema.parse(input)
  const [created] = await db.insert(preventionRiskMethodologies).values({
    id: `riskmethod-${nanoid()}`,
    ...data,
    createdByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo crear la metodología de riesgos.")
  await history(db, { domain: "risk", entityType: "methodology", entityId: created.id, changeType: "created", reason: "Metodología registrada", afterState: created, actorUserId: access.userId })
  return created
}

export async function ensureIspRiskMethodology(access: RiskLegalAccess) {
  requireAccess(access, "prevention:risk:edit")
  const id = "riskmethod-isp-v3-2024"
  const [created] = await db.insert(preventionRiskMethodologies).values({
    id,
    code: "ISP-IPER",
    name: "Guía para la identificación y evaluación de riesgos en los lugares de trabajo",
    versionLabel: "v3-2024",
    kind: "primary",
    authoritySource: "Instituto de Salud Pública de Chile, versión 3 (2024)",
    configuration: { dimensions: ["probability", "consequence"], allowsSpecialMethodology: true },
    createdByUserId: access.userId,
  }).onConflictDoNothing().returning()
  if (created) await history(db, { domain: "risk", entityType: "methodology", entityId: id, changeType: "created", reason: "Metodología oficial base registrada", afterState: created, actorUserId: access.userId })
  const [methodology] = await db.select().from(preventionRiskMethodologies).where(eq(preventionRiskMethodologies.id, id)).limit(1)
  if (!methodology) throw new Error("No se pudo preparar la metodología ISP.")
  return methodology
}

export async function createRiskMatrixDraftWithClient(
  client: Client,
  input: z.infer<typeof riskMatrixDraftSchema>,
  access: RiskLegalAccess,
) {
  const data = input

  const [[worksite], [methodology], versionRows] = await Promise.all([
    client.select({ id: worksites.id }).from(worksites).where(and(eq(worksites.id, data.worksiteId), eq(worksites.isActive, true))).limit(1),
    client.select().from(preventionRiskMethodologies).where(and(eq(preventionRiskMethodologies.id, data.methodologyId), eq(preventionRiskMethodologies.isActive, true))).limit(1),
    client.select({ matrixVersion: preventionRiskMatrices.matrixVersion }).from(preventionRiskMatrices).where(eq(preventionRiskMatrices.worksiteId, data.worksiteId)).orderBy(desc(preventionRiskMatrices.matrixVersion)).limit(1),
  ])
  if (!worksite || !methodology) throw new Error("Faena o metodología no encontrada.")

  let source: typeof preventionRiskMatrices.$inferSelect | null = null
  if (data.sourceMatrixId) {
    const sourceRows = await client.select().from(preventionRiskMatrices).where(and(eq(preventionRiskMatrices.id, data.sourceMatrixId), eq(preventionRiskMatrices.worksiteId, data.worksiteId), eq(preventionRiskMatrices.status, "published"))).limit(1)
    source = sourceRows[0] ?? null
    if (!source) throw new Error("La versión fuente no está publicada o está fuera de alcance.")
  }
  if (data.sourceImportBatchId) {
    const [batch] = await client.select().from(preventionRiskImportBatches).where(and(
      eq(preventionRiskImportBatches.id, data.sourceImportBatchId),
      eq(preventionRiskImportBatches.worksiteId, data.worksiteId),
      eq(preventionRiskImportBatches.status, "approved"),
    )).limit(1)
    if (!batch) throw new Error("El lote de importación no está aprobado o está fuera de alcance.")
  }

  const matrixVersion = (versionRows[0]?.matrixVersion ?? 0) + 1
  const now = new Date().toISOString()
  const [matrix] = await client.insert(preventionRiskMatrices).values({
    id: `riskmatrix-${nanoid()}`,
    worksiteId: data.worksiteId,
    matrixVersion,
    title: data.title,
    methodologyId: methodology.id,
    methodologySnapshot: { code: methodology.code, name: methodology.name, versionLabel: methodology.versionLabel, kind: methodology.kind, authoritySource: methodology.authoritySource, configuration: methodology.configuration },
    revisionReason: data.revisionReason,
    participationSummary: data.participationSummary,
    committeeMeetingId: data.committeeMeetingId ?? null,
    consultationEvidenceReference: data.consultationEvidenceReference,
    sourceImportBatchId: data.sourceImportBatchId ?? null,
    supersedesMatrixId: source?.id ?? null,
    createdByUserId: access.userId,
    createdAt: now,
    updatedAt: now,
  }).returning()
  if (!matrix) throw new Error("No se pudo crear la versión MIPER.")

  if (source) {
    const entries = await client.select().from(preventionRiskEntries).where(eq(preventionRiskEntries.matrixId, source.id)).orderBy(asc(preventionRiskEntries.createdAt))
    if (entries.length > 0) {
      const newEntryIdBySource = new Map(entries.map((entry) => [entry.id, `riskentry-${nanoid()}`]))
      const controls = await client.select().from(preventionRiskControls)
        .where(inArray(preventionRiskControls.riskEntryId, entries.map((entry) => entry.id)))
      await client.insert(preventionRiskEntries).values(entries.map((entry) => ({
        ...entry,
        id: newEntryIdBySource.get(entry.id)!,
        matrixId: matrix.id,
        version: 1,
        createdAt: now,
        updatedAt: now,
      })))
      if (controls.length > 0) {
        await client.insert(preventionRiskControls).values(controls.map((control) => ({
          ...control,
          id: `riskcontrol-${nanoid()}`,
          riskEntryId: newEntryIdBySource.get(control.riskEntryId)!,
          version: 1,
          createdAt: now,
          updatedAt: now,
        })))
      }
    }
  }
  await history(client, { domain: "risk", entityType: "matrix", entityId: matrix.id, worksiteId: matrix.worksiteId, changeType: source ? "revision_created" : "created", reason: data.revisionReason, afterState: { matrixVersion, sourceMatrixId: source?.id ?? null }, actorUserId: access.userId })
  return matrix
}

export async function createRiskMatrixDraft(input: unknown, access: RiskLegalAccess) {
  const data = riskMatrixDraftSchema.parse(input)
  requireAccess(access, "prevention:risk:edit", data.worksiteId)
  return db.transaction(async (tx) => createRiskMatrixDraftWithClient(tx, data, access))
}

async function resolveHierarchy(client: Client, worksiteId: string, data: z.infer<typeof riskEntrySchema>) {
  async function resolveProcess() {
    const [current] = await client.select().from(preventionRiskProcesses).where(and(eq(preventionRiskProcesses.worksiteId, worksiteId), eq(preventionRiskProcesses.code, data.process.code))).limit(1)
    if (current) {
      if (current.name !== data.process.name) throw new Error(`El código de proceso ${data.process.code} ya existe con otro nombre.`)
      return current
    }
    const [created] = await client.insert(preventionRiskProcesses).values({ id: `riskprocess-${nanoid()}`, worksiteId, code: data.process.code, name: data.process.name, description: data.process.description ?? null }).returning()
    return created!
  }
  const process = await resolveProcess()
  const [existingTask] = await client.select().from(preventionRiskTasks).where(and(eq(preventionRiskTasks.processId, process.id), eq(preventionRiskTasks.code, data.task.code))).limit(1)
  const task = existingTask ?? (await client.insert(preventionRiskTasks).values({ id: `risktask-${nanoid()}`, processId: process.id, code: data.task.code, name: data.task.name, isRoutine: data.task.isRoutine }).returning())[0]!
  if (task.name !== data.task.name) throw new Error(`El código de tarea ${data.task.code} ya existe con otro nombre.`)
  const [existingPosition] = await client.select().from(preventionRiskPositions).where(and(eq(preventionRiskPositions.taskId, task.id), eq(preventionRiskPositions.code, data.position.code))).limit(1)
  const position = existingPosition ?? (await client.insert(preventionRiskPositions).values({ id: `riskposition-${nanoid()}`, taskId: task.id, code: data.position.code, name: data.position.name, workerPositionKey: data.position.workerPositionKey ?? null }).returning())[0]!
  if (position.name !== data.position.name) throw new Error(`El código de puesto ${data.position.code} ya existe con otro nombre.`)
  return { process, task, position }
}

export async function addRiskEntryWithClient(
  client: Client,
  input: unknown,
  access: RiskLegalAccess,
) {
  const data = riskEntrySchema.parse(input)
  const [matrix] = await client.select().from(preventionRiskMatrices).where(eq(preventionRiskMatrices.id, data.matrixId)).limit(1)
  if (!matrix) throw new Error("MIPER no encontrada o fuera de alcance.")
  requireAccess(access, "prevention:risk:edit", matrix.worksiteId)
  if (matrix.status !== "draft") throw new Error("Sólo una versión MIPER en borrador admite cambios.")
  await assertActiveUsers(client, [
    data.responsibleUserId,
    ...data.controls.map((control) => control.responsibleUserId),
  ])
  const hierarchy = await resolveHierarchy(client, matrix.worksiteId, data)
  const now = new Date().toISOString()
  const [entry] = await client.insert(preventionRiskEntries).values({
    id: `riskentry-${nanoid()}`,
    matrixId: matrix.id,
    processId: hierarchy.process.id,
    taskId: hierarchy.task.id,
    positionId: hierarchy.position.id,
    hazardCode: data.hazardCode,
    hazard: data.hazard,
    riskFactor: data.riskFactor,
    expectedEventOrDamage: data.expectedEventOrDamage,
    exposedPeopleDescription: data.exposedPeopleDescription,
    exposedPeopleCount: data.exposedPeopleCount ?? null,
    genderConsiderations: data.genderConsiderations,
    sensitiveWorkerConsiderations: data.sensitiveWorkerConsiderations,
    specialMethodologyReference: data.specialMethodologyReference ?? null,
    inherentDimensions: data.inherentDimensions,
    inherentScore: data.inherentScore ?? null,
    inherentLevel: data.inherentLevel,
    residualDimensions: data.residualDimensions,
    residualScore: data.residualScore ?? null,
    residualLevel: data.residualLevel,
    isCritical: data.isCritical,
    responsibleUserId: data.responsibleUserId ?? null,
    responsibleSnapshot: data.responsibleSnapshot,
    evidenceReference: data.evidenceReference ?? null,
    sourceRowNumber: data.sourceRowNumber ?? null,
    sourceOriginal: data.sourceOriginal ?? null,
    sourceNormalized: data.sourceNormalized ?? null,
    normalizationDecision: data.normalizationDecision ?? null,
    createdAt: now,
    updatedAt: now,
  }).returning()
  if (!entry) throw new Error("No se pudo agregar el peligro a la MIPER.")
  const controls = data.controls.length === 0
    ? []
    : await client.insert(preventionRiskControls).values(data.controls.map((control) => ({
      id: `riskcontrol-${nanoid()}`,
      riskEntryId: entry.id,
      description: control.description,
      hierarchy: control.hierarchy,
      isExisting: control.isExisting,
      isCritical: control.isCritical,
      performanceStandard: control.performanceStandard ?? null,
      verificationFrequency: control.verificationFrequency ?? null,
      responsibleUserId: control.responsibleUserId ?? null,
      responsibleSnapshot: control.responsibleSnapshot,
      dueDate: control.dueDate ?? null,
      status: control.status,
      evidenceReference: control.evidenceReference ?? null,
      effectivenessStatus: control.status === "verified" ? "effective" : "not_assessed",
      lastVerifiedByUserId: control.status === "verified" ? access.userId : null,
      lastVerifiedAt: control.status === "verified" ? now : null,
      createdAt: now,
      updatedAt: now,
    }))).returning()
  await history(client, { domain: "risk", entityType: "entry", entityId: entry.id, worksiteId: matrix.worksiteId, changeType: "created", reason: "Peligro y controles agregados a versión borrador", afterState: { entry, controlIds: controls.map((item) => item.id) }, actorUserId: access.userId })
  return { entry, controls }
}

export async function addRiskEntry(input: unknown, access: RiskLegalAccess) {
  return db.transaction(async (tx) => addRiskEntryWithClient(tx, input, access))
}

const MATRIX_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["in_review"],
  in_review: ["reviewed"],
  reviewed: ["approved"],
  approved: ["published"],
}

const MATRIX_PERMISSION: Record<string, string> = {
  in_review: "prevention:risk:edit",
  reviewed: "prevention:risk:review",
  approved: "prevention:risk:approve",
  published: "prevention:risk:publish",
}

async function matrixSourceHash(client: Client, matrixId: string) {
  const [[matrix], entries] = await Promise.all([
    client.select().from(preventionRiskMatrices).where(eq(preventionRiskMatrices.id, matrixId)).limit(1),
    client.select().from(preventionRiskEntries).where(eq(preventionRiskEntries.matrixId, matrixId)).orderBy(asc(preventionRiskEntries.id)),
  ])
  const controls = entries.length ? await client.select().from(preventionRiskControls).where(inArray(preventionRiskControls.riskEntryId, entries.map((item) => item.id))).orderBy(asc(preventionRiskControls.id)) : []
  return sha256({ matrix: matrix && { id: matrix.id, worksiteId: matrix.worksiteId, matrixVersion: matrix.matrixVersion, methodologySnapshot: matrix.methodologySnapshot }, entries, controls })
}

export async function transitionRiskMatrix(input: unknown, access: RiskLegalAccess) {
  const data = riskMatrixTransitionSchema.parse(input)
  return db.transaction(async (tx) => {
    const [matrix] = await tx.select().from(preventionRiskMatrices).where(eq(preventionRiskMatrices.id, data.matrixId)).limit(1)
    if (!matrix) throw new Error("MIPER no encontrada o fuera de alcance.")
    requireAccess(access, MATRIX_PERMISSION[data.toStatus]!, matrix.worksiteId)
    if (!MATRIX_TRANSITIONS[matrix.status]?.includes(data.toStatus)) throw new Error(`Transición MIPER inválida: ${matrix.status} → ${data.toStatus}.`)
    if (matrix.version !== data.expectedVersion) throw new Error("La MIPER cambió mientras la revisabas. Recarga antes de continuar.")
    if (data.toStatus === "in_review") {
      const countRows = await tx.select({ count: sql<number>`count(*)::int` }).from(preventionRiskEntries).where(eq(preventionRiskEntries.matrixId, matrix.id))
      if (!countRows[0]?.count) throw new Error("Una MIPER sin peligros no puede enviarse a revisión.")
    }
    if (data.toStatus === "reviewed" && matrix.createdByUserId === access.userId) throw new Error("Quien creó la versión MIPER no puede revisarla.")
    if (data.toStatus === "approved" && (matrix.createdByUserId === access.userId || matrix.reviewedByUserId === access.userId)) throw new Error("La aprobación MIPER debe estar segregada de creación y revisión.")
    const now = new Date().toISOString()
    const updates: Partial<typeof preventionRiskMatrices.$inferInsert> = { status: data.toStatus, version: matrix.version + 1, updatedAt: now }
    if (data.toStatus === "reviewed") Object.assign(updates, { reviewedByUserId: access.userId, reviewedAt: now })
    if (data.toStatus === "approved") Object.assign(updates, { approvedByUserId: access.userId, approvedAt: now })
    let sourceHash: string | null = null
    if (data.toStatus === "published") {
      sourceHash = await matrixSourceHash(tx, matrix.id)
      const effectiveFrom = data.effectiveFrom ?? todayInChile()
      const reviewDueAt = addDays(effectiveFrom, 365)
      const previousPublished = await tx.select().from(preventionRiskMatrices).where(and(
        eq(preventionRiskMatrices.worksiteId, matrix.worksiteId),
        eq(preventionRiskMatrices.status, "published"),
      ))
      for (const previous of previousPublished) {
        const [superseded] = await tx.update(preventionRiskMatrices)
          .set({ status: "superseded", version: previous.version + 1, updatedAt: now })
          .where(and(
            eq(preventionRiskMatrices.id, previous.id),
            eq(preventionRiskMatrices.status, "published"),
            eq(preventionRiskMatrices.version, previous.version),
          ))
          .returning()
        if (superseded) {
          await history(tx, {
            domain: "risk",
            entityType: "matrix",
            entityId: previous.id,
            worksiteId: previous.worksiteId,
            changeType: "superseded",
            reason: `Reemplazada por MIPER v${matrix.matrixVersion} (${matrix.id}).`,
            beforeState: { status: previous.status, version: previous.version, publishedHashSha256: previous.publishedHashSha256 },
            afterState: { status: superseded.status, version: superseded.version, supersededByMatrixId: matrix.id },
            actorUserId: access.userId,
          })
        }
      }
      Object.assign(updates, { effectiveFrom, reviewDueAt, publishedHashSha256: sourceHash, publishedByUserId: access.userId, publishedAt: now })
    }
    const [updated] = await tx.update(preventionRiskMatrices).set(updates).where(and(eq(preventionRiskMatrices.id, matrix.id), eq(preventionRiskMatrices.version, data.expectedVersion), eq(preventionRiskMatrices.status, matrix.status))).returning()
    if (!updated) throw new Error("La MIPER cambió mientras la revisabas. Recarga antes de continuar.")
    await history(tx, { domain: "risk", entityType: "matrix", entityId: matrix.id, worksiteId: matrix.worksiteId, changeType: data.toStatus, reason: data.reason, beforeState: { status: matrix.status, version: matrix.version }, afterState: { status: updated.status, version: updated.version, sourceHash }, actorUserId: access.userId })
    if (data.toStatus === "published") {
      const effectiveFrom = updated.effectiveFrom!
      await createRiskReviewTriggerWithClient(tx, {
        worksiteId: matrix.worksiteId,
        matrixId: matrix.id,
        triggerType: "annual",
        sourceType: "risk_matrix",
        sourceId: matrix.id,
        description: `Revisión anual de MIPER v${matrix.matrixVersion}.`,
        dueAt: updated.reviewDueAt!,
        idempotencyKey: `miper:annual:${matrix.id}`,
      }, access.userId)
      await tx.insert(preventionPdtpUpdateObligations).values({
        id: `pdtpob-${nanoid()}`,
        idempotencyKey: `miper:pdtp30:${matrix.id}`,
        worksiteId: matrix.worksiteId,
        sourceType: "risk_matrix",
        sourceId: matrix.id,
        sourceVersionSnapshot: `MIPER v${matrix.matrixVersion} · ${sourceHash}`,
        dueAt: addDays(effectiveFrom, 30),
      }).onConflictDoNothing()
      if (matrix.sourceImportBatchId) {
        await tx.update(preventionRiskImportBatches).set({ status: "activated", activatedMatrixId: matrix.id, activatedByUserId: access.userId, activatedAt: now }).where(eq(preventionRiskImportBatches.id, matrix.sourceImportBatchId))
      }
    }
    return updated
  })
}

export async function createRiskReviewTriggerWithClient(client: Client, input: unknown, actorUserId: string | null) {
  const data = riskReviewTriggerSchema.parse(input)
  const [created] = await client.insert(preventionRiskReviewTriggers).values({
    id: `risktrigger-${nanoid()}`,
    ...data,
    matrixId: data.matrixId ?? null,
    assignedToUserId: data.assignedToUserId ?? null,
    createdByUserId: actorUserId,
  }).onConflictDoNothing().returning()
  if (created) await history(client, { domain: "risk", entityType: "review_trigger", entityId: created.id, worksiteId: data.worksiteId, changeType: "created", reason: data.description, afterState: created, actorUserId })
  if (created) return created
  const [existing] = await client.select().from(preventionRiskReviewTriggers).where(eq(preventionRiskReviewTriggers.idempotencyKey, data.idempotencyKey)).limit(1)
  return existing!
}

export async function createRiskReviewTrigger(input: unknown, access: RiskLegalAccess) {
  const data = riskReviewTriggerSchema.parse(input)
  requireAccess(access, "prevention:risk:edit", data.worksiteId)
  return db.transaction((tx) => createRiskReviewTriggerWithClient(tx, data, access.userId))
}

export async function resolveRiskReviewTrigger(input: unknown, access: RiskLegalAccess) {
  const data = z.object({ triggerId: z.string().min(1), matrixId: z.string().min(1), resolution: z.string().trim().min(10).max(3000) }).parse(input)
  return db.transaction(async (tx) => {
    const [trigger] = await tx.select().from(preventionRiskReviewTriggers).where(eq(preventionRiskReviewTriggers.id, data.triggerId)).limit(1)
    if (!trigger) throw new Error("Tarea de revisión no encontrada o fuera de alcance.")
    requireAccess(access, "prevention:risk:review", trigger.worksiteId)
    const [matrix] = await tx.select().from(preventionRiskMatrices).where(and(eq(preventionRiskMatrices.id, data.matrixId), eq(preventionRiskMatrices.worksiteId, trigger.worksiteId), eq(preventionRiskMatrices.status, "published"))).limit(1)
    if (!matrix || !matrix.publishedAt || new Date(matrix.publishedAt) < new Date(trigger.createdAt)) throw new Error("La tarea sólo se completa con una versión MIPER publicada después del disparador.")
    const now = new Date().toISOString()
    const [updated] = await tx.update(preventionRiskReviewTriggers).set({ status: "completed", matrixId: matrix.id, resolvedByUserId: access.userId, resolvedAt: now, resolution: data.resolution }).where(and(eq(preventionRiskReviewTriggers.id, trigger.id), inArray(preventionRiskReviewTriggers.status, ["pending", "in_progress"]))).returning()
    if (!updated) throw new Error("La tarea de revisión ya fue resuelta.")
    await history(tx, { domain: "risk", entityType: "review_trigger", entityId: trigger.id, worksiteId: trigger.worksiteId, changeType: "completed", reason: data.resolution, beforeState: trigger, afterState: updated, actorUserId: access.userId })
    return updated
  })
}

export async function createLegalRequirementDraft(input: unknown, access: RiskLegalAccess) {
  requireAccess(access, "prevention:legal:assess")
  const data = legalRequirementDraftSchema.parse(input)
  return db.transaction(async (tx) => {
    let source: typeof preventionLegalRequirements.$inferSelect | null = null
    if (data.sourceRequirementId) {
      const sourceRows = await tx.select().from(preventionLegalRequirements).where(and(eq(preventionLegalRequirements.id, data.sourceRequirementId), eq(preventionLegalRequirements.status, "published"))).limit(1)
      source = sourceRows[0] ?? null
      if (!source) throw new Error("El requisito fuente no está publicado.")
    }
    const [latest] = await tx.select({ requirementVersion: preventionLegalRequirements.requirementVersion }).from(preventionLegalRequirements).where(eq(preventionLegalRequirements.code, data.code)).orderBy(desc(preventionLegalRequirements.requirementVersion)).limit(1)
    const now = new Date().toISOString()
    const [created] = await tx.insert(preventionLegalRequirements).values({
      id: `legalreq-${nanoid()}`,
      code: data.code,
      requirementVersion: (latest?.requirementVersion ?? 0) + 1,
      sourceType: data.sourceType,
      authority: data.authority,
      sourceTitle: data.sourceTitle,
      sourceReference: data.sourceReference,
      sourceUrl: data.sourceUrl ?? null,
      article: data.article,
      requirement: data.requirement,
      versionLabel: data.versionLabel,
      validFrom: data.validFrom,
      validTo: data.validTo ?? null,
      topic: data.topic,
      chomeRole: data.chomeRole,
      evidenceRequired: data.evidenceRequired,
      frequency: data.frequency,
      supersedesRequirementId: source?.id ?? null,
      createdByUserId: access.userId,
      createdAt: now,
      updatedAt: now,
    }).returning()
    if (!created) throw new Error("No se pudo crear el requisito legal.")
    await history(tx, { domain: "legal", entityType: "requirement", entityId: created.id, changeType: source ? "revision_created" : "created", reason: source ? `Nueva versión de ${source.id}` : "Requisito registrado", afterState: created, actorUserId: access.userId })
    return created
  })
}

const LEGAL_TRANSITIONS: Record<string, readonly string[]> = { draft: ["in_review"], in_review: ["reviewed"], reviewed: ["approved"], approved: ["published"] }
const LEGAL_PERMISSION: Record<string, string> = { in_review: "prevention:legal:assess", reviewed: "prevention:legal:assess", approved: "prevention:legal:approve_applicability", published: "prevention:legal:approve_applicability" }

export async function transitionLegalRequirement(input: unknown, access: RiskLegalAccess) {
  const data = legalRequirementTransitionSchema.parse(input)
  return db.transaction(async (tx) => {
    const [requirement] = await tx.select().from(preventionLegalRequirements).where(eq(preventionLegalRequirements.id, data.requirementId)).limit(1)
    if (!requirement) throw new Error("Requisito legal no encontrado.")
    requireAccess(access, LEGAL_PERMISSION[data.toStatus]!)
    if (!LEGAL_TRANSITIONS[requirement.status]?.includes(data.toStatus)) throw new Error(`Transición legal inválida: ${requirement.status} → ${data.toStatus}.`)
    if (requirement.version !== data.expectedVersion) throw new Error("El requisito cambió mientras lo revisabas.")
    if (data.toStatus === "reviewed" && requirement.createdByUserId === access.userId) throw new Error("Quien creó el requisito no puede revisarlo.")
    if (data.toStatus === "approved" && (requirement.createdByUserId === access.userId || requirement.reviewedByUserId === access.userId)) throw new Error("La aprobación legal debe estar segregada de creación y revisión.")
    const now = new Date().toISOString()
    const updates: Partial<typeof preventionLegalRequirements.$inferInsert> = { status: data.toStatus, version: requirement.version + 1, updatedAt: now }
    if (data.toStatus === "reviewed") Object.assign(updates, { reviewedByUserId: access.userId, reviewedAt: now })
    if (data.toStatus === "approved") Object.assign(updates, { approvedByUserId: access.userId, approvedAt: now })
    if (data.toStatus === "published") {
      const hash = sha256({ code: requirement.code, requirementVersion: requirement.requirementVersion, sourceReference: requirement.sourceReference, article: requirement.article, requirement: requirement.requirement, versionLabel: requirement.versionLabel, validFrom: requirement.validFrom, validTo: requirement.validTo })
      Object.assign(updates, { publishedHashSha256: hash, publishedByUserId: access.userId, publishedAt: now })
      if (requirement.supersedesRequirementId) {
        const [previous] = await tx.select().from(preventionLegalRequirements).where(eq(preventionLegalRequirements.id, requirement.supersedesRequirementId)).limit(1)
        if (previous?.status === "published") {
          const [superseded] = await tx.update(preventionLegalRequirements)
            .set({ status: "superseded", version: previous.version + 1, updatedAt: now })
            .where(and(
              eq(preventionLegalRequirements.id, previous.id),
              eq(preventionLegalRequirements.status, "published"),
              eq(preventionLegalRequirements.version, previous.version),
            ))
            .returning()
          if (superseded) {
            await history(tx, {
              domain: "legal",
              entityType: "requirement",
              entityId: previous.id,
              changeType: "superseded",
              reason: `Reemplazado por ${requirement.code} v${requirement.requirementVersion} (${requirement.id}).`,
              beforeState: { status: previous.status, version: previous.version, publishedHashSha256: previous.publishedHashSha256 },
              afterState: { status: superseded.status, version: superseded.version, supersededByRequirementId: requirement.id },
              actorUserId: access.userId,
            })
          }
        }
      }
    }
    const [updated] = await tx.update(preventionLegalRequirements).set(updates).where(and(eq(preventionLegalRequirements.id, requirement.id), eq(preventionLegalRequirements.version, data.expectedVersion), eq(preventionLegalRequirements.status, requirement.status))).returning()
    if (!updated) throw new Error("El requisito cambió mientras lo revisabas.")
    await history(tx, { domain: "legal", entityType: "requirement", entityId: requirement.id, changeType: data.toStatus, reason: data.reason, beforeState: { status: requirement.status, version: requirement.version }, afterState: { status: updated.status, version: updated.version, hash: updated.publishedHashSha256 }, actorUserId: access.userId })
    return updated
  })
}

export async function proposeLegalApplicability(input: unknown, access: RiskLegalAccess) {
  const data = legalApplicabilityProposalSchema.parse(input)
  requireAccess(access, "prevention:legal:assess", data.worksiteId)
  return db.transaction(async (tx) => {
    const [[requirement], [worksite]] = await Promise.all([
      tx.select().from(preventionLegalRequirements).where(and(eq(preventionLegalRequirements.id, data.requirementId), eq(preventionLegalRequirements.status, "published"))).limit(1),
      tx.select({ id: worksites.id }).from(worksites).where(and(eq(worksites.id, data.worksiteId), eq(worksites.isActive, true))).limit(1),
    ])
    if (!requirement || !worksite) throw new Error("Requisito o faena no encontrado.")
    await assertActiveUser(tx, data.responsibleUserId)
    if (data.processId) {
      const [process] = await tx.select({ id: preventionRiskProcesses.id }).from(preventionRiskProcesses).where(and(eq(preventionRiskProcesses.id, data.processId), eq(preventionRiskProcesses.worksiteId, data.worksiteId))).limit(1)
      if (!process) throw new Error("Proceso no encontrado en la faena.")
    }
    const existingConditions = [eq(preventionLegalApplicabilities.requirementId, data.requirementId), eq(preventionLegalApplicabilities.worksiteId, data.worksiteId), data.processId ? eq(preventionLegalApplicabilities.processId, data.processId) : isNull(preventionLegalApplicabilities.processId)]
    const [existing] = await tx.select().from(preventionLegalApplicabilities).where(and(...existingConditions)).limit(1)
    const now = new Date().toISOString()
    const values = {
      processId: data.processId ?? null,
      activityReference: data.activityReference ?? null,
      applicabilityStatus: data.applicabilityStatus,
      rationale: data.rationale,
      responsibleUserId: data.responsibleUserId ?? null,
      responsibleSnapshot: data.responsibleSnapshot,
      evidenceReference: data.evidenceReference ?? null,
      evidenceDueAt: data.evidenceDueAt ?? null,
      complianceStatus: "not_assessed",
      assessedByUserId: access.userId,
      assessedAt: now,
      approvedByUserId: null,
      approvedAt: null,
      updatedAt: now,
    }
    const [saved] = existing
      ? await tx.update(preventionLegalApplicabilities).set({ ...values, version: existing.version + 1 }).where(and(eq(preventionLegalApplicabilities.id, existing.id), eq(preventionLegalApplicabilities.version, existing.version))).returning()
      : await tx.insert(preventionLegalApplicabilities).values({ id: `legalapp-${nanoid()}`, requirementId: data.requirementId, worksiteId: data.worksiteId, ...values }).returning()
    if (!saved) throw new Error("La aplicabilidad cambió mientras la revisabas.")
    await history(tx, { domain: "legal", entityType: "applicability", entityId: saved.id, worksiteId: data.worksiteId, changeType: data.applicabilityStatus, reason: data.rationale, beforeState: existing ?? null, afterState: saved, actorUserId: access.userId })
    return saved
  })
}

export async function approveLegalApplicability(input: unknown, access: RiskLegalAccess) {
  const data = legalApplicabilityApprovalSchema.parse(input)
  return db.transaction(async (tx) => {
    const [item] = await tx.select().from(preventionLegalApplicabilities).where(eq(preventionLegalApplicabilities.id, data.applicabilityId)).limit(1)
    if (!item) throw new Error("Aplicabilidad no encontrada o fuera de alcance.")
    requireAccess(access, "prevention:legal:approve_applicability", item.worksiteId)
    if (!item.applicabilityStatus.startsWith("proposed_")) throw new Error("La aplicabilidad no está pendiente de aprobación.")
    if (item.assessedByUserId === access.userId) throw new Error("Quien evaluó la aplicabilidad no puede aprobarla.")
    if (item.version !== data.expectedVersion) throw new Error("La aplicabilidad cambió mientras la revisabas.")
    const finalStatus = item.applicabilityStatus === "proposed_applicable" ? "applicable" : "not_applicable"
    const complianceStatus = finalStatus === "not_applicable" ? "not_applicable" : "not_assessed"
    const now = new Date().toISOString()
    const [updated] = await tx.update(preventionLegalApplicabilities).set({ applicabilityStatus: finalStatus, complianceStatus, approvedByUserId: access.userId, approvedAt: now, version: item.version + 1, updatedAt: now }).where(and(eq(preventionLegalApplicabilities.id, item.id), eq(preventionLegalApplicabilities.version, data.expectedVersion))).returning()
    if (!updated) throw new Error("La aplicabilidad cambió mientras la revisabas.")
    await history(tx, { domain: "legal", entityType: "applicability", entityId: item.id, worksiteId: item.worksiteId, changeType: "approved", reason: data.reason, beforeState: item, afterState: updated, actorUserId: access.userId })
    if (finalStatus === "applicable") {
      const [requirement] = await tx.select().from(preventionLegalRequirements).where(eq(preventionLegalRequirements.id, item.requirementId)).limit(1)
      await tx.insert(preventionPdtpUpdateObligations).values({
        id: `pdtpob-${nanoid()}`,
        idempotencyKey: `legal:pdtp:${item.id}:${item.version + 1}`,
        worksiteId: item.worksiteId,
        sourceType: "legal_requirement",
        sourceId: item.requirementId,
        sourceVersionSnapshot: `Requisito ${requirement?.code ?? item.requirementId} v${requirement?.requirementVersion ?? "?"}`,
        dueAt: addDays(todayInChile(), 30),
      }).onConflictDoNothing()
    }
    return updated
  })
}

export async function assessLegalCompliance(input: unknown, access: RiskLegalAccess) {
  const data = legalComplianceAssessmentSchema.parse(input)
  return db.transaction(async (tx) => {
    const [item] = await tx.select().from(preventionLegalApplicabilities).where(eq(preventionLegalApplicabilities.id, data.applicabilityId)).limit(1)
    if (!item) throw new Error("Aplicabilidad no encontrada o fuera de alcance.")
    requireAccess(access, "prevention:legal:assess", item.worksiteId)
    if (item.applicabilityStatus !== "applicable") throw new Error("Sólo un requisito aplicable y aprobado puede evaluarse.")
    if (item.version !== data.expectedVersion) throw new Error("La aplicabilidad cambió mientras la revisabas.")
    let capaActionId: string | null = null
    if (data.status === "partial" || data.status === "noncompliant") {
      requireAccess(access, "prevention:capa:manage", item.worksiteId)
      const capa = data.capa!
      const created = await createCapaActionWithClient(tx, {
        sourceType: "legal_requirement",
        sourceId: item.requirementId,
        sourceItemId: item.id,
        worksiteId: item.worksiteId,
        finding: data.finding,
        actionDescription: capa.actionDescription,
        responsibleUserId: capa.responsibleUserId ?? null,
        responsibleSnapshot: capa.responsibleSnapshot,
        priority: capa.priority,
        targetDate: capa.targetDate,
        evidenceRequired: true,
      }, access.userId)
      capaActionId = created.id
    }
    const now = new Date().toISOString()
    const [assessment] = await tx.insert(preventionLegalAssessments).values({
      id: `legalassess-${nanoid()}`,
      applicabilityId: item.id,
      status: data.status,
      finding: data.finding ?? null,
      evidenceReference: data.evidenceReference ?? null,
      capaActionId,
      assessedByUserId: access.userId,
      assessedAt: now,
      nextAssessmentAt: data.nextAssessmentAt ?? null,
    }).returning()
    const [updated] = await tx.update(preventionLegalApplicabilities).set({ complianceStatus: data.status, evidenceReference: data.evidenceReference ?? item.evidenceReference, assessedByUserId: access.userId, assessedAt: now, version: item.version + 1, updatedAt: now }).where(and(eq(preventionLegalApplicabilities.id, item.id), eq(preventionLegalApplicabilities.version, data.expectedVersion))).returning()
    if (!assessment || !updated) throw new Error("La aplicabilidad cambió mientras la evaluabas.")
    await history(tx, { domain: "legal", entityType: "assessment", entityId: assessment.id, worksiteId: item.worksiteId, changeType: data.status, reason: data.finding ?? "Evaluación de cumplimiento", beforeState: { complianceStatus: item.complianceStatus }, afterState: { complianceStatus: data.status, capaActionId }, actorUserId: access.userId })
    return { assessment, applicability: updated }
  })
}

export async function linkPdtpActivitySource(input: unknown, access: RiskLegalAccess) {
  const data = pdtpSourceLinkSchema.parse(input)
  requireAccess(access, "prevention:pdtp:program:manage", data.worksiteId)
  return db.transaction(async (tx) => {
    const [activity] = await tx.select({ activity: pdtpActivities, program: pdtpPrograms }).from(pdtpActivities).innerJoin(pdtpPrograms, eq(pdtpPrograms.id, pdtpActivities.programId)).where(eq(pdtpActivities.id, data.activityId)).limit(1)
    if (!activity) throw new Error("Actividad PDTP no encontrada.")
    // La cobertura de fuentes es trazabilidad operacional: se vincula tanto en
    // borrador (planificación) como en un programa activo (demostrar cobertura y
    // cerrar el reloj MIPER de 30 días — ver resolvePdtpUpdateObligation). Solo
    // se bloquea durante la revisión: alterar el contenido ahí invalidaría el
    // digest firmado que se re-verifica al activar (ver pdtp/lifecycle.ts).
    if (activity.program.status === "in_review") {
      throw new Error("El programa está en revisión y su contenido está bloqueado: no se pueden modificar sus vínculos de cobertura hasta que se apruebe o se reabra.")
    }
    let sourceVersionSnapshot = "Fuente manual"
    let sourceEntityId = data.sourceId
    if (data.sourceType === "risk_control") {
      const [source] = await tx.select({ control: preventionRiskControls, matrix: preventionRiskMatrices }).from(preventionRiskControls).innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskControls.riskEntryId)).innerJoin(preventionRiskMatrices, eq(preventionRiskMatrices.id, preventionRiskEntries.matrixId)).where(and(eq(preventionRiskControls.id, data.sourceId), eq(preventionRiskMatrices.worksiteId, data.worksiteId), eq(preventionRiskMatrices.status, "published"))).limit(1)
      if (!source) throw new Error("Control MIPER no encontrado, no publicado o fuera de alcance.")
      sourceVersionSnapshot = `MIPER v${source.matrix.matrixVersion} · control v${source.control.version}`
      sourceEntityId = source.control.id
    } else if (data.sourceType === "legal_requirement") {
      const [source] = await tx.select({ requirement: preventionLegalRequirements }).from(preventionLegalRequirements).innerJoin(preventionLegalApplicabilities, eq(preventionLegalApplicabilities.requirementId, preventionLegalRequirements.id)).where(and(eq(preventionLegalRequirements.id, data.sourceId), eq(preventionLegalRequirements.status, "published"), eq(preventionLegalApplicabilities.worksiteId, data.worksiteId), eq(preventionLegalApplicabilities.applicabilityStatus, "applicable"))).limit(1)
      if (!source) throw new Error("Requisito legal no encontrado, no aplicable o fuera de alcance.")
      sourceVersionSnapshot = `${source.requirement.code} v${source.requirement.requirementVersion}`
    } else if (data.sourceType === "incident_capa") {
      const [source] = await tx.select().from(preventionCapaActions).where(and(eq(preventionCapaActions.id, data.sourceId), eq(preventionCapaActions.worksiteId, data.worksiteId))).limit(1)
      if (!source) throw new Error("CAPA de incidente no encontrada o fuera de alcance.")
      sourceVersionSnapshot = `${source.code} v${source.version}`
    } else if (data.sourceType === "capacitacion") {
      const [source] = await tx.select().from(preventionTrainingSessions).where(and(eq(preventionTrainingSessions.id, data.sourceId), eq(preventionTrainingSessions.worksiteId, data.worksiteId), ne(preventionTrainingSessions.status, "cancelled"))).limit(1)
      if (!source) throw new Error("Sesión de capacitación no encontrada, cancelada o fuera de alcance.")
      sourceVersionSnapshot = source.code
    } else if (data.sourceType === "inspeccion") {
      const [source] = await tx.select().from(preventionInspectionRuns).where(and(eq(preventionInspectionRuns.id, data.sourceId), eq(preventionInspectionRuns.worksiteId, data.worksiteId), ne(preventionInspectionRuns.status, "cancelled"))).limit(1)
      if (!source) throw new Error("Inspección no encontrada, cancelada o fuera de alcance.")
      sourceVersionSnapshot = source.code
    } else if (data.sourceType === "audit") {
      // `audit` ya existía en el enum pero sin rama: caía en "Fuente manual", o
      // sea sin snapshot de versión y —peor— sin verificar pertenencia a la
      // faena. Una auditoría es una corrida del motor de inspecciones cuya
      // plantilla es de tipo 'audit' (DS 44 art. 22 n°4).
      const [source] = await tx.select({ run: preventionInspectionRuns, template: preventionInspectionTemplates }).from(preventionInspectionRuns).innerJoin(preventionInspectionTemplates, eq(preventionInspectionTemplates.id, preventionInspectionRuns.templateId)).where(and(eq(preventionInspectionRuns.id, data.sourceId), eq(preventionInspectionRuns.worksiteId, data.worksiteId), eq(preventionInspectionTemplates.kind, "audit"), ne(preventionInspectionRuns.status, "cancelled"))).limit(1)
      if (!source) throw new Error("Auditoría no encontrada, cancelada o fuera de alcance.")
      sourceVersionSnapshot = `${source.run.code} · ${source.template.code} v${source.template.versionLabel}`
    } else if (data.sourceType === "cphs") {
      const [source] = await tx.select().from(preventionCommittees).where(and(eq(preventionCommittees.id, data.sourceId), eq(preventionCommittees.worksiteId, data.worksiteId), eq(preventionCommittees.status, "active"))).limit(1)
      if (!source) throw new Error("Comité CPHS no encontrado, no activo o fuera de alcance.")
      sourceVersionSnapshot = `${source.name} v${source.version}`
    } else if (data.sourceType === "epp") {
      const [source] = await tx.select().from(preventionEppRequirements).where(and(eq(preventionEppRequirements.id, data.sourceId), eq(preventionEppRequirements.worksiteId, data.worksiteId), eq(preventionEppRequirements.isActive, true))).limit(1)
      if (!source) throw new Error("Requisito de EPP no encontrado, inactivo o fuera de alcance.")
      sourceVersionSnapshot = `EPP requerido desde ${source.createdAt.slice(0, 10)}`
    } else if (data.sourceType === "emergencia") {
      const [source] = await tx.select().from(preventionEmergencyPlans).where(and(eq(preventionEmergencyPlans.id, data.sourceId), eq(preventionEmergencyPlans.worksiteId, data.worksiteId), eq(preventionEmergencyPlans.status, "approved"))).limit(1)
      if (!source) throw new Error("Plan de emergencia no encontrado, no aprobado o fuera de alcance.")
      sourceVersionSnapshot = `${source.code} v${source.version}`
    } else if (data.sourceType === "protocolo_minsal") {
      // Sólo un protocolo declarado aplicable puede cubrir una actividad: uno
      // descartado o sin pronunciamiento no sostiene nada ante un fiscalizador.
      const [source] = await tx.select().from(preventionProtocolApplicabilities).where(and(eq(preventionProtocolApplicabilities.id, data.sourceId), eq(preventionProtocolApplicabilities.worksiteId, data.worksiteId), eq(preventionProtocolApplicabilities.status, "applicable"))).limit(1)
      if (!source) throw new Error("Protocolo MINSAL no encontrado, no declarado aplicable o fuera de alcance.")
      sourceVersionSnapshot = `${MINSAL_PROTOCOL_LABELS[source.protocolCode] ?? source.protocolCode} v${source.version}`
    } else if (data.sourceType === "contractual_obligation") {
      // La obligación contractual del mandante llega por una coordinación del
      // art. 20: es la interacción registrada la que la acredita.
      const [source] = await tx.select().from(preventionExternalEngagements).where(and(eq(preventionExternalEngagements.id, data.sourceId), eq(preventionExternalEngagements.worksiteId, data.worksiteId), eq(preventionExternalEngagements.kind, "coordinacion"))).limit(1)
      if (!source) throw new Error("Coordinación con el mandante no encontrada o fuera de alcance.")
      sourceVersionSnapshot = `${source.code} · ${source.occurredOn}`
    } else if (data.sourceType === "campana") {
      // Único tipo con catálogo que quedaba sin verificar pertenencia a faena.
      const [source] = await tx.select().from(preventionCampaigns).where(and(eq(preventionCampaigns.id, data.sourceId), eq(preventionCampaigns.worksiteId, data.worksiteId), ne(preventionCampaigns.status, "cancelled"))).limit(1)
      if (!source) throw new Error("Campaña no encontrada, cancelada o fuera de alcance.")
      sourceVersionSnapshot = source.code
    }
    const [created] = await tx.insert(preventionPdtpSourceLinks).values({
      id: `pdtpsource-${nanoid()}`,
      activityId: activity.activity.id,
      worksiteId: data.worksiteId,
      sourceType: data.sourceType,
      sourceId: sourceEntityId,
      sourceVersionSnapshot,
      justification: data.justification,
      createdByUserId: access.userId,
    }).returning()
    if (!created) throw new Error("No se pudo vincular la fuente PDTP.")
    await history(tx, { domain: "pdtp_coverage", entityType: "source_link", entityId: created.id, worksiteId: data.worksiteId, changeType: "created", reason: data.justification, afterState: created, actorUserId: access.userId })
    return created
  })
}

export async function resolvePdtpUpdateObligation(input: unknown, access: RiskLegalAccess) {
  const data = pdtpObligationResolutionSchema.parse(input)
  return db.transaction(async (tx) => {
    const [obligation] = await tx.select().from(preventionPdtpUpdateObligations).where(eq(preventionPdtpUpdateObligations.id, data.obligationId)).limit(1)
    if (!obligation) throw new Error("Obligación PDTP no encontrada o fuera de alcance.")
    requireAccess(access, "prevention:pdtp:program:manage", obligation.worksiteId)
    const [program] = await tx.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, data.programId)).limit(1)
    if (!program) throw new Error("Programa PDTP no encontrado.")
    const activities = await tx.select({ id: pdtpActivities.id }).from(pdtpActivities).where(eq(pdtpActivities.programId, program.id))
    if (activities.length === 0) throw new Error("El programa no contiene actividades.")
    const activityIds = activities.map((item) => item.id)
    let covered = false
    if (obligation.sourceType === "legal_requirement") {
      const [link] = await tx.select({ id: preventionPdtpSourceLinks.id }).from(preventionPdtpSourceLinks).where(and(inArray(preventionPdtpSourceLinks.activityId, activityIds), eq(preventionPdtpSourceLinks.worksiteId, obligation.worksiteId), eq(preventionPdtpSourceLinks.sourceType, "legal_requirement"), eq(preventionPdtpSourceLinks.sourceId, obligation.sourceId), eq(preventionPdtpSourceLinks.isActive, true))).limit(1)
      covered = Boolean(link)
    } else {
      const [link] = await tx.select({ id: preventionPdtpSourceLinks.id }).from(preventionPdtpSourceLinks).innerJoin(preventionRiskControls, eq(preventionRiskControls.id, preventionPdtpSourceLinks.sourceId)).innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskControls.riskEntryId)).where(and(inArray(preventionPdtpSourceLinks.activityId, activityIds), eq(preventionPdtpSourceLinks.worksiteId, obligation.worksiteId), eq(preventionPdtpSourceLinks.sourceType, "risk_control"), eq(preventionRiskEntries.matrixId, obligation.sourceId), eq(preventionPdtpSourceLinks.isActive, true))).limit(1)
      covered = Boolean(link)
    }
    if (!covered) throw new Error("No se puede cerrar el reloj: el programa no tiene una actividad vinculada a esta fuente.")
    const now = new Date().toISOString()
    const [updated] = await tx.update(preventionPdtpUpdateObligations).set({ status: "addressed", addressedByProgramId: program.id, addressedByUserId: access.userId, addressedAt: now, resolution: data.resolution }).where(and(eq(preventionPdtpUpdateObligations.id, obligation.id), inArray(preventionPdtpUpdateObligations.status, ["pending", "overdue"]))).returning()
    if (!updated) throw new Error("La obligación ya fue resuelta.")
    await history(tx, { domain: "pdtp_coverage", entityType: "update_obligation", entityId: obligation.id, worksiteId: obligation.worksiteId, changeType: "addressed", reason: data.resolution, beforeState: obligation, afterState: updated, actorUserId: access.userId })
    return updated
  })
}

export async function refreshPdtpUpdateObligationDeadlines(client: Client = db) {
  return client.update(preventionPdtpUpdateObligations).set({ status: "overdue" }).where(and(eq(preventionPdtpUpdateObligations.status, "pending"), sql`${preventionPdtpUpdateObligations.dueAt} < ${todayInChile()}`)).returning({ id: preventionPdtpUpdateObligations.id })
}

export async function getRiskDashboard(access: RiskLegalAccess) {
  requireAccess(access, "prevention:risk:view")
  const condition = scopeCondition(access.scope, preventionRiskMatrices.worksiteId)
  const [visibleWorksites, methodologies, matrices, processes, triggers, obligations] = await Promise.all([
    db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(and(eq(worksites.isActive, true), scopeCondition(access.scope, worksites.id))).orderBy(asc(worksites.name)),
    db.select().from(preventionRiskMethodologies).where(eq(preventionRiskMethodologies.isActive, true)).orderBy(asc(preventionRiskMethodologies.name)),
    db.select().from(preventionRiskMatrices).where(condition).orderBy(desc(preventionRiskMatrices.createdAt)),
    db.select().from(preventionRiskProcesses).where(and(eq(preventionRiskProcesses.isActive, true), scopeCondition(access.scope, preventionRiskProcesses.worksiteId))).orderBy(asc(preventionRiskProcesses.name)),
    db.select().from(preventionRiskReviewTriggers).where(and(scopeCondition(access.scope, preventionRiskReviewTriggers.worksiteId), inArray(preventionRiskReviewTriggers.status, ["pending", "in_progress"]))).orderBy(asc(preventionRiskReviewTriggers.dueAt)),
    db.select().from(preventionPdtpUpdateObligations).where(and(scopeCondition(access.scope, preventionPdtpUpdateObligations.worksiteId), eq(preventionPdtpUpdateObligations.sourceType, "risk_matrix"), inArray(preventionPdtpUpdateObligations.status, ["pending", "overdue"]))).orderBy(asc(preventionPdtpUpdateObligations.dueAt)),
  ])
  const matrixIds = matrices.map((item) => item.id)
  const entries = matrixIds.length ? await db.select({ entry: preventionRiskEntries, process: preventionRiskProcesses, task: preventionRiskTasks, position: preventionRiskPositions }).from(preventionRiskEntries).innerJoin(preventionRiskProcesses, eq(preventionRiskProcesses.id, preventionRiskEntries.processId)).innerJoin(preventionRiskTasks, eq(preventionRiskTasks.id, preventionRiskEntries.taskId)).innerJoin(preventionRiskPositions, eq(preventionRiskPositions.id, preventionRiskEntries.positionId)).where(inArray(preventionRiskEntries.matrixId, matrixIds)) : []
  const controls = entries.length ? await db.select().from(preventionRiskControls).where(inArray(preventionRiskControls.riskEntryId, entries.map((item) => item.entry.id))) : []
  const links = controls.length ? await db.select().from(preventionPdtpSourceLinks).where(and(eq(preventionPdtpSourceLinks.sourceType, "risk_control"), inArray(preventionPdtpSourceLinks.sourceId, controls.map((item) => item.id)), eq(preventionPdtpSourceLinks.isActive, true))) : []
  const controlByEntry = new Map<string, typeof controls>()
  for (const control of controls) controlByEntry.set(control.riskEntryId, [...(controlByEntry.get(control.riskEntryId) ?? []), control])
  const linkedControlIds = new Set(links.map((item) => item.sourceId))
  const publishedIds = new Set<string>()
  for (const matrix of matrices) {
    if (matrix.status === "published") publishedIds.add(matrix.id)
  }
  const criticalBlockers = entries.filter(({ entry }) => {
    if (!publishedIds.has(entry.matrixId) || !entry.isCritical) return false
    const entryControls = controlByEntry.get(entry.id) ?? []
    return !entryControls.some((control) => control.isCritical && ["implemented", "verified"].includes(control.status))
      || !entryControls.some((control) => linkedControlIds.has(control.id))
  })
  const activePositions = processes.length ? await db.select({ id: preventionRiskPositions.id, processId: preventionRiskTasks.processId }).from(preventionRiskPositions).innerJoin(preventionRiskTasks, eq(preventionRiskTasks.id, preventionRiskPositions.taskId)).where(and(eq(preventionRiskPositions.isActive, true), inArray(preventionRiskTasks.processId, processes.map((item) => item.id)))) : []
  const publishedEntries = entries.filter((item) => publishedIds.has(item.entry.matrixId))
  return {
    worksites: visibleWorksites,
    methodologies,
    matrices,
    entries,
    controls,
    triggers,
    obligations,
    criticalBlockers,
    coverage: {
      activeProcesses: processes.length,
      coveredProcesses: new Set(publishedEntries.map((item) => item.entry.processId)).size,
      activePositions: activePositions.length,
      coveredPositions: new Set(publishedEntries.map((item) => item.entry.positionId)).size,
    },
  }
}

export async function getLegalDashboard(access: RiskLegalAccess) {
  requireAccess(access, "prevention:legal:view")
  const [requirements, visibleWorksites, processes, applicabilities] = await Promise.all([
    db.select().from(preventionLegalRequirements).orderBy(asc(preventionLegalRequirements.code), desc(preventionLegalRequirements.requirementVersion)),
    db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(and(eq(worksites.isActive, true), scopeCondition(access.scope, worksites.id))).orderBy(asc(worksites.name)),
    db.select({ id: preventionRiskProcesses.id, worksiteId: preventionRiskProcesses.worksiteId, name: preventionRiskProcesses.name }).from(preventionRiskProcesses).where(and(eq(preventionRiskProcesses.isActive, true), scopeCondition(access.scope, preventionRiskProcesses.worksiteId))).orderBy(asc(preventionRiskProcesses.name)),
    db.select({ applicability: preventionLegalApplicabilities, requirement: preventionLegalRequirements, worksiteName: worksites.name }).from(preventionLegalApplicabilities).innerJoin(preventionLegalRequirements, eq(preventionLegalRequirements.id, preventionLegalApplicabilities.requirementId)).innerJoin(worksites, eq(worksites.id, preventionLegalApplicabilities.worksiteId)).where(scopeCondition(access.scope, preventionLegalApplicabilities.worksiteId)).orderBy(asc(worksites.name), asc(preventionLegalRequirements.code)),
  ])
  const appIds = applicabilities.map((item) => item.applicability.id)
  const assessments = appIds.length ? await db.select().from(preventionLegalAssessments).where(inArray(preventionLegalAssessments.applicabilityId, appIds)).orderBy(desc(preventionLegalAssessments.assessedAt)) : []
  const gaps = applicabilities.filter(({ applicability }) => applicability.applicabilityStatus === "applicable" && (applicability.complianceStatus !== "compliant" || !applicability.evidenceReference))
  return { requirements, applicabilities, assessments, gaps, worksites: visibleWorksites, processes }
}

export async function getPdtpCoverage(programId: string, access: RiskLegalAccess) {
  requireAccess(access, "prevention:pdtp:view")
  await refreshPdtpUpdateObligationDeadlines()
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  const [
    activities,
    obligations,
    worksiteRows,
    riskSources,
    legalSources,
    capaSources,
    trainingSources,
    inspectionSources,
    cphsSources,
    eppSources,
    protocolSources,
    coordinationSources,
    emergencySources,
  ] = await Promise.all([
    db.select().from(pdtpActivities).where(eq(pdtpActivities.programId, programId)).orderBy(asc(pdtpActivities.n)),
    db.select().from(preventionPdtpUpdateObligations).where(and(scopeCondition(access.scope, preventionPdtpUpdateObligations.worksiteId), inArray(preventionPdtpUpdateObligations.status, ["pending", "overdue"]))).orderBy(asc(preventionPdtpUpdateObligations.dueAt)),
    db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(and(eq(worksites.isActive, true), scopeCondition(access.scope, worksites.id))).orderBy(asc(worksites.name)),
    db.select({
      id: preventionRiskControls.id,
      worksiteId: preventionRiskMatrices.worksiteId,
      hazard: preventionRiskEntries.hazard,
      description: preventionRiskControls.description,
    }).from(preventionRiskControls)
      .innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskControls.riskEntryId))
      .innerJoin(preventionRiskMatrices, eq(preventionRiskMatrices.id, preventionRiskEntries.matrixId))
      .where(and(eq(preventionRiskMatrices.status, "published"), scopeCondition(access.scope, preventionRiskMatrices.worksiteId)))
      .orderBy(asc(preventionRiskEntries.hazard)),
    db.select({
      id: preventionLegalRequirements.id,
      worksiteId: preventionLegalApplicabilities.worksiteId,
      code: preventionLegalRequirements.code,
      article: preventionLegalRequirements.article,
    }).from(preventionLegalApplicabilities)
      .innerJoin(preventionLegalRequirements, eq(preventionLegalRequirements.id, preventionLegalApplicabilities.requirementId))
      .where(and(eq(preventionLegalApplicabilities.applicabilityStatus, "applicable"), eq(preventionLegalRequirements.status, "published"), scopeCondition(access.scope, preventionLegalApplicabilities.worksiteId)))
      .orderBy(asc(preventionLegalRequirements.code)),
    db.select({
      id: preventionCapaActions.id,
      worksiteId: preventionCapaActions.worksiteId,
      code: preventionCapaActions.code,
      finding: preventionCapaActions.finding,
    }).from(preventionCapaActions)
      .where(and(scopeCondition(access.scope, preventionCapaActions.worksiteId), ne(preventionCapaActions.status, "cancelled")))
      .orderBy(asc(preventionCapaActions.code)),
    db.select({
      id: preventionTrainingSessions.id,
      worksiteId: preventionTrainingSessions.worksiteId,
      code: preventionTrainingSessions.code,
      courseName: preventionTrainingCourses.name,
    }).from(preventionTrainingSessions)
      .innerJoin(preventionTrainingCourseVersions, eq(preventionTrainingCourseVersions.id, preventionTrainingSessions.courseVersionId))
      .innerJoin(preventionTrainingCourses, eq(preventionTrainingCourses.id, preventionTrainingCourseVersions.courseId))
      .where(and(scopeCondition(access.scope, preventionTrainingSessions.worksiteId), ne(preventionTrainingSessions.status, "cancelled")))
      .orderBy(asc(preventionTrainingSessions.code)),
    db.select({
      id: preventionInspectionRuns.id,
      worksiteId: preventionInspectionRuns.worksiteId,
      code: preventionInspectionRuns.code,
      templateName: preventionInspectionTemplates.name,
      // Se trae el kind para partir el resultado en dos desplegables sin pagar
      // una segunda consulta: las auditorías del SGSST no son inspecciones.
      templateKind: preventionInspectionTemplates.kind,
      subjectLabel: preventionInspectionRuns.subjectLabel,
    }).from(preventionInspectionRuns)
      .innerJoin(preventionInspectionTemplates, eq(preventionInspectionTemplates.id, preventionInspectionRuns.templateId))
      .where(and(scopeCondition(access.scope, preventionInspectionRuns.worksiteId), ne(preventionInspectionRuns.status, "cancelled")))
      .orderBy(asc(preventionInspectionRuns.code)),
    db.select({
      id: preventionCommittees.id,
      worksiteId: preventionCommittees.worksiteId,
      name: preventionCommittees.name,
    }).from(preventionCommittees)
      .where(and(scopeCondition(access.scope, preventionCommittees.worksiteId), eq(preventionCommittees.status, "active")))
      .orderBy(asc(preventionCommittees.name)),
    db.select({
      id: preventionEppRequirements.id,
      worksiteId: preventionEppRequirements.worksiteId,
      typeLabel: eppTypes.label,
      reason: preventionEppRequirements.reason,
    }).from(preventionEppRequirements)
      .innerJoin(eppTypes, eq(eppTypes.id, preventionEppRequirements.eppTypeId))
      .where(and(
        isNotNull(preventionEppRequirements.worksiteId),
        scopeCondition(access.scope, preventionEppRequirements.worksiteId),
        eq(preventionEppRequirements.isActive, true),
      ))
      .orderBy(asc(eppTypes.label)),
    db.select({
      id: preventionProtocolApplicabilities.id,
      worksiteId: preventionProtocolApplicabilities.worksiteId,
      protocolCode: preventionProtocolApplicabilities.protocolCode,
    }).from(preventionProtocolApplicabilities)
      .where(and(scopeCondition(access.scope, preventionProtocolApplicabilities.worksiteId), eq(preventionProtocolApplicabilities.status, "applicable")))
      .orderBy(asc(preventionProtocolApplicabilities.protocolCode)),
    db.select({
      id: preventionExternalEngagements.id,
      worksiteId: preventionExternalEngagements.worksiteId,
      code: preventionExternalEngagements.code,
      subject: preventionExternalEngagements.subject,
    }).from(preventionExternalEngagements)
      .where(and(scopeCondition(access.scope, preventionExternalEngagements.worksiteId), eq(preventionExternalEngagements.kind, "coordinacion")))
      .orderBy(desc(preventionExternalEngagements.occurredOn)),
    db.select({
      id: preventionEmergencyPlans.id,
      worksiteId: preventionEmergencyPlans.worksiteId,
      code: preventionEmergencyPlans.code,
      title: preventionEmergencyPlans.title,
    }).from(preventionEmergencyPlans)
      .where(and(scopeCondition(access.scope, preventionEmergencyPlans.worksiteId), eq(preventionEmergencyPlans.status, "approved")))
      .orderBy(asc(preventionEmergencyPlans.code)),
  ])
  const activityIds = activities.map((item) => item.id)
  const links = activityIds.length ? await db.select().from(preventionPdtpSourceLinks).where(and(inArray(preventionPdtpSourceLinks.activityId, activityIds), eq(preventionPdtpSourceLinks.isActive, true), scopeCondition(access.scope, preventionPdtpSourceLinks.worksiteId))).orderBy(asc(preventionPdtpSourceLinks.createdAt)) : []
  const linksByActivity = new Map<string, typeof links>()
  for (const link of links) linksByActivity.set(link.activityId, [...(linksByActivity.get(link.activityId) ?? []), link])
  return {
    program,
    activities: activities.map((activity) => ({ ...activity, sources: linksByActivity.get(activity.id) ?? [] })),
    obligations,
    worksites: worksiteRows,
    sourceOptions: {
      riskControls: riskSources.map((item) => ({ id: item.id, worksiteId: item.worksiteId, label: `${item.hazard} · ${item.description}` })),
      legalRequirements: legalSources.map((item) => ({ id: item.id, worksiteId: item.worksiteId, label: `${item.code} · ${item.article}` })),
      capaActions: capaSources.map((item) => ({ id: item.id, worksiteId: item.worksiteId, label: `${item.code} · ${item.finding}` })),
      trainingSessions: trainingSources.map((item) => ({ id: item.id, worksiteId: item.worksiteId, label: `${item.code} · ${item.courseName}` })),
      inspectionRuns: inspectionSources.flatMap((item) => item.templateKind === "audit" ? [] : [{ id: item.id, worksiteId: item.worksiteId, label: `${item.code} · ${item.templateName}${item.subjectLabel ? ` · ${item.subjectLabel}` : ""}` }]),
      audits: inspectionSources.flatMap((item) => item.templateKind === "audit" ? [{ id: item.id, worksiteId: item.worksiteId, label: `${item.code} · ${item.templateName}` }] : []),
      committees: cphsSources.map((item) => ({ id: item.id, worksiteId: item.worksiteId, label: item.name })),
      eppRequirements: eppSources.map((item) => ({ id: item.id, worksiteId: item.worksiteId as string, label: `${item.typeLabel} · ${item.reason}` })),
      emergencyPlans: emergencySources.map((item) => ({ id: item.id, worksiteId: item.worksiteId, label: `${item.code} · ${item.title}` })),
      minsalProtocols: protocolSources.map((item) => ({ id: item.id, worksiteId: item.worksiteId, label: MINSAL_PROTOCOL_LABELS[item.protocolCode] ?? item.protocolCode })),
      coordinations: coordinationSources.map((item) => ({ id: item.id, worksiteId: item.worksiteId, label: `${item.code} · ${item.subject}` })),
    },
    coverage: {
      totalActivities: activities.length,
      sourcedActivities: activities.filter((item) => (linksByActivity.get(item.id)?.length ?? 0) > 0).length,
      unsourcedActivities: activities.filter((item) => (linksByActivity.get(item.id)?.length ?? 0) === 0).length,
      pendingUpdates: obligations.length,
    },
  }
}

export async function getPublishedRiskMatrix(matrixId: string, access: RiskLegalAccess) {
  requireAccess(access, "prevention:risk:view")
  const [matrix] = await db.select({ matrix: preventionRiskMatrices, worksiteName: worksites.name }).from(preventionRiskMatrices).innerJoin(worksites, eq(worksites.id, preventionRiskMatrices.worksiteId)).where(and(eq(preventionRiskMatrices.id, matrixId), inArray(preventionRiskMatrices.status, ["published", "superseded"]))).limit(1)
  if (!matrix || !scopeAllows(access.scope, matrix.matrix.worksiteId)) throw new Error("MIPER no encontrada o fuera de alcance.")
  const entries = await db.select({ entry: preventionRiskEntries, process: preventionRiskProcesses, task: preventionRiskTasks, position: preventionRiskPositions }).from(preventionRiskEntries).innerJoin(preventionRiskProcesses, eq(preventionRiskProcesses.id, preventionRiskEntries.processId)).innerJoin(preventionRiskTasks, eq(preventionRiskTasks.id, preventionRiskEntries.taskId)).innerJoin(preventionRiskPositions, eq(preventionRiskPositions.id, preventionRiskEntries.positionId)).where(eq(preventionRiskEntries.matrixId, matrixId)).orderBy(asc(preventionRiskProcesses.name), asc(preventionRiskTasks.name), asc(preventionRiskPositions.name), asc(preventionRiskEntries.hazardCode))
  const controls = entries.length ? await db.select().from(preventionRiskControls).where(inArray(preventionRiskControls.riskEntryId, entries.map((item) => item.entry.id))).orderBy(asc(preventionRiskControls.createdAt)) : []
  const triggers = await db.select().from(preventionRiskReviewTriggers).where(eq(preventionRiskReviewTriggers.matrixId, matrixId)).orderBy(desc(preventionRiskReviewTriggers.createdAt))
  return { ...matrix, entries, controls, triggers }
}

export async function getRiskControlDetail(controlId: string, access: RiskLegalAccess) {
  if (!access.permissions.includes("prevention:risk:view") && !access.permissions.includes("prevention:pdtp:view")) throw new Error("Control MIPER no encontrado o fuera de alcance.")
  const [row] = await db.select({
    control: preventionRiskControls,
    entry: preventionRiskEntries,
    matrix: preventionRiskMatrices,
    process: preventionRiskProcesses,
    task: preventionRiskTasks,
    position: preventionRiskPositions,
    worksiteName: worksites.name,
  }).from(preventionRiskControls)
    .innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskControls.riskEntryId))
    .innerJoin(preventionRiskMatrices, eq(preventionRiskMatrices.id, preventionRiskEntries.matrixId))
    .innerJoin(preventionRiskProcesses, eq(preventionRiskProcesses.id, preventionRiskEntries.processId))
    .innerJoin(preventionRiskTasks, eq(preventionRiskTasks.id, preventionRiskEntries.taskId))
    .innerJoin(preventionRiskPositions, eq(preventionRiskPositions.id, preventionRiskEntries.positionId))
    .innerJoin(worksites, eq(worksites.id, preventionRiskMatrices.worksiteId))
    .where(and(eq(preventionRiskControls.id, controlId), inArray(preventionRiskMatrices.status, ["published", "superseded"]))).limit(1)
  if (!row || !scopeAllows(access.scope, row.matrix.worksiteId)) throw new Error("Control MIPER no encontrado o fuera de alcance.")
  const links = await db.select().from(preventionPdtpSourceLinks).where(and(eq(preventionPdtpSourceLinks.sourceType, "risk_control"), eq(preventionPdtpSourceLinks.sourceId, controlId), eq(preventionPdtpSourceLinks.isActive, true)))
  return { ...row, links }
}

export async function getLegalRequirementDetail(requirementId: string, access: RiskLegalAccess) {
  if (!access.permissions.includes("prevention:legal:view") && !access.permissions.includes("prevention:pdtp:view")) throw new Error("Requisito legal no encontrado.")
  const [requirement] = await db.select().from(preventionLegalRequirements).where(and(eq(preventionLegalRequirements.id, requirementId), inArray(preventionLegalRequirements.status, ["published", "superseded"]))).limit(1)
  if (!requirement) throw new Error("Requisito legal no encontrado.")
  const applicabilities = await db.select({ applicability: preventionLegalApplicabilities, worksiteName: worksites.name }).from(preventionLegalApplicabilities).innerJoin(worksites, eq(worksites.id, preventionLegalApplicabilities.worksiteId)).where(and(eq(preventionLegalApplicabilities.requirementId, requirementId), scopeCondition(access.scope, preventionLegalApplicabilities.worksiteId))).orderBy(asc(worksites.name))
  const ids = applicabilities.map((item) => item.applicability.id)
  const assessments = ids.length ? await db.select().from(preventionLegalAssessments).where(inArray(preventionLegalAssessments.applicabilityId, ids)).orderBy(desc(preventionLegalAssessments.assessedAt)) : []
  const links = await db.select().from(preventionPdtpSourceLinks).where(and(eq(preventionPdtpSourceLinks.sourceType, "legal_requirement"), eq(preventionPdtpSourceLinks.sourceId, requirementId), eq(preventionPdtpSourceLinks.isActive, true), scopeCondition(access.scope, preventionPdtpSourceLinks.worksiteId)))
  return { requirement, applicabilities, assessments, links }
}
