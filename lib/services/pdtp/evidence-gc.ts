/**
 * lib/services/pdtp/evidence-gc.ts
 *
 * Recolector de archivos huérfanos en `storage/pdtp-evidence/`. Un archivo
 * se considera huérfano cuando su `name` (el nombre generado por
 * `nanoid`) no aparece en ninguna referencia de `collectPdtpEvidenceReferences`
 * (ejecuciones, evidencia CAPA, historial de envíos e instancias programadas).
 *
 * El directorio tiene DOS productores, no uno: `pdtp-execution-form.tsx` (que
 * vincula el archivo a `pdtp_executions`) y `execution-action-plan-panel.tsx`
 * (que lo vincula a `prevention_capa_evidence` vía `addPdtpFollowupAction`).
 * Ambos suben por el mismo endpoint. Consultar sólo la primera tabla borraba la
 * evidencia de cierre de acciones correctivas una hora después de subirla.
 * Cualquier consumidor nuevo del endpoint debe sumarse a
 * `collectPdtpEvidenceReferences` (evidence-references.ts), no aquí.
 *
 * Por seguridad, sólo se eliminan archivos más viejos que `olderThanMs`
 * (default y mínimo: 24 horas) para no borrar archivos recién subidos que aún no
 * fueron vinculados por `markPdtpExecution` (porque el cliente puede
 * tardar horas entre el upload y el submit del form). W5-GC (T7a): un valor
 * menor se eleva al mínimo; antes `olderThanMs=0` borraba un upload en curso.
 *
 * Cada corrida que encuentra huérfanos deja una fila en `audit_log`
 * (`storage_orphan_sweep`) con el directorio, el modo y los nombres: el cron
 * corre en modo de prueba (D13) y esa fila es lo que se revisa antes de
 * habilitar el borrado real con `PDTP_EVIDENCE_GC_DELETE=true`.
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
import { preventionInspectionAnswerEvidence, preventionRiskMapLayouts } from "@/db/schema"
import { resolveInspectionEvidenceDir, resolvePdtpEvidenceDir, resolveRiskMapDir } from "@/lib/storage/config"
import { logger } from "@/lib/logger"
import { recordAudit } from "@/lib/audit"
import { collectPdtpEvidenceReferences } from "./evidence-references"
import { MIN_ORPHAN_AGE_MS } from "./evidence-gc-policy"

export { MIN_ORPHAN_AGE_LABEL, MIN_ORPHAN_AGE_MS, ORPHAN_SAMPLE_SIZE, summarizeOrphanCleanup } from "./evidence-gc-policy"
const DEFAULT_OLDER_THAN_MS = MIN_ORPHAN_AGE_MS

/** Nombres que se guardan por fila de auditoría; el resto se cuenta. */
const AUDIT_NAME_LIMIT = 500

/** La ventana efectiva: nunca menor que `MIN_ORPHAN_AGE_MS`. */
export function resolveOrphanAgeMs(olderThanMs: number | undefined): number {
  if (olderThanMs === undefined || !Number.isFinite(olderThanMs)) return DEFAULT_OLDER_THAN_MS
  return Math.max(olderThanMs, MIN_ORPHAN_AGE_MS)
}

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
  /** Quien lo pidió, para la fila de auditoría. `null`/ausente = el cron. */
  actorUserId?: string | null
}

export async function cleanupPdtpEvidenceOrphans(
  options: CleanupPdtpEvidenceOrphansOptions = {},
): Promise<CleanupPdtpEvidenceOrphansResult> {
  const olderThanMs = resolveOrphanAgeMs(options.olderThanMs)
  const dryRun = options.dryRun ?? false
  const result: CleanupPdtpEvidenceOrphansResult = {
    scanned: 0,
    deleted: 0,
    kept: 0,
    failed: 0,
    deletedNames: [],
  }

  const dir = resolvePdtpEvidenceDir()

  // PREV-I13-C: las referencias salen de la fuente única
  // (`collectPdtpEvidenceReferences`: ejecuciones, CAPA, historial de envíos e
  // instancias). Antes esta lista se armaba aquí y no miraba las instancias ni
  // el historial, así que borraba evidencia que sólo ellos referenciaban. Se
  // conserva el nombre de CUALQUIER referencia, aunque no sea de este
  // directorio: un nombre de más sólo conserva, nunca borra de más.
  const referenced = new Set<string>()
  for (const reference of await collectPdtpEvidenceReferences()) {
    const name = reference.path.split("/").pop()
    if (name) referenced.add(name)
  }

  await sweepOrphans({ dir, referenced, olderThanMs, dryRun, label: "pdtp/evidence-gc", actorUserId: options.actorUserId ?? null }, result)

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
  actorUserId?: string | null
}, result: CleanupPdtpEvidenceOrphansResult): Promise<void> {
  const before = { deleted: result.deleted, failed: result.failed, names: result.deletedNames.length }
  await sweepDirectory(args, result)
  await auditSweep(args, {
    deleted: result.deleted - before.deleted,
    failed: result.failed - before.failed,
    names: result.deletedNames.slice(before.names),
  })
}

/**
 * W5-GC: constancia de la corrida. Sólo cuando hubo algo —un candidato o una
 * falla—: una fila diaria vacía sería ruido y ocultaría las que importan. En
 * modo de prueba `deleted` son los que se HABRÍAN borrado.
 */
async function auditSweep(
  args: { label: string; dryRun: boolean; olderThanMs: number; actorUserId?: string | null },
  outcome: { deleted: number; failed: number; names: string[] },
): Promise<void> {
  if (outcome.deleted === 0 && outcome.failed === 0) return
  const at = new Date().toISOString()
  try {
    await recordAudit({
      userId: args.actorUserId ?? null,
      action: "delete",
      entityType: "storage_orphan_sweep",
      entityId: `${args.label}@${at}`,
      entityCode: args.label,
      newState: {
        label: args.label,
        dryRun: args.dryRun,
        olderThanMs: args.olderThanMs,
        deleted: outcome.deleted,
        failed: outcome.failed,
        names: outcome.names.slice(0, AUDIT_NAME_LIMIT),
        truncated: outcome.names.length > AUDIT_NAME_LIMIT,
      },
      reason: args.dryRun
        ? "Barrido de archivos huérfanos en modo de prueba: no se borró nada; la lista es lo que se habría borrado."
        : "Barrido de archivos huérfanos: se borraron archivos sin referencia en la base.",
    })
  } catch (err) {
    // La auditoría no puede tumbar el barrido ya hecho (en modo real los
    // archivos ya se borraron): el log lleva los mismos datos.
    logger.error(`[${args.label}] no se pudo auditar el barrido`, { err, ...outcome, dryRun: args.dryRun })
  }
}

async function sweepDirectory(args: {
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
  const olderThanMs = resolveOrphanAgeMs(options.olderThanMs)
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
    referenced, olderThanMs, dryRun, actorUserId: options.actorUserId ?? null,
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
  const olderThanMs = resolveOrphanAgeMs(options.olderThanMs)
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
    referenced, olderThanMs, dryRun, actorUserId: options.actorUserId ?? null,
    label: "risk-map/evidence-gc",
  }, result)

  logger.info("[risk-map/evidence-gc] done", { ...result, dryRun })
  return result
}
