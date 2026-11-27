import { sql } from "drizzle-orm"
import type { DB } from "@/db"
import * as schema from "@/db/schema"

/**
 * Vacía el historial de las notas de pedido antes de borrar las notas en la limpieza de una suite.
 *
 * `mant_parts_note_events` es append-only (trigger `mant_parts_note_events_append_only`, migración 0405): ni la
 * aplicación ni la base lo editan. Sólo una prueba que reinicia la base lo necesita, así que el trigger se apaga
 * ÚNICAMENTE para borrar el historial y se vuelve a encender en el mismo bloque. Las notas no pueden borrarse mientras
 * tengan historial (`ON DELETE RESTRICT`), por eso va antes de borrar `mant_parts_notes`.
 */
export async function clearNoteHistory(db: DB): Promise<void> {
  await db.execute(sql`ALTER TABLE "mant_parts_note_events" DISABLE TRIGGER "mant_parts_note_events_append_only"`)
  try {
    await db.delete(schema.mantPartsNoteEvents)
  } finally {
    await db.execute(sql`ALTER TABLE "mant_parts_note_events" ENABLE TRIGGER "mant_parts_note_events_append_only"`)
  }
}
