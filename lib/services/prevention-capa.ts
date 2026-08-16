import { and, asc, desc, eq, inArray, lt, ne, notInArray, sql } from "drizzle-orm"
import { z } from "zod"
import { db, type DB, type Tx } from "@/db"
import {
  preventionCapaActions,
  preventionCapaEvidence,
  preventionCapaFollowups,
  preventionCapaTransitions,
  users,
  worksites,
  worksiteUsers,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { recordOperationalActivity } from "@/lib/services/operational-activity"
import type { RequestContext } from "@/lib/services/prevention-documents/utils"
import type { ReportData } from "@/lib/reports/export"
import type { CapaQuickFilter } from "@/lib/prevention/capa-list-filters"
import { chileDateParts } from "@/lib/utils"

export const CAPA_STATUSES = [
  "pending",
  "in_progress",
  "pending_verification",
  "verified",
  "closed",
  "reopened",
  "cancelled",
] as const

export type CapaStatus = typeof CAPA_STATUSES[number]
export type CapaClient = DB | Tx

function chileToday() {
  const { year, month, day } = chileDateParts()
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function capaQuickFilterWhere(filter: CapaQuickFilter | undefined) {
  if (!filter || filter === "all") return undefined
  if (filter === "open") return notInArray(preventionCapaActions.status, ["closed", "cancelled"])
  if (filter === "overdue") return and(
    notInArray(preventionCapaActions.status, ["verified", "closed", "cancelled"]),
    lt(preventionCapaActions.targetDate, chileToday()),
  )
  if (filter === "pending_verification") return eq(preventionCapaActions.status, "pending_verification")
  if (filter === "unreconciled") return ne(preventionCapaActions.reconciliationStatus, "reconciled")
  return and(
    eq(preventionCapaActions.requiresImmediateStop, true),
    notInArray(preventionCapaActions.status, ["closed", "cancelled"]),
  )
}

const capaCreateSchema = z.object({
  sourceType: z.enum(["pdtp", "sst_evaluation", "ppa", "incident", "risk", "legal_requirement", "training", "work_permit", "inspection", "cphs", "emergency", "change", "epp", "external_engagement", "manual"]),
  sourceId: z.string().min(1).max(200),
  sourceItemId: z.string().min(1).max(300).nullable().optional(),
  worksiteId: z.string().min(1),
  finding: z.string().trim().min(3).max(3000),
  immediateMeasure: z.string().trim().max(3000).nullable().optional(),
  rootCause: z.string().trim().max(3000).nullable().optional(),
  actionDescription: z.string().trim().min(3).max(3000),
  responsibleUserId: z.string().min(1).nullable().optional(),
  responsibleSnapshot: z.string().trim().max(300).nullable().optional(),
  responsibleRole: z.string().trim().max(120).nullable().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha objetivo inválida"),
  evidenceRequired: z.boolean().optional(),
  requiresImmediateStop: z.boolean().optional(),
  /** Módulo 04: deriva prioridad y plazo; `fatal` exige detención inmediata. */
  danoPotencial: z.enum(["leve", "moderado", "grave", "fatal"]).nullable().optional(),
  /** Anexo 8: "Normativa legal aplicable". */
  normativaLegal: z.string().trim().max(500).nullable().optional(),
  reconciliationStatus: z.enum(["reconciled", "needs_assignment", "needs_evidence", "needs_review"]).optional(),
  sourceRef: z.record(z.string(), z.unknown()).nullable().optional(),
})

// Exportado para que transitionCapaActionAction (Server Action) pueda
// validar en el boundary con `parseZ` antes de invocar el servicio —
// misma forma, sin duplicar el schema en un archivo nuevo.
export const capaTransitionSchema = z.object({
  actionId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  toStatus: z.enum(CAPA_STATUSES),
  reason: z.string().trim().max(2000).optional(),
  effectivenessStatus: z.enum(["effective", "ineffective", "not_required"]).optional(),
  effectivenessAssessment: z.string().trim().max(3000).optional(),
  segregationExceptionReason: z.string().trim().max(2000).optional(),
})

export const capaEvidenceSchema = z.object({
  actionId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  kind: z.enum(["document", "photo", "url", "note"]),
  reference: z.string().trim().min(3).max(4000),
  description: z.string().trim().max(1000).nullable().optional(),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
})

export const capaFollowupSchema = z.object({
  actionId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  note: z.string().trim().min(3).max(3000),
  progress: z.number().int().min(0).max(100).nullable().optional(),
})

export const capaUpdateSchema = z.object({
  actionId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  finding: z.string().trim().min(3).max(3000).optional(),
  immediateMeasure: z.string().trim().max(3000).nullable().optional(),
  rootCause: z.string().trim().max(3000).nullable().optional(),
  actionDescription: z.string().trim().min(3).max(3000).optional(),
  responsibleUserId: z.string().min(1).nullable().optional(),
  responsibleSnapshot: z.string().trim().max(300).nullable().optional(),
  responsibleRole: z.string().trim().max(120).nullable().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine((value) => Object.keys(value).some((key) => !["actionId", "expectedVersion"].includes(key)), {
  message: "No hay cambios CAPA para guardar.",
})

export const capaReconcileSchema = z.object({
  actionId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  responsibleUserId: z.string().min(1).nullable(),
  status: z.enum(["reconciled", "needs_assignment", "needs_evidence", "needs_review"]),
  reason: z.string().trim().min(5).max(2000),
})

const TRANSITIONS: Record<CapaStatus, readonly CapaStatus[]> = {
  pending: ["in_progress", "cancelled"],
  in_progress: ["pending_verification", "cancelled"],
  pending_verification: ["verified", "reopened", "cancelled"],
  verified: ["closed", "reopened"],
  closed: ["reopened"],
  reopened: ["in_progress", "cancelled"],
  cancelled: [],
}

const TRANSITION_PERMISSION: Record<CapaStatus, string> = {
  pending: "prevention:capa:manage",
  in_progress: "prevention:capa:complete",
  pending_verification: "prevention:capa:complete",
  verified: "prevention:capa:verify",
  closed: "prevention:capa:close",
  reopened: "prevention:capa:verify",
  cancelled: "prevention:capa:manage",
}

function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

function hasPermission(permissions: readonly string[], permission: string) {
  return permissions.includes(permission)
}

function requirePermission(permissions: readonly string[], permission: string) {
  if (!hasPermission(permissions, permission)) throw new Error("Acción CAPA no encontrada o fuera de alcance.")
}

function requireReason(reason: string | undefined, label: string, min = 5) {
  if ((reason?.trim().length ?? 0) < min) throw new Error(`${label} requiere un motivo de al menos ${min} caracteres.`)
}

export function assertCapaTransition(args: {
  fromStatus: CapaStatus
  toStatus: CapaStatus
  priority: string
  evidenceRequired: boolean
  evidenceCount: number
  creatorUserId: string
  actorUserId: string
  permissions: readonly string[]
  reason?: string
  effectivenessStatus?: "effective" | "ineffective" | "not_required"
  effectivenessAssessment?: string
  segregationExceptionReason?: string
}) {
  if (!TRANSITIONS[args.fromStatus].includes(args.toStatus)) {
    throw new Error(`Transición CAPA inválida: ${args.fromStatus} → ${args.toStatus}.`)
  }
  requirePermission(args.permissions, TRANSITION_PERMISSION[args.toStatus])
  if (["reopened", "cancelled"].includes(args.toStatus)) requireReason(args.reason, "La transición")
  if (args.toStatus === "pending_verification" && args.evidenceRequired && args.evidenceCount === 0) {
    throw new Error("La acción exige evidencia antes de enviarse a verificación.")
  }
  if (args.toStatus === "verified") {
    if (args.evidenceRequired && args.evidenceCount === 0) {
      throw new Error("No se puede verificar una acción sin la evidencia exigida.")
    }
    if (!args.effectivenessStatus || args.effectivenessStatus === "ineffective") {
      throw new Error("La verificación exige una evaluación de eficacia positiva o justificadamente no aplicable.")
    }
    if ((args.effectivenessAssessment?.trim().length ?? 0) < 5) {
      throw new Error("La verificación exige documentar la evaluación de eficacia.")
    }
    const highCritical = args.priority === "high" || args.priority === "critical"
    if (highCritical && args.creatorUserId === args.actorUserId) {
      const canOverride = hasPermission(args.permissions, "prevention:capa:override_segregation")
      if (!canOverride || (args.segregationExceptionReason?.trim().length ?? 0) < 10) {
        throw new Error("Una acción alta o crítica debe ser verificada por una persona distinta de su creador.")
      }
    }
  }
  if (args.toStatus === "closed" && args.fromStatus !== "verified") {
    throw new Error("Sólo una acción verificada puede cerrarse.")
  }
}

async function assertActiveResponsible(client: CapaClient, userId: string | null | undefined) {
  if (!userId) return
  const [user] = await client.select({ id: users.id }).from(users)
    .where(and(eq(users.id, userId), eq(users.isActive, true))).limit(1)
  if (!user) throw new Error("El responsable no existe o está inactivo.")
}

function createCode() {
  return `CAPA-${new Date().getUTCFullYear()}-${nanoid(10).toUpperCase()}`
}

export async function createCapaActionWithClient(
  client: CapaClient,
  input: unknown,
  actorUserId: string,
) {
  const data = capaCreateSchema.parse(input)
  await assertActiveResponsible(client, data.responsibleUserId)
  const id = `capa-${nanoid()}`
  const now = new Date().toISOString()
  const reconciliationStatus = data.reconciliationStatus
    ?? (data.responsibleUserId ? "reconciled" : "needs_assignment")
  const [created] = await client.insert(preventionCapaActions).values({
    id,
    code: createCode(),
    sourceType: data.sourceType,
    sourceId: data.sourceId,
    sourceItemId: data.sourceItemId ?? null,
    worksiteId: data.worksiteId,
    finding: data.finding,
    immediateMeasure: data.immediateMeasure ?? null,
    rootCause: data.rootCause ?? null,
    actionDescription: data.actionDescription,
    responsibleUserId: data.responsibleUserId ?? null,
    responsibleSnapshot: data.responsibleSnapshot ?? null,
    responsibleRole: data.responsibleRole ?? null,
    priority: data.priority,
    targetDate: data.targetDate,
    status: "pending",
    evidenceRequired: data.evidenceRequired ?? true,
    requiresImmediateStop: data.requiresImmediateStop ?? false,
    danoPotencial: data.danoPotencial ?? null,
    normativaLegal: data.normativaLegal?.trim() || null,
    createdByUserId: actorUserId,
    reconciliationStatus,
    sourceRef: data.sourceRef ?? null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  }).returning()
  if (!created) throw new Error("No se pudo crear la acción CAPA.")
  await client.insert(preventionCapaTransitions).values({
    id: `capat-${nanoid()}`,
    actionId: id,
    changeType: "created",
    fromStatus: null,
    toStatus: "pending",
    reason: "Creación de acción CAPA",
    changeSet: { sourceType: data.sourceType, sourceId: data.sourceId },
    actorUserId,
    createdAt: now,
  })
  await recordOperationalActivity({
    eventType: "capa.created",
    module: "capa",
    entityType: "capa_action",
    entityId: created.id,
    entityCode: created.code,
    worksiteId: created.worksiteId,
    actorUserId,
    payload: { status: created.status, priority: created.priority },
  }, client)
  return created
}

export async function createCapaAction(args: {
  input: unknown
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
}) {
  requirePermission(args.permissions, "prevention:capa:manage")
  const data = capaCreateSchema.parse(args.input)
  if (!scopeAllows(args.scope, data.worksiteId)) throw new Error("Acción CAPA no encontrada o fuera de alcance.")
  return db.transaction((tx) => createCapaActionWithClient(tx, data, args.ctx.userId))
}

export async function transitionCapaAction(args: {
  input: unknown
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
}) {
  return db.transaction((tx) => transitionCapaActionWithClient(tx, args.input, args))
}

export async function updateCapaActionWithClient(
  client: CapaClient,
  rawInput: unknown,
  access: { ctx: RequestContext; scope: WorksiteScope; permissions: readonly string[] },
) {
  requirePermission(access.permissions, "prevention:capa:manage")
  const input = capaUpdateSchema.parse(rawInput)
  const [current] = await client.select().from(preventionCapaActions)
    .where(eq(preventionCapaActions.id, input.actionId)).limit(1)
  if (!current || !scopeAllows(access.scope, current.worksiteId)) throw new Error("Acción CAPA no encontrada o fuera de alcance.")
  if (current.version !== input.expectedVersion) throw new Error("La acción cambió en otra sesión. Recarga antes de continuar.")
  if (["closed", "cancelled"].includes(current.status)) throw new Error("No se puede editar una acción cerrada o cancelada.")
  await assertActiveResponsible(client, input.responsibleUserId)

  const now = new Date().toISOString()
  const set: Record<string, unknown> = { version: sql`${preventionCapaActions.version} + 1`, updatedAt: now }
  const changes: Array<{ changeType: "assignment" | "target_date" | "priority" | "followup"; changeSet: Record<string, unknown> }> = []
  const metadataChange: Record<string, unknown> = {}
  for (const key of ["finding", "immediateMeasure", "rootCause", "actionDescription"] as const) {
    if (input[key] !== undefined && input[key] !== current[key]) {
      set[key] = input[key]
      metadataChange[key] = { before: current[key], after: input[key] }
    }
  }
  if (
    input.responsibleUserId !== undefined
    || input.responsibleSnapshot !== undefined
    || input.responsibleRole !== undefined
  ) {
    const after = {
      userId: input.responsibleUserId !== undefined ? input.responsibleUserId : current.responsibleUserId,
      snapshot: input.responsibleSnapshot !== undefined ? input.responsibleSnapshot : current.responsibleSnapshot,
      role: input.responsibleRole !== undefined ? input.responsibleRole : current.responsibleRole,
    }
    set.responsibleUserId = after.userId
    set.responsibleSnapshot = after.snapshot
    set.responsibleRole = after.role
    changes.push({
      changeType: "assignment",
      changeSet: {
        before: { userId: current.responsibleUserId, snapshot: current.responsibleSnapshot, role: current.responsibleRole },
        after,
      },
    })
  }
  if (input.targetDate !== undefined && input.targetDate !== current.targetDate) {
    set.targetDate = input.targetDate
    changes.push({ changeType: "target_date", changeSet: { before: current.targetDate, after: input.targetDate } })
  }
  if (input.priority !== undefined && input.priority !== current.priority) {
    set.priority = input.priority
    changes.push({ changeType: "priority", changeSet: { before: current.priority, after: input.priority } })
  }
  if (Object.keys(metadataChange).length > 0) changes.push({ changeType: "followup", changeSet: metadataChange })
  if (changes.length === 0) return current

  const [updated] = await client.update(preventionCapaActions).set(set).where(and(
    eq(preventionCapaActions.id, current.id),
    eq(preventionCapaActions.version, input.expectedVersion),
  )).returning()
  if (!updated) throw new Error("La acción fue actualizada concurrentemente. Recarga antes de continuar.")
  await client.insert(preventionCapaTransitions).values(changes.map((change) => ({
    id: `capat-${nanoid()}`,
    actionId: current.id,
    changeType: change.changeType,
    fromStatus: current.status,
    toStatus: current.status,
    reason: "Actualización de acción CAPA",
    changeSet: change.changeSet,
    actorUserId: access.ctx.userId,
    createdAt: now,
  })))
  await recordOperationalActivity({
    eventType: "capa.updated",
    module: "capa",
    entityType: "capa_action",
    entityId: updated.id,
    entityCode: updated.code,
    worksiteId: updated.worksiteId,
    actorUserId: access.ctx.userId,
    payload: { status: updated.status, priority: updated.priority },
  }, client)
  return updated
}

export async function updateCapaAction(args: {
  input: unknown
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
}) {
  return db.transaction((tx) => updateCapaActionWithClient(tx, args.input, args))
}

export async function transitionCapaActionWithClient(
  client: CapaClient,
  rawInput: unknown,
  access: { ctx: RequestContext; scope: WorksiteScope; permissions: readonly string[] },
) {
    const input = capaTransitionSchema.parse(rawInput)
    const [current] = await client.select().from(preventionCapaActions)
      .where(eq(preventionCapaActions.id, input.actionId)).limit(1)
    if (!current || !scopeAllows(access.scope, current.worksiteId)) {
      throw new Error("Acción CAPA no encontrada o fuera de alcance.")
    }
    if (current.version !== input.expectedVersion) {
      throw new Error("La acción cambió en otra sesión. Recarga antes de continuar.")
    }
    const evidence = await client.select({ kind: preventionCapaEvidence.kind }).from(preventionCapaEvidence)
      .where(eq(preventionCapaEvidence.actionId, current.id))
    const qualifyingEvidenceCount = evidence.filter((item) => item.kind !== "note").length
    assertCapaTransition({
      fromStatus: current.status as CapaStatus,
      toStatus: input.toStatus,
      priority: current.priority,
      evidenceRequired: current.evidenceRequired,
      evidenceCount: qualifyingEvidenceCount,
      creatorUserId: current.createdByUserId,
      actorUserId: access.ctx.userId,
      permissions: access.permissions,
      reason: input.reason,
      effectivenessStatus: input.effectivenessStatus,
      effectivenessAssessment: input.effectivenessAssessment,
      segregationExceptionReason: input.segregationExceptionReason,
    })

    const now = new Date().toISOString()
    const set: Record<string, unknown> = {
      status: input.toStatus,
      version: sql`${preventionCapaActions.version} + 1`,
      updatedAt: now,
    }
    if (input.toStatus === "in_progress") {
      set.startedByUserId = access.ctx.userId
      set.startedAt = now
    }
    if (input.toStatus === "pending_verification") {
      set.completedByUserId = access.ctx.userId
      set.completedAt = now
    }
    if (input.toStatus === "verified") {
      set.verifiedByUserId = access.ctx.userId
      set.verifiedAt = now
      set.effectivenessStatus = input.effectivenessStatus
      set.effectivenessAssessment = input.effectivenessAssessment!.trim()
      set.effectivenessAssessedByUserId = access.ctx.userId
      set.effectivenessAssessedAt = now
    }
    if (input.toStatus === "closed") {
      set.closedByUserId = access.ctx.userId
      set.closedAt = now
    }
    if (input.toStatus === "reopened") {
      set.reopenedByUserId = access.ctx.userId
      set.reopenedAt = now
      set.reopenedReason = input.reason!.trim()
      set.effectivenessStatus = input.effectivenessStatus === "ineffective" ? "ineffective" : current.effectivenessStatus
      set.closedByUserId = null
      set.closedAt = null
      set.verifiedByUserId = null
      set.verifiedAt = null
    }
    if (input.toStatus === "cancelled") {
      set.cancelledByUserId = access.ctx.userId
      set.cancelledAt = now
      set.cancellationReason = input.reason!.trim()
    }

    const [updated] = await client.update(preventionCapaActions).set(set).where(and(
      eq(preventionCapaActions.id, current.id),
      eq(preventionCapaActions.status, current.status),
      eq(preventionCapaActions.version, input.expectedVersion),
    )).returning()
    if (!updated) throw new Error("La acción fue actualizada concurrentemente. Recarga antes de continuar.")

    await client.insert(preventionCapaTransitions).values({
      id: `capat-${nanoid()}`,
      actionId: current.id,
      changeType: "status",
      fromStatus: current.status,
      toStatus: input.toStatus,
      reason: input.reason?.trim() || null,
      changeSet: {
        effectivenessStatus: input.effectivenessStatus ?? null,
        effectivenessAssessment: input.effectivenessAssessment ?? null,
        segregationOverride: input.segregationExceptionReason
          ? { reason: input.segregationExceptionReason, actorUserId: access.ctx.userId }
          : null,
      },
      actorUserId: access.ctx.userId,
      createdAt: now,
    })
    await recordOperationalActivity({
      eventType: "capa.transitioned",
      module: "capa",
      entityType: "capa_action",
      entityId: updated.id,
      entityCode: updated.code,
      worksiteId: updated.worksiteId,
      actorUserId: access.ctx.userId,
      payload: { fromStatus: current.status, toStatus: updated.status, priority: updated.priority },
    }, client)
    return updated
}

export async function addCapaEvidenceWithClient(
  client: CapaClient,
  rawInput: unknown,
  access: { ctx: RequestContext; scope: WorksiteScope; permissions: readonly string[] },
) {
    requirePermission(access.permissions, "prevention:capa:complete")
    const input = capaEvidenceSchema.parse(rawInput)
    const [current] = await client.select().from(preventionCapaActions)
      .where(eq(preventionCapaActions.id, input.actionId)).limit(1)
    if (!current || !scopeAllows(access.scope, current.worksiteId)) throw new Error("Acción CAPA no encontrada o fuera de alcance.")
    if (current.version !== input.expectedVersion) throw new Error("La acción cambió en otra sesión. Recarga antes de continuar.")
    if (["closed", "cancelled"].includes(current.status)) throw new Error("No se puede agregar evidencia a una acción cerrada o cancelada.")
    const now = new Date().toISOString()
    const [evidence] = await client.insert(preventionCapaEvidence).values({
      id: `capae-${nanoid()}`,
      actionId: current.id,
      kind: input.kind,
      reference: input.reference,
      description: input.description ?? null,
      checksumSha256: input.checksumSha256 ?? null,
      uploadedByUserId: access.ctx.userId,
      createdAt: now,
    }).returning()
    const [updated] = await client.update(preventionCapaActions).set({
      version: sql`${preventionCapaActions.version} + 1`, updatedAt: now,
    }).where(and(eq(preventionCapaActions.id, current.id), eq(preventionCapaActions.version, input.expectedVersion))).returning()
    if (!updated) throw new Error("La acción fue actualizada concurrentemente. Recarga antes de continuar.")
    await client.insert(preventionCapaTransitions).values({
      id: `capat-${nanoid()}`, actionId: current.id, changeType: "evidence",
      fromStatus: current.status, toStatus: current.status, reason: input.description ?? "Evidencia agregada",
      changeSet: { evidenceId: evidence!.id, kind: input.kind }, actorUserId: access.ctx.userId, createdAt: now,
    })
    return { evidence: evidence!, action: updated }
}

export async function addCapaEvidence(args: {
  input: unknown
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
}) {
  return db.transaction((tx) => addCapaEvidenceWithClient(tx, args.input, args))
}

export async function addCapaFollowupWithClient(
  client: CapaClient,
  rawInput: unknown,
  access: { ctx: RequestContext; scope: WorksiteScope; permissions: readonly string[] },
) {
    requirePermission(access.permissions, "prevention:capa:manage")
    const input = capaFollowupSchema.parse(rawInput)
    const [current] = await client.select().from(preventionCapaActions)
      .where(eq(preventionCapaActions.id, input.actionId)).limit(1)
    if (!current || !scopeAllows(access.scope, current.worksiteId)) throw new Error("Acción CAPA no encontrada o fuera de alcance.")
    if (current.version !== input.expectedVersion) throw new Error("La acción cambió en otra sesión. Recarga antes de continuar.")
    const now = new Date().toISOString()
    const [followup] = await client.insert(preventionCapaFollowups).values({
      id: `capaf-${nanoid()}`, actionId: current.id, note: input.note,
      progress: input.progress ?? null, createdByUserId: access.ctx.userId, createdAt: now,
    }).returning()
    const [updated] = await client.update(preventionCapaActions).set({
      version: sql`${preventionCapaActions.version} + 1`, updatedAt: now,
    }).where(and(eq(preventionCapaActions.id, current.id), eq(preventionCapaActions.version, input.expectedVersion))).returning()
    if (!updated) throw new Error("La acción fue actualizada concurrentemente. Recarga antes de continuar.")
    await client.insert(preventionCapaTransitions).values({
      id: `capat-${nanoid()}`, actionId: current.id, changeType: "followup",
      fromStatus: current.status, toStatus: current.status, reason: input.note,
      changeSet: { followupId: followup!.id, progress: input.progress ?? null },
      actorUserId: access.ctx.userId, createdAt: now,
    })
    return { followup: followup!, action: updated }
}

export async function addCapaFollowup(args: {
  input: unknown
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
}) {
  return db.transaction((tx) => addCapaFollowupWithClient(tx, args.input, args))
}

export async function listCapaActions(args: {
  scope: WorksiteScope
  permissions: readonly string[]
  status?: CapaStatus
  sourceType?: string
  worksiteId?: string
  limit?: number
  offset?: number
}) {
  requirePermission(args.permissions, "prevention:capa:view")
  if (args.scope.mode === "none") return []
  if (args.worksiteId && !scopeAllows(args.scope, args.worksiteId)) return []
  const effectiveLimit = Math.min(args.limit ?? 500, 500)
  const offset = args.offset ?? 0
  const scopeWhere = args.worksiteId
    ? eq(preventionCapaActions.worksiteId, args.worksiteId)
    : args.scope.mode === "some"
      ? inArray(preventionCapaActions.worksiteId, args.scope.ids)
      : undefined
  return db.select().from(preventionCapaActions).where(and(
    scopeWhere,
    args.status ? eq(preventionCapaActions.status, args.status) : undefined,
    args.sourceType ? eq(preventionCapaActions.sourceType, args.sourceType) : undefined,
  )).orderBy(desc(preventionCapaActions.createdAt)).limit(effectiveLimit).offset(offset)
}

export async function listCapaActionsPage(args: {
  scope: WorksiteScope
  permissions: readonly string[]
  status?: CapaStatus
  sourceType?: string
  worksiteId?: string
  quickFilter?: CapaQuickFilter
  limit?: number
  offset?: number
}) {
  requirePermission(args.permissions, "prevention:capa:view")
  if (args.scope.mode === "none") return { rows: [], total: 0, limit: args.limit ?? 50, offset: args.offset ?? 0 }
  if (args.worksiteId && !scopeAllows(args.scope, args.worksiteId)) return { rows: [], total: 0, limit: args.limit ?? 50, offset: args.offset ?? 0 }
  const effectiveLimit = Math.min(args.limit ?? 50, 500)
  const effectiveOffset = args.offset ?? 0
  const scopeWhere = args.worksiteId
    ? eq(preventionCapaActions.worksiteId, args.worksiteId)
    : args.scope.mode === "some"
      ? inArray(preventionCapaActions.worksiteId, args.scope.ids)
      : undefined
  const where = and(
    scopeWhere,
    args.status ? eq(preventionCapaActions.status, args.status) : undefined,
    args.sourceType ? eq(preventionCapaActions.sourceType, args.sourceType) : undefined,
    capaQuickFilterWhere(args.quickFilter),
  )
  const [rows, [totalRow]] = await Promise.all([
    db.select().from(preventionCapaActions).where(where).orderBy(desc(preventionCapaActions.createdAt)).limit(effectiveLimit).offset(effectiveOffset),
    db.select({ count: sql<number>`count(*)::int` }).from(preventionCapaActions).where(where),
  ])
  return { rows, total: totalRow?.count ?? 0, limit: effectiveLimit, offset: effectiveOffset }
}

export async function getCapaActionBundle(args: {
  actionId: string
  scope: WorksiteScope
  permissions: readonly string[]
}) {
  requirePermission(args.permissions, "prevention:capa:view")
  const [action] = await db.select().from(preventionCapaActions)
    .where(eq(preventionCapaActions.id, args.actionId)).limit(1)
  if (!action || !scopeAllows(args.scope, action.worksiteId)) throw new Error("Acción CAPA no encontrada o fuera de alcance.")
  const [transitions, followups, evidence] = await Promise.all([
    db.select().from(preventionCapaTransitions).where(eq(preventionCapaTransitions.actionId, action.id)).orderBy(preventionCapaTransitions.createdAt),
    db.select().from(preventionCapaFollowups).where(eq(preventionCapaFollowups.actionId, action.id)).orderBy(preventionCapaFollowups.createdAt),
    db.select().from(preventionCapaEvidence).where(eq(preventionCapaEvidence.actionId, action.id)).orderBy(preventionCapaEvidence.createdAt),
  ])
  return { action, transitions, followups, evidence }
}

export async function getCapaDashboardCounts(args: {
  scope: WorksiteScope
  permissions: readonly string[]
}) {
  requirePermission(args.permissions, "prevention:capa:view")
  if (args.scope.mode === "none") {
    return { open: 0, overdue: 0, pendingVerification: 0, unreconciled: 0, immediateStop: 0 }
  }
  const scopeWhere = args.scope.mode === "some"
    ? inArray(preventionCapaActions.worksiteId, args.scope.ids)
    : undefined
  const today = chileToday()
  const [row] = await db.select({
    open: sql<number>`count(*) filter (where ${preventionCapaActions.status} not in ('closed', 'cancelled'))::int`,
    overdue: sql<number>`count(*) filter (where ${preventionCapaActions.status} not in ('verified', 'closed', 'cancelled') and ${preventionCapaActions.targetDate} < ${today})::int`,
    pendingVerification: sql<number>`count(*) filter (where ${preventionCapaActions.status} = 'pending_verification')::int`,
    unreconciled: sql<number>`count(*) filter (where ${preventionCapaActions.reconciliationStatus} <> 'reconciled')::int`,
    immediateStop: sql<number>`count(*) filter (where ${preventionCapaActions.requiresImmediateStop} = true and ${preventionCapaActions.status} not in ('closed', 'cancelled'))::int`,
  }).from(preventionCapaActions).where(scopeWhere)
  return {
    open: row?.open ?? 0,
    overdue: row?.overdue ?? 0,
    pendingVerification: row?.pendingVerification ?? 0,
    unreconciled: row?.unreconciled ?? 0,
    immediateStop: row?.immediateStop ?? 0,
  }
}

export async function listAssignableCapaUsers(args: {
  worksiteId: string
  scope: WorksiteScope
  permissions: readonly string[]
}) {
  requirePermission(args.permissions, "prevention:capa:view")
  if (!scopeAllows(args.scope, args.worksiteId)) return []
  return db.selectDistinct({ id: users.id, name: users.name })
    .from(users)
    .innerJoin(worksiteUsers, and(
      eq(worksiteUsers.userId, users.id),
      eq(worksiteUsers.worksiteId, args.worksiteId),
    ))
    .where(eq(users.isActive, true))
    .orderBy(asc(users.name))
}

export async function listCapaWorksites(args: {
  scope: WorksiteScope
  permissions: readonly string[]
}) {
  requirePermission(args.permissions, "prevention:capa:view")
  if (args.scope.mode === "none") return []
  return db.select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(and(
      eq(worksites.isActive, true),
      args.scope.mode === "some" ? inArray(worksites.id, args.scope.ids) : undefined,
    ))
    .orderBy(asc(worksites.name))
}

export async function reconcileCapaAction(args: {
  input: unknown
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
}) {
  requirePermission(args.permissions, "prevention:capa:reconcile")
  const input = capaReconcileSchema.parse(args.input)
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(preventionCapaActions)
      .where(eq(preventionCapaActions.id, input.actionId)).limit(1)
    if (!current || !scopeAllows(args.scope, current.worksiteId)) {
      throw new Error("Acción CAPA no encontrada o fuera de alcance.")
    }
    if (current.version !== input.expectedVersion) throw new Error("La acción cambió en otra sesión. Recarga antes de continuar.")
    await assertActiveResponsible(tx, input.responsibleUserId)
    if (input.status === "reconciled" && !input.responsibleUserId) {
      throw new Error("Una CAPA conciliada debe tener un responsable activo asignado.")
    }
    if (input.status === "reconciled" && current.evidenceRequired && ["pending_verification", "verified", "closed"].includes(current.status)) {
      const evidence = await tx.select({ kind: preventionCapaEvidence.kind }).from(preventionCapaEvidence)
        .where(eq(preventionCapaEvidence.actionId, current.id))
      if (!evidence.some((item) => item.kind !== "note")) {
        throw new Error("La acción histórica no puede conciliarse sin evidencia verificable.")
      }
    }
    const now = new Date().toISOString()
    const [updated] = await tx.update(preventionCapaActions).set({
      responsibleUserId: input.responsibleUserId,
      reconciliationStatus: input.status,
      version: sql`${preventionCapaActions.version} + 1`,
      updatedAt: now,
    }).where(and(
      eq(preventionCapaActions.id, current.id),
      eq(preventionCapaActions.version, input.expectedVersion),
    )).returning()
    if (!updated) throw new Error("La acción fue actualizada concurrentemente. Recarga antes de continuar.")
    await tx.insert(preventionCapaTransitions).values({
      id: `capat-${nanoid()}`,
      actionId: current.id,
      changeType: "assignment",
      fromStatus: current.status,
      toStatus: current.status,
      reason: input.reason,
      changeSet: {
        before: { responsibleUserId: current.responsibleUserId, reconciliationStatus: current.reconciliationStatus },
        after: { responsibleUserId: input.responsibleUserId, reconciliationStatus: input.status },
      },
      actorUserId: args.ctx.userId,
      createdAt: now,
    })
    await recordOperationalActivity({
      eventType: "capa.updated",
      module: "capa",
      entityType: "capa_action",
      entityId: updated.id,
      entityCode: updated.code,
      worksiteId: updated.worksiteId,
      actorUserId: args.ctx.userId,
      payload: { status: updated.status, reconciliationStatus: updated.reconciliationStatus },
    }, tx)
    return updated
  })
}

function capaStatusLabel(status: string) {
  return ({
    pending: "Pendiente",
    in_progress: "En proceso",
    pending_verification: "Pendiente de verificación",
    verified: "Verificada",
    closed: "Cerrada",
    reopened: "Reabierta",
    cancelled: "Cancelada",
  } as Record<string, string>)[status] ?? status
}

function excelSafe(value: string | null | undefined) {
  const text = value ?? ""
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

export async function buildCapaExport(args: {
  scope: WorksiteScope
  permissions: readonly string[]
}): Promise<ReportData> {
  const actions = await listCapaActions(args)
  const actionIds = actions.slice(0, 10_000).map((item) => item.id)
  const rowLimitApplied = actions.length > 10_000
  if (actionIds.length === 0) {
    return {
      filenameBase: `capa_${new Date().toISOString().slice(0, 10)}`,
      worksheetName: "Acciones CAPA",
      headers: ["Código", "Fuente", "Estado"],
      rows: [],
      rowLimitApplied,
    }
  }
  const [transitions, evidence, followups, worksiteRows, userRows] = await Promise.all([
    db.select().from(preventionCapaTransitions).where(inArray(preventionCapaTransitions.actionId, actionIds)).orderBy(asc(preventionCapaTransitions.createdAt)),
    db.select().from(preventionCapaEvidence).where(inArray(preventionCapaEvidence.actionId, actionIds)).orderBy(asc(preventionCapaEvidence.createdAt)),
    db.select().from(preventionCapaFollowups).where(inArray(preventionCapaFollowups.actionId, actionIds)).orderBy(asc(preventionCapaFollowups.createdAt)),
    db.select({ id: worksites.id, name: worksites.name }).from(worksites)
      .where(inArray(worksites.id, [...new Set(actions.map((item) => item.worksiteId))])),
    db.select({ id: users.id, name: users.name }).from(users)
      .where(inArray(users.id, [
        ...new Set(actions.flatMap((item) => [item.responsibleUserId, item.createdByUserId, item.completedByUserId, item.verifiedByUserId].filter((id): id is string => id !== null && id !== undefined))),
      ])),
  ])
  const worksiteName = new Map(worksiteRows.map((item) => [item.id, item.name]))
  const userName = new Map(userRows.map((item) => [item.id, item.name]))
  const evidenceCount = new Map<string, number>()
  for (const item of evidence) {
    if (item.kind !== "note") evidenceCount.set(item.actionId, (evidenceCount.get(item.actionId) ?? 0) + 1)
  }
  return {
    filenameBase: `capa_${new Date().toISOString().slice(0, 10)}`,
    worksheetName: "Acciones CAPA",
    headers: [
      "Código", "Fuente", "ID fuente", "Faena", "Hallazgo", "Medida inmediata", "Causa raíz",
      "Acción", "Responsable", "Responsable histórico", "Prioridad", "Fecha objetivo", "Estado",
      "Evidencia exigida", "Evidencias", "Eficacia", "Evaluación de eficacia", "Conciliación",
      "Creada por", "Creada", "Completada por", "Completada", "Verificada por", "Verificada",
      "Cerrada por", "Cerrada", "Versión",
    ],
    rows: actions.slice(0, 10_000).map((item) => [
      item.code, item.sourceType, item.sourceId, worksiteName.get(item.worksiteId) ?? item.worksiteId,
      excelSafe(item.finding), excelSafe(item.immediateMeasure), excelSafe(item.rootCause), excelSafe(item.actionDescription),
      item.responsibleUserId ? userName.get(item.responsibleUserId) ?? item.responsibleUserId : "Sin asignar",
      excelSafe(item.responsibleSnapshot), item.priority, item.targetDate, capaStatusLabel(item.status),
      item.evidenceRequired ? "Sí" : "No", evidenceCount.get(item.id) ?? 0, item.effectivenessStatus,
      excelSafe(item.effectivenessAssessment), item.reconciliationStatus,
      userName.get(item.createdByUserId) ?? item.createdByUserId, item.createdAt,
      item.completedByUserId ? userName.get(item.completedByUserId) ?? item.completedByUserId : "", item.completedAt ?? "",
      item.verifiedByUserId ? userName.get(item.verifiedByUserId) ?? item.verifiedByUserId : "", item.verifiedAt ?? "",
      item.closedByUserId ? userName.get(item.closedByUserId) ?? item.closedByUserId : "", item.closedAt ?? "", item.version,
    ]),
    sheets: [
      {
        worksheetName: "Acciones CAPA",
        headers: [
          "Código", "Fuente", "ID fuente", "Faena", "Hallazgo", "Medida inmediata", "Causa raíz",
          "Acción", "Responsable", "Responsable histórico", "Prioridad", "Fecha objetivo", "Estado",
          "Evidencia exigida", "Evidencias", "Eficacia", "Evaluación de eficacia", "Conciliación",
          "Creada por", "Creada", "Completada por", "Completada", "Verificada por", "Verificada",
          "Cerrada por", "Cerrada", "Versión",
        ],
        rows: actions.slice(0, 10_000).map((item) => [
          item.code, item.sourceType, item.sourceId, worksiteName.get(item.worksiteId) ?? item.worksiteId,
          excelSafe(item.finding), excelSafe(item.immediateMeasure), excelSafe(item.rootCause), excelSafe(item.actionDescription),
          item.responsibleUserId ? userName.get(item.responsibleUserId) ?? item.responsibleUserId : "Sin asignar",
          excelSafe(item.responsibleSnapshot), item.priority, item.targetDate, capaStatusLabel(item.status),
          item.evidenceRequired ? "Sí" : "No", evidenceCount.get(item.id) ?? 0, item.effectivenessStatus,
          excelSafe(item.effectivenessAssessment), item.reconciliationStatus,
          userName.get(item.createdByUserId) ?? item.createdByUserId, item.createdAt,
          item.completedByUserId ? userName.get(item.completedByUserId) ?? item.completedByUserId : "", item.completedAt ?? "",
          item.verifiedByUserId ? userName.get(item.verifiedByUserId) ?? item.verifiedByUserId : "", item.verifiedAt ?? "",
          item.closedByUserId ? userName.get(item.closedByUserId) ?? item.closedByUserId : "", item.closedAt ?? "", item.version,
        ]),
      },
      {
        worksheetName: "Transiciones",
        headers: ["Acción", "Tipo", "Estado anterior", "Estado nuevo", "Motivo", "Actor", "Fecha"],
        rows: transitions.map((item) => [
          item.actionId, item.changeType, capaStatusLabel(item.fromStatus ?? ""), capaStatusLabel(item.toStatus ?? ""),
          excelSafe(item.reason), userName.get(item.actorUserId) ?? item.actorUserId, item.createdAt,
        ]),
      },
      {
        worksheetName: "Evidencias",
        headers: ["Acción", "Tipo", "Referencia", "Descripción", "SHA-256", "Cargada por", "Fecha"],
        rows: evidence.map((item) => [
          item.actionId, item.kind, excelSafe(item.reference), excelSafe(item.description), item.checksumSha256 ?? "",
          userName.get(item.uploadedByUserId) ?? item.uploadedByUserId, item.createdAt,
        ]),
      },
      {
        worksheetName: "Seguimientos",
        headers: ["Acción", "Nota", "Avance", "Registrado por", "Fecha"],
        rows: followups.map((item) => [
          item.actionId, excelSafe(item.note), item.progress ?? "", userName.get(item.createdByUserId) ?? item.createdByUserId, item.createdAt,
        ]),
      },
    ],
    rowLimitApplied,
  }
}
