/**
 * `MNT-002` (auditoría 2026-09-14): «Los repuestos consumidos en una OT no
 * descuentan stock» (S2/P1).
 *
 * Antes, la línea de repuesto era texto libre —descripción, código, cantidad,
 * unidad, costo— sin referencia al catálogo, y ningún tipo de movimiento del
 * kardex correspondía a una mantención. El circuito quedaba abierto por un
 * lado: el repuesto comprado por Solicitudes → OC → Recepción **sumaba**
 * existencias en la faena y su consumo en la orden de trabajo no las restaba
 * nunca. La bodega sobreestimaba el inventario de repuestos de forma
 * permanente y el único remedio era un ajuste manual.
 *
 * Estas pruebas corren sobre Postgres real (PGlite) porque lo que hay que
 * demostrar es el saldo: que el egreso existe, que descuenta, y que cuando no
 * alcanza no queda ni línea ni movimiento a medias.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import type { DB } from "@/db"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))
vi.mock("@/lib/auth/auth", () => ({ auth: vi.fn() }))
// La notificación de la OT consulta destinatarios por permiso; acá no aporta.
vi.mock("@/lib/services/notification-targeting", () => ({
  getUserIdsWithPermission: vi.fn(async () => [] as string[]),
  getUserIdsWithPermissionForWorksite: vi.fn(async () => [] as string[]),
}))

const { addMaintenancePart } = await import("@/lib/services/maintenance")

const ACTOR_ID = "mnt002-actor"
const WORKSITE_ID = "mnt002-worksite"
const PRODUCT_ID = "mnt002-product"
const VEHICLE_ID = "mnt002-vehicle"
const EQUIPMENT_TYPE_ID = "mnt002-equipment-type"
const ORDER_ID = "mnt002-order"

const session = {
  user: {
    id: ACTOR_ID,
    email: "mecanico@example.test",
    isGlobal: true,
    worksiteIds: [],
    permissions: ["mantenciones:edit", "combustibles:view_costs"],
  },
} as unknown as Session

async function stockAt(productId: string) {
  const [row] = await inMemoryDb
    .select({ quantity: schema.worksiteStock.quantity })
    .from(schema.worksiteStock)
    .where(and(
      eq(schema.worksiteStock.worksiteId, WORKSITE_ID),
      eq(schema.worksiteStock.productId, productId),
    ))
  return row?.quantity ?? 0
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

  await inMemoryDb.insert(schema.users).values({
    id: ACTOR_ID, name: "Mecánico", email: "mecanico@example.test", hashedPassword: "x", isActive: true,
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: WORKSITE_ID, name: "Faena Taller", code: "F-MNT002", isActive: true,
  })
  await inMemoryDb.insert(schema.productCategories).values({
    id: "mnt002-category", name: "Repuestos", slug: "mnt002-repuestos", sortOrder: 1,
  })
  await inMemoryDb.insert(schema.products).values({
    id: PRODUCT_ID, sku: "FIL-ACE-01", name: "Filtro de aceite", categoryId: "mnt002-category",
    unitOfMeasure: "unidad", isActive: true,
  })
  await inMemoryDb.insert(schema.fuelEquipmentTypes).values({
    id: EQUIPMENT_TYPE_ID, slug: "mnt002-camion", name: "Camión",
  })
  await inMemoryDb.insert(schema.fuelVehicles).values({
    id: VEHICLE_ID, plate: "MNT-002", type: "camion", equipmentTypeId: EQUIPMENT_TYPE_ID,
    worksiteId: WORKSITE_ID, isActive: true,
  })
  await inMemoryDb.insert(schema.maintenanceRecords).values({
    id: ORDER_ID, code: "OT-2026-0002", vehicleId: VEHICLE_ID, worksiteId: WORKSITE_ID,
    maintenanceType: "correctiva", maintenanceDate: "2026-09-14", status: "in_progress",
    createdBy: ACTOR_ID,
  })
  // La recepción de la compra ya sumó 10 filtros en la faena.
  await inMemoryDb.insert(schema.worksiteStock).values({
    id: "mnt002-stock", worksiteId: WORKSITE_ID, productId: PRODUCT_ID, quantity: 10, minStock: 0,
  })
})

describe("MNT-002 · el repuesto consumido en una OT descuenta stock", () => {
  it("descuenta de la faena de la orden y deja el egreso en el kardex", async () => {
    expect(await stockAt(PRODUCT_ID)).toBe(10)

    const partId = await addMaintenancePart(session, {
      maintenanceId: ORDER_ID,
      productId: PRODUCT_ID,
      description: "Filtro de aceite",
      partNumber: null,
      quantity: 3,
      unit: "un",
      unitCost: 12_000,
    })

    // Antes del arreglo el saldo seguía en 10: la línea se insertaba y el
    // kardex ni se enteraba.
    expect(await stockAt(PRODUCT_ID)).toBe(7)

    const movements = await inMemoryDb
      .select()
      .from(schema.inventoryMovements)
      .where(eq(schema.inventoryMovements.referenceId, partId))
    expect(movements).toHaveLength(1)
    expect(movements[0]).toMatchObject({
      type: "egreso_mantencion",
      referenceType: "maintenance_part",
      worksiteId: WORKSITE_ID,
      productId: PRODUCT_ID,
      quantity: -3,
      stockBefore: 10,
      stockAfter: 7,
    })

    // La línea queda amarrada al producto: sin eso, el consumo no es auditable
    // contra el catálogo.
    const [part] = await inMemoryDb
      .select({ productId: schema.maintenanceParts.productId })
      .from(schema.maintenanceParts)
      .where(eq(schema.maintenanceParts.id, partId))
    expect(part?.productId).toBe(PRODUCT_ID)
  })

  it("rechaza el consumo sin saldo y no deja ni línea ni movimiento a medias", async () => {
    const before = await stockAt(PRODUCT_ID)
    const partsBefore = await inMemoryDb.select().from(schema.maintenanceParts)

    // Precedente del repo: una operación que dejaría saldo negativo se rechaza
    // con un mensaje que dice cuál es el remedio (ver `registerStockDocument`).
    await expect(addMaintenancePart(session, {
      maintenanceId: ORDER_ID,
      productId: PRODUCT_ID,
      description: "Filtro de aceite",
      partNumber: null,
      quantity: before + 5,
      unit: "un",
      unitCost: 12_000,
    })).rejects.toThrow(/Stock insuficiente[\s\S]*Registra primero la recepción/)

    expect(await stockAt(PRODUCT_ID)).toBe(before)
    expect(await inMemoryDb.select().from(schema.maintenanceParts)).toHaveLength(partsBefore.length)
  })

  it("la pieza que nunca pasó por bodega se imputa sin tocar el kardex", async () => {
    const before = await stockAt(PRODUCT_ID)
    const movementsBefore = await inMemoryDb.select().from(schema.inventoryMovements)

    // Caso legítimo y deliberado: el taller externo factura una pieza que no
    // salió del inventario. Es costo de la OT, no un egreso de stock.
    await addMaintenancePart(session, {
      maintenanceId: ORDER_ID,
      productId: null,
      description: "Retén de bomba provisto por el taller",
      partNumber: "RB-9",
      quantity: 1,
      unit: "un",
      unitCost: 30_000,
    })

    expect(await stockAt(PRODUCT_ID)).toBe(before)
    expect(await inMemoryDb.select().from(schema.inventoryMovements)).toHaveLength(movementsBefore.length)
  })
})
