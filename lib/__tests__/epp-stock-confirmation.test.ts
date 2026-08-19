import { afterEach, describe, expect, it, vi } from "vitest"
import type { RequestFormData } from "@/lib/validation/operations"
import {
  EPP_STOCK_CONFIRMATION_MAX_LENGTH,
  EPP_STOCK_CONFIRMATION_TTL_MS,
  EppStockConfirmationError,
  hashRequestSubmissionPayload,
  issueEppStockConfirmation,
  sameEppStockConfirmationSnapshot,
  toEppStockConfirmationSnapshot,
  verifyEppStockConfirmation,
} from "@/lib/services/epp-stock-confirmation"

const request: RequestFormData = {
  worksiteId: "ws-1",
  requestType: "epp",
  urgency: "normal",
  deliveryMode: "via_oficina",
  requiredDate: "2026-10-01",
  notes: "Entrega a cuadrilla A",
  items: [{
    productId: "prod-casco", productNameFree: null, quantity: 2, unitOfMeasure: "unidad",
    urgency: "normal", attributes: [{ attributeName: "Talla", value: "M" }], sortOrder: 0,
  }],
}

const snapshot = {
  worksiteId: "ws-1",
  worksiteName: "Faena Norte",
  lines: [{
    productId: "prod-casco",
    productName: "Casco de seguridad talla M",
    requestedQuantity: 2,
    availableQuantity: 4,
    locationName: "Faena Norte",
  }],
}

const oldSecrets = {
  auth: process.env.AUTH_SECRET,
  previous: process.env.AUTH_SECRET_PREVIOUS,
  nextAuth: process.env.NEXTAUTH_SECRET,
  nextAuthPrevious: process.env.NEXTAUTH_SECRET_PREVIOUS,
}

const SECRET_ENV_NAMES = {
  auth: "AUTH_SECRET",
  previous: "AUTH_SECRET_PREVIOUS",
  nextAuth: "NEXTAUTH_SECRET",
  nextAuthPrevious: "NEXTAUTH_SECRET_PREVIOUS",
} as const

function restoreEnv(name: keyof typeof oldSecrets, value: string | undefined) {
  const envName = SECRET_ENV_NAMES[name]
  if (value === undefined) delete process.env[envName]
  else process.env[envName] = value
}

afterEach(() => {
  vi.unstubAllEnvs()
  restoreEnv("auth", oldSecrets.auth)
  restoreEnv("previous", oldSecrets.previous)
  restoreEnv("nextAuth", oldSecrets.nextAuth)
  restoreEnv("nextAuthPrevious", oldSecrets.nextAuthPrevious)
})

describe("EPP stock confirmation", () => {
  it("binds the confirmation to the user, stable submission key, full validated payload and stock snapshot", () => {
    vi.stubEnv("AUTH_SECRET", "current-secret")
    const payloadHash = hashRequestSubmissionPayload(request)
    const token = issueEppStockConfirmation({
      actorUserId: "user-1", submissionKey: "submission-key-123456", payloadHash, snapshot,
    }, 1_000)

    expect(verifyEppStockConfirmation({
      token, actorUserId: "user-1", submissionKey: "submission-key-123456", payloadHash,
    }, 1_001)).toEqual(toEppStockConfirmationSnapshot(snapshot))

    const changedPayloadHash = hashRequestSubmissionPayload({
      ...request,
      items: [{ ...request.items[0]!, quantity: 3 }],
    })
    expect(() => verifyEppStockConfirmation({
      token, actorUserId: "user-1", submissionKey: "submission-key-123456", payloadHash: changedPayloadHash,
    }, 1_001)).toThrow(EppStockConfirmationError)
    expect(() => verifyEppStockConfirmation({
      token, actorUserId: "other-user", submissionKey: "submission-key-123456", payloadHash,
    }, 1_001)).toThrow(EppStockConfirmationError)
  })

  it("expires promptly and accepts a token signed with a rotated previous AUTH_SECRET", () => {
    vi.stubEnv("AUTH_SECRET", "previous-secret")
    const payloadHash = hashRequestSubmissionPayload(request)
    const token = issueEppStockConfirmation({
      actorUserId: "user-1", submissionKey: "submission-key-123456", payloadHash, snapshot,
    }, 2_000)

    vi.stubEnv("AUTH_SECRET", "current-secret")
    vi.stubEnv("AUTH_SECRET_PREVIOUS", "previous-secret")
    expect(verifyEppStockConfirmation({
      token, actorUserId: "user-1", submissionKey: "submission-key-123456", payloadHash,
    }, 2_001)).toEqual(toEppStockConfirmationSnapshot(snapshot))
    expect(() => verifyEppStockConfirmation({
      token, actorUserId: "user-1", submissionKey: "submission-key-123456", payloadHash,
    }, 2_000 + EPP_STOCK_CONFIRMATION_TTL_MS + 1)).toThrow(/venció/i)
  })

  it("keeps a 50-line confirmation transportable when visible labels are long", () => {
    vi.stubEnv("AUTH_SECRET", "current-secret")
    const longSnapshot = {
      worksiteId: "ws-very-long-name",
      worksiteName: "F".repeat(5_000),
      lines: Array.from({ length: 50 }, (_, index) => ({
        productId: `product-${String(index).padStart(2, "0")}`,
        productName: "P".repeat(5_000),
        requestedQuantity: index + 1,
        availableQuantity: index + 2,
        locationName: "L".repeat(5_000),
      })),
    }
    const payloadHash = hashRequestSubmissionPayload(request)
    const token = issueEppStockConfirmation({
      actorUserId: "user-1", submissionKey: "submission-key-123456", payloadHash, snapshot: longSnapshot,
    }, 3_000)

    expect(token.length).toBeLessThanOrEqual(EPP_STOCK_CONFIRMATION_MAX_LENGTH)
    const signed = verifyEppStockConfirmation({
      token, actorUserId: "user-1", submissionKey: "submission-key-123456", payloadHash,
    }, 3_001)
    expect(sameEppStockConfirmationSnapshot(signed, longSnapshot)).toBe(true)
    expect(sameEppStockConfirmationSnapshot(signed, {
      ...longSnapshot,
      lines: longSnapshot.lines.map((line, index) => index === 0 ? { ...line, availableQuantity: 0 } : line),
    })).toBe(false)
  })
})
