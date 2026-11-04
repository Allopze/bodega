/**
 * La serie mensual de controles de alcotest (CHART-010, mitad alcotest).
 *
 * Protege tres cosas:
 *
 * 1. **El alcance de faenas.** Quien ve la faena A no cuenta los controles de la
 *    B, y pedir la B con alcance A lanza (no devuelve una serie en cero).
 * 2. **Que sea agregado.** La serie devuelve conteos por mes; no hay forma de
 *    sacar de ella a quién se le tomó un control (un positivo es un dato sensible).
 * 3. **`listAlcoholTests` ya no es la tabla entera.** El alcance, el orden y el
 *    tope viajan al SQL.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite es compatible en tiempo de ejecución
testGlobal.__db = inMemoryDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

const { summarizeAlcoholTestsByMonth, listAlcoholTests } = await import("@/lib/services/prevention-alcotest")

const USER = "user-alc-trend"
const WS_A = "ws-alc-trend-a"
const WS_B = "ws-alc-trend-b"
const SINCE = "2026-01-01"

let counter = 0
async function seedTest(worksiteId: string, performedAt: string, result: "negativo" | "positivo" = "negativo") {
  counter += 1
  await inMemoryDb.insert(schema.alcoholTests).values({
    id: `alc-trend-${counter}`,
    worksiteId,
    performedByUserId: USER,
    testedPersonName: `Tercero ${counter}`,
    shift: "dia",
    performedAt,
    result,
  })
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await inMemoryDb.insert(schema.users).values({ id: USER, name: "Prevencionista", email: "prf-trend@example.test", hashedPassword: "x" })
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS_A, name: "Faena A", code: "ATA", isActive: true },
    { id: WS_B, name: "Faena B", code: "ATB", isActive: true },
  ])

  // Faena A: septiembre 3 controles (1 positivo) y octubre 1.
  await seedTest(WS_A, "2026-09-03T14:00:00.000Z")
  await seedTest(WS_A, "2026-09-10T14:00:00.000Z", "positivo")
  await seedTest(WS_A, "2026-09-20T14:00:00.000Z")
  await seedTest(WS_A, "2026-10-05T14:00:00.000Z")
  // 31 de agosto, 22:00 en Santiago (UTC-4) = 1 de septiembre 02:00 UTC: es de agosto.
  await seedTest(WS_A, "2026-09-01T02:00:00.000Z", "positivo")
  // Fuera de la ventana pedida.
  await seedTest(WS_A, "2025-02-01T14:00:00.000Z")
  // Faena B: dos controles, uno positivo, en octubre.
  await seedTest(WS_B, "2026-10-06T14:00:00.000Z")
  await seedTest(WS_B, "2026-10-07T14:00:00.000Z", "positivo")
})

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const byMonth = (rows: Awaited<ReturnType<typeof summarizeAlcoholTestsByMonth>>) =>
  Object.fromEntries(rows.map((row) => [row.month, row]))

describe("summarizeAlcoholTestsByMonth", () => {
  it("quien ve sólo la faena A no cuenta los controles de la B", async () => {
    const rows = byMonth(await summarizeAlcoholTestsByMonth([WS_A], { since: SINCE }))
    expect(rows["2026-10"]).toEqual({ month: "2026-10", total: 1, positives: 0 })
  })

  it("con alcance total suma las dos faenas", async () => {
    const rows = byMonth(await summarizeAlcoholTestsByMonth("all", { since: SINCE }))
    expect(rows["2026-10"]).toEqual({ month: "2026-10", total: 3, positives: 1 })
  })

  it("pedir la faena B con alcance A lanza, no devuelve una serie vacía que parezca «sin controles»", async () => {
    await expect(summarizeAlcoholTestsByMonth([WS_A], { since: SINCE, worksiteId: WS_B })).rejects.toThrow()
  })

  it("con el alcance total, el filtro de faena elige una", async () => {
    const rows = await summarizeAlcoholTestsByMonth("all", { since: SINCE, worksiteId: WS_B })
    expect(rows).toEqual([{ month: "2026-10", total: 2, positives: 1 }])
  })

  it("sin faenas en el alcance no hay serie", async () => {
    expect(await summarizeAlcoholTestsByMonth([], { since: SINCE })).toEqual([])
  })

  it("cuenta positivos y totales por mes", async () => {
    const rows = byMonth(await summarizeAlcoholTestsByMonth([WS_A], { since: SINCE }))
    expect(rows["2026-09"]).toEqual({ month: "2026-09", total: 3, positives: 1 })
  })

  it("el mes es el civil chileno: el 31 de agosto a las 22:00 es de agosto", async () => {
    const rows = byMonth(await summarizeAlcoholTestsByMonth([WS_A], { since: SINCE }))
    expect(rows["2026-08"]).toEqual({ month: "2026-08", total: 1, positives: 1 })
  })

  it("la ventana se aplica en SQL", async () => {
    const wide = await summarizeAlcoholTestsByMonth([WS_A], { since: "2025-01-01" })
    expect(wide.map((row) => row.month)).toContain("2025-02")
    const narrow = await summarizeAlcoholTestsByMonth([WS_A], { since: SINCE })
    expect(narrow.map((row) => row.month)).not.toContain("2025-02")
  })

  it("devuelve sólo conteos: ninguna columna identifica a la persona controlada", async () => {
    const [row] = await summarizeAlcoholTestsByMonth("all", { since: SINCE })
    expect(Object.keys(row!).sort()).toEqual(["month", "positives", "total"])
  })
})

describe("listAlcoholTests", () => {
  it("filtra por alcance en SQL y ordena del más reciente al más antiguo", async () => {
    const rows = await listAlcoholTests([WS_B])
    expect(rows.map((row) => row.worksiteId)).toEqual([WS_B, WS_B])
    expect(rows[0]!.performedAt >= rows[1]!.performedAt).toBe(true)
  })

  it("el tope se aplica en la consulta y devuelve los más recientes", async () => {
    const rows = await listAlcoholTests("all", undefined, { limit: 2 })
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.worksiteId)).toEqual([WS_B, WS_B])
  })

  it("una faena fuera del alcance lanza y un alcance vacío no devuelve nada", async () => {
    await expect(listAlcoholTests([WS_A], WS_B)).rejects.toThrow()
    expect(await listAlcoholTests([])).toEqual([])
  })
})
