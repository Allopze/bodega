import { describe, expect, it } from "vitest"
import { createCspHeader } from "@/lib/security/csp"

describe("createCspHeader (audit S-09)", () => {
  it("includes the nonce in script-src", () => {
    const csp = createCspHeader("abc123nonce", { isDev: false })
    expect(csp).toContain("script-src 'self' 'nonce-abc123nonce' 'strict-dynamic'")
  })

  it("does NOT include 'unsafe-eval' in production", () => {
    const csp = createCspHeader("nonce", { isDev: false })
    expect(csp).not.toContain("'unsafe-eval'")
  })

  it("includes 'unsafe-eval' in development", () => {
    const csp = createCspHeader("nonce", { isDev: true })
    expect(csp).toContain("'unsafe-eval'")
  })

  it("splits style-src into style-src-elem and style-src-attr (S-09)", () => {
    const csp = createCspHeader("nonce", { isDev: false })
    expect(csp).toContain("style-src-elem 'self' 'unsafe-inline'")
    expect(csp).toContain("style-src-attr 'unsafe-inline'")
    // Must NOT contain the old combined directive
    expect(csp).not.toMatch(/style-src 'self' 'unsafe-inline'/)
  })

  it("forbids framing and objects", () => {
    const csp = createCspHeader("nonce", { isDev: false })
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("form-action 'self'")
  })

  it("uses default-src 'self' as a baseline", () => {
    const csp = createCspHeader("nonce", { isDev: false })
    expect(csp).toMatch(/^default-src 'self'/)
  })
})
