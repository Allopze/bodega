import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}))

vi.mock("@/lib/sentry", () => ({
  sentry: {
    captureException: (...args: unknown[]) => mocks.captureException(...args),
    captureMessage: (...args: unknown[]) => mocks.captureMessage(...args),
  },
}))

describe("logger Sentry boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("never forwards a raw DTE secret from a string log message to Sentry", async () => {
    const { logger } = await import("@/lib/logger")
    const secret = "dte-password-never-send"

    logger.error(`DTE request failed: clave=${secret} rut_usr=11111111-1`)

    const [message] = mocks.captureMessage.mock.calls[0] ?? []
    expect(message).not.toContain(secret)
    expect(message).not.toContain("11111111-1")
    expect(message).toContain("[redacted]")
  })
})
