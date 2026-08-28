import { describe, expect, it } from "vitest"
import { parseDteSettingsKeyring } from "@/lib/services/dte-portal/settings-crypto"
import {
  candidateOnwayDriverHashes,
  decryptOnwayDriverIdentity,
  encryptOnwayDriverIdentity,
} from "./onway-driver-identity"

const keyring = parseDteSettingsKeyring({
  DTE_SETTINGS_MODE: "encrypted_only",
  DTE_SETTINGS_ACTIVE_KEY_ID: "current",
  DTE_SETTINGS_KEYRING: JSON.stringify({ current: Buffer.alloc(32, 7).toString("base64url") }),
})

describe("OnWay driver identity", () => {
  it("derives deterministic keyed lookup hashes and encrypts the values at rest", () => {
    const hashes = candidateOnwayDriverHashes("driver-42", keyring)
    const encrypted = encryptOnwayDriverIdentity({ provider: "onway", externalId: "driver-42", displayName: "Nombre conductor" }, keyring)

    expect(hashes).toEqual([encrypted.externalDriverHash])
    expect(encrypted.externalDriverHash).toMatch(/^current:[a-f0-9]{64}$/)
    expect(encrypted.externalDriverCiphertext).not.toContain("driver-42")
    expect(decryptOnwayDriverIdentity({ provider: "onway", externalDriverHash: encrypted.externalDriverHash, externalDriverCiphertext: encrypted.externalDriverCiphertext, displayNameCiphertext: encrypted.displayNameCiphertext }, keyring))
      .toEqual({ externalId: "driver-42", displayName: "Nombre conductor" })
  })

  it("rejects blank or oversized portal identifiers", () => {
    expect(() => candidateOnwayDriverHashes(" ", keyring)).toThrow("ONWAY_DRIVER_ID_INVALID")
    expect(() => candidateOnwayDriverHashes("x".repeat(161), keyring)).toThrow("ONWAY_DRIVER_ID_INVALID")
  })
})
