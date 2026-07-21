import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import {
  preventionHealthClinicalPayloads,
  preventionHealthRecords,
  preventionSensitiveAccessAudit,
  workers,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import {
  decryptPreventionPayload,
  encryptPreventionPayload,
} from "@/lib/security/prevention-field-encryption"
import type { RequestContext } from "@/lib/services/prevention-documents/utils"

const healthRecordCreateSchema = z.object({
  workerId: z.string().min(1),
  worksiteId: z.string().min(1),
  recordType: z.enum(["aptitud", "vigilancia", "examen_ocupacional", "evaluacion_exposicion"]),
  fitnessStatus: z.enum(["pendiente", "apto", "apto_con_restricciones", "no_apto"]),
  restrictionsSummary: z.string().trim().max(1000).optional().nullable(),
  validFrom: z.string().optional().nullable(),
  validUntil: z.string().optional().nullable(),
  issuerName: z.string().trim().max(200).optional().nullable(),
  providerName: z.string().trim().max(200).optional().nullable(),
  clinicalPayload: z.record(z.string(), z.unknown()),
})

interface SensitiveAccessContext {
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
  purpose: string
}

export interface HealthRestrictionProjection {
  id: string
  workerId: string
  worksiteId: string
  recordType: string
  status: string
  fitnessStatus: string
  restrictionsSummary: string | null
  validFrom: string | null
  validUntil: string | null
  issuerName: string | null
  providerName: string | null
}

function hasPermission(permissions: readonly string[], permission: string) {
  return permissions.includes(permission)
}

function validatePurpose(purpose: string) {
  const normalized = purpose.trim()
  if (normalized.length < 3 || normalized.length > 300) {
    throw new Error("Debes indicar un propósito válido para el acceso sensible.")
  }
  return normalized
}

function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

async function auditSensitiveAccess(args: {
  recordId: string
  workerId: string
  worksiteId: string
  ctx: RequestContext
  action: "create" | "read_restrictions" | "read_clinical" | "export"
  purpose: string
  outcome: "granted" | "denied"
  reasonCode?: string
}) {
  await db.insert(preventionSensitiveAccessAudit).values({
    id: `psa-${nanoid()}`,
    domain: "health",
    entityId: args.recordId,
    subjectWorkerId: args.workerId,
    worksiteId: args.worksiteId,
    actorUserId: args.ctx.userId,
    action: args.action,
    purpose: args.purpose,
    outcome: args.outcome,
    reasonCode: args.reasonCode ?? null,
    ip: args.ctx.ip ?? null,
    userAgent: args.ctx.userAgent ?? null,
    createdAt: new Date().toISOString(),
  })
}

function toRestrictionProjection(record: typeof preventionHealthRecords.$inferSelect): HealthRestrictionProjection {
  return {
    id: record.id,
    workerId: record.workerId,
    worksiteId: record.worksiteId,
    recordType: record.recordType,
    status: record.status,
    fitnessStatus: record.fitnessStatus,
    restrictionsSummary: record.restrictionsSummary,
    validFrom: record.validFrom,
    validUntil: record.validUntil,
    issuerName: record.issuerName,
    providerName: record.providerName,
  }
}

export async function createPreventionHealthRecord(args: {
  input: unknown
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
}) {
  if (!hasPermission(args.permissions, "prevention:health:upload_clinical")) {
    throw new Error("No tienes autorización clínica nominativa.")
  }
  const input = healthRecordCreateSchema.parse(args.input)
  if (!scopeAllows(args.scope, input.worksiteId)) throw new Error("Registro no encontrado o fuera de alcance.")
  const [worker] = await db.select({ id: workers.id, worksiteId: workers.worksiteId, isActive: workers.isActive })
    .from(workers).where(and(eq(workers.id, input.workerId), eq(workers.worksiteId, input.worksiteId)))
  if (!worker?.isActive) throw new Error("Trabajador no encontrado o fuera de alcance.")
  const serializedLength = Buffer.byteLength(JSON.stringify(input.clinicalPayload), "utf8")
  if (serializedLength > 100_000) throw new Error("El payload clínico supera el máximo permitido.")

  const id = `phr-${nanoid()}`
  const encrypted = encryptPreventionPayload(input.clinicalPayload, `health:${id}`)
  const now = new Date().toISOString()
  const record = await db.transaction(async (tx) => {
    const [created] = await tx.insert(preventionHealthRecords).values({
      id,
      workerId: input.workerId,
      worksiteId: input.worksiteId,
      recordType: input.recordType,
      status: "vigente",
      fitnessStatus: input.fitnessStatus,
      restrictionsSummary: input.restrictionsSummary || null,
      validFrom: input.validFrom || null,
      validUntil: input.validUntil || null,
      issuerName: input.issuerName || null,
      providerName: input.providerName || null,
      createdByUserId: args.ctx.userId,
      createdAt: now,
      updatedAt: now,
    }).returning()
    if (!created) throw new Error("No se pudo crear el registro de salud.")
    await tx.insert(preventionHealthClinicalPayloads).values({
      id: `phc-${nanoid()}`,
      healthRecordId: id,
      ...encrypted,
      createdByUserId: args.ctx.userId,
      createdAt: now,
      updatedAt: now,
    })
    await tx.insert(preventionSensitiveAccessAudit).values({
      id: `psa-${nanoid()}`,
      domain: "health",
      entityId: id,
      subjectWorkerId: input.workerId,
      worksiteId: input.worksiteId,
      actorUserId: args.ctx.userId,
      action: "create",
      purpose: "registro_clinico_ocupacional",
      outcome: "granted",
      ip: args.ctx.ip ?? null,
      userAgent: args.ctx.userAgent ?? null,
      createdAt: now,
    })
    return created
  })
  return toRestrictionProjection(record)
}

export async function getPreventionHealthRestriction(recordId: string, access: SensitiveAccessContext) {
  const purpose = validatePurpose(access.purpose)
  const [record] = await db.select().from(preventionHealthRecords).where(eq(preventionHealthRecords.id, recordId))
  if (!record) throw new Error("Registro no encontrado o fuera de alcance.")

  const allowed = hasPermission(access.permissions, "prevention:health:view_restrictions")
    && scopeAllows(access.scope, record.worksiteId)
  await auditSensitiveAccess({
    recordId: record.id,
    workerId: record.workerId,
    worksiteId: record.worksiteId,
    ctx: access.ctx,
    action: "read_restrictions",
    purpose,
    outcome: allowed ? "granted" : "denied",
    reasonCode: allowed ? undefined : "permission_or_scope_denied",
  })
  if (!allowed) throw new Error("Registro no encontrado o fuera de alcance.")
  return toRestrictionProjection(record)
}

export async function getPreventionClinicalPayload<T = Record<string, unknown>>(
  recordId: string,
  access: SensitiveAccessContext,
): Promise<T> {
  const purpose = validatePurpose(access.purpose)
  const [record] = await db.select().from(preventionHealthRecords).where(eq(preventionHealthRecords.id, recordId))
  if (!record) throw new Error("Registro no encontrado o fuera de alcance.")
  const allowed = hasPermission(access.permissions, "prevention:health:view_clinical")
    && scopeAllows(access.scope, record.worksiteId)
  if (!allowed) {
    await auditSensitiveAccess({
      recordId: record.id,
      workerId: record.workerId,
      worksiteId: record.worksiteId,
      ctx: access.ctx,
      action: "read_clinical",
      purpose,
      outcome: "denied",
      reasonCode: "permission_or_scope_denied",
    })
    throw new Error("Registro no encontrado o fuera de alcance.")
  }

  const [payload] = await db.select().from(preventionHealthClinicalPayloads)
    .where(eq(preventionHealthClinicalPayloads.healthRecordId, record.id))
  if (!payload) throw new Error("Payload clínico no disponible.")
  try {
    const decrypted = decryptPreventionPayload<T>({
      encryptedPayload: payload.encryptedPayload,
      iv: payload.iv,
      authTag: payload.authTag,
      keyVersion: payload.keyVersion,
    }, `health:${record.id}`)
    await auditSensitiveAccess({
      recordId: record.id,
      workerId: record.workerId,
      worksiteId: record.worksiteId,
      ctx: access.ctx,
      action: "read_clinical",
      purpose,
      outcome: "granted",
    })
    return decrypted
  } catch (error) {
    await auditSensitiveAccess({
      recordId: record.id,
      workerId: record.workerId,
      worksiteId: record.worksiteId,
      ctx: access.ctx,
      action: "read_clinical",
      purpose,
      outcome: "denied",
      reasonCode: "decryption_failed",
    })
    throw error
  }
}
