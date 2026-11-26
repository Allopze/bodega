import type { Tx } from "@/db"
import { mantWorkOrderEvents } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"

/** Evento `parts_note_resolved` de la OT + auditoría de la NP: el rastro de toda resolución. */
export async function writeTrail(tx: Tx, input: {
  workOrderId: string
  worksiteId: string
  noteId: string
  code: string
  actor: { userId: string; email?: string | null }
  action: "update" | "cancel"
  reason?: string | null
  changeSet: Record<string, unknown>
  oldState?: Record<string, unknown>
}) {
  await tx.insert(mantWorkOrderEvents).values({
    id: nanoid(),
    workOrderId: input.workOrderId,
    type: "parts_note_resolved",
    reason: input.reason ?? null,
    changeSet: { noteId: input.noteId, code: input.code, ...input.changeSet },
    actorUserId: input.actor.userId,
  })
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
