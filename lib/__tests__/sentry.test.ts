import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const captureException = vi.fn()
  const captureMessage = vi.fn()
  const setUser = vi.fn()
  const setTag = vi.fn()
  return { captureException, captureMessage, setUser, setTag }
})

vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.captureException,
  captureMessage: mocks.captureMessage,
  setUser: mocks.setUser,
  setTag: mocks.setTag,
}))

describe("sentry wrapper", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  it("is a no-op if SENTRY_DSN is not configured", async () => {
    delete process.env.SENTRY_DSN

    const { sentry } = await import("@/lib/sentry")

    sentry.captureException(new Error("test"))
    sentry.captureMessage("hello")
    sentry.setUser("usr-1", "user@test.com")
    sentry.setTag("foo", "bar")

    expect(mocks.captureException).not.toHaveBeenCalled()
    expect(mocks.captureMessage).not.toHaveBeenCalled()
    expect(mocks.setUser).not.toHaveBeenCalled()
    expect(mocks.setTag).not.toHaveBeenCalled()
  })

  it("delegates calls to Sentry when SENTRY_DSN is configured", async () => {
    process.env.SENTRY_DSN = "https://fake-dsn@sentry.io/1"

    const { sentry } = await import("@/lib/sentry")

    const err = new Error("test-prod")
    sentry.captureException(err, { extraInfo: "val" })
    expect(mocks.captureException).toHaveBeenCalledWith(err, { extra: { extraInfo: "val" } })

    sentry.captureMessage("hello message", "warning")
    expect(mocks.captureMessage).toHaveBeenCalledWith("hello message", "warning")

    sentry.setUser("usr-1", "user@test.com")
    expect(mocks.setUser).toHaveBeenCalledWith({ id: "usr-1", email: "user@test.com" })

    sentry.setTag("foo", "bar")
    expect(mocks.setTag).toHaveBeenCalledWith("foo", "bar")
  })
})

// NOTE: Sentry.init() and beforeSend header scrubbing live in
// sentry.server.config.ts, sentry.edge.config.ts and instrumentation-client.ts,
// wired explicitly from instrumentation.ts per the Next.js 16 instrumentation
// contract. These config files are not unit-tested here because they are
// Sentry's official wiring pattern; their beforeSend logic is verified by
// integration/E2E tests.
