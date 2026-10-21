import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { decryptPreventionBuffer } from "@/lib/security/prevention-field-encryption"
import { archiveCopecEvidence } from "../copec-evidence"

let storageRoot: string | undefined

afterEach(async () => {
  vi.unstubAllEnvs()
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true })
  storageRoot = undefined
})

describe("archiveCopecEvidence", () => {
  it("writes authenticated ciphertext with restrictive permissions and a source checksum", async () => {
    storageRoot = await mkdtemp(path.join(os.tmpdir(), "copec-evidence-"))
    vi.stubEnv("STORAGE_PATH", storageRoot)
    vi.stubEnv("PREVENTION_DATA_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"))
    vi.stubEnv("PREVENTION_DATA_ENCRYPTION_KEY_VERSION", "test-v1")
    const original = Buffer.from("synthetic-xlsx-fixture", "utf8")

    const result = await archiveCopecEvidence("copec-file-123", original)
    const file = path.join(storageRoot, result.storagePath)
    const ciphertext = await readFile(file)
    const metadata = await stat(file)

    expect(ciphertext).not.toEqual(original)
    expect(metadata.mode & 0o077).toBe(0)
    expect(decryptPreventionBuffer({
      encryptedBuffer: ciphertext,
      iv: result.encryptionIv,
      authTag: result.encryptionAuthTag,
      keyVersion: result.encryptionKeyVersion,
    }, `copec-provider-file:${result.id}`)).toEqual(original)
    expect(result.sourceSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.encryptedSha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it("fails closed when the encryption key is unavailable", async () => {
    storageRoot = await mkdtemp(path.join(os.tmpdir(), "copec-evidence-"))
    vi.stubEnv("STORAGE_PATH", storageRoot)
    vi.stubEnv("PREVENTION_DATA_ENCRYPTION_KEY", "")

    await expect(archiveCopecEvidence("copec-file-123", Buffer.from("file"))).rejects.toThrow(/llave de cifrado/)
  })

  it("rejects empty files and unsafe identifiers", async () => {
    storageRoot = await mkdtemp(path.join(os.tmpdir(), "copec-evidence-"))
    vi.stubEnv("STORAGE_PATH", storageRoot)
    vi.stubEnv("PREVENTION_DATA_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"))

    await expect(archiveCopecEvidence("../escape", Buffer.from("file"))).rejects.toThrow(/Identificador/)
    await expect(archiveCopecEvidence("copec-file-123", Buffer.alloc(0))).rejects.toThrow(/tamaño/)
  })
})
