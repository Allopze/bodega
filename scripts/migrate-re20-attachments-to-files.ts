/**
 * Mueve los anexos RE-20 que aún guardan el binario cifrado en base64 dentro de
 * Postgres (filas anteriores a la migración 0354) a archivos cifrados en disco
 * (`prevention_sensitive_files`, dominio `incident_re20`).
 *
 * Por fila: descifra, verifica el SHA-256 registrado, recifra con el AAD de
 * archivos sensibles, escribe a disco, relee y verifica, y recién entonces, en
 * una transacción, crea el registro sensible, enlaza el anexo y vacía las
 * columnas legado. Una fila que no verifica se informa y NO se toca.
 *
 * Las columnas encrypted_file/file_iv/file_auth_tag/file_key_version quedan
 * nullable; el DROP va en una migración posterior, SÓLO tras correr este script
 * con --apply en cada ambiente y comprobar que el dry-run informa 0 pendientes.
 *
 *   npx tsx scripts/migrate-re20-attachments-to-files.ts          # informa (dry-run)
 *   npx tsx scripts/migrate-re20-attachments-to-files.ts --apply   # escribe
 */
import { createHash } from "node:crypto"
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/db"
import { preventionIncidentRe20Attachments, preventionIncidents, preventionSensitiveFiles } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { decryptPreventionBuffer, decryptPreventionPayload, encryptPreventionBuffer } from "@/lib/security/prevention-field-encryption"
import {
  createPreventionSensitiveFilePath,
  resolvePreventionSensitiveFile,
  resolvePreventionSensitiveFilesDir,
} from "@/lib/storage/config"

const sha256 = (buffer: Uint8Array) => createHash("sha256").update(buffer).digest("hex")

async function main() {
  const apply = process.argv.includes("--apply")
  const rows = await db.select({ attachment: preventionIncidentRe20Attachments, worksiteId: preventionIncidents.worksiteId })
    .from(preventionIncidentRe20Attachments)
    .innerJoin(preventionIncidents, eq(preventionIncidents.id, preventionIncidentRe20Attachments.incidentId))
    .where(isNull(preventionIncidentRe20Attachments.sensitiveFileId))

  const summary = { pending: rows.length, migrated: 0, failed: [] as Array<{ id: string; reason: string }> }
  if (!apply) {
    console.log(JSON.stringify(summary, null, 2))
    console.log(rows.length === 0 ? "\nNada por migrar. (dry-run)" : `\nDry-run: no se escribió nada. Con --apply se moverían ${rows.length} anexo(s) a disco.`)
    return
  }

  for (const { attachment: row, worksiteId } of rows) {
    const fileId = `psf-${nanoid()}`
    let absolutePath: string | null = null
    let temporaryPath: string | null = null
    try {
      if (!row.encryptedFile || !row.fileIv || !row.fileAuthTag || !row.fileKeyVersion) throw new Error("fila sin binario legado")
      const aad = `incident-re20-attachment:${row.incidentId}:${row.clientAttachmentId}`
      const plain = decryptPreventionBuffer({
        encryptedBuffer: Buffer.from(row.encryptedFile, "base64"), iv: row.fileIv, authTag: row.fileAuthTag, keyVersion: row.fileKeyVersion,
      }, `${aad}:file`)
      if (sha256(plain) !== row.checksumSha256) throw new Error("el checksum registrado no coincide con el binario")
      const metadata = decryptPreventionPayload<{ mimeType: string }>({
        encryptedPayload: row.encryptedMetadata, iv: row.metadataIv, authTag: row.metadataAuthTag, keyVersion: row.metadataKeyVersion,
      }, `${aad}:metadata`)

      const encrypted = encryptPreventionBuffer(plain, `sensitive-file:${fileId}`)
      const encryptedChecksum = sha256(encrypted.encryptedBuffer)
      const relativePath = createPreventionSensitiveFilePath(`${fileId}.bin`)
      absolutePath = resolvePreventionSensitiveFile(relativePath)
      if (!absolutePath) throw new Error("ruta sensible inválida")
      temporaryPath = `${absolutePath}.tmp-${nanoid(6)}`
      await mkdir(resolvePreventionSensitiveFilesDir(), { recursive: true })
      await writeFile(temporaryPath, encrypted.encryptedBuffer, { flag: "wx", mode: 0o600 })
      await rename(temporaryPath, absolutePath)
      temporaryPath = null

      const back = decryptPreventionBuffer({ ...encrypted, encryptedBuffer: await readFile(absolutePath) }, `sensitive-file:${fileId}`)
      if (sha256(back) !== row.checksumSha256) throw new Error("la copia en disco no superó la verificación")

      await db.transaction(async (tx) => {
        await tx.insert(preventionSensitiveFiles).values({
          id: fileId, domain: "incident_re20", entityId: row.incidentId, subjectWorkerId: null, worksiteId,
          fileName: "anexo-re20.bin", mimeType: metadata.mimeType, fileSize: row.fileSize,
          encryptedFilePath: relativePath, sourceChecksum: row.checksumSha256, encryptedChecksum,
          iv: encrypted.iv, authTag: encrypted.authTag, keyVersion: encrypted.keyVersion,
          createdByUserId: row.createdByUserId, createdAt: row.createdAt,
        })
        const updated = await tx.update(preventionIncidentRe20Attachments).set({
          sensitiveFileId: fileId, encryptedFile: null, fileIv: null, fileAuthTag: null, fileKeyVersion: null,
        }).where(and(eq(preventionIncidentRe20Attachments.id, row.id), isNull(preventionIncidentRe20Attachments.sensitiveFileId))).returning({ id: preventionIncidentRe20Attachments.id })
        if (updated.length !== 1) throw new Error("la fila cambió durante la migración")
      })
      summary.migrated += 1
    } catch (error) {
      await Promise.allSettled([
        ...(temporaryPath ? [unlink(temporaryPath)] : []),
        ...(absolutePath ? [unlink(absolutePath)] : []),
      ])
      summary.failed.push({ id: row.id, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  console.log(JSON.stringify(summary, null, 2))
  if (summary.failed.length > 0) process.exitCode = 1
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
