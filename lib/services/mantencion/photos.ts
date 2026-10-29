import { createHash } from "node:crypto"
import { eq } from "drizzle-orm"
import sharp from "sharp"
import { db } from "@/db"
import { mantRecordPhotos, mantRecords } from "@/db/schema"
import { MimeType, validateFileBuffer } from "@/lib/file-validation"
import { MANT_PHOTO_MAX_BYTES, photoMetaSchema } from "@/lib/mantencion/contracts"
import { createMantencionFilePath, resolveMantencionDir, resolveMantencionFile } from "@/lib/storage/config"
import { mkdirp, readBuffer, removeFile, writeBuffer } from "@/lib/storage/helpers"
import { canSeeRecord, recordVisibility, type MantViewer } from "./access"
import type { SyncContext } from "./sync-auth"

/**
 * Fotos de respaldo del registro (§8-9, §15).
 *
 * El teléfono las sube ANTES que el registro, una a una y con su id (`PUT`
 * idempotente). Quedan huérfanas (`record_id` nulo) hasta que llega el registro
 * que las nombra. Aquí no se confía en nada del cliente: tipo por *magic bytes*,
 * huella recalculada, dimensiones leídas del propio archivo.
 */

export const PHOTO_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type PhotoOutcome =
  | { status: 200; body: { ok: true; id: string; duplicate: boolean } }
  | { status: 409 | 422; body: { ok: false; code: "rejected" | "invalid"; message: string } }

const invalid = (message: string): PhotoOutcome => ({ status: 422, body: { ok: false, code: "invalid", message } })

const EXTENSION_BY_MIME: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png" }

export interface PhotoUpload {
  photoId: string
  file: File | null
  /** JSON del campo `meta` del multipart. */
  metaRaw: string | null
}

type StoredPhoto = { id: string; uploadedBy: string; sha256: string; storageKey: string }

async function findPhoto(id: string): Promise<StoredPhoto | null> {
  const [row] = await db
    .select({ id: mantRecordPhotos.id, uploadedBy: mantRecordPhotos.uploadedBy, sha256: mantRecordPhotos.sha256, storageKey: mantRecordPhotos.storageKey })
    .from(mantRecordPhotos)
    .where(eq(mantRecordPhotos.id, id))
    .limit(1)
  return row ?? null
}

/** Mismo id: del mismo autor y misma huella es el reintento de siempre (200); cualquier otro caso es un choque (409). */
function existingOutcome(existing: StoredPhoto, userId: string, sha256: string): PhotoOutcome {
  if (existing.uploadedBy === userId && existing.sha256 === sha256) {
    return { status: 200, body: { ok: true, id: existing.id, duplicate: true } }
  }
  return { status: 409, body: { ok: false, code: "rejected", message: "Ese identificador de foto ya existe con otro contenido." } }
}

export async function savePhoto(upload: PhotoUpload, context: SyncContext): Promise<PhotoOutcome> {
  if (!PHOTO_ID_PATTERN.test(upload.photoId)) return invalid("El identificador de la foto no es válido.")
  if (!upload.file) return invalid("Falta el archivo de la foto (file).")
  if (!upload.metaRaw) return invalid("Faltan los datos de la foto (meta).")

  let metaJson: unknown
  try { metaJson = JSON.parse(upload.metaRaw) } catch { return invalid("Los datos de la foto (meta) no son JSON válido.") }
  const parsed = photoMetaSchema.safeParse(metaJson)
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Los datos de la foto no son válidos.")
  const meta = parsed.data

  if (upload.file.size > MANT_PHOTO_MAX_BYTES) return invalid("La foto pesa más de 10 MB.")
  const bytes = new Uint8Array(await upload.file.arrayBuffer())
  const checked = validateFileBuffer(bytes, upload.file.size, MimeType.IMAGE, upload.file.name)
  if (checked.error) return invalid(checked.error)

  const sha256 = createHash("sha256").update(bytes).digest("hex")
  if (sha256 !== meta.sha256.toLowerCase()) {
    return invalid("La foto llegó alterada o incompleta (la huella no coincide). Se vuelve a enviar sola.")
  }

  // Las dimensiones se leen del archivo: lo que declare el teléfono no se guarda sin verificar.
  let width: number | undefined
  let height: number | undefined
  try {
    const info = await sharp(bytes, { failOn: "error" }).metadata()
    width = info.width
    height = info.height
  } catch {
    return invalid("No se pudo leer la imagen: el archivo está dañado.")
  }
  if (!width || !height) return invalid("No se pudo leer el tamaño de la imagen.")
  if (width !== meta.width || height !== meta.height) {
    return invalid(`Las dimensiones declaradas (${meta.width}×${meta.height}) no coinciden con las de la imagen (${width}×${height}).`)
  }

  const userId = context.viewer.userId
  const existing = await findPhoto(upload.photoId)
  if (existing) return existingOutcome(existing, userId, sha256)

  // El nombre lleva parte de la huella: dos envíos del mismo id con distinto contenido nunca pisan el mismo archivo.
  const storageName = `${upload.photoId.toLowerCase()}-${sha256.slice(0, 12)}.${EXTENSION_BY_MIME[checked.mimeType] ?? "jpg"}`
  const storageKey = createMantencionFilePath(storageName)
  const absolutePath = resolveMantencionFile(storageKey)
  if (!absolutePath) throw new Error("Ruta de foto inválida")
  await mkdirp(resolveMantencionDir())
  await writeBuffer(absolutePath, Buffer.from(bytes))

  try {
    const [created] = await db.insert(mantRecordPhotos).values({
      id: upload.photoId,
      recordId: null,
      kind: meta.kind,
      storageKey,
      mimeType: checked.mimeType,
      sha256,
      bytes: bytes.length,
      width,
      height,
      exif: meta.exif,
      takenAtExif: meta.takenAtExif,
      stampedAt: meta.stampedAt,
      uploadedBy: userId,
      // El dispositivo que la credencial acredita, no el que declara el cuerpo.
      deviceId: context.deviceId,
    }).onConflictDoNothing().returning({ id: mantRecordPhotos.id })
    if (created) return { status: 200, body: { ok: true, id: created.id, duplicate: false } }
  } catch (error) {
    await removeFile(absolutePath).catch(() => undefined)
    throw error
  }

  // Perdió la carrera por el id: otro PUT idéntico confirmó primero.
  const winner = await findPhoto(upload.photoId)
  if (!winner) throw new Error("La foto desapareció durante la carga")
  if (winner.storageKey !== storageKey) await removeFile(absolutePath).catch(() => undefined)
  return existingOutcome(winner, userId, sha256)
}

export interface PhotoFile {
  buffer: Buffer
  mimeType: string
  fileName: string
}

/**
 * Foto para `GET /api/mantencion/fotos/[id]` (con sesión). Sólo se entrega si el
 * lector puede ver el registro al que pertenece; una foto huérfana sólo es de
 * quien la subió. `null` para «no existe» y para «no puedes verla» por igual:
 * no se revela si el id existe.
 */
export async function loadPhotoFile(photoId: string, viewer: MantViewer): Promise<PhotoFile | null> {
  if (!PHOTO_ID_PATTERN.test(photoId)) return null
  const [row] = await db
    .select({
      id: mantRecordPhotos.id,
      kind: mantRecordPhotos.kind,
      storageKey: mantRecordPhotos.storageKey,
      mimeType: mantRecordPhotos.mimeType,
      uploadedBy: mantRecordPhotos.uploadedBy,
      recordId: mantRecordPhotos.recordId,
      folio: mantRecords.folio,
      worksiteId: mantRecords.worksiteId,
      registeredBy: mantRecords.registeredBy,
      executorUserId: mantRecords.executorUserId,
    })
    .from(mantRecordPhotos)
    .leftJoin(mantRecords, eq(mantRecords.id, mantRecordPhotos.recordId))
    .where(eq(mantRecordPhotos.id, photoId))
    .limit(1)
  if (!row) return null

  const allowed = row.recordId === null || row.worksiteId === null || row.registeredBy === null
    ? row.uploadedBy === viewer.userId
    : canSeeRecord(recordVisibility(viewer), { worksiteId: row.worksiteId, registeredBy: row.registeredBy, executorUserId: row.executorUserId })
  if (!allowed) return null

  const absolutePath = resolveMantencionFile(row.storageKey)
  if (!absolutePath) return null
  try {
    const buffer = await readBuffer(absolutePath)
    const extension = EXTENSION_BY_MIME[row.mimeType] ?? "jpg"
    return { buffer, mimeType: row.mimeType, fileName: `${row.folio ?? row.id}-${row.kind}.${extension}` }
  } catch {
    return null
  }
}
