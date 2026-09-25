import { createHash } from "node:crypto"
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, notInArray, or, sql } from "drizzle-orm"
import { z } from "zod"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { db, type DB, type Tx } from "@/db"
import { resolveOwnWorkSigning } from "@/lib/services/prevention-signing"
import {
  eppTypes,
  pdtpActivities,
  pdtpPrograms,
  preventionCapaActions,
  preventionCommitteeMeetings,
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
  preventionRiskMapMarkers,
  preventionRiskMatrices,
  preventionRiskMethodologies,
  preventionRiskPositions,
  preventionRiskProcesses,
  preventionRiskReviewTriggers,
  preventionRiskTasks,
  preventionTrainingCatalogItems,
  preventionTrainingOccurrences,
  users,
  worksites,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { onRiskMatrixPublished } from "@/lib/services/pdtp-adapters/pdtp-accreditation-connectors"
import { recordModuleHistory } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { LEGAL_COMPLIANCE_STATUS_LABELS, LEGAL_REQUIREMENT_STATUS_LABELS, RISK_MATRIX_STATUS_LABELS } from "@/lib/prevention/badges"
import { CAPA_STATUS_LABELS } from "@/lib/prevention/capa"
import { capaPriorityForCriticality } from "@/lib/prevention/inspections"
import { MINSAL_PROTOCOL_LABELS } from "@/lib/prevention/minsal-protocols"
import { createCapaActionWithClient, type CapaStatus } from "@/lib/services/prevention-capa"
import { addDaysToPlainDate, formatDate, todayInChile } from "@/lib/utils"
import {
  legalApplicabilityApprovalSchema,
  legalApplicabilityProposalSchema,
  legalComplianceAssessmentSchema,
  legalRequirementDraftSchema,
  legalRequirementTransitionSchema,
  pdtpObligationResolutionSchema,
  pdtpSourceLinkSchema,
  riskControlVerificationSchema,
  riskEntrySchema,
  riskMatrixDraftSchema,
  riskMatrixTransitionSchema,
  riskMethodologySchema,
  riskReviewTriggerSchema,
} from "@/lib/validation/prevention-module/risk-legal"
import { enqueueGeneratedDocumentTx } from "@/lib/services/generated-documents/enqueue"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"

export { RiskLegalDomainError } from "./prevention-risk-legal-errors"

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
    throw new RiskLegalDomainError("Registro preventivo no encontrado o fuera de alcance.")
  }
}

function scopeCondition(scope: WorksiteScope, column: AnyPgColumn) {
  if (scope.mode === "all") return undefined
  if (scope.mode === "none" || scope.ids.length === 0) return sql`false`
  return inArray(column, scope.ids)
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
  await recordModuleHistory(client, {
    module: `risk_legal:${args.domain}`,
    entityType: args.entityType,
    entityId: args.entityId,
    worksiteId: args.worksiteId ?? null,
    changeType: args.changeType,
    reason: args.reason,
    beforeState: args.beforeState,
    afterState: args.afterState,
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
  if (activeUsers.length !== uniqueIds.length) throw new RiskLegalDomainError("La persona responsable no existe o está inactiva.")
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
  if (!worksite || !methodology) throw new RiskLegalDomainError("Faena o metodología no encontrada.")

  let source: typeof preventionRiskMatrices.$inferSelect | null = null
  if (data.sourceMatrixId) {
    const sourceRows = await client.select().from(preventionRiskMatrices).where(and(eq(preventionRiskMatrices.id, data.sourceMatrixId), eq(preventionRiskMatrices.worksiteId, data.worksiteId), eq(preventionRiskMatrices.status, "published"))).limit(1)
    source = sourceRows[0] ?? null
    if (!source) throw new RiskLegalDomainError("La versión fuente no está publicada o está fuera de alcance.")
  }
  if (data.sourceImportBatchId) {
    const [batch] = await client.select().from(preventionRiskImportBatches).where(and(
      eq(preventionRiskImportBatches.id, data.sourceImportBatchId),
      eq(preventionRiskImportBatches.worksiteId, data.worksiteId),
      eq(preventionRiskImportBatches.status, "approved"),
    )).limit(1)
    if (!batch) throw new RiskLegalDomainError("El lote de importación no está aprobado o está fuera de alcance.")
  }
  /* MIPER-07: la sesión es la evidencia verificable de participación del CPHS,
   * así que se resuelve antes de escribirla (mismo criterio que
   * `addEmergencyRole`). La FK sólo garantiza que el id exista: sin esto una
   * matriz podía acreditarse con el acta de otra faena —la sesión cuelga del
   * comité, y el comité de la faena— o con una sesión cancelada, que es una
   * reunión que nunca ocurrió. Las 'scheduled' sí se admiten: la matriz se
   * prepara para la sesión que viene y el borrador se crea antes. */
  if (data.committeeMeetingId) {
    const [meeting] = await client.select({ id: preventionCommitteeMeetings.id })
      .from(preventionCommitteeMeetings)
      .innerJoin(preventionCommittees, eq(preventionCommittees.id, preventionCommitteeMeetings.committeeId))
      .where(and(
        eq(preventionCommitteeMeetings.id, data.committeeMeetingId),
        eq(preventionCommittees.worksiteId, data.worksiteId),
        ne(preventionCommitteeMeetings.status, "cancelled"),
      )).limit(1)
    if (!meeting) throw new RiskLegalDomainError("La sesión del comité no existe, es de otra faena o está cancelada.")
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
      if (current.name !== data.process.name) throw new RiskLegalDomainError(`El código de proceso ${data.process.code} ya existe con otro nombre.`)
      return current
    }
    const [created] = await client.insert(preventionRiskProcesses).values({ id: `riskprocess-${nanoid()}`, worksiteId, code: data.process.code, name: data.process.name, description: data.process.description ?? null }).returning()
    return created!
  }
  const process = await resolveProcess()
  const [existingTask] = await client.select().from(preventionRiskTasks).where(and(eq(preventionRiskTasks.processId, process.id), eq(preventionRiskTasks.code, data.task.code))).limit(1)
  const task = existingTask ?? (await client.insert(preventionRiskTasks).values({ id: `risktask-${nanoid()}`, processId: process.id, code: data.task.code, name: data.task.name, isRoutine: data.task.isRoutine }).returning())[0]!
  if (task.name !== data.task.name) throw new RiskLegalDomainError(`El código de tarea ${data.task.code} ya existe con otro nombre.`)
  const [existingPosition] = await client.select().from(preventionRiskPositions).where(and(eq(preventionRiskPositions.taskId, task.id), eq(preventionRiskPositions.code, data.position.code))).limit(1)
  const position = existingPosition ?? (await client.insert(preventionRiskPositions).values({ id: `riskposition-${nanoid()}`, taskId: task.id, code: data.position.code, name: data.position.name, workerPositionKey: data.position.workerPositionKey ?? null }).returning())[0]!
  if (position.name !== data.position.name) throw new RiskLegalDomainError(`El código de puesto ${data.position.code} ya existe con otro nombre.`)
  return { process, task, position }
}

export async function addRiskEntryWithClient(
  client: Client,
  input: unknown,
  access: RiskLegalAccess,
) {
  const data = riskEntrySchema.parse(input)
  const [matrix] = await client.select().from(preventionRiskMatrices).where(eq(preventionRiskMatrices.id, data.matrixId)).limit(1)
  if (!matrix) throw new RiskLegalDomainError("MIPER no encontrada o fuera de alcance.")
  requireAccess(access, "prevention:risk:edit", matrix.worksiteId)
  if (matrix.status !== "draft") throw new RiskLegalDomainError("Sólo una versión MIPER en borrador admite cambios.")
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
      /* Un control nace sin verificar. Antes bastaba mandar `status: 'verified'`
       * en el mismo payload que creaba el peligro para que el propio autor se
       * anotara como verificador, sin evidencia y sin segregación — el enum de
       * `riskControlSchema` ya no admite ese valor, y esto deja de derivarlo. */
      effectivenessStatus: "not_assessed",
      lastVerifiedByUserId: null,
      lastVerifiedAt: null,
      createdAt: now,
      updatedAt: now,
    }))).returning()
  await history(client, { domain: "risk", entityType: "entry", entityId: entry.id, worksiteId: matrix.worksiteId, changeType: "created", reason: "Peligro y controles agregados a versión borrador", afterState: { entry, controlIds: controls.map((item) => item.id) }, actorUserId: access.userId })
  return { entry, controls }
}

export async function addRiskEntry(input: unknown, access: RiskLegalAccess) {
  return db.transaction(async (tx) => addRiskEntryWithClient(tx, input, access))
}

export const MATRIX_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["in_review"],
  // MIPER-10: la máquina sólo avanzaba. Una versión enviada a revisión con un
  // peligro mal evaluado quedaba trabada: el revisor no podía devolverla y el
  // editor no podía tocarla (`addRiskEntry` exige 'draft'). El retorno es del
  // revisor, con motivo obligatorio como cualquier otra transición.
  in_review: ["reviewed", "draft"],
  reviewed: ["approved"],
  approved: ["published"],
}

/**
 * Permiso de cada paso, indexado por el estado al que se llega. Exportado
 * porque el recordatorio de firma pendiente necesita la misma respuesta desde
 * el otro lado —"esta matriz está en `reviewed`, ¿a quién hay que avisarle?"— y
 * duplicar el mapa lo dejaría desincronizado a la primera.
 */
export const MATRIX_PERMISSION: Record<string, string> = {
  draft: "prevention:risk:review",
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

/* MIPER-05: los marcadores del mapa de riesgos cuelgan de una fila concreta de
 * `prevention_risk_entries`, y publicar una revisión deja esa fila en una matriz
 * `superseded` — el plano del art. 62 seguía mostrando los peligros de una MIPER
 * que ya no rige.
 *
 * De las dos salidas posibles (resolver el marcador por identidad estable en vez
 * de por id de fila, o reapuntarlo al publicar) se eligió reapuntar: la
 * identidad del peligro ya está normalizada en la propia tabla —proceso, tarea,
 * puesto y código de peligro son el índice único
 * `prevention_risk_entries_matrix_identity_unique`—, así que basta un UPDATE al
 * publicar y se conserva la FK, que es lo que impide que un marcador quede
 * apuntando a la nada. Resolver por identidad en lectura habría exigido
 * denormalizar los cuatro campos en el marcador y perder esa garantía.
 *
 * El marcador cuyo peligro desapareció en la revisión se elimina: el mapa
 * refleja la MIPER vigente, y dejarlo sobre el plano afirma un riesgo que la
 * organización ya retiró. Queda en el historial con su ubicación por si hay que
 * reponerlo. */
async function repointRiskMapMarkers(
  client: Client,
  matrix: typeof preventionRiskMatrices.$inferSelect,
  supersededMatrixIds: string[],
  actorUserId: string,
) {
  if (supersededMatrixIds.length === 0) return
  const identity = (entry: { processId: string; taskId: string; positionId: string; hazardCode: string }) =>
    `${entry.processId}|${entry.taskId}|${entry.positionId}|${entry.hazardCode}`

  // Se parte por los marcadores, no por las entradas: lo normal es que no haya
  // ninguno y el resto del trabajo no llega a ocurrir.
  const markers = await client.select({
    markerId: preventionRiskMapMarkers.id,
    riskEntryId: preventionRiskMapMarkers.riskEntryId,
    label: preventionRiskMapMarkers.label,
    xPct: preventionRiskMapMarkers.xPct,
    yPct: preventionRiskMapMarkers.yPct,
    processId: preventionRiskEntries.processId,
    taskId: preventionRiskEntries.taskId,
    positionId: preventionRiskEntries.positionId,
    hazardCode: preventionRiskEntries.hazardCode,
    hazard: preventionRiskEntries.hazard,
  })
    .from(preventionRiskMapMarkers)
    .innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskMapMarkers.riskEntryId))
    .where(inArray(preventionRiskEntries.matrixId, supersededMatrixIds))
  if (markers.length === 0) return

  const replacements = await client.select({
    id: preventionRiskEntries.id,
    processId: preventionRiskEntries.processId,
    taskId: preventionRiskEntries.taskId,
    positionId: preventionRiskEntries.positionId,
    hazardCode: preventionRiskEntries.hazardCode,
  }).from(preventionRiskEntries).where(eq(preventionRiskEntries.matrixId, matrix.id))
  const replacementByIdentity = new Map(replacements.map((entry) => [identity(entry), entry.id]))

  for (const marker of markers) {
    const replacement = replacementByIdentity.get(identity(marker))
    if (replacement) {
      await client.update(preventionRiskMapMarkers)
        .set({ riskEntryId: replacement })
        .where(eq(preventionRiskMapMarkers.id, marker.markerId))
      continue
    }
    await client.delete(preventionRiskMapMarkers).where(eq(preventionRiskMapMarkers.id, marker.markerId))
    await history(client, {
      domain: "risk",
      entityType: "risk_map_marker",
      entityId: marker.markerId,
      worksiteId: matrix.worksiteId,
      changeType: "orphaned",
      reason: `El peligro "${marker.hazard}" (${marker.hazardCode}) no existe en la MIPER v${matrix.matrixVersion}; se retiró su marcador del plano.`,
      beforeState: { riskEntryId: marker.riskEntryId, label: marker.label, xPct: marker.xPct, yPct: marker.yPct, hazardCode: marker.hazardCode },
      actorUserId,
    })
  }
}

export async function transitionRiskMatrix(input: unknown, access: RiskLegalAccess) {
  const data = riskMatrixTransitionSchema.parse(input)
  let accreditation: Parameters<typeof onRiskMatrixPublished>[0] | null = null
  const result = await db.transaction(async (tx) => {
    const [matrix] = await tx.select().from(preventionRiskMatrices).where(eq(preventionRiskMatrices.id, data.matrixId)).limit(1)
    if (!matrix) throw new RiskLegalDomainError("MIPER no encontrada o fuera de alcance.")
    requireAccess(access, MATRIX_PERMISSION[data.toStatus]!, matrix.worksiteId)
    if (!MATRIX_TRANSITIONS[matrix.status]?.includes(data.toStatus)) throw new RiskLegalDomainError(`La MIPER no puede pasar de «${RISK_MATRIX_STATUS_LABELS[matrix.status] ?? matrix.status}» a «${RISK_MATRIX_STATUS_LABELS[data.toStatus] ?? data.toStatus}»; recarga para ver su estado actual.`)
    if (matrix.version !== data.expectedVersion) throw new RiskLegalDomainError("La MIPER cambió mientras la revisabas. Recarga antes de continuar.")
    if (data.toStatus === "in_review") {
      const countRows = await tx.select({ count: sql<number>`count(*)::int` }).from(preventionRiskEntries).where(eq(preventionRiskEntries.matrixId, matrix.id))
      if (!countRows[0]?.count) throw new RiskLegalDomainError("Una MIPER sin peligros no puede enviarse a revisión.")
    }
    if (data.toStatus === "reviewed" && matrix.createdByUserId === access.userId) throw new RiskLegalDomainError("Quien creó la versión MIPER no puede revisarla.")
    if (data.toStatus === "approved" && (matrix.createdByUserId === access.userId || matrix.reviewedByUserId === access.userId)) throw new RiskLegalDomainError("La aprobación MIPER debe estar segregada de creación y revisión.")
    /* Publicar es la cuarta firma y hasta ahora no comprobaba nada: la separaba
     * sólo el reparto de permisos, y eso deja de bastar en cuanto un rol tiene
     * `risk:edit` y `risk:publish` a la vez. La jefatura técnica del área queda
     * exenta —responde por el contenido de la matriz— y la excepción es un
     * permiso otorgado a la vista, no un nombre de rol escondido acá. */
    /* INC-002: además de decidir, deja constancia. La excepción por cargo se
     * ejercía sin distinguirse de una firma con dos personas. */
    const signing = resolveOwnWorkSigning({
      signedByUserId: data.toStatus === "published" ? matrix.approvedByUserId : null,
      actorUserId: access.userId,
      permissions: access.permissions,
      what: "Publicar la versión de la MIPER",
    })
    if (!signing.ok) {
      throw new RiskLegalDomainError("Quien aprobó la versión de la MIPER no puede publicarla: debe firmarla otra persona.")
    }
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
      await repointRiskMapMarkers(tx, matrix, previousPublished.map((previous) => previous.id), access.userId)
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
    if (!updated) throw new RiskLegalDomainError("La MIPER cambió mientras la revisabas. Recarga antes de continuar.")
    await history(tx, { domain: "risk", entityType: "matrix", entityId: matrix.id, worksiteId: matrix.worksiteId, changeType: data.toStatus, reason: signing.usedException ? `${data.reason ?? ""} [Firma propia: publicada por quien la aprobó, con la excepción prevention:sign_own_work.]`.trim() : data.reason, beforeState: { status: matrix.status, version: matrix.version }, afterState: { status: updated.status, version: updated.version, sourceHash, ownWorkExceptionUsed: signing.usedException }, actorUserId: access.userId })
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

      // N°35 del PDTP. Se prepara acá y se dispara DESPUÉS del commit: el motor
      // escribe con su propia conexión, así que llamarlo dentro dejaría una
      // ejecución huérfana si la transacción revierte.
      const entries = await tx.select({ id: preventionRiskEntries.id }).from(preventionRiskEntries)
        .where(eq(preventionRiskEntries.matrixId, matrix.id))
      accreditation = {
        matrixId: matrix.id,
        worksiteId: matrix.worksiteId,
        matrixVersion: matrix.matrixVersion,
        publishedAt: updated.publishedAt ?? now,
        entryCount: entries.length,
      }

      // La matriz publicada queda en Cloudreve. Cada versión es su propia fila
      // de matriz, así que no hace falta revisión aparte.
      await enqueueGeneratedDocumentTx(tx, {
        kind: "miper",
        entityId: matrix.id,
        milestone: "publicada",
        worksiteId: matrix.worksiteId,
        occurredAt: updated.publishedAt ?? now,
        actorUserId: access.userId,
      })
    }
    return updated
  })

  if (accreditation) await onRiskMatrixPublished(accreditation)
  return result
}

/**
 * MIPER-08 · Verificación segregada de un control.
 *
 * Antes el único camino a `status: 'verified'` era el propio payload que creaba
 * el peligro: el autor se declaraba verificador, sin evidencia y sin que nadie
 * más lo mirara. Un control crítico verificado así es exactamente lo que un
 * fiscalizador no puede aceptar.
 *
 * La regla es la de `assertCapaTransition` (lib/services/prevention-capa.ts):
 * el actor no puede ser ninguna de las personas comprometidas con el control, y
 * la única salida es el permiso de override más un motivo fundamentado que
 * queda persistido en el historial. "Autor" del control es quien creó la versión
 * MIPER donde vive — la tabla de controles no guarda autor propio, y quien firmó
 * la versión es quien respondió por su contenido.
 */
export async function verifyRiskControl(input: unknown, access: RiskLegalAccess) {
  const data = riskControlVerificationSchema.parse(input)
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ control: preventionRiskControls, entry: preventionRiskEntries, matrix: preventionRiskMatrices })
      .from(preventionRiskControls)
      .innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskControls.riskEntryId))
      .innerJoin(preventionRiskMatrices, eq(preventionRiskMatrices.id, preventionRiskEntries.matrixId))
      .where(eq(preventionRiskControls.id, data.controlId)).limit(1)
    if (!row) throw new RiskLegalDomainError("Control MIPER no encontrado o fuera de alcance.")
    requireAccess(access, "prevention:risk:edit", row.matrix.worksiteId)
    // Sólo se verifica lo que rige: un control de un borrador o de una versión
    // reemplazada no es una medida operativa que se pueda ir a mirar a terreno.
    if (row.matrix.status !== "published") throw new RiskLegalDomainError("Sólo se verifica un control de la MIPER vigente.")
    if (row.control.status === "retired") throw new RiskLegalDomainError("Un control retirado no se verifica.")
    if (row.control.version !== data.expectedVersion) throw new RiskLegalDomainError("El control cambió mientras lo verificabas. Recarga antes de continuar.")

    const conflicted = [row.matrix.createdByUserId, row.control.responsibleUserId, row.entry.responsibleUserId].includes(access.userId)
    if (conflicted) {
      const canOverride = access.permissions.includes("prevention:risk:override_segregation")
      if (!canOverride || (data.segregationExceptionReason?.trim().length ?? 0) < 10) {
        throw new RiskLegalDomainError("La verificación debe hacerla una persona distinta de quien creó la versión MIPER o responde por el control.")
      }
    }

    const now = new Date().toISOString()
    const status = data.effectivenessStatus === "effective" ? "verified" : "ineffective"
    const [updated] = await tx.update(preventionRiskControls).set({
      status,
      effectivenessStatus: data.effectivenessStatus,
      evidenceReference: data.evidenceReference,
      lastVerifiedByUserId: access.userId,
      lastVerifiedAt: now,
      version: row.control.version + 1,
      updatedAt: now,
    }).where(and(eq(preventionRiskControls.id, row.control.id), eq(preventionRiskControls.version, data.expectedVersion))).returning()
    if (!updated) throw new RiskLegalDomainError("El control cambió mientras lo verificabas. Recarga antes de continuar.")
    // El control es hijo del peligro: se bumpea el padre. La matriz NO — su
    // `version` es el candado del workflow y su `publishedHashSha256` congela el
    // contenido al publicar; la verificación es operación posterior, no un
    // cambio del texto publicado.
    await tx.update(preventionRiskEntries).set({ version: sql`${preventionRiskEntries.version} + 1`, updatedAt: now })
      .where(eq(preventionRiskEntries.id, row.entry.id))

    if (data.effectivenessStatus === "ineffective") {
      /*
       * E2E-005 (auditoría 2026-09-14): un control **crítico** declarado
       * ineficaz no abría acción correctiva. Sólo se creaba el disparador de
       * revisión de la MIPER a 30 días que sigue más abajo, y ese recordatorio
       * vive únicamente en el tablero de MIPER (MIP-001: no llega a ninguna
       * cola transversal). Es decir: un hallazgo de inspección de criticidad
       * alta abría CAPA y la falla del control con que la organización declara
       * "este riesgo está controlado", no. El valor `risk` del enum de orígenes
       * de CAPA existía sin un solo escritor.
       *
       * La CAPA se abre acá, en la misma transacción de la verificación: si la
       * verificación revierte, no queda una acción huérfana. La prioridad y el
       * plazo salen de `capaPriorityForCriticality` aplicada al nivel de riesgo
       * RESIDUAL del peligro —las dos escalas son el mismo vocabulario de
       * cuatro niveles (`lib/prevention/risk-levels`)—, así que no se inventa
       * una tabla de plazos nueva.
       *
       * DECISIONES DE PRODUCTO PENDIENTES, deliberadamente NO tomadas acá:
       *  1. Sólo se abre CAPA para un control marcado como crítico, que es lo
       *     que sanciona el hallazgo ("un control crítico verificado como
       *     ineficaz"). Si un control NO crítico ineficaz también debe abrirla,
       *     es una decisión de la organización y no está declarada en ninguna
       *     parte de la plataforma.
       *  2. La acción nace SIN responsable (`reconciliationStatus:
       *     needs_assignment`, el mecanismo que el propio módulo usa para "falta
       *     asignar"). No se hereda el responsable del control ni el del
       *     peligro: quién debe responder por la falla de un control es una
       *     decisión de la organización, y además `createCapaActionWithClient`
       *     rechaza un responsable inactivo, con lo que heredarlo podría
       *     impedir registrar la verificación misma.
       *  3. No se marca `requiresImmediateStop`. La detención de la tarea en
       *     terreno es una decisión operativa con consecuencias inmediatas que
       *     ningún documento de la plataforma delega en este automatismo.
       */
      if (row.control.isCritical) {
        const { priority, dueInDays } = capaPriorityForCriticality(row.entry.residualLevel)
        await createCapaActionWithClient(tx, {
          sourceType: "risk",
          sourceId: row.control.id,
          // Idempotencia por evento de verificación, con la misma forma que la
          // clave del disparador de revisión: una re-verificación posterior que
          // vuelva a salir ineficaz es una falla nueva y abre su propia acción,
          // pero el mismo evento no puede duplicarse
          // (índice único `prevention_capa_source_item_unique`).
          sourceItemId: `risk_control:${row.control.id}:v${updated.version}`,
          worksiteId: row.matrix.worksiteId,
          finding: `Control crítico "${row.control.description}" verificado como ineficaz (peligro: ${row.entry.hazard}).`.slice(0, 3000),
          actionDescription: `Determinar la causa de la ineficacia y reponer un control eficaz para el peligro "${row.entry.hazard}".`.slice(0, 3000),
          responsibleUserId: null,
          responsibleSnapshot: row.control.responsibleSnapshot,
          priority,
          targetDate: addDays(todayInChile(), dueInDays),
          evidenceRequired: true,
          rootCause: data.verificationNote,
          sourceRef: { riskEntryId: row.entry.id, matrixId: row.matrix.id, controlVersion: updated.version },
        }, access.userId)
      }

      await createRiskReviewTriggerWithClient(tx, {
        worksiteId: row.matrix.worksiteId,
        matrixId: row.matrix.id,
        triggerType: "critical_control_failure",
        sourceType: "risk_control",
        sourceId: row.control.id,
        description: `Control "${row.control.description}" verificado como ineficaz: ${data.verificationNote}`.slice(0, 3000),
        dueAt: addDays(todayInChile(), 30),
        idempotencyKey: `miper:control_ineffective:${row.control.id}:${updated.version}`,
      }, access.userId)
    }

    await history(tx, {
      domain: "risk",
      entityType: "control",
      entityId: row.control.id,
      worksiteId: row.matrix.worksiteId,
      changeType: status,
      reason: data.verificationNote,
      beforeState: { status: row.control.status, version: row.control.version, effectivenessStatus: row.control.effectivenessStatus, evidenceReference: row.control.evidenceReference },
      afterState: {
        status: updated.status,
        version: updated.version,
        effectivenessStatus: updated.effectivenessStatus,
        evidenceReference: updated.evidenceReference,
        segregationExceptionReason: conflicted ? data.segregationExceptionReason!.trim() : null,
      },
      actorUserId: access.userId,
    })
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
    if (!trigger) throw new RiskLegalDomainError("Tarea de revisión no encontrada o fuera de alcance.")
    requireAccess(access, "prevention:risk:review", trigger.worksiteId)
    const [matrix] = await tx.select().from(preventionRiskMatrices).where(and(eq(preventionRiskMatrices.id, data.matrixId), eq(preventionRiskMatrices.worksiteId, trigger.worksiteId), eq(preventionRiskMatrices.status, "published"))).limit(1)
    if (!matrix || !matrix.publishedAt || new Date(matrix.publishedAt) < new Date(trigger.createdAt)) throw new RiskLegalDomainError("La tarea sólo se completa con una versión MIPER publicada después del disparador.")
    const now = new Date().toISOString()
    const [updated] = await tx.update(preventionRiskReviewTriggers).set({ status: "completed", matrixId: matrix.id, resolvedByUserId: access.userId, resolvedAt: now, resolution: data.resolution }).where(and(eq(preventionRiskReviewTriggers.id, trigger.id), inArray(preventionRiskReviewTriggers.status, ["pending", "in_progress"]))).returning()
    if (!updated) throw new RiskLegalDomainError("La tarea de revisión ya fue resuelta.")
    await history(tx, { domain: "risk", entityType: "review_trigger", entityId: trigger.id, worksiteId: trigger.worksiteId, changeType: "completed", reason: data.resolution, beforeState: trigger, afterState: updated, actorUserId: access.userId })
    return updated
  })
}

/* ── Vigencia del requisito legal (LEGAL-01 / LEGAL-03) ─────────────────────
 * `status`, `valid_from` y `valid_to` se guardaban y se exportaban, pero
 * ninguna consulta los miraba: una obligación derogada —o la versión anterior
 * de una que se acaba de enmendar— seguía contando como aplicable y como
 * brecha, así que el tablero de cumplimiento medía contra textos que ya no
 * rigen.
 *
 * Vigente = publicado Y dentro de su ventana, medida en el día civil chileno.
 * `valid_to` es inclusive: quien escribe "vigente hasta el 31" cuenta ese día.
 * La supersesión automática (LEGAL-02) no depende de este borde porque cambia
 * el estado, y el `valid_to` que ella fija es la fecha en que entra a regir el
 * reemplazo. Una sola definición, en dos formas —SQL para las consultas, JS
 * para lo ya cargado en memoria— para que no puedan divergir. */
/**
 * Un requisito rige por su **ventana de vigencia**, no sólo por su estado.
 *
 * `superseded` cuenta mientras su `validTo` no haya pasado: publicar una enmienda
 * con anticipación es lo normal (la norma se dicta hoy y entra en vigor el mes
 * que viene), y al superar la versión anterior en el acto de publicar quedaba una
 * ventana muerta en la que el artículo no regía por ninguna de las dos filas —
 * `counts.applicable` caía y `proposeLegalApplicability` rechazaba ambas.
 * `valid_to` es, como dice la supersesión, "la fecha en que el texto dejó de
 * regir": el día anterior a la entrada en vigor de su reemplazo. No hay traslape.
 */
export function isLegalRequirementInForce(
  requirement: Pick<typeof preventionLegalRequirements.$inferSelect, "status" | "validFrom" | "validTo">,
  today: string = todayInChile(),
) {
  if (requirement.status !== "published" && requirement.status !== "superseded") return false
  if (requirement.validFrom > today) return false
  if (requirement.status === "superseded" && !requirement.validTo) return false
  return !requirement.validTo || requirement.validTo >= today
}

function legalRequirementInForceCondition(today: string = todayInChile()) {
  return and(
    or(
      eq(preventionLegalRequirements.status, "published"),
      and(
        eq(preventionLegalRequirements.status, "superseded"),
        isNotNull(preventionLegalRequirements.validTo),
      ),
    ),
    lte(preventionLegalRequirements.validFrom, today),
    or(isNull(preventionLegalRequirements.validTo), gte(preventionLegalRequirements.validTo, today)),
  )
}

/**
 * Por qué una aplicabilidad aplicable es brecha, o null si no lo es (LEGAL-06).
 *
 * Antes bastaba `complianceStatus !== 'compliant' || !evidenceReference`, así
 * que la fecha de re-evaluación y la de vencimiento de la evidencia se
 * guardaban, se exportaban y no tenían efecto: una aplicabilidad declarada
 * cumplida en 2025 con re-evaluación comprometida para marzo seguía contando
 * como cumplida hoy. Una evaluación con plazo vencido es una afirmación sin
 * respaldo actual, que es exactamente lo que un fiscalizador viene a mirar.
 */
function legalGapReason(
  applicability: typeof preventionLegalApplicabilities.$inferSelect,
  latestAssessment: typeof preventionLegalAssessments.$inferSelect | undefined,
  today: string,
): string | null {
  if (applicability.complianceStatus !== "compliant") {
    return LEGAL_COMPLIANCE_STATUS_LABELS[applicability.complianceStatus] ?? applicability.complianceStatus
  }
  if (!applicability.evidenceReference) return "Cumple sin evidencia registrada"
  if (applicability.evidenceDueAt && applicability.evidenceDueAt < today) return `Evidencia vencida el ${formatDate(applicability.evidenceDueAt)}`
  if (latestAssessment?.nextAssessmentAt && latestAssessment.nextAssessmentAt < today) return `Re-evaluación vencida el ${formatDate(latestAssessment.nextAssessmentAt)}`
  return null
}

export async function createLegalRequirementDraft(input: unknown, access: RiskLegalAccess) {
  requireAccess(access, "prevention:legal:assess")
  const data = legalRequirementDraftSchema.parse(input)
  return db.transaction(async (tx) => {
    let source: typeof preventionLegalRequirements.$inferSelect | null = null
    if (data.sourceRequirementId) {
      const sourceRows = await tx.select().from(preventionLegalRequirements).where(and(eq(preventionLegalRequirements.id, data.sourceRequirementId), eq(preventionLegalRequirements.status, "published"))).limit(1)
      source = sourceRows[0] ?? null
      if (!source) throw new RiskLegalDomainError("El requisito fuente no está publicado.")
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
    if (!requirement) throw new RiskLegalDomainError("Requisito legal no encontrado.")
    requireAccess(access, LEGAL_PERMISSION[data.toStatus]!)
    if (!LEGAL_TRANSITIONS[requirement.status]?.includes(data.toStatus)) throw new RiskLegalDomainError(`El requisito legal no puede pasar de «${LEGAL_REQUIREMENT_STATUS_LABELS[requirement.status] ?? requirement.status}» a «${LEGAL_REQUIREMENT_STATUS_LABELS[data.toStatus] ?? data.toStatus}»; recarga para ver su estado actual.`)
    if (requirement.version !== data.expectedVersion) throw new RiskLegalDomainError("El requisito cambió mientras lo revisabas.")
    if (data.toStatus === "reviewed" && requirement.createdByUserId === access.userId) throw new RiskLegalDomainError("Quien creó el requisito no puede revisarlo.")
    if (data.toStatus === "approved" && (requirement.createdByUserId === access.userId || requirement.reviewedByUserId === access.userId)) throw new RiskLegalDomainError("La aprobación legal debe estar segregada de creación y revisión.")
    const now = new Date().toISOString()
    const updates: Partial<typeof preventionLegalRequirements.$inferInsert> = { status: data.toStatus, version: requirement.version + 1, updatedAt: now }
    if (data.toStatus === "reviewed") Object.assign(updates, { reviewedByUserId: access.userId, reviewedAt: now })
    if (data.toStatus === "approved") Object.assign(updates, { approvedByUserId: access.userId, approvedAt: now })
    if (data.toStatus === "published") {
      const hash = sha256({ code: requirement.code, requirementVersion: requirement.requirementVersion, sourceReference: requirement.sourceReference, article: requirement.article, requirement: requirement.requirement, versionLabel: requirement.versionLabel, validFrom: requirement.validFrom, validTo: requirement.validTo })
      Object.assign(updates, { publishedHashSha256: hash, publishedByUserId: access.userId, publishedAt: now })
      /* Supersesión automática (LEGAL-02). Antes sólo se superaba el requisito
       * enlazado por `supersedesRequirementId`, y la UI nunca lo envía: una v2
       * publicada dejaba a la v1 vigente y el registro afirmaba dos textos
       * contradictorios para el mismo artículo. Se reemplaza a toda versión
       * publicada del mismo código —el enlace explícito se conserva porque
       * puede apuntar a otro código (renumeración normativa)—, bloqueando la
       * fila con FOR UPDATE dentro de esta misma transacción, como hace
       * `publishDocumentVersion`. El índice parcial
       * `prevention_legal_requirements_one_published_code_unique` es la red. */
      const supersedeTargets = [eq(preventionLegalRequirements.code, requirement.code)]
      if (requirement.supersedesRequirementId) supersedeTargets.push(eq(preventionLegalRequirements.id, requirement.supersedesRequirementId))
      const previousPublished = await tx.select().from(preventionLegalRequirements).where(and(
        eq(preventionLegalRequirements.status, "published"),
        ne(preventionLegalRequirements.id, requirement.id),
        or(...supersedeTargets),
      )).for("update")
      for (const previous of previousPublished) {
        const [superseded] = await tx.update(preventionLegalRequirements)
          // `valid_to` sólo se cierra si nadie lo fijó: es el último día en que el
          // texto rigió, o sea el **anterior** a la entrada en vigor del que lo
          // reemplaza. Cerrarlo en la misma fecha dejaba a las dos versiones
          // vigentes ese día, que es justo la ambigüedad que impide reconstruir
          // qué texto regía en una fecha dada.
          .set({ status: "superseded", validTo: previous.validTo ?? addDaysToPlainDate(requirement.validFrom, -1), version: previous.version + 1, updatedAt: now })
          .where(and(
            eq(preventionLegalRequirements.id, previous.id),
            eq(preventionLegalRequirements.status, "published"),
            eq(preventionLegalRequirements.version, previous.version),
          ))
          .returning()
        if (!superseded) throw new RiskLegalDomainError("El requisito vigente anterior cambió durante la publicación. Recarga antes de continuar.")
        await history(tx, {
          domain: "legal",
          entityType: "requirement",
          entityId: previous.id,
          changeType: "superseded",
          reason: `Reemplazado por ${requirement.code} v${requirement.requirementVersion} (${requirement.id}).`,
          beforeState: { status: previous.status, version: previous.version, validTo: previous.validTo, publishedHashSha256: previous.publishedHashSha256 },
          afterState: { status: superseded.status, version: superseded.version, validTo: superseded.validTo, supersededByRequirementId: requirement.id },
          actorUserId: access.userId,
        })
        /* LEGAL-01: las aplicabilidades de la versión reemplazada dejan de
         * contar como vigentes en este mismo acto —las consultas miden contra
         * el requisito vigente, `legalRequirementInForceCondition`—, pero NO se
         * migran a la versión nueva ni se reescriben.
         *
         * Migrarlas fabricaría un pronunciamiento que nadie hizo: la decisión
         * de aplicabilidad y su firma de aprobación se dieron sobre un texto
         * concreto, y una enmienda puede cambiar el ámbito material. Peor con
         * las evaluaciones, que cuelgan de la aplicabilidad y están fechadas
         * contra ese texto: arrastrarlas re-fecharía evidencia. Se dejan donde
         * están —el registro histórico queda íntegro— y queda escrito qué
         * quedó sin efecto y que hay que re-evaluar contra la versión nueva. */
        const orphaned = await tx.select({ id: preventionLegalApplicabilities.id, worksiteId: preventionLegalApplicabilities.worksiteId, complianceStatus: preventionLegalApplicabilities.complianceStatus })
          .from(preventionLegalApplicabilities)
          .where(and(eq(preventionLegalApplicabilities.requirementId, previous.id), eq(preventionLegalApplicabilities.applicabilityStatus, "applicable")))
        for (const item of orphaned) {
          await history(tx, {
            domain: "legal",
            entityType: "applicability",
            entityId: item.id,
            worksiteId: item.worksiteId,
            changeType: "superseded",
            reason: `El requisito ${previous.code} v${previous.requirementVersion} fue reemplazado por ${requirement.code} v${requirement.requirementVersion}: esta aplicabilidad deja de contar como vigente y debe re-evaluarse contra la versión nueva.`,
            beforeState: { requirementId: previous.id, complianceStatus: item.complianceStatus },
            afterState: { supersededByRequirementId: requirement.id },
            actorUserId: access.userId,
          })
        }
      }
      // El enlace se recalcula contra lo que de verdad se superó: el que trae
      // el borrador apunta a un requisito publicado *en ese momento*, y si
      // entremedio otro lo reemplazó, la columna afirmaría una supersesión que
      // nunca ocurrió. Sobrevive si sigue vigente; si no, queda el que se
      // reemplazó, o null cuando no se reemplazó a nadie.
      const supersededIds = previousPublished.map((row) => row.id)
      updates.supersedesRequirementId = supersededIds.find((id) => id === requirement.supersedesRequirementId) ?? supersededIds[0] ?? null
    }
    const [updated] = await tx.update(preventionLegalRequirements).set(updates).where(and(eq(preventionLegalRequirements.id, requirement.id), eq(preventionLegalRequirements.version, data.expectedVersion), eq(preventionLegalRequirements.status, requirement.status))).returning()
    if (!updated) throw new RiskLegalDomainError("El requisito cambió mientras lo revisabas.")
    await history(tx, { domain: "legal", entityType: "requirement", entityId: requirement.id, changeType: data.toStatus, reason: data.reason, beforeState: { status: requirement.status, version: requirement.version }, afterState: { status: updated.status, version: updated.version, hash: updated.publishedHashSha256 }, actorUserId: access.userId })
    return updated
  })
}

export async function proposeLegalApplicability(input: unknown, access: RiskLegalAccess) {
  const data = legalApplicabilityProposalSchema.parse(input)
  requireAccess(access, "prevention:legal:assess", data.worksiteId)
  return db.transaction(async (tx) => {
    const [[requirement], [worksite]] = await Promise.all([
      // Sólo se pronuncia aplicabilidad sobre el texto que rige hoy: proponerla
      // contra una versión reemplazada o derogada produce una decisión que
      // ninguna consulta va a contar (LEGAL-01/03).
      tx.select().from(preventionLegalRequirements).where(and(eq(preventionLegalRequirements.id, data.requirementId), legalRequirementInForceCondition())).limit(1),
      tx.select({ id: worksites.id }).from(worksites).where(and(eq(worksites.id, data.worksiteId), eq(worksites.isActive, true))).limit(1),
    ])
    if (!requirement || !worksite) throw new RiskLegalDomainError("Requisito no vigente o faena no encontrada.")
    await assertActiveUser(tx, data.responsibleUserId)
    if (data.processId) {
      const [process] = await tx.select({ id: preventionRiskProcesses.id }).from(preventionRiskProcesses).where(and(eq(preventionRiskProcesses.id, data.processId), eq(preventionRiskProcesses.worksiteId, data.worksiteId))).limit(1)
      if (!process) throw new RiskLegalDomainError("Proceso no encontrado en la faena.")
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
      // LEGAL-04: leer-y-después-insertar no es atómico. Dos propuestas
      // simultáneas para el mismo requisito y faena leen ambas "no existe"; el
      // índice único —ahora también con proceso nulo— deja pasar una sola, y
      // `onConflictDoNothing` convierte el choque en el mismo mensaje de
      // concurrencia que el resto del módulo en vez de un error de Postgres.
      : await tx.insert(preventionLegalApplicabilities).values({ id: `legalapp-${nanoid()}`, requirementId: data.requirementId, worksiteId: data.worksiteId, ...values }).onConflictDoNothing().returning()
    if (!saved) throw new RiskLegalDomainError("La aplicabilidad cambió mientras la revisabas. Recarga antes de continuar.")
    await history(tx, { domain: "legal", entityType: "applicability", entityId: saved.id, worksiteId: data.worksiteId, changeType: data.applicabilityStatus, reason: data.rationale, beforeState: existing ?? null, afterState: saved, actorUserId: access.userId })
    return saved
  })
}

export async function approveLegalApplicability(input: unknown, access: RiskLegalAccess) {
  const data = legalApplicabilityApprovalSchema.parse(input)
  return db.transaction(async (tx) => {
    const [item] = await tx.select().from(preventionLegalApplicabilities).where(eq(preventionLegalApplicabilities.id, data.applicabilityId)).limit(1)
    if (!item) throw new RiskLegalDomainError("Aplicabilidad no encontrada o fuera de alcance.")
    requireAccess(access, "prevention:legal:approve_applicability", item.worksiteId)
    if (!item.applicabilityStatus.startsWith("proposed_")) throw new RiskLegalDomainError("La aplicabilidad no está pendiente de aprobación.")
    if (item.assessedByUserId === access.userId) throw new RiskLegalDomainError("Quien evaluó la aplicabilidad no puede aprobarla.")
    if (item.version !== data.expectedVersion) throw new RiskLegalDomainError("La aplicabilidad cambió mientras la revisabas.")
    /* Si el texto dejó de regir entre la propuesta y la aprobación, aprobarla
     * firma una decisión sobre un texto que ya no existe —y abre un reloj de 30
     * días del PDTP que nadie podría cerrar, porque `linkPdtpActivitySource` no
     * acepta un requisito no vigente como fuente de cobertura (LEGAL-01/03). */
    const [requirement] = await tx.select().from(preventionLegalRequirements).where(eq(preventionLegalRequirements.id, item.requirementId)).limit(1)
    if (!requirement || !isLegalRequirementInForce(requirement)) {
      throw new RiskLegalDomainError("El requisito dejó de estar vigente: vuelve a pronunciarte sobre la versión vigente antes de aprobar.")
    }
    const finalStatus = item.applicabilityStatus === "proposed_applicable" ? "applicable" : "not_applicable"
    const complianceStatus = finalStatus === "not_applicable" ? "not_applicable" : "not_assessed"
    const now = new Date().toISOString()
    const [updated] = await tx.update(preventionLegalApplicabilities).set({ applicabilityStatus: finalStatus, complianceStatus, approvedByUserId: access.userId, approvedAt: now, version: item.version + 1, updatedAt: now }).where(and(eq(preventionLegalApplicabilities.id, item.id), eq(preventionLegalApplicabilities.version, data.expectedVersion))).returning()
    if (!updated) throw new RiskLegalDomainError("La aplicabilidad cambió mientras la revisabas.")
    await history(tx, { domain: "legal", entityType: "applicability", entityId: item.id, worksiteId: item.worksiteId, changeType: "approved", reason: data.reason, beforeState: item, afterState: updated, actorUserId: access.userId })
    if (finalStatus === "applicable") {
      await tx.insert(preventionPdtpUpdateObligations).values({
        id: `pdtpob-${nanoid()}`,
        idempotencyKey: `legal:pdtp:${item.id}:${item.version + 1}`,
        worksiteId: item.worksiteId,
        sourceType: "legal_requirement",
        sourceId: item.requirementId,
        sourceVersionSnapshot: `Requisito ${requirement.code} v${requirement.requirementVersion}`,
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
    if (!item) throw new RiskLegalDomainError("Aplicabilidad no encontrada o fuera de alcance.")
    requireAccess(access, "prevention:legal:assess", item.worksiteId)
    if (item.applicabilityStatus !== "applicable") throw new RiskLegalDomainError("Sólo un requisito aplicable y aprobado puede evaluarse.")
    if (item.version !== data.expectedVersion) throw new RiskLegalDomainError("La aplicabilidad cambió mientras la revisabas.")
    /* LEGAL-01/03: evaluar el cumplimiento es una afirmación fechada hoy contra
     * un texto. Si ese texto ya fue reemplazado o su vigencia terminó, la
     * evaluación no dice nada: lo que hay que evaluar es la versión vigente. */
    const [requirement] = await tx.select().from(preventionLegalRequirements).where(eq(preventionLegalRequirements.id, item.requirementId)).limit(1)
    if (!requirement || !isLegalRequirementInForce(requirement)) {
      throw new RiskLegalDomainError("El requisito no está vigente (reemplazado o con vigencia terminada): evalúa el cumplimiento sobre la versión vigente.")
    }
    /* LEGAL-05: una brecha se declaraba cumplida con su CAPA todavía abierta —
     * el tablero pasaba a verde mientras la corrección seguía sin hacerse. Mismo
     * criterio que `assertIncidentTransition`: no se cierra nada con hijos
     * abiertos. El corte está en 'verified' y no en 'closed' porque verificar es
     * el acto que acredita la corrección con evidencia y actor segregado; cerrar
     * es el trámite posterior. 'cancelled' tampoco bloquea: la acción se retiró
     * con motivo y ya no existe —y como `prevention_capa_source_item_unique`
     * admite una sola CAPA por aplicabilidad, tratarla como abierta dejaría la
     * aplicabilidad sin ninguna forma de volver a cumplir. */
    if (data.status === "compliant") {
      const [openCapa] = await tx.select({ code: preventionCapaActions.code, status: preventionCapaActions.status })
        .from(preventionCapaActions)
        .where(and(
          eq(preventionCapaActions.sourceType, "legal_requirement"),
          eq(preventionCapaActions.sourceItemId, item.id),
          notInArray(preventionCapaActions.status, ["verified", "closed", "cancelled"]),
        )).limit(1)
      if (openCapa) {
        throw new RiskLegalDomainError(`No se puede declarar cumplimiento: la acción correctiva ${openCapa.code} sigue abierta (${CAPA_STATUS_LABELS[openCapa.status as CapaStatus] ?? openCapa.status}). Verifícala antes de cerrar la brecha.`)
      }
    }
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
    if (!assessment || !updated) throw new RiskLegalDomainError("La aplicabilidad cambió mientras la evaluabas.")
    await history(tx, { domain: "legal", entityType: "assessment", entityId: assessment.id, worksiteId: item.worksiteId, changeType: data.status, reason: data.finding ?? "Evaluación de cumplimiento", beforeState: { complianceStatus: item.complianceStatus }, afterState: { complianceStatus: data.status, capaActionId }, actorUserId: access.userId })
    return { assessment, applicability: updated }
  })
}

export async function linkPdtpActivitySource(input: unknown, access: RiskLegalAccess) {
  const data = pdtpSourceLinkSchema.parse(input)
  requireAccess(access, "prevention:pdtp:program:manage", data.worksiteId)
  return db.transaction(async (tx) => {
    const [activity] = await tx.select({ activity: pdtpActivities, program: pdtpPrograms }).from(pdtpActivities).innerJoin(pdtpPrograms, eq(pdtpPrograms.id, pdtpActivities.programId)).where(eq(pdtpActivities.id, data.activityId)).limit(1)
    if (!activity) throw new RiskLegalDomainError("Actividad PDTP no encontrada.")
    // La cobertura de fuentes es trazabilidad operacional: se vincula tanto en
    // borrador (planificación) como en un programa activo (demostrar cobertura y
    // cerrar el reloj MIPER de 30 días — ver resolvePdtpUpdateObligation). Solo
    // se bloquea durante la revisión: alterar el contenido ahí invalidaría el
    // digest firmado que se re-verifica al activar (ver pdtp/lifecycle.ts).
    if (activity.program.status === "in_review") {
      throw new RiskLegalDomainError("El programa está en revisión y su contenido está bloqueado: no se pueden modificar sus vínculos de cobertura hasta que se apruebe o se reabra.")
    }
    let sourceVersionSnapshot = "Fuente manual"
    let sourceEntityId = data.sourceId
    if (data.sourceType === "risk_control") {
      const [source] = await tx.select({ control: preventionRiskControls, matrix: preventionRiskMatrices }).from(preventionRiskControls).innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskControls.riskEntryId)).innerJoin(preventionRiskMatrices, eq(preventionRiskMatrices.id, preventionRiskEntries.matrixId)).where(and(eq(preventionRiskControls.id, data.sourceId), eq(preventionRiskMatrices.worksiteId, data.worksiteId), eq(preventionRiskMatrices.status, "published"))).limit(1)
      if (!source) throw new RiskLegalDomainError("Control MIPER no encontrado, no publicado o fuera de alcance.")
      sourceVersionSnapshot = `MIPER v${source.matrix.matrixVersion} · control v${source.control.version}`
      sourceEntityId = source.control.id
    } else if (data.sourceType === "legal_requirement") {
      // La vigencia también manda acá: una actividad del programa no queda
      // cubierta por un artículo derogado (LEGAL-03).
      const [source] = await tx.select({ requirement: preventionLegalRequirements }).from(preventionLegalRequirements).innerJoin(preventionLegalApplicabilities, eq(preventionLegalApplicabilities.requirementId, preventionLegalRequirements.id)).where(and(eq(preventionLegalRequirements.id, data.sourceId), legalRequirementInForceCondition(), eq(preventionLegalApplicabilities.worksiteId, data.worksiteId), eq(preventionLegalApplicabilities.applicabilityStatus, "applicable"))).limit(1)
      if (!source) throw new RiskLegalDomainError("Requisito legal no encontrado, no vigente, no aplicable o fuera de alcance.")
      sourceVersionSnapshot = `${source.requirement.code} v${source.requirement.requirementVersion}`
    } else if (data.sourceType === "incident_capa") {
      const [source] = await tx.select().from(preventionCapaActions).where(and(eq(preventionCapaActions.id, data.sourceId), eq(preventionCapaActions.worksiteId, data.worksiteId))).limit(1)
      if (!source) throw new RiskLegalDomainError("CAPA de incidente no encontrada o fuera de alcance.")
      sourceVersionSnapshot = `${source.code} v${source.version}`
    } else if (data.sourceType === "capacitacion") {
      const [source] = await tx.select({
        id: preventionTrainingOccurrences.id,
        code: preventionTrainingCatalogItems.code,
        year: preventionTrainingOccurrences.year,
      }).from(preventionTrainingOccurrences)
        .innerJoin(preventionTrainingCatalogItems, eq(preventionTrainingCatalogItems.id, preventionTrainingOccurrences.catalogItemId))
        .where(and(
          eq(preventionTrainingOccurrences.id, data.sourceId),
          eq(preventionTrainingOccurrences.worksiteId, data.worksiteId),
          eq(preventionTrainingOccurrences.status, "completed"),
        )).limit(1)
      if (!source) throw new RiskLegalDomainError("Capacitación no encontrada, no realizada o fuera de alcance.")
      sourceVersionSnapshot = `${source.code} ${source.year}`
    } else if (data.sourceType === "inspeccion") {
      const [source] = await tx.select().from(preventionInspectionRuns).where(and(eq(preventionInspectionRuns.id, data.sourceId), eq(preventionInspectionRuns.worksiteId, data.worksiteId), ne(preventionInspectionRuns.status, "cancelled"))).limit(1)
      if (!source) throw new RiskLegalDomainError("Inspección no encontrada, cancelada o fuera de alcance.")
      sourceVersionSnapshot = source.code
    } else if (data.sourceType === "audit") {
      // `audit` ya existía en el enum pero sin rama: caía en "Fuente manual", o
      // sea sin snapshot de versión y —peor— sin verificar pertenencia a la
      // faena. Una auditoría es una corrida del motor de inspecciones cuya
      // plantilla es de tipo 'audit' (DS 44 art. 22 n°4).
      const [source] = await tx.select({ run: preventionInspectionRuns, template: preventionInspectionTemplates }).from(preventionInspectionRuns).innerJoin(preventionInspectionTemplates, eq(preventionInspectionTemplates.id, preventionInspectionRuns.templateId)).where(and(eq(preventionInspectionRuns.id, data.sourceId), eq(preventionInspectionRuns.worksiteId, data.worksiteId), eq(preventionInspectionTemplates.kind, "audit"), ne(preventionInspectionRuns.status, "cancelled"))).limit(1)
      if (!source) throw new RiskLegalDomainError("Auditoría no encontrada, cancelada o fuera de alcance.")
      sourceVersionSnapshot = `${source.run.code} · ${source.template.code} v${source.template.versionLabel}`
    } else if (data.sourceType === "cphs") {
      const [source] = await tx.select().from(preventionCommittees).where(and(eq(preventionCommittees.id, data.sourceId), eq(preventionCommittees.worksiteId, data.worksiteId), eq(preventionCommittees.status, "active"))).limit(1)
      if (!source) throw new RiskLegalDomainError("Comité CPHS no encontrado, no activo o fuera de alcance.")
      sourceVersionSnapshot = `${source.name} v${source.version}`
    } else if (data.sourceType === "epp") {
      const [source] = await tx.select().from(preventionEppRequirements).where(and(eq(preventionEppRequirements.id, data.sourceId), eq(preventionEppRequirements.worksiteId, data.worksiteId), eq(preventionEppRequirements.isActive, true))).limit(1)
      if (!source) throw new RiskLegalDomainError("Requisito de EPP no encontrado, inactivo o fuera de alcance.")
      sourceVersionSnapshot = `EPP requerido desde ${source.createdAt.slice(0, 10)}`
    } else if (data.sourceType === "emergencia") {
      const [source] = await tx.select().from(preventionEmergencyPlans).where(and(eq(preventionEmergencyPlans.id, data.sourceId), eq(preventionEmergencyPlans.worksiteId, data.worksiteId), eq(preventionEmergencyPlans.status, "approved"))).limit(1)
      if (!source) throw new RiskLegalDomainError("Plan de emergencia no encontrado, no aprobado o fuera de alcance.")
      sourceVersionSnapshot = `${source.code} v${source.version}`
    } else if (data.sourceType === "protocolo_minsal") {
      // Sólo un protocolo declarado aplicable puede cubrir una actividad: uno
      // descartado o sin pronunciamiento no sostiene nada ante un fiscalizador.
      const [source] = await tx.select().from(preventionProtocolApplicabilities).where(and(eq(preventionProtocolApplicabilities.id, data.sourceId), eq(preventionProtocolApplicabilities.worksiteId, data.worksiteId), eq(preventionProtocolApplicabilities.status, "applicable"))).limit(1)
      if (!source) throw new RiskLegalDomainError("Protocolo MINSAL no encontrado, no declarado aplicable o fuera de alcance.")
      sourceVersionSnapshot = `${MINSAL_PROTOCOL_LABELS[source.protocolCode] ?? source.protocolCode} v${source.version}`
    } else if (data.sourceType === "contractual_obligation") {
      // La obligación contractual del mandante llega por una coordinación del
      // art. 20: es la interacción registrada la que la acredita.
      const [source] = await tx.select().from(preventionExternalEngagements).where(and(eq(preventionExternalEngagements.id, data.sourceId), eq(preventionExternalEngagements.worksiteId, data.worksiteId), eq(preventionExternalEngagements.kind, "coordinacion"))).limit(1)
      if (!source) throw new RiskLegalDomainError("Coordinación con el mandante no encontrada o fuera de alcance.")
      sourceVersionSnapshot = `${source.code} · ${source.occurredOn}`
    } else if (data.sourceType === "campana") {
      // Único tipo con catálogo que quedaba sin verificar pertenencia a faena.
      const [source] = await tx.select().from(preventionCampaigns).where(and(eq(preventionCampaigns.id, data.sourceId), eq(preventionCampaigns.worksiteId, data.worksiteId))).limit(1)
      if (!source) throw new RiskLegalDomainError("Campaña no encontrada o fuera de alcance.")
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
    if (!obligation) throw new RiskLegalDomainError("Obligación PDTP no encontrada o fuera de alcance.")
    requireAccess(access, "prevention:pdtp:program:manage", obligation.worksiteId)
    const [program] = await tx.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, data.programId)).limit(1)
    if (!program) throw new RiskLegalDomainError("Programa PDTP no encontrado.")
    const activities = await tx.select({ id: pdtpActivities.id }).from(pdtpActivities).where(eq(pdtpActivities.programId, program.id))
    if (activities.length === 0) throw new RiskLegalDomainError("El programa no contiene actividades.")
    const activityIds = activities.map((item) => item.id)
    let covered = false
    if (obligation.sourceType === "legal_requirement") {
      const [link] = await tx.select({ id: preventionPdtpSourceLinks.id }).from(preventionPdtpSourceLinks).where(and(inArray(preventionPdtpSourceLinks.activityId, activityIds), eq(preventionPdtpSourceLinks.worksiteId, obligation.worksiteId), eq(preventionPdtpSourceLinks.sourceType, "legal_requirement"), eq(preventionPdtpSourceLinks.sourceId, obligation.sourceId), eq(preventionPdtpSourceLinks.isActive, true))).limit(1)
      covered = Boolean(link)
    } else {
      const [link] = await tx.select({ id: preventionPdtpSourceLinks.id }).from(preventionPdtpSourceLinks).innerJoin(preventionRiskControls, eq(preventionRiskControls.id, preventionPdtpSourceLinks.sourceId)).innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskControls.riskEntryId)).where(and(inArray(preventionPdtpSourceLinks.activityId, activityIds), eq(preventionPdtpSourceLinks.worksiteId, obligation.worksiteId), eq(preventionPdtpSourceLinks.sourceType, "risk_control"), eq(preventionRiskEntries.matrixId, obligation.sourceId), eq(preventionPdtpSourceLinks.isActive, true))).limit(1)
      covered = Boolean(link)
    }
    if (!covered) throw new RiskLegalDomainError("No se puede cerrar el reloj: el programa no tiene una actividad vinculada a esta fuente.")
    const now = new Date().toISOString()
    const [updated] = await tx.update(preventionPdtpUpdateObligations).set({ status: "addressed", addressedByProgramId: program.id, addressedByUserId: access.userId, addressedAt: now, resolution: data.resolution }).where(and(eq(preventionPdtpUpdateObligations.id, obligation.id), inArray(preventionPdtpUpdateObligations.status, ["pending", "overdue"]))).returning()
    if (!updated) throw new RiskLegalDomainError("La obligación ya fue resuelta.")
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
  const [visibleWorksites, methodologies, matrices, processes, triggers, obligations, committeeMeetings] = await Promise.all([
    db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(and(eq(worksites.isActive, true), scopeCondition(access.scope, worksites.id))).orderBy(asc(worksites.name)),
    db.select().from(preventionRiskMethodologies).where(eq(preventionRiskMethodologies.isActive, true)).orderBy(asc(preventionRiskMethodologies.name)),
    db.select().from(preventionRiskMatrices).where(condition).orderBy(desc(preventionRiskMatrices.createdAt)),
    db.select().from(preventionRiskProcesses).where(and(eq(preventionRiskProcesses.isActive, true), scopeCondition(access.scope, preventionRiskProcesses.worksiteId))).orderBy(asc(preventionRiskProcesses.name)),
    db.select().from(preventionRiskReviewTriggers).where(and(scopeCondition(access.scope, preventionRiskReviewTriggers.worksiteId), inArray(preventionRiskReviewTriggers.status, ["pending", "in_progress"]))).orderBy(asc(preventionRiskReviewTriggers.dueAt)),
    db.select().from(preventionPdtpUpdateObligations).where(and(scopeCondition(access.scope, preventionPdtpUpdateObligations.worksiteId), eq(preventionPdtpUpdateObligations.sourceType, "risk_matrix"), inArray(preventionPdtpUpdateObligations.status, ["pending", "overdue"]))).orderBy(asc(preventionPdtpUpdateObligations.dueAt)),
    /* MIPER-07: sesiones elegibles para declarar la participación del CPHS en
     * una revisión. Sin esta lista `committeeMeetingId` era una columna que
     * nadie podía llenar desde la aplicación, y el crédito Oro
     * `iper_committee_participation` quedaba permanentemente en `not_met`.
     * La sesión no lleva faena propia —cuelga del comité, y el comité de la
     * faena—, así que el JOIN es el mismo que valida
     * `createRiskMatrixDraftWithClient`; las canceladas quedan fuera porque son
     * reuniones que nunca ocurrieron. */
    db.select({ id: preventionCommitteeMeetings.id, worksiteId: preventionCommittees.worksiteId, code: preventionCommitteeMeetings.code, scheduledFor: preventionCommitteeMeetings.scheduledFor })
      .from(preventionCommitteeMeetings)
      .innerJoin(preventionCommittees, eq(preventionCommittees.id, preventionCommitteeMeetings.committeeId))
      .where(and(scopeCondition(access.scope, preventionCommittees.worksiteId), ne(preventionCommitteeMeetings.status, "cancelled")))
      .orderBy(desc(preventionCommitteeMeetings.scheduledFor)),
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
    committeeMeetings,
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
  // `createdAt` desempata: dos evaluaciones del mismo día llevan el mismo
  // `assessedAt` si el reloj de la aplicación no alcanzó a moverse, y de cuál
  // es la última depende la fecha de re-evaluación que se mira más abajo.
  const assessments = appIds.length ? await db.select().from(preventionLegalAssessments).where(inArray(preventionLegalAssessments.applicabilityId, appIds)).orderBy(desc(preventionLegalAssessments.assessedAt), desc(preventionLegalAssessments.createdAt)) : []
  /* LEGAL-01/03/06. `inForce` viaja por fila porque la vigencia es del
   * requisito y la cuenta es de la aplicabilidad; `gapReason` viaja porque la
   * lista de brechas tiene que decir por qué lo es —una fila "Cumple" ahí sin
   * explicación se lee como un error de la pantalla. Los contadores se calculan
   * aquí y no en cada consumidor: la tarjeta del panel de inicio y la del
   * módulo repetían el mismo filtro y las dos contaban obligaciones derogadas. */
  const today = todayInChile()
  const latestAssessment = new Map<string, typeof preventionLegalAssessments.$inferSelect>()
  for (const assessment of assessments) {
    if (!latestAssessment.has(assessment.applicabilityId)) latestAssessment.set(assessment.applicabilityId, assessment)
  }
  const rows = applicabilities.map((row) => {
    const inForce = isLegalRequirementInForce(row.requirement, today)
    return {
      ...row,
      inForce,
      gapReason: inForce && row.applicability.applicabilityStatus === "applicable"
        ? legalGapReason(row.applicability, latestAssessment.get(row.applicability.id), today)
        : null,
    }
  })
  const gaps = rows.filter((row) => row.gapReason !== null)
  const applicable = rows.filter((row) => row.inForce && row.applicability.applicabilityStatus === "applicable")
  const counts = {
    requirementsInForce: requirements.filter((requirement) => isLegalRequirementInForce(requirement, today)).length,
    applicable: applicable.length,
    compliant: applicable.length - gaps.length,
    gaps: gaps.length,
    pendingApproval: rows.filter((row) => row.applicability.applicabilityStatus.startsWith("proposed_")).length,
    superseded: rows.filter((row) => !row.inForce && row.applicability.applicabilityStatus === "applicable").length,
  }
  return {
    requirements: requirements.map((requirement) => ({ ...requirement, inForce: isLegalRequirementInForce(requirement, today) })),
    applicabilities: rows,
    assessments,
    gaps,
    counts,
    worksites: visibleWorksites,
    processes,
  }
}

export async function getPdtpCoverage(programId: string, access: RiskLegalAccess) {
  requireAccess(access, "prevention:pdtp:view")
  await refreshPdtpUpdateObligationDeadlines()
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) throw new RiskLegalDomainError("Programa PDTP no encontrado.")
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
      .where(and(eq(preventionLegalApplicabilities.applicabilityStatus, "applicable"), legalRequirementInForceCondition(), scopeCondition(access.scope, preventionLegalApplicabilities.worksiteId)))
      .orderBy(asc(preventionLegalRequirements.code)),
    db.select({
      id: preventionCapaActions.id,
      worksiteId: preventionCapaActions.worksiteId,
      code: preventionCapaActions.code,
      finding: preventionCapaActions.finding,
    }).from(preventionCapaActions)
      .where(and(scopeCondition(access.scope, preventionCapaActions.worksiteId), ne(preventionCapaActions.status, "cancelled")))
      .orderBy(asc(preventionCapaActions.code)),
    /* Las sesiones de capacitación dejaron de existir el 2026-09-19. La fuente
     * pasa a ser la ocurrencia del catálogo anual, que además —a diferencia de
     * la sesión— tiene evidencia adjunta, que es justo lo que un control de
     * riesgo necesita citar. Sólo las hechas: una actividad pendiente no
     * respalda nada. */
    db.select({
      id: preventionTrainingOccurrences.id,
      worksiteId: preventionTrainingOccurrences.worksiteId,
      code: preventionTrainingCatalogItems.code,
      title: preventionTrainingCatalogItems.title,
      year: preventionTrainingOccurrences.year,
    }).from(preventionTrainingOccurrences)
      .innerJoin(preventionTrainingCatalogItems, eq(preventionTrainingCatalogItems.id, preventionTrainingOccurrences.catalogItemId))
      .where(and(scopeCondition(access.scope, preventionTrainingOccurrences.worksiteId), eq(preventionTrainingOccurrences.status, "completed")))
      .orderBy(asc(preventionTrainingCatalogItems.code)),
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
      trainingSessions: trainingSources.map((item) => ({ id: item.id, worksiteId: item.worksiteId, label: `${item.code} · ${item.title} (${item.year})` })),
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
  if (!matrix || !scopeAllows(access.scope, matrix.matrix.worksiteId)) throw new RiskLegalDomainError("MIPER no encontrada o fuera de alcance.")
  const entries = await db.select({ entry: preventionRiskEntries, process: preventionRiskProcesses, task: preventionRiskTasks, position: preventionRiskPositions }).from(preventionRiskEntries).innerJoin(preventionRiskProcesses, eq(preventionRiskProcesses.id, preventionRiskEntries.processId)).innerJoin(preventionRiskTasks, eq(preventionRiskTasks.id, preventionRiskEntries.taskId)).innerJoin(preventionRiskPositions, eq(preventionRiskPositions.id, preventionRiskEntries.positionId)).where(eq(preventionRiskEntries.matrixId, matrixId)).orderBy(asc(preventionRiskProcesses.name), asc(preventionRiskTasks.name), asc(preventionRiskPositions.name), asc(preventionRiskEntries.hazardCode))
  const controls = entries.length ? await db.select().from(preventionRiskControls).where(inArray(preventionRiskControls.riskEntryId, entries.map((item) => item.entry.id))).orderBy(asc(preventionRiskControls.createdAt)) : []
  const triggers = await db.select().from(preventionRiskReviewTriggers).where(eq(preventionRiskReviewTriggers.matrixId, matrixId)).orderBy(desc(preventionRiskReviewTriggers.createdAt))
  return { ...matrix, entries, controls, triggers }
}

/**
 * La misma MIPER publicada, para el archivado de documentos generados. Corre
 * sin sesión (en un `after()` o en el cron) y solo lee: el hecho —publicar—
 * ya lo autorizó quien lo hizo. Queda con nombre propio para que ningún otro
 * caller use este acceso total por comodidad.
 */
export async function getPublishedRiskMatrixForArchive(matrixId: string) {
  return getPublishedRiskMatrix(matrixId, {
    userId: "system:generated-documents",
    scope: { mode: "all", ids: [] },
    permissions: ["prevention:risk:view"],
  })
}

export async function getRiskControlDetail(controlId: string, access: RiskLegalAccess) {
  if (!access.permissions.includes("prevention:risk:view") && !access.permissions.includes("prevention:pdtp:view")) throw new RiskLegalDomainError("Control MIPER no encontrado o fuera de alcance.")
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
  if (!row || !scopeAllows(access.scope, row.matrix.worksiteId)) throw new RiskLegalDomainError("Control MIPER no encontrado o fuera de alcance.")
  const links = await db.select().from(preventionPdtpSourceLinks).where(and(eq(preventionPdtpSourceLinks.sourceType, "risk_control"), eq(preventionPdtpSourceLinks.sourceId, controlId), eq(preventionPdtpSourceLinks.isActive, true)))
  return { ...row, links }
}

export async function getLegalRequirementDetail(requirementId: string, access: RiskLegalAccess) {
  if (!access.permissions.includes("prevention:legal:view") && !access.permissions.includes("prevention:pdtp:view")) throw new RiskLegalDomainError("Requisito legal no encontrado.")
  const [requirement] = await db.select().from(preventionLegalRequirements).where(and(eq(preventionLegalRequirements.id, requirementId), inArray(preventionLegalRequirements.status, ["published", "superseded"]))).limit(1)
  if (!requirement) throw new RiskLegalDomainError("Requisito legal no encontrado.")
  const applicabilities = await db.select({ applicability: preventionLegalApplicabilities, worksiteName: worksites.name }).from(preventionLegalApplicabilities).innerJoin(worksites, eq(worksites.id, preventionLegalApplicabilities.worksiteId)).where(and(eq(preventionLegalApplicabilities.requirementId, requirementId), scopeCondition(access.scope, preventionLegalApplicabilities.worksiteId))).orderBy(asc(worksites.name))
  const ids = applicabilities.map((item) => item.applicability.id)
  const assessments = ids.length ? await db.select().from(preventionLegalAssessments).where(inArray(preventionLegalAssessments.applicabilityId, ids)).orderBy(desc(preventionLegalAssessments.assessedAt)) : []
  const links = await db.select().from(preventionPdtpSourceLinks).where(and(eq(preventionPdtpSourceLinks.sourceType, "legal_requirement"), eq(preventionPdtpSourceLinks.sourceId, requirementId), eq(preventionPdtpSourceLinks.isActive, true), scopeCondition(access.scope, preventionPdtpSourceLinks.worksiteId)))
  // La ficha decía "Vigente" por el solo hecho de estar publicado, sin mirar la
  // ventana de vigencia que ella misma muestra (LEGAL-03).
  return { requirement, inForce: isLegalRequirementInForce(requirement), applicabilities, assessments, links }
}
