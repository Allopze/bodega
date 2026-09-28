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

/** Movido a `lib/action-error.ts`, junto a `isForeignKeyViolation`. */
export { isUniqueViolation } from "@/lib/action-error"
