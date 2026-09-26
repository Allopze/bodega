/**
 * Historial de envíos de una ejecución PDTP (PREV-I04, D10).
 *
 * La ejecución es una fila mutable: cada reenvío reescribe cantidad, texto,
 * archivo, autor y motivo de rechazo. Sin esta traza no había forma de
 * reconstruir qué se presentó, quién lo rechazó y por qué. D10 decidió no
 * crear una tabla: cada transición se escribe en el `audit_log` compartido vía
 * `recordModuleHistory`, dentro de la misma transacción que la produce, con el
 * número de intento y las rutas de la evidencia de ese momento.
 *
 * `entityType` queda `pdtp:execution` y `newState.changeType` dice qué pasó:
 * `submitted`, `resubmitted`, `approved`, `rejected` o `revoked`.
 */
import { and, asc, eq, inArray } from "drizzle-orm"
import { db, type DB } from "@/db"
import { auditLog, users } from "@/db/schema"
import { recordModuleHistory } from "@/lib/audit"

export const PDTP_EXECUTION_HISTORY_ENTITY = "pdtp:execution"

export type PdtpExecutionHistoryChange = "submitted" | "resubmitted" | "approved" | "rejected" | "revoked"

/** Lo que la ejecución decía en un momento: lo mínimo para reconstruir el intento. */
export type PdtpExecutionHistorySnapshot = {
  status: string
  attempt?: number | null
  executedQuantity?: number | null
  evidenceText?: string | null
  evidenceUrl: string | null
  evidencePhotos: string[]
  evidenceSha256?: Record<string, string>
  executedByUserId?: string | null
  rejectionReason?: string | null
}

export async function recordPdtpExecutionHistory(
  client: Pick<DB, "insert">,
  args: {
    executionId: string
    worksiteId: string
    changeType: PdtpExecutionHistoryChange
    actorUserId: string | null
    reason?: string | null
    before?: PdtpExecutionHistorySnapshot | null
    after: PdtpExecutionHistorySnapshot
  },
): Promise<void> {
  await recordModuleHistory(client, {
    module: "pdtp",
    entityType: "execution",
    entityId: args.executionId,
    worksiteId: args.worksiteId,
    changeType: args.changeType,
    reason: args.reason ?? null,
    beforeState: args.before ?? undefined,
    afterState: args.after,
    actorUserId: args.actorUserId,
  })
}

/** La foto de una fila de `pdtp_executions` que va al historial. */
export function pdtpExecutionHistorySnapshot(row: {
  status: string
  executedQuantity?: number | null
  evidenceText?: string | null
  evidenceUrl: string | null
  evidencePhotos: unknown
  executedByUserId?: string | null
  rejectionReason?: string | null
  sourceMetadataJson?: unknown
}): PdtpExecutionHistorySnapshot {
  const evidenceSha256 = pdtpEvidenceSha256Map(row.sourceMetadataJson)
  return {
    status: row.status,
    attempt: pdtpSubmissionAttempt(row.sourceMetadataJson),
    executedQuantity: row.executedQuantity ?? null,
    evidenceText: row.evidenceText ?? null,
    evidenceUrl: row.evidenceUrl ?? null,
    evidencePhotos: Array.isArray(row.evidencePhotos)
      ? row.evidencePhotos.filter((photo): photo is string => typeof photo === "string")
      : [],
    ...(Object.keys(evidenceSha256).length > 0 ? { evidenceSha256 } : {}),
    executedByUserId: row.executedByUserId ?? null,
    rejectionReason: row.rejectionReason ?? null,
  }
}

/**
 * Metadatos de un nuevo intento: sube el contador y suma el sha256 de los
 * archivos recién vinculados sin tocar el de los anteriores. Una ruta ya
 * registrada conserva el checksum de cuando se vinculó por primera vez: ese es
 * el que el escaneo de integridad compara.
 */
export function pdtpNextSubmissionMetadata(
  previous: unknown,
  args: { isResubmission: boolean; linkedPaths: Array<string | null>; incomingSha256: Record<string, string> },
): Record<string, unknown> & { submissionAttempt: number; evidenceSha256: Record<string, string> } {
  const base = sourceMetadataRecord(previous)
  const evidenceSha256 = { ...pdtpEvidenceSha256Map(previous) }
  const linked = new Set(args.linkedPaths.filter((path): path is string => Boolean(path)))
  for (const [path, hash] of Object.entries(args.incomingSha256)) {
    if (linked.has(path) && !evidenceSha256[path]) evidenceSha256[path] = hash
  }
  return {
    ...base,
    submissionAttempt: args.isResubmission ? pdtpSubmissionAttempt(previous) + 1 : 1,
    evidenceSha256,
  }
}

/** Intento vigente guardado junto a la ejecución; las filas previas a T4 cuentan como el primero. */
export function pdtpSubmissionAttempt(sourceMetadata: unknown): number {
  const value = sourceMetadataRecord(sourceMetadata).submissionAttempt
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 1
}

/** sha256 por ruta, guardado junto a la ejecución al vincular cada archivo (W5-SHA). */
export function pdtpEvidenceSha256Map(sourceMetadata: unknown): Record<string, string> {
  const value = sourceMetadataRecord(sourceMetadata).evidenceSha256
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && /^[0-9a-f]{64}$/.test(entry[1])),
  )
}

function sourceMetadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Rutas de evidencia que menciona un estado del historial (antes o después). */
export function pdtpHistoryEvidencePaths(state: unknown): string[] {
  const record = sourceMetadataRecord(state)
  const paths: string[] = []
  if (typeof record.evidenceUrl === "string" && record.evidenceUrl) paths.push(record.evidenceUrl)
  if (Array.isArray(record.evidencePhotos)) {
    for (const photo of record.evidencePhotos) if (typeof photo === "string" && photo) paths.push(photo)
  }
  return [...new Set(paths)]
}

export function parsePdtpHistoryState(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

export type PdtpExecutionHistoryEntry = {
  id: string
  changeType: PdtpExecutionHistoryChange | string
  at: string
  actorUserId: string | null
  actorName: string | null
  attempt: number | null
  status: string | null
  reason: string | null
  executedQuantity: number | null
  evidenceText: string | null
  /** Archivos del intento: el principal primero, luego los anteriores conservados. */
  files: string[]
}

/** La línea de tiempo de una ejecución, de la más antigua a la más reciente. */
export async function listPdtpExecutionHistory(executionId: string): Promise<PdtpExecutionHistoryEntry[]> {
  const rows = await db.select({
    id: auditLog.id,
    userId: auditLog.userId,
    newState: auditLog.newState,
    reason: auditLog.reason,
    createdAt: auditLog.createdAt,
  })
    .from(auditLog)
    .where(and(eq(auditLog.entityType, PDTP_EXECUTION_HISTORY_ENTITY), eq(auditLog.entityId, executionId)))
    .orderBy(asc(auditLog.createdAt), asc(auditLog.id))

  const actorIds = [...new Set(rows.map((row) => row.userId).filter((id): id is string => Boolean(id)))]
  const actors = actorIds.length > 0
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, actorIds))
    : []
  const nameById = new Map(actors.map((actor) => [actor.id, actor.name]))

  return rows.map((row) => {
    const state = parsePdtpHistoryState(row.newState) ?? {}
    const quantity = state.executedQuantity
    return {
      id: row.id,
      changeType: typeof state.changeType === "string" ? state.changeType : "update",
      at: row.createdAt,
      actorUserId: row.userId,
      actorName: row.userId ? nameById.get(row.userId) ?? null : null,
      attempt: typeof state.attempt === "number" ? state.attempt : null,
      status: typeof state.status === "string" ? state.status : null,
      reason: row.reason ?? null,
      executedQuantity: typeof quantity === "number" ? quantity : null,
      evidenceText: typeof state.evidenceText === "string" ? state.evidenceText : null,
      files: pdtpHistoryEvidencePaths(state),
    }
  })
}
