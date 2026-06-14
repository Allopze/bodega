import { readdirSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const repoRoot = process.cwd()

describe("frozen modular migration", () => {
  it("keeps only live module registry and manifest files", () => {
    const files = collectFiles(path.join(repoRoot, "modules"))
      .map((file) => path.relative(repoRoot, file).replaceAll(path.sep, "/"))

    const staleFiles = files.filter((file) => {
      if (file === "modules/README.md") return false
      if (file === "modules/manifest-types.ts") return false
      if (file === "modules/permissions.ts") return false
      if (file === "modules/registry.ts") return false
      return !/^modules\/[^/]+\/manifest\.ts$/.test(file)
    })

    expect(staleFiles).toEqual([])
  })

  it("does not keep the frozen core facade tree", () => {
    const corePath = path.join(repoRoot, "core")
    const coreFiles = exists(corePath)
      ? collectFiles(corePath).map((file) => path.relative(repoRoot, file).replaceAll(path.sep, "/"))
      : []

    expect(coreFiles).toEqual([])
  })
})

function collectFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const file = path.join(dir, entry)
    return statSync(file).isDirectory() ? collectFiles(file) : [file]
  })
}

function exists(file: string): boolean {
  try {
    statSync(file)
    return true
  } catch {
    return false
  }
}
