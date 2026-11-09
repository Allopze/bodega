/**
 * Catálogo de repuestos (fase 2, 2026-11-09), tareas T7 y T8, contra Postgres
 * real (PGlite con todas las migraciones):
 *
 *  - T7: al armar la OC, una línea de repuesto pedida en texto libre se vincula a
 *    un repuesto del catálogo. El `productId` llega a la línea de la OC, al ítem
 *    de solicitud de origen y al remanente de una compra parcial, en la misma
 *    transacción; un producto que no es repuesto (o está inactivo) se rechaza y
 *    no deja rastro.
 *  - T8: al emitir la OC (`draft → sent`) cada línea de repuesto registra su
 *    precio con el proveedor, con fuente `purchase_order`. EPP y texto libre no.
 *  - Revisión final: eliminar o anular la OC deshace el vínculo que ella hizo
 *    (no el que eligió quien pidió); el vínculo exige la unidad del repuesto y
 *    un repuesto no admite movimientos de bodega.
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { and, asc, eq } from "drizzle-orm"
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
const catalog = await import("@/lib/services/spare-parts-catalog")
const { createOrder, issueAndSendOrder, cancelOrder, deleteOrder } = await import("@/lib/services/purchasing")
const { applyMovementTx } = await import("@/lib/services/stock-movement")

const now = new Date().toISOString()
let seq = 0

async function createPart(name: string, partNumber: string, unitOfMeasure = "unidad") {
  return testDb.transaction((tx) => catalog.createSparePartTx(tx as unknown as Tx, {
    name, partNumber, unitOfMeasure, createdByUserId: IDS.jefe,
  }))
}

/** Solicitud de un ítem sin producto (texto libre), lista para comprar. */
async function freeTextItem(opts: { quantity?: number; requestType?: string; productId?: string | null; unitOfMeasure?: string } = {}) {
  seq += 1
  const requestId = `r-${seq}`
  const itemId = `i-${seq}`
  await testDb.insert(schema.purchaseRequests).values({
    id: requestId, code: `REP-L-${seq}`, worksiteId: IDS.wsBio, requesterId: IDS.jefe,
    requestType: opts.requestType ?? "repuestos", status: "approved", urgency: "normal",
    deliveryMode: "directo_faena", createdAt: now, updatedAt: now,
  })
  await testDb.insert(schema.purchaseRequestItems).values({
    id: itemId, requestId, productId: opts.productId ?? null, productNameFree: "Filtro de aire", quantity: opts.quantity ?? 2,
    unitOfMeasure: opts.unitOfMeasure ?? "unidad", status: "approved", vehicleId: IDS.truckBio, createdAt: now, updatedAt: now,
  })
  return { requestId, itemId }
}

function line(requestItemId: string, over: Partial<Parameters<typeof createOrder>[0]["items"][number]> = {}) {
  return {
    requestItemId, productId: null, productNameFree: "Filtro de aire", quantity: 2,
    unitOfMeasure: "unidad", unitPrice: 10_000, ...over,
  }
}

async function orderFor(requestItemId: string, productId: string | null, over: { unitPrice?: number | null; discount?: number; quantity?: number; supplierId?: string; unitOfMeasure?: string } = {}) {
  return createOrder({
    worksiteId: IDS.wsBio, supplierId: over.supplierId ?? "sup-a", createdBy: IDS.jefe,
    items: [line(requestItemId, { productId, unitPrice: over.unitPrice === undefined ? 10_000 : over.unitPrice, discount: over.discount, quantity: over.quantity ?? 2, unitOfMeasure: over.unitOfMeasure ?? "unidad" })],
  })
}

async function requestItem(id: string) {
  const [row] = await testDb.select().from(schema.purchaseRequestItems).where(eq(schema.purchaseRequestItems.id, id))
  return row!
}

async function ocLines(orderId: string) {
  return testDb.select().from(schema.purchaseOrderItems).where(eq(schema.purchaseOrderItems.purchaseOrderId, orderId))
}

async function priceHistory(productId: string) {
  return testDb.select().from(schema.productSupplierPriceHistory)
    .where(eq(schema.productSupplierPriceHistory.productId, productId))
    .orderBy(asc(schema.productSupplierPriceHistory.createdAt), asc(schema.productSupplierPriceHistory.id))
}

async function supplierPrice(productId: string, supplierId = "sup-a") {
  const [row] = await testDb.select().from(schema.productSuppliers)
    .where(and(eq(schema.productSuppliers.productId, productId), eq(schema.productSuppliers.supplierId, supplierId)))
  return row ?? null
}

describe("catálogo de repuestos · vincular al armar la OC y precio al emitir", () => {
  let partA: { id: string; sku: string }
  let partB: { id: string; sku: string }
  let normalProductId = ""
  let eppProductId = ""

  beforeAll(async () => {
    await seedMantFixtures(testDb as unknown as DB)
    await testDb.insert(schema.suppliers).values([
      { id: "sup-a", name: "Repuestos del Sur", rut: "76.000.111-1", isActive: true, createdAt: now, updatedAt: now },
      { id: "sup-b", name: "Frenos Bío Bío", rut: "76.000.222-2", isActive: true, createdAt: now, updatedAt: now },
    ])
    await testDb.insert(schema.productCategories).values({ id: "cat-gen", name: "General", slug: "general", sortOrder: 1 })
    await testDb.insert(schema.products).values([
      { id: "p-normal", sku: "GEN-001", name: "Lubricante", categoryId: "cat-gen", unitOfMeasure: "unidad", isActive: true, createdAt: now, updatedAt: now },
      { id: "p-epp", sku: "EPP-900", name: "Casco", categoryId: "cat-gen", unitOfMeasure: "unidad", isEpp: true, isActive: true, createdAt: now, updatedAt: now },
    ])
    normalProductId = "p-normal"
    eppProductId = "p-epp"
    partA = await createPart("Filtro de aire primario", "AF-100")
    partB = await createPart("Filtro de combustible", "FF-200")
  })

  afterAll(async () => {
    await pg.close()
  })

  describe("T7 · el productId de la línea llega a la OC y a la solicitud", () => {
    it("vincula el repuesto en la línea de la OC y en el ítem de solicitud", async () => {
      const { itemId } = await freeTextItem({ quantity: 2 })
      const orderId = await orderFor(itemId, partA.id)

      expect((await ocLines(orderId))[0]).toMatchObject({ requestItemId: itemId, productId: partA.id })
      const item = await requestItem(itemId)
      expect(item.productId).toBe(partA.id)
      // El texto libre que escribió quien pidió se conserva.
      expect(item.productNameFree).toBe("Filtro de aire")
    })

    it("la compra parcial deja el remanente también vinculado al repuesto", async () => {
      const { itemId } = await freeTextItem({ quantity: 5 })
      const orderId = await orderFor(itemId, partA.id, { quantity: 2 })

      expect((await ocLines(orderId))[0]).toMatchObject({ productId: partA.id, quantity: 2 })
      expect(await requestItem(itemId)).toMatchObject({ productId: partA.id, quantity: 2 })
      const siblings = await testDb.select().from(schema.purchaseRequestItems)
        .where(eq(schema.purchaseRequestItems.splitFromItemId, itemId))
      expect(siblings).toHaveLength(1)
      expect(siblings[0]).toMatchObject({ productId: partA.id, quantity: 3, vehicleId: IDS.truckBio })
    })

    it("el vínculo cuenta en «comprado para» del vehículo", async () => {
      const { itemId } = await freeTextItem({ quantity: 1 })
      await orderFor(itemId, partB.id, { quantity: 1 })
      const detail = await catalog.getSparePartDetail(partB.id)
      expect(detail?.purchasedFor.map((usage) => usage.vehicleId)).toEqual([IDS.truckBio])
    })

    it("sin productId la línea queda en texto libre, como siempre", async () => {
      const { itemId } = await freeTextItem({ quantity: 1 })
      const orderId = await orderFor(itemId, null, { quantity: 1 })
      expect((await ocLines(orderId))[0]!.productId).toBeNull()
      expect((await requestItem(itemId)).productId).toBeNull()
    })

    it("rechaza un producto que no es repuesto y no deja rastro", async () => {
      const { itemId } = await freeTextItem()
      const before = await testDb.select().from(schema.purchaseOrders)
      await expect(orderFor(itemId, normalProductId)).rejects.toThrow(/no existe, está inactivo o no es un repuesto/)
      await expect(orderFor(itemId, eppProductId)).rejects.toThrow(/no es un repuesto del catálogo/)
      expect((await requestItem(itemId)).productId).toBeNull()
      expect(await testDb.select().from(schema.purchaseOrders)).toHaveLength(before.length)
    })

    it("rechaza un repuesto inactivo y uno que no existe", async () => {
      const inactive = await createPart("Correa inactiva", "CO-300")
      await catalog.setSparePartActive(inactive.id, false)
      const { itemId } = await freeTextItem()
      await expect(orderFor(itemId, inactive.id)).rejects.toThrow(/inactivo/)
      await expect(orderFor(itemId, "no-existe")).rejects.toThrow(/no existe/)
      expect((await requestItem(itemId)).productId).toBeNull()
    })

    it("sólo se vincula en solicitudes de repuestos", async () => {
      const { itemId } = await freeTextItem({ requestType: "otro" })
      await expect(orderFor(itemId, partA.id)).rejects.toThrow(/solicitud de repuestos/)
      expect((await requestItem(itemId)).productId).toBeNull()
    })

    it("no re-vincula un ítem que ya tiene otro producto", async () => {
      const { itemId } = await freeTextItem({ productId: partA.id })
      await expect(orderFor(itemId, partB.id)).rejects.toThrow(/ya está vinculado a otro producto/)
      expect((await requestItem(itemId)).productId).toBe(partA.id)
      // El mismo producto que ya tiene es válido (el formulario siempre lo reenvía).
      const orderId = await orderFor(itemId, partA.id)
      expect((await ocLines(orderId))[0]!.productId).toBe(partA.id)
    })

    it("un vínculo inválido en una línea tumba la OC completa (otra línea válida no queda a medias)", async () => {
      const ok = await freeTextItem({ quantity: 1 })
      const bad = await freeTextItem({ quantity: 1 })
      await expect(createOrder({
        worksiteId: IDS.wsBio, supplierId: "sup-a", createdBy: IDS.jefe,
        items: [
          line(ok.itemId, { productId: partA.id, quantity: 1 }),
          line(bad.itemId, { productId: normalProductId, quantity: 1 }),
        ],
      })).rejects.toThrow()
      expect((await requestItem(ok.itemId)).productId).toBeNull()
      expect((await requestItem(ok.itemId)).status).toBe("approved")
    })
  })

  describe("el vínculo hecho al armar la OC se deshace si la OC no sigue", () => {
    async function siblingOf(itemId: string) {
      const [row] = await testDb.select().from(schema.purchaseRequestItems)
        .where(eq(schema.purchaseRequestItems.splitFromItemId, itemId))
      return row!
    }

    it("eliminar el borrador devuelve la línea a texto libre y se puede volver a catalogar", async () => {
      const { itemId } = await freeTextItem({ quantity: 2 })
      const orderId = await orderFor(itemId, partA.id)
      await deleteOrder(orderId, IDS.jefe)

      const item = await requestItem(itemId)
      expect(item).toMatchObject({ productId: null, productNameFree: "Filtro de aire", status: "pending_purchase" })
      // Ya no es un vínculo fijo: otra OC puede catalogarla con el repuesto correcto.
      const again = await orderFor(itemId, partB.id)
      expect((await ocLines(again))[0]!.productId).toBe(partB.id)
      expect((await requestItem(itemId)).productId).toBe(partB.id)
    })

    it("anular una OC emitida también deshace el vínculo y deja constancia en la bitácora", async () => {
      const { itemId } = await freeTextItem({ quantity: 1 })
      const orderId = await orderFor(itemId, partA.id, { quantity: 1 })
      await issueAndSendOrder(orderId, IDS.jefe)
      await cancelOrder(orderId, IDS.jefe, "Repuesto equivocado")

      expect((await requestItem(itemId)).productId).toBeNull()
      const trail = await testDb.select().from(schema.auditLog)
        .where(and(eq(schema.auditLog.entityType, "request_item"), eq(schema.auditLog.entityId, itemId)))
      const states = trail.map((row) => JSON.parse(row.newState ?? "{}") as Record<string, unknown>)
      expect(states).toContainEqual(expect.objectContaining({ productId: partA.id, linkedFrom: "purchase_order", purchaseOrderId: orderId }))
      expect(states).toContainEqual(expect.objectContaining({ productId: null, unlinkedFrom: "purchase_order", purchaseOrderId: orderId }))
    })

    it("el remanente de una compra parcial también vuelve a texto libre", async () => {
      const { itemId } = await freeTextItem({ quantity: 5 })
      const orderId = await orderFor(itemId, partA.id, { quantity: 2 })
      const sibling = await siblingOf(itemId)
      expect(sibling.productId).toBe(partA.id)

      await deleteOrder(orderId, IDS.jefe)
      expect((await requestItem(itemId)).productId).toBeNull()
      expect((await requestItem(sibling.id)).productId).toBeNull()
      expect((await requestItem(sibling.id)).productNameFree).toBe("Filtro de aire")
    })

    it("un ítem que sigue en otra OC viva conserva su vínculo", async () => {
      const { itemId } = await freeTextItem({ quantity: 5 })
      const first = await orderFor(itemId, partA.id, { quantity: 2 })
      const sibling = await siblingOf(itemId)
      // El remanente se compra en otra OC: esa OC ya cuenta con el repuesto.
      const second = await orderFor(sibling.id, partA.id, { quantity: 3 })

      await deleteOrder(first, IDS.jefe)
      expect((await requestItem(itemId)).productId).toBeNull()
      expect((await requestItem(sibling.id)).productId).toBe(partA.id)
      expect((await ocLines(second))[0]!.productId).toBe(partA.id)
    })

    it("el repuesto que eligió quien pidió no se toca al anular ni al eliminar", async () => {
      const cancelled = await freeTextItem({ quantity: 1, productId: partA.id })
      const sent = await orderFor(cancelled.itemId, partA.id, { quantity: 1 })
      await issueAndSendOrder(sent, IDS.jefe)
      await cancelOrder(sent, IDS.jefe, "Proveedor sin stock")
      expect((await requestItem(cancelled.itemId)).productId).toBe(partA.id)

      const deleted = await freeTextItem({ quantity: 1, productId: partA.id })
      await deleteOrder(await orderFor(deleted.itemId, partA.id, { quantity: 1 }), IDS.jefe)
      expect((await requestItem(deleted.itemId)).productId).toBe(partA.id)
    })
  })

  describe("la unidad del repuesto tiene que ser la de la línea", () => {
    it("rechaza vincular un repuesto que se compra en otra unidad", async () => {
      const kit = await createPart("Kit de empaquetaduras", "KE-010", "juego")
      const { itemId } = await freeTextItem({ quantity: 1, unitOfMeasure: "unidad" })
      await expect(orderFor(itemId, kit.id, { quantity: 1 })).rejects.toThrow(
        `El repuesto ${kit.sku} se compra por «juego» y la línea pide «unidad»; elige otro o crea uno nuevo`,
      )
      expect((await requestItem(itemId)).productId).toBeNull()
    })

    it("la misma unidad escrita con otra caja o espacios vale", async () => {
      const kit = await createPart("Kit de sellos", "KS-011", "juego")
      const { itemId } = await freeTextItem({ quantity: 1, unitOfMeasure: " Juego" })
      const orderId = await orderFor(itemId, kit.id, { quantity: 1, unitOfMeasure: " Juego" })
      expect((await ocLines(orderId))[0]!.productId).toBe(kit.id)
    })

    it("al emitir, una línea en otra unidad que el repuesto no escribe su precio", async () => {
      const kit = await createPart("Kit de embrague", "KE-012", "juego")
      // Elegido al pedir (no pasa por el vínculo de la OC) pero en «unidad».
      const { itemId } = await freeTextItem({ quantity: 1, productId: kit.id, unitOfMeasure: "unidad" })
      await issueAndSendOrder(await orderFor(itemId, kit.id, { quantity: 1, unitPrice: 90_000 }), IDS.jefe)
      expect(await priceHistory(kit.id)).toHaveLength(0)
      expect(await supplierPrice(kit.id)).toBeNull()
    })
  })

  describe("los repuestos no tienen existencias en bodega", () => {
    it("applyMovementTx rechaza un movimiento de un repuesto", async () => {
      await expect(testDb.transaction((tx) => applyMovementTx(tx as unknown as Tx, {
        worksiteId: IDS.wsBio, productId: partA.id, type: "ingreso_oc", quantity: 1, performedBy: IDS.jefe,
      }))).rejects.toThrow("Los repuestos no tienen existencias en bodega")
      const stock = await testDb.select().from(schema.worksiteStock)
        .where(eq(schema.worksiteStock.productId, partA.id))
      expect(stock).toHaveLength(0)
    })

    it("un producto de bodega sigue moviéndose como siempre", async () => {
      const after = await testDb.transaction((tx) => applyMovementTx(tx as unknown as Tx, {
        worksiteId: IDS.wsBio, productId: normalProductId, type: "ingreso_oc", quantity: 3, performedBy: IDS.jefe,
      }))
      expect(after).toBe(3)
    })
  })

  describe("T8 · el precio queda en el catálogo al emitir la OC", () => {
    it("dos OC con precios distintos dejan dos filas de historial con fuente purchase_order", async () => {
      const part = await createPart("Pastilla de freno delantera", "PF-400")
      const first = await freeTextItem({ quantity: 2 })
      const orderOne = await orderFor(first.itemId, part.id, { unitPrice: 12_000 })
      // En borrador todavía no hay precio en el catálogo.
      expect(await priceHistory(part.id)).toHaveLength(0)

      await issueAndSendOrder(orderOne, IDS.jefe)
      expect(await priceHistory(part.id)).toHaveLength(1)
      expect(await supplierPrice(part.id)).toMatchObject({ unitPrice: 12_000 })

      const second = await freeTextItem({ quantity: 2 })
      const orderTwo = await orderFor(second.itemId, part.id, { unitPrice: 13_500 })
      await issueAndSendOrder(orderTwo, IDS.jefe)

      const history = await priceHistory(part.id)
      expect(history).toHaveLength(2)
      expect(history[0]).toMatchObject({ previousPrice: null, newPrice: 12_000, source: "purchase_order", sourceId: orderOne, supplierId: "sup-a", createdByUserId: IDS.jefe })
      expect(history[1]).toMatchObject({ previousPrice: 12_000, newPrice: 13_500, source: "purchase_order", sourceId: orderTwo })
      expect(await supplierPrice(part.id)).toMatchObject({ unitPrice: 13_500 })

      // La ficha del repuesto lo muestra con la fuente nueva.
      const detail = await catalog.getSparePartDetail(part.id)
      expect(detail?.priceHistory.map((entry) => entry.source)).toEqual(["purchase_order", "purchase_order"])
      expect(detail?.suppliers[0]).toMatchObject({ supplierId: "sup-a", unitPrice: 13_500 })
    })

    it("el mismo precio otra vez no ensucia el historial", async () => {
      const part = await createPart("Bujía", "BU-500")
      for (let i = 0; i < 2; i += 1) {
        const { itemId } = await freeTextItem({ quantity: 1 })
        await issueAndSendOrder(await orderFor(itemId, part.id, { unitPrice: 8_000, quantity: 1 }), IDS.jefe)
      }
      expect(await priceHistory(part.id)).toHaveLength(1)
    })

    it("cada proveedor lleva su propio precio", async () => {
      const part = await createPart("Amortiguador", "AM-600")
      const a = await freeTextItem({ quantity: 1 })
      await issueAndSendOrder(await orderFor(a.itemId, part.id, { unitPrice: 50_000, quantity: 1, supplierId: "sup-a" }), IDS.jefe)
      const b = await freeTextItem({ quantity: 1 })
      await issueAndSendOrder(await orderFor(b.itemId, part.id, { unitPrice: 47_000, quantity: 1, supplierId: "sup-b" }), IDS.jefe)
      expect(await supplierPrice(part.id, "sup-a")).toMatchObject({ unitPrice: 50_000 })
      expect(await supplierPrice(part.id, "sup-b")).toMatchObject({ unitPrice: 47_000 })
    })

    it("registra el precio neto del descuento, como la conciliación de facturas", async () => {
      const part = await createPart("Rodamiento", "RO-700")
      const { itemId } = await freeTextItem({ quantity: 1 })
      await issueAndSendOrder(await orderFor(itemId, part.id, { unitPrice: 20_000, discount: 10, quantity: 1 }), IDS.jefe)
      expect(await supplierPrice(part.id)).toMatchObject({ unitPrice: 18_000 })
    })

    it("un precio de catálogo más reciente no se pisa (rejectOlderThanCurrent)", async () => {
      const part = await createPart("Sensor de temperatura", "ST-800")
      const future = new Date(Date.now() + 86_400_000).toISOString()
      await testDb.insert(schema.productSuppliers).values({
        id: "ps-future", productId: part.id, supplierId: "sup-a", unitPrice: 9_999, isPreferred: false, lastUpdated: future,
      })
      const { itemId } = await freeTextItem({ quantity: 1 })
      await issueAndSendOrder(await orderFor(itemId, part.id, { unitPrice: 5_000, quantity: 1 }), IDS.jefe)
      expect(await supplierPrice(part.id)).toMatchObject({ unitPrice: 9_999 })
      expect(await priceHistory(part.id)).toHaveLength(0)
    })

    it("una OC de EPP no escribe precios", async () => {
      const { requestId, itemId } = await freeTextItem({ quantity: 3, requestType: "epp", productId: eppProductId })
      void requestId
      const orderId = await orderFor(itemId, eppProductId, { unitPrice: 7_000, quantity: 3 })
      await issueAndSendOrder(orderId, IDS.jefe)
      expect(await priceHistory(eppProductId)).toHaveLength(0)
      expect(await supplierPrice(eppProductId)).toBeNull()
    })

    it("una línea de repuesto en texto libre (sin catalogar) no escribe precios", async () => {
      const before = await testDb.select().from(schema.productSupplierPriceHistory)
      const { itemId } = await freeTextItem({ quantity: 1 })
      await issueAndSendOrder(await orderFor(itemId, null, { unitPrice: 4_000, quantity: 1 }), IDS.jefe)
      expect(await testDb.select().from(schema.productSupplierPriceHistory)).toHaveLength(before.length)
    })

    it("la OC con repuesto y EPP registra sólo el precio del repuesto", async () => {
      const part = await createPart("Filtro hidráulico", "FH-900")
      const spare = await freeTextItem({ quantity: 1 })
      const epp = await freeTextItem({ quantity: 1, requestType: "repuestos", productId: eppProductId })
      const orderId = await createOrder({
        worksiteId: IDS.wsBio, supplierId: "sup-a", createdBy: IDS.jefe,
        items: [
          line(spare.itemId, { productId: part.id, unitPrice: 31_000, quantity: 1 }),
          line(epp.itemId, { productId: eppProductId, unitPrice: 6_000, quantity: 1 }),
        ],
      })
      await issueAndSendOrder(orderId, IDS.jefe)
      expect(await priceHistory(part.id)).toHaveLength(1)
      expect(await priceHistory(eppProductId)).toHaveLength(0)
    })
  })
})
