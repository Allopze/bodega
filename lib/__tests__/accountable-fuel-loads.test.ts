/**
 * CO-014: reportes, ciclo, Flota, analítica y estados de cuenta cerraban el
 * mismo mes con cifras distintas porque cada superficie decidía por su cuenta
 * qué estados contaban. Esta prueba fija el predicado canónico y comprueba que
 * el ciclo lo usa: una carga en borrador y una anulada no pueden moverlo. (Flota
 * dejó de leer `fuel_loads` para litros y costo en C-9: ahora suma el libro del
 * proveedor con la regla canónica de `fleet-fuel-provider.test.ts`.) La pantalla
 * de reportes se retiró junto con su consulta, y con ella su caso aquí.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { nanoid } from "@/lib/id"
import { chileDateParts } from "@/lib/utils"

/* Las cargas se siembran en el mes en curso y no en junio de 2026:
 * `getFleetOverview` sólo mira los últimos 12 meses
 * (`FLEET_OVERVIEW_LOOKBACK_MONTHS`), así que una fecha fija se cae de la
 * ventana al cumplirse el año y los tests pasan a medir cero sin que nada
 * cambie en el código. */
const { year: PERIOD_YEAR, month: PERIOD_MONTH } = chileDateParts()
const MONTH = `${PERIOD_YEAR}-${String(PERIOD_MONTH).padStart(2, "0")}`
/** Día del mes en curso. Se usan sólo días ≤ 15, válidos en cualquier mes. */
const dayOf = (day: number) => `${MONTH}-${String(day).padStart(2, "0")}`

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
const { getFuelCycleComparison } = await import("@/lib/combustibles/fuel-cycle")
const { getFleetOverview, getFleetVehicleDetail } = await import("@/lib/services/fleet")

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
      permissions: ["combustibles:view", "combustibles:view_costs", "flota:view"],
      worksiteIds: [], primaryWorksiteId: null, avatarColor: null, isActive: true, isGlobal: true,
    },
    expires: "2099-01-01T00:00:00.000Z",
  } as unknown as Session
}

const load = (status: string, liters: number, amount: number) => ({
  id: nanoid(), loadDate: dayOf(10), month: MONTH, serviceType: "TCT", vehicleId,
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

  it("el ciclo físico compara contra las mismas cargas", async () => {
    const cycle = await getFuelCycleComparison(session(), { from: dayOf(1), to: dayOf(28) })
    expect(cycle.registered).toMatchObject({ liters: 150, records: 2 })
  })

  // C-9: los litros, el costo y las cargas de Flota salen del libro del proveedor (Copec), no de la
  // serie facturada `fuel_loads` —vacía en producción—; ver `fleet-fuel-provider.test.ts`. Tampoco sus
  // lecturas de medidor (`fleet-meter-readings.test.ts`), así que aquí queda fijado que ninguna carga
  // facturada, contable o no, se cuela en sus cifras de combustible.
  it("Flota no suma la serie facturada: sus cifras de combustible vienen del proveedor", async () => {
    const fleet = await getFleetOverview(session())
    const vehicle = fleet.find((row) => row.id === vehicleId)
    expect(vehicle?.totalLiters).toBe(0)
    expect(vehicle?.totalFuelAmount).toBe(0)
    expect(vehicle?.loadCount).toBe(0)
  })
})

/*
 * CO-023, ítem 7 («un reset de medidor aceptado corta la ventana de comparación») vivía acá sobre
 * `fuel_loads`. Flota dejó de leer lecturas de esa serie —vacía en producción— y las toma del
 * detalle de Copec (`fuel_meter_readings`); el caso quedó cubierto, con el mismo escenario
 * (abierto / lectura corregida / reset aceptado / descartado), en `fleet-meter-readings.test.ts`.
 */

/**
 * CO-023: dos cargas del mismo día devolvían un ganador arbitrario como
 * "última lectura" porque `fecha` (sólo día) no las distingue. El desempate
 * por `horaCarga`/`createdAt` tiene que elegir la más tardía, no la que
 * Postgres devuelva primero por casualidad de orden físico.
 */
describe("getFleetVehicleDetail desempata dos lecturas del mismo día por hora", () => {
  const worksiteId3 = nanoid()
  const equipmentTypeId3 = nanoid()
  const vehicleId3 = nanoid()
  const userId3 = nanoid()
  const batchId3 = nanoid()

  function session3(): Session {
    return {
      user: {
        id: userId3, name: "Gerencia", email: "gerencia3@example.com", roles: ["administrador"],
        permissions: ["combustibles:view", "combustibles:view_costs", "flota:view"],
        worksiteIds: [], primaryWorksiteId: null, avatarColor: null, isActive: true, isGlobal: true,
      },
      expires: "2099-01-01T00:00:00.000Z",
    } as unknown as Session
  }

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({ id: worksiteId3, name: "Faena C", code: `FC-${nanoid().slice(0, 8)}`, isActive: true })
    await inMemoryDb.insert(schema.users).values({ id: userId3, name: "Gerencia 3", email: `g3-${nanoid()}@example.com`, hashedPassword: "x", isActive: true })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: equipmentTypeId3, slug: `camion3-${nanoid().slice(0, 6)}`, name: "Camión 3" })
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: vehicleId3, plate: `TB${nanoid().slice(0, 4).toUpperCase()}`, type: "camion",
      equipmentTypeId: equipmentTypeId3, worksiteId: worksiteId3, isActive: true,
    })
    await inMemoryDb.insert(schema.fuelOperationBatches).values({
      id: batchId3, archivoNombre: "desempate.xlsx", hashArchivo: nanoid(),
      periodoDesde: dayOf(1), periodoHasta: dayOf(28), importadoPor: userId3,
    })
    // Mismo día, dos horas distintas: la de las 16:00 es la lectura real más
    // reciente aunque se inserte primero.
    await inMemoryDb.insert(schema.fuelOperationRecords).values([
      { id: nanoid(), batchId: batchId3, worksiteId: worksiteId3, vehicleId: vehicleId3, plate: "TB", fecha: dayOf(15), horaCarga: "16:00", horometro: 20_000, medidoPor: "km", liters: 40 },
      { id: nanoid(), batchId: batchId3, worksiteId: worksiteId3, vehicleId: vehicleId3, plate: "TB", fecha: dayOf(15), horaCarga: "08:00", horometro: 19_500, medidoPor: "km", liters: 40 },
    ])
  })

  it("la lectura actual es la de las 16:00, no la primera fila insertada", async () => {
    const detail = await getFleetVehicleDetail(session3(), vehicleId3)
    expect(detail?.currentReading?.horometro).toBe(20_000)
  })
})
