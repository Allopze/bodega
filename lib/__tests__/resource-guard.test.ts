import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const projectRoot = path.resolve(import.meta.dirname, "../..")
const guardPath = path.join(projectRoot, "scripts/run-resource-guard.sh")

describe("local resource guard", () => {
  it("keeps the conservative local defaults and safety controls", () => {
    const guard = readFileSync(guardPath, "utf8")

    expect(guard).toContain('BODEGA_MAX_WORKERS:-3')
    expect(guard).toContain('BODEGA_NODE_HEAP_MB:-4096')
    expect(guard).toContain('BODEGA_NICE_LEVEL:-10')
    expect(guard).toContain('BODEGA_OOM_SCORE_ADJ:-500')
    expect(guard).toContain('PLAYWRIGHT_WORKERS:-1')
    expect(guard).toContain("flock -n 9")
  })

  it("routes the primary heavy scripts through the guard", () => {
    const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>
    }

    for (const script of ["build", "lint", "typecheck", "test", "test:fast", "test:pglite", "test:e2e"]) {
      expect(packageJson.scripts[script], script).toContain("scripts/run-resource-guard.sh")
    }
  })
})
