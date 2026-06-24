import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

describe("lib/env.ts", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("validateEnv throws error when REQUIRED variables are missing", async () => {
    process.env.AUTH_SECRET = ""
    process.env.DATABASE_URL = ""

    const { validateEnv } = await import("../env")
    expect(() => validateEnv()).toThrowError("[env] Variables requeridas no configuradas")
  })

  it("validateEnv passes when REQUIRED variables are present", async () => {
    process.env.AUTH_SECRET = "secret"
    process.env.DATABASE_URL = "postgres://..."

    const { validateEnv } = await import("../env")
    expect(() => validateEnv()).not.toThrow()
  })

  it("exports env values correctly with defaults", async () => {
    process.env.AUTH_SECRET = "mysecret"
    process.env.DATABASE_URL = "mydburl"
    process.env.TAX_RATE = "0.22"
    delete process.env.APP_URL
    delete process.env.RESEND_API_KEY
    delete process.env.STORAGE_PATH
    delete process.env.SENTRY_DSN

    const { env } = await import("../env")
    expect(env.authSecret).toBe("mysecret")
    expect(env.databaseUrl).toBe("mydburl")
    expect(env.taxRate).toBe(0.22)
    expect(env.appUrl).toBeNull()
  })
})
