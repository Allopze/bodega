/**
 * Nivel de cada estanque en el tiempo (CHART-020, P-5) contra Postgres real (PGlite):
 *  - lo que entró y salió por día civil chileno cuenta exactamente lo mismo que el balance de la
 *    tabla (recepciones, traspasos, entregas desde el estanque, lo que repartió la PWA; sin las
 *    cargas anuladas, sin las entregas directas), de modo que la curva termina en su «Nivel»;
 *  - el alcance por faena se aplica otra vez dentro de la consulta: una sesión de A no ve nada de B,
 *    ni aunque quien llama le pase la id de un estanque de B.
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

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import { getFuelStorageBalances, getFuelStorageDailyFlows } from "@/lib/combustibles/fuel-cycle"
import { buildTankLevelView } from "@/lib/combustibles/tank-level"

const session = (worksiteIds: string[] | "all"): Session => ({
  user: {
    id: "user-1", name: "Test", email: "test@example.com", roles: [], permissions: ["combustibles:view"],
    worksiteIds: worksiteIds === "all" ? [] : worksiteIds, primaryWorksiteId: null, avatarColor: null, isActive: true,
    isGlobal: worksiteIds === "all",
  },
  expires: "2099-01-01T00:00:00.000Z",
}) as Session

const RANGE = { from: "2026-06-01", to: "2026-06-30" }
const ids = { wsA: "ws-a", wsB: "ws-b", diesel: "p-diesel", gasoline: "p-gasolina", supplier: "sup-1", user: "usr-1", vehicle: "veh-1", type: "eq-type", tankA1: "tank-a1", tankA2: "tank-a2", tankA3: "tank-a3-gasolina", tankB: "tank-b", point: "point-a1" }

let seq = 0
type MovementInsert = typeof schema.fuelCycleMovements.$inferInsert
async function movement(values: Pick<MovementInsert, "eventType" | "quantity" | "occurredAt"> & Partial<MovementInsert>) {
  seq += 1
  await inMemoryDb.insert(schema.fuelCycleMovements).values({
    id: `mov-${seq}`, worksiteId: ids.wsA, productId: ids.diesel, createdBy: ids.user, ...values,
  })
}
async function pwa(values: { liters: number; loadedAt: string; status?: string }) {
  seq += 1
  await inMemoryDb.insert(schema.fuelTaeSubmissions).values({
    id: `sub-${seq}`, clientSubmissionId: `client-${seq}`, source: "public_pwa", publicResultToken: `token-${seq}`.padEnd(32, "x"),
    worksiteId: ids.wsA, loadingPointId: ids.point, vehicleId: ids.vehicle, productId: ids.diesel, equipmentCodeSnapshot: "KA-1",
    submittedAt: values.loadedAt, driverNameSnapshot: "Conductor", supervisorNameSnapshot: "Supervisor", meterType: "odometer",
    status: values.status ?? "submitted", liters: values.liters, loadedAt: values.loadedAt,
  })
}

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

describe("nivel de los estanques por día", () => {
  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values([
      { id: ids.wsA, name: "Faena A", code: "FN-A" },
      { id: ids.wsB, name: "Faena B", code: "FN-B" },
    ])
    await inMemoryDb.insert(schema.users).values({ id: ids.user, name: "Importador", email: "imp@example.com", hashedPassword: "x", isActive: true })
    await inMemoryDb.insert(schema.fuelProducts).values([
      { id: ids.diesel, code: "DIESEL-T", name: "Diésel", category: "diesel", unit: "liter" },
      { id: ids.gasoline, code: "GASOLINA-T", name: "Gasolina", category: "gasoline", unit: "liter" },
    ])
    await inMemoryDb.insert(schema.fuelSuppliers).values({ id: ids.supplier, name: "Copec" })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: ids.type, slug: "camion-t", name: "Camión" })
    await inMemoryDb.insert(schema.fuelVehicles).values({ id: ids.vehicle, plate: "AAAA11", type: "camion", equipmentTypeId: ids.type, worksiteId: ids.wsA, isActive: true })
    await inMemoryDb.insert(schema.fuelStorageLocations).values([
      { id: ids.tankA1, worksiteId: ids.wsA, productId: ids.diesel, name: "Estanque A1", capacityLiters: 5000, isActive: true },
      { id: ids.tankA2, worksiteId: ids.wsA, productId: ids.diesel, name: "Estanque A2", isActive: true },
      { id: ids.tankA3, worksiteId: ids.wsA, productId: ids.gasoline, name: "Estanque A3", isActive: true },
      { id: ids.tankB, worksiteId: ids.wsB, productId: ids.diesel, name: "Estanque B", isActive: true },
    ])
    await inMemoryDb.insert(schema.fuelTaeLoadingPoints).values({ id: ids.point, worksiteId: ids.wsA, storageLocationId: ids.tankA1, name: "Punto A1", type: "truck_dispenser" })

    // Antes del período (apertura de A1 = 1000 + 40 de la noche del 31 de mayo en Chile).
    await movement({ eventType: "received", quantity: 1000, occurredAt: "2026-05-20T12:00:00.000Z", supplierId: ids.supplier, targetLocationId: ids.tankA1 })
    // 02:00 UTC del 1 de junio = 22:00 del 31 de mayo en Chile: es de mayo.
    await movement({ eventType: "received", quantity: 40, occurredAt: "2026-06-01T02:00:00.000Z", supplierId: ids.supplier, targetLocationId: ids.tankA1 })
    // Dentro de junio.
    await movement({ eventType: "received", quantity: 500, occurredAt: "2026-06-05T12:00:00.000Z", supplierId: ids.supplier, targetLocationId: ids.tankA1 })
    await movement({ eventType: "transfer", quantity: 100, occurredAt: "2026-06-06T12:00:00.000Z", sourceLocationId: ids.tankA1, targetLocationId: ids.tankA2 })
    await movement({ eventType: "tank_delivery", quantity: 30, occurredAt: "2026-06-08T12:00:00.000Z", sourceLocationId: ids.tankA1, vehicleId: ids.vehicle })
    await pwa({ liters: 20, loadedAt: "2026-06-08T15:00:00.000Z" })
    // Anulada: no cuenta.
    await pwa({ liters: 999, loadedAt: "2026-06-09T15:00:00.000Z", status: "voided" })
    // La entrega directa no pasa por ningún estanque.
    await movement({ eventType: "direct_delivery", quantity: 777, occurredAt: "2026-06-10T12:00:00.000Z", supplierId: ids.supplier, vehicleId: ids.vehicle })
    // 01:30 UTC del 1 de julio = 21:30 del 30 de junio en Chile: es de junio.
    await movement({ eventType: "received", quantity: 70, occurredAt: "2026-07-01T01:30:00.000Z", supplierId: ids.supplier, targetLocationId: ids.tankA1 })
    // Julio de verdad: no entra en junio.
    await movement({ eventType: "received", quantity: 5000, occurredAt: "2026-07-03T12:00:00.000Z", supplierId: ids.supplier, targetLocationId: ids.tankA1 })
    // Otro producto en la misma faena.
    await movement({ eventType: "received", quantity: 300, occurredAt: "2026-06-12T12:00:00.000Z", productId: ids.gasoline, supplierId: ids.supplier, targetLocationId: ids.tankA3 })
    // Faena B.
    await movement({ eventType: "received", quantity: 800, occurredAt: "2026-06-05T12:00:00.000Z", worksiteId: ids.wsB, supplierId: ids.supplier, targetLocationId: ids.tankB })
  })

  const flowsOf = (flows: Awaited<ReturnType<typeof getFuelStorageDailyFlows>>, tank: string) =>
    flows.filter((flow) => flow.storageLocationId === tank).map(({ day, inLiters, outLiters }) => [day, inLiters, outLiters])

  it("cuenta por día civil chileno lo que entró y salió, con la misma definición que la tabla", async () => {
    const balances = await getFuelStorageBalances(session("all"), { worksiteId: ids.wsA, ...RANGE })
    const flows = await getFuelStorageDailyFlows(session("all"), balances, RANGE)

    expect(flowsOf(flows, ids.tankA1)).toEqual([
      ["2026-06-05", 500, 0],
      // Sale el traspaso a A2.
      ["2026-06-06", 0, 100],
      // 30 del ledger + 20 de la PWA el mismo día; la anulada y la entrega directa no cuentan.
      ["2026-06-08", 0, 50],
      // La recepción de las 21:30 del 30 de junio es de junio, no de julio.
      ["2026-06-30", 70, 0],
    ])
    // El traspaso entra a A2 el mismo día.
    expect(flowsOf(flows, ids.tankA2)).toEqual([["2026-06-06", 100, 0]])
    // La recepción de las 22:00 del 31 de mayo y la de julio no están.
    expect(flows.some((flow) => flow.day < "2026-06-01" || flow.day > "2026-06-30")).toBe(false)
  })

  it("la curva termina en el «Nivel» de la tabla, con su «Al inicio»", async () => {
    const balances = await getFuelStorageBalances(session("all"), { worksiteId: ids.wsA, ...RANGE })
    const flows = await getFuelStorageDailyFlows(session("all"), balances, RANGE)
    const view = buildTankLevelView(balances, flows, { ...RANGE, today: "2026-07-15" })

    const a1 = view.tanks.find((tank) => tank.storageLocationId === ids.tankA1)!
    const balanceA1 = balances.find((balance) => balance.storageLocationId === ids.tankA1)!
    // 1000 de mayo + 40 del 31 de mayo en la noche chilena.
    expect(balanceA1.openingLiters).toBe(1040)
    expect(a1.openingLiters).toBe(balanceA1.openingLiters)
    expect(a1.closingLiters).toBe(balanceA1.balanceLiters)
    expect(a1.closingLiters).toBe(1040 + 500 - 100 - 50 + 70)
    for (const tank of view.tanks) {
      const balance = balances.find((candidate) => candidate.storageLocationId === tank.storageLocationId)!
      expect(tank.closingLiters).toBe(balance.balanceLiters)
    }
    // Tienen curva los tres estanques de A que se movieron (A1, A2 por el traspaso y A3 por su recepción); el de B no está en estos balances.
    expect(view.tanks.map((tank) => tank.storageLocationId).sort()).toEqual([ids.tankA1, ids.tankA2, ids.tankA3].sort())
  })

  it("respeta el filtro de producto: sólo los estanques de ese producto", async () => {
    const balances = await getFuelStorageBalances(session("all"), { worksiteId: ids.wsA, productId: ids.gasoline, ...RANGE })
    const flows = await getFuelStorageDailyFlows(session("all"), balances, RANGE)

    expect(flows.map((flow) => flow.storageLocationId)).toEqual([ids.tankA3])
    expect(flowsOf(flows, ids.tankA3)).toEqual([["2026-06-12", 300, 0]])
  })

  it("una sesión de la faena A no ve nada de la B", async () => {
    const balances = await getFuelStorageBalances(session([ids.wsA]), RANGE)
    expect(balances.some((balance) => balance.storageLocationId === ids.tankB)).toBe(false)
    const flows = await getFuelStorageDailyFlows(session([ids.wsA]), balances, RANGE)

    expect(flows.some((flow) => flow.storageLocationId === ids.tankB)).toBe(false)
    expect(flows.length).toBeGreaterThan(0)
  })

  it("aunque quien llama le pase la id de un estanque de B, la consulta vuelve a aplicar el alcance", async () => {
    const forged = [{ storageLocationId: ids.tankB }, { storageLocationId: ids.tankA2 }]
    const flows = await getFuelStorageDailyFlows(session([ids.wsA]), forged, RANGE)

    expect(flows.map((flow) => flow.storageLocationId)).toEqual([ids.tankA2])
    // Y una sesión sin faenas no ve nada, no «todo».
    expect(await getFuelStorageDailyFlows(session([]), forged, RANGE)).toEqual([])
    // El alcance global sí ve el de B.
    const global = await getFuelStorageDailyFlows(session("all"), forged, RANGE)
    expect(global.some((flow) => flow.storageLocationId === ids.tankB)).toBe(true)
  })

  it("sin estanques no consulta nada", async () => {
    expect(await getFuelStorageDailyFlows(session("all"), [], RANGE)).toEqual([])
  })
})
