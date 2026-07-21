import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { db, type DB, type Tx } from "@/db"
import {
  preventionChangeAssessments,
  preventionChangeHistory,
  preventionChangeRequests,
  users,
  worksites,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { assessChangeReadiness, CHANGE_DIMENSIONS } from "@/lib/prevention/change"
import { createCapaActionWithClient } from "@/lib/services/prevention-capa"
import { getUserIdsWithPermission } from "@/lib/services/notification-targeting"

type Client = DB | Tx

export interface ChangeAccess {
  userId: string
  scope: WorksiteScope
  permissions: readonly string[]
}

const NOT_FOUND = "Registro de gestión del cambio no encontrado o fuera de alcance."

function nowIso() {
  return new Date().toISOString()
}

function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

function requireAccess(access: ChangeAccess, permission: string, worksiteId?: string) {
  if (!access.permissions.includes(permission) || (worksiteId && !scopeAllows(access.scope, worksiteId))) {
    throw new Error(NOT_FOUND)
  }
}

function scopeCondition(scope: WorksiteScope, column: AnyPgColumn) {
  if (scope.mode === "all") return undefined
  if (scope.mode === "none" || scope.ids.length === 0) return sql`false`
  return inArray(column, scope.ids)
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
  await client.insert(preventionChangeHistory).values({
    id: `pchgh-${nanoid()}`,
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

const OPEN_STATUSES = ["draft", "under_evaluation"]

/* ── Solicitud de cambio ──────────────────────────────────────────────────── */

// Exportado para que createChangeRequestAction (Server Action) pueda
// validar en el boundary con `parseZ` antes de invocar este servicio —
// misma forma, sin duplicar el schema.
export const createSchema = z.object({
  worksiteId: z.string().min(1),
  title: z.string().trim().min(3).max(200),
  changeType: z.enum(["proceso", "instalacion", "equipo", "sustancia", "proveedor", "requisito_legal", "dotacion", "software", "procedimiento", "mandante"]),
  description: z.string().trim().min(10).max(5000),
  reason: z.string().trim().min(5).max(3000),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).default("medium"),
})

/** Nace en preparación con las seis dimensiones de impacto pendientes de evaluar. */
export async function createChangeRequest(input: unknown, access: ChangeAccess) {
  const data = createSchema.parse(input)
  requireAccess(access, "prevention:change:manage", data.worksiteId)

  return db.transaction(async (tx) => {
    const [created] = await tx.insert(preventionChangeRequests).values({
      id: `pchg-${nanoid()}`,
      worksiteId: data.worksiteId,
      code: `GC-${new Date().getUTCFullYear()}-${nanoid(6).toUpperCase()}`,
      title: data.title,
      changeType: data.changeType,
      description: data.description,
      reason: data.reason,
      riskLevel: data.riskLevel,
      requestedByUserId: access.userId,
    }).returning()
    if (!created) throw new Error("No se pudo crear el cambio.")

    await tx.insert(preventionChangeAssessments).values(CHANGE_DIMENSIONS.map((dimension) => ({
      id: `pchga-${nanoid()}`,
      changeRequestId: created.id,
      dimension,
    })))

    await history(tx, { entityType: "change_request", entityId: created.id, worksiteId: data.worksiteId, changeType: "created", reason: `Cambio creado: ${data.title}`, afterState: created, actorUserId: access.userId })
    return created
  })
}

// Exportado para que evaluateChangeDimensionAction (Server Action) pueda
// validar en el boundary con `parseZ`.
export const evaluateSchema = z.object({
  changeRequestId: z.string().min(1),
  dimension: z.enum(CHANGE_DIMENSIONS),
  impacted: z.boolean(),
  notes: z.string().trim().max(3000).nullable().optional(),
  actionRequired: z.boolean().default(false),
  actionDescription: z.string().trim().max(3000).nullable().optional(),
  responsibleUserId: z.string().min(1).nullable().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.actionRequired && !value.actionDescription) {
    ctx.addIssue({ code: "custom", path: ["actionDescription"], message: "Una dimensión que requiere acción necesita describirla." })
  }
  if (value.actionRequired && !value.targetDate) {
    ctx.addIssue({ code: "custom", path: ["targetDate"], message: "Una dimensión que requiere acción necesita un plazo." })
  }
})

/**
 * Evalúa una dimensión de impacto. Si requiere acción, la deriva a CAPA
 * común en la misma transacción (sourceType = 'change', sourceId = el
 * propio cambio): la acción correctiva es un prerrequisito para implementar
 * el cambio, no una consecuencia posterior a su aprobación.
 */
export async function evaluateChangeDimension(input: unknown, access: ChangeAccess) {
  const data = evaluateSchema.parse(input)
  return db.transaction(async (tx) => {
    const [request] = await tx.select().from(preventionChangeRequests).where(eq(preventionChangeRequests.id, data.changeRequestId)).limit(1)
    if (!request) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:change:evaluate", request.worksiteId)
    if (!OPEN_STATUSES.includes(request.status)) throw new Error("Un cambio ya decidido no admite nuevas evaluaciones.")

    const [assessment] = await tx.select().from(preventionChangeAssessments)
      .where(and(
        eq(preventionChangeAssessments.changeRequestId, data.changeRequestId),
        eq(preventionChangeAssessments.dimension, data.dimension),
      )).limit(1)
    if (!assessment) throw new Error(NOT_FOUND)

    let capaActionId: string | null = null
    if (data.actionRequired) {
      const capa = await createCapaActionWithClient(tx, {
        sourceType: "change",
        sourceId: request.id,
        worksiteId: request.worksiteId,
        finding: `${data.dimension}: ${data.notes?.trim() || "impacto detectado en la evaluación del cambio"}`,
        actionDescription: data.actionDescription!,
        responsibleUserId: data.responsibleUserId ?? null,
        priority: data.priority,
        targetDate: data.targetDate!,
        evidenceRequired: true,
      }, access.userId)
      capaActionId = capa.id
    }

    const now = nowIso()
    const [updated] = await tx.update(preventionChangeAssessments).set({
      evaluated: true,
      impacted: data.impacted,
      notes: data.notes ?? null,
      actionRequired: data.actionRequired,
      capaActionId,
      evaluatedByUserId: access.userId,
      evaluatedAt: now,
      updatedAt: now,
    }).where(eq(preventionChangeAssessments.id, assessment.id)).returning()
    if (!updated) throw new Error("No se pudo registrar la evaluación.")

    if (request.status === "draft") {
      await tx.update(preventionChangeRequests).set({ status: "under_evaluation", updatedAt: now })
        .where(eq(preventionChangeRequests.id, request.id))
    }

    await history(tx, { entityType: "assessment", entityId: updated.id, worksiteId: request.worksiteId, changeType: "evaluated", reason: `Dimensión ${data.dimension} evaluada`, beforeState: assessment, afterState: updated, actorUserId: access.userId })
    return updated
  })
}

// Exportado para que approveChangeRequestAction (Server Action) pueda
// validar en el boundary con `parseZ`.
export const approveSchema = z.object({
  changeRequestId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  plannedReviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

/**
 * Aprobar exige las seis dimensiones evaluadas y una fecha de revisión
 * posterior (assessChangeReadiness), y que quien aprueba no sea quien
 * solicitó el cambio — misma segregación que permisos de trabajo, plantillas
 * de inspección y planes de emergencia.
 */
export async function approveChangeRequest(input: unknown, access: ChangeAccess) {
  const data = approveSchema.parse(input)
  return db.transaction(async (tx) => {
    const [request] = await tx.select().from(preventionChangeRequests).where(eq(preventionChangeRequests.id, data.changeRequestId)).limit(1)
    if (!request) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:change:approve", request.worksiteId)
    if (request.version !== data.expectedVersion) throw new Error("El cambio cambió mientras lo editabas. Recarga y reintenta.")
    if (!OPEN_STATUSES.includes(request.status)) throw new Error("El cambio ya fue decidido.")
    if (request.requestedByUserId === access.userId) throw new Error("Quien solicita el cambio no puede aprobarlo.")

    const assessments = await tx.select({ dimension: preventionChangeAssessments.dimension, evaluated: preventionChangeAssessments.evaluated })
      .from(preventionChangeAssessments).where(eq(preventionChangeAssessments.changeRequestId, request.id))
    const readiness = assessChangeReadiness({ assessments, plannedReviewDate: data.plannedReviewDate })
    if (!readiness.ready) throw new Error(readiness.blockers.join(" "))

    const now = nowIso()
    const [updated] = await tx.update(preventionChangeRequests).set({
      status: "approved",
      approvedByUserId: access.userId,
      approvedAt: now,
      plannedReviewDate: data.plannedReviewDate,
      version: request.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionChangeRequests.id, request.id),
      eq(preventionChangeRequests.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("El cambio cambió mientras lo editabas. Recarga y reintenta.")
    await history(tx, { entityType: "change_request", entityId: request.id, worksiteId: request.worksiteId, changeType: "approved", reason: "Cambio aprobado", beforeState: request, afterState: updated, actorUserId: access.userId })
    return updated
  })
}

// Exportado para que rejectChangeRequestAction (Server Action) pueda
// validar en el boundary con `parseZ`.
export const rejectSchema = z.object({
  changeRequestId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  rejectedReason: z.string().trim().min(5).max(3000),
})

export async function rejectChangeRequest(input: unknown, access: ChangeAccess) {
  const data = rejectSchema.parse(input)
  return db.transaction(async (tx) => {
    const [request] = await tx.select().from(preventionChangeRequests).where(eq(preventionChangeRequests.id, data.changeRequestId)).limit(1)
    if (!request) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:change:approve", request.worksiteId)
    if (request.version !== data.expectedVersion) throw new Error("El cambio cambió mientras lo editabas. Recarga y reintenta.")
    if (!OPEN_STATUSES.includes(request.status)) throw new Error("El cambio ya fue decidido.")

    const now = nowIso()
    const [updated] = await tx.update(preventionChangeRequests).set({
      status: "rejected",
      rejectedReason: data.rejectedReason,
      version: request.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionChangeRequests.id, request.id),
      eq(preventionChangeRequests.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("El cambio cambió mientras lo editabas. Recarga y reintenta.")
    await history(tx, { entityType: "change_request", entityId: request.id, worksiteId: request.worksiteId, changeType: "rejected", reason: data.rejectedReason, beforeState: request, afterState: updated, actorUserId: access.userId })
    return updated
  })
}

/* ── Consultas ────────────────────────────────────────────────────────────── */

export async function listChangeRequests(access: ChangeAccess) {
  requireAccess(access, "prevention:change:view")
  return db.select({
    request: preventionChangeRequests,
    worksiteName: worksites.name,
    evaluatedCount: sql<number>`(SELECT COUNT(*)::int FROM prevention_change_assessments a WHERE a.change_request_id = ${preventionChangeRequests.id} AND a.evaluated = true)`,
  })
    .from(preventionChangeRequests)
    .innerJoin(worksites, eq(preventionChangeRequests.worksiteId, worksites.id))
    .where(scopeCondition(access.scope, preventionChangeRequests.worksiteId))
    .orderBy(desc(preventionChangeRequests.createdAt))
    .limit(300)
}

export async function getChangeRequestDetail(changeRequestId: string, access: ChangeAccess) {
  requireAccess(access, "prevention:change:view")
  const [row] = await db.select({ request: preventionChangeRequests, worksiteName: worksites.name })
    .from(preventionChangeRequests)
    .innerJoin(worksites, eq(preventionChangeRequests.worksiteId, worksites.id))
    .where(eq(preventionChangeRequests.id, changeRequestId)).limit(1)
  if (!row || !scopeAllows(access.scope, row.request.worksiteId)) return null

  const assessments = await db.select().from(preventionChangeAssessments)
    .where(eq(preventionChangeAssessments.changeRequestId, changeRequestId))
  const byDimension = new Map(assessments.map((row) => [row.dimension, row]))
  const ordered = CHANGE_DIMENSIONS.map((dimension) => byDimension.get(dimension)).filter((row): row is typeof assessments[number] => Boolean(row))

  const readiness = assessChangeReadiness({
    assessments: ordered.map((row) => ({ dimension: row.dimension, evaluated: row.evaluated })),
    plannedReviewDate: row.request.plannedReviewDate,
  })

  return { request: row.request, worksiteName: row.worksiteName, assessments: ordered, readiness }
}

/** Faenas visibles para el alcance, para crear cambios. */
export async function listChangeWorksites(access: ChangeAccess) {
  requireAccess(access, "prevention:change:view")
  if (access.scope.mode === "none") return []
  return db.select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(and(
      eq(worksites.isActive, true),
      access.scope.mode === "some" ? inArray(worksites.id, access.scope.ids) : undefined,
    ))
    .orderBy(asc(worksites.name))
}

/** Candidatos a responsable de una acción CAPA derivada de una dimensión de impacto. */
export async function listChangeAssignees(access: ChangeAccess) {
  requireAccess(access, "prevention:change:view")
  const ids = await getUserIdsWithPermission("prevention:change:evaluate")
  if (ids.length === 0) return []
  return db.select({ id: users.id, name: users.name })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.isActive, true)))
    .orderBy(asc(users.name))
}
