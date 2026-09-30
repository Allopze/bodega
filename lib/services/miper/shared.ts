import { createHash } from "node:crypto"
import { and, eq, inArray, sql, type SQL } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import type { DB, Tx } from "@/db"
import { preventionRiskMatrices, users } from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { recordModuleHistory } from "@/lib/audit"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"

export type Client = DB | Tx

export interface MiperAccess {
  userId: string
  scope: WorksiteScope
  permissions: readonly string[]
}

export type MiperHistoryObject = "matrix" | "header" | "entry" | "control" | "round" | "observation" | "version"

export const OUT_OF_SCOPE = "Registro preventivo no encontrado o fuera de alcance."

export function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

export function requireAccess(access: MiperAccess, permission: string, worksiteId?: string) {
  if (!access.permissions.includes(permission) || (worksiteId && !scopeAllows(access.scope, worksiteId))) {
    throw new RiskLegalDomainError(OUT_OF_SCOPE)
  }
}

export function scopeCondition(scope: WorksiteScope, column: AnyPgColumn): SQL | undefined {
  if (scope.mode === "all") return undefined
  if (scope.mode === "none" || scope.ids.length === 0) return sql`false`
  return inArray(column, scope.ids)
}

export function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

export function nowIso() {
  return new Date().toISOString()
}

/**
 * Toda la línea de tiempo de un MIPER cuelga de la matriz (entity_id =
 * matrixId): la pestaña Historial se lee con el índice existente
 * `audit_log_entity_idx` sin JOIN. El objeto concreto (fila, medida, ronda…)
 * viaja en `newState.object/objectId`.
 */
export async function miperHistory(client: Client, args: {
  matrixId: string
  worksiteId: string
  object: MiperHistoryObject
  objectId: string
  changeType: string
  reason?: string | null
  before?: unknown
  after?: unknown
  actorUserId: string
  actingAs: string
}) {
  await recordModuleHistory(client, {
    module: "risk_legal:risk",
    entityType: "miper",
    entityId: args.matrixId,
    worksiteId: args.worksiteId,
    changeType: args.changeType,
    reason: args.reason ?? null,
    beforeState: args.before,
    afterState: args.after,
    actorUserId: args.actorUserId,
    extra: { object: args.object, objectId: args.objectId, actingAs: args.actingAs },
  })
}

export async function lockMatrix(client: Client, matrixId: string) {
  const [matrix] = await client.select().from(preventionRiskMatrices).where(eq(preventionRiskMatrices.id, matrixId)).for("update").limit(1)
  if (!matrix) throw new RiskLegalDomainError("MIPER no encontrada o fuera de alcance.")
  return matrix
}

export function assertEditable(matrix: typeof preventionRiskMatrices.$inferSelect) {
  if (matrix.isLegacy) throw new RiskLegalDomainError("Esta MIPER usa la metodología anterior y es de solo lectura. Crea una MIPER nueva para el período.")
  if (matrix.status === "superseded") throw new RiskLegalDomainError("Esta MIPER fue reemplazada por la de otro período y ya no se puede modificar.")
}

export async function assertActiveUsers(client: Client, userIds: readonly (string | null | undefined)[]) {
  const uniqueIds = [...new Set(userIds.filter((userId): userId is string => Boolean(userId)))]
  if (uniqueIds.length === 0) return
  const active = await client.select({ id: users.id }).from(users).where(and(inArray(users.id, uniqueIds), eq(users.isActive, true)))
  if (active.length !== uniqueIds.length) throw new RiskLegalDomainError("La persona responsable no existe o está inactiva.")
}

export async function userNames(client: Client, userIds: readonly (string | null | undefined)[]) {
  const ids = [...new Set(userIds.filter((userId): userId is string => Boolean(userId)))]
  if (ids.length === 0) return new Map<string, string>()
  const rows = await client.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))
  return new Map(rows.map((row) => [row.id, row.name]))
}
