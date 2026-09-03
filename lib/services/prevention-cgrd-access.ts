/**
 * Piezas compartidas del dominio CGRD (comité, matriz, amenazas, actas):
 * una sola definición de alcance y una sola bitácora, reusando
 * `preventionGovernanceHistory` (ya domain-agnóstico, el mismo que usa CPHS).
 */
import { inArray, sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import type { DB, Tx } from "@/db"
import { preventionGovernanceHistory } from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"

export type CgrdClient = DB | Tx

export interface CgrdAccess {
  userId: string
  scope: WorksiteScope
  permissions: readonly string[]
}

export const GRD_NOT_FOUND = "Registro de CGRD no encontrado o fuera de alcance."

export function nowIso() {
  return new Date().toISOString()
}

export function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

export function requireGrdAccess(access: CgrdAccess, permission: string, worksiteId?: string) {
  if (!access.permissions.includes(permission) || (worksiteId && !scopeAllows(access.scope, worksiteId))) {
    throw new Error(GRD_NOT_FOUND)
  }
}

export function grdScopeCondition(scope: WorksiteScope, column: AnyPgColumn) {
  if (scope.mode === "all") return undefined
  if (scope.mode === "none" || scope.ids.length === 0) return sql`false`
  return inArray(column, scope.ids)
}

export async function recordGrdHistory(client: CgrdClient, args: {
  entityType: string
  entityId: string
  worksiteId?: string | null
  changeType: string
  reason: string
  beforeState?: unknown
  afterState?: unknown
  actorUserId?: string | null
}) {
  await client.insert(preventionGovernanceHistory).values({
    id: `pgovh-${nanoid()}`,
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
