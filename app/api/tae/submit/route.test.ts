import { beforeEach, describe, expect, it, vi } from "vitest"

const mockHeaders = vi.hoisted(() => vi.fn())
const mockCheckRateLimit = vi.hoisted(() => vi.fn())
const mockConsumeFixedWindowLimit = vi.hoisted(() => vi.fn())
const mockRecordFailure = vi.hoisted(() => vi.fn())
const mockRecordSuccessForTelemetry = vi.hoisted(() => vi.fn())
const mockCreateTaeSubmission = vi.hoisted(() => vi.fn())
const mockIsRouteOperational = vi.hoisted(() => vi.fn())
const mockSafeParse = vi.hoisted(() => vi.fn())

vi.mock("next/headers", () => ({ headers: mockHeaders }))
vi.mock("sharp", () => ({ default: vi.fn() }))
vi.mock("@/lib/services/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  consumeFixedWindowLimit: mockConsumeFixedWindowLimit,
  recordFailure: mockRecordFailure,
  recordSuccessForTelemetry: mockRecordSuccessForTelemetry,
}))
vi.mock("@/lib/services/fuel-tae", () => ({ createTaeSubmission: mockCreateTaeSubmission }))
vi.mock("@/lib/services/module-toggles", () => ({ isRouteOperational: mockIsRouteOperational }))
vi.mock("@/lib/validation/fuel-tae", () => ({
  taeEvidenceKinds: [],
  taePublicSubmissionSchema: { safeParse: mockSafeParse },
}))
vi.mock("@/lib/file-validation", () => ({ MimeType: { IMAGE: "image" }, validateFileBuffer: vi.fn() }))
vi.mock("@/lib/services/tae-ocr", () => ({ extractMeterReading: vi.fn() }))

const trustedIp = "198.51.100.24"

function headersFor(xForwardedFor: string) {
  return {
    get: (key: string) => ({
      "cf-connecting-ip": trustedIp,
      "x-forwarded-for": xForwardedFor,
    })[key] ?? null,
  }
}

function makeRequest(): Request {
  const formData = new FormData()
  formData.set("payload", "{}")
  return { formData: () => Promise.resolve(formData) } as unknown as Request
}

describe("POST /api/tae/submit", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHeaders.mockResolvedValue(headersFor("10.0.0.1"))
    mockIsRouteOperational.mockResolvedValue(true)
    mockConsumeFixedWindowLimit.mockResolvedValue({ allowed: true, remaining: 1 })
    mockCheckRateLimit.mockResolvedValue({ allowed: true, waitTimeRemainingMs: 0 })
    mockSafeParse.mockReturnValue({ success: true, data: { worksiteId: "ws-1" } })
    mockCreateTaeSubmission.mockResolvedValue({ id: "tae-1" })
  })

  it("mantiene límites y auditoría por IP confiable aunque rote X-Forwarded-For", async () => {
    const { POST } = await import("./route")

    await POST(makeRequest())
    mockHeaders.mockResolvedValue(headersFor("10.0.0.2"))
    await POST(makeRequest())

    expect(mockConsumeFixedWindowLimit.mock.calls
      .filter(([key]) => String(key).startsWith("tae:submit-volume:ip:"))
      .map(([key]) => key)).toEqual([
      `tae:submit-volume:ip:${trustedIp}`,
      `tae:submit-volume:ip:${trustedIp}`,
    ])
    expect(mockCheckRateLimit.mock.calls.map(([key]) => key)).toEqual([
      `tae:submit:${trustedIp}`,
      `tae:submit:${trustedIp}`,
    ])
    expect(mockRecordSuccessForTelemetry.mock.calls.map(([key]) => key)).toEqual([
      `tae:submit:${trustedIp}`,
      `tae:submit:${trustedIp}`,
    ])
    expect(mockCreateTaeSubmission).toHaveBeenNthCalledWith(1, expect.objectContaining({ ipAddress: trustedIp }))
    expect(mockCreateTaeSubmission).toHaveBeenNthCalledWith(2, expect.objectContaining({ ipAddress: trustedIp }))
  })

  it("registra el fallo en el límite confiable cuando la carga TAE falla", async () => {
    mockCreateTaeSubmission.mockRejectedValueOnce(new Error("fallo de carga"))
    const { POST } = await import("./route")

    const response = await POST(makeRequest())

    expect(response.status).toBe(400)
    expect(mockRecordFailure).toHaveBeenCalledWith(`tae:submit:${trustedIp}`, { maxAttempts: 12 })
  })
})
