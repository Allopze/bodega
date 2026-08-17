import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { db, type DB, type Tx } from "@/db"
import {
  preventionCapaActions,
  preventionChangeAssessments,
  preventionChangeHistory,
  preventionChangeRequests,
  users,
  worksites,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { assessChangeReadiness, CHANGE_DIMENSIONS } from "@/lib/prevention/change"
import {
  createCapaActionWithClient,
  transitionCapaActionWithClient,
  updateCapaActionWithClient,
} from "@/lib/services/prevention-capa"
import { getUserIdsWithPermission } from "@/lib/services/notification-targeting"
import { addDaysToPlainDate, codeYear, todayInChile } from "@/lib/utils"

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

/** Estados de una acción CAPA que todavía se pueden reconducir o cancelar. */
const OPEN_CAPA_STATUSES = ["pending", "in_progress", "pending_verification", "reopened"]

/**
 * Reconducir la CAPA derivada de una dimensión es parte del acto de reevaluarla:
 * quien puede declarar que el cambio ya no exige acción es quien puede retirarla.
 * Por eso el permiso lo aporta la operación y no el actor, igual que
 * `worksite-lifecycle.ts` al cerrar una faena o `capaAccess` en el plan de acción
 * del PDTP. El alcance sí es el del actor: no se toca una acción de otra faena.
 */
function capaAccessFor(access: ChangeAccess) {
  return { ctx: { userId: access.userId }, scope: access.scope, permissions: ["prevention:capa:manage"] }
}

/**
 * Toda mutación hija (evaluación de una dimensión de impacto) es una entrada
 * del expediente del cambio: si no mueve `version`, el CAS de
 * `approveChangeRequest` no ve la reevaluación y aprueba sobre una evaluación
 * ya obsoleta. Mismo patrón que `bumpPermitVersion` en prevention-permits.ts.
 *
 * Se incrementa en SQL, no con `version + 1` leído en memoria, para no perder
 * el bump si dos mutaciones hijas corren a la vez.
 */
async function bumpChangeVersion(client: Client, changeRequestId: string, now: string, status?: string) {
  await client.update(preventionChangeRequests)
    .set({
      ...(status ? { status } : {}),
      version: sql`${preventionChangeRequests.version} + 1`,
      updatedAt: now,
    })
    .where(eq(preventionChangeRequests.id, changeRequestId))
}

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
      code: `GC-${codeYear()}-${nanoid(6).toUpperCase()}`,
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
  // El CHECK `prevention_change_assessment_impact_consistent` ya rechaza la
  // combinación, pero como error de base: llega a la pantalla como fallo de
  // infraestructura y sin campo al que apuntar. Aquí se pinta en `impacted`,
  // que es lo que el evaluador tiene que corregir. El CHECK sigue siendo la
  // garantía; esto es sólo el mensaje.
  if (!value.impacted && value.actionRequired) {
    ctx.addIssue({ code: "custom", path: ["impacted"], message: "Una dimensión que requiere acción tiene que declararse impactada." })
  }
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
 *
 * MOC-03 — reevaluar RECONCILIA la acción, no la duplica. Antes cada llamada
 * creaba una CAPA nueva y pisaba `capaActionId`: reevaluar tres veces dejaba
 * tres acciones vivas para el mismo hallazgo y dos de ellas huérfanas, sin nadie
 * que las cerrara y contando de a tres en los tableros. Ahora:
 *
 *  · sigue requiriendo acción y la anterior está abierta → se conserva y se
 *    actualiza con lo reevaluado (`updateCapaActionWithClient` no escribe si
 *    nada cambió, así que reevaluar dos veces igual es un no-op);
 *  · sigue requiriendo acción y la anterior está cerrada o cancelada → nace una
 *    nueva, porque la exigencia sobrevivió a la acción que la atendía;
 *  · se desmarca y la anterior está abierta → se cancela con motivo (nunca se
 *    borra) y la dimensión queda sin acción.
 */
export async function evaluateChangeDimension(input: unknown, access: ChangeAccess) {
  const data = evaluateSchema.parse(input)
  return db.transaction(async (tx) => {
    // `for("update")` y no sólo el bump de versión: el bump cierra el orden
    // "evalúo y después corre el CAS de la aprobación" (el CAS ya no calza),
    // pero no el inverso — una aprobación que confirma mientras esta
    // transacción está entre su lectura y sus escrituras. Sin el lock, bajo
    // READ COMMITTED el UPDATE del bump no lleva predicado de estado, espera a
    // que la aprobación libere la fila y escribe igual, dejando una dimensión
    // con `evaluatedAt` posterior a `approvedAt` sobre un cambio ya decidido.
    // Con el lock, la relectura ve `approved` y la guarda de abajo rechaza.
    const [request] = await tx.select().from(preventionChangeRequests)
      .where(eq(preventionChangeRequests.id, data.changeRequestId)).for("update").limit(1)
    if (!request) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:change:evaluate", request.worksiteId)
    if (!OPEN_STATUSES.includes(request.status)) throw new Error("Un cambio ya decidido no admite nuevas evaluaciones.")

    const [assessment] = await tx.select().from(preventionChangeAssessments)
      .where(and(
        eq(preventionChangeAssessments.changeRequestId, data.changeRequestId),
        eq(preventionChangeAssessments.dimension, data.dimension),
      )).limit(1)
    if (!assessment) throw new Error(NOT_FOUND)

    // La acción que esta dimensión ya derivó, si es que derivó alguna. Se relee
    // en vez de confiar en `capaActionId` a secas porque lo que decide si se
    // reutiliza es su ESTADO, no su existencia.
    const [previousCapa] = assessment.capaActionId
      ? await tx.select().from(preventionCapaActions)
          .where(eq(preventionCapaActions.id, assessment.capaActionId)).limit(1)
      : []
    const previousOpen = previousCapa && OPEN_CAPA_STATUSES.includes(previousCapa.status) ? previousCapa : null

    const finding = `${data.dimension}: ${data.notes?.trim() || "impacto detectado en la evaluación del cambio"}`
    let capaActionId: string | null = null
    if (data.actionRequired) {
      if (previousOpen) {
        await updateCapaActionWithClient(tx, {
          actionId: previousOpen.id,
          expectedVersion: previousOpen.version,
          finding,
          actionDescription: data.actionDescription!,
          responsibleUserId: data.responsibleUserId ?? null,
          priority: data.priority,
          targetDate: data.targetDate!,
        }, capaAccessFor(access))
        capaActionId = previousOpen.id
      } else {
        const capa = await createCapaActionWithClient(tx, {
          sourceType: "change",
          sourceId: request.id,
          worksiteId: request.worksiteId,
          finding,
          actionDescription: data.actionDescription!,
          responsibleUserId: data.responsibleUserId ?? null,
          priority: data.priority,
          targetDate: data.targetDate!,
          evidenceRequired: true,
        }, access.userId)
        capaActionId = capa.id
      }
    } else if (previousOpen) {
      await transitionCapaActionWithClient(tx, {
        actionId: previousOpen.id,
        expectedVersion: previousOpen.version,
        toStatus: "cancelled",
        reason: `La reevaluación del cambio retiró la acción de la dimensión ${data.dimension}.`,
      }, capaAccessFor(access))
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

    await bumpChangeVersion(tx, request.id, now, request.status === "draft" ? "under_evaluation" : undefined)

    await history(tx, { entityType: "assessment", entityId: updated.id, worksiteId: request.worksiteId, changeType: "evaluated", reason: `Dimensión ${data.dimension} evaluada`, beforeState: assessment, afterState: updated, actorUserId: access.userId })
    return updated
  })
}

// Exportado para que approveChangeRequestAction (Server Action) pueda
// validar en el boundary con `parseZ`.
/**
 * MOC-05: la "fecha de revisión posterior" no se validaba como posterior ni
 * tenía tope, así que la de ayer y la del año 2199 pasaban igual —y la del año
 * 2199 es la forma cómoda de cumplir el requisito sin comprometerse a nada—.
 * Se compara contra el día civil chileno, que es el mismo "hoy" con el que
 * `getPreventionAttention` decide si la revisión está vencida; con el día UTC,
 * entre las 20:00 y la medianoche de Chile "mañana" ya se rechazaba por pasada.
 *
 * El tope de 24 meses es holgado a propósito: el DS 44 no fija el plazo, y la
 * regla sólo existe para que la fecha siga siendo una fecha y no un "nunca".
 */
const MAX_REVIEW_HORIZON_DAYS = 730

export const approveSchema = z.object({
  changeRequestId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  plannedReviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).superRefine((value, ctx) => {
  const today = todayInChile()
  if (value.plannedReviewDate <= today) {
    ctx.addIssue({ code: "custom", path: ["plannedReviewDate"], message: "La revisión posterior tiene que quedar después de la fecha de aprobación." })
  } else if (value.plannedReviewDate > addDaysToPlainDate(today, MAX_REVIEW_HORIZON_DAYS)) {
    ctx.addIssue({ code: "custom", path: ["plannedReviewDate"], message: "La revisión posterior no puede quedar a más de 24 meses de la aprobación." })
  }
})

/**
 * Aprobar exige las seis dimensiones evaluadas y una fecha de revisión
 * posterior (assessChangeReadiness), y que quien aprueba no sea quien
 * solicitó el cambio — misma segregación que permisos de trabajo, plantillas
 * de inspección y planes de emergencia.
 *
 * Esa fecha ya no es decorativa: `getPreventionAttention` levanta el cambio
 * aprobado cuando se acerca o pasa (MOC-05), igual que hace con la reevaluación
 * de un protocolo MINSAL o la carga de un extintor.
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
