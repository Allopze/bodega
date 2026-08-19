import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import type { RequestFormData } from "@/lib/validation/operations"
import {
  normalizeEppStockQuantity,
  type EppStockSnapshot,
} from "./epp-stock-availability"

export const EPP_STOCK_CONFIRMATION_TTL_MS = 5 * 60_000
/** Keep the server action's transport guard and the signed payload in sync. */
export const EPP_STOCK_CONFIRMATION_MAX_LENGTH = 16_384

const DOMAIN = "epp-request-stock-confirmation:v1"
const TOKEN_VERSION = 2

/** Expected confirmation failures are safe, actionable form errors. */
export class EppStockConfirmationError extends Error {
  override name = "EppStockConfirmationError"
}

export interface EppStockConfirmationInput {
  actorUserId: string
  submissionKey: string
  payloadHash: string
  snapshot: EppStockSnapshot
}

/**
 * The confirmation needs to bind stock identity and quantities, not mutable
 * labels. Hashing IDs keeps a worst-case 50-line confirmation under the action
 * transport limit even when product or worksite names are unusually long.
 */
export interface EppStockConfirmationSnapshot {
  worksiteHash: string
  lines: Array<{
    productHash: string
    requestedQuantity: number
    availableQuantity: number
  }>
}

interface TokenPayload {
  v: number
  expiresAt: number
  snapshot: EppStockConfirmationSnapshot
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new EppStockConfirmationError("No se pudo preparar la confirmación de stock.")
    return JSON.stringify(Object.is(value, -0) ? 0 : value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`
  }
  throw new EppStockConfirmationError("No se pudo preparar la confirmación de stock.")
}

function authSecretRing(): string[] {
  const current = (process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "").trim()
  if (!current) {
    throw new EppStockConfirmationError("No fue posible emitir la confirmación de stock. Intenta nuevamente.")
  }
  const previous = (process.env.AUTH_SECRET_PREVIOUS ?? process.env.NEXTAUTH_SECRET_PREVIOUS ?? "")
    .split(",")
    .map((secret) => secret.trim())
    .filter(Boolean)
  return [current, ...previous]
}

function signatureFor(
  secret: string,
  input: Pick<EppStockConfirmationInput, "actorUserId" | "submissionKey" | "payloadHash">,
  payload: TokenPayload,
): string {
  return createHmac("sha256", secret)
    .update(canonicalJson({ domain: DOMAIN, actorUserId: input.actorUserId, submissionKey: input.submissionKey, payloadHash: input.payloadHash, payload }))
    .digest("base64url")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 500 ? value : null
}

function opaqueReference(scope: "worksite" | "product", value: string): string {
  if (!value || value.length > 4_096) {
    throw new EppStockConfirmationError("No se pudo preparar la confirmación de stock.")
  }
  return createHash("sha256").update(`${DOMAIN}:${scope}\u0000${value}`).digest("base64url")
}

export function toEppStockConfirmationSnapshot(snapshot: EppStockSnapshot): EppStockConfirmationSnapshot {
  if (!snapshot || snapshot.lines.length > 50) {
    throw new EppStockConfirmationError("No se pudo preparar la confirmación de stock.")
  }

  const lines = snapshot.lines.map((line) => {
    const requestedQuantity = normalizeEppStockQuantity(line.requestedQuantity, "cantidad solicitada")
    const availableQuantity = normalizeEppStockQuantity(line.availableQuantity)
    if (requestedQuantity <= 0) {
      throw new EppStockConfirmationError("No se pudo preparar la confirmación de stock.")
    }
    return {
      productHash: opaqueReference("product", line.productId),
      requestedQuantity,
      availableQuantity,
    }
  }).sort((left, right) => left.productHash < right.productHash ? -1 : left.productHash > right.productHash ? 1 : 0)

  if (lines.some((line, index) => index > 0 && lines[index - 1]!.productHash === line.productHash)) {
    throw new EppStockConfirmationError("No se pudo preparar la confirmación de stock.")
  }
  return { worksiteHash: opaqueReference("worksite", snapshot.worksiteId), lines }
}

function parseSnapshot(value: unknown): EppStockConfirmationSnapshot | null {
  if (!isRecord(value)) return null
  const worksiteHash = requiredString(value.worksiteHash)
  if (!worksiteHash || !/^[A-Za-z0-9_-]{43}$/.test(worksiteHash) || !Array.isArray(value.lines) || value.lines.length > 50) return null

  const lines: EppStockConfirmationSnapshot["lines"] = []
  let previousProductHash: string | null = null
  for (const rawLine of value.lines) {
    if (!isRecord(rawLine)) return null
    const productHash = requiredString(rawLine.productHash)
    if (!productHash || !/^[A-Za-z0-9_-]{43}$/.test(productHash) || typeof rawLine.requestedQuantity !== "number" || typeof rawLine.availableQuantity !== "number") return null
    try {
      const requestedQuantity = normalizeEppStockQuantity(rawLine.requestedQuantity, "cantidad solicitada")
      const availableQuantity = normalizeEppStockQuantity(rawLine.availableQuantity)
      if (requestedQuantity <= 0 || (previousProductHash !== null && previousProductHash >= productHash)) return null
      lines.push({ productHash, requestedQuantity, availableQuantity })
      previousProductHash = productHash
    } catch {
      return null
    }
  }
  return { worksiteHash, lines }
}

function tokenPayload(input: EppStockConfirmationInput, expiresAt: number): TokenPayload {
  if (!Number.isFinite(expiresAt)) {
    throw new EppStockConfirmationError("No se pudo preparar la confirmación de stock.")
  }
  return { v: TOKEN_VERSION, expiresAt, snapshot: toEppStockConfirmationSnapshot(input.snapshot) }
}

function signaturesMatch(expected: string, supplied: string): boolean {
  const expectedBytes = Buffer.from(expected)
  const suppliedBytes = Buffer.from(supplied)
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes)
}

/** Hashes all validated form fields, including non-EPP/free-text items. */
export function hashRequestSubmissionPayload(data: RequestFormData): string {
  return createHash("sha256").update(canonicalJson(data)).digest("hex")
}

/** Issues an opaque, short-lived confirmation tied to this exact request state. */
export function issueEppStockConfirmation(input: EppStockConfirmationInput, now = Date.now()): string {
  const payload = tokenPayload(input, now + EPP_STOCK_CONFIRMATION_TTL_MS)
  const encodedPayload = Buffer.from(canonicalJson(payload)).toString("base64url")
  const token = `${encodedPayload}.${signatureFor(authSecretRing()[0]!, input, payload)}`
  if (token.length > EPP_STOCK_CONFIRMATION_MAX_LENGTH) {
    throw new EppStockConfirmationError("No se pudo preparar la confirmación de stock. Reduce los ítems e inténtalo nuevamente.")
  }
  return token
}

/**
 * Verifies user/key/payload binding, expiry and HMAC using the active or rotated
 * auth secret. It returns the compact signed stock snapshot; the caller must
 * compare it with a fresh transactional inventory read before creating anything.
 */
export function verifyEppStockConfirmation(
  input: Omit<EppStockConfirmationInput, "snapshot"> & { token: string },
  now = Date.now(),
): EppStockConfirmationSnapshot {
  if (!input.token || input.token.length > EPP_STOCK_CONFIRMATION_MAX_LENGTH) {
    throw new EppStockConfirmationError("La confirmación de stock no es válida. Solicita una nueva revisión.")
  }
  const parts = input.token.split(".")
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new EppStockConfirmationError("La confirmación de stock no es válida. Solicita una nueva revisión.")
  }

  let rawPayload: unknown
  try {
    rawPayload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"))
  } catch {
    throw new EppStockConfirmationError("La confirmación de stock no es válida. Solicita una nueva revisión.")
  }
  if (!isRecord(rawPayload) || rawPayload.v !== TOKEN_VERSION || typeof rawPayload.expiresAt !== "number") {
    throw new EppStockConfirmationError("La confirmación de stock no es válida. Solicita una nueva revisión.")
  }
  const snapshot = parseSnapshot(rawPayload.snapshot)
  if (!snapshot) throw new EppStockConfirmationError("La confirmación de stock no es válida. Solicita una nueva revisión.")
  if (!Number.isFinite(rawPayload.expiresAt) || rawPayload.expiresAt <= now) {
    throw new EppStockConfirmationError("La confirmación de stock venció. Revisa la disponibilidad nuevamente.")
  }

  const signedPayload: TokenPayload = { v: TOKEN_VERSION, expiresAt: rawPayload.expiresAt, snapshot }
  const valid = authSecretRing().some((secret) => signaturesMatch(signatureFor(secret, input, signedPayload), parts[1]!))
  if (!valid) throw new EppStockConfirmationError("La confirmación de stock no es válida. Solicita una nueva revisión.")
  return snapshot
}

/** Compares a signed compact snapshot against the newest locked stock read. */
export function sameEppStockConfirmationSnapshot(
  signed: EppStockConfirmationSnapshot,
  current: EppStockSnapshot,
): boolean {
  try {
    return canonicalJson(signed) === canonicalJson(toEppStockConfirmationSnapshot(current))
  } catch {
    return false
  }
}
