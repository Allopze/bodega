import { describe, expect, it } from "vitest"
import {
  decryptDteSetting,
  encryptDteSetting,
  parseDteSettingsKeyring,
} from "../settings-crypto"

const KEY = Buffer.alloc(32, 7).toString("base64url")

function keyring() {
  return parseDteSettingsKeyring({
    DTE_SETTINGS_KEYRING: JSON.stringify({ primary: KEY }),
    DTE_SETTINGS_ACTIVE_KEY_ID: "primary",
    DTE_SETTINGS_MODE: "compat",
  })
}

describe("DTE settings encryption", () => {
  it("encrypts with AES-256-GCM and decrypts only with the same setting key", () => {
    const encrypted = encryptDteSetting("credential-value", "dte.clave", keyring())

    expect(encrypted).toMatch(/^enc:v1:primary:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/)
    expect(encrypted).not.toContain("credential-value")
    expect(decryptDteSetting(encrypted, "dte.clave", keyring())).toBe("credential-value")
    expect(() => decryptDteSetting(encrypted, "dte.rut_usr", keyring())).toThrow("DTE_SETTINGS_DECRYPT_FAILED")
  })

  it("uses a random 96-bit IV for every encryption", () => {
    const first = encryptDteSetting("credential-value", "dte.clave", keyring())
    const second = encryptDteSetting("credential-value", "dte.clave", keyring())

    expect(first).not.toBe(second)
    expect(first.split(":")[3]).not.toBe(second.split(":")[3])
  })

  it("rejects a tampered envelope and a retired key", () => {
    const encrypted = encryptDteSetting("credential-value", "dte.clave", keyring())
    const [, version, kid, iv, tag, ciphertext] = encrypted.split(":")
    const tampered = `enc:${version}:${kid}:${iv}:${tag}:${ciphertext!.slice(0, -1)}A`

    expect(() => decryptDteSetting(tampered, "dte.clave", keyring())).toThrow("DTE_SETTINGS_DECRYPT_FAILED")
    expect(() => decryptDteSetting(encrypted, "dte.clave", parseDteSettingsKeyring({
      DTE_SETTINGS_KEYRING: JSON.stringify({ replacement: KEY }),
      DTE_SETTINGS_ACTIVE_KEY_ID: "replacement",
      DTE_SETTINGS_MODE: "compat",
    }))).toThrow("DTE_SETTINGS_KEY_UNAVAILABLE")
  })

  it("fails closed in encrypted_only without a valid active key", () => {
    expect(() => parseDteSettingsKeyring({ DTE_SETTINGS_MODE: "encrypted_only" })).toThrow(
      "DTE_SETTINGS_KEYRING_REQUIRED",
    )
    expect(() => parseDteSettingsKeyring({
      DTE_SETTINGS_KEYRING: JSON.stringify({ primary: "too-short" }),
      DTE_SETTINGS_ACTIVE_KEY_ID: "primary",
      DTE_SETTINGS_MODE: "encrypted_only",
    })).toThrow("DTE_SETTINGS_KEY_INVALID")
  })
})
