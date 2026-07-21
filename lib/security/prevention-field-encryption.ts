import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ALGORITHM = "aes-256-gcm"
const KEY_ENV = "PREVENTION_DATA_ENCRYPTION_KEY"
const KEY_VERSION_ENV = "PREVENTION_DATA_ENCRYPTION_KEY_VERSION"

export interface EncryptedPreventionPayload {
  encryptedPayload: string
  iv: string
  authTag: string
  keyVersion: string
}

export interface EncryptedPreventionBuffer {
  encryptedBuffer: Buffer
  iv: string
  authTag: string
  keyVersion: string
}

function getEncryptionKey() {
  const encoded = process.env[KEY_ENV]?.trim()
  if (!encoded) {
    throw new Error("El dominio sensible está deshabilitado: falta la llave de cifrado.")
  }
  const key = Buffer.from(encoded, "base64")
  if (key.byteLength !== 32) {
    throw new Error("El dominio sensible está deshabilitado: la llave de cifrado es inválida.")
  }
  return key
}

function getKeyVersion() {
  const version = process.env[KEY_VERSION_ENV]?.trim() || "v1"
  if (!/^[a-zA-Z0-9._-]{1,40}$/.test(version)) {
    throw new Error("La versión de llave de cifrado es inválida.")
  }
  return version
}

export function encryptPreventionPayload(payload: unknown, additionalAuthenticatedData: string): EncryptedPreventionPayload {
  if (!additionalAuthenticatedData.trim()) throw new Error("Contexto de cifrado requerido.")
  const key = getEncryptionKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  cipher.setAAD(Buffer.from(additionalAuthenticatedData, "utf8"))
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8")
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])

  return {
    encryptedPayload: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: getKeyVersion(),
  }
}

export function encryptPreventionBuffer(
  plaintext: Uint8Array,
  additionalAuthenticatedData: string,
): EncryptedPreventionBuffer {
  if (!additionalAuthenticatedData.trim()) throw new Error("Contexto de cifrado requerido.")
  if (plaintext.byteLength === 0) throw new Error("El archivo sensible está vacío.")
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv)
  cipher.setAAD(Buffer.from(additionalAuthenticatedData, "utf8"))
  const encryptedBuffer = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return {
    encryptedBuffer,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: getKeyVersion(),
  }
}

export function decryptPreventionBuffer(
  encrypted: Omit<EncryptedPreventionBuffer, "encryptedBuffer"> & { encryptedBuffer: Uint8Array },
  additionalAuthenticatedData: string,
): Buffer {
  if (!additionalAuthenticatedData.trim()) throw new Error("Contexto de cifrado requerido.")
  if (encrypted.keyVersion !== getKeyVersion()) throw new Error("La versión de llave requerida no está disponible.")
  try {
    const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), Buffer.from(encrypted.iv, "base64"))
    decipher.setAAD(Buffer.from(additionalAuthenticatedData, "utf8"))
    decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"))
    return Buffer.concat([decipher.update(encrypted.encryptedBuffer), decipher.final()])
  } catch {
    throw new Error("No se pudo autenticar o descifrar el archivo sensible.")
  }
}

export function decryptPreventionPayload<T>(
  encrypted: EncryptedPreventionPayload,
  additionalAuthenticatedData: string,
): T {
  if (!additionalAuthenticatedData.trim()) throw new Error("Contexto de cifrado requerido.")
  if (encrypted.keyVersion !== getKeyVersion()) {
    throw new Error("La versión de llave requerida no está disponible.")
  }
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      getEncryptionKey(),
      Buffer.from(encrypted.iv, "base64"),
    )
    decipher.setAAD(Buffer.from(additionalAuthenticatedData, "utf8"))
    decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.encryptedPayload, "base64")),
      decipher.final(),
    ])
    return JSON.parse(plaintext.toString("utf8")) as T
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("El contenido sensible descifrado es inválido.")
    throw new Error("No se pudo autenticar o descifrar el contenido sensible.")
  }
}
