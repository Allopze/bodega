import { createHash } from "node:crypto"
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { and, eq, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import {
  preventionIncidentRe20Attachments,
  preventionIncidentRe20Workspaces,
  preventionIncidents,
  preventionSensitiveFiles,
} from "@/db/schema"
import { recordModuleHistory } from "@/lib/audit"
import { validateFileBuffer } from "@/lib/file-validation"
import { nanoid } from "@/lib/id"
import { RE20_ATTACHMENT_LIMITS } from "@/lib/prevention/re20-attachment-limits"
import {
  decryptPreventionBuffer,
  decryptPreventionPayload,
  encryptPreventionBuffer,
  encryptPreventionPayload,
} from "@/lib/security/prevention-field-encryption"
import {
  auditIncidentSensitiveAccess as auditAccess,
  hasPermission,
  requireAccess,
  scopeCondition,
  type IncidentAccess,
} from "@/lib/services/prevention-incident-access"
import {
  createPreventionSensitiveFilePath,
  resolvePreventionSensitiveFile,
  resolvePreventionSensitiveFilesDir,
} from "@/lib/storage/config"

/* Anexos RE-20. El binario va cifrado en disco (infraestructura de archivos
 * sensibles); la tabla de anexos es el índice por (incidente, id de cliente) y
 * guarda nombre/MIME cifrados. Las filas anteriores (binario en base64 en
 * Postgres) siguen siendo legibles hasta correr scripts/migrate-re20-attachments-to-files.ts. */

const metadataSchema = z.object({
  incidentId: z.string().min(1),
  clientAttachmentId: z.string().trim().min(8).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  purpose: z.string().trim().min(3).max(300),
  fileName: z.string().trim().min(1).max(240),
  mimeType: z.enum(RE20_ATTACHMENT_LIMITS.allowedMimeTypes),
  expectedWorkspaceVersion: z.number().int().min(0),
})

const MB = 1024 * 1024
const WEBP_MIME = "image/webp"
const TEXT_MIME = "text/plain"
const BINARY_MIMES = new Set(["application/pdf", "image/jpeg", "image/png"])

function sha256(buffer: Uint8Array) {
  return createHash("sha256").update(buffer).digest("hex")
}

/** WebP: contenedor RIFF con la marca WEBP en el byte 8. */
function isWebp(buf: Uint8Array) {
  return buf.length >= 12
    && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
    && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
}

/** Texto plano: UTF-8 válido, sin NUL ni controles distintos de \t \n \r. */
function isPlainText(buf: Uint8Array) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buf)
    return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
  } catch {
    return false
  }
}

/**
 * Tipo real por contenido. PDF/JPEG/PNG pasan por `validateFileBuffer` (magic
 * bytes); WebP y texto no tienen firma allí, así que se reconocen aquí.
 */
export function detectRe20AttachmentMime(bytes: Uint8Array, fileName?: string): { mimeType: string; error?: string } {
  const checked = validateFileBuffer(bytes, bytes.byteLength, BINARY_MIMES, fileName)
  if (!checked.error) return { mimeType: checked.mimeType }
  if (bytes.byteLength < 4) return { mimeType: "", error: checked.error }
  if (isWebp(bytes)) return { mimeType: WEBP_MIME }
  if (isPlainText(bytes)) return { mimeType: TEXT_MIME }
  return { mimeType: "", error: checked.error }
}

/** Guarda un anexo RE-20 cifrado en disco con clave idempotente del dispositivo. */
export async function storePreventionIncidentRe20Attachment(args: {
  input: unknown
  bytes: Uint8Array
  access: IncidentAccess
}) {
  requireAccess(args.access, "prevention:incidents:investigate")
  const input = metadataSchema.parse(args.input)
  const { maxFileBytes, maxTotalBytes, maxCount } = RE20_ATTACHMENT_LIMITS
  if (args.bytes.byteLength < 1 || args.bytes.byteLength > maxFileBytes) {
    throw new Error(`El anexo RE-20 debe pesar entre 1 byte y ${maxFileBytes / MB} MB.`)
  }
  const detected = detectRe20AttachmentMime(args.bytes, input.fileName)
  if (detected.error) throw new Error(detected.error)
  if (detected.mimeType !== input.mimeType) {
    throw new Error("El contenido del archivo no coincide con el tipo declarado.")
  }
  const checksumSha256 = sha256(args.bytes)
  const fileName = input.fileName.replace(/[\u0000-\u001f\u007f]/g, "").split(/[\\/]/).pop()?.slice(0, 180) || "evidencia"
  const fileId = `psf-${nanoid()}`
  let absolutePath: string | null = null
  let temporaryPath: string | null = null
  try {
    return await db.transaction(async (tx) => {
      const [incident] = await tx.select().from(preventionIncidents)
        .where(eq(preventionIncidents.id, input.incidentId)).for("update").limit(1)
      if (!incident) throw new Error("Incidente no encontrado.")
      requireAccess(args.access, "prevention:incidents:investigate", incident.worksiteId)
      if (incident.status === "closed") throw new Error("El incidente está cerrado y su expediente de investigación es inmutable.")
      if (!hasPermission(args.access.permissions, "prevention:incidents:view_sensitive")) {
        await auditAccess({ access: args.access, incidentId: incident.id, worksiteId: incident.worksiteId, purpose: input.purpose, outcome: "denied", reasonCode: "permission", action: "create", client: tx })
        throw new Error("No tienes autorización de acceso sensible para adjuntar evidencia RE-20.")
      }
      const [workspace] = await tx.select().from(preventionIncidentRe20Workspaces)
        .where(eq(preventionIncidentRe20Workspaces.incidentId, incident.id)).limit(1)
      if ((workspace?.version ?? 0) !== input.expectedWorkspaceVersion) throw new Error("El expediente cambió antes de adjuntar el archivo. Recarga y conserva el borrador local.")
      const [existing] = await tx.select().from(preventionIncidentRe20Attachments)
        .where(and(
          eq(preventionIncidentRe20Attachments.incidentId, incident.id),
          eq(preventionIncidentRe20Attachments.clientAttachmentId, input.clientAttachmentId),
        )).limit(1)
      if (existing) {
        if (existing.checksumSha256 !== checksumSha256) throw new Error("El identificador del anexo ya se usó para otro archivo.")
        await auditAccess({ access: args.access, incidentId: incident.id, worksiteId: incident.worksiteId, purpose: input.purpose, outcome: "granted", action: "create", client: tx })
        return { attachmentId: existing.id, clientAttachmentId: existing.clientAttachmentId, checksumSha256, idempotentReplay: true }
      }
      const [usage] = await tx.select({
        count: sql<number>`count(*)`,
        totalBytes: sql<number>`coalesce(sum(${preventionIncidentRe20Attachments.fileSize}), 0)`,
      }).from(preventionIncidentRe20Attachments)
        .where(eq(preventionIncidentRe20Attachments.incidentId, incident.id))
      if (Number(usage?.count ?? 0) >= maxCount || Number(usage?.totalBytes ?? 0) + args.bytes.byteLength > maxTotalBytes) {
        throw new Error(`El expediente admite hasta ${maxCount} anexos y ${maxTotalBytes / MB} MB de evidencia cifrada.`)
      }

      const now = new Date().toISOString()
      const encrypted = encryptPreventionBuffer(args.bytes, `sensitive-file:${fileId}`)
      const encryptedChecksum = sha256(encrypted.encryptedBuffer)
      const relativePath = createPreventionSensitiveFilePath(`${fileId}.bin`)
      absolutePath = resolvePreventionSensitiveFile(relativePath)
      if (!absolutePath) throw new Error("La ruta sensible no es válida.")
      temporaryPath = `${absolutePath}.tmp-${nanoid(6)}`
      await mkdir(resolvePreventionSensitiveFilesDir(), { recursive: true })
      await writeFile(temporaryPath, encrypted.encryptedBuffer, { flag: "wx", mode: 0o600 })
      await rename(temporaryPath, absolutePath)
      temporaryPath = null

      await tx.insert(preventionSensitiveFiles).values({
        id: fileId,
        domain: "incident_re20",
        entityId: incident.id,
        subjectWorkerId: null,
        worksiteId: incident.worksiteId,
        // El nombre real vive cifrado en el índice de anexos; aquí no se expone.
        fileName: "anexo-re20.bin",
        mimeType: detected.mimeType,
        fileSize: args.bytes.byteLength,
        encryptedFilePath: relativePath,
        sourceChecksum: checksumSha256,
        encryptedChecksum,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        keyVersion: encrypted.keyVersion,
        createdByUserId: args.access.ctx.userId,
        createdAt: now,
      })
      const aad = `incident-re20-attachment:${incident.id}:${input.clientAttachmentId}`
      const encryptedMetadata = encryptPreventionPayload({ fileName, mimeType: detected.mimeType, size: args.bytes.byteLength }, `${aad}:metadata`)
      const [attachment] = await tx.insert(preventionIncidentRe20Attachments).values({
        id: `re20att-${nanoid()}`,
        incidentId: incident.id,
        clientAttachmentId: input.clientAttachmentId,
        sensitiveFileId: fileId,
        encryptedMetadata: encryptedMetadata.encryptedPayload,
        metadataIv: encryptedMetadata.iv,
        metadataAuthTag: encryptedMetadata.authTag,
        metadataKeyVersion: encryptedMetadata.keyVersion,
        checksumSha256,
        fileSize: args.bytes.byteLength,
        createdByUserId: args.access.ctx.userId,
        createdAt: now,
      }).returning()
      if (!attachment) throw new Error("No se pudo guardar el anexo RE-20.")
      await auditAccess({ access: args.access, incidentId: incident.id, worksiteId: incident.worksiteId, purpose: input.purpose, outcome: "granted", action: "create", client: tx })
      await recordModuleHistory(tx, {
        module: "prevention_incident",
        entityType: "re20_attachment",
        entityId: attachment.id,
        worksiteId: incident.worksiteId,
        changeType: "created",
        reason: "Anexo RE-20 cifrado agregado",
        afterState: { incidentId: incident.id, clientAttachmentId: input.clientAttachmentId, checksumSha256, fileSize: args.bytes.byteLength, sensitiveFileId: fileId },
        actorUserId: args.access.ctx.userId,
      })
      return { attachmentId: attachment.id, clientAttachmentId: attachment.clientAttachmentId, checksumSha256, idempotentReplay: false }
    })
  } catch (error) {
    // Si la transacción no se confirmó, no debe quedar ciphertext huérfano en disco.
    await Promise.allSettled([
      ...(temporaryPath ? [unlink(temporaryPath)] : []),
      ...(absolutePath ? [unlink(absolutePath)] : []),
    ])
    throw error
  }
}

export async function getPreventionIncidentRe20Attachment(args: {
  incidentId: string
  attachmentId: string
  purpose: string
  access: IncidentAccess
}) {
  requireAccess(args.access, "prevention:incidents:view")
  const purpose = args.purpose.trim()
  const [incident] = await db.select({ worksiteId: preventionIncidents.worksiteId }).from(preventionIncidents)
    .where(and(eq(preventionIncidents.id, args.incidentId), scopeCondition(args.access.scope))).limit(1)
  if (!incident) throw new Error("Incidente no encontrado o fuera de alcance.")
  if (purpose.length < 3 || purpose.length > 300 || !hasPermission(args.access.permissions, "prevention:incidents:view_sensitive")) {
    await auditAccess({ access: args.access, incidentId: args.incidentId, worksiteId: incident.worksiteId, purpose: purpose || "sin propósito", outcome: "denied", reasonCode: "permission_or_purpose" })
    throw new Error("No tienes autorización para abrir el anexo sensible RE-20.")
  }
  const [row] = await db.select().from(preventionIncidentRe20Attachments)
    .where(and(eq(preventionIncidentRe20Attachments.incidentId, args.incidentId), eq(preventionIncidentRe20Attachments.clientAttachmentId, args.attachmentId))).limit(1)
  if (!row) throw new Error("Anexo RE-20 no encontrado.")
  const aad = `incident-re20-attachment:${args.incidentId}:${row.clientAttachmentId}`
  const metadata = decryptPreventionPayload<{ fileName: string; mimeType: string; size: number }>({
    encryptedPayload: row.encryptedMetadata, iv: row.metadataIv, authTag: row.metadataAuthTag, keyVersion: row.metadataKeyVersion,
  }, `${aad}:metadata`)

  let buffer: Buffer
  if (row.sensitiveFileId) {
    const [file] = await db.select().from(preventionSensitiveFiles)
      .where(and(eq(preventionSensitiveFiles.id, row.sensitiveFileId), eq(preventionSensitiveFiles.entityId, args.incidentId))).limit(1)
    if (!file) throw new Error("Archivo sensible no disponible.")
    const absolutePath = resolvePreventionSensitiveFile(file.encryptedFilePath)
    if (!absolutePath) throw new Error("Archivo sensible no disponible.")
    const encryptedBuffer = await readFile(absolutePath)
    if (sha256(encryptedBuffer) !== file.encryptedChecksum) throw new Error("El archivo cifrado no supera la verificación de integridad.")
    buffer = decryptPreventionBuffer({ encryptedBuffer, iv: file.iv, authTag: file.authTag, keyVersion: file.keyVersion }, `sensitive-file:${file.id}`)
    if (sha256(buffer) !== file.sourceChecksum) throw new Error("El archivo restaurado no coincide con el checksum de origen.")
  } else if (row.encryptedFile && row.fileIv && row.fileAuthTag && row.fileKeyVersion) {
    // LEGADO: binario en Postgres, aún no movido a disco.
    buffer = decryptPreventionBuffer({
      encryptedBuffer: Buffer.from(row.encryptedFile, "base64"), iv: row.fileIv, authTag: row.fileAuthTag, keyVersion: row.fileKeyVersion,
    }, `${aad}:file`)
  } else {
    throw new Error("Archivo sensible no disponible.")
  }
  await auditAccess({ access: args.access, incidentId: args.incidentId, worksiteId: incident.worksiteId, purpose, outcome: "granted" })
  return { buffer, metadata, checksumSha256: row.checksumSha256, createdAt: row.createdAt, createdByUserId: row.createdByUserId }
}
