/**
 * «Por revisar» › casos (CHART-023) contra Postgres real (PGlite):
 *  - los casos detectados por semana y gravedad, con la semana medida en hora de
 *    Chile y el mismo alcance por faena que la bandeja (nunca más ancho);
 *  - los pendientes por regla, con el mismo criterio que la lista, de modo que la
 *    cifra de cada regla es la que se encuentra al abrirla;
 *  - el filtro por regla de la bandeja (`?regla=`).
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))
vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import { getFuelInbox, getFuelInboxCaseRules, getFuelInboxCaseWeeks } from "@/lib/combustibles/inbox/queries"
import { resolveFuelPeriod } from "@/lib/combustibles/period/parse"

// Martes 3 de noviembre de 2026, mediodía en Chile (UTC-3): la semana en curso parte el lunes 2.
const NOW = new Date("2026-11-03T15:00:00.000Z")
const MARCH = resolveFuelPeriod({ searchParams: { periodo: "2026-03" }, fallback: { kind: "month", year: 2026, month: 3 }, today: "2026-10-31" })

const PERMISSIONS = ["combustibles:view", "combustibles:review_anomalies", "combustibles:resolve_anomalies"]
function session(worksiteIds: string[] | "all"): Session {
  return {
    user: { id: "reviewer", name: "Jefa", email: "jefa@example.com", roles: [], permissions: PERMISSIONS, worksiteIds: worksiteIds === "all" ? [] : worksiteIds, primaryWorksiteId: null, avatarColor: null, isActive: true, isGlobal: worksiteIds === "all" },
    expires: "2099-01-01T00:00:00.000Z",
  } as Session
}

let seq = 0
type CaseInsert = typeof schema.fuelAnomalyCases.$inferInsert
async function caso(values: Pick<CaseInsert, "severity" | "detectedAt"> & Partial<CaseInsert>) {
  seq += 1
  await inMemoryDb.insert(schema.fuelAnomalyCases).values({
    id: `cs-${seq}`, ruleId: "rule-sello", ruleCode: "sello_repetido", description: `Caso ${seq}`, status: "open", worksiteId: "ws-a", ...values,
  })
}

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

describe("casos por semana y gravedad", () => {
  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values([
      { id: "ws-a", name: "Faena A", code: "FN-A" },
      { id: "ws-b", name: "Faena B", code: "FN-B" },
    ])
    await inMemoryDb.insert(schema.fuelAnomalyRules).values([
      { id: "rule-sello", code: "sello_repetido", name: "Sello repetido", severity: "high" },
      { id: "rule-km", code: "kilometraje_regresivo", name: "Kilometraje inferior al anterior", severity: "high" },
    ])
    // Esta semana (lunes 2 de noviembre).
    await caso({ severity: "high", detectedAt: "2026-11-02T14:00:00.000Z" })
    // Domingo 1 a las 23:30 en Chile = 02:30 UTC del lunes 2: pertenece a la semana del 26 de octubre.
    await caso({ severity: "medium", detectedAt: "2026-11-02T02:30:00.000Z" })
    await caso({ severity: "low", detectedAt: "2026-10-27T12:00:00.000Z" })
    // Faena B, semana del 19 de octubre.
    await caso({ severity: "critical", detectedAt: "2026-10-20T12:00:00.000Z", worksiteId: "ws-b" })
    // Un caso ya cerrado cuenta: la serie dice cuántos se detectaron, no cuántos siguen pendientes.
    await caso({ severity: "high", detectedAt: "2026-10-13T12:00:00.000Z", status: "dismissed" })
    // Fuera de la ventana de cuatro semanas.
    await caso({ severity: "high", detectedAt: "2026-08-01T12:00:00.000Z" })
    // Sin faena: sólo lo ve un alcance global.
    await caso({ severity: "low", detectedAt: "2026-10-28T12:00:00.000Z", worksiteId: null })
  })

  const byWeek = (weeks: Awaited<ReturnType<typeof getFuelInboxCaseWeeks>>) => Object.fromEntries(weeks.map((week) => [week.weekStart, week]))

  it("un alcance global cuenta todo en la ventana, con ceros en las semanas sin casos y la en curso parcial", async () => {
    const weeks = await getFuelInboxCaseWeeks(session("all"), { now: NOW, weeks: 4 })
    expect(weeks.map((week) => week.weekStart)).toEqual(["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"])
    const weekly = byWeek(weeks)
    expect(weekly["2026-10-12"]).toMatchObject({ high: 1, total: 1, partial: false })
    expect(weekly["2026-10-19"]).toMatchObject({ critical: 1, total: 1 })
    expect(weekly["2026-10-26"]).toMatchObject({ low: 2, medium: 1, total: 3 })
    expect(weekly["2026-11-02"]).toMatchObject({ high: 1, total: 1, partial: true })
  })

  it("mide la semana en hora de Chile: el domingo de noche chileno no pasa a la semana siguiente", async () => {
    const weekly = byWeek(await getFuelInboxCaseWeeks(session("all"), { now: NOW, weeks: 4 }))
    // De los dos casos del lunes en UTC, sólo el de las 14:00 es de la semana del 2 de noviembre.
    expect(weekly["2026-11-02"]!.total).toBe(1)
    expect(weekly["2026-10-26"]!.medium).toBe(1)
  })

  it("la ventana de doce semanas deja fuera lo de hace tres meses", async () => {
    const weeks = await getFuelInboxCaseWeeks(session("all"), { now: NOW })
    expect(weeks).toHaveLength(12)
    expect(weeks.reduce((sum, week) => sum + week.total, 0)).toBe(6)
  })

  it("un alcance acotado sólo cuenta sus faenas: ni la otra faena ni los casos sin faena", async () => {
    const weekly = byWeek(await getFuelInboxCaseWeeks(session(["ws-a"]), { now: NOW, weeks: 4 }))
    expect(weekly["2026-10-19"]!.total).toBe(0)
    expect(weekly["2026-10-26"]).toMatchObject({ low: 1, medium: 1, total: 2 })
  })

  it("la faena elegida en el filtro se intersecta con el alcance, nunca lo ensancha", async () => {
    const otherFaena = await getFuelInboxCaseWeeks(session(["ws-a"]), { now: NOW, weeks: 4, worksiteId: "ws-b" })
    expect(otherFaena.reduce((sum, week) => sum + week.total, 0)).toBe(0)

    const onlyB = await getFuelInboxCaseWeeks(session("all"), { now: NOW, weeks: 4, worksiteId: "ws-b" })
    expect(onlyB.reduce((sum, week) => sum + week.total, 0)).toBe(1)
    expect(byWeek(onlyB)["2026-10-19"]!.critical).toBe(1)
  })

  it("una sesión sin ninguna faena no ve ningún caso", async () => {
    const weeks = await getFuelInboxCaseWeeks(session([]), { now: NOW, weeks: 4 })
    expect(weeks.reduce((sum, week) => sum + week.total, 0)).toBe(0)
  })
})

describe("pendientes por regla y filtro por regla", () => {
  beforeAll(async () => {
    // Detectados en marzo de 2026, sin registro de origen: su mes del dato es marzo.
    await caso({ severity: "high", detectedAt: "2026-03-05T12:00:00.000Z" })
    await caso({ severity: "high", detectedAt: "2026-03-06T12:00:00.000Z" })
    await caso({ severity: "high", detectedAt: "2026-03-07T12:00:00.000Z", status: "in_review", worksiteId: "ws-b" })
    await caso({ severity: "high", detectedAt: "2026-03-10T12:00:00.000Z", ruleId: "rule-km", ruleCode: "kilometraje_regresivo" })
    // Una regla que no está en el catálogo de la base: el nombre queda vacío y la pantalla usa el código.
    await caso({ severity: "low", detectedAt: "2026-03-11T12:00:00.000Z", ruleCode: "regla_sin_ficha" })
    // Su mes del dato (mayo) es posterior al período: no está entre lo pendiente de marzo.
    await caso({ severity: "high", detectedAt: "2026-05-10T12:00:00.000Z" })
    // Cerrado: vive en «Decididas».
    await caso({ severity: "high", detectedAt: "2026-03-12T12:00:00.000Z", status: "resolved", resolvedAt: "2026-03-13T12:00:00.000Z" })
  })

  it("cuenta lo pendiente de cada regla, de la más cargada a la menos, con el nombre de la regla", async () => {
    const rules = await getFuelInboxCaseRules(session("all"), MARCH)
    expect(rules).toEqual([
      { ruleCode: "sello_repetido", ruleName: "Sello repetido", count: 3 },
      { ruleCode: "kilometraje_regresivo", ruleName: "Kilometraje inferior al anterior", count: 1 },
      { ruleCode: "regla_sin_ficha", ruleName: null, count: 1 },
    ])
  })

  it("respeta el alcance y la faena elegida: nunca cuenta lo de una faena fuera del permiso", async () => {
    expect(await getFuelInboxCaseRules(session(["ws-b"]), MARCH)).toEqual([{ ruleCode: "sello_repetido", ruleName: "Sello repetido", count: 1 }])
    expect((await getFuelInboxCaseRules(session("all"), MARCH, { worksiteId: "ws-b" })).map((rule) => rule.count)).toEqual([1])
    expect(await getFuelInboxCaseRules(session(["ws-a"]), MARCH, { worksiteId: "ws-b" })).toEqual([])
    expect(await getFuelInboxCaseRules(session([]), MARCH)).toEqual([])
  })

  it("la cifra de cada regla es la que muestra la bandeja al abrirla con `?regla=`", async () => {
    for (const rule of await getFuelInboxCaseRules(session("all"), MARCH)) {
      const page = await getFuelInbox(session("all"), MARCH, { view: "pendientes", page: 1, kind: "caso", caseRuleCode: rule.ruleCode })
      expect(page.total, rule.ruleCode).toBe(rule.count)
      expect(new Set(page.rows.flatMap((row) => row.reasonCodes))).toEqual(new Set([rule.ruleCode]))
    }
  })

  it("sin filtro por regla la bandeja trae los casos de todas", async () => {
    const page = await getFuelInbox(session("all"), MARCH, { view: "pendientes", page: 1, kind: "caso" })
    expect(page.total).toBe(5)
    expect(new Set(page.rows.flatMap((row) => row.reasonCodes))).toEqual(new Set(["sello_repetido", "kilometraje_regresivo", "regla_sin_ficha"]))
  })

  it("el filtro por regla acompaña al alcance por faena", async () => {
    const page = await getFuelInbox(session(["ws-b"]), MARCH, { view: "pendientes", page: 1, kind: "caso", caseRuleCode: "kilometraje_regresivo" })
    expect(page.total).toBe(0)
  })
})
