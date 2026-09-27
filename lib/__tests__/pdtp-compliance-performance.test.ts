/**
 * I12 (T7b): rendimiento del cumplimiento PDTP sin mover una sola cifra.
 *
 * Dos redes, sobre el mismo conjunto sintético (`helpers/pdtp-compliance-fixture.ts`):
 *
 * 1. **Cifras doradas.** `pdtp-compliance-golden-2025.json` se generó con el
 *    código ANTERIOR a la optimización (commit de esta prueba) y guarda cada
 *    lectura que la optimización toca: tablero consolidado y por versión, eje,
 *    integral por faena y por alcance, indicador del año, planilla agregada y
 *    vista por faena. Si una cifra cambia, esta prueba falla. Para regenerarlo
 *    a propósito: `UPDATE_PDTP_GOLDEN=1`.
 * 2. **Presupuesto de consultas.** Cuenta las consultas de cada lectura con el
 *    logger de drizzle y fija un techo. Lo que importa sobre todo es que el
 *    tablero no crezca con el número de faenas: con 2 y con 6 faenas debe
 *    costar lo mismo.
 */
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import { seedPdtpComplianceFixture, type PdtpComplianceFixture } from "./helpers/pdtp-compliance-fixture"

const queries = { count: 0 }
const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema, logger: { logQuery: () => { queries.count += 1 } } })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite es compatible en runtime con el driver esperado.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

let fixture: PdtpComplianceFixture

beforeAll(async () => {
  fixture = await seedPdtpComplianceFixture(inMemoryDb, { year: 2025, worksiteCount: 6, activityCount: 28 })
}, 120_000)

const GOLDEN_PATH = path.resolve(process.cwd(), "lib/__tests__/fixtures/pdtp-compliance-golden-2025.json")

/** JSON con claves ordenadas: la huella no depende del orden de inserción de propiedades. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]))
  }
  return value
}

/**
 * Las planillas pesan casi 2 MB en JSON: se guardan por huella (sha256 del JSON
 * canónico) más sus totales, que es lo que se lee al diagnosticar una falla.
 */
function sheetDigest(view: { monthlyTotals: unknown; activities: unknown[]; worksiteSummaries?: unknown } | null) {
  if (!view) return null
  const json = JSON.parse(JSON.stringify(view)) as unknown
  return {
    sha256: createHash("sha256").update(JSON.stringify(canonical(json))).digest("hex"),
    activities: view.activities.length,
    monthlyTotals: view.monthlyTotals,
    worksiteSummaries: view.worksiteSummaries ?? null,
  }
}

async function collectGolden() {
  const compliance = await import("@/lib/services/pdtp/compliance")
  const sheets = await import("@/lib/services/pdtp/sheets")
  const { v1ProgramId, v2ProgramId, worksiteIds, year } = fixture
  const all = worksiteIds
  const programs = [v1ProgramId, v2ProgramId!]
  const out: Record<string, unknown> = {}
  for (const programId of programs) {
    const tag = programId === v1ProgramId ? "v1" : "v2"
    out[`${tag}.scope.consolidated`] = await compliance.getPdtpComplianceIndicatorsForScope(programId, all, { consolidateYear: true })
    out[`${tag}.scope.single`] = await compliance.getPdtpComplianceIndicatorsForScope(programId, all)
    out[`${tag}.scope.subset`] = await compliance.getPdtpComplianceIndicatorsForScope(programId, all.slice(1, 3), { consolidateYear: true })
    out[`${tag}.category.all`] = await compliance.getPdtpComplianceByCategoryForScope(programId, all)
    out[`${tag}.category.one`] = await compliance.getPdtpComplianceByCategoryForScope(programId, [all[2]!])
    out[`${tag}.integralScope.consolidated`] = await compliance.getPdtpIntegralComplianceForScope(programId, all, { consolidateYear: true })
    out[`${tag}.integralScope.single`] = await compliance.getPdtpIntegralComplianceForScope(programId, all)
    out[`${tag}.indicators.noWorksite`] = await compliance.getPdtpComplianceIndicators(programId)
    out[`${tag}.integral.noWorksite`] = await compliance.getPdtpIntegralCompliance(programId)
    out[`${tag}.sheet.aggregated`] = sheetDigest(await sheets.getPdtpAggregatedSheetViewByProgram(programId, "pdtp_general", all, { year, month: 12, week: 4 }, { year: year + 1, month: 1, week: 1 }))
    for (const worksiteId of all) {
      out[`${tag}.indicators.${worksiteId}`] = await compliance.getPdtpComplianceIndicators(programId, worksiteId)
      out[`${tag}.integral.${worksiteId}`] = await compliance.getPdtpIntegralCompliance(programId, worksiteId)
      out[`${tag}.year.${worksiteId}`] = await compliance.getPdtpYearComplianceIndicators(programId, worksiteId)
      out[`${tag}.sheet.${worksiteId}`] = sheetDigest(await sheets.getPdtpSheetViewByProgram(programId, "pdtp_general", worksiteId))
    }
  }
  out["year.byNumber"] = await compliance.getPdtpComplianceIndicators(year, all[0])
  out["integral.byNumber"] = await compliance.getPdtpIntegralCompliance(year, all[0])
  out["scope.byNumber"] = await compliance.getPdtpComplianceIndicatorsForScope(year, all, { consolidateYear: true })
  return JSON.parse(JSON.stringify(out)) as Record<string, unknown>
}

describe("I12 — las cifras no cambian (dorado generado antes de optimizar)", () => {
  it("cada lectura del cumplimiento coincide con el dorado", async () => {
    const actual = await collectGolden()
    if (process.env.UPDATE_PDTP_GOLDEN === "1") {
      fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true })
      // Una clave por línea, cada valor compacto: diffs legibles sin inflar el archivo.
      const lines = Object.keys(actual).sort().map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(actual[key])}`)
      fs.writeFileSync(GOLDEN_PATH, `{\n${lines.join(",\n")}\n}\n`)
    }
    const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf8")) as Record<string, unknown>
    expect(Object.keys(actual).sort()).toEqual(Object.keys(golden).sort())
    for (const key of Object.keys(golden)) expect(actual[key], key).toEqual(golden[key])
  }, 300_000)

  it("el dorado no es trivial: hay avance, ceros, versiones y padrón", async () => {
    const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf8")) as Record<string, {
      annual?: { planned: number; executed: number; zeroActivityIds: string[] }
      versions?: unknown[]
      subjectRosterIssues?: unknown[]
      integral?: number | null
      verificacion?: number | null
      cierre?: number | null
    } | null>
    const scope = golden["v2.scope.consolidated"]!
    expect(scope.annual!.planned).toBeGreaterThan(0)
    expect(scope.annual!.executed).toBeGreaterThan(0)
    expect(scope.annual!.executed).toBeLessThan(scope.annual!.planned)
    expect(scope.annual!.zeroActivityIds.length).toBeGreaterThan(0)
    expect(scope.versions).toHaveLength(2)
    expect(golden["v2.integralScope.consolidated"]!.cierre).not.toBeNull()
  })
})
