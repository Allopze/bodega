/**
 * Lectura de las plantillas de checklist por actividad PDTP.
 *
 * El motor que las redactaba y las llenaba se retiró: los instrumentos viven en
 * el módulo de Inspecciones. La tabla se conserva porque está **dentro de la
 * huella firmada** del programa (`content-digest.ts` emite una clave
 * `checklists` construida desde ella, y los snapshots ya firmados la
 * contienen). Sus filas nacen hoy por una sola vía: copiar hacia adelante un
 * snapshot ya firmado —instanciar una plantilla, copiar un programa, duplicar
 * una actividad, aplicar una diferencia de base o importar—.
 *
 * De ahí que aquí sólo quede lectura. Escribir volvería a abrir la puerta que
 * el retiro cerró.
 */

import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivityChecklists } from "@/db/schema"
import type { ChecklistDefinition } from "@/lib/sst/types"

export type PdtpChecklistTemplate = typeof pdtpActivityChecklists.$inferSelect & {
  definition: ChecklistDefinition
}

function parseDefinition(row: typeof pdtpActivityChecklists.$inferSelect): PdtpChecklistTemplate {
  return { ...row, definition: row.definitionJson as unknown as ChecklistDefinition }
}

/** Plantillas activas de todas las actividades de un programa. */
export async function listProgramActiveChecklists(programId: string): Promise<PdtpChecklistTemplate[]> {
  const rows = await db.select().from(pdtpActivityChecklists)
    .where(and(
      eq(pdtpActivityChecklists.programId, programId),
      eq(pdtpActivityChecklists.isActive, true),
    ))
  return rows.map(parseDefinition)
}
