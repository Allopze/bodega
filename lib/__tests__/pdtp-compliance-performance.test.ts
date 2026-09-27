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
    expect(scope.subjectRosterIssues!.length).toBeGreaterThan(0)
  })
})

/**
 * Techos sobre este conjunto (28 actividades por versión, dos versiones, seis
 * fuentes de padrón). Antes de I12 cada lectura por alcance crecía con las
 * faenas —con seis: tablero consolidado 408 consultas, eje 60, planilla
 * agregada 49, integral por alcance 515— y la ficha pedía indicador (35) e
 * integral (49) por separado. Después: 47, 14, 14 y 74 con cualquier número de
 * faenas, y la ficha 26. Sin `React.cache` (que fuera de un render no memoriza)
 * cada lectura base se cuenta todas las veces que se pide: en la aplicación
 * cuesta menos. Un techo que se rompe es una regresión de rendimiento, no un
 * número que se sube sin mirar.
 */
const BUDGET = {
  indicatorsForWorksite: 26,
  complianceWithIntegral: 30,
  yearForWorksite: 50,
  scopeConsolidated: 50,
  category: 14,
  aggregatedSheet: 14,
  integralScope: 80,
}

async function measure<T>(fn: () => Promise<T>): Promise<{ queries: number; result: T }> {
  queries.count = 0
  const result = await fn()
  return { queries: queries.count, result }
}

describe("I12 — padrón por lote", () => {
  it("cada fuente, faena y mes da lo mismo que la consulta individual", async () => {
    const { loadPdtpSubjectRosterBatch, resolvePdtpSubjectRoster, PDTP_SUBJECT_SOURCES } = await import("@/lib/services/pdtp/subject-registry")
    const codeSets = [["drives_vehicle"], ["DRIVES_VEHICLE", "drives_vehicle"], ["operates_equipment", "drives_vehicle"], [], null]
    const requests = [
      ...PDTP_SUBJECT_SOURCES.filter((source) => source !== "trabajadores_capacidad").map((source) => ({ source })),
      ...codeSets.map((capabilityCodes) => ({ source: "trabajadores_capacidad", capabilityCodes })),
    ]
    const batch = await measure(() => loadPdtpSubjectRosterBatch(requests, fixture.worksiteIds, fixture.year))
    // Una consulta por fuente de conteo y dos por conjunto de capacidades
    // distinto (`drives_vehicle` repetido cuenta una vez; vacío no consulta).
    expect(batch.queries).toBe(5 + 2 * 2)
    let compared = 0
    for (const worksiteId of fixture.worksiteIds) {
      for (const request of requests) {
        const months = request.source === "trabajadores_nuevos" ? Array.from({ length: 12 }, (_, index) => index + 1) : [1]
        for (const month of months) {
          const period = { year: fixture.year, month }
          const options = { capabilityCodes: "capabilityCodes" in request ? request.capabilityCodes : undefined }
          const single = await resolvePdtpSubjectRoster(request.source, worksiteId, period, options)
          const { members: _members, ...summary } = single ?? { members: [] }
          expect(batch.result.get(request.source, worksiteId, period, options), `${request.source} ${worksiteId} ${month}`)
            .toEqual(single ? summary : null)
          compared++
        }
      }
    }
    expect(compared).toBeGreaterThan(100)
    // Hay de todo: padrones resueltos, en cero y pendientes de clasificación.
    const statuses = new Set(fixture.worksiteIds.flatMap((worksiteId) => requests.map((request) =>
      batch.result.get(request.source, worksiteId, { year: fixture.year, month: 5 }, { capabilityCodes: "capabilityCodes" in request ? request.capabilityCodes : undefined })?.status)))
    expect(statuses).toEqual(new Set(["resolved", "pending_classification", "not_configured"]))
  })
})

describe("I12 — presupuesto de consultas", () => {
  const sheetPeriod = () => ({ year: fixture.year, month: 12, week: 4 })
  const sheetToday = () => ({ year: fixture.year + 1, month: 1, week: 1 })

  it("el tablero consolidado cuesta lo mismo con 2 que con 6 faenas", async () => {
    const { getPdtpComplianceIndicatorsForScope } = await import("@/lib/services/pdtp/compliance")
    const program = fixture.activeProgramId
    const two = await measure(() => getPdtpComplianceIndicatorsForScope(program, fixture.worksiteIds.slice(0, 2), { consolidateYear: true }))
    const six = await measure(() => getPdtpComplianceIndicatorsForScope(program, fixture.worksiteIds, { consolidateYear: true }))
    expect(six.queries).toBe(two.queries)
    expect(six.queries).toBeLessThanOrEqual(BUDGET.scopeConsolidated)
  })

  it("el avance por eje cuesta lo mismo con 2 que con 6 faenas (sin bucle secuencial)", async () => {
    const { getPdtpComplianceByCategoryForScope } = await import("@/lib/services/pdtp/compliance")
    const program = fixture.activeProgramId
    const two = await measure(() => getPdtpComplianceByCategoryForScope(program, fixture.worksiteIds.slice(0, 2)))
    const six = await measure(() => getPdtpComplianceByCategoryForScope(program, fixture.worksiteIds))
    expect(six.queries).toBe(two.queries)
    expect(six.queries).toBeLessThanOrEqual(BUDGET.category)
  })

  it("la planilla agregada cuesta lo mismo con 2 que con 6 faenas", async () => {
    const { getPdtpAggregatedSheetViewByProgram } = await import("@/lib/services/pdtp/sheets")
    const program = fixture.activeProgramId
    const two = await measure(() => getPdtpAggregatedSheetViewByProgram(program, "pdtp_general", fixture.worksiteIds.slice(0, 2), sheetPeriod(), sheetToday()))
    const six = await measure(() => getPdtpAggregatedSheetViewByProgram(program, "pdtp_general", fixture.worksiteIds, sheetPeriod(), sheetToday()))
    expect(six.queries).toBe(two.queries)
    expect(six.queries).toBeLessThanOrEqual(BUDGET.aggregatedSheet)
  })

  it("el integral por alcance cuesta lo mismo con 2 que con 6 faenas", async () => {
    const { getPdtpIntegralComplianceForScope } = await import("@/lib/services/pdtp/compliance")
    const program = fixture.activeProgramId
    const two = await measure(() => getPdtpIntegralComplianceForScope(program, fixture.worksiteIds.slice(0, 2), { consolidateYear: true }))
    const six = await measure(() => getPdtpIntegralComplianceForScope(program, fixture.worksiteIds, { consolidateYear: true }))
    expect(six.queries).toBe(two.queries)
    expect(six.queries).toBeLessThanOrEqual(BUDGET.integralScope)
  })

  it("la ficha obtiene indicador e integral de un solo cálculo, con las mismas cifras", async () => {
    const compliance = await import("@/lib/services/pdtp/compliance") as typeof import("@/lib/services/pdtp/compliance") & {
      getPdtpComplianceWithIntegral?: (programId: string, worksiteId?: string) => Promise<unknown>
    }
    expect(typeof compliance.getPdtpComplianceWithIntegral).toBe("function")
    for (const programId of [fixture.v1ProgramId, fixture.activeProgramId]) {
      for (const worksiteId of [fixture.worksiteIds[0]!, fixture.worksiteIds.at(-1)!]) {
        const indicators = await measure(() => compliance.getPdtpComplianceIndicators(programId, worksiteId))
        const integral = await measure(() => compliance.getPdtpIntegralCompliance(programId, worksiteId))
        const combined = await measure(() => compliance.getPdtpComplianceWithIntegral!(programId, worksiteId))
        expect(combined.result).toEqual({ indicators: indicators.result, integral: integral.result })
        expect(combined.queries).toBeLessThan(indicators.queries + integral.queries)
        expect(combined.queries).toBeLessThanOrEqual(BUDGET.complianceWithIntegral)
      }
    }
  })

  it("el indicador de una faena no consulta el padrón mes por mes ni actividad por actividad", async () => {
    const { getPdtpComplianceIndicators, getPdtpYearComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
    const worksiteId = fixture.worksiteIds[0]!
    expect((await measure(() => getPdtpComplianceIndicators(fixture.activeProgramId, worksiteId))).queries)
      .toBeLessThanOrEqual(BUDGET.indicatorsForWorksite)
    expect((await measure(() => getPdtpYearComplianceIndicators(fixture.activeProgramId, worksiteId))).queries)
      .toBeLessThanOrEqual(BUDGET.yearForWorksite)
  })

  it("D25: sin caché entre requests en el cálculo y el pool sigue en 10", () => {
    const files = ["lib/services/pdtp/compliance.ts", "lib/services/pdtp/helpers.ts", "lib/services/pdtp/request-cache.ts", "lib/services/pdtp/sheets.ts", "lib/services/pdtp/subject-registry.ts"]
    for (const file of files) {
      const source = fs.readFileSync(path.resolve(process.cwd(), file), "utf8")
      // Ni `next/cache` (unstable_cache, cacheLife, cacheTag, revalidate…) ni la directiva de caché.
      expect(source, file).not.toMatch(/from\s+["']next\/cache["']|^\s*["']use cache(:\s*\w+)?["']/m)
    }
    expect(fs.readFileSync(path.resolve(process.cwd(), "db/index.ts"), "utf8")).toMatch(/\bmax:\s*10\b/)
  })

  // Tabla de consultas por lectura para el informe: `PDTP_PROBE_OUT=archivo`.
  it.runIf(Boolean(process.env.PDTP_PROBE_OUT))("sonda: consultas por lectura y por número de faenas", async () => {
    const compliance = await import("@/lib/services/pdtp/compliance")
    const sheets = await import("@/lib/services/pdtp/sheets")
    const program = fixture.activeProgramId
    const rows: Array<[string, number]> = []
    for (const count of [1, 2, 6]) {
      const ids = fixture.worksiteIds.slice(0, count)
      rows.push([`tablero consolidado, ${count} faenas`, (await measure(() => compliance.getPdtpComplianceIndicatorsForScope(program, ids, { consolidateYear: true }))).queries])
      rows.push([`eje, ${count} faenas`, (await measure(() => compliance.getPdtpComplianceByCategoryForScope(program, ids))).queries])
      rows.push([`planilla agregada, ${count} faenas`, (await measure(() => sheets.getPdtpAggregatedSheetViewByProgram(program, "pdtp_general", ids, sheetPeriod(), sheetToday()))).queries])
      rows.push([`integral por alcance, ${count} faenas`, (await measure(() => compliance.getPdtpIntegralComplianceForScope(program, ids, { consolidateYear: true }))).queries])
    }
    const worksiteId = fixture.worksiteIds[0]!
    rows.push(["indicador de una faena", (await measure(() => compliance.getPdtpComplianceIndicators(program, worksiteId))).queries])
    rows.push(["integral de una faena", (await measure(() => compliance.getPdtpIntegralCompliance(program, worksiteId))).queries])
    rows.push(["año consolidado de una faena", (await measure(() => compliance.getPdtpYearComplianceIndicators(program, worksiteId))).queries])
    const withIntegral = (compliance as Record<string, unknown>).getPdtpComplianceWithIntegral as ((p: string, w: string) => Promise<unknown>) | undefined
    if (withIntegral) rows.push(["indicador + integral (ficha)", (await measure(() => withIntegral(program, worksiteId))).queries])
    fs.writeFileSync(process.env.PDTP_PROBE_OUT!, `${rows.map(([label, value]) => `${label}: ${value}`).join("\n")}\n`)
  }, 120_000)
})
