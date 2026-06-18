/**
 * Audit S-07: regression tests for encodeContentDisposition.
 *
 * Guards the RFC 6266 + RFC 5987 header builder against header injection
 * (CR/LF, quotes) and verifies Unicode filenames round-trip via filename*.
 */
import { describe, expect, it } from "vitest"
import { encodeContentDisposition } from "@/lib/utils"

describe("encodeContentDisposition", () => {
  it("defaults to inline disposition", () => {
    expect(encodeContentDisposition("a.pdf")).toMatch(/^inline; /)
  })

  it("honours the attachment disposition", () => {
    expect(encodeContentDisposition("a.pdf", "attachment")).toMatch(/^attachment; /)
  })

  it("percent-encodes accented (UTF-8) filenames in filename*", () => {
    const header = encodeContentDisposition("café ñandú.pdf")
    expect(header).toContain("filename*=UTF-8''caf%C3%A9%20%C3%B1and%C3%BA.pdf")
  })

  it("neutralises CR/LF and other control chars in the ASCII fallback (no header injection)", () => {
    const header = encodeContentDisposition("evil\r\nSet-Cookie: x=1.pdf")
    // The ASCII filename must not contain raw CR or LF.
    expect(header).not.toMatch(/[\r\n]/)
    const asciiPart = header.match(/filename="([^"]*)"/)?.[1] ?? ""
    expect(asciiPart).not.toMatch(/[\r\n]/)
  })

  it("escapes double quotes and backslashes in the ASCII fallback", () => {
    const header = encodeContentDisposition('a"b\\c.pdf')
    const asciiPart = header.match(/filename="([^"]*)"/)?.[1] ?? ""
    expect(asciiPart).not.toContain('"')
    expect(asciiPart).not.toContain("\\")
    // The exact original is still recoverable from filename*.
    expect(header).toContain(`filename*=UTF-8''${encodeURIComponent('a"b\\c.pdf')}`)
  })

  it("always emits both filename and filename* parameters", () => {
    const header = encodeContentDisposition("documento.xlsx", "attachment")
    expect(header).toContain('filename="documento.xlsx"')
    expect(header).toContain("filename*=UTF-8''documento.xlsx")
  })
})
