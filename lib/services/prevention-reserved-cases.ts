import { and, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import {
  preventionReservedCaseMembers,
  preventionReservedCaseSubjects,
  preventionReservedCases,
  preventionSensitiveAccessAudit,
  users,
  workers,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import {
  decryptPreventionPayload,
  encryptPreventionPayload,
} from "@/lib/security/prevention-field-encryption"
import type { RequestContext } from "@/lib/services/prevention-documents/utils"

const reservedCaseCreateSchema = z.object({
  worksiteId: z.string().min(1),
  category: z.enum(["ley_karin", "denuncia_reservada", "investigacion_interna"]),
  payload: z.record(z.string(), z.unknown()),
  memberUserIds: z.array(z.string().min(1)).max(20).default([]),
  subjectLinks: z.array(z.object({
    workerId: z.string().min(1),
    relationship: z.enum(["titular", "afectado", "denunciante", "denunciado", "testigo"]),
    purpose: z.string().trim().min(5).max(300),
  })).max(50).default([]),
})

function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

function hasAnyPermission(permissions: readonly string[]) {
  return permissions.includes("prevention:reserved_case:view")
    || permissions.includes("prevention:reserved_case:investigate")
}

function validatePurpose(purpose: string) {
  const normalized = purpose.trim()
  if (normalized.length < 3 || normalized.length > 300) throw new Error("Propósito de acceso reservado inválido.")
  return normalized
}

async function auditReservedAccess(args: {
  caseId: string
  worksiteId: string
  ctx: RequestContext
  purpose: string
  outcome: "granted" | "denied"
  reasonCode?: string
  action?: "read_reserved" | "create"
}) {
  await db.insert(preventionSensitiveAccessAudit).values({
    id: `psa-${nanoid()}`,
    domain: "reserved_case",
    entityId: args.caseId,
    worksiteId: args.worksiteId,
    actorUserId: args.ctx.userId,
    action: args.action ?? "read_reserved",
    purpose: args.purpose,
    outcome: args.outcome,
    reasonCode: args.reasonCode ?? null,
    ip: args.ctx.ip ?? null,
    userAgent: args.ctx.userAgent ?? null,
    createdAt: new Date().toISOString(),
  })
}

export async function createPreventionReservedCase(args: {
  input: unknown
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
}) {
  if (!args.permissions.includes("prevention:reserved_case:investigate")) {
    throw new Error("No tienes una asignación investigadora nominativa.")
  }
  const input = reservedCaseCreateSchema.parse(args.input)
  if (!scopeAllows(args.scope, input.worksiteId)) throw new Error("Caso no encontrado o fuera de alcance.")
  if (Buffer.byteLength(JSON.stringify(input.payload), "utf8") > 150_000) {
    throw new Error("El contenido reservado supera el máximo permitido.")
  }
  const memberIds = Array.from(new Set([args.ctx.userId, ...input.memberUserIds]))
  const subjectWorkerIds = Array.from(new Set(input.subjectLinks.map((link) => link.workerId)))
  const [memberRows, subjectWorkers] = await Promise.all([
    db.select({ id: users.id, isActive: users.isActive })
      .from(users)
      .where(and(eq(users.isActive, true), inArray(users.id, memberIds))),
    subjectWorkerIds.length
      ? db.select({ id: workers.id, worksiteId: workers.worksiteId, isActive: workers.isActive })
        .from(workers).where(inArray(workers.id, subjectWorkerIds))
      : [],
  ])
  const activeIds = new Set(memberRows.map((row) => row.id))
  if (memberIds.some((id) => !activeIds.has(id))) throw new Error("Uno o más miembros no existen o están inactivos.")
  const subjectWorkerMap = new Map(subjectWorkers.map((worker) => [worker.id, worker]))
  if (input.subjectLinks.some((link) => {
    const worker = subjectWorkerMap.get(link.workerId)
    return !worker?.isActive || worker.worksiteId !== input.worksiteId
  })) {
    throw new Error("Uno o más titulares no existen, están inactivos o pertenecen a otra faena.")
  }

  const id = `prc-${nanoid()}`
  const encrypted = encryptPreventionPayload(input.payload, `reserved:${id}`)
  const now = new Date().toISOString()
  const code = `RES-${now.slice(0, 4)}-${id.slice(-8).toUpperCase()}`
  return db.transaction(async (tx) => {
    const [created] = await tx.insert(preventionReservedCases).values({
      id,
      code,
      worksiteId: input.worksiteId,
      category: input.category,
      status: "abierto",
      ...encrypted,
      createdByUserId: args.ctx.userId,
      createdAt: now,
      updatedAt: now,
    }).returning()
    if (!created) throw new Error("No se pudo crear el caso reservado.")
    await tx.insert(preventionReservedCaseMembers).values(memberIds.map((userId) => ({
      caseId: id,
      userId,
      memberRole: userId === args.ctx.userId ? "investigador" : "revisor",
      purpose: "investigacion_asignada",
      assignedByUserId: args.ctx.userId,
      assignedAt: now,
    })))
    if (input.subjectLinks.length > 0) {
      await tx.insert(preventionReservedCaseSubjects).values(input.subjectLinks.map((link) => ({
        id: `prcs-${nanoid()}`,
        caseId: id,
        workerId: link.workerId,
        relationship: link.relationship,
        linkagePurpose: link.purpose,
        linkedByUserId: args.ctx.userId,
        linkedAt: now,
      }))).onConflictDoNothing()
    }
    await tx.insert(preventionSensitiveAccessAudit).values({
      id: `psa-${nanoid()}`,
      domain: "reserved_case",
      entityId: id,
      worksiteId: input.worksiteId,
      actorUserId: args.ctx.userId,
      action: "create",
      purpose: "creacion_caso_reservado",
      outcome: "granted",
      ip: args.ctx.ip ?? null,
      userAgent: args.ctx.userAgent ?? null,
      createdAt: now,
    })
    return { id: created.id, code: created.code, status: created.status, category: created.category }
  })
}

export async function getPreventionReservedCase<T = Record<string, unknown>>(args: {
  caseId: string
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
  purpose: string
}) {
  const purpose = validatePurpose(args.purpose)
  const [reservedCase] = await db.select().from(preventionReservedCases)
    .where(eq(preventionReservedCases.id, args.caseId))
  if (!reservedCase) throw new Error("Caso no encontrado o fuera de alcance.")
  const permissionAndScope = hasAnyPermission(args.permissions) && scopeAllows(args.scope, reservedCase.worksiteId)
  const [membership] = permissionAndScope
    ? await db.select().from(preventionReservedCaseMembers).where(and(
        eq(preventionReservedCaseMembers.caseId, reservedCase.id),
        eq(preventionReservedCaseMembers.userId, args.ctx.userId),
      ))
    : []
  const allowed = permissionAndScope && Boolean(membership)
  if (!allowed) {
    await auditReservedAccess({
      caseId: reservedCase.id,
      worksiteId: reservedCase.worksiteId,
      ctx: args.ctx,
      purpose,
      outcome: "denied",
      reasonCode: "permission_scope_or_membership_denied",
    })
    throw new Error("Caso no encontrado o fuera de alcance.")
  }

  try {
    const payload = decryptPreventionPayload<T>({
      encryptedPayload: reservedCase.encryptedPayload,
      iv: reservedCase.iv,
      authTag: reservedCase.authTag,
      keyVersion: reservedCase.keyVersion,
    }, `reserved:${reservedCase.id}`)
    await auditReservedAccess({
      caseId: reservedCase.id,
      worksiteId: reservedCase.worksiteId,
      ctx: args.ctx,
      purpose,
      outcome: "granted",
    })
    return { id: reservedCase.id, code: reservedCase.code, category: reservedCase.category, status: reservedCase.status, payload }
  } catch (error) {
    await auditReservedAccess({
      caseId: reservedCase.id,
      worksiteId: reservedCase.worksiteId,
      ctx: args.ctx,
      purpose,
      outcome: "denied",
      reasonCode: "decryption_failed",
    })
    throw error
  }
}
