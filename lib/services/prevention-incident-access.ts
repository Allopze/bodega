import { inArray, sql } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import { preventionIncidents, preventionSensitiveAccessAudit } from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import type { RequestContext } from "@/lib/services/prevention-documents/utils"

/* Acceso y auditoría compartidos por el servicio de incidentes y el de anexos
 * RE-20. Vivían privados en cada archivo; un cambio de regla en uno dejaba al
 * otro con la regla vieja. */

export type IncidentClient = DB | Tx

export interface IncidentAccess {
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
  roles?: readonly string[]
}

export function hasPermission(permissions: readonly string[], permission: string) {
  return permissions.includes(permission)
}

export function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

export function requireAccess(access: IncidentAccess, permission: string, worksiteId?: string) {
  if (!hasPermission(access.permissions, permission) || (worksiteId && !scopeAllows(access.scope, worksiteId))) {
    throw new Error("Incidente no encontrado o fuera de alcance.")
  }
}

export function scopeCondition(scope: WorksiteScope) {
  if (scope.mode === "all") return undefined
  if (scope.mode === "some" && scope.ids.length > 0) return inArray(preventionIncidents.worksiteId, scope.ids)
  return sql`false`
}

export async function auditIncidentSensitiveAccess(args: {
  access: IncidentAccess
  incidentId: string
  worksiteId: string
  workerId?: string | null
  purpose: string
  outcome: "granted" | "denied"
  reasonCode?: string
  action?: "read_incident_sensitive" | "create" | "update"
  client?: IncidentClient
}) {
  await (args.client ?? db).insert(preventionSensitiveAccessAudit).values({
    id: `psa-${nanoid()}`,
    domain: "incident",
    entityId: args.incidentId,
    subjectWorkerId: args.workerId ?? null,
    worksiteId: args.worksiteId,
    actorUserId: args.access.ctx.userId,
    action: args.action ?? "read_incident_sensitive",
    purpose: args.purpose,
    outcome: args.outcome,
    reasonCode: args.reasonCode ?? null,
    ip: args.access.ctx.ip ?? null,
    userAgent: args.access.ctx.userAgent ?? null,
    createdAt: new Date().toISOString(),
  })
}
