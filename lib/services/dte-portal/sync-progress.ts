/**
 * Avance publicado de la corrida DTE en curso.
 *
 * `dte_sync_runs` sólo distingue "running" de terminada: sus contadores se
 * escriben al cerrar, así que durante los minutos que puede durar una corrida
 * manual el operador no tiene nada que mirar. Esto publica la etapa y el avance
 * en `system_settings` —sin migración, mismo patrón que el estado del sync
 * Copec— y lo borra al terminar.
 *
 * ponytail: una sola clave, o sea una corrida visible a la vez. El índice único
 * de `dte_sync_runs` ya impide dos `running` del mismo período y empresa; si
 * algún día hay que ver varias en paralelo, la clave lleva el runId.
 */

import { eq } from "drizzle-orm"
import { db } from "@/db"
import { systemSettings } from "@/db/schema"

// No puede empezar en `dte.`: ese prefijo lo barre —y lo bloquea FOR UPDATE— la
// transacción de credenciales de settings.ts.
const PROGRESS_KEY = "admin.dte_sync.progress"

export type DteSyncPhase = "portal" | "documentos" | "conciliacion"

export interface DteSyncProgress {
  runId: string
  periodo: string
  phase: DteSyncPhase
  /** Documentos ya persistidos. 0 mientras se consulta el portal. */
  processed: number
  /** Documentos que entregó el portal. 0 hasta que responde. */
  total: number
}

/** Nunca lanza: el avance es accesorio y no puede voltear una corrida buena. */
export async function publishDteSyncProgress(progress: DteSyncProgress): Promise<void> {
  const value = JSON.stringify(progress)
  try {
    await db.insert(systemSettings).values({ key: PROGRESS_KEY, value }).onConflictDoUpdate({
      target: systemSettings.key,
      set: { value, updatedAt: new Date().toISOString() },
    })
  } catch { /* ignorado a propósito */ }
}

/** Borra el avance si sigue siendo el de esta corrida. Nunca lanza. */
export async function clearDteSyncProgress(runId: string): Promise<void> {
  try {
    const current = await readDteSyncProgress()
    if (current && current.runId !== runId) return
    await db.delete(systemSettings).where(eq(systemSettings.key, PROGRESS_KEY))
  } catch { /* ignorado a propósito */ }
}

export async function readDteSyncProgress(): Promise<DteSyncProgress | null> {
  const row = await db.query.systemSettings.findFirst({ where: eq(systemSettings.key, PROGRESS_KEY) })
  if (!row) return null
  try {
    const parsed = JSON.parse(row.value) as Partial<DteSyncProgress>
    return parsed.runId ? (parsed as DteSyncProgress) : null
  } catch {
    return null
  }
}
