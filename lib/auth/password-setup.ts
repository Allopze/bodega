import { randomBytes } from "node:crypto"

const PENDING_PASSWORD_PREFIX = "pending-password:"

export function createPendingPasswordMarker() {
  return `${PENDING_PASSWORD_PREFIX}${randomBytes(32).toString("base64url")}`
}

export function isPasswordSetupPending(hashedPassword: string) {
  return hashedPassword.startsWith(PENDING_PASSWORD_PREFIX)
}

export function displayNameFromEmail(email: string) {
  const local = email.split("@")[0] ?? email
  const cleaned = local
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  return cleaned
    ? cleaned.replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase("es-CL"))
    : email
}
