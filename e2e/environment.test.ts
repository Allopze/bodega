import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { resolveE2eDatabaseUrl } from "./environment"

describe("resolveE2eDatabaseUrl", () => {
  it("requires an explicit E2E database and never falls back to DATABASE_URL", () => {
    expect(resolveE2eDatabaseUrl({ DATABASE_URL: "postgres:///bodega" })).toBeUndefined()
    expect(resolveE2eDatabaseUrl({ E2E_DATABASE_URL: "  postgres:///bodega_e2e  " })).toBe("postgres:///bodega_e2e")
  })
})

describe("recolección de Playwright", () => {
  // Este mismo archivo rompió la suite: vive en `testDir` y Playwright muere al
  // importar Vitest desde CommonJS, terminando con "0 tests in 0 files" y
  // salida 0 — CI quedaba verde sin ejecutar un solo escenario. El filtro es la
  // única defensa, así que se verifica aquí.
  it("sólo recoge archivos .spec.ts, nunca las pruebas unitarias del harness", () => {
    const config = fs.readFileSync(path.join(process.cwd(), "playwright.config.ts"), "utf8")
    expect(config).toContain('testMatch: "**/*.spec.ts"')
    expect(fs.readdirSync(path.join(process.cwd(), "e2e")).some((file) => file.endsWith(".test.ts"))).toBe(true)
  })
})
