import type { Tx } from "@/db"
import { mantWorkOrderEvents } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"

/**
 * Rastro de un cambio sobre una línea o una cabecera de nota de pedido (NP): auditoría de la NP siempre, y el evento
 * `parts_note_resolved` de la OT sólo si la NP tiene OT (ADR 0001, 2026-11-27: una NP sin OT no escribe en ningún evento
 * de OT).
 */
export async function writeTrail(tx: Tx, input: {
  /** Null = nota sin OT: no hay evento de OT. */
  workOrderId: string | null
  worksiteId: string
  noteId: string
  code: string
  /** Quien hace el cambio: el evento de la OT exige un usuario (`actor_user_id` no es nulo). */
  actor: { userId: string; email?: string | null }
  action: "create" | "update" | "cancel" | "status_change"
  reason?: string | null
  changeSet: Record<string, unknown>
  oldState?: Record<string, unknown>
}) {
  if (input.workOrderId) {
    await tx.insert(mantWorkOrderEvents).values({
      id: nanoid(),
      workOrderId: input.workOrderId,
      type: "parts_note_resolved",
      reason: input.reason ?? null,
      changeSet: { noteId: input.noteId, code: input.code, ...input.changeSet },
      actorUserId: input.actor.userId,
    })
  }
  await recordAudit({
    userId: input.actor.userId,
    userEmail: input.actor.email ?? undefined,
    action: input.action,
    entityType: "mant_parts_note",
    entityId: input.noteId,
    entityCode: input.code,
    oldState: input.oldState,
    newState: input.changeSet,
    reason: input.reason ?? undefined,
    worksiteId: input.worksiteId,
  }, tx)
}
