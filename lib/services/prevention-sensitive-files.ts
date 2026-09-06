import { createHash } from "node:crypto"
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionDocumentRelocations,
  preventionHealthRecords,
  preventionReservedCaseMembers,
  preventionReservedCases,
  preventionSensitiveAccessAudit,
  preventionSensitiveFiles,
  sstDocumentAudit,
  sstDocuments,
  sstDocumentVersions,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import {
  decryptPreventionBuffer,
  encryptPreventionBuffer,
} from "@/lib/security/prevention-field-encryption"
import {
  createPreventionSensitiveFilePath,
  resolvePreventionSensitiveFile,
  resolvePreventionSensitiveFilesDir,
} from "@/lib/storage/config"
import { readSstDocument } from "@/lib/storage/sst-backend"
import type { RequestContext } from "@/lib/services/prevention-documents/utils"
import { assertGeneralLibraryContentAllowed, assertScopeAccess } from "@/lib/services/prevention-documents/utils"

type SensitiveFileDomain = "health" | "reserved_case"

function checksum(buffer: Uint8Array) {
  return createHash("sha256").update(buffer).digest("hex")
}

function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

async function auditSensitiveFileAccess(args: {
  fileId: string
  domain: SensitiveFileDomain
  entityId: string
  subjectWorkerId: string | null
  worksiteId: string
  ctx: RequestContext
  action: "create" | "read_clinical" | "read_reserved"
  purpose: string
  outcome: "granted" | "denied"
  reasonCode?: string
  client?: Pick<typeof db, "insert">
}) {
  const client = args.client ?? db
  await client.insert(preventionSensitiveAccessAudit).values({
    id: `psa-${nanoid()}`,
    domain: args.domain,
    entityId: args.fileId,
    subjectWorkerId: args.subjectWorkerId,
    worksiteId: args.worksiteId,
    actorUserId: args.ctx.userId,
    action: args.action,
    purpose: args.purpose,
    outcome: args.outcome,
    reasonCode: args.reasonCode ?? null,
    ip: args.ctx.ip ?? null,
    userAgent: args.ctx.userAgent ?? null,
    createdAt: new Date().toISOString(),
  })
}

export async function relocateGeneralDocumentToSensitiveDomain(args: {
  documentId: string
  versionId: string
  targetDomain: SensitiveFileDomain
  targetEntityId: string
  reason: string
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
}) {
  const reason = args.reason.trim()
  if (reason.length < 10 || reason.length > 2000) throw new Error("La reubicación requiere un motivo detallado.")
  const [doc] = await db.select().from(sstDocuments).where(eq(sstDocuments.id, args.documentId)).limit(1)
  if (!doc) throw new Error("Documento no encontrado o fuera de alcance.")
  assertScopeAccess(doc.worksiteId, args.scope)
  const [version] = await db.select().from(sstDocumentVersions).where(and(
    eq(sstDocumentVersions.id, args.versionId),
    eq(sstDocumentVersions.documentId, doc.id),
  )).limit(1)
  if (!version) throw new Error("Versión documental no encontrada.")
  let prohibited = false
  try {
    assertGeneralLibraryContentAllowed({ dataClass: doc.dataClass, title: doc.title, fileName: version.fileName })
  } catch {
    prohibited = true
  }
  if (!prohibited && doc.confidentiality !== "sensible" && doc.dataClass !== "sensitive_preventive") {
    throw new Error("Sólo se reubican expedientes sensibles o prohibidos para la biblioteca general.")
  }

  let targetWorksiteId: string
  let subjectWorkerId: string | null
  if (args.targetDomain === "health") {
    if (!args.permissions.includes("prevention:health:upload_clinical")) throw new Error("Destino no encontrado o fuera de alcance.")
    const [target] = await db.select({
      id: preventionHealthRecords.id,
      worksiteId: preventionHealthRecords.worksiteId,
      workerId: preventionHealthRecords.workerId,
    }).from(preventionHealthRecords).where(eq(preventionHealthRecords.id, args.targetEntityId)).limit(1)
    if (!target || !scopeAllows(args.scope, target.worksiteId)) throw new Error("Destino no encontrado o fuera de alcance.")
    targetWorksiteId = target.worksiteId
    subjectWorkerId = target.workerId
  } else {
    if (!args.permissions.includes("prevention:reserved_case:investigate")) throw new Error("Destino no encontrado o fuera de alcance.")
    const [target] = await db.select({ id: preventionReservedCases.id, worksiteId: preventionReservedCases.worksiteId })
      .from(preventionReservedCases).where(eq(preventionReservedCases.id, args.targetEntityId)).limit(1)
    if (!target || !scopeAllows(args.scope, target.worksiteId)) throw new Error("Destino no encontrado o fuera de alcance.")
    const [membership] = await db.select({ userId: preventionReservedCaseMembers.userId })
      .from(preventionReservedCaseMembers).where(and(
        eq(preventionReservedCaseMembers.caseId, target.id),
        eq(preventionReservedCaseMembers.userId, args.ctx.userId),
      )).limit(1)
    if (!membership) throw new Error("Destino no encontrado o fuera de alcance.")
    targetWorksiteId = target.worksiteId
    subjectWorkerId = null
  }
  if (doc.worksiteId && doc.worksiteId !== targetWorksiteId) throw new Error("El destino sensible pertenece a otra faena.")

  const [existing] = await db.select({ id: preventionDocumentRelocations.id })
    .from(preventionDocumentRelocations).where(and(
      eq(preventionDocumentRelocations.sourceVersionId, version.id),
      eq(preventionDocumentRelocations.status, "source_restricted"),
    )).limit(1)
  if (existing) throw new Error("La versión ya fue reubicada y restringida.")

  const sourceBuffer = await readSstDocument(version.filePath)
  const sourceChecksum = checksum(sourceBuffer)
  if (sourceChecksum !== version.checksum) throw new Error("El archivo de origen no coincide con el checksum documental.")

  const fileId = `psf-${nanoid()}`
  const relocationId = `pdr-${nanoid()}`
  const now = new Date().toISOString()
  await db.insert(preventionDocumentRelocations).values({
    id: relocationId,
    sourceDocumentId: doc.id,
    sourceVersionId: version.id,
    targetDomain: args.targetDomain,
    targetEntityId: args.targetEntityId,
    status: "copying",
    reason,
    sourceChecksum,
    initiatedByUserId: args.ctx.userId,
    initiatedAt: now,
  })

  let absolutePath: string | null = null
  let temporaryPath: string | null = null
  let encryptedChecksum = ""
  try {
    const aad = `sensitive-file:${fileId}`
    const encrypted = encryptPreventionBuffer(sourceBuffer, aad)
    encryptedChecksum = checksum(encrypted.encryptedBuffer)
    const verifiedPlaintext = decryptPreventionBuffer(encrypted, aad)
    if (checksum(verifiedPlaintext) !== sourceChecksum) throw new Error("La copia cifrada no superó la verificación de restauración.")

    const storageName = `${fileId}.bin`
    const relativePath = createPreventionSensitiveFilePath(storageName)
    absolutePath = resolvePreventionSensitiveFile(relativePath)
    if (!absolutePath) throw new Error("La ruta sensible no es válida.")
    temporaryPath = `${absolutePath}.tmp-${nanoid(6)}`
    await mkdir(resolvePreventionSensitiveFilesDir(), { recursive: true })
    await writeFile(temporaryPath, encrypted.encryptedBuffer, { flag: "wx", mode: 0o600 })
    await rename(temporaryPath, absolutePath)

    await db.transaction(async (tx) => {
      await tx.insert(preventionSensitiveFiles).values({
        id: fileId,
        domain: args.targetDomain,
        entityId: args.targetEntityId,
        subjectWorkerId,
        worksiteId: targetWorksiteId,
        fileName: path.basename(version.fileName),
        mimeType: version.mimeType,
        fileSize: sourceBuffer.byteLength,
        encryptedFilePath: relativePath,
        sourceChecksum,
        encryptedChecksum,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        keyVersion: encrypted.keyVersion,
        sourceDocumentId: doc.id,
        sourceVersionId: version.id,
        createdByUserId: args.ctx.userId,
        createdAt: now,
      })
      await tx.update(preventionDocumentRelocations).set({
        sensitiveFileId: fileId,
        status: "source_restricted",
        targetChecksum: sourceChecksum,
        completedByUserId: args.ctx.userId,
        completedAt: now,
      }).where(eq(preventionDocumentRelocations.id, relocationId))
      await tx.update(sstDocumentVersions).set({ status: "archivado", updatedAt: now })
        .where(eq(sstDocumentVersions.id, version.id))
      if (doc.currentVersionId === version.id) {
        await tx.update(sstDocuments).set({ status: "archivado", currentVersionId: null, updatedAt: now })
          .where(eq(sstDocuments.id, doc.id))
      }
      await tx.insert(sstDocumentAudit).values({
        id: `sda-${nanoid()}`,
        documentId: doc.id,
        versionId: version.id,
        action: "archive",
        userId: args.ctx.userId,
        fromStatus: doc.status,
        toStatus: "archivado",
        comment: reason,
        metadata: {
          relocationId,
          targetDomain: args.targetDomain,
          targetEntityId: args.targetEntityId,
          sourceChecksum,
          encryptedChecksum,
          sensitiveFileId: fileId,
        },
        ip: args.ctx.ip ?? null,
        createdAt: now,
      })
      await auditSensitiveFileAccess({
        fileId,
        domain: args.targetDomain,
        entityId: args.targetEntityId,
        subjectWorkerId,
        worksiteId: targetWorksiteId,
        ctx: args.ctx,
        action: "create",
        purpose: `reubicacion_documental:${reason.slice(0, 120)}`,
        outcome: "granted",
        client: tx,
      })
    })
  } catch (error) {
    await Promise.allSettled([
      ...(temporaryPath ? [unlink(temporaryPath)] : []),
      ...(absolutePath ? [unlink(absolutePath)] : []),
    ])
    await db.update(preventionDocumentRelocations).set({
      status: "failed",
      failureReason: error instanceof Error ? error.message.slice(0, 1000) : "Fallo de reubicación",
    }).where(eq(preventionDocumentRelocations.id, relocationId))
    throw error
  }

  return { relocationId, sensitiveFileId: fileId, sourceChecksum, encryptedChecksum }
}

export async function readPreventionSensitiveFile(args: {
  fileId: string
  purpose: string
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
}) {
  const purpose = args.purpose.trim()
  if (purpose.length < 5 || purpose.length > 300) throw new Error("Propósito de acceso inválido.")
  const [file] = await db.select().from(preventionSensitiveFiles).where(eq(preventionSensitiveFiles.id, args.fileId)).limit(1)
  if (!file) throw new Error("Archivo no encontrado o fuera de alcance.")
  let allowed = scopeAllows(args.scope, file.worksiteId)
  if (file.domain === "health") {
    allowed = allowed && args.permissions.includes("prevention:health:view_clinical")
  } else {
    allowed = allowed && args.permissions.includes("prevention:reserved_case:view")
    if (allowed) {
      const [membership] = await db.select({ userId: preventionReservedCaseMembers.userId })
        .from(preventionReservedCaseMembers).where(and(
          eq(preventionReservedCaseMembers.caseId, file.entityId),
          eq(preventionReservedCaseMembers.userId, args.ctx.userId),
        )).limit(1)
      allowed = Boolean(membership)
    }
  }
  if (!allowed) {
    await auditSensitiveFileAccess({
      fileId: file.id, domain: file.domain as SensitiveFileDomain, entityId: file.entityId,
      subjectWorkerId: file.subjectWorkerId, worksiteId: file.worksiteId, ctx: args.ctx,
      action: file.domain === "health" ? "read_clinical" : "read_reserved",
      purpose, outcome: "denied", reasonCode: "permission_scope_or_membership_denied",
    })
    throw new Error("Archivo no encontrado o fuera de alcance.")
  }
  const absolutePath = resolvePreventionSensitiveFile(file.encryptedFilePath)
  if (!absolutePath) throw new Error("Archivo sensible no disponible.")
  const encryptedBuffer = await readFile(absolutePath)
  if (checksum(encryptedBuffer) !== file.encryptedChecksum) throw new Error("El archivo cifrado no supera la verificación de integridad.")
  const buffer = decryptPreventionBuffer({
    encryptedBuffer,
    iv: file.iv,
    authTag: file.authTag,
    keyVersion: file.keyVersion,
  }, `sensitive-file:${file.id}`)
  if (checksum(buffer) !== file.sourceChecksum) throw new Error("El archivo restaurado no coincide con el checksum de origen.")
  await auditSensitiveFileAccess({
    fileId: file.id, domain: file.domain as SensitiveFileDomain, entityId: file.entityId,
    subjectWorkerId: file.subjectWorkerId, worksiteId: file.worksiteId, ctx: args.ctx,
    action: file.domain === "health" ? "read_clinical" : "read_reserved",
    purpose, outcome: "granted",
  })
  return { fileName: file.fileName, mimeType: file.mimeType, buffer, sourceChecksum: file.sourceChecksum }
}
