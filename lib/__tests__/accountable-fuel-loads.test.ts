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
import { eq } from "drizzle-orm"
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

/**
 * CO-023, ítem 7 del plan: un reset de medidor sin validar no debe alterar el
 * cálculo (sigue siendo "posible reset, verifica"), pero uno YA aceptado
 * (caso resuelto/descartado) debe cortar la ventana de comparación en ese
 * punto — de lo contrario el recorrido calculado queda mal para siempre.
 */
describe("getFleetOverview corta la ventana de comparación en un reset aceptado", () => {
  const worksiteId2 = nanoid()
  const equipmentTypeId2 = nanoid()
  const vehicleId2 = nanoid()
  const supplierId2 = nanoid()
  const productId2 = nanoid()
  const userId2 = nanoid()
  const ruleId = nanoid()
  const resetLoadId = nanoid()
  let caseId: string

  function session2(): Session {
    return {
      user: {
        id: userId2, name: "Gerencia", email: "gerencia2@example.com", roles: ["administrador"],
        permissions: ["combustibles:view", "combustibles:view_costs", "flota:view", "mantenciones:view"],
        worksiteIds: [], primaryWorksiteId: null, avatarColor: null, isActive: true, isGlobal: true,
      },
      expires: "2099-01-01T00:00:00.000Z",
    } as unknown as Session
  }

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({ id: worksiteId2, name: "Faena B", code: `FB-${nanoid().slice(0, 8)}`, isActive: true })
    await inMemoryDb.insert(schema.users).values({ id: userId2, name: "Gerencia 2", email: `g2-${nanoid()}@example.com`, hashedPassword: "x", isActive: true })
    await inMemoryDb.insert(schema.fuelProducts).values({ id: productId2, code: `DIESEL2-${nanoid().slice(0, 6)}`, name: "Diésel", category: "diesel", unit: "liter" })
    await inMemoryDb.insert(schema.fuelSuppliers).values({ id: supplierId2, name: "Copec 2" })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: equipmentTypeId2, slug: `camion2-${nanoid().slice(0, 6)}`, name: "Camión 2" })
    await inMemoryDb.insert(schema.fuelVehicles).values({
      id: vehicleId2, plate: `RS${nanoid().slice(0, 4).toUpperCase()}`, type: "camion",
      equipmentTypeId: equipmentTypeId2, worksiteId: worksiteId2, isActive: true, performanceUnit: "km_per_liter",
    })
    await inMemoryDb.insert(schema.fuelAnomalyRules).values({
      id: ruleId, code: "kilometraje_regresivo", name: "Kilometraje regresivo", severity: "high", isActive: true, config: "{}",
    })
    // Primera lectura antes del reset, la lectura del reset, y una tercera
    // lectura posterior que ya vuelve a superar la primera — el escenario
    // donde el bug se nota: sin cortar la ventana, "primera lectura" seguía
    // siendo la de antes del reset y el recorrido salía muy por debajo del real.
    await inMemoryDb.insert(schema.fuelLoads).values([
      { id: nanoid(), loadDate: "2026-06-01", month: "2026-06", serviceType: "TCT", vehicleId: vehicleId2, fuelSupplierId: supplierId2, worksiteId: worksiteId2, product: "PETROLEO DIESEL", productId: productId2, liters: 50, baseAmount: 50_000, totalAmount: 50_000, status: "registered", createdBy: userId2, odometerReading: 10_000 },
      { id: resetLoadId, loadDate: "2026-06-05", month: "2026-06", serviceType: "TCT", vehicleId: vehicleId2, fuelSupplierId: supplierId2, worksiteId: worksiteId2, product: "PETROLEO DIESEL", productId: productId2, liters: 50, baseAmount: 50_000, totalAmount: 50_000, status: "registered", createdBy: userId2, odometerReading: 1_000 },
      { id: nanoid(), loadDate: "2026-06-10", month: "2026-06", serviceType: "TCT", vehicleId: vehicleId2, fuelSupplierId: supplierId2, worksiteId: worksiteId2, product: "PETROLEO DIESEL", productId: productId2, liters: 50, baseAmount: 50_000, totalAmount: 50_000, status: "registered", createdBy: userId2, odometerReading: 15_000 },
    ])
    caseId = nanoid()
    await inMemoryDb.insert(schema.fuelAnomalyCases).values({
      id: caseId, ruleId, ruleCode: "kilometraje_regresivo", severity: "high",
      worksiteId: worksiteId2, vehicleId: vehicleId2,
      referenceEntityType: "fuel_load", referenceEntityId: resetLoadId,
      description: "Lectura de odómetro (1.000) menor que la carga anterior (10.000).",
      status: "open",
    })
  })

  it("mientras el caso está abierto, la primera lectura sigue siendo la de antes del reset", async () => {
    const fleet = await getFleetOverview(session2())
    const vehicle = fleet.find((row) => row.id === vehicleId2)
    // 15.000 - 10.000: todavía sin cortar en el reset.
    expect(vehicle?.kmDriven).toBe(5_000)
  })

  it("cerrar el caso como lectura corregida NO corta la ventana: fue un error de tipeo, no un medidor nuevo", async () => {
    await inMemoryDb.update(schema.fuelAnomalyCases)
      .set({ status: "resolved", resolutionKind: "lectura_corregida" })
      .where(eq(schema.fuelAnomalyCases.id, caseId))

    const fleet = await getFleetOverview(session2())
    const vehicle = fleet.find((row) => row.id === vehicleId2)
    // Igual que con el caso abierto: la serie del equipo sigue siendo una sola.
    expect(vehicle?.kmDriven).toBe(5_000)
  })

  it("al aceptar el reset (caso resuelto), la ventana se corta ahí y el recorrido usa la lectura del reset como base", async () => {
    await inMemoryDb.update(schema.fuelAnomalyCases)
      .set({ status: "resolved", resolutionKind: "reset_medidor" })
      .where(eq(schema.fuelAnomalyCases.id, caseId))

    const fleet = await getFleetOverview(session2())
    const vehicle = fleet.find((row) => row.id === vehicleId2)
    // 15.000 - 1.000: la primera lectura pasó a ser la del reset aceptado.
    expect(vehicle?.kmDriven).toBe(14_000)
  })
})

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
        permissions: ["combustibles:view", "combustibles:view_costs", "flota:view", "mantenciones:view"],
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
      periodoDesde: "2026-06-01", periodoHasta: "2026-06-30", importadoPor: userId3,
    })
    // Mismo día, dos horas distintas: la de las 16:00 es la lectura real más
    // reciente aunque se inserte primero.
    await inMemoryDb.insert(schema.fuelOperationRecords).values([
      { id: nanoid(), batchId: batchId3, worksiteId: worksiteId3, vehicleId: vehicleId3, plate: "TB", fecha: "2026-06-15", horaCarga: "16:00", horometro: 20_000, medidoPor: "km", liters: 40 },
      { id: nanoid(), batchId: batchId3, worksiteId: worksiteId3, vehicleId: vehicleId3, plate: "TB", fecha: "2026-06-15", horaCarga: "08:00", horometro: 19_500, medidoPor: "km", liters: 40 },
    ])
  })

  it("la lectura actual es la de las 16:00, no la primera fila insertada", async () => {
    const detail = await getFleetVehicleDetail(session3(), vehicleId3)
    expect(detail?.currentReading?.horometro).toBe(20_000)
  })
})
