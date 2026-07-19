import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  decryptPreventionPayload,
  encryptPreventionPayload,
} from "@/lib/security/prevention-field-encryption"

const previousKey = process.env.PREVENTION_DATA_ENCRYPTION_KEY
const previousVersion = process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION

describe("prevention sensitive field encryption", () => {
  beforeEach(() => {
    process.env.PREVENTION_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64")
    process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION = "test-v1"
  })

  afterEach(() => {
    if (previousKey === undefined) delete process.env.PREVENTION_DATA_ENCRYPTION_KEY
    else process.env.PREVENTION_DATA_ENCRYPTION_KEY = previousKey
    if (previousVersion === undefined) delete process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION
    else process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION = previousVersion
  })

  it("round-trips clinical JSON without storing plaintext", () => {
    const payload = { diagnosis: "dato clínico", result: "confidencial" }
    const encrypted = encryptPreventionPayload(payload, "health:record-1")

    expect(encrypted.encryptedPayload).not.toContain("diagnosis")
    expect(encrypted.encryptedPayload).not.toContain("clínico")
    expect(decryptPreventionPayload(encrypted, "health:record-1")).toEqual(payload)
  })

  it("rejects ciphertext replayed under another entity context", () => {
    const encrypted = encryptPreventionPayload({ diagnosis: "reservado" }, "health:record-1")
    expect(() => decryptPreventionPayload(encrypted, "health:record-2"))
      .toThrow(/autenticar o descifrar/i)
  })

  it("fails closed when the encryption key is missing or invalid", () => {
    delete process.env.PREVENTION_DATA_ENCRYPTION_KEY
    expect(() => encryptPreventionPayload({}, "health:record-1")).toThrow(/deshabilitado/i)

    process.env.PREVENTION_DATA_ENCRYPTION_KEY = Buffer.alloc(16).toString("base64")
    expect(() => encryptPreventionPayload({}, "health:record-1")).toThrow(/inválida/i)
  })
})
