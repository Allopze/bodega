import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { pgliteTemplatePath, readPgliteTemplate } from "@/lib/testing/pglite-template"

const created: string[] = []

function migrationsFolder(sql: string): string {
  const folder = mkdtempSync(path.join(os.tmpdir(), "pglite-template-"))
  created.push(folder)
  mkdirSync(path.join(folder, "meta"), { recursive: true })
  writeFileSync(
    path.join(folder, "meta", "_journal.json"),
    JSON.stringify({ entries: [{ idx: 0, tag: "0000_primera" }] }),
  )
  writeFileSync(path.join(folder, "0000_primera.sql"), sql)
  return folder
}

afterEach(() => {
  for (const folder of created.splice(0)) rmSync(folder, { recursive: true, force: true })
})

/**
 * La plantilla cacheada es un esquema completo: si la huella no cambiara con
 * una migración nueva, las suites correrían contra el esquema viejo y el
 * failure aparecería lejos de la causa. Vive en `tests/` —y no en el proyecto
 * PGlite— porque para probar la invalidación no hace falta instanciar Postgres.
 */
describe("pglite template cache", () => {
  it("uses the same path while the migrations do not change", () => {
    const folder = migrationsFolder("CREATE TABLE uno (id int);")
    expect(pgliteTemplatePath(folder)).toBe(pgliteTemplatePath(folder))
  })

  it("invalidates the path when a migration's SQL changes", () => {
    const first = pgliteTemplatePath(migrationsFolder("CREATE TABLE uno (id int);"))
    const second = pgliteTemplatePath(migrationsFolder("CREATE TABLE uno (id bigint);"))
    expect(second).not.toBe(first)
  })

  it("returns null when the template has not been built yet", () => {
    expect(readPgliteTemplate(migrationsFolder("CREATE TABLE uno (id int);"))).toBeNull()
  })
})
