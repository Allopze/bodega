/**
 * Guardián del registro de suites PGlite (PREV-M08).
 *
 * Una suite que instancia PGlite (el constructor de `@electric-sql/pglite`) y no está en `tests/pglite-files.ts`
 * corre en el proyecto paralelo: migra una base completa por archivo en tres
 * workers a la vez, satura la CPU y, peor, queda fuera de `npm run test:pglite`
 * —que es la puerta que se mira para lo que toca base—. La auditoría del
 * 2026-09-26 encontró dos así en Prevención (`prevention-campaigns`,
 * `prevention-incidents-re20`); el barrido de T4 encontró siete en total.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { pgliteTestFiles } from "./pglite-files"

const root = path.resolve(__dirname, "..")
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".claude", ".tmp", "coverage", "playwright-report", "test-results"])

function testFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) testFiles(path.join(dir, entry.name), found)
    } else if (/\.test\.tsx?$/.test(entry.name)) {
      found.push(path.relative(root, path.join(dir, entry.name)).split(path.sep).join("/"))
    }
  }
  return found
}

describe("tests/pglite-files.ts", () => {
  it("registra toda suite que instancia PGlite", () => {
    const registered = new Set(pgliteTestFiles)
    const self = path.relative(root, __filename).split(path.sep).join("/")
    const unregistered = testFiles(root)
      .filter((file) => file !== self)
      .filter((file) => /new PGlite\(/.test(readFileSync(path.join(root, file), "utf8")))
      .filter((file) => !registered.has(file))
    expect(unregistered).toEqual([])
  })

  it("no registra archivos que ya no existen", () => {
    expect(pgliteTestFiles.filter((file) => !existsSync(path.join(root, file)))).toEqual([])
  })

  it("no registra un archivo dos veces", () => {
    expect(pgliteTestFiles.filter((file, index) => pgliteTestFiles.indexOf(file) !== index)).toEqual([])
  })
})
