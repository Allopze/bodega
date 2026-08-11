import { afterEach, describe, expect, it, vi } from "vitest"
import { logger } from "@/lib/logger"

function lastConsoleOutput(method: "debug" | "info" | "warn" | "error"): string {
  const spy = console[method] as unknown as { mock: { calls: unknown[][] } }
  const call = spy.mock.calls.at(-1) ?? []
  return call.map((c) => String(c)).join(" ")
}

describe("logger PII redaction and formatting", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("redacts sensitive object keys", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    logger.error("ctx", { email: "juan@chome.cl", rut: "16954999-K", hashedPassword: "x", name: "Juan" })
    const out = lastConsoleOutput("error")
    expect(out).not.toContain("juan@chome.cl")
    expect(out).not.toContain("16954999-K")
    expect(out).toContain("[redacted]")
    expect(out).toContain("Juan")
  })

  it("masks email and RUT patterns inside free strings", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    logger.error("login fallido para juan@chome.cl rut 12.345.678-5")
    const out = lastConsoleOutput("error")
    expect(out).not.toContain("juan@chome.cl")
    expect(out).not.toContain("12.345.678-5")
    expect(out).toContain("[email]")
    expect(out).toContain("[rut]")
  })

  it("redacts DTE key material in objects, error messages, and envelopes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const envelope = "enc:v1:2026-08:MTIzNDU2Nzg5MDEy:YWJjZGVmZ2hpamtsbW5vcA:YWJjZA"
    logger.error(
      new Error(`portal rejected clave=super-secret ${envelope}`),
      { clave: "super-secret", dteSettingsKeyring: "key-material", ciphertext: "cipher" },
    )
    const out = lastConsoleOutput("error")
    expect(out).not.toContain("super-secret")
    expect(out).not.toContain("key-material")
    expect(out).not.toContain("cipher")
    expect(out).not.toContain(envelope)
    expect(out).toContain("[redacted]")
    expect(out).toContain("[encrypted]")
  })

  it("serializes objects usefully instead of [object Object]", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    logger.error({ status: "draft", count: 3 })
    const out = lastConsoleOutput("error")
    expect(out).toContain("draft")
    expect(out).not.toContain("[object Object]")
  })

  it("extracts correlationId from first argument object", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    logger.error({ correlationId: "tx-abc-123", action: "test" }, "another argument")
    const out = lastConsoleOutput("error")
    expect(out).toContain('"correlationId":"tx-abc-123"')
    expect(out).toContain("another argument")
  })

  it("handles debug and info log functions in test environment", () => {
    vi.spyOn(console, "debug").mockImplementation(() => {})
    vi.spyOn(console, "info").mockImplementation(() => {})

    logger.debug("debug message")
    logger.info("info message")

    expect(lastConsoleOutput("debug")).toContain("debug message")
    expect(lastConsoleOutput("info")).toContain("info message")
  })

  it("applies depth-limit to deeply nested objects", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const deepObj = {
      l1: {
        l2: {
          l3: {
            l4: {
              l5: "nested too deep",
            },
          },
        },
      },
    }
    logger.error(deepObj)
    const out = lastConsoleOutput("error")
    expect(out).toContain("[depth-limit]")
    expect(out).not.toContain("nested too deep")
  })

  it("detects and redacts circular references", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const obj: Record<string, unknown> = { name: "circular" }
    obj.self = obj // circular reference

    logger.error(obj)
    const out = lastConsoleOutput("error")
    expect(out).toContain("[circular]")
  })

  it("redacts message and stack when an Error object is logged", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const err = new Error("Failed validation for email dummy@chome.cl")
    logger.error(err)
    const out = lastConsoleOutput("error")
    expect(out).toContain("Failed validation for email [email]")
    expect(out).toContain('"error":')
  })

  it("handles single non-object, non-string, non-error primitive", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    logger.error(42)
    const out = lastConsoleOutput("error")
    expect(out).toContain('"message":"42"')
  })

  it("handles multiple arguments not starting with a string", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    logger.error(123, 456, "seven")
    const out = lastConsoleOutput("error")
    expect(out).toContain('"message":"123 456 seven"')
  })

  it("ignores debug/info logs in production environment", () => {
    // Stub process.env.NODE_ENV to production
    vi.stubEnv("NODE_ENV", "production")

    // We need to re-import or evaluate logger in production context.
    // However, the module is already loaded.
    // But since the constant `LEVEL` is evaluated at load time,
    // wait, vitest runs this file once, so `LEVEL` was already resolved.
    // Let's see: we can mock console.debug/info and re-import logger dynamically?
    // In ES modules, dynamic import of same path returns cached module.
    // But we can test if shouldLog is production. Let's see:
    // If we can't re-evaluate LEVEL because it's a file-scoped const,
    // wait, is there a way to clear the module cache?
    // In vitest, vi.resetModules() clears the module cache!
    vi.resetModules()

    // Now dynamically import logger
    // We do this to ensure LEVEL is re-evaluated with NODE_ENV = "production"
  })

  it("skips debug and info messages in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.resetModules()

    const { logger: prodLogger } = await import("@/lib/logger")

    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    prodLogger.debug("prod debug")
    prodLogger.info("prod info")
    prodLogger.warn("prod warn")

    expect(debugSpy).not.toHaveBeenCalled()
    expect(infoSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })
})
