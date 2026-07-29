import { describe, expect, it } from "vitest"
import {
  AUDIT_ALLOWLIST,
  findExpiredAllowlistEntries,
  findStreamingWorkbookWriterUsage,
  findUncoveredFindings,
  hasRemoteImagePatterns,
  resolveGhsaIds,
} from "./check-security-audit"

const braceExpansionId = AUDIT_ALLOWLIST[0].ghsaId
const sharpId = AUDIT_ALLOWLIST[1].ghsaId

describe("resolveGhsaIds", () => {
  it("resolves a direct advisory", () => {
    const vulnerabilities = {
      "brace-expansion": {
        severity: "high",
        via: [{ url: `https://github.com/advisories/${braceExpansionId}` }],
      },
    }
    expect(resolveGhsaIds(vulnerabilities, "brace-expansion")).toEqual(new Set([braceExpansionId]))
  })

  it("resolves through a chain of string references", () => {
    const vulnerabilities = {
      "brace-expansion": { severity: "high", via: [{ url: `https://github.com/advisories/${braceExpansionId}` }] },
      minimatch: { severity: "high", via: ["brace-expansion"] },
      exceljs: { severity: "high", via: ["archiver"] },
      archiver: { severity: "high", via: ["minimatch"] },
    }
    expect(resolveGhsaIds(vulnerabilities, "exceljs")).toEqual(new Set([braceExpansionId]))
  })

  it("returns an empty set for an unresolvable chain (no advisory reached)", () => {
    const vulnerabilities = { foo: { severity: "high", via: ["missing-package"] } }
    expect(resolveGhsaIds(vulnerabilities, "foo").size).toBe(0)
  })
})

describe("findUncoveredFindings", () => {
  it("passes when every high finding resolves to an allowlisted advisory", () => {
    const report = {
      vulnerabilities: {
        "brace-expansion": { severity: "high", via: [{ url: `https://github.com/advisories/${braceExpansionId}` }] },
        exceljs: { severity: "high", via: ["archiver"] },
        archiver: { severity: "high", via: ["brace-expansion"] },
        sharp: { severity: "high", via: [{ url: `https://github.com/advisories/${sharpId}` }] },
        next: { severity: "high", via: ["sharp"] },
      },
    }
    expect(findUncoveredFindings(report)).toEqual([])
  })

  it("flags a high finding tied to an advisory that isn't allowlisted", () => {
    const report = {
      vulnerabilities: {
        "some-lib": { severity: "high", range: ">=1.0.0", via: [{ url: "https://github.com/advisories/GHSA-new-new-newx" }] },
      },
    }
    const problems = findUncoveredFindings(report)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("some-lib")
    expect(problems[0]).toContain("GHSA-new-new-newx")
  })

  it("always flags critical severity, even with a matching advisory", () => {
    const report = {
      vulnerabilities: {
        "some-lib": { severity: "critical", via: [{ url: `https://github.com/advisories/${braceExpansionId}` }] },
      },
    }
    const problems = findUncoveredFindings(report)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("crítica")
  })

  it("ignores moderate/low findings", () => {
    const report = { vulnerabilities: { "some-lib": { severity: "moderate", via: [] } } }
    expect(findUncoveredFindings(report)).toEqual([])
  })
})

describe("hasRemoteImagePatterns", () => {
  it("detects remotePatterns", () => {
    expect(hasRemoteImagePatterns("images: { remotePatterns: [{ hostname: 'x.com' }] }")).toBe(true)
  })

  it("detects images.domains", () => {
    expect(hasRemoteImagePatterns("images: { domains: ['x.com'] }")).toBe(true)
  })

  it("does not flag configs without remote image sources", () => {
    expect(hasRemoteImagePatterns("images: { formats: ['image/webp'] }")).toBe(false)
  })
})

describe("findStreamingWorkbookWriterUsage", () => {
  it("does not flag its own source file, which documents WorkbookWriter by name", () => {
    // Regresión: una vez trackeado por git, este archivo aparecía en su propio
    // git grep porque su justificación menciona "WorkbookWriter" y "exceljs/lib/stream".
    expect(findStreamingWorkbookWriterUsage()).not.toContain("scripts/check-security-audit.ts")
  })
})

describe("findExpiredAllowlistEntries", () => {
  it("returns nothing before any reviewBy date", () => {
    expect(findExpiredAllowlistEntries("2000-01-01")).toEqual([])
  })

  it("flags entries whose reviewBy date has passed", () => {
    const expired = findExpiredAllowlistEntries("2999-01-01")
    expect(expired.length).toBe(AUDIT_ALLOWLIST.length)
  })
})
