/**
 * `COM-002` (auditoría 2026-09-14): «La casilla "el medidor fue reemplazado"
 * desactiva la validación de lectura y no queda registrada» (S2/P1).
 *
 * La validación en la acción es la que le habla al operador; esta es la que
 * impide que la declaración entre a la tabla por otro camino —un importador, un
 * script de corrección, una migración de datos—. Antes ni siquiera existía la
 * columna: `grep meter_replaced` no encontraba nada, así que apagar el control
 * de regresión del odómetro no dejaba rastro en la fila y la carga quedaba
 * indistinguible de una lectura normal.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })

const ACTOR_ID = "com002-actor"
const WORKSITE_ID = "com002-worksite"
const PRODUCT_ID = "com002-product"
const SUPPLIER_ID = "com002-supplier"
const VEHICLE_ID = "com002-vehicle"
const EQUIPMENT_TYPE_ID = "com002-equipment-type"

function loadRow(id: string, extra: Record<string, unknown>) {
  return {
    id, loadDate: "2026-09-14", month: "2026-09", serviceType: "TCT",
    vehicleId: VEHICLE_ID, fuelSupplierId: SUPPLIER_ID, worksiteId: WORKSITE_ID,
    product: "PETROLEO DIESEL", productId: PRODUCT_ID, liters: 100,
    baseAmount: 1_000, iecFixed: 0, iecVariable: 0, iecTotal: 0, ivaAmount: 190, totalAmount: 1_190,
    createdBy: ACTOR_ID,
    ...extra,
  } as typeof schema.fuelLoads.$inferInsert
}

/**
 * El error de Drizzle sólo trae el SQL; el nombre del CHECK viaja en la causa
 * que levanta Postgres. Sin mirarla, la prueba pasaría con cualquier fallo de
 * inserción y no probaría nada.
 */
async function checkViolation(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause ?? error
    return `${(cause as { constraint?: string }).constraint ?? ""} ${(cause as Error).message ?? ""}`
  }
  throw new Error("La inserción no fue rechazada")
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await inMemoryDb.insert(schema.users).values({
    id: ACTOR_ID, name: "Operador", email: "operador-com002@example.test", hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values({ id: WORKSITE_ID, name: "Faena", code: "F-COM002", isActive: true })
  await inMemoryDb.insert(schema.fuelProducts).values({ id: PRODUCT_ID, code: "COM002-DIESEL", name: "Diésel", category: "diesel", unit: "liter" })
  await inMemoryDb.insert(schema.fuelSuppliers).values({ id: SUPPLIER_ID, name: "Proveedor" })
  await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: EQUIPMENT_TYPE_ID, slug: "com002-camion", name: "Camión" })
  await inMemoryDb.insert(schema.fuelVehicles).values({
    id: VEHICLE_ID, plate: "COM-002", type: "camion", equipmentTypeId: EQUIPMENT_TYPE_ID,
    worksiteId: WORKSITE_ID, isActive: true,
  })
})

describe("COM-002 · la declaración de medidor reemplazado vive en la fila", () => {
  it("una carga normal queda declarada como sin reemplazo", async () => {
    await inMemoryDb.insert(schema.fuelLoads).values(loadRow("com002-normal", {}))
    const row = await inMemoryDb.query.fuelLoads.findFirst({
      where: (loads, { eq }) => eq(loads.id, "com002-normal"),
    })
    expect(row?.meterReplaced).toBe(false)
    expect(row?.meterReplacementReason).toBeNull()
  })

  it("rechaza declarar un reemplazo sin motivo", async () => {
    expect(await checkViolation(inMemoryDb.insert(schema.fuelLoads).values(
      loadRow("com002-sin-motivo", { meterReplaced: true }),
    ))).toContain("fuel_loads_meter_replacement_justified")
  })

  it("rechaza un motivo por debajo del umbral único de la plataforma", async () => {
    expect(await checkViolation(inMemoryDb.insert(schema.fuelLoads).values(
      loadRow("com002-motivo-corto", { meterReplaced: true, meterReplacementReason: "   ok   " }),
    ))).toContain("fuel_loads_meter_replacement_justified")
  })

  it("rechaza un motivo sin reemplazo declarado: la fila no puede afirmar lo que nadie declaró", async () => {
    expect(await checkViolation(inMemoryDb.insert(schema.fuelLoads).values(
      loadRow("com002-motivo-huerfano", { meterReplaced: false, meterReplacementReason: "Cambiamos el odómetro" }),
    ))).toContain("fuel_loads_meter_replacement_justified")
  })

  it("acepta el reemplazo declarado y explicado", async () => {
    await inMemoryDb.insert(schema.fuelLoads).values(loadRow("com002-declarado", {
      meterReplaced: true, meterReplacementReason: "Odómetro nuevo instalado por el taller, acta 4471",
    }))
    const row = await inMemoryDb.query.fuelLoads.findFirst({
      where: (loads, { eq }) => eq(loads.id, "com002-declarado"),
    })
    expect(row?.meterReplaced).toBe(true)
    expect(row?.meterReplacementReason).toContain("acta 4471")
  })
})
