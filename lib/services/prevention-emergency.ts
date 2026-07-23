import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { db, type DB, type Tx } from "@/db"
import {
  preventionEmergencyContacts,
  preventionEmergencyDrillParticipants,
  preventionEmergencyDrills,
  preventionEmergencyHistory,
  preventionEmergencyPlans,
  preventionEmergencyResources,
  preventionEmergencyRoles,
  preventionEmergencyScenarios,
  users,
  workers,
  worksites,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { assessDrillCompletion, assessPlanReadiness } from "@/lib/prevention/emergency"
import { createCapaActionWithClient } from "@/lib/services/prevention-capa"
import { onEmergencyDrillCompleted } from "@/lib/services/pdtp-adapters/pdtp-accreditation-connectors"
import { getUserIdsWithPermission } from "@/lib/services/notification-targeting"

type Client = DB | Tx

export interface EmergencyAccess {
  userId: string
  scope: WorksiteScope
  permissions: readonly string[]
}

const NOT_FOUND = "Registro de emergencia no encontrado o fuera de alcance."

function nowIso() {
  return new Date().toISOString()
}

function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

function requireAccess(access: EmergencyAccess, permission: string, worksiteId?: string) {
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
  await client.insert(preventionEmergencyHistory).values({
    id: `pemgh-${nanoid()}`,
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

/* ── Plan ─────────────────────────────────────────────────────────────────── */

// Exportado para que la Server Action (createEmergencyPlanAction) pueda
// validar en el boundary con `parseZ` antes de invocar este servicio —
// misma forma, sin duplicar el schema.
export const planSchema = z.object({
  worksiteId: z.string().min(1),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(5000).nullable().optional(),
})

export async function createEmergencyPlan(input: unknown, access: EmergencyAccess) {
  const data = planSchema.parse(input)
  requireAccess(access, "prevention:emergency:manage", data.worksiteId)

  const [created] = await db.insert(preventionEmergencyPlans).values({
    id: `pemgp-${nanoid()}`,
    worksiteId: data.worksiteId,
    code: `PE-${new Date().getUTCFullYear()}-${nanoid(6).toUpperCase()}`,
    title: data.title,
    description: data.description ?? null,
    createdByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo crear el plan de emergencia.")
  await history(db, { entityType: "plan", entityId: created.id, worksiteId: data.worksiteId, changeType: "created", reason: `Plan creado: ${data.title}`, afterState: created, actorUserId: access.userId })
  return created
}

const scenarioSchema = z.object({
  planId: z.string().min(1),
  type: z.enum(["incendio", "derrame", "fuga", "volcamiento", "exposicion", "rescate", "sismo", "clima", "otro"]),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(3000).nullable().optional(),
  responseProcedure: z.string().trim().min(10).max(10_000),
})

export async function addEmergencyScenario(input: unknown, access: EmergencyAccess) {
  const data = scenarioSchema.parse(input)
  return db.transaction(async (tx) => {
    const [plan] = await tx.select().from(preventionEmergencyPlans).where(eq(preventionEmergencyPlans.id, data.planId)).limit(1)
    if (!plan) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:emergency:manage", plan.worksiteId)
    if (plan.status === "archived") throw new Error("Un plan archivado no admite cambios.")

    const [created] = await tx.insert(preventionEmergencyScenarios).values({
      id: `pemgs-${nanoid()}`,
      planId: data.planId,
      type: data.type,
      title: data.title,
      description: data.description ?? null,
      responseProcedure: data.responseProcedure,
    }).returning()
    if (!created) throw new Error("No se pudo agregar el escenario.")
    await history(tx, { entityType: "scenario", entityId: created.id, worksiteId: plan.worksiteId, changeType: "added", reason: data.title, afterState: created, actorUserId: access.userId })
    return created
  })
}

const roleSchema = z.object({
  planId: z.string().min(1),
  roleName: z.string().trim().min(2).max(120),
  assigneeWorkerId: z.string().min(1),
  backupWorkerId: z.string().min(1).nullable().optional(),
})

export async function addEmergencyRole(input: unknown, access: EmergencyAccess) {
  const data = roleSchema.parse(input)
  return db.transaction(async (tx) => {
    const [plan] = await tx.select().from(preventionEmergencyPlans).where(eq(preventionEmergencyPlans.id, data.planId)).limit(1)
    if (!plan) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:emergency:manage", plan.worksiteId)
    if (plan.status === "archived") throw new Error("Un plan archivado no admite cambios.")

    const [assignee] = await tx.select().from(workers).where(eq(workers.id, data.assigneeWorkerId)).limit(1)
    if (!assignee || !assignee.isActive) throw new Error("La persona titular no existe o está inactiva.")
    if (assignee.worksiteId !== plan.worksiteId) throw new Error("El titular del rol debe pertenecer a la faena del plan.")
    if (data.backupWorkerId) {
      const [backup] = await tx.select().from(workers).where(eq(workers.id, data.backupWorkerId)).limit(1)
      if (!backup || !backup.isActive) throw new Error("La persona de reemplazo no existe o está inactiva.")
      if (backup.worksiteId !== plan.worksiteId) throw new Error("El reemplazo del rol debe pertenecer a la faena del plan.")
    }

    const [created] = await tx.insert(preventionEmergencyRoles).values({
      id: `pemgr-${nanoid()}`,
      planId: data.planId,
      roleName: data.roleName,
      assigneeWorkerId: data.assigneeWorkerId,
      backupWorkerId: data.backupWorkerId ?? null,
    }).returning()
    if (!created) throw new Error("No se pudo agregar el rol.")
    await history(tx, { entityType: "role", entityId: created.id, worksiteId: plan.worksiteId, changeType: "added", reason: data.roleName, afterState: created, actorUserId: access.userId })
    return created
  })
}

const resourceSchema = z.object({
  planId: z.string().min(1),
  name: z.string().trim().min(2).max(200),
  kind: z.string().trim().min(2).max(120),
  location: z.string().trim().min(2).max(300),
  lastInspectedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  nextInspectionAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

export async function addEmergencyResource(input: unknown, access: EmergencyAccess) {
  const data = resourceSchema.parse(input)
  return db.transaction(async (tx) => {
    const [plan] = await tx.select().from(preventionEmergencyPlans).where(eq(preventionEmergencyPlans.id, data.planId)).limit(1)
    if (!plan) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:emergency:manage", plan.worksiteId)
    if (plan.status === "archived") throw new Error("Un plan archivado no admite cambios.")

    const [created] = await tx.insert(preventionEmergencyResources).values({
      id: `pemgre-${nanoid()}`,
      planId: data.planId,
      name: data.name,
      kind: data.kind,
      location: data.location,
      lastInspectedAt: data.lastInspectedAt ?? null,
      nextInspectionAt: data.nextInspectionAt ?? null,
    }).returning()
    if (!created) throw new Error("No se pudo agregar el recurso.")
    await history(tx, { entityType: "resource", entityId: created.id, worksiteId: plan.worksiteId, changeType: "added", reason: data.name, afterState: created, actorUserId: access.userId })
    return created
  })
}

const contactSchema = z.object({
  planId: z.string().min(1),
  name: z.string().trim().min(2).max(200),
  org: z.string().trim().min(2).max(200),
  role: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().min(3).max(60),
})

export async function addEmergencyContact(input: unknown, access: EmergencyAccess) {
  const data = contactSchema.parse(input)
  return db.transaction(async (tx) => {
    const [plan] = await tx.select().from(preventionEmergencyPlans).where(eq(preventionEmergencyPlans.id, data.planId)).limit(1)
    if (!plan) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:emergency:manage", plan.worksiteId)
    if (plan.status === "archived") throw new Error("Un plan archivado no admite cambios.")

    const [created] = await tx.insert(preventionEmergencyContacts).values({
      id: `pemgc-${nanoid()}`,
      planId: data.planId,
      name: data.name,
      org: data.org,
      role: data.role ?? null,
      phone: data.phone,
    }).returning()
    if (!created) throw new Error("No se pudo agregar el contacto.")
    await history(tx, { entityType: "contact", entityId: created.id, worksiteId: plan.worksiteId, changeType: "added", reason: `${data.name} · ${data.org}`, afterState: created, actorUserId: access.userId })
    return created
  })
}

const approvePlanSchema = z.object({
  planId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
})

/**
 * Aprobar exige que el plan ya declare al menos un escenario y un rol de
 * organigrama (assessPlanReadiness), y que quien aprueba no sea quien creó
 * el plan: la misma segregación que ya rige la aprobación de permisos de
 * trabajo y plantillas de inspección.
 */
export async function approveEmergencyPlan(input: unknown, access: EmergencyAccess) {
  const data = approvePlanSchema.parse(input)
  return db.transaction(async (tx) => {
    const [plan] = await tx.select().from(preventionEmergencyPlans).where(eq(preventionEmergencyPlans.id, data.planId)).limit(1)
    if (!plan) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:emergency:approve", plan.worksiteId)
    if (plan.version !== data.expectedVersion) throw new Error("El plan cambió mientras lo editabas. Recarga y reintenta.")
    if (plan.status === "approved") throw new Error("El plan ya está aprobado.")
    if (plan.status === "archived") throw new Error("Un plan archivado no puede aprobarse.")
    if (plan.createdByUserId === access.userId) throw new Error("Quien crea el plan no puede aprobarlo.")

    const [scenarios, roles] = await Promise.all([
      tx.select({ id: preventionEmergencyScenarios.id }).from(preventionEmergencyScenarios).where(eq(preventionEmergencyScenarios.planId, plan.id)),
      tx.select({ id: preventionEmergencyRoles.id }).from(preventionEmergencyRoles).where(eq(preventionEmergencyRoles.planId, plan.id)),
    ])
    const readiness = assessPlanReadiness({ scenarios, roles })
    if (!readiness.ready) throw new Error(readiness.blockers.join(" "))

    const now = nowIso()
    const [updated] = await tx.update(preventionEmergencyPlans).set({
      status: "approved",
      approvedByUserId: access.userId,
      approvedAt: now,
      version: plan.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionEmergencyPlans.id, plan.id),
      eq(preventionEmergencyPlans.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("El plan cambió mientras lo editabas. Recarga y reintenta.")
    await history(tx, { entityType: "plan", entityId: plan.id, worksiteId: plan.worksiteId, changeType: "approved", reason: "Plan aprobado", beforeState: plan, afterState: updated, actorUserId: access.userId })
    return updated
  })
}

/* ── Simulacros ───────────────────────────────────────────────────────────── */

const scheduleDrillSchema = z.object({
  planId: z.string().min(1),
  scenarioType: z.enum(["incendio", "derrame", "fuga", "volcamiento", "exposicion", "rescate", "sismo", "clima", "otro"]),
  scheduledFor: z.string().datetime({ offset: true }),
})

export async function scheduleEmergencyDrill(input: unknown, access: EmergencyAccess) {
  const data = scheduleDrillSchema.parse(input)
  return db.transaction(async (tx) => {
    const [plan] = await tx.select().from(preventionEmergencyPlans).where(eq(preventionEmergencyPlans.id, data.planId)).limit(1)
    if (!plan) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:emergency:drill_execute", plan.worksiteId)
    if (plan.status !== "approved") throw new Error("Sólo un plan aprobado puede programar simulacros.")

    const [created] = await tx.insert(preventionEmergencyDrills).values({
      id: `pemgd-${nanoid()}`,
      planId: data.planId,
      worksiteId: plan.worksiteId,
      scenarioType: data.scenarioType,
      scheduledFor: data.scheduledFor,
      createdByUserId: access.userId,
    }).returning()
    if (!created) throw new Error("No se pudo programar el simulacro.")
    await history(tx, { entityType: "drill", entityId: created.id, worksiteId: plan.worksiteId, changeType: "scheduled", reason: `Simulacro ${data.scenarioType} programado`, afterState: created, actorUserId: access.userId })
    return created
  })
}

const completeDrillSchema = z.object({
  drillId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  executedAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().positive().nullable().optional(),
  evacuationSeconds: z.number().int().positive().nullable().optional(),
  observations: z.string().trim().max(5000).nullable().optional(),
  outcome: z.enum(["satisfactory", "needs_improvement"]),
  participants: z.array(z.object({
    workerId: z.string().min(1),
    present: z.boolean(),
    roleName: z.string().trim().max(120).nullable().optional(),
  })).default([]),
  responsibleUserId: z.string().min(1).nullable().optional(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.outcome === "needs_improvement" && !value.targetDate) {
    ctx.addIssue({ code: "custom", path: ["targetDate"], message: "Un simulacro que requiere mejora necesita un plazo para la acción correctiva." })
  }
})

/**
 * Completar exige participantes registrados y resultado declarado
 * (assessDrillCompletion). Un resultado "requiere mejora" deriva su
 * hallazgo a CAPA común: el aprendizaje del simulacro queda con
 * responsable y plazo, no en un campo de texto.
 */
export async function completeEmergencyDrill(input: unknown, access: EmergencyAccess) {
  const data = completeDrillSchema.parse(input)
  let accreditation: Parameters<typeof onEmergencyDrillCompleted>[0] | null = null
  const result = await db.transaction(async (tx) => {
    const [drill] = await tx.select().from(preventionEmergencyDrills).where(eq(preventionEmergencyDrills.id, data.drillId)).limit(1)
    if (!drill) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:emergency:drill_execute", drill.worksiteId)
    if (drill.version !== data.expectedVersion) throw new Error("El simulacro cambió mientras lo editabas. Recarga y reintenta.")
    if (drill.status !== "scheduled") throw new Error("Sólo un simulacro programado puede completarse.")

    const readiness = assessDrillCompletion({
      participants: data.participants,
      evacuationSeconds: data.evacuationSeconds ?? null,
      outcome: data.outcome,
    })
    if (!readiness.ready) throw new Error(readiness.blockers.join(" "))

    if (data.participants.length > 0) {
      await tx.insert(preventionEmergencyDrillParticipants).values(data.participants.map((item) => ({
        id: `pemgdp-${nanoid()}`,
        drillId: drill.id,
        workerId: item.workerId,
        present: item.present,
        roleName: item.roleName ?? null,
      })))
    }

    let capaActionId: string | null = null
    if (data.outcome === "needs_improvement") {
      const capa = await createCapaActionWithClient(tx, {
        sourceType: "emergency",
        sourceId: drill.id,
        worksiteId: drill.worksiteId,
        finding: data.observations?.trim() || `Simulacro ${drill.scenarioType} requiere mejora`,
        actionDescription: `Corregir hallazgos del simulacro ${drill.scenarioType} del plan.`,
        responsibleUserId: data.responsibleUserId ?? null,
        priority: "medium",
        targetDate: data.targetDate!,
        evidenceRequired: true,
      }, access.userId)
      capaActionId = capa.id
    }

    const now = nowIso()
    const [updated] = await tx.update(preventionEmergencyDrills).set({
      status: "completed",
      executedAt: data.executedAt,
      durationMinutes: data.durationMinutes ?? null,
      evacuationSeconds: data.evacuationSeconds ?? null,
      observations: data.observations ?? null,
      outcome: data.outcome,
      capaActionId,
      version: drill.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionEmergencyDrills.id, drill.id),
      eq(preventionEmergencyDrills.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("El simulacro cambió mientras lo editabas. Recarga y reintenta.")
    await history(tx, { entityType: "drill", entityId: drill.id, worksiteId: drill.worksiteId, changeType: "completed", reason: `Resultado: ${data.outcome}`, beforeState: drill, afterState: updated, actorUserId: access.userId })

    // Auto-acreditación PDTP: actividades del plan de emergencia. Se dispara
    // DESPUÉS del commit (ver abajo) para no dejar ejecuciones huérfanas si la
    // transacción se revierte.
    const [plan] = await tx.select({ pdtpActivityNumbers: preventionEmergencyPlans.pdtpActivityNumbers })
      .from(preventionEmergencyPlans).where(eq(preventionEmergencyPlans.id, drill.planId)).limit(1)
    const activityNumbers = Array.isArray(plan?.pdtpActivityNumbers) ? plan.pdtpActivityNumbers : []
    if (activityNumbers.length > 0) {
      accreditation = {
        drillId: drill.id,
        worksiteId: drill.worksiteId,
        executedAt: data.executedAt,
        participantCount: data.participants.length,
        activityNumbers,
      }
    }

    return updated
  })

  if (accreditation) await onEmergencyDrillCompleted(accreditation)

  return result
}

/* ── Consultas ────────────────────────────────────────────────────────────── */

export async function listEmergencyPlans(access: EmergencyAccess, opts?: { limit?: number; offset?: number }) {
  requireAccess(access, "prevention:emergency:view")
  const limit = Math.min(opts?.limit ?? 500, 500)
  const offset = opts?.offset ?? 0
  return db.select({
    plan: preventionEmergencyPlans,
    worksiteName: worksites.name,
    scenarios: sql<number>`(SELECT COUNT(*)::int FROM prevention_emergency_scenarios s WHERE s.plan_id = ${preventionEmergencyPlans.id})`,
    roles: sql<number>`(SELECT COUNT(*)::int FROM prevention_emergency_roles r WHERE r.plan_id = ${preventionEmergencyPlans.id})`,
    drills: sql<number>`(SELECT COUNT(*)::int FROM prevention_emergency_drills d WHERE d.plan_id = ${preventionEmergencyPlans.id})`,
  })
    .from(preventionEmergencyPlans)
    .innerJoin(worksites, eq(preventionEmergencyPlans.worksiteId, worksites.id))
    .where(scopeCondition(access.scope, preventionEmergencyPlans.worksiteId))
    .orderBy(asc(worksites.name))
    .limit(limit)
    .offset(offset)
}

export async function listEmergencyPlansPage(access: EmergencyAccess, opts?: { limit?: number; offset?: number }) {
  requireAccess(access, "prevention:emergency:view")
  const limit = Math.min(opts?.limit ?? 50, 500)
  const offset = opts?.offset ?? 0
  const where = scopeCondition(access.scope, preventionEmergencyPlans.worksiteId)
  const [rows, [totalRow2]] = await Promise.all([
    db.select({
      plan: preventionEmergencyPlans,
      worksiteName: worksites.name,
      scenarios: sql<number>`(SELECT COUNT(*)::int FROM prevention_emergency_scenarios s WHERE s.plan_id = ${preventionEmergencyPlans.id})`,
      roles: sql<number>`(SELECT COUNT(*)::int FROM prevention_emergency_roles r WHERE r.plan_id = ${preventionEmergencyPlans.id})`,
      drills: sql<number>`(SELECT COUNT(*)::int FROM prevention_emergency_drills d WHERE d.plan_id = ${preventionEmergencyPlans.id})`,
    })
      .from(preventionEmergencyPlans)
      .innerJoin(worksites, eq(preventionEmergencyPlans.worksiteId, worksites.id))
      .where(where)
      .orderBy(asc(worksites.name))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(preventionEmergencyPlans)
      .where(scopeCondition(access.scope, preventionEmergencyPlans.worksiteId)),
  ])
  return { rows, total: totalRow2?.count ?? 0, limit, offset }
}

export async function listEmergencyDrills(access: EmergencyAccess) {
  requireAccess(access, "prevention:emergency:view")
  return db.select({
    drill: preventionEmergencyDrills,
    planTitle: preventionEmergencyPlans.title,
    worksiteName: worksites.name,
  })
    .from(preventionEmergencyDrills)
    .innerJoin(preventionEmergencyPlans, eq(preventionEmergencyDrills.planId, preventionEmergencyPlans.id))
    .innerJoin(worksites, eq(preventionEmergencyDrills.worksiteId, worksites.id))
    .where(scopeCondition(access.scope, preventionEmergencyDrills.worksiteId))
    .orderBy(desc(preventionEmergencyDrills.scheduledFor))
    .limit(300)
}

export async function getEmergencyPlanDetail(planId: string, access: EmergencyAccess) {
  requireAccess(access, "prevention:emergency:view")
  const [row] = await db.select({ plan: preventionEmergencyPlans, worksiteName: worksites.name })
    .from(preventionEmergencyPlans)
    .innerJoin(worksites, eq(preventionEmergencyPlans.worksiteId, worksites.id))
    .where(eq(preventionEmergencyPlans.id, planId)).limit(1)
  if (!row || !scopeAllows(access.scope, row.plan.worksiteId)) return null

  const [scenarios, roleRows, resources, contacts, drillRows] = await Promise.all([
    db.select().from(preventionEmergencyScenarios).where(eq(preventionEmergencyScenarios.planId, planId)),
    db.select({
      role: preventionEmergencyRoles,
      assigneeFirstName: workers.firstName,
      assigneeLastName: workers.lastName,
    })
      .from(preventionEmergencyRoles)
      .innerJoin(workers, eq(preventionEmergencyRoles.assigneeWorkerId, workers.id))
      .where(eq(preventionEmergencyRoles.planId, planId)),
    db.select().from(preventionEmergencyResources).where(eq(preventionEmergencyResources.planId, planId)),
    db.select().from(preventionEmergencyContacts).where(eq(preventionEmergencyContacts.planId, planId)),
    db.select().from(preventionEmergencyDrills).where(eq(preventionEmergencyDrills.planId, planId)).orderBy(desc(preventionEmergencyDrills.scheduledFor)),
  ])

  // El reemplazo de un rol es opcional; sólo se resuelve el nombre cuando existe.
  const backupIds = roleRows.map((row) => row.role.backupWorkerId).filter((id): id is string => Boolean(id))
  const backups = backupIds.length > 0
    ? await db.select({ id: workers.id, firstName: workers.firstName, lastName: workers.lastName })
        .from(workers).where(inArray(workers.id, backupIds))
    : []
  const backupNames = new Map(backups.map((worker) => [worker.id, `${worker.lastName}, ${worker.firstName}`]))

  const roles = roleRows.map((row) => ({
    ...row.role,
    assigneeName: `${row.assigneeLastName}, ${row.assigneeFirstName}`,
    backupName: row.role.backupWorkerId ? backupNames.get(row.role.backupWorkerId) ?? null : null,
  }))

  const readiness = assessPlanReadiness({ scenarios, roles })

  return {
    plan: row.plan,
    worksiteName: row.worksiteName,
    scenarios,
    roles,
    resources,
    contacts,
    drills: drillRows,
    readiness,
  }
}

/** Faenas visibles para el alcance, para crear planes. */
export async function listEmergencyWorksites(access: EmergencyAccess) {
  requireAccess(access, "prevention:emergency:view")
  if (access.scope.mode === "none") return []
  return db.select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(and(
      eq(worksites.isActive, true),
      access.scope.mode === "some" ? inArray(worksites.id, access.scope.ids) : undefined,
    ))
    .orderBy(asc(worksites.name))
}

/**
 * Dotación activa dentro del alcance, para organigrama y participantes de
 * simulacro. Devuelve `worksiteId` porque el servicio rechaza personas de
 * otra faena: el formulario filtra por la faena del plan antes de enviar.
 */
export async function listEmergencyWorkers(access: EmergencyAccess) {
  requireAccess(access, "prevention:emergency:view")
  if (access.scope.mode === "none") return []
  return db.select({
    id: workers.id,
    firstName: workers.firstName,
    lastName: workers.lastName,
    position: workers.position,
    worksiteId: workers.worksiteId,
  })
    .from(workers)
    .where(and(
      eq(workers.isActive, true),
      access.scope.mode === "some" ? inArray(workers.worksiteId, access.scope.ids) : undefined,
    ))
    .orderBy(asc(workers.lastName), asc(workers.firstName))
    .limit(2000)
}

/** Candidatos a responsable de una acción CAPA derivada de un simulacro. */
export async function listEmergencyAssignees(access: EmergencyAccess) {
  requireAccess(access, "prevention:emergency:view")
  const ids = await getUserIdsWithPermission("prevention:emergency:manage")
  if (ids.length === 0) return []
  return db.select({ id: users.id, name: users.name })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.isActive, true)))
    .orderBy(asc(users.name))
}
