/**
 * CHART-037 · consultas de `/bodega/guias`: tiempo hasta confirmar la recepción por
 * destino (mediana, P90 y n) y antigüedad de las guías despachadas sin confirmar.
 *
 * Contra Postgres de verdad porque lo que importa vive en el SQL: `percentile_cont`
 * con FILTER, los días civiles de Chile, qué estados cuentan y —sobre todo— el
 * alcance por faena: quien ve el destino A no puede ver ni una guía del B.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and } from "drizzle-orm"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { nanoid } from "@/lib/id"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const { getGuideAgeCounts, getGuideTransitByDestination, guideAgeFilterSql } = await import("../services/dispatch-guide-transit")
const { countDispatchGuides } = await import("../services/dispatch-guides")

/** Martes 3-nov-2026 12:00 hora de Chile (UTC-3, horario de verano). */
const NOW = new Date("2026-11-03T15:00:00.000Z")
const office = nanoid()
const destA = nanoid()
const destB = nanoid()
const destC = nanoid()
const userId = nanoid()

const session = (scope: { isGlobal: boolean; worksiteIds: string[] }): Session => ({
  user: { id: userId, name: "Bodega", email: "b@example.com", roles: ["bodeguero"], permissions: ["warehouse:view_guides"], primaryWorksiteId: null, avatarColor: null, isActive: true, ...scope },
  expires: "2099-01-01T00:00:00.000Z",
} as unknown as Session)

const everyone = session({ isGlobal: true, worksiteIds: [] })
const onlyA = session({ isGlobal: false, worksiteIds: [destA] })
const scopeOf = (who: Session) => worksiteScopeSql(who, schema.dispatchGuides.destinationWorksiteId)

const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()

let seq = 0
/** Una guía confirmada: salió hace `sentAgo` días y se confirmó `days` días después. */
async function received(destination: string, days: number, opts: { sentAgo?: number; status?: "received" | "partially_received" } = {}) {
  const sentAt = NOW.getTime() - (opts.sentAgo ?? 20) * DAY
  await testDb.insert(schema.dispatchGuides).values({
    id: nanoid(), code: `GDI-T-${++seq}`, status: opts.status ?? "received", originWorksiteId: office, destinationWorksiteId: destination,
    issuedBy: userId, issuedAt: iso(sentAt - 3_600_000), dispatchedAt: iso(sentAt), dispatchedBy: userId,
    receivedAt: iso(sentAt + days * DAY), receivedBy: userId,
  })
}

/** Una guía despachada que sigue sin confirmar. `dispatchedAt` en ISO. */
async function dispatched(destination: string, dispatchedAt: string, issuedAt = dispatchedAt) {
  await testDb.insert(schema.dispatchGuides).values({
    id: nanoid(), code: `GDI-T-${++seq}`, status: "dispatched", originWorksiteId: office, destinationWorksiteId: destination,
    issuedBy: userId, issuedAt, dispatchedAt, dispatchedBy: userId,
  })
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.users).values({ id: userId, name: "Bodega", email: `b-${nanoid()}@example.com`, hashedPassword: "x", isActive: true })
  await testDb.insert(schema.worksites).values([
    { id: office, name: "Oficina", code: `OF-${nanoid().slice(0, 6)}`, isActive: true },
    { id: destA, name: "Cholguán", code: `CH-${nanoid().slice(0, 6)}`, isActive: true },
    { id: destB, name: "Pacífico", code: `PA-${nanoid().slice(0, 6)}`, isActive: true },
    { id: destC, name: "Masisa", code: `MA-${nanoid().slice(0, 6)}`, isActive: true },
  ])

  // Cholguán: 10 guías confirmadas en 1…10 días (mediana 5,5; P90 9,1), más una con diferencias que no se mide.
  for (let days = 1; days <= 10; days++) await received(destA, days)
  await received(destA, 40, { status: "partially_received" })
  // Pacífico: 5 guías, 2,2,2,2 y 12 días: mediana 2.
  for (const days of [2, 2, 2, 2, 12]) await received(destB, days)
  // Masisa: sólo 2 confirmadas (no alcanza) y una confirmada antes del despacho (reloj adelantado).
  await received(destC, 3)
  await received(destC, -1)
  // Una guía confirmada hace mucho: queda fuera de la ventana de emisión.
  await received(destA, 99, { sentAgo: 400 })

  // Despachadas sin confirmar: hoy, 2 días civiles (a las 23:30 de Chile del 1-nov = 02:30 UTC del 2), 6 días, 20 días y de Pacífico.
  await dispatched(destA, "2026-11-03T14:00:00.000Z")
  await dispatched(destA, "2026-11-02T02:30:00.000Z")
  await dispatched(destA, "2026-10-28T15:00:00.000Z")
  await dispatched(destA, "2026-10-14T15:00:00.000Z", "2025-01-02T15:00:00.000Z")
  await dispatched(destB, "2026-11-02T15:00:00.000Z")
}, 120_000)

const WINDOW = { from: "2026-05-01", to: "2026-11-03" }
const byName = (rows: Awaited<ReturnType<typeof getGuideTransitByDestination>>) => Object.fromEntries(rows.map((row) => [row.worksiteName, row]))

describe("getGuideTransitByDestination", () => {
  it("mediana, P90 y n por destino, sobre las guías confirmadas por completo", async () => {
    const rows = byName(await getGuideTransitByDestination({ scopeSql: scopeOf(everyone), ...WINDOW }))
    expect(rows["Cholguán"]).toMatchObject({ confirmed: 10, median: 5.5, withDifferences: 1 })
    expect(rows["Cholguán"]!.p90).toBeCloseTo(9.1, 5)
    expect(rows["Pacífico"]).toMatchObject({ confirmed: 5, median: 2, withDifferences: 0 })
  })

  it("las confirmadas con diferencias se cuentan aparte y no mueven la mediana", async () => {
    const rows = byName(await getGuideTransitByDestination({ scopeSql: scopeOf(everyone), ...WINDOW }))
    // La de 40 días con diferencias no estira el P90 de Cholguán por encima de 10.
    expect(rows["Cholguán"]!.p90!).toBeLessThanOrEqual(10)
    expect(rows["Cholguán"]!.withDifferences).toBe(1)
  })

  it("un reloj adelantado mide cero días, nunca negativo, y n cuenta las guías", async () => {
    const rows = byName(await getGuideTransitByDestination({ scopeSql: scopeOf(everyone), ...WINDOW }))
    expect(rows["Masisa"]).toMatchObject({ confirmed: 2 })
    expect(rows["Masisa"]!.median!).toBeGreaterThanOrEqual(0)
  })

  it("respeta la ventana de emisión: lo anterior al desde queda fuera", async () => {
    const rows = byName(await getGuideTransitByDestination({ scopeSql: scopeOf(everyone), ...WINDOW }))
    expect(rows["Cholguán"]!.confirmed).toBe(10)
    const wide = byName(await getGuideTransitByDestination({ scopeSql: scopeOf(everyone), from: "2025-01-01", to: "2026-11-03" }))
    expect(wide["Cholguán"]!.confirmed).toBe(11)
  })

  it("las despachadas sin confirmar no entran a la medición", async () => {
    const rows = await getGuideTransitByDestination({ scopeSql: scopeOf(everyone), ...WINDOW })
    expect(rows.reduce((sum, row) => sum + row.confirmed, 0)).toBe(17)
  })

  it("quien ve el destino A no ve nada del B ni del C", async () => {
    const rows = await getGuideTransitByDestination({ scopeSql: scopeOf(onlyA), ...WINDOW })
    expect(rows.map((row) => row.worksiteName)).toEqual(["Cholguán"])
  })

  it("pedir el destino B sin tener permiso sobre él devuelve cero filas, no las de B", async () => {
    const scopeSql = worksiteScopeSql(onlyA, schema.dispatchGuides.destinationWorksiteId, destB)
    expect(await getGuideTransitByDestination({ scopeSql, destinationWorksiteId: destB, ...WINDOW })).toEqual([])
  })

  it("una sesión sin faenas no ve nada", async () => {
    const none = session({ isGlobal: false, worksiteIds: [] })
    expect(await getGuideTransitByDestination({ scopeSql: scopeOf(none), ...WINDOW })).toEqual([])
  })

  it("acotar a un destino lo devuelve solo", async () => {
    const rows = await getGuideTransitByDestination({ scopeSql: scopeOf(everyone), destinationWorksiteId: destB, ...WINDOW })
    expect(rows.map((row) => row.worksiteName)).toEqual(["Pacífico"])
  })
})

describe("getGuideAgeCounts", () => {
  it("reparte las despachadas por días civiles de Chile, y la vieja fuera de toda ventana igual cuenta", async () => {
    const counts = await getGuideAgeCounts({ scopeSql: scopeOf(everyone) }, NOW)
    // Cholguán: hoy (0), la del 1-nov 23:30 (2 días), 6 días y 20 días. Pacífico: ayer (1).
    expect(counts).toEqual({ "0-1": 2, "2-3": 1, "4-7": 1, "mas-de-7": 1 })
  })

  it("acota a una faena de destino", async () => {
    expect(await getGuideAgeCounts({ scopeSql: scopeOf(everyone), destinationWorksiteId: destB }, NOW)).toEqual({ "0-1": 1, "2-3": 0, "4-7": 0, "mas-de-7": 0 })
  })

  it("quien ve el destino A no cuenta las del B", async () => {
    expect(await getGuideAgeCounts({ scopeSql: scopeOf(onlyA) }, NOW)).toEqual({ "0-1": 1, "2-3": 1, "4-7": 1, "mas-de-7": 1 })
  })

  it("una sesión sin faenas no cuenta nada", async () => {
    const none = session({ isGlobal: false, worksiteIds: [] })
    expect(await getGuideAgeCounts({ scopeSql: scopeOf(none) }, NOW)).toEqual({ "0-1": 0, "2-3": 0, "4-7": 0, "mas-de-7": 0 })
  })
})

describe("guideAgeFilterSql: la lista cuenta lo mismo que la barra", () => {
  const count = (key: Parameters<typeof guideAgeFilterSql>[0], who = everyone) =>
    countDispatchGuides({ scopeSql: scopeOf(who), status: "dispatched", dispatchedAgeSql: guideAgeFilterSql(key, NOW) })

  it.each([
    ["0-1", 2],
    ["2-3", 1],
    ["4-7", 1],
    ["mas-de-7", 1],
    ["", 5],
  ] as const)("el tramo «%s» lista %i guías", async (key, expected) => {
    expect(await count(key)).toBe(expected)
  })

  it("el filtro respeta el alcance: el destino A sólo lista las suyas", async () => {
    expect(await count("0-1", onlyA)).toBe(1)
    expect(await count("mas-de-7", onlyA)).toBe(1)
  })

  it("sin tramo no agrega condición", () => {
    expect(guideAgeFilterSql("", NOW)).toBeUndefined()
    expect(and(guideAgeFilterSql("", NOW))).toBeUndefined()
  })
})
