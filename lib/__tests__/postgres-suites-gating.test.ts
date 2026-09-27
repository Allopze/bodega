import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Las suites `*-postgres.test.ts` usan `describe.skip` cuando les falta su
 * base: sin variables se saltan EN VERDE. Ya pasó que una suite nunca corrió
 * en CI sin que nadie lo notara (PURCHASE_ORDERS_CONCURRENCY_*,
 * PREVENTION_CONCURRENCY_*), y al escribir esta prueba (2026-09-27) cinco más
 * estaban en esa situación: cuatro matcheadas por un glob de ci.yml sin sus
 * variables y una fuera de todo glob.
 *
 * Esta prueba fija las dos mitades del contrato:
 * 1. cada suite se habilita con el par `<P>_DATABASE_URL` +
 *    `<P>_ALLOW_DESTRUCTIVE_RESET` y pasa `<P>` como `context` al guard;
 * 2. algún paso de `.github/workflows/ci.yml` la incluye en su comando y
 *    define las dos variables.
 */
const root = process.cwd()
const suitesDir = path.join(root, "lib/__tests__")
const suites = readdirSync(suitesDir).filter((name) => name.endsWith("-postgres.test.ts")).sort()

function prefixOf(source: string): string | null {
  return /process\.env\.([A-Z0-9_]+)_DATABASE_URL/.exec(source)?.[1] ?? null
}

type CiStep = { name: string; env: Set<string>; patterns: RegExp[] }

function ciSteps(): CiStep[] {
  const yml = readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8")
  return yml.split(/\n\s*- name: /).slice(1).map((chunk) => {
    const name = chunk.split("\n", 1)[0]!.trim()
    const env = new Set([...chunk.matchAll(/^\s+([A-Z0-9_]+):/gm)].map((match) => match[1]!))
    const runLine = /^\s+run: (.+)$/m.exec(chunk)?.[1] ?? ""
    const patterns = [...runLine.matchAll(/lib\/__tests__\/\S+\.test\.ts/g)].map((match) =>
      new RegExp(`^${match[0].replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`))
    return { name, env, patterns }
  })
}

describe("suites *-postgres: habilitación y cobertura en CI", () => {
  it("hay suites que revisar", () => {
    expect(suites.length).toBeGreaterThan(0)
  })

  it.each(suites)("%s se habilita con <P>_DATABASE_URL + <P>_ALLOW_DESTRUCTIVE_RESET", (suite) => {
    const source = readFileSync(path.join(suitesDir, suite), "utf8")
    const prefix = prefixOf(source)
    expect(prefix, "sin process.env.<P>_DATABASE_URL").not.toBeNull()
    expect(source).toContain(`process.env.${prefix}_ALLOW_DESTRUCTIVE_RESET`)
    expect(source).toMatch(new RegExp(`context:\\s*"${prefix}"`))
  })

  it.each(suites)("%s corre en algún paso de CI con sus dos variables", (suite) => {
    const prefix = prefixOf(readFileSync(path.join(suitesDir, suite), "utf8"))!
    const file = `lib/__tests__/${suite}`
    const steps = ciSteps().filter((step) => step.patterns.some((pattern) => pattern.test(file)))
    expect(steps.map((step) => step.name), `ningún paso de ci.yml incluye ${file}`).not.toEqual([])
    const armed = steps.filter((step) =>
      step.env.has(`${prefix}_DATABASE_URL`) && step.env.has(`${prefix}_ALLOW_DESTRUCTIVE_RESET`))
    expect(armed.map((step) => step.name), `el paso que la incluye no define ${prefix}_DATABASE_URL y ${prefix}_ALLOW_DESTRUCTIVE_RESET: se saltaría en verde`).not.toEqual([])
  })
})
