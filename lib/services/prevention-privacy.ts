import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import {
  preventionHealthRecords,
  preventionPrivacyDeliveries,
  preventionPrivacyRequestHistory,
  preventionPrivacyRequests,
  preventionSensitiveAccessAudit,
  sstDocumentAudit,
  sstDocuments,
  workers,
  worksites,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import type { RequestContext } from "@/lib/services/prevention-documents/utils"
import { getPreventionClinicalPayload } from "@/lib/services/prevention-health"
import { hasRequiredPrivacyExecutionEvidence } from "@/lib/services/prevention-privacy-rights"

export const PRIVACY_REQUEST_STATUSES = [
  "recibida",
  "validando_identidad",
  "en_proceso",
  "suspendida_retencion",
  "completada",
  "rechazada",
] as const

export type PrivacyRequestStatus = typeof PRIVACY_REQUEST_STATUSES[number]

const privacyRequestCreateSchema = z.object({
  subjectWorkerId: z.string().min(1),
  rightType: z.enum(["access", "rectification", "deletion", "opposition", "portability", "restriction"]),
  requestScope: z.string().trim().min(3).max(2000),
  receivedAt: z.string().datetime({ offset: true }).optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
})

const privacyRequestTransitionSchema = z.object({
  requestId: z.string().min(1),
  toStatus: z.enum(PRIVACY_REQUEST_STATUSES),
  reason: z.string().trim().max(2000).optional(),
  releaseLegalHold: z.boolean().optional().default(false),
})

const TRANSITIONS: Record<PrivacyRequestStatus, readonly PrivacyRequestStatus[]> = {
  recibida: ["validando_identidad", "rechazada"],
  validando_identidad: ["en_proceso", "rechazada"],
  en_proceso: ["suspendida_retencion", "completada", "rechazada"],
  suspendida_retencion: ["en_proceso", "rechazada"],
  completada: [],
  rechazada: [],
}

function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

function requirePermission(permissions: readonly string[], permission: string) {
  if (!permissions.includes(permission)) throw new Error("Solicitud no encontrada o fuera de alcance.")
}

function validatePurpose(purpose: string) {
  const normalized = purpose.trim()
  if (normalized.length < 3 || normalized.length > 300) throw new Error("Propósito de acceso inválido.")
  return normalized
}

export function assertPrivacyRequestTransition(args: {
  fromStatus: PrivacyRequestStatus
  toStatus: PrivacyRequestStatus
  rightType: string
  legalHold: boolean
  reason?: string
  releaseLegalHold?: boolean
}) {
  if (!TRANSITIONS[args.fromStatus].includes(args.toStatus)) {
    throw new Error(`Transición de privacidad inválida: ${args.fromStatus} → ${args.toStatus}.`)
  }
  const reason = args.reason?.trim() ?? ""
  if (["suspendida_retencion", "completada", "rechazada"].includes(args.toStatus) && reason.length < 5) {
    throw new Error("La transición requiere un motivo de al menos 5 caracteres.")
  }
  if (args.toStatus === "suspendida_retencion" && reason.length < 5) {
    throw new Error("La retención legal requiere fundamento.")
  }
  if (args.fromStatus === "suspendida_retencion" && args.toStatus === "en_proceso" && !args.releaseLegalHold) {
    throw new Error("Debes liberar expresamente la retención legal para continuar.")
  }
  if (args.toStatus === "completada" && args.legalHold) {
    throw new Error("No se puede completar la solicitud mientras exista retención legal.")
  }
  if (args.rightType === "deletion" && args.toStatus === "completada" && args.legalHold) {
    throw new Error("La supresión no puede ejecutarse durante una retención legal.")
  }
}

async function auditPrivacyRequest(args: {
  requestId: string
  subjectWorkerId: string
  worksiteId: string
  ctx: RequestContext
  action: "create" | "update" | "export"
  purpose: string
  outcome?: "granted" | "denied"
  reasonCode?: string | null
  client?: Pick<typeof db, "insert">
}) {
  const client = args.client ?? db
  await client.insert(preventionSensitiveAccessAudit).values({
    id: `psa-${nanoid()}`,
    domain: "privacy_request",
    entityId: args.requestId,
    subjectWorkerId: args.subjectWorkerId,
    worksiteId: args.worksiteId,
    actorUserId: args.ctx.userId,
    action: args.action,
    purpose: args.purpose,
    outcome: args.outcome ?? "granted",
    reasonCode: args.reasonCode ?? null,
    ip: args.ctx.ip ?? null,
    userAgent: args.ctx.userAgent ?? null,
    createdAt: new Date().toISOString(),
  })
}

export async function createPreventionPrivacyRequest(args: {
  input: unknown
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
}) {
  requirePermission(args.permissions, "prevention:privacy:manage_requests")
  const input = privacyRequestCreateSchema.parse(args.input)
  const [worker] = await db.select().from(workers).where(eq(workers.id, input.subjectWorkerId)).limit(1)
  if (!worker || !scopeAllows(args.scope, worker.worksiteId)) {
    throw new Error("Solicitud no encontrada o fuera de alcance.")
  }
  const receivedAt = input.receivedAt ?? new Date().toISOString()
  if (input.dueAt && input.dueAt < receivedAt) throw new Error("El vencimiento no puede ser anterior a la recepción.")
  const id = `ppr-${nanoid()}`
  const now = new Date().toISOString()

  return db.transaction(async (tx) => {
    const [created] = await tx.insert(preventionPrivacyRequests).values({
      id,
      subjectWorkerId: input.subjectWorkerId,
      rightType: input.rightType,
      status: "recibida",
      requestScope: input.requestScope,
      receivedAt,
      dueAt: input.dueAt ?? null,
      createdByUserId: args.ctx.userId,
      createdAt: now,
      updatedAt: now,
    }).returning()
    if (!created) throw new Error("No se pudo crear la solicitud de privacidad.")
    await tx.insert(preventionPrivacyRequestHistory).values({
      id: `pprh-${nanoid()}`,
      requestId: id,
      fromStatus: null,
      toStatus: "recibida",
      reason: "Recepción de solicitud",
      actorUserId: args.ctx.userId,
      createdAt: now,
    })
    await auditPrivacyRequest({
      requestId: id,
      subjectWorkerId: input.subjectWorkerId,
      worksiteId: worker.worksiteId,
      ctx: args.ctx,
      action: "create",
      purpose: "gestion_derecho_titular",
      client: tx,
    })
    return created
  })
}

export async function transitionPreventionPrivacyRequest(args: {
  input: unknown
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
}) {
  requirePermission(args.permissions, "prevention:privacy:manage_requests")
  const input = privacyRequestTransitionSchema.parse(args.input)
  const [requestRow] = await db.select().from(preventionPrivacyRequests)
    .where(eq(preventionPrivacyRequests.id, input.requestId)).limit(1)
  if (!requestRow) throw new Error("Solicitud no encontrada o fuera de alcance.")
  const [worker] = await db.select().from(workers).where(eq(workers.id, requestRow.subjectWorkerId)).limit(1)
  if (!worker || !scopeAllows(args.scope, worker.worksiteId)) {
    throw new Error("Solicitud no encontrada o fuera de alcance.")
  }

  assertPrivacyRequestTransition({
    fromStatus: requestRow.status as PrivacyRequestStatus,
    toStatus: input.toStatus,
    rightType: requestRow.rightType,
    legalHold: requestRow.legalHold,
    reason: input.reason,
    releaseLegalHold: input.releaseLegalHold,
  })
  if (input.toStatus === "completada" && !await hasRequiredPrivacyExecutionEvidence(requestRow.id, requestRow.rightType)) {
    throw new Error("No se puede completar la solicitud sin una entrega o ejecución auditable del derecho.")
  }

  const now = new Date().toISOString()
  const enteringHold = input.toStatus === "suspendida_retencion"
  const releasingHold = requestRow.status === "suspendida_retencion" && input.toStatus === "en_proceso"
  const verifiesIdentity = requestRow.status === "validando_identidad" && input.toStatus === "en_proceso"
  const terminal = input.toStatus === "completada" || input.toStatus === "rechazada"

  return db.transaction(async (tx) => {
    const [updated] = await tx.update(preventionPrivacyRequests).set({
      status: input.toStatus,
      handledByUserId: args.ctx.userId,
      identityVerifiedAt: verifiesIdentity ? now : requestRow.identityVerifiedAt,
      identityVerifiedByUserId: verifiesIdentity ? args.ctx.userId : requestRow.identityVerifiedByUserId,
      legalHold: enteringHold ? true : releasingHold ? false : requestRow.legalHold,
      legalHoldReason: enteringHold ? input.reason!.trim() : releasingHold ? null : requestRow.legalHoldReason,
      completedAt: terminal ? now : null,
      decisionReason: terminal ? input.reason!.trim() : requestRow.decisionReason,
      updatedAt: now,
    }).where(eq(preventionPrivacyRequests.id, requestRow.id)).returning()
    if (!updated) throw new Error("No se pudo actualizar la solicitud de privacidad.")
    await tx.insert(preventionPrivacyRequestHistory).values({
      id: `pprh-${nanoid()}`,
      requestId: requestRow.id,
      fromStatus: requestRow.status,
      toStatus: input.toStatus,
      reason: input.reason?.trim() || null,
      actorUserId: args.ctx.userId,
      createdAt: now,
    })
    await auditPrivacyRequest({
      requestId: requestRow.id,
      subjectWorkerId: requestRow.subjectWorkerId,
      worksiteId: worker.worksiteId,
      ctx: args.ctx,
      action: "update",
      purpose: `transicion_${requestRow.status}_a_${input.toStatus}`,
      client: tx,
    })
    return updated
  })
}

export async function listPreventionPrivacyRequests(scope: WorksiteScope) {
  if (scope.mode === "none") return []
  const scopeWhere = scope.mode === "some" ? inArray(workers.worksiteId, scope.ids) : undefined
  return db.select({
    request: preventionPrivacyRequests,
    workerName: workers.firstName,
    workerLastName: workers.lastName,
    workerRut: workers.rut,
    worksiteName: worksites.name,
    worksiteId: workers.worksiteId,
  }).from(preventionPrivacyRequests)
    .innerJoin(workers, eq(workers.id, preventionPrivacyRequests.subjectWorkerId))
    .innerJoin(worksites, eq(worksites.id, workers.worksiteId))
    .where(scopeWhere)
    .orderBy(asc(preventionPrivacyRequests.dueAt), desc(preventionPrivacyRequests.receivedAt))
}

export async function getPreventionPrivacyExportDataset(args: {
  requestId: string
  includeClinical: boolean
  purpose: string
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
}) {
  requirePermission(args.permissions, "prevention:privacy:export_subject")
  const purpose = validatePurpose(args.purpose)
  const [requestRow] = await db.select().from(preventionPrivacyRequests)
    .where(eq(preventionPrivacyRequests.id, args.requestId)).limit(1)
  if (!requestRow) throw new Error("Solicitud no encontrada o fuera de alcance.")
  const [worker] = await db.select().from(workers).where(eq(workers.id, requestRow.subjectWorkerId)).limit(1)
  if (!worker || !scopeAllows(args.scope, worker.worksiteId)) {
    throw new Error("Solicitud no encontrada o fuera de alcance.")
  }
  if (!["access", "portability"].includes(requestRow.rightType)) {
    throw new Error("Esta solicitud no habilita una exportación de datos.")
  }
  if (!requestRow.identityVerifiedAt || !["en_proceso", "completada"].includes(requestRow.status)) {
    throw new Error("La identidad debe estar validada antes de exportar.")
  }
  if (args.includeClinical && !args.permissions.includes("prevention:health:view_clinical")) {
    await auditPrivacyRequest({
      requestId: requestRow.id,
      subjectWorkerId: requestRow.subjectWorkerId,
      worksiteId: worker.worksiteId,
      ctx: args.ctx,
      action: "export",
      purpose,
      outcome: "denied",
      reasonCode: "clinical_permission_denied",
    })
    throw new Error("Solicitud no encontrada o fuera de alcance.")
  }

  const [worksite] = await db.select().from(worksites).where(eq(worksites.id, worker.worksiteId)).limit(1)
  const healthRecords = await db.select().from(preventionHealthRecords)
    .where(eq(preventionHealthRecords.workerId, worker.id))
    .orderBy(desc(preventionHealthRecords.createdAt))
  const clinicalPayloads = args.includeClinical
    ? await Promise.all(healthRecords.map(async (record) => ({
        recordId: record.id,
        payload: await getPreventionClinicalPayload(record.id, {
          ctx: args.ctx,
          scope: args.scope,
          permissions: args.permissions,
          purpose: `solicitud_privacidad_${requestRow.id}: ${purpose}`,
        }),
      })))
    : []

  return {
    request: requestRow,
    worker,
    worksite: worksite ?? null,
    healthRecords,
    clinicalPayloads,
    includesClinical: args.includeClinical,
    purpose,
  }
}

export async function recordPreventionPrivacyDelivery(args: {
  requestId: string
  subjectWorkerId: string
  worksiteId: string
  includesClinical: boolean
  healthRecordCount: number
  checksumSha256: string
  purpose: string
  ctx: RequestContext
}) {
  if (!/^[a-f0-9]{64}$/.test(args.checksumSha256)) throw new Error("Checksum de entrega inválido.")
  const now = new Date().toISOString()
  return db.transaction(async (tx) => {
    const [delivery] = await tx.insert(preventionPrivacyDeliveries).values({
      id: `ppd-${nanoid()}`,
      requestId: args.requestId,
      format: "xlsx",
      includesClinical: args.includesClinical,
      healthRecordCount: String(args.healthRecordCount),
      checksumSha256: args.checksumSha256,
      purpose: args.purpose,
      deliveredByUserId: args.ctx.userId,
      deliveredAt: now,
    }).returning()
    await auditPrivacyRequest({
      requestId: args.requestId,
      subjectWorkerId: args.subjectWorkerId,
      worksiteId: args.worksiteId,
      ctx: args.ctx,
      action: "export",
      purpose: args.purpose,
      client: tx,
    })
    return delivery
  })
}

export async function listPreventionSensitiveAccessAudit(scope: WorksiteScope, limit = 500) {
  if (scope.mode === "none") return []
  const scopeWhere = scope.mode === "some"
    ? inArray(preventionSensitiveAccessAudit.worksiteId, scope.ids)
    : undefined
  return db.select().from(preventionSensitiveAccessAudit)
    .where(scopeWhere)
    .orderBy(desc(preventionSensitiveAccessAudit.createdAt))
    .limit(Math.min(Math.max(limit, 1), 2000))
}

export async function listGeneralLibrarySensitiveAccess(scope: WorksiteScope, limit = 500) {
  if (scope.mode === "none") return []
  const scopeWhere = scope.mode === "some"
    ? or(inArray(sstDocuments.worksiteId, scope.ids), isNull(sstDocuments.worksiteId))
    : undefined
  return db.select({
    auditId: sstDocumentAudit.id,
    documentId: sstDocuments.id,
    documentTitle: sstDocuments.title,
    confidentiality: sstDocuments.confidentiality,
    dataClass: sstDocuments.dataClass,
    versionId: sstDocumentAudit.versionId,
    action: sstDocumentAudit.action,
    actorUserId: sstDocumentAudit.userId,
    createdAt: sstDocumentAudit.createdAt,
  })
    .from(sstDocumentAudit)
    .innerJoin(sstDocuments, eq(sstDocuments.id, sstDocumentAudit.documentId))
    .where(and(
      scopeWhere,
      or(
        eq(sstDocuments.confidentiality, "sensible"),
        eq(sstDocuments.dataClass, "sensitive_preventive"),
      ),
      inArray(sstDocumentAudit.action, ["view", "download"]),
    ))
    .orderBy(desc(sstDocumentAudit.createdAt))
    .limit(Math.min(Math.max(limit, 1), 2000))
}
