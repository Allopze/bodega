import { and, asc, inArray, isNull, lt } from "drizzle-orm"
import { db } from "@/db"
import { mantRecordPhotos } from "@/db/schema"
import { logger } from "@/lib/logger"
import { resolveMantencionFile } from "@/lib/storage/config"
import { removeFile } from "@/lib/storage/helpers"

/**
 * Recolector de fotos huérfanas de mantención (auditoría 2026-11, D1).
 *
 * El teléfono (y el formulario web) suben cada foto ANTES que el registro que la
 * nombra, así que una foto vive con `record_id` nulo hasta que llega el registro.
 * Si ese registro nunca llega (cola descartada, app desinstalada, error del
 * formulario web) la fila y el archivo quedaban para siempre. Pasada la ventana
 * de gracia —más larga que cualquier cola sin conexión razonable— se borran.
 */

/** Gracia antes de dar una foto por abandonada. */
export const ORPHAN_PHOTO_MAX_AGE_DAYS = 7
/** Filas por corrida: acota el trabajo y el tiempo de una sola ejecución. */
export const ORPHAN_PHOTO_BATCH_SIZE = 200

export interface PurgeOrphanPhotosOptions {
  now?: Date
  maxAgeDays?: number
  batchSize?: number
}

export interface PurgeOrphanPhotosResult {
  /** Fotos huérfanas vencidas encontradas en esta corrida (hasta el tope del lote). */
  found: number
  /** Filas borradas. */
  deletedRows: number
  /** Archivos borrados (o que ya no estaban). */
  deletedFiles: number
  /** Archivos que no se pudieron borrar: quedaron sin fila y se avisan en el log. */
  fileFailures: number
  /** Quedan más huérfanas vencidas que el lote: la próxima corrida sigue. */
  hasMore: boolean
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT"
}

export async function purgeOrphanMantencionPhotos(options: PurgeOrphanPhotosOptions = {}): Promise<PurgeOrphanPhotosResult> {
  const now = options.now ?? new Date()
  const maxAgeDays = options.maxAgeDays ?? ORPHAN_PHOTO_MAX_AGE_DAYS
  const batchSize = options.batchSize ?? ORPHAN_PHOTO_BATCH_SIZE
  const cutoff = new Date(now.getTime() - maxAgeDays * 24 * 3_600_000).toISOString()

  const stale = and(isNull(mantRecordPhotos.recordId), lt(mantRecordPhotos.receivedAt, cutoff))
  // Una más que el lote: dice si quedan pendientes sin otra consulta.
  const candidates = await db
    .select({ id: mantRecordPhotos.id })
    .from(mantRecordPhotos)
    .where(stale)
    .orderBy(asc(mantRecordPhotos.receivedAt))
    .limit(batchSize + 1)
  const hasMore = candidates.length > batchSize
  const ids = candidates.slice(0, batchSize).map((row) => row.id)
  if (ids.length === 0) return { found: 0, deletedRows: 0, deletedFiles: 0, fileFailures: 0, hasMore: false }

  // La fila se borra primero y sólo si SIGUE huérfana: un registro que la reclame
  // entre la consulta y este borrado la deja intacta (y con ella su archivo).
  // Borrar el archivo antes expondría una foto anclada sin su imagen.
  const removed = await db
    .delete(mantRecordPhotos)
    .where(and(inArray(mantRecordPhotos.id, ids), isNull(mantRecordPhotos.recordId), lt(mantRecordPhotos.receivedAt, cutoff)))
    .returning({ id: mantRecordPhotos.id, storageKey: mantRecordPhotos.storageKey })

  let deletedFiles = 0
  let fileFailures = 0
  for (const row of removed) {
    const filePath = resolveMantencionFile(row.storageKey)
    if (!filePath) {
      fileFailures += 1
      logger.warn("[mantencion/fotos-huerfanas] ruta de archivo inválida; se borró la fila pero no el archivo", { photoId: row.id })
      continue
    }
    try {
      await removeFile(filePath)
      deletedFiles += 1
    } catch (error) {
      if (isMissingFile(error)) { deletedFiles += 1; continue }
      fileFailures += 1
      logger.warn("[mantencion/fotos-huerfanas] no se pudo borrar el archivo de una foto huérfana", { photoId: row.id, error })
    }
  }

  return { found: ids.length, deletedRows: removed.length, deletedFiles, fileFailures, hasMore }
}

