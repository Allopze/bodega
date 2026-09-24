/**
 * Procesa la cola de documentos generados: arma cada archivo, lo deja en disco
 * local y lo sube a Cloudreve.
 *
 * Lo llaman tres caminos, que pueden coincidir en el tiempo:
 * - el `after()` de la acción que produjo el hecho, con la sesión de quien lo
 *   produjo (la única que puede imprimir sus PDF en ese momento);
 * - el cron, sin sesión: sube lo que ya quedó en disco y arma los Excel;
 * - el reintento manual de Administración, con la sesión del administrador.
 *
 * Cada fila se toma con una concesión (`lease_until` + `FOR UPDATE SKIP
 * LOCKED`), así que dos caminos nunca procesan la misma a la vez. La concesión
 * vence sola: si el proceso muere a mitad de un render, la fila vuelve a la
 * cola.
 *
 * Una copia en Cloudreve nunca se pisa: antes de subir se mira si la ruta ya
 * existe, y si existe se agrega « (2)», « (3)»…
 */
import { createHash } from "node:crypto"
import { and, asc, eq, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { generatedDocumentArchives, type GeneratedDocumentArchive } from "@/db/schema"
import { logger } from "@/lib/logger"
import type { PrintCredential } from "@/lib/pdf/render-print-page"
import { resolveInternalRenderOrigin } from "@/lib/pdf/render-origin"
import {
  CloudreveError,
  ensureCloudreveCollections,
  putCloudreveKey,
  statCloudreveKey,
} from "@/lib/services/cloudreve/client"
import { readCloudreveConfig } from "@/lib/services/cloudreve/settings"
import { GENERATED_DOCUMENT_KIND_SPECS, hasExpectedSignature, isGeneratedDocumentKind } from "./kinds"
import { generatedDocumentRemoteKey, sanitizeRemoteFileName, withCollisionSuffix } from "./remote-key"
import { GeneratedDocumentError, produceGeneratedDocument } from "./renderers"
import { readGeneratedArchiveSettings, type GeneratedArchiveSettings } from "./settings"
import { readStagedDocument, removeStagedDocument, writeStagedDocument } from "./staging"

const LEASE_MS = 5 * 60_000
const DEFAULT_LIMIT = 20
const MAX_NAME_ATTEMPTS = 20
/** Pasado esto, un PDF impreso refleja el estado actual y no el del hecho. */
export const LATE_RENDER_MS = 10 * 60_000
/** Una fila de PDF que nadie pudo imprimir en este plazo necesita el reintento manual. */
export const SESSION_RENDER_WINDOW_MS = 30 * 60_000

/** Errores que no se arreglan esperando: solo el reintento manual los vuelve a intentar. */
const PERMANENT_CODES = new Set([
  "RENDER_UNAUTHORIZED", "RENDER_CREDENTIAL_MISSING", "PDF_ORIGIN_NOT_CONFIGURED",
  "SOURCE_NOT_FOUND", "INVALID_OUTPUT", "REMOTE_KEY_EXHAUSTED", "STAGING_MISSING",
])

export interface DrainOptions {
  /** Sesión para imprimir los PDF. Sin ella solo se suben copias locales y se arman Excel. */
  credential?: PrintCredential | null
  /** Con sesión: solo las filas de PDF de este usuario (el `after()` no imprime las de otros). */
  actorUserId?: string
  /** Reintento manual: estas filas y ninguna otra, en el estado que estén. */
  ids?: string[]
  retriedByUserId?: string
  limit?: number
  /** Para pruebas. */
  now?: () => Date
}

export interface DrainSummary {
  disabled: boolean
  processed: number
  uploaded: number
  failed: number
  superseded: number
}

type Row = GeneratedDocumentArchive

function nowIso(now: () => Date): string {
  return now().toISOString()
}

function backoffMs(attempts: number): number {
  return Math.min(2 ** Math.max(0, attempts - 1) * 5 * 60_000, 6 * 60 * 60_000)
}

function errorCode(error: unknown): string {
  if (error instanceof GeneratedDocumentError) return error.code
  if (error instanceof CloudreveError) return error.code
  if (error instanceof Error && error.message === "PDF_ORIGIN_NOT_CONFIGURED") return "PDF_ORIGIN_NOT_CONFIGURED"
  if (error instanceof DrainError) return error.code
  return "UNKNOWN"
}

class DrainError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = "DrainError"
  }
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth++) {
    if ((current as { code?: string }).code === "23505") return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/** Qué filas puede tomar esta corrida. */
function claimCondition(options: DrainOptions, now: string): SQL {
  const leaseFree = or(isNull(generatedDocumentArchives.leaseUntil), lt(generatedDocumentArchives.leaseUntil, now))!
  if (options.ids) {
    return and(
      inArray(generatedDocumentArchives.id, options.ids),
      inArray(generatedDocumentArchives.status, ["pending", "staged", "failed"]),
      leaseFree,
    )!
  }
  const due = or(
    inArray(generatedDocumentArchives.status, ["pending", "staged"]),
    and(
      eq(generatedDocumentArchives.status, "failed"),
      isNotNull(generatedDocumentArchives.nextAttemptAt),
      lte(generatedDocumentArchives.nextAttemptAt, now),
    ),
  )!
  const notWaiting = or(isNull(generatedDocumentArchives.nextAttemptAt), lte(generatedDocumentArchives.nextAttemptAt, now))!
  // Un PDF pendiente solo lo puede imprimir la sesión de quien produjo el
  // hecho; lo ya impreso (staged) lo sube cualquiera.
  const renderable = options.credential && options.actorUserId
    ? or(
      eq(generatedDocumentArchives.renderMode, "inprocess"),
      eq(generatedDocumentArchives.status, "staged"),
      eq(generatedDocumentArchives.actorUserId, options.actorUserId),
    )!
    : or(eq(generatedDocumentArchives.renderMode, "inprocess"), eq(generatedDocumentArchives.status, "staged"))!
  return and(due, notWaiting, renderable, leaseFree)!
}

async function claimRows(options: DrainOptions, now: () => Date): Promise<Row[]> {
  const at = nowIso(now)
  const leaseUntil = new Date(now().getTime() + LEASE_MS).toISOString()
  return db.transaction(async (tx) => {
    const candidates = await tx.select({ id: generatedDocumentArchives.id })
      .from(generatedDocumentArchives)
      .where(claimCondition(options, at))
      .orderBy(asc(generatedDocumentArchives.createdAt))
      .limit(options.limit ?? DEFAULT_LIMIT)
      .for("update", { skipLocked: true })
    if (candidates.length === 0) return []
    return tx.update(generatedDocumentArchives)
      .set({ leaseUntil, attempts: sql`${generatedDocumentArchives.attempts} + 1`, updatedAt: at })
      .where(inArray(generatedDocumentArchives.id, candidates.map((row) => row.id)))
      .returning()
  })
}

async function updateRow(id: string, values: Partial<Row>, now: () => Date): Promise<void> {
  await db.update(generatedDocumentArchives)
    .set({ ...values, updatedAt: nowIso(now) })
    .where(eq(generatedDocumentArchives.id, id))
}

// Un navegador por vez para el archivado: el pool de Chromium es de dos
// contextos y lo comparten las descargas de los usuarios.
let renderQueue: Promise<unknown> = Promise.resolve()
function exclusiveRender<T>(task: () => Promise<T>): Promise<T> {
  const run = renderQueue.then(task, task)
  renderQueue = run.catch(() => undefined)
  return run
}

async function produceWithRetry(row: Row, options: DrainOptions): Promise<Awaited<ReturnType<typeof produceGeneratedDocument>>> {
  let origin: string | null = null
  try {
    origin = resolveInternalRenderOrigin()
  } catch {
    origin = null
  }
  const ctx = { credential: options.credential ?? null, origin }
  const produce = () => row.renderMode === "session"
    ? exclusiveRender(() => produceGeneratedDocument(row, ctx))
    : produceGeneratedDocument(row, ctx)
  try {
    return await produce()
  } catch (error) {
    if (error instanceof GeneratedDocumentError && error.transient) {
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      return produce()
    }
    throw error
  }
}

/** Arma (o recupera de disco) el archivo de la fila y lo deja listo para subir. */
async function stageRow(row: Row, options: DrainOptions, now: () => Date): Promise<{ buffer: Buffer; row: Row } | "superseded"> {
  if (!isGeneratedDocumentKind(row.kind)) throw new DrainError("SOURCE_NOT_FOUND", "Tipo de documento desconocido")
  const spec = GENERATED_DOCUMENT_KIND_SPECS[row.kind]

  if (row.status === "staged" && row.fileName) {
    const staged = await readStagedDocument(row.id, spec.extension)
    if (staged) return { buffer: staged, row }
    // La copia local se perdió (otro volumen, un borrado a mano): se vuelve a
    // armar si se puede; si es un PDF sin sesión, queda para el reintento.
    if (row.renderMode === "session" && !options.credential) {
      throw new DrainError("STAGING_MISSING", "Se perdió la copia local")
    }
  }

  const produced = await produceWithRetry(row, options)
  if (produced.outcome === "superseded") return "superseded"
  if (!hasExpectedSignature(produced.buffer, spec.extension)) {
    throw new DrainError("INVALID_OUTPUT", "El archivo generado no tiene la firma esperada")
  }
  const fileName = sanitizeRemoteFileName(produced.baseName, spec.extension)
  const elapsed = now().getTime() - new Date(row.occurredAt).getTime()
  // El cierre sale de una foto congelada: nunca refleja un estado posterior.
  const lateRender = row.kind !== "pdtp_cierre" && elapsed > LATE_RENDER_MS
  await writeStagedDocument(row.id, spec.extension, produced.buffer)
  const staged: Partial<Row> = {
    status: "staged",
    fileName,
    sha256: createHash("sha256").update(produced.buffer).digest("hex"),
    sizeBytes: produced.buffer.length,
    stagedAt: nowIso(now),
    lateRender,
    lastErrorCode: null,
  }
  await updateRow(row.id, staged, now)
  return { buffer: produced.buffer, row: { ...row, ...staged } as Row }
}

async function remoteKeyTakenByAnotherRow(rowId: string, key: string): Promise<boolean> {
  const [other] = await db.select({ id: generatedDocumentArchives.id })
    .from(generatedDocumentArchives)
    .where(and(sql`lower(${generatedDocumentArchives.remoteKey}) = lower(${key})`, sql`${generatedDocumentArchives.id} <> ${rowId}`))
    .limit(1)
  return Boolean(other)
}

/**
 * Sube el archivo sin pisar nada. La clave elegida se guarda ANTES del PUT: si
 * el PUT queda en duda (la respuesta se perdió pero el archivo llegó), el
 * reintento encuentra su propia clave con el mismo tamaño y la reconoce.
 */
async function uploadRow(row: Row, buffer: Buffer, settings: GeneratedArchiveSettings, now: () => Date): Promise<void> {
  if (!isGeneratedDocumentKind(row.kind) || !row.fileName) throw new DrainError("SOURCE_NOT_FOUND", "Fila incompleta")
  const config = await readCloudreveConfig()
  if (!config.hasCredentials) throw new CloudreveError("CLOUDREVE_NOT_CONFIGURED", "Cloudreve no está configurado.")

  const baseKey = generatedDocumentRemoteKey({
    basePath: settings.basePath,
    layout: settings.layout,
    year: row.documentYear,
    worksiteLabel: row.worksiteLabel,
    moduleLabel: GENERATED_DOCUMENT_KIND_SPECS[row.kind].moduleLabel,
    fileName: row.fileName,
  })

  let key: string | null = null
  if (row.remoteKey) {
    // Un intento anterior ya eligió clave: si el archivo está y mide lo mismo,
    // es el nuestro. Si está con otro tamaño, alguien más lo escribió ahí.
    const existing = await statCloudreveKey(row.remoteKey)
    if (existing && existing.size === buffer.length) {
      await markUploaded(row, now)
      return
    }
    if (!existing) key = row.remoteKey
  }

  if (!key) {
    // La clave se deriva de la guardada si existe, para no cambiar de carpeta a
    // mitad de camino si se cambió el orden de carpetas entre intentos.
    const seed = row.remoteKey ? stripCollisionSuffix(row.remoteKey) : baseKey
    for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS && !key; attempt += 1) {
      const candidate = withCollisionSuffix(seed, attempt)
      if (candidate === row.remoteKey) continue
      if (await remoteKeyTakenByAnotherRow(row.id, candidate)) continue
      if (await statCloudreveKey(candidate)) continue
      try {
        await updateRow(row.id, { remoteKey: candidate }, now)
        key = candidate
      } catch (error) {
        if (!isUniqueViolation(error)) throw error
      }
    }
  }
  if (!key) throw new DrainError("REMOTE_KEY_EXHAUSTED", "No hay un nombre libre para el documento")

  await ensureCloudreveCollections(key.slice(0, key.lastIndexOf("/")))
  await putCloudreveKey(key, buffer)
  const written = await statCloudreveKey(key)
  if (!written || written.size !== buffer.length) {
    throw new DrainError("UPLOAD_SIZE_MISMATCH", "El archivo subido no coincide en tamaño")
  }
  await markUploaded({ ...row, remoteKey: key }, now)
}

function stripCollisionSuffix(key: string): string {
  return key.replace(/ \((\d+)\)(\.[a-z0-9]+)?$/i, (_match, _n, ext: string | undefined) => ext ?? "")
}

async function markUploaded(row: Row, now: () => Date): Promise<void> {
  await updateRow(row.id, {
    status: "uploaded",
    uploadedAt: nowIso(now),
    leaseUntil: null,
    nextAttemptAt: null,
    lastErrorCode: null,
  }, now)
  if (isGeneratedDocumentKind(row.kind)) {
    await removeStagedDocument(row.id, GENERATED_DOCUMENT_KIND_SPECS[row.kind].extension)
  }
}

async function processRow(row: Row, settings: GeneratedArchiveSettings, options: DrainOptions, now: () => Date): Promise<"uploaded" | "failed" | "superseded"> {
  try {
    if (options.retriedByUserId) await updateRow(row.id, { retriedByUserId: options.retriedByUserId }, now)
    const staged = await stageRow(row, options, now)
    if (staged === "superseded") {
      await updateRow(row.id, { status: "superseded", leaseUntil: null, nextAttemptAt: null, lastErrorCode: null }, now)
      if (isGeneratedDocumentKind(row.kind)) await removeStagedDocument(row.id, GENERATED_DOCUMENT_KIND_SPECS[row.kind].extension)
      return "superseded"
    }
    await uploadRow(staged.row, staged.buffer, settings, now)
    return "uploaded"
  } catch (error) {
    const code = errorCode(error)
    const permanent = PERMANENT_CODES.has(code)
    // Lo que ya está en disco se sube en la próxima pasada del cron; lo que no,
    // se reintenta más tarde si es un Excel y queda para el reintento manual si
    // es un PDF, porque el cron no tiene sesión para imprimirlo.
    const [current] = await db.select({ status: generatedDocumentArchives.status, attempts: generatedDocumentArchives.attempts })
      .from(generatedDocumentArchives).where(eq(generatedDocumentArchives.id, row.id)).limit(1)
    // Sigue "por subir" solo si esperar puede arreglarlo. Un error permanente
    // (sin nombre libre, copia local perdida) la deja fallida: si no, el cron
    // la volvería a tomar en cada pasada para fallar igual.
    const isStaged = current?.status === "staged" && !permanent
    const retryLater = !permanent && (isStaged || row.renderMode === "inprocess")
    await updateRow(row.id, {
      status: isStaged ? "staged" : "failed",
      lastErrorCode: code,
      leaseUntil: null,
      nextAttemptAt: retryLater ? new Date(now().getTime() + backoffMs(current?.attempts ?? 1)).toISOString() : null,
    }, now)
    logger.warn("[generated-documents] no se pudo archivar el documento", { id: row.id, kind: row.kind, code })
    return "failed"
  }
}

export async function drainGeneratedDocuments(options: DrainOptions = {}): Promise<DrainSummary> {
  const now = options.now ?? (() => new Date())
  const summary: DrainSummary = { disabled: false, processed: 0, uploaded: 0, failed: 0, superseded: 0 }
  const settings = await readGeneratedArchiveSettings()
  if (!settings.enabled) return { ...summary, disabled: true }

  const rows = await claimRows(options, now)
  for (const row of rows) {
    const outcome = await processRow(row, settings, options, now)
    summary.processed += 1
    summary[outcome] += 1
  }
  return summary
}

/**
 * Filas de PDF que nadie imprimió a tiempo: el `after()` no llegó a correr
 * (reinicio del contenedor) o falló. Quedan fallidas con un código que la
 * pantalla explica, para el reintento manual.
 */
export async function expireUnrenderedSessionRows(now: () => Date = () => new Date()): Promise<number> {
  const cutoff = new Date(now().getTime() - SESSION_RENDER_WINDOW_MS).toISOString()
  const expired = await db.update(generatedDocumentArchives)
    .set({ status: "failed", lastErrorCode: "RENDER_CREDENTIAL_MISSING", nextAttemptAt: null, updatedAt: nowIso(now) })
    .where(and(
      eq(generatedDocumentArchives.status, "pending"),
      eq(generatedDocumentArchives.renderMode, "session"),
      lt(generatedDocumentArchives.createdAt, cutoff),
      or(isNull(generatedDocumentArchives.leaseUntil), lt(generatedDocumentArchives.leaseUntil, nowIso(now))),
    ))
    .returning({ id: generatedDocumentArchives.id })
  return expired.length
}

