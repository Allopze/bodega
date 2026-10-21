import { createHash } from "node:crypto"
import { mkdir, open, rename, rm } from "node:fs/promises"
import { encryptPreventionBuffer } from "@/lib/security/prevention-field-encryption"
import { resolveStorageDir, resolveStorageFile } from "@/lib/storage/config"

export const COPEC_PARSER_VERSION = "copec-xlsx-v1"
export const COPEC_EVIDENCE_MAX_BYTES = 25 * 1024 * 1024

export interface ArchivedCopecEvidence {
  id: string
  storagePath: string
  sourceSha256: string
  encryptedSha256: string
  encryptionIv: string
  encryptionAuthTag: string
  encryptionKeyVersion: string
  sourceBytes: number
}

/**
 * Stores only AES-256-GCM ciphertext below the private storage root. The
 * filename is an internal random id; provider-supplied names never enter a
 * filesystem path. The archive is atomic and fails closed without the key.
 */
export async function archiveCopecEvidence(
  id: string,
  original: Uint8Array,
): Promise<ArchivedCopecEvidence> {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) throw new Error("Identificador de evidencia inválido")
  if (original.byteLength === 0 || original.byteLength > COPEC_EVIDENCE_MAX_BYTES) {
    throw new Error("El tamaño del archivo Copec no es válido para archivarlo")
  }

  const aad = `copec-provider-file:${id}`
  const encrypted = encryptPreventionBuffer(original, aad)
  const storagePath = `copec-evidence/${id}.xlsx.enc`
  const directory = resolveStorageFile(resolveStorageDir(), "copec-evidence")
  const target = resolveStorageFile(directory, `${id}.xlsx.enc`)
  const temporary = resolveStorageFile(directory, `.${id}.${process.pid}.tmp`)

  await mkdir(directory, { recursive: true, mode: 0o700 })
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporary, "wx", 0o600)
    await handle.writeFile(encrypted.encryptedBuffer)
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, target)
  } catch (error) {
    await handle?.close().catch(() => {})
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }

  return {
    id,
    storagePath,
    sourceSha256: createHash("sha256").update(original).digest("hex"),
    encryptedSha256: createHash("sha256").update(encrypted.encryptedBuffer).digest("hex"),
    encryptionIv: encrypted.iv,
    encryptionAuthTag: encrypted.authTag,
    encryptionKeyVersion: encrypted.keyVersion,
    sourceBytes: original.byteLength,
  }
}
