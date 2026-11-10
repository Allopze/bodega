/**
 * Compras vinculadas a un vehículo (2026-11-07): lo que la ficha del equipo y la
 * de flota muestran bajo «Repuestos y servicios comprados». Postgres real
 * (PGlite con todas las migraciones).
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import type { DB, Tx } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema })
const testGlobal = globalThis as unknown as { __db?: typeof testDb }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))
vi.mock("@/lib/email/smtp", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { IDS, seedMantFixtures } = await import("./mantencion-sync-fixtures")
const { createWorkOrderWithClient } = await import("@/lib/services/mantencion/work-orders/create")
const { getVehiclePurchaseHistory } = await import("@/lib/services/vehicle-purchase-history")
const { createSparePartTx } = await import("@/lib/services/spare-parts-catalog")

const now = new Date().toISOString()
let workOrderId = ""
let workOrderFolio = ""

async function insertRequest(id: string, type = "repuestos") {
  await testDb.insert(schema.purchaseRequests).values({
    id, code: `${type === "repuestos" ? "REP" : "SRV"}-${id}`, worksiteId: IDS.wsBio, requesterId: IDS.jefe, requestType: type,
    status: "approved", urgency: "normal", deliveryMode: "directo_faena", createdAt: now, updatedAt: now,
  })
}

async function insertItem(id: string, requestId: string, over: Partial<typeof schema.purchaseRequestItems.$inferInsert>) {
  await testDb.insert(schema.purchaseRequestItems).values({
    id, requestId, productNameFree: `Repuesto ${id}`, quantity: 2, unitOfMeasure: "unidad", status: "purchased",
    vehicleId: IDS.truckBio, createdAt: now, updatedAt: now, ...over,
  })
}

async function insertOrder(id: string, itemId: string, over: Partial<typeof schema.purchaseOrders.$inferInsert> = {}) {
  await testDb.insert(schema.purchaseOrders).values({
    id, code: `OC-${id}`, worksiteId: IDS.wsBio, supplierId: "sup-h", createdBy: IDS.jefe, status: "sent",
    deliveryMode: "directo_faena", createdAt: now, updatedAt: now, ...over,
  })
  await testDb.insert(schema.purchaseOrderItems).values({
    id: `${id}-line`, purchaseOrderId: id, requestItemId: itemId, quantity: 2, unitOfMeasure: "unidad",
    unitPrice: 20_000, subtotal: 40_000, sortOrder: 0,
  })
}

describe("getVehiclePurchaseHistory", () => {
  beforeAll(async () => {
    await seedMantFixtures(testDb as unknown as DB)
    await testDb.insert(schema.suppliers).values({
      id: "sup-h", name: "Repuestos del Sur", rut: "76.000.333-3", isActive: true, createdAt: now, updatedAt: now,
    })
    const created = await testDb.transaction((tx) => createWorkOrderWithClient(tx as never, {
      vehicleId: IDS.truckBio, inspectionFindingId: null, repair: true, maintenance: false,
      repairDescription: "Fuga hidráulica", observations: null, requesterName: "Alexis Morales",
    }, { userId: IDS.jefe, name: "Alexis Morales" }))
    workOrderId = created.id
    workOrderFolio = created.folio
  })

  afterAll(async () => {
    await pg.close()
  })

  it("lista las compras del vehículo con OC, folio de OT y precio, más reciente primero", async () => {
    await insertRequest("r-old")
    await insertItem("i-old", "r-old", { productNameFree: "Filtro hidráulico", workOrderId, createdAt: "2026-10-01T12:00:00.000Z" })
    await insertOrder("oc-old", "i-old")
    await insertRequest("r-new", "servicios")
    await insertItem("i-new", "r-new", { productNameFree: "Alineación", status: "approved", createdAt: "2026-11-02T12:00:00.000Z" })
    // Otro equipo: no aparece.
    await insertRequest("r-other")
    await insertItem("i-other", "r-other", { vehicleId: IDS.machineBio, createdAt: "2026-11-03T12:00:00.000Z" })

    const history = await getVehiclePurchaseHistory(IDS.truckBio)

    expect(history.map((record) => record.requestItemId)).toEqual(["i-new", "i-old"])
    expect(history[1]).toMatchObject({
      requestId: "r-old", requestCode: "REP-r-old", requestType: "repuestos",
      itemName: "Filtro hidráulico", quantity: 2, unitOfMeasure: "unidad",
      itemStatus: "purchased", itemStatusLabel: expect.any(String),
      workOrderId, workOrderFolio,
      requesterName: "Alexis Morales",
      orderId: "oc-old", orderCode: "OC-oc-old", orderStatus: "sent",
      unitPrice: 20_000, subtotal: 40_000,
    })
    expect(history[1]!.itemStatusLabel).not.toBe("purchased")
    // Sin OC todavía: ni orden ni costo, y sin OT.
    expect(history[0]).toMatchObject({
      requestType: "servicios", itemName: "Alineación", workOrderId: null, workOrderFolio: null,
      orderId: null, orderCode: null, orderStatus: null, unitPrice: null, subtotal: null,
    })
  })

  it("una OC anulada o eliminada deja la línea sin OC", async () => {
    await insertRequest("r-cancelled")
    await insertItem("i-cancelled", "r-cancelled", { vehicleId: IDS.truckCho, createdAt: "2026-11-04T12:00:00.000Z" })
    await insertOrder("oc-cancelled", "i-cancelled", { status: "cancelled" })
    await insertRequest("r-deleted")
    await insertItem("i-deleted", "r-deleted", { vehicleId: IDS.truckCho, createdAt: "2026-11-05T12:00:00.000Z" })
    await insertOrder("oc-deleted", "i-deleted", { deletedAt: now })
    // Control: la OC vigente de otra línea del mismo equipo sigue apareciendo.
    await insertRequest("r-live")
    await insertItem("i-live", "r-live", { vehicleId: IDS.truckCho, createdAt: "2026-11-06T12:00:00.000Z" })
    await insertOrder("oc-live", "i-live")

    const history = await getVehiclePurchaseHistory(IDS.truckCho)

    const byItem = new Map(history.map((record) => [record.requestItemId, record]))
    expect(byItem.get("i-live")).toMatchObject({ orderId: "oc-live", subtotal: 40_000 })
    for (const id of ["i-cancelled", "i-deleted"]) {
      expect(byItem.get(id)).toMatchObject({ orderId: null, orderCode: null, orderStatus: null, unitPrice: null, subtotal: null })
    }
  })

  it("respeta el límite y deja afuera los vínculos de otros equipos", async () => {
    const history = await getVehiclePurchaseHistory(IDS.truckBio, 1)
    expect(history).toHaveLength(1)
    expect(history[0]!.requestItemId).toBe("i-new")
    expect(await getVehiclePurchaseHistory("v-inexistente")).toEqual([])
    // La línea del vehículo B no se contaminó con la de A.
    const [item] = await testDb.select({ vehicleId: schema.purchaseRequestItems.vehicleId }).from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.id, "i-other"))
    expect(item!.vehicleId).toBe(IDS.machineBio)
  })

  describe("identidad del producto (catálogo de repuestos)", () => {
    let sparePartId = ""
    let sparePartSku = ""
    let serviceId = ""

    beforeAll(async () => {
      const part = await testDb.transaction((tx) => createSparePartTx(tx as unknown as Tx, {
        name: "Filtro de aceite", partNumber: "1R-0750", partBrand: "Caterpillar", unitOfMeasure: "unidad", createdByUserId: IDS.jefe,
      }))
      sparePartId = part.id
      sparePartSku = part.sku
      await testDb.insert(schema.productCategories).values({
        id: "cat-hist-servicios", name: "Servicios (historial)", slug: "servicios-historial", isEpp: false, requiresPrevencion: false, sortOrder: 1,
      })
      serviceId = "prod-hist-servicio"
      await testDb.insert(schema.products).values({
        id: serviceId, sku: "SRV-H-1", name: "Alineación", categoryId: "cat-hist-servicios", unitOfMeasure: "unidad", isService: true,
      })
    })

    it("trae producto, SKU, N° de parte y si es repuesto de catálogo; el texto libre no trae nada de eso", async () => {
      await insertRequest("r-cat")
      await insertItem("i-cat", "r-cat", { vehicleId: IDS.truckAra, productId: sparePartId, productNameFree: null, createdAt: "2026-11-02T12:00:00.000Z" })
      await insertRequest("r-free")
      await insertItem("i-free", "r-free", { vehicleId: IDS.truckAra, productNameFree: "Sello de pistón", createdAt: "2026-11-01T12:00:00.000Z" })
      await insertRequest("r-srv", "servicios")
      await insertItem("i-srv", "r-srv", { vehicleId: IDS.truckAra, productId: serviceId, productNameFree: null, createdAt: "2026-10-31T12:00:00.000Z" })

      const byItem = new Map((await getVehiclePurchaseHistory(IDS.truckAra)).map((record) => [record.requestItemId, record]))

      expect(byItem.get("i-cat")).toMatchObject({
        itemName: "Filtro de aceite", productId: sparePartId, sku: sparePartSku, partNumber: "1R-0750", isSparePart: true,
      })
      expect(byItem.get("i-free")).toMatchObject({
        itemName: "Sello de pistón", productId: null, sku: null, partNumber: null, isSparePart: false,
      })
      // Un servicio de catálogo es producto (tiene SKU) pero no tiene ficha de repuesto a la cual enlazar.
      expect(byItem.get("i-srv")).toMatchObject({ productId: serviceId, sku: "SRV-H-1", partNumber: null, isSparePart: false })
    })

    it("un pedido en texto libre que Compras catalogó en la OC toma el repuesto de la línea de OC", async () => {
      await insertRequest("r-oc-cat")
      await insertItem("i-oc-cat", "r-oc-cat", { vehicleId: IDS.truckAra, productNameFree: "filtro aceite motor", createdAt: "2026-11-03T12:00:00.000Z" })
      await insertOrder("oc-cat", "i-oc-cat")
      await testDb.update(schema.purchaseOrderItems).set({ productId: sparePartId }).where(eq(schema.purchaseOrderItems.id, "oc-cat-line"))

      const record = (await getVehiclePurchaseHistory(IDS.truckAra)).find((row) => row.requestItemId === "i-oc-cat")

      expect(record).toMatchObject({ productId: sparePartId, sku: sparePartSku, partNumber: "1R-0750", isSparePart: true, orderId: "oc-cat" })
    })

    it("el repuesto catalogado en una OC anulada no cuenta: la línea vuelve a ser texto libre", async () => {
      await insertRequest("r-oc-void")
      await insertItem("i-oc-void", "r-oc-void", { vehicleId: IDS.truckAra, productNameFree: "filtro aceite motor", createdAt: "2026-11-04T12:00:00.000Z" })
      await insertOrder("oc-void", "i-oc-void", { status: "cancelled" })
      await testDb.update(schema.purchaseOrderItems).set({ productId: sparePartId }).where(eq(schema.purchaseOrderItems.id, "oc-void-line"))

      const record = (await getVehiclePurchaseHistory(IDS.truckAra)).find((row) => row.requestItemId === "i-oc-void")

      expect(record).toMatchObject({ itemName: "filtro aceite motor", productId: null, sku: null, isSparePart: false, orderId: null })
    })
  })
})
