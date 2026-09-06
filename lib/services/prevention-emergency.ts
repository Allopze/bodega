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
import { assessDrillCompletion, assessPlanReadiness, EMERGENCY_SCENARIO_TYPES } from "@/lib/prevention/emergency"
import type { EmergencyQuickFilter } from "@/lib/prevention/emergency-list-filters"
import { createCapaActionWithClient } from "@/lib/services/prevention-capa"
import { onEmergencyDrillCompleted, onEmergencyPlanApproved } from "@/lib/services/pdtp-adapters/pdtp-accreditation-connectors"
import { recordPdtpFulfillmentRevocation } from "@/lib/services/pdtp/fulfillment"
import { getUserIdsWithPermission } from "@/lib/services/notification-targeting"
import { codeYear, todayInChile } from "@/lib/utils"

type Client = DB | Tx

export interface EmergencyAccess {
  userId: string
  scope: WorksiteScope
  permissions: readonly string[]
}

/**
 * Error de dominio con mensaje pensado para el usuario: `run()` en
 * `app/(app)/prevencion/emergencias/actions.ts` devuelve SU mensaje tal cual y
 * manda cualquier otro error a `unexpectedActionError`, que loguea y responde
 * genérico para no filtrar detalles de driver o SQL al navegador. Mismo
 * contrato que `CampaignDomainError` en prevention-campaigns.ts.
 *
 * La regla para elegir cuál lanzar: si el mensaje le dice al usuario qué hacer
 * (no encontrado, versión desactualizada, estado que no admite la operación,
 * datos que no cumplen una regla), es de dominio. Si describe algo que no
 * debería poder ocurrir —un INSERT ... RETURNING que no devuelve fila—, es un
 * `Error` común: al usuario no le sirve el detalle y al operador sí el log.
 */
export class EmergencyDomainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EmergencyDomainError"
  }
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
    throw new EmergencyDomainError(NOT_FOUND)
  }
}

function scopeCondition(scope: WorksiteScope, column: AnyPgColumn) {
  if (scope.mode === "all") return undefined
  if (scope.mode === "none" || scope.ids.length === 0) return sql`false`
  return inArray(column, scope.ids)
}

function emergencyPlanQuickFilterWhere(filter: EmergencyQuickFilter | undefined) {
  if (filter === "approved") return eq(preventionEmergencyPlans.status, "approved")
  if (filter === "draft") return eq(preventionEmergencyPlans.status, "draft")
  return undefined
}

function emergencyDrillQuickFilterWhere(filter: EmergencyQuickFilter | undefined) {
  if (filter === "completed") return eq(preventionEmergencyDrills.status, "completed")
  if (filter === "needs_improvement") return eq(preventionEmergencyDrills.outcome, "needs_improvement")
  return undefined
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

  // La faena admite un solo plan no archivado. El índice parcial
  // `prevention_emergency_plan_active_worksite_unique` es quien lo sostiene y
  // sigue siendo la red de seguridad ante una carrera, pero fallaría con un
  // error del driver: aquí se traduce a un mensaje que dice qué hacer.
  const [vigente] = await db.select({ code: preventionEmergencyPlans.code })
    .from(preventionEmergencyPlans)
    .where(and(
      eq(preventionEmergencyPlans.worksiteId, data.worksiteId),
      sql`${preventionEmergencyPlans.status} <> 'archived'`,
    )).limit(1)
  if (vigente) throw new EmergencyDomainError(`La faena ya tiene el plan ${vigente.code} vigente. Archívalo para emitir el siguiente.`)

  const [created] = await db.insert(preventionEmergencyPlans).values({
    id: `pemgp-${nanoid()}`,
    worksiteId: data.worksiteId,
    code: `PE-${codeYear()}-${nanoid(6).toUpperCase()}`,
    title: data.title,
    description: data.description ?? null,
    createdByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo crear el plan de emergencia.")
  await history(db, { entityType: "plan", entityId: created.id, worksiteId: data.worksiteId, changeType: "created", reason: `Plan creado: ${data.title}`, afterState: created, actorUserId: access.userId })
  return created
}

/**
 * Carga el plan y exige que siga abierto a cambios.
 *
 * Un plan aprobado es el documento que se ejecuta: si se le siguen agregando
 * escenarios, roles, recursos y contactos, lo aprobado deja de ser lo vigente.
 * Se congela con la misma regla que `publishDocumentVersion` —inmutable una vez
 * publicado, se cambia emitiendo la versión siguiente— y no con el
 * `contentDigest` del PDTP: esa huella existe para proteger la ventana de
 * revisión multipaso (in_review → JDPR → legal → active) donde el contenido
 * debe quedar clavado entre firmas. Aquí la aprobación es un solo acto
 * (draft → approved) y no hay ventana que proteger; una huella sería una
 * columna y un hash defendiendo un hueco inexistente.
 *
 * La "versión nueva" es el plan siguiente: se archiva el vigente
 * (`archiveEmergencyPlan`), lo que libera el índice parcial de un plan activo
 * por faena, y se crea el que lo reemplaza.
 */
async function loadEditablePlan(tx: Tx, planId: string, access: EmergencyAccess) {
  const [plan] = await tx.select().from(preventionEmergencyPlans).where(eq(preventionEmergencyPlans.id, planId)).limit(1)
  if (!plan) throw new EmergencyDomainError(NOT_FOUND)
  requireAccess(access, "prevention:emergency:manage", plan.worksiteId)
  if (plan.status === "approved") {
    throw new EmergencyDomainError("El plan está aprobado y su contenido quedó congelado. Archívalo y emite el plan siguiente para modificarlo.")
  }
  if (plan.status !== "draft") throw new EmergencyDomainError("Un plan archivado no admite cambios.")
  return plan
}

const scenarioSchema = z.object({
  planId: z.string().min(1),
  type: z.enum(EMERGENCY_SCENARIO_TYPES),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(3000).nullable().optional(),
  responseProcedure: z.string().trim().min(10).max(10_000),
})

export async function addEmergencyScenario(input: unknown, access: EmergencyAccess) {
  const data = scenarioSchema.parse(input)
  return db.transaction(async (tx) => {
    const plan = await loadEditablePlan(tx, data.planId, access)

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
    const plan = await loadEditablePlan(tx, data.planId, access)

    const [assignee] = await tx.select().from(workers).where(eq(workers.id, data.assigneeWorkerId)).limit(1)
    if (!assignee || !assignee.isActive) throw new EmergencyDomainError("La persona titular no existe o está inactiva.")
    if (assignee.worksiteId !== plan.worksiteId) throw new EmergencyDomainError("El titular del rol debe pertenecer a la faena del plan.")
    if (data.backupWorkerId) {
      const [backup] = await tx.select().from(workers).where(eq(workers.id, data.backupWorkerId)).limit(1)
      if (!backup || !backup.isActive) throw new EmergencyDomainError("La persona de reemplazo no existe o está inactiva.")
      if (backup.worksiteId !== plan.worksiteId) throw new EmergencyDomainError("El reemplazo del rol debe pertenecer a la faena del plan.")
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
  serialNumber: z.string().trim().max(120).nullable().optional(),
  lastInspectedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  nextInspectionAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  /** Vencimiento del equipo (carga del extintor, caducidad del botiquín).
   *  Distinto de la próxima inspección: un extintor recién inspeccionado
   *  puede estar con la carga vencida. */
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

export async function addEmergencyResource(input: unknown, access: EmergencyAccess) {
  const data = resourceSchema.parse(input)
  return db.transaction(async (tx) => {
    const plan = await loadEditablePlan(tx, data.planId, access)

    const [created] = await tx.insert(preventionEmergencyResources).values({
      id: `pemgre-${nanoid()}`,
      // El equipo pertenece a la faena; el plan es sólo el documento que lo
      // declara. Archivar un plan ya no borra el inventario.
      worksiteId: plan.worksiteId,
      planId: data.planId,
      name: data.name,
      kind: data.kind,
      location: data.location,
      serialNumber: data.serialNumber ?? null,
      lastInspectedAt: data.lastInspectedAt ?? null,
      nextInspectionAt: data.nextInspectionAt ?? null,
      expiresAt: data.expiresAt ?? null,
    }).returning()
    if (!created) throw new Error("No se pudo agregar el recurso.")
    await history(tx, { entityType: "resource", entityId: created.id, worksiteId: plan.worksiteId, changeType: "added", reason: data.name, afterState: created, actorUserId: access.userId })
    return created
  })
}

const updateResourceSchema = resourceSchema.omit({ planId: true }).extend({
  resourceId: z.string().min(1),
  status: z.enum(["operational", "needs_maintenance", "out_of_service"]),
})

/**
 * El inventario era de sólo alta: no había forma de registrar que el extintor
 * se recargó ni de dar de baja el que se retiró, así que el módulo no podía
 * apagar sus propias alertas y un equipo vencido quedaba para siempre en
 * `getPreventionAttention`.
 *
 * Se actualiza contra la FAENA del equipo, no contra el plan: el equipo
 * pertenece a la faena (ver el comentario de la tabla) y mantenerlo no cambia
 * el documento aprobado, así que esto sigue disponible con el plan aprobado o
 * archivado. Dar de baja es `status: "out_of_service"`, no borrar la fila: la
 * ficha y su historial se conservan.
 *
 * Sin CAS: la tabla no tiene `version` y una ficha de inventario la edita una
 * persona a la vez. Si dos ediciones simultáneas llegaran a importar, se agrega
 * `version` y se sigue el patrón de planes y simulacros.
 */
export async function updateEmergencyResource(input: unknown, access: EmergencyAccess) {
  const data = updateResourceSchema.parse(input)
  return db.transaction(async (tx) => {
    const [resource] = await tx.select().from(preventionEmergencyResources).where(eq(preventionEmergencyResources.id, data.resourceId)).limit(1)
    if (!resource) throw new EmergencyDomainError(NOT_FOUND)
    requireAccess(access, "prevention:emergency:manage", resource.worksiteId)

    const now = nowIso()
    const [updated] = await tx.update(preventionEmergencyResources).set({
      name: data.name,
      kind: data.kind,
      location: data.location,
      serialNumber: data.serialNumber ?? null,
      lastInspectedAt: data.lastInspectedAt ?? null,
      nextInspectionAt: data.nextInspectionAt ?? null,
      expiresAt: data.expiresAt ?? null,
      status: data.status,
      updatedAt: now,
    }).where(eq(preventionEmergencyResources.id, resource.id)).returning()
    if (!updated) throw new Error("No se pudo actualizar el recurso.")

    const decommissioned = data.status === "out_of_service" && resource.status !== "out_of_service"
    await history(tx, {
      entityType: "resource",
      entityId: resource.id,
      worksiteId: resource.worksiteId,
      changeType: decommissioned ? "decommissioned" : "updated",
      reason: decommissioned ? `Baja del equipo: ${data.name}` : `Actualización del equipo: ${data.name}`,
      beforeState: resource,
      afterState: updated,
      actorUserId: access.userId,
    })
    return updated
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
    const plan = await loadEditablePlan(tx, data.planId, access)

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
  let accreditation: Parameters<typeof onEmergencyPlanApproved>[0] | null = null
  const result = await db.transaction(async (tx) => {
    const [plan] = await tx.select().from(preventionEmergencyPlans).where(eq(preventionEmergencyPlans.id, data.planId)).limit(1)
    if (!plan) throw new EmergencyDomainError(NOT_FOUND)
    requireAccess(access, "prevention:emergency:approve", plan.worksiteId)
    if (plan.version !== data.expectedVersion) throw new EmergencyDomainError("El plan cambió mientras lo editabas. Recarga y reintenta.")
    if (plan.status === "approved") throw new EmergencyDomainError("El plan ya está aprobado.")
    if (plan.status === "archived") throw new EmergencyDomainError("Un plan archivado no puede aprobarse.")
    if (plan.createdByUserId === access.userId) throw new EmergencyDomainError("Quien crea el plan no puede aprobarlo.")

    const [scenarios, roles] = await Promise.all([
      tx.select({ id: preventionEmergencyScenarios.id }).from(preventionEmergencyScenarios).where(eq(preventionEmergencyScenarios.planId, plan.id)),
      tx.select({ id: preventionEmergencyRoles.id }).from(preventionEmergencyRoles).where(eq(preventionEmergencyRoles.planId, plan.id)),
    ])
    const readiness = assessPlanReadiness({ scenarios, roles })
    if (!readiness.ready) throw new EmergencyDomainError(readiness.blockers.join(" "))

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
    if (!updated) throw new EmergencyDomainError("El plan cambió mientras lo editabas. Recarga y reintenta.")
    await history(tx, { entityType: "plan", entityId: plan.id, worksiteId: plan.worksiteId, changeType: "approved", reason: "Plan aprobado", beforeState: plan, afterState: updated, actorUserId: access.userId })

    // N°83 del PDTP ("Plan emergencia por cada amenaza"). La cantidad son los
    // escenarios, no el plan: el programa la planifica por amenaza (D13), y la
    // aprobación ya exigió que haya al menos uno. Se dispara después del commit.
    accreditation = {
      planId: plan.id,
      worksiteId: plan.worksiteId,
      planCode: plan.code,
      approvedAt: updated.approvedAt ?? now,
      scenarioCount: scenarios.length,
    }
    return updated
  })

  if (accreditation) await onEmergencyPlanApproved(accreditation)
  return result
}

/**
 * Declara qué actividades del programa anual acredita un simulacro de este plan
 * (EMERGENCIAS-05).
 *
 * `pdtpActivityNumbers` existía en la tabla desde el principio pero NADIE lo
 * escribía: `completeEmergencyDrill` lo leía, encontraba `null` y salía por la
 * rama vacía, así que ningún simulacro acreditó jamás la N°84 del catálogo 2026
 * ("Simulacros", clasificada `enganche`). Mismo defecto y misma cura que en
 * plantillas de inspección (`setInspectionTemplatePdtpActivities`): se cablea el
 * escritor, no se borra el conector.
 *
 * A diferencia de las plantillas, esto NO se restringe al borrador. El plan se
 * congela al aprobarse (`loadEditablePlan`), pero los simulacros sólo existen
 * sobre un plan APROBADO: limitar el cableado al borrador dejaría el conector
 * muerto justo en los planes que ejecutan simulacros. Y vale el mismo argumento
 * que en inspecciones —el cableado al PDTP no es contenido del documento: no
 * cambia qué escenarios, roles ni contactos declara el plan aprobado—. Un plan
 * archivado sí queda fuera: ya no ejecuta nada.
 */
const setPlanPdtpActivitiesSchema = z.object({
  planId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  pdtpActivityNumbers: z.array(z.number().int().positive()).max(20),
})

export async function setEmergencyPlanPdtpActivities(input: unknown, access: EmergencyAccess) {
  const data = setPlanPdtpActivitiesSchema.parse(input)
  return db.transaction(async (tx) => {
    const [plan] = await tx.select().from(preventionEmergencyPlans).where(eq(preventionEmergencyPlans.id, data.planId)).limit(1)
    if (!plan) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:emergency:manage", plan.worksiteId)
    if (plan.version !== data.expectedVersion) throw new Error("El plan cambió mientras lo editabas. Recarga y reintenta.")
    if (plan.status === "archived") throw new EmergencyDomainError("Un plan archivado no admite cambios.")

    const numbers = data.pdtpActivityNumbers.length > 0
      ? [...new Set(data.pdtpActivityNumbers)].sort((a, b) => a - b)
      : null
    const now = nowIso()
    const [updated] = await tx.update(preventionEmergencyPlans).set({
      pdtpActivityNumbers: numbers,
      version: plan.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionEmergencyPlans.id, plan.id),
      eq(preventionEmergencyPlans.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("El plan cambió mientras lo editabas. Recarga y reintenta.")
    await history(tx, {
      entityType: "plan", entityId: plan.id, worksiteId: plan.worksiteId, changeType: "pdtp_activities_set",
      reason: numbers ? `Los simulacros acreditan las actividades PDTP ${numbers.join(", ")}` : "Los simulacros no acreditan ninguna actividad PDTP",
      beforeState: plan, afterState: updated, actorUserId: access.userId,
    })
    return updated
  })
}

const archivePlanSchema = z.object({
  planId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(10).max(1000),
})

/**
 * Sin archivado, el índice parcial `prevention_emergency_plan_active_worksite_unique`
 * (un plan no archivado por faena) dejaba a la faena con su primer plan para
 * siempre: no había forma de emitir el del año siguiente. Archivar libera el
 * índice y, junto con el congelamiento del plan aprobado, es el camino de
 * versión nueva del módulo.
 *
 * Exige el permiso de aprobar, no el de administrar: retirar de vigencia el
 * plan de emergencia de una faena pesa lo mismo que ponerlo en vigencia, y no
 * hace falta inventar un permiso nuevo para eso.
 */
export async function archiveEmergencyPlan(input: unknown, access: EmergencyAccess) {
  const data = archivePlanSchema.parse(input)
  return db.transaction(async (tx) => {
    const [plan] = await tx.select().from(preventionEmergencyPlans).where(eq(preventionEmergencyPlans.id, data.planId)).limit(1)
    if (!plan) throw new EmergencyDomainError(NOT_FOUND)
    requireAccess(access, "prevention:emergency:approve", plan.worksiteId)
    if (plan.version !== data.expectedVersion) throw new EmergencyDomainError("El plan cambió mientras lo editabas. Recarga y reintenta.")
    if (plan.status === "archived") throw new EmergencyDomainError("El plan ya está archivado.")

    const now = nowIso()
    const [updated] = await tx.update(preventionEmergencyPlans).set({
      status: "archived",
      version: plan.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionEmergencyPlans.id, plan.id),
      eq(preventionEmergencyPlans.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new EmergencyDomainError("El plan cambió mientras lo editabas. Recarga y reintenta.")
    await history(tx, { entityType: "plan", entityId: plan.id, worksiteId: plan.worksiteId, changeType: "archived", reason: data.reason, beforeState: plan, afterState: updated, actorUserId: access.userId })
    return updated
  })
}

/* ── Simulacros ───────────────────────────────────────────────────────────── */

/** Tolerancia de reloj para `executedAt` (ver `completeDrillSchema`). */
const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000

const scheduleDrillSchema = z.object({
  planId: z.string().min(1),
  scenarioType: z.enum(EMERGENCY_SCENARIO_TYPES),
  scheduledFor: z.string().datetime({ offset: true }),
})

export async function scheduleEmergencyDrill(input: unknown, access: EmergencyAccess) {
  const data = scheduleDrillSchema.parse(input)
  return db.transaction(async (tx) => {
    const [plan] = await tx.select().from(preventionEmergencyPlans).where(eq(preventionEmergencyPlans.id, data.planId)).limit(1)
    if (!plan) throw new EmergencyDomainError(NOT_FOUND)
    requireAccess(access, "prevention:emergency:drill_execute", plan.worksiteId)
    if (plan.status !== "approved") throw new EmergencyDomainError("Sólo un plan aprobado puede programar simulacros.")

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
  // EMERGENCIAS-06: `executedAt` no tenía cota superior, así que un simulacro
  // podía quedar "realizado" el año que viene y acreditar una actividad del
  // PDTP con fecha futura (el motor usa `occurredAt` para ubicarla en el
  // período). Se compara como instante y no como texto: el schema admite
  // offset, y "…T20:00:00+02:00" es lexicográficamente mayor que "…T19:00:00Z"
  // siendo una hora ANTERIOR. La holgura absorbe el desfase entre el reloj del
  // navegador —que es quien calcula el instante— y el del servidor; no alcanza
  // para colar una fecha inventada. La cota inferior no se puede ver desde acá
  // —depende de la fila del simulacro— y va en el servicio.
  if (new Date(value.executedAt).getTime() > Date.now() + FUTURE_CLOCK_SKEW_MS) {
    ctx.addIssue({ code: "custom", path: ["executedAt"], message: "Un simulacro no puede haberse realizado en el futuro." })
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
    if (!drill) throw new EmergencyDomainError(NOT_FOUND)
    requireAccess(access, "prevention:emergency:drill_execute", drill.worksiteId)
    if (drill.version !== data.expectedVersion) throw new EmergencyDomainError("El simulacro cambió mientras lo editabas. Recarga y reintenta.")
    if (drill.status !== "scheduled") throw new EmergencyDomainError("Sólo un simulacro programado puede completarse.")

    // EMERGENCIAS-06, cota inferior: el simulacro no pudo realizarse antes de la
    // fecha para la que se programó. Se elige `scheduledFor` y no `createdAt`
    // porque `scheduledFor` es libre —un simulacro ya ocurrido se registra
    // programándolo con su fecha real y completándolo—, así que `createdAt`
    // rechazaría el registro retroactivo legítimo. Y si el simulacro se adelantó
    // respecto de lo programado, el camino del módulo ya está decidido:
    // cancelar con motivo y volver a programar (ver `cancelEmergencyDrill`),
    // que deja traza de que la fecha se movió en vez de borrarla.
    if (new Date(data.executedAt).getTime() < new Date(drill.scheduledFor).getTime()) {
      throw new EmergencyDomainError("El simulacro no pudo realizarse antes de la fecha para la que fue programado. Si se adelantó, cancélalo con su motivo y prográmalo en la fecha real.")
    }

    // Los participantes no se validaban: entraba gente de otra faena, inactiva,
    // inexistente o repetida. Misma regla de pertenencia que `addEmergencyRole`,
    // pero en UNA consulta en lote (patrón de `recordCampaignAttendance`), no N+1.
    // Va antes de assessDrillCompletion porque un duplicado inflaría el conteo
    // de presentes que decide si el simulacro puede cerrarse.
    const participantIds = data.participants.map((item) => item.workerId)
    if (participantIds.length > 0) {
      const duplicated = participantIds.length - new Set(participantIds).size
      if (duplicated > 0) {
        // Se rechaza en vez de deduplicar: dos filas del mismo trabajador pueden
        // traer `present` contradictorio y no hay criterio para elegir cuál vale;
        // además el conteo de asistentes acredita actividades PDTP. El UNIQUE
        // (drill_id, worker_id) sigue como red de seguridad en la base, pero
        // fallaría con un error de driver en vez de un mensaje de dominio.
        throw new EmergencyDomainError(`${duplicated} participante(s) vienen repetidos en la lista.`)
      }
      const valid = await tx.select({ id: workers.id }).from(workers).where(and(
        inArray(workers.id, participantIds),
        eq(workers.worksiteId, drill.worksiteId),
        eq(workers.isActive, true),
      ))
      const ok = new Set(valid.map((worker) => worker.id))
      const rejected = participantIds.filter((id) => !ok.has(id))
      if (rejected.length > 0) {
        throw new EmergencyDomainError(`${rejected.length} participante(s) no existen, están inactivos o no pertenecen a la faena del simulacro.`)
      }
    }

    const readiness = assessDrillCompletion({
      participants: data.participants,
      evacuationSeconds: data.evacuationSeconds ?? null,
      outcome: data.outcome,
    })
    if (!readiness.ready) throw new EmergencyDomainError(readiness.blockers.join(" "))

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
    if (!updated) throw new EmergencyDomainError("El simulacro cambió mientras lo editabas. Recarga y reintenta.")
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

const cancelDrillSchema = z.object({
  drillId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(10).max(1000),
})

/**
 * Un simulacro programado que no se realizó quedaba colgado como "programado"
 * para siempre: no se podía cancelar ni reprogramar. Se cancela con motivo y no
 * se borra, igual que una convocatoria de CPHS (`cancelCommitteeMeeting`), para
 * que el simulacro fallido siga contando como hecho ocurrido.
 *
 * Reprogramar es cancelar y volver a programar: el estado "cancelled" con su
 * motivo deja la traza de por qué se movió, cosa que editar la fecha en su
 * lugar borraría.
 */
export async function cancelEmergencyDrill(input: unknown, access: EmergencyAccess) {
  const data = cancelDrillSchema.parse(input)
  let revocation: Parameters<typeof recordPdtpFulfillmentRevocation>[0] | null = null

  const updated = await db.transaction(async (tx) => {
    const [drill] = await tx.select().from(preventionEmergencyDrills).where(eq(preventionEmergencyDrills.id, data.drillId)).limit(1)
    if (!drill) throw new EmergencyDomainError(NOT_FOUND)
    requireAccess(access, "prevention:emergency:drill_execute", drill.worksiteId)
    if (drill.version !== data.expectedVersion) throw new EmergencyDomainError("El simulacro cambió mientras lo editabas. Recarga y reintenta.")
    if (drill.status !== "scheduled") throw new EmergencyDomainError("Sólo un simulacro programado puede cancelarse.")

    const now = nowIso()
    const [updated] = await tx.update(preventionEmergencyDrills).set({
      status: "cancelled",
      version: drill.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionEmergencyDrills.id, drill.id),
      eq(preventionEmergencyDrills.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new EmergencyDomainError("El simulacro cambió mientras lo editabas. Recarga y reintenta.")
    await history(tx, { entityType: "drill", entityId: drill.id, worksiteId: drill.worksiteId, changeType: "cancelled", reason: data.reason, beforeState: drill, afterState: updated, actorUserId: access.userId })

    // Revertir la N°84 con el mismo `sourceId` (el propio drillId) que usó
    // `onEmergencyDrillCompleted`. Defensa en profundidad: el guard de arriba
    // sólo deja cancelar un simulacro "scheduled", el mismo estado que
    // `completeEmergencyDrill` excluye, así que hoy esta rama nunca encuentra
    // una acreditación viva que revocar — se deja cableada por si esa vía
    // cambia (o una anulación administrativa reabre un simulacro completado).
    revocation = {
      sourceType: "emergencia",
      sourceId: updated.id,
      worksiteId: drill.worksiteId,
      revokedBy: access.userId,
      reason: data.reason,
    }
    return updated
  })

  if (revocation) await recordPdtpFulfillmentRevocation(revocation)

  return updated
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

export async function listEmergencyPlansPage(access: EmergencyAccess, opts?: {
  limit?: number
  offset?: number
  quickFilter?: EmergencyQuickFilter
}) {
  requireAccess(access, "prevention:emergency:view")
  const limit = Math.min(opts?.limit ?? 50, 500)
  const offset = opts?.offset ?? 0
  const where = and(
    scopeCondition(access.scope, preventionEmergencyPlans.worksiteId),
    emergencyPlanQuickFilterWhere(opts?.quickFilter),
  )
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
    db.select({ count: sql<number>`count(*)::int` }).from(preventionEmergencyPlans).where(where),
  ])
  return { rows, total: totalRow2?.count ?? 0, limit, offset }
}

export async function listEmergencyDrills(access: EmergencyAccess, opts?: { quickFilter?: EmergencyQuickFilter }) {
  requireAccess(access, "prevention:emergency:view")
  return db.select({
    drill: preventionEmergencyDrills,
    planTitle: preventionEmergencyPlans.title,
    worksiteName: worksites.name,
  })
    .from(preventionEmergencyDrills)
    .innerJoin(preventionEmergencyPlans, eq(preventionEmergencyDrills.planId, preventionEmergencyPlans.id))
    .innerJoin(worksites, eq(preventionEmergencyDrills.worksiteId, worksites.id))
    .where(and(
      scopeCondition(access.scope, preventionEmergencyDrills.worksiteId),
      emergencyDrillQuickFilterWhere(opts?.quickFilter),
    ))
    .orderBy(desc(preventionEmergencyDrills.scheduledFor))
    .limit(300)
}

export async function getEmergencyDashboardCounts(access: EmergencyAccess) {
  requireAccess(access, "prevention:emergency:view")
  const [plans, drills, resources] = await Promise.all([
    db.select({
      totalPlans: sql<number>`count(*)::int`,
      approvedPlans: sql<number>`count(*) filter (where ${preventionEmergencyPlans.status} = 'approved')::int`,
      draftPlans: sql<number>`count(*) filter (where ${preventionEmergencyPlans.status} = 'draft')::int`,
    }).from(preventionEmergencyPlans).where(scopeCondition(access.scope, preventionEmergencyPlans.worksiteId)),
    db.select({
      totalDrills: sql<number>`count(*)::int`,
      completedDrills: sql<number>`count(*) filter (where ${preventionEmergencyDrills.status} = 'completed')::int`,
      needsImprovementDrills: sql<number>`count(*) filter (where ${preventionEmergencyDrills.outcome} = 'needs_improvement')::int`,
    }).from(preventionEmergencyDrills).where(scopeCondition(access.scope, preventionEmergencyDrills.worksiteId)),
    // Hasta ahora nadie consultaba `nextInspectionAt`: era un campo que se
    // llenaba y nunca se miraba. Un extintor con la carga vencida no aparecía
    // en ninguna parte.
    db.select({
      totalResources: sql<number>`count(*)::int`,
      overdueInspection: sql<number>`count(*) filter (where ${preventionEmergencyResources.nextInspectionAt} is not null and ${preventionEmergencyResources.nextInspectionAt} < ${todayInChile()})::int`,
      expired: sql<number>`count(*) filter (where ${preventionEmergencyResources.expiresAt} is not null and ${preventionEmergencyResources.expiresAt} < ${todayInChile()})::int`,
      outOfService: sql<number>`count(*) filter (where ${preventionEmergencyResources.status} <> 'operational')::int`,
    }).from(preventionEmergencyResources).where(scopeCondition(access.scope, preventionEmergencyResources.worksiteId)),
  ])
  const planCounts = plans[0]
  const drillCounts = drills[0]
  const resourceCounts = resources[0]
  return {
    totalPlans: planCounts?.totalPlans ?? 0,
    approvedPlans: planCounts?.approvedPlans ?? 0,
    draftPlans: planCounts?.draftPlans ?? 0,
    totalDrills: drillCounts?.totalDrills ?? 0,
    completedDrills: drillCounts?.completedDrills ?? 0,
    needsImprovementDrills: drillCounts?.needsImprovementDrills ?? 0,
    totalResources: resourceCounts?.totalResources ?? 0,
    resourcesOverdueInspection: resourceCounts?.overdueInspection ?? 0,
    resourcesExpired: resourceCounts?.expired ?? 0,
    resourcesOutOfService: resourceCounts?.outOfService ?? 0,
  }
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
 * simulacro. Devuelve `worksiteId` porque el servicio rechaza personas de otra
 * faena.
 *
 * EMERGENCIAS-11: `worksiteId` filtra en SQL, ANTES del tope de 2000. El único
 * llamador siempre quiere la dotación de UNA faena (la del plan) y filtraba en
 * memoria después de traer las 2000 primeras del alcance ordenadas por
 * apellido: con alcance global y dotación grande, unas faenas llegaban
 * completas y otras truncadas según dónde cayera el corte alfabético — y la
 * gente que faltaba no se podía marcar presente en su propio simulacro. El tope
 * sigue existiendo como red contra una faena desmedida, pero ahora se aplica
 * sobre el conjunto que realmente se va a mostrar.
 */
export async function listEmergencyWorkers(access: EmergencyAccess, worksiteId?: string) {
  requireAccess(access, "prevention:emergency:view")
  if (access.scope.mode === "none") return []
  // Una faena fuera del alcance no devuelve dotación ajena, devuelve nada:
  // mismo criterio que `scopeCondition`, sin filtrar en memoria después.
  if (worksiteId && !scopeAllows(access.scope, worksiteId)) return []
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
      worksiteId ? eq(workers.worksiteId, worksiteId) : undefined,
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
