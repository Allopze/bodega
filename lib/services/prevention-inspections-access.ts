import { inArray, sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import type { DB, Tx } from "@/db"
import type { WorksiteScope } from "@/lib/auth/scope"
import { recordModuleHistory } from "@/lib/audit"

/* ── Piezas compartidas del motor de inspecciones ─────────────────────────
 * Alcance, permisos e historial. Viven acá y no en `prevention-inspections.ts`
 * porque el servicio del catálogo de desviaciones los necesita igual, y que
 * cada uno importara del otro cerraría un ciclo en tiempo de ejecución.
 */

export type Client = DB | Tx

export interface InspectionAccess {
  userId: string
  scope: WorksiteScope
  permissions: readonly string[]
}

/**
 * Mensaje único para "no existe" y "no tienes acceso".
 *
 * No distinguirlos es deliberado: decir "existe pero no puedes verlo" filtra la
 * existencia de inspecciones de faenas ajenas.
 */
export const NOT_FOUND = "Inspección no encontrada o fuera de alcance."

export function nowIso() {
  return new Date().toISOString()
}

export function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

export function requireAccess(access: InspectionAccess, permission: string, worksiteId?: string) {
  if (!access.permissions.includes(permission) || (worksiteId && !scopeAllows(access.scope, worksiteId))) {
    throw new Error(NOT_FOUND)
  }
}

export function scopeCondition(scope: WorksiteScope, column: AnyPgColumn) {
  if (scope.mode === "all") return undefined
  if (scope.mode === "none" || scope.ids.length === 0) return sql`false`
  return inArray(column, scope.ids)
}

export async function history(client: Client, args: {
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
    module: "inspection",
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

/**
 * Violación de índice único en Postgres (23505) sobre la constraint indicada.
 *
 * Recorre la cadena de `cause`: drizzle envuelve el error del driver en un
 * `DrizzleQueryError`, así que `code` y `constraint_name` no están en el objeto
 * de primer nivel — mirar sólo ahí hacía que el mensaje legible nunca saltara.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth++) {
    const candidate = current as { code?: string; constraint_name?: string; constraint?: string; cause?: unknown }
    if (candidate.code === "23505" && (candidate.constraint_name === constraint || candidate.constraint === constraint)) {
      return true
    }
    current = candidate.cause
  }
  return false
}
