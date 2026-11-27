import { asc, eq, inArray, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { mantPartsNoteEvents, mantPartsNoteItems, mantPartsNotes, users } from "@/db/schema"
import type { PartsNoteEvent, PartsNoteStatus } from "../parts/types"

/**
 * Lectura del historial de una nota de pedido (`mant_parts_note_events`, append-only). El ORDEN real es `seq`: `created_at`
 * puede repetirse dentro de una misma transacción. El último evento dice el estado actual (invariante de `set-status.ts`),
 * así que «desde cuándo está en este estado» es el `created_at` del evento de mayor `seq`.
 *
 * El alcance lo pone quien llama: aquí sólo se lee lo de las notas que ya pasaron por `noteVisibility`.
 */

type Reader = Pick<Tx, "select">

/**
 * Subconsulta correlacionada con `mant_parts_notes`: el momento del último evento de la nota. Sin eventos (no debería
 * pasar tras la migración 0405, que sembró uno por nota) cae a la creación de la nota.
 */
export const statusSinceSql = sql<string>`coalesce(
  (select ${mantPartsNoteEvents.createdAt} from ${mantPartsNoteEvents}
    where ${mantPartsNoteEvents.noteId} = ${mantPartsNotes.id}
    order by ${mantPartsNoteEvents.seq} desc limit 1),
  ${mantPartsNotes.createdAt}
)`

const iso = (value: string) => new Date(value).toISOString()

/** Los eventos de varias notas a la vez (la exportación y el detalle), agrupados por nota y en orden. Una sola lectura. */
export async function loadEventsByNote(noteIds: readonly string[], client: Reader = db): Promise<Map<string, PartsNoteEvent[]>> {
  const byNote = new Map<string, PartsNoteEvent[]>()
  if (noteIds.length === 0) return byNote
  const rows = await client
    .select({
      noteId: mantPartsNoteEvents.noteId,
      id: mantPartsNoteEvents.id,
      kind: mantPartsNoteEvents.kind,
      fromStatus: mantPartsNoteEvents.fromStatus,
      toStatus: mantPartsNoteEvents.toStatus,
      reason: mantPartsNoteEvents.reason,
      actorName: users.name,
      itemDescription: mantPartsNoteItems.description,
      createdAt: mantPartsNoteEvents.createdAt,
    })
    .from(mantPartsNoteEvents)
    .leftJoin(users, eq(users.id, mantPartsNoteEvents.actorUserId))
    .leftJoin(mantPartsNoteItems, eq(mantPartsNoteItems.id, mantPartsNoteEvents.itemId))
    .where(inArray(mantPartsNoteEvents.noteId, [...noteIds]))
    .orderBy(asc(mantPartsNoteEvents.noteId), asc(mantPartsNoteEvents.seq))
  for (const row of rows) {
    const list = byNote.get(row.noteId) ?? []
    list.push({
      id: row.id,
      kind: row.kind as PartsNoteEvent["kind"],
      fromStatus: (row.fromStatus as PartsNoteStatus | null) ?? null,
      toStatus: row.toStatus as PartsNoteStatus,
      reason: row.reason,
      actorName: row.actorName,
      itemDescription: row.itemDescription,
      createdAt: iso(row.createdAt),
    })
    byNote.set(row.noteId, list)
  }
  return byNote
}

/** Los eventos de una nota, del más antiguo al más reciente, con quién (o «automático») y la línea que lo causó. */
export async function loadNoteEvents(noteId: string, client: Reader = db): Promise<PartsNoteEvent[]> {
  return (await loadEventsByNote([noteId], client)).get(noteId) ?? []
}
