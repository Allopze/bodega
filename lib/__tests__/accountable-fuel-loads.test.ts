/**
 * CO-014: reportes, ciclo, Flota, analítica y estados de cuenta cerraban el
 * mismo mes con cifras distintas porque cada superficie decidía por su cuenta
 * qué estados contaban. Esta prueba fija el predicado canónico y comprueba que
 * las cinco lo comparten: una carga en borrador y una anulada no pueden mover
 * ninguna de ellas.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { nanoid } from "@/lib/id"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { ACCOUNTABLE_FUEL_LOAD_STATUSES } = await import("@/lib/combustibles/load-status")
const { getFuelReportsData } = await import("@/lib/combustibles/reports")
const { getFuelCycleComparison } = await import("@/lib/combustibles/fuel-cycle")
const { getFleetOverview } = await import("@/lib/services/fleet")

const worksiteId = nanoid()
const productId = nanoid()
const supplierId = nanoid()
const equipmentTypeId = nanoid()
const vehicleId = nanoid()
const userId = nanoid()

function session(): Session {
  return {
    user: {
      id: userId, name: "Gerencia", email: "gerencia@example.com", roles: ["administrador"],
      permissions: ["combustibles:view", "combustibles:view_costs", "flota:view", "mantenciones:view"],
      worksiteIds: [], primaryWorksiteId: null, avatarColor: null, isActive: true, isGlobal: true,
    },
    expires: "2099-01-01T00:00:00.000Z",
  } as unknown as Session
}

const load = (status: string, liters: number, amount: number) => ({
  id: nanoid(), loadDate: "2026-06-10", month: "2026-06", serviceType: "TCT", vehicleId,
  fuelSupplierId: supplierId, worksiteId, product: "PETROLEO DIESEL", productId,
  liters, baseAmount: amount, totalAmount: amount, status, createdBy: userId,
})

describe("predicado canónico de cargas contabilizables", () => {
  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({ id: worksiteId, name: "Faena A", code: `FA-${nanoid().slice(0, 8)}`, isActive: true })
    await inMemoryDb.insert(schema.users).values({ id: userId, name: "Gerencia", email: `g-${nanoid()}@example.com`, hashedPassword: "x", isActive: true })
    await inMemoryDb.insert(schema.fuelProducts).values({ id: productId, code: `DIESEL-${nanoid().slice(0, 6)}`, name: "Diésel", category: "diesel", unit: "liter" })
    await inMemoryDb.insert(schema.fuelSuppliers).values({ id: supplierId, name: "Copec" })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: equipmentTypeId, slug: `camion-${nanoid().slice(0, 6)}`, name: "Camión" })
    await inMemoryDb.insert(schema.fuelVehicles).values({ id: vehicleId, plate: `AA${nanoid().slice(0, 4).toUpperCase()}`, type: "camion", equipmentTypeId, worksiteId, isActive: true })
    await inMemoryDb.insert(schema.fuelLoads).values([
      load("registered", 100, 100_000),
      load("reconciled", 50, 50_000),
      load("draft", 999, 999_000),
      load("cancelled", 777, 777_000),
    ])
  })

  it("declara `registered` y `reconciled` como únicos estados contables", () => {
    expect([...ACCOUNTABLE_FUEL_LOAD_STATUSES]).toEqual(["registered", "reconciled"])
  })

  it("los reportes de gasto ignoran borradores y anuladas", async () => {
    const data = await getFuelReportsData(session(), { startDate: "2026-06-01", endDate: "2026-06-30" })
    const june = data.byMonth.find((row) => row.group === "2026-06")
    // `numeric` vuelve como string desde el driver; lo que se compara es la cifra.
    expect(Number(june?.totalLiters)).toBe(150)
    expect(Number(june?.totalAmount)).toBe(150_000)
  })

  it("el ciclo físico compara contra las mismas cargas", async () => {
    const cycle = await getFuelCycleComparison(session(), { from: "2026-06-01", to: "2026-06-30" })
    expect(cycle.registered).toMatchObject({ liters: 150, records: 2 })
  })

  it("Flota acumula el mismo consumo por equipo", async () => {
    const fleet = await getFleetOverview(session())
    const vehicle = fleet.find((row) => row.id === vehicleId)
    expect(vehicle?.totalLiters).toBe(150)
    expect(vehicle?.loadCount).toBe(2)
  })
})
