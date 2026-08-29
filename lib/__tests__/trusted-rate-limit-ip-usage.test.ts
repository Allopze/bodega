import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const rateLimitedPublicSurfaces = [
  "lib/auth/auth.ts",
  "app/(auth)/registro/actions.ts",
  "app/(auth)/recuperar/actions.ts",
  "app/(public)/ppa/actions.ts",
  "app/api/tae/access/route.ts",
  "app/api/tae/identity/route.ts",
  "app/api/tae/submit/route.ts",
]

describe("identidad de IP para límites públicos", () => {
  it.each(rateLimitedPublicSurfaces)("no usa X-Forwarded-For en %s", (relativePath) => {
    const source = readFileSync(path.join(root, relativePath), "utf8")

    expect(source).toContain("resolveTrustedClientIp")
    expect(source).not.toContain('"x-forwarded-for"')
  })

  it("usa la identidad confiable también para la auditoría TAE", () => {
    const source = readFileSync(path.join(root, "app/api/tae/submit/route.ts"), "utf8")

    expect(source).toContain("const rateLimitIp = resolveTrustedClientIp(requestHeaders)")
    expect(source).toContain("const ipAddress = rateLimitIp")
    expect(source).toContain("tae:submit-volume:ip:${rateLimitIp}")
    expect(source).toContain("tae:submit:${rateLimitIp}")
    expect(source).toContain("createTaeSubmission({ accessToken, input: parsed.data, evidence, ipAddress, ocrResult })")
  })
})
