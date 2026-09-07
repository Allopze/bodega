import { eq, desc } from "drizzle-orm"
import { db, type DB } from "@/db"
import { itAssetHistory } from "@/db/schema"
import { nanoid } from "@/lib/id"

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0]

export type ItHistoryAction =
  | "created" | "assigned" | "returned" | "status_changed" | "edited"
  | "maintenance" | "maintenance_voided" | "ticket" | "document" | "photo"
  | "warranty" | "retired" | "retirement_reversed"

export interface AppendHistoryInput {
  assetId: string
  action: ItHistoryAction
  detail: string
  changes?: Record<string, unknown>
  actorUserId?: string | null
}

/**
 * Agrega una entrada a la línea de tiempo del activo. Siempre dentro de la
 * misma transacción que la mutación que la origina: si la mutación se revierte,
 * la historia no queda mintiendo. Nunca se editan ni borran entradas — la
 * trazabilidad del módulo TI es append-only.
 */
export async function appendAssetHistory(input: AppendHistoryInput, client: Tx | typeof db = db): Promise<string> {
  const id = nanoid()
  await client.insert(itAssetHistory).values({
    id,
    assetId: input.assetId,
    action: input.action,
    detail: input.detail,
    changes: input.changes ? JSON.stringify(input.changes) : null,
    actorUserId: input.actorUserId ?? null,
  })
  return id
}

export async function getAssetHistory(assetId: string) {
  return db
    .select({
      id: itAssetHistory.id,
      action: itAssetHistory.action,
      detail: itAssetHistory.detail,
      changes: itAssetHistory.changes,
      actorUserId: itAssetHistory.actorUserId,
      createdAt: itAssetHistory.createdAt,
    })
    .from(itAssetHistory)
    .where(eq(itAssetHistory.assetId, assetId))
    .orderBy(desc(itAssetHistory.createdAt), desc(itAssetHistory.id))
}
