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
import { pdtpExecutions, preventionCapaEvidence, preventionInspectionAnswerEvidence, preventionRiskMapLayouts } from "@/db/schema"
import { resolveInspectionEvidenceDir, resolvePdtpEvidenceDir, resolveRiskMapDir } from "@/lib/storage/config"
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

  await sweepOrphans({ dir, referenced, olderThanMs, dryRun, label: "pdtp/evidence-gc" }, result)

  logger.info("[pdtp/evidence-gc] done", { ...result, dryRun })
  return result
}

/**
 * Barrido compartido de un directorio de evidencia.
 *
 * Extraído para que el directorio de inspecciones use exactamente la misma
 * política —ventana de gracia y conteos— sin duplicarla: dos implementaciones
 * del mismo barrido son dos lugares donde ajustar el umbral y olvidar uno.
 */
async function sweepOrphans(args: {
  dir: string
  referenced: Set<string>
  olderThanMs: number
  dryRun: boolean
  label: string
}, result: CleanupPdtpEvidenceOrphansResult): Promise<void> {
  let files: string[]
  try {
    files = await fs.readdir(args.dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      logger.info(`[${args.label}] storage dir not found, nothing to do`)
      return
    }
    throw err
  }
  result.scanned += files.length

  const cutoff = Date.now() - args.olderThanMs
  for (const name of files) {
    if (args.referenced.has(name)) {
      result.kept++
      continue
    }
    try {
      const stat = await fs.stat(`${args.dir}/${name}`)
      if (stat.mtimeMs > cutoff) {
        // Muy reciente — probablemente upload sin submit todavía.
        result.kept++
        continue
      }
      if (!args.dryRun) {
        await fs.unlink(`${args.dir}/${name}`)
      }
      result.deleted++
      result.deletedNames.push(name)
    } catch (err) {
      result.failed++
      logger.warn(`[${args.label}] failed to process ${name}`, err)
    }
  }
}

/**
 * Recolector del directorio `storage/inspection-evidence/` (función #1).
 *
 * Espacio propio, productor único: `prevention_inspection_answer_evidence`.
 * Existe porque subir el archivo y guardarlo son operaciones separadas — si el
 * usuario sube una foto y abandona sin guardar, o si el DELETE del conjunto de
 * respuestas (B-02) se lleva la fila por cascada, el archivo queda huérfano.
 */
export async function cleanupInspectionEvidenceOrphans(
  options: CleanupPdtpEvidenceOrphansOptions = {},
): Promise<CleanupPdtpEvidenceOrphansResult> {
  const olderThanMs = options.olderThanMs ?? DEFAULT_OLDER_THAN_MS
  const dryRun = options.dryRun ?? false
  const result: CleanupPdtpEvidenceOrphansResult = {
    scanned: 0, deleted: 0, kept: 0, failed: 0, deletedNames: [],
  }

  const referenced = new Set<string>()
  const rows = await db.select({ path: preventionInspectionAnswerEvidence.path })
    .from(preventionInspectionAnswerEvidence)
  for (const row of rows) {
    const name = row.path.split("/").pop()
    if (name) referenced.add(name)
  }

  await sweepOrphans({
    dir: resolveInspectionEvidenceDir(),
    referenced, olderThanMs, dryRun,
    label: "inspections/evidence-gc",
  }, result)

  logger.info("[inspections/evidence-gc] done", { ...result, dryRun })
  return result
}

/**
 * Recolector del directorio `storage/risk-map/` (MIP-002).
 *
 * Los planos de riesgo no tenían recolección de ninguna clase: subir uno nuevo
 * archiva el anterior —el histórico de planos es evidencia y se conserva a
 * propósito— pero un plano que nunca llegó a registrarse en base, o cuya fila
 * desapareció con su faena por cascada, quedaba en disco para siempre. Nada
 * distinguía "histórico conservado a propósito" de "archivo olvidado".
 *
 * **Sólo se borra lo que NINGUNA fila referencia**, esté activa o archivada:
 * eso no necesita una política de retención, que es justamente lo que la
 * plataforma todavía no declara. Un plano archivado y referenciado se conserva
 * intacto; cuánto tiempo debe conservarse es una decisión pendiente.
 *
 * Productor único del directorio: `POST /api/prevencion/cgrd/mapa`, que
 * vincula el archivo a `prevention_risk_map_layouts.image_path`. La ventana de
 * gracia (`olderThanMs`) existe por lo mismo que en PDTP: el archivo se sube
 * antes de que exista la fila que lo referencia.
 */
export async function cleanupRiskMapOrphans(
  options: CleanupPdtpEvidenceOrphansOptions = {},
): Promise<CleanupPdtpEvidenceOrphansResult> {
  const olderThanMs = options.olderThanMs ?? DEFAULT_OLDER_THAN_MS
  const dryRun = options.dryRun ?? false
  const result: CleanupPdtpEvidenceOrphansResult = {
    scanned: 0, deleted: 0, kept: 0, failed: 0, deletedNames: [],
  }

  const referenced = new Set<string>()
  // Sin filtro por `status`: un plano ARCHIVADO sigue siendo evidencia y su
  // archivo no es huérfano. Recolectar por estado sería tomar la decisión de
  // retención que nadie declaró.
  const rows = await db.select({ imagePath: preventionRiskMapLayouts.imagePath })
    .from(preventionRiskMapLayouts)
  for (const row of rows) {
    const name = row.imagePath.split("/").pop()
    if (name) referenced.add(name)
  }

  await sweepOrphans({
    dir: resolveRiskMapDir(),
    referenced, olderThanMs, dryRun,
    label: "risk-map/evidence-gc",
  }, result)

  logger.info("[risk-map/evidence-gc] done", { ...result, dryRun })
  return result
}
