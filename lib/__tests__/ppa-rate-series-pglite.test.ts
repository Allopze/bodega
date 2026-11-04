/**
 * La serie mensual y el ranking por faena de la tasa de detención del PPA
 * (CHART-011).
 *
 * Protege:
 *
 * 1. **El alcance de faenas.** Quien ve la faena A no cuenta los PPA de la B.
 * 2. **La fecha de llenado.** El mes es el civil chileno de `LEAST(filled_at,
 *    created_at)`: un envío offline se fecha cuando se llenó, y un reloj adelantado
 *    no puede ponerlo en un mes que no ocurrió.
 * 3. **Que la consulta devuelva sumas**, no filas: la regla de «datos
 *    insuficientes» y la tasa viven en `lib/ppa/detention-rate.ts`.
 * 4. **Que el ranking traiga todas las faenas**: una faena con pocos PPA hay que
 *    nombrarla como insuficiente, no omitirla por no estar en un top 5.
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

const { getPpaMonthlySeries, getPpaDetentionByWorksite } = await import("@/lib/services/ppa")

const WS_A = "ws-ppa-rate-a"
const WS_B = "ws-ppa-rate-b"
const SINCE = "2026-01-01"

let counter = 0
async function seedPpa(
  worksiteId: string,
  createdAt: string,
  resultado: "detenido" | "autorizado_auto" = "autorizado_auto",
  filledAt: string | null = null,
) {
  counter += 1
  await inMemoryDb.insert(schema.ppaSubmissions).values({
    id: `ppa-rate-${counter}`,
    worksiteId,
    workerName: `Trabajador ${counter}`,
    manualIdentificacion: true,
    tipoTrabajo: "trabajo_altura",
    answersJson: {},
    resultado,
    triggeredReasons: resultado === "detenido" ? ["sin_arnes"] : [],
    estado: resultado === "detenido" ? "detenido" : "aprobado_auto",
    publicToken: `tok-ppa-rate-${counter}`,
    filledAt,
    createdAt,
    updatedAt: createdAt,
  })
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS_A, name: "Faena A", code: "PRA", isActive: true },
    { id: WS_B, name: "Faena B", code: "PRB", isActive: true },
  ])

  // Faena A, septiembre: 3 PPA, 1 detenido.
  await seedPpa(WS_A, "2026-09-03T14:00:00.000Z")
  await seedPpa(WS_A, "2026-09-10T14:00:00.000Z", "detenido")
  await seedPpa(WS_A, "2026-09-20T14:00:00.000Z")
  // Faena A, octubre: 1.
  await seedPpa(WS_A, "2026-10-05T14:00:00.000Z")
  // Llenado offline el 30 de septiembre y recibido el 2 de octubre: es de septiembre.
  await seedPpa(WS_A, "2026-10-02T14:00:00.000Z", "autorizado_auto", "2026-09-30T14:00:00.000Z")
  // Reloj adelantado: dice haberse llenado en diciembre, pero el servidor lo recibió en octubre.
  await seedPpa(WS_A, "2026-10-08T14:00:00.000Z", "detenido", "2026-12-15T14:00:00.000Z")
  // 31 de agosto, 22:00 en Santiago (UTC-4) = 1 de septiembre 02:00 UTC: es de agosto.
  await seedPpa(WS_A, "2026-09-01T02:00:00.000Z")
  // Fuera de la ventana.
  await seedPpa(WS_A, "2025-03-01T14:00:00.000Z")
  // Faena B: octubre, 2 PPA, ambos detenidos.
  await seedPpa(WS_B, "2026-10-06T14:00:00.000Z", "detenido")
  await seedPpa(WS_B, "2026-10-07T14:00:00.000Z", "detenido")
})

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const byMonth = (rows: Awaited<ReturnType<typeof getPpaMonthlySeries>>) => Object.fromEntries(rows.map((row) => [row.month, row]))

describe("getPpaMonthlySeries", () => {
  it("quien ve sólo la faena A no cuenta los PPA de la B", async () => {
    const rows = byMonth(await getPpaMonthlySeries([WS_A], { since: SINCE }))
    // La B aportaba dos detenidos a octubre; sin ella octubre son los dos de A (uno es el del reloj adelantado).
    expect(rows["2026-10"]).toEqual({ month: "2026-10", total: 2, detained: 1 })
  })

  it("con alcance total suma las dos faenas", async () => {
    const rows = byMonth(await getPpaMonthlySeries("all", { since: SINCE }))
    expect(rows["2026-10"]).toEqual({ month: "2026-10", total: 4, detained: 3 })
  })

  it("sin faenas en el alcance no hay serie", async () => {
    expect(await getPpaMonthlySeries([], { since: SINCE })).toEqual([])
  })

  it("el envío offline se fecha cuando se llenó, no cuando llegó", async () => {
    const rows = byMonth(await getPpaMonthlySeries([WS_A], { since: SINCE }))
    // 3 de septiembre, 10, 20 y el llenado el 30 de septiembre (recibido en octubre).
    expect(rows["2026-09"]).toEqual({ month: "2026-09", total: 4, detained: 1 })
  })

  it("un reloj adelantado no fecha el PPA en un mes futuro", async () => {
    const rows = await getPpaMonthlySeries([WS_A], { since: SINCE })
    expect(rows.map((row) => row.month)).not.toContain("2026-12")
  })

  it("el mes es el civil chileno: el 31 de agosto a las 22:00 es de agosto", async () => {
    const rows = byMonth(await getPpaMonthlySeries([WS_A], { since: SINCE }))
    expect(rows["2026-08"]).toEqual({ month: "2026-08", total: 1, detained: 0 })
  })

  it("la ventana se aplica en SQL", async () => {
    expect((await getPpaMonthlySeries([WS_A], { since: "2025-01-01" })).map((row) => row.month)).toContain("2025-03")
    expect((await getPpaMonthlySeries([WS_A], { since: SINCE })).map((row) => row.month)).not.toContain("2025-03")
  })

  it("devuelve sumas por mes, sin datos de la persona", async () => {
    const [row] = await getPpaMonthlySeries("all", { since: SINCE })
    expect(Object.keys(row!).sort()).toEqual(["detained", "month", "total"])
  })
})

describe("getPpaDetentionByWorksite", () => {
  it("respeta el alcance: la faena B no aparece para quien sólo ve la A", async () => {
    const rows = await getPpaDetentionByWorksite([WS_A], { since: SINCE })
    expect(rows.map((row) => row.worksiteId)).toEqual([WS_A])
  })

  it("trae todas las faenas con PPA, también las de pocos casos, con su base", async () => {
    const rows = await getPpaDetentionByWorksite("all", { since: SINCE })
    expect(rows).toEqual([
      { worksiteId: WS_A, worksiteName: "Faena A", total: 7, detained: 2 },
      { worksiteId: WS_B, worksiteName: "Faena B", total: 2, detained: 2 },
    ])
  })

  it("sin faenas en el alcance no hay ranking", async () => {
    expect(await getPpaDetentionByWorksite([], { since: SINCE })).toEqual([])
  })
})
