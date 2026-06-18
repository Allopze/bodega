/**
 * Audit S-14: the logger must keep PII (RUT, email, passwords, tokens) out
 * of stdout/stderr so it never leaks to an external log sink.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { logger } from "@/lib/logger"

function lastErrorOutput(): string {
  const spy = console.error as unknown as { mock: { calls: unknown[][] } }
  const call = spy.mock.calls.at(-1) ?? []
  return call.map((c) => String(c)).join(" ")
}

describe("logger PII redaction", () => {
  afterEach(() => vi.restoreAllMocks())

  it("redacts sensitive object keys", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    logger.error("ctx", { email: "juan@chome.cl", rut: "16954999-K", hashedPassword: "x", name: "Juan" })
    const out = lastErrorOutput()
    expect(out).not.toContain("juan@chome.cl")
    expect(out).not.toContain("16954999-K")
    expect(out).toContain("[redacted]")
    // non-sensitive keys survive
    expect(out).toContain("Juan")
  })

  it("masks email and RUT patterns inside free strings", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    logger.error("login fallido para juan@chome.cl rut 12.345.678-5")
    const out = lastErrorOutput()
    expect(out).not.toContain("juan@chome.cl")
    expect(out).not.toContain("12.345.678-5")
    expect(out).toContain("[email]")
    expect(out).toContain("[rut]")
  })

  it("serializes objects usefully instead of [object Object]", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    logger.error({ status: "draft", count: 3 })
    const out = lastErrorOutput()
    expect(out).toContain("draft")
    expect(out).not.toContain("[object Object]")
  })
})
