/**
 * CHART-035 · consultas del gráfico de cobertura y del saldo de Bodega.
 *
 * Contra Postgres de verdad porque lo que importa vive en el SQL: el efecto sobre
 * el saldo (no el signo de `quantity`), el reverso de una entrega anulada, la
 * ventana de 90 días, el día civil de Chile y —sobre todo— el alcance por faena:
 * quien ve la faena A no puede ver ni una unidad de la faena B.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { nanoid } from "@/lib/id"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const { getStockConsumption, getProductBalanceMovements, stockConsumptionKey, BALANCE_MOVEMENT_LIMIT } = await import("../services/stock-coverage")

const NOW = new Date("2026-11-03T15:00:00.000Z")
const day = (daysAgo: number, hour = 15) => {
  const date = new Date(NOW.getTime() - daysAgo * 86_400_000)
  date.setUTCHours(hour, 0, 0, 0)
  return date.toISOString()
}

const worksiteA = nanoid()
const worksiteB = nanoid()
const userId = nanoid()
const guante = nanoid()
const casco = nanoid()
const categoryId = nanoid()

const session = (scope: { isGlobal: boolean; worksiteIds: string[] }): Session => ({
  user: { id: userId, name: "Bodega", email: "b@example.com", roles: ["bodeguero"], permissions: ["warehouse:view_stock"], primaryWorksiteId: null, avatarColor: null, isActive: true, ...scope },
  expires: "2099-01-01T00:00:00.000Z",
} as unknown as Session)

const everyone = session({ isGlobal: true, worksiteIds: [] })
const onlyA = session({ isGlobal: false, worksiteIds: [worksiteA] })

async function movement(input: { worksiteId: string; productId: string; type: string; before: number; after: number; at: string }) {
  await testDb.insert(schema.inventoryMovements).values({
    id: nanoid(), worksiteId: input.worksiteId, productId: input.productId, type: input.type,
    // El signo de `quantity` varía según el flujo; lo que se mide es before/after.
    quantity: input.after - input.before, stockBefore: input.before, stockAfter: input.after,
    performedBy: userId, performedAt: input.at,
  })
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.users).values({ id: userId, name: "Bodega", email: `b-${nanoid()}@example.com`, hashedPassword: "x", isActive: true })
  await testDb.insert(schema.worksites).values([
    { id: worksiteA, name: "Cholguán", code: `CH-${nanoid().slice(0, 6)}`, isActive: true },
    { id: worksiteB, name: "Pacífico", code: `PA-${nanoid().slice(0, 6)}`, isActive: true },
  ])
  await testDb.insert(schema.productCategories).values({ id: categoryId, name: "EPP", slug: `epp-${nanoid(4).toLowerCase()}`, isEpp: true })
  await testDb.insert(schema.products).values([
    { id: guante, sku: `G-${nanoid(4)}`, name: "Guante", categoryId, unitOfMeasure: "par", isActive: true },
    { id: casco, sku: `C-${nanoid(4)}`, name: "Casco", categoryId, unitOfMeasure: "unidad", isActive: true },
  ])

  // Faena A · guante: ingreso hace 100 días y tres entregas dentro de la ventana (10 + 20 + 30).
  await movement({ worksiteId: worksiteA, productId: guante, type: "ingreso_oc", before: 0, after: 200, at: day(100) })
  await movement({ worksiteId: worksiteA, productId: guante, type: "egreso_entrega", before: 200, after: 190, at: day(60) })
  await movement({ worksiteId: worksiteA, productId: guante, type: "egreso_entrega", before: 190, after: 170, at: day(40) })
  await movement({ worksiteId: worksiteA, productId: guante, type: "egreso_entrega", before: 170, after: 140, at: day(10) })
  // Fuera de la ventana de 90 días: no es consumo del período.
  await movement({ worksiteId: worksiteA, productId: guante, type: "egreso_entrega", before: 999, after: 899, at: day(95) })
  // Una baja que se guarda con signo negativo: cuenta por su efecto.
  await movement({ worksiteId: worksiteA, productId: guante, type: "egreso_desecho", before: 140, after: 138, at: day(5) })
  // Salida por guía y retiro de EPP usado: no son consumo.
  await movement({ worksiteId: worksiteA, productId: guante, type: "egreso_traslado", before: 138, after: 100, at: day(4) })
  await movement({ worksiteId: worksiteA, productId: guante, type: "retiro_epp_trabajador", before: 100, after: 100, at: day(3) })

  // Faena A · casco: una entrega anulada (la salida y su reverso se cancelan) y otra vigente.
  await movement({ worksiteId: worksiteA, productId: casco, type: "ingreso_oc", before: 0, after: 50, at: day(80) })
  await movement({ worksiteId: worksiteA, productId: casco, type: "egreso_entrega", before: 50, after: 40, at: day(20) })
  await movement({ worksiteId: worksiteA, productId: casco, type: "ingreso_anulacion", before: 40, after: 50, at: day(19) })
  await movement({ worksiteId: worksiteA, productId: casco, type: "egreso_entrega", before: 50, after: 47, at: day(2) })

  // Faena B · guante: consumo propio, que la faena A no debe ver.
  await movement({ worksiteId: worksiteB, productId: guante, type: "ingreso_oc", before: 0, after: 500, at: day(30) })
  await movement({ worksiteId: worksiteB, productId: guante, type: "egreso_entrega", before: 500, after: 400, at: day(10) })
}, 120_000)

describe("getStockConsumption", () => {
  it("suma el efecto de entregas y bajas dentro de los 90 días, con su n y la historia", async () => {
    const rows = await getStockConsumption(everyone, { now: NOW })
    const row = rows.get(stockConsumptionKey(worksiteA, guante))!
    // 10 + 20 + 30 de entregas y 2 de la baja; la entrega de hace 95 días y la salida por guía no cuentan.
    expect(row.consumed).toBe(62)
    expect(row.events).toBe(4)
    // Primer movimiento hace 100 días.
    expect(row.historyDays).toBe(100)
  })

  it("el reverso de una entrega anulada resta: lo que nunca salió no es consumo", async () => {
    const rows = await getStockConsumption(everyone, { now: NOW })
    const row = rows.get(stockConsumptionKey(worksiteA, casco))!
    // 10 (anulada) - 10 (reverso) + 3 = 3, en dos entregas netas de una.
    expect(row.consumed).toBe(3)
    expect(row.events).toBe(1)
    expect(row.historyDays).toBe(80)
  })

  it("un rol global ve todas las faenas", async () => {
    const rows = await getStockConsumption(everyone, { now: NOW })
    expect(rows.has(stockConsumptionKey(worksiteA, guante))).toBe(true)
    expect(rows.has(stockConsumptionKey(worksiteB, guante))).toBe(true)
  })

  it("quien ve la faena A no ve nada de la faena B", async () => {
    const rows = await getStockConsumption(onlyA, { now: NOW })
    expect(rows.has(stockConsumptionKey(worksiteA, guante))).toBe(true)
    expect(rows.has(stockConsumptionKey(worksiteB, guante))).toBe(false)
    expect([...rows.values()].every((row) => row.worksiteId === worksiteA)).toBe(true)
  })

  it("pedir la faena B sin tener permiso sobre ella devuelve cero filas, no las de B", async () => {
    const rows = await getStockConsumption(onlyA, { now: NOW, worksiteId: worksiteB })
    expect(rows.size).toBe(0)
  })

  it("una sesión sin faenas no ve nada", async () => {
    expect((await getStockConsumption(session({ isGlobal: false, worksiteIds: [] }), { now: NOW })).size).toBe(0)
  })

  it("acotar a una faena la devuelve sola", async () => {
    const rows = await getStockConsumption(everyone, { now: NOW, worksiteId: worksiteB })
    expect([...rows.values()].map((row) => row.worksiteId)).toEqual([worksiteB])
  })
})

describe("getProductBalanceMovements", () => {
  const from = "2026-07-01"
  const to = "2026-11-03"

  it("devuelve los movimientos de la ventana en orden cronológico con la unidad del producto", async () => {
    const result = await getProductBalanceMovements(everyone, { worksiteId: worksiteA, productId: guante, from, to })
    expect(result.unit).toBe("par")
    expect(result.truncated).toBe(false)
    expect(result.movements.map((movement) => movement.stockAfter)).toEqual([200, 899, 190, 170, 140, 138, 100, 100])
  })

  it("respeta la ventana: lo anterior al desde queda fuera", async () => {
    const result = await getProductBalanceMovements(everyone, { worksiteId: worksiteA, productId: guante, from: "2026-10-01", to })
    const times = result.movements.map((movement) => movement.performedAt)
    expect(times.length).toBeGreaterThan(0)
    expect(times.every((time) => time >= "2026-10-01")).toBe(true)
    expect(times).toEqual([...times].sort())
  })

  it("quien ve la faena A no obtiene movimientos de la faena B", async () => {
    const result = await getProductBalanceMovements(onlyA, { worksiteId: worksiteB, productId: guante, from, to })
    expect(result.movements).toEqual([])
  })

  it("con más movimientos que el tope conserva los más recientes y avisa", async () => {
    const result = await getProductBalanceMovements(everyone, { worksiteId: worksiteA, productId: guante, from, to, limit: 3 })
    expect(result.truncated).toBe(true)
    expect(result.movements).toHaveLength(3)
    // Los tres últimos: baja, salida por guía y retiro.
    expect(result.movements.map((movement) => movement.stockAfter)).toEqual([138, 100, 100])
    expect(BALANCE_MOVEMENT_LIMIT).toBeGreaterThanOrEqual(500)
  })

  it("el día es el civil de Chile: las 23:30 chilenas del 2 pertenecen al 2 aunque en UTC ya sea 3", async () => {
    await movement({ worksiteId: worksiteB, productId: casco, type: "ingreso_oc", before: 0, after: 9, at: "2026-11-03T02:30:00.000Z" })
    const on2 = await getProductBalanceMovements(everyone, { worksiteId: worksiteB, productId: casco, from: "2026-11-02", to: "2026-11-02" })
    expect(on2.movements).toHaveLength(1)
    const on3 = await getProductBalanceMovements(everyone, { worksiteId: worksiteB, productId: casco, from: "2026-11-03", to: "2026-11-03" })
    expect(on3.movements).toHaveLength(0)
  })
})
