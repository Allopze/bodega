import { describe, expect, it } from "vitest"
import { createCspHeader } from "@/lib/security/csp"

describe("createCspHeader (audit S-09)", () => {
  it("includes the nonce and same-origin scripts in production without unsafe script sources", () => {
    const csp = createCspHeader("abc123nonce", { isDev: false })
    expect(csp).toContain("script-src 'self' 'nonce-abc123nonce'")
    // 'unsafe-inline' still appears in style-src-* directives, so scope the
    // check to the script-src portion only.
    const scriptSrc = csp.split(";").find((p) => p.trim().startsWith("script-src"))
    expect(scriptSrc).not.toContain("'unsafe-inline'")
    expect(scriptSrc).not.toContain("'unsafe-eval'")
    expect(scriptSrc).not.toContain("'strict-dynamic'")
  })

  it("uses 'unsafe-inline' + 'unsafe-eval' in development (not 'strict-dynamic')", () => {
    const csp = createCspHeader("nonce", { isDev: true })
    expect(csp).toContain("'unsafe-inline'")
    expect(csp).toContain("'unsafe-eval'")
    // strict-dynamic would ignore 'self' in Chrome — dev needs self-based
    // script loading for Turbopack chunks that don't carry the nonce.
    expect(csp).not.toContain("'strict-dynamic'")
  })

  it("does NOT include 'unsafe-eval' in production", () => {
    const csp = createCspHeader("nonce", { isDev: false })
    expect(csp).not.toContain("'unsafe-eval'")
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

  it("allows WebSocket (ws://, wss://) in development for HMR", () => {
    const csp = createCspHeader("nonce", { isDev: true })
    expect(csp).toContain("connect-src 'self' ws: wss:")
  })

  it("restricts connect-src to 'self' in production (no WebSocket)", () => {
    const csp = createCspHeader("nonce", { isDev: false })
    expect(csp).toContain("connect-src 'self'")
    expect(csp).not.toContain("ws:")
    expect(csp).not.toContain("wss:")
  })

})
