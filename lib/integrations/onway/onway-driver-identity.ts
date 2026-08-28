import { createHmac } from "node:crypto"
import {
  decryptDteSetting,
  encryptDteSetting,
  type DteSettingsKeyring,
} from "@/lib/services/dte-portal/settings-crypto"

const MAX_DRIVER_ID_LENGTH = 160

export class OnwayDriverIdentityError extends Error {
  constructor(readonly code: "ONWAY_DRIVER_ID_INVALID") {
    super(code)
    this.name = "OnwayDriverIdentityError"
  }
}

function normalizedDriverId(value: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_DRIVER_ID_LENGTH) throw new OnwayDriverIdentityError("ONWAY_DRIVER_ID_INVALID")
  return normalized
}

function driverHash(value: string, keyId: string, key: Buffer): string {
  return `${keyId}:${createHmac("sha256", key).update(`onway-driver:${value}`, "utf8").digest("hex")}`
}

export function candidateOnwayDriverHashes(externalId: string, keyring: DteSettingsKeyring): string[] {
  const value = normalizedDriverId(externalId)
  return [...keyring.keys.entries()].map(([keyId, key]) => driverHash(value, keyId, key))
}

export interface EncryptedOnwayDriverIdentity {
  externalDriverHash: string
  externalDriverCiphertext: string
  displayNameCiphertext: string | null
}

export function encryptOnwayDriverIdentity(
  input: { provider: "onway"; externalId: string; displayName?: string | null },
  keyring: DteSettingsKeyring,
): EncryptedOnwayDriverIdentity {
  const externalId = normalizedDriverId(input.externalId)
  const activeKeyId = keyring.activeKeyId
  const key = activeKeyId ? keyring.keys.get(activeKeyId) : undefined
  if (!activeKeyId || !key) throw new OnwayDriverIdentityError("ONWAY_DRIVER_ID_INVALID")
  const externalDriverHash = driverHash(externalId, activeKeyId, key)
  const context = `fleet_gps_driver_mapping:${input.provider}:${externalDriverHash}`
  const displayName = input.displayName?.trim() || null
  return {
    externalDriverHash,
    externalDriverCiphertext: encryptDteSetting(externalId, `${context}:external`, keyring),
    displayNameCiphertext: displayName ? encryptDteSetting(displayName, `${context}:display`, keyring) : null,
  }
}

export function decryptOnwayDriverIdentity(
  input: { provider: "onway"; externalDriverHash: string; externalDriverCiphertext: string; displayNameCiphertext: string | null },
  keyring: DteSettingsKeyring,
): { externalId: string; displayName: string | null } {
  const context = `fleet_gps_driver_mapping:${input.provider}:${input.externalDriverHash}`
  return {
    externalId: decryptDteSetting(input.externalDriverCiphertext, `${context}:external`, keyring),
    displayName: input.displayNameCiphertext ? decryptDteSetting(input.displayNameCiphertext, `${context}:display`, keyring) : null,
  }
}
