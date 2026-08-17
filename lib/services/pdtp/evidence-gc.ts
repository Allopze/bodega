/**
 * lib/services/pdtp/evidence-gc.ts
 *
 * Recolector de archivos huérfanos en `storage/pdtp-evidence/`. Un archivo
 * se considera huérfano cuando su `name` (el nombre generado por
 * `nanoid`) no aparece en `pdtp_executions.evidence_url`, en
 * `pdtp_executions.evidence_photos` ni en `prevention_capa_evidence.reference`
 * de ninguna fila.
 *
 * El directorio tiene DOS productores, no uno: `pdtp-execution-form.tsx` (que
 * vincula el archivo a `pdtp_executions`) y `execution-action-plan-panel.tsx`
 * (que lo vincula a `prevention_capa_evidence` vía `addPdtpFollowupAction`).
 * Ambos suben por el mismo endpoint. Consultar sólo la primera tabla borraba la
 * evidencia de cierre de acciones correctivas una hora después de subirla.
 * Cualquier consumidor nuevo del endpoint debe sumarse aquí.
 *
 * Por seguridad, sólo se eliminan archivos más viejos que `olderThanMs`
 * (default 1 hora) para no borrar archivos recién subidos que aún no
 * fueron vinculados por `markPdtpExecution` (porque el cliente puede
 * tardar entre el upload y el submit del form).
 *
 * Uso:
 *   await cleanupPdtpEvidenceOrphans({ dryRun: true })
 *   await cleanupPdtpEvidenceOrphans({ olderThanMs: 24 * 60 * 60 * 1000 })
 *
 * Pensado para llamarse desde un cron semanal o desde un endpoint
 * admin manual.
 */
import { promises as fs } from "node:fs"
import { db } from "@/db"
import { pdtpExecutions, preventionCapaEvidence } from "@/db/schema"
import { resolvePdtpEvidenceDir } from "@/lib/storage/config"
import { logger } from "@/lib/logger"

const DEFAULT_OLDER_THAN_MS = 60 * 60 * 1000 // 1 hora

export type CleanupPdtpEvidenceOrphansResult = {
  scanned: number
  deleted: number
  kept: number
  failed: number
  /** Nombres de los archivos eliminados. */
  deletedNames: string[]
}

export type CleanupPdtpEvidenceOrphansOptions = {
  olderThanMs?: number
  dryRun?: boolean
}

export async function cleanupPdtpEvidenceOrphans(
  options: CleanupPdtpEvidenceOrphansOptions = {},
): Promise<CleanupPdtpEvidenceOrphansResult> {
  const olderThanMs = options.olderThanMs ?? DEFAULT_OLDER_THAN_MS
  const dryRun = options.dryRun ?? false
  const result: CleanupPdtpEvidenceOrphansResult = {
    scanned: 0,
    deleted: 0,
    kept: 0,
    failed: 0,
    deletedNames: [],
  }

  const dir = resolvePdtpEvidenceDir()
  let files: string[]
  try {
    files = await fs.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      logger.info("[pdtp/evidence-gc] storage dir not found, nothing to do")
      return result
    }
    throw err
  }
  result.scanned = files.length

  // Carga todas las referencias conocidas de la DB, de los DOS productores del
  // directorio. Construimos un set de nombres referenciados para detectar orphans.
  const referenced = new Set<string>()
  const addReference = (value: unknown) => {
    if (typeof value !== "string" || value.length === 0) return
    const name = value.split("/").pop()
    if (name) referenced.add(name)
  }

  const [rows, capaRows] = await Promise.all([
    db
      .select({
        evidenceUrl: pdtpExecutions.evidenceUrl,
        evidencePhotos: pdtpExecutions.evidencePhotos,
      })
      .from(pdtpExecutions),
    // Evidencia de seguimiento de acciones correctivas: vive en otra tabla pero
    // en el mismo directorio. `kind` puede ser 'url'/'note', cuyo `reference` no
    // es un archivo; extraer su basename sólo puede añadir un nombre de más al
    // set, que es el lado seguro (conserva, nunca borra de más).
    db.select({ reference: preventionCapaEvidence.reference }).from(preventionCapaEvidence),
  ])

  for (const row of rows) {
    addReference(row.evidenceUrl)
    if (Array.isArray(row.evidencePhotos)) {
      for (const p of row.evidencePhotos) addReference(p)
    }
  }
  for (const row of capaRows) addReference(row.reference)

  const cutoff = Date.now() - olderThanMs

  for (const name of files) {
    if (referenced.has(name)) {
      result.kept++
      continue
    }
    try {
      const stat = await fs.stat(`${dir}/${name}`)
      if (stat.mtimeMs > cutoff) {
        // Muy reciente — probablemente upload sin submit todavía.
        result.kept++
        continue
      }
      if (!dryRun) {
        await fs.unlink(`${dir}/${name}`)
      }
      result.deleted++
      result.deletedNames.push(name)
    } catch (err) {
      result.failed++
      logger.warn(`[pdtp/evidence-gc] failed to process ${name}`, err)
    }
  }

  logger.info("[pdtp/evidence-gc] done", { ...result, dryRun })
  return result
}
