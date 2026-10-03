import { createHash } from "node:crypto"
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import type { DB, Tx } from "@/db"
import { preventionRiskMatrices, users, worksiteUsers } from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { recordModuleHistory } from "@/lib/audit"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"

export type Client = DB | Tx

export interface MiperAccess {
  userId: string
  scope: WorksiteScope
  permissions: readonly string[]
}

export type MiperHistoryObject =
  | "matrix" | "header" | "entry" | "control" | "round" | "observation" | "version"
  /* Programa de Trabajo Preventivo RE-04.1 (F2): el programa, sus actividades,
     las ocurrencias de ejecución y la evidencia que las acredita. La línea de
     tiempo sigue colgando de la matriz, así que estos objetos viajan en
     `newState.object` igual que los de la F1. */
  | "program" | "program_action" | "occurrence" | "evidence"

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
    /* La clave persistida del rol con que actuó la persona es `roleContext`
     * (§4.9 del spec). El parámetro sigue llamándose `actingAs` para no romper
     * el contrato que ya consumen los servicios de F1 (workflow, entries…). */
    extra: { object: args.object, objectId: args.objectId, roleContext: args.actingAs },
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

/**
 * Responsables que se ofrecen en una faena: sus usuarios activos, por nombre, y
 * —si no está entre ellos— quien edita.
 * - El editor de la medida los OFRECE (`getMiperWorkspace`), pero al guardar
 *   `saveMiperControl` sólo exige que la persona esté activa, no que sea de la
 *   faena.
 * - La importación (Fase C) los ofrece en la vista previa y la carga ACEPTA sólo
 *   a estas personas (`importResponsibleNames`): ahí lo que se ofrece y lo que se
 *   acepta son lo mismo.
 */
export async function worksiteResponsibleOptions(client: Client, worksiteId: string, selfUserId: string): Promise<Array<{ id: string; name: string }>> {
  const rows = await client.select({ id: users.id, name: users.name }).from(worksiteUsers).innerJoin(users, eq(users.id, worksiteUsers.userId))
    .where(and(eq(worksiteUsers.worksiteId, worksiteId), eq(users.isActive, true))).orderBy(asc(users.name))
  if (rows.some((row) => row.id === selfUserId)) return rows
  const [self] = await client.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.id, selfUserId), eq(users.isActive, true))).limit(1)
  return self ? [...rows, self] : rows
}
