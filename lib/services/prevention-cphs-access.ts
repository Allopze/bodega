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
import { preventionGovernanceHistory } from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"

export type CphsClient = DB | Tx

export interface CphsAccess {
  userId: string
  scope: WorksiteScope
  permissions: readonly string[]
}

/** Un solo mensaje para "no existe" y "no tienes acceso": no filtra existencia. */
export const CPHS_NOT_FOUND = "Registro de comité no encontrado o fuera de alcance."

const CHILE_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" })

export function todayInChile() {
  return CHILE_DATE_FORMAT.format(new Date())
}

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
