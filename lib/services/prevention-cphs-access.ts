/**
 * Piezas compartidas por los servicios del dominio CPHS: el comité en sí
 * (`prevention-cphs.ts`), su programa de trabajo (`prevention-cphs-program.ts`)
 * y la organización preventiva por faena
 * (`prevention-cphs-organization.ts`).
 *
 * Están acá y no en el servicio del comité para que los tres compartan una sola
 * definición de alcance y una sola bitácora, en vez de tres copias que se van
 * separando de a poco.
 */

import { inArray, sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import type { DB, Tx } from "@/db"
import type { WorksiteScope } from "@/lib/auth/scope"
import { recordModuleHistory } from "@/lib/audit"

export type CphsClient = DB | Tx

export interface CphsAccess {
  userId: string
  scope: WorksiteScope
  permissions: readonly string[]
}

/** Un solo mensaje para "no existe" y "no tienes acceso": no filtra existencia. */
export const CPHS_NOT_FOUND = "Registro de comité no encontrado o fuera de alcance."

export function nowIso() {
  return new Date().toISOString()
}

export function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

export function requireCphsAccess(access: CphsAccess, permission: string, worksiteId?: string) {
  if (!access.permissions.includes(permission) || (worksiteId && !scopeAllows(access.scope, worksiteId))) {
    throw new Error(CPHS_NOT_FOUND)
  }
}

export function cphsScopeCondition(scope: WorksiteScope, column: AnyPgColumn) {
  if (scope.mode === "all") return undefined
  if (scope.mode === "none" || scope.ids.length === 0) return sql`false`
  return inArray(column, scope.ids)
}

export async function recordGovernanceHistory(client: CphsClient, args: {
  entityType: string
  entityId: string
  worksiteId?: string | null
  changeType: string
  reason: string
  beforeState?: unknown
  afterState?: unknown
  actorUserId?: string | null
}) {
  await recordModuleHistory(client, {
    module: "governance",
    entityType: args.entityType,
    entityId: args.entityId,
    worksiteId: args.worksiteId ?? null,
    changeType: args.changeType,
    reason: args.reason,
    beforeState: "beforeState" in args ? (args as { beforeState?: unknown }).beforeState : undefined,
    afterState: args.afterState,
    actorUserId: args.actorUserId ?? null,
  })
}
