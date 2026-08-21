/**
 * CO-010 / CO-011: el ciclo físico y los puntos de carga TAE sólo pueden
 * referenciar activos de su propia faena. Antes el formulario era la única
 * barrera: un POST directo enlazaba un punto con la vasija de otra faena, o
 * descontaba litros de una faena anotándoselos al equipo de otra.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
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

const { createFuelCycleMovement } = await import("@/lib/combustibles/fuel-cycle")

const worksiteA = nanoid()
const worksiteB = nanoid()
const productId = nanoid()
const otherProductId = nanoid()
const equipmentTypeId = nanoid()
const vehicleInA = nanoid()
const vehicleInB = nanoid()
const inactiveVehicle = nanoid()
const storageInA = nanoid()
const userId = nanoid()
const actor = { userId }

const movement = (overrides: Record<string, unknown>) => ({
  eventType: "tank_delivery",
  worksiteId: worksiteA,
  productId,
  quantity: 10,
  occurredAt: "2026-08-20T12:00:00.000Z",
  sourceLocationId: storageInA,
  vehicleId: vehicleInA,
  ...overrides,
})

describe("invariantes de faena y producto del ciclo físico", () => {
  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values([
      { id: worksiteA, name: "Faena A", code: `FA-${nanoid().slice(0, 8)}`, isActive: true },
      { id: worksiteB, name: "Faena B", code: `FB-${nanoid().slice(0, 8)}`, isActive: true },
    ])
    await inMemoryDb.insert(schema.users).values({ id: userId, name: "Operador", email: `op-${nanoid()}@example.com`, hashedPassword: "x", isActive: true })
    await inMemoryDb.insert(schema.fuelProducts).values([
      { id: productId, code: `DIESEL-${nanoid().slice(0, 6)}`, name: "Diésel", category: "diesel", unit: "liter" },
      { id: otherProductId, code: `BENC-${nanoid().slice(0, 6)}`, name: "Bencina", category: "gasoline", unit: "liter" },
    ])
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: equipmentTypeId, slug: `camion-${nanoid().slice(0, 6)}`, name: "Camión" })
    await inMemoryDb.insert(schema.fuelVehicles).values([
      { id: vehicleInA, plate: `AA${nanoid().slice(0, 4).toUpperCase()}`, type: "camion", equipmentTypeId, worksiteId: worksiteA, isActive: true },
      { id: vehicleInB, plate: `BB${nanoid().slice(0, 4).toUpperCase()}`, type: "camion", equipmentTypeId, worksiteId: worksiteB, isActive: true },
      { id: inactiveVehicle, plate: `CC${nanoid().slice(0, 4).toUpperCase()}`, type: "camion", equipmentTypeId, worksiteId: worksiteA, isActive: false },
    ])
    await inMemoryDb.insert(schema.fuelVehicleProducts).values([
      { vehicleId: vehicleInA, productId },
      { vehicleId: vehicleInB, productId },
      { vehicleId: inactiveVehicle, productId },
    ])
    await inMemoryDb.insert(schema.fuelStorageLocations).values({ id: storageInA, worksiteId: worksiteA, productId, name: "Estanque A", capacityLiters: 1000, isActive: true })
  })

  it("acepta un movimiento con equipo, vasija y producto de la misma faena", async () => {
    const result = await createFuelCycleMovement(movement({}), actor)
    expect(result.id).toBeTruthy()
  })

  it("rechaza un equipo de otra faena", async () => {
    await expect(createFuelCycleMovement(movement({ vehicleId: vehicleInB }), actor))
      .rejects.toThrow("El equipo no corresponde a la faena o está inactivo")
  })

  it("rechaza un equipo dado de baja", async () => {
    await expect(createFuelCycleMovement(movement({ vehicleId: inactiveVehicle }), actor))
      .rejects.toThrow("El equipo no corresponde a la faena o está inactivo")
  })

  it("rechaza un producto que el equipo no admite", async () => {
    await inMemoryDb.insert(schema.fuelStorageLocations).values({
      id: "storage-otro-producto", worksiteId: worksiteA, productId: otherProductId, name: "Estanque bencina", isActive: true,
    })
    await expect(createFuelCycleMovement(
      movement({ productId: otherProductId, sourceLocationId: "storage-otro-producto" }),
      actor,
    )).rejects.toThrow("El equipo no admite el producto seleccionado")
  })

  it("no deja rastro cuando la validación falla", async () => {
    const before = await inMemoryDb.select().from(schema.fuelCycleMovements)
    await expect(createFuelCycleMovement(movement({ vehicleId: vehicleInB }), actor)).rejects.toThrow()
    const after = await inMemoryDb.select().from(schema.fuelCycleMovements)
    expect(after).toHaveLength(before.length)
  })
})
