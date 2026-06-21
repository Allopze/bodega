import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const init = vi.fn()
  const captureException = vi.fn()
  const captureMessage = vi.fn()
  const setUser = vi.fn()
  const setTag = vi.fn()
  return { init, captureException, captureMessage, setUser, setTag }
})

vi.mock("@sentry/nextjs", () => ({
  init: mocks.init,
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

  it("does not initialize and is a no-op if SENTRY_DSN is not configured", async () => {
    delete process.env.SENTRY_DSN
    ;(process.env as Record<string, string | undefined>).NODE_ENV = "production"

    const { sentry } = await import("@/lib/sentry")

    sentry.captureException(new Error("test"))
    sentry.captureMessage("hello")
    sentry.setUser("usr-1", "user@test.com")
    sentry.setTag("foo", "bar")

    expect(mocks.init).not.toHaveBeenCalled()
    expect(mocks.captureException).not.toHaveBeenCalled()
    expect(mocks.captureMessage).not.toHaveBeenCalled()
    expect(mocks.setUser).not.toHaveBeenCalled()
    expect(mocks.setTag).not.toHaveBeenCalled()
  })

  it("does not initialize and is a no-op if NODE_ENV is not production", async () => {
    process.env.SENTRY_DSN = "https://fake-dsn@sentry.io/1"
    ;(process.env as Record<string, string | undefined>).NODE_ENV = "development"

    const { sentry } = await import("@/lib/sentry")

    sentry.captureException(new Error("test"))
    expect(mocks.init).not.toHaveBeenCalled()
  })

  it("initializes and delegates calls if SENTRY_DSN is configured in production", async () => {
    process.env.SENTRY_DSN = "https://fake-dsn@sentry.io/1"
    ;(process.env as Record<string, string | undefined>).NODE_ENV = "production"

    const { sentry } = await import("@/lib/sentry")

    const err = new Error("test-prod")
    sentry.captureException(err, { extraInfo: "val" })
    expect(mocks.init).toHaveBeenCalledTimes(1)
    expect(mocks.captureException).toHaveBeenCalledWith(err, { extra: { extraInfo: "val" } })

    sentry.captureMessage("hello message", "warning")
    expect(mocks.captureMessage).toHaveBeenCalledWith("hello message", "warning")

    sentry.setUser("usr-1", "user@test.com")
    expect(mocks.setUser).toHaveBeenCalledWith({ id: "usr-1", email: "user@test.com" })

    sentry.setTag("foo", "bar")
    expect(mocks.setTag).toHaveBeenCalledWith("foo", "bar")
  })

  it("scrubs cookie and authorization request headers in beforeSend", async () => {
    process.env.SENTRY_DSN = "https://fake-dsn@sentry.io/1"
    ;(process.env as Record<string, string | undefined>).NODE_ENV = "production"

    const { sentry } = await import("@/lib/sentry")

    sentry.captureException(new Error("test-pii"))
    expect(mocks.init).toHaveBeenCalled()

    const initCall = mocks.init.mock.calls[0]
    expect(initCall).toBeDefined()
    const options = initCall![0]
    expect(options).toBeDefined()
    expect(typeof options.beforeSend).toBe("function")

    const beforeSend = options.beforeSend

    // Test header scrubbing
    const mockEvent = {
      request: {
        headers: {
          cookie: "session-secret-id",
          authorization: "Bearer token123",
          accept: "application/json",
          "user-agent": "Mozilla",
        },
      },
    }

    const result = beforeSend(mockEvent)
    expect(result.request.headers).toEqual({
      accept: "application/json",
      "user-agent": "Mozilla",
    })

    // Test with no request/headers
    const emptyEvent = {}
    expect(beforeSend(emptyEvent)).toEqual({})
  })
})
