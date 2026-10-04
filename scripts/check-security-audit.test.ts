import { describe, expect, it } from "vitest"
import {
  findPackagePaths,
  type AuditAllowlistEntry,
  findExpiredAllowlistEntries,
  findStaleAllowlistEntries,
  findUncoveredFindings,
  resolveGhsaIds,
} from "./check-security-audit"

// Fixtures propias: el allowlist real puede quedar vacío, así
// que las pruebas de la lógica no pueden depender de sus entradas.
const braceExpansionId = "GHSA-mh99-v99m-4gvg"
const sharpId = "GHSA-f88m-g3jw-g9cj"
const allowlist: readonly AuditAllowlistEntry[] = [
  { ghsaId: braceExpansionId, reason: "fixture", reviewBy: "2026-10-28" },
  { ghsaId: sharpId, reason: "fixture", reviewBy: "2026-11-07" },
]

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
    expect(findUncoveredFindings(report, allowlist)).toEqual([])
  })

  it("flags a high finding tied to an advisory that isn't allowlisted", () => {
    const report = {
      vulnerabilities: {
        "some-lib": { severity: "high", range: ">=1.0.0", via: [{ url: "https://github.com/advisories/GHSA-new-new-newx" }] },
      },
    }
    const problems = findUncoveredFindings(report, allowlist)
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
    const problems = findUncoveredFindings(report, allowlist)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("crítica")
  })

  it("ignores moderate/low findings", () => {
    const report = { vulnerabilities: { "some-lib": { severity: "moderate", via: [] } } }
    expect(findUncoveredFindings(report, allowlist)).toEqual([])
  })

  it("flags every high finding when the allowlist is empty", () => {
    const report = {
      vulnerabilities: {
        sharp: { severity: "high", via: [{ url: `https://github.com/advisories/${sharpId}` }] },
      },
    }
    expect(findUncoveredFindings(report, [])).toHaveLength(1)
  })
})

describe("findStaleAllowlistEntries", () => {
  it("flags entries whose advisory no longer appears in npm audit", () => {
    // El caso del 2026-09-27: npm audit ya no reportaba nada y las cuatro
    // entradas seguían vigentes, justificando riesgos que habían desaparecido.
    expect(findStaleAllowlistEntries({ vulnerabilities: {} }, allowlist).map((entry) => entry.ghsaId))
      .toEqual([braceExpansionId, sharpId])
  })

  it("keeps entries still reachable from a high finding, directly or through a chain", () => {
    const report = {
      vulnerabilities: {
        "brace-expansion": { severity: "high", via: [{ url: `https://github.com/advisories/${braceExpansionId}` }] },
        exceljs: { severity: "high", via: ["brace-expansion"] },
      },
    }
    expect(findStaleAllowlistEntries(report, allowlist).map((entry) => entry.ghsaId)).toEqual([sharpId])
  })

  it("treats an advisory only seen at moderate severity as stale (the allowlist covers high findings)", () => {
    const report = {
      vulnerabilities: {
        sharp: { severity: "moderate", via: [{ url: `https://github.com/advisories/${sharpId}` }] },
      },
    }
    expect(findStaleAllowlistEntries(report, allowlist).map((entry) => entry.ghsaId)).toContain(sharpId)
  })
})

describe("findExpiredAllowlistEntries", () => {
  it("returns nothing before any reviewBy date", () => {
    expect(findExpiredAllowlistEntries("2000-01-01", allowlist)).toEqual([])
  })

  it("flags entries whose reviewBy date has passed", () => {
    expect(findExpiredAllowlistEntries("2026-11-01", allowlist).map((entry) => entry.ghsaId)).toEqual([braceExpansionId])
    expect(findExpiredAllowlistEntries("2999-01-01", allowlist)).toHaveLength(allowlist.length)
  })
})

describe("findPackagePaths (guardrail de GHSA-vfj7-8cjw-p6xm)", () => {
  it("encuentra el paquete en cualquier profundidad y nombra la ruta", () => {
    const tree = { dependencies: { "eslint-config-next": { dependencies: { "fast-glob": { dependencies: { micromatch: { dependencies: { braces: {} } } } } } } } }
    expect(findPackagePaths(tree, "braces")).toEqual(["eslint-config-next → fast-glob → micromatch → braces"])
  })

  it("devuelve vacío cuando el árbol de producción no lo contiene", () => {
    expect(findPackagePaths({ dependencies: { next: { dependencies: { react: {} } } } }, "braces")).toEqual([])
    expect(findPackagePaths({}, "braces")).toEqual([])
  })
})
