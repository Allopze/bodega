/**
 * Catalogar al comprar (FF-6, segundo recorrido 2026-11-09), contra Postgres real
 * (PGlite con todas las migraciones).
 *
 * «Crear y vincular» creaba el repuesto en el servidor pero dejaba el vínculo con
 * la línea sólo en el estado del formulario: una recarga antes de crear la OC
 * dejaba el repuesto huérfano y la línea se iba a la OC sin `product_id`. Ahora el
 * vínculo se escribe en el ítem de solicitud en el momento de elegirlo en la hoja,
 * con una marca propia (`linkedFrom: "catalog_sheet"`):
 *
 *  - se puede quitar desde la línea mientras el ítem no tenga OC viva;
 *  - NO lo deshace eliminar ni anular una OC: esa marca no es de ninguna OC
 *    (`spare-part-link-revert.ts` sólo revierte lo que lleva `purchase_order`);
 *  - el repuesto que eligió quien pidió no se puede quitar desde aquí.
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { and, eq } from "drizzle-orm"
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
const link = await import("@/lib/services/purchasing-module/spare-part-item-link")

const now = new Date().toISOString()
let seq = 0
const ACTOR = { userId: IDS.jefe, userEmail: "jefe@chome.test", worksiteScope: "all" as const }

async function createPart(name: string, partNumber: string | null, unitOfMeasure = "unidad") {
  return testDb.transaction((tx) => catalog.createSparePartTx(tx as unknown as Tx, {
    name, partNumber, unitOfMeasure, createdByUserId: IDS.jefe,
  }))
}

async function freeTextItem(opts: {
  quantity?: number; requestType?: string; productId?: string | null; unitOfMeasure?: string
  itemStatus?: string; worksiteId?: string; requestStatus?: string
} = {}) {
  seq += 1
  const requestId = `r-${seq}`
  const itemId = `i-${seq}`
  await testDb.insert(schema.purchaseRequests).values({
    id: requestId, code: `REP-F-${seq}`, worksiteId: opts.worksiteId ?? IDS.wsBio, requesterId: IDS.jefe,
    requestType: opts.requestType ?? "repuestos", status: opts.requestStatus ?? "approved", urgency: "normal",
    deliveryMode: "directo_faena", createdAt: now, updatedAt: now,
  })
  await testDb.insert(schema.purchaseRequestItems).values({
    id: itemId, requestId, productId: opts.productId ?? null, productNameFree: "Filtro de aire", quantity: opts.quantity ?? 2,
    unitOfMeasure: opts.unitOfMeasure ?? "unidad", status: opts.itemStatus ?? "approved", vehicleId: IDS.truckBio, createdAt: now, updatedAt: now,
  })
  return { requestId, itemId }
}

async function requestItem(id: string) {
  const [row] = await testDb.select().from(schema.purchaseRequestItems).where(eq(schema.purchaseRequestItems.id, id))
  return row!
}

async function siblingOf(itemId: string) {
  const [row] = await testDb.select().from(schema.purchaseRequestItems)
    .where(eq(schema.purchaseRequestItems.splitFromItemId, itemId))
  return row!
}

async function orderFor(requestItemId: string, productId: string | null, quantity = 2) {
  return createOrder({
    worksiteId: IDS.wsBio, supplierId: "sup-a", createdBy: IDS.jefe,
    items: [{ requestItemId, productId, productNameFree: "Filtro de aire", quantity, unitOfMeasure: "unidad", unitPrice: 10_000 }],
  })
}

async function trail(itemId: string) {
  const rows = await testDb.select().from(schema.auditLog)
    .where(and(eq(schema.auditLog.entityType, "request_item"), eq(schema.auditLog.entityId, itemId)))
    .orderBy(schema.auditLog.createdAt)
  return rows.map((row) => JSON.parse(row.newState ?? "{}") as Record<string, unknown>)
}

async function partCount() {
  return (await testDb.select().from(schema.products).where(eq(schema.products.isSparePart, true))).length
}

describe("catálogo de repuestos · el vínculo de «Catalogar» se guarda al elegirlo", () => {
  let partA: { id: string; sku: string }
  let partB: { id: string; sku: string }

  beforeAll(async () => {
    await seedMantFixtures(testDb as unknown as DB)
    await testDb.insert(schema.suppliers).values([
      { id: "sup-a", name: "Repuestos del Sur", rut: "76.000.111-1", isActive: true, createdAt: now, updatedAt: now },
    ])
    await testDb.insert(schema.productCategories).values({ id: "cat-gen", name: "General", slug: "general", sortOrder: 1 })
    await testDb.insert(schema.products).values([
      { id: "p-normal", sku: "GEN-001", name: "Lubricante", categoryId: "cat-gen", unitOfMeasure: "unidad", isActive: true, createdAt: now, updatedAt: now },
    ])
    partA = await createPart("Filtro de aire primario", "AF-100")
    partB = await createPart("Filtro de combustible", "FF-200")
  })

  afterAll(async () => {
    await pg.close()
  })

  describe("vincular", () => {
    it("escribe el repuesto en el ítem de solicitud, conserva el texto libre y lo anota con la marca de la hoja", async () => {
      const { itemId } = await freeTextItem()
      await link.linkSparePartToRequestItem({ requestItemId: itemId, productId: partA.id, actor: ACTOR })

      expect(await requestItem(itemId)).toMatchObject({ productId: partA.id, productNameFree: "Filtro de aire", status: "approved" })
      const states = await trail(itemId)
      expect(states).toEqual([{ productId: partA.id, linkedFrom: "catalog_sheet" }])
    })

    it("sobrevive a la recarga: la OC se crea con el vínculo ya guardado y sin que el cliente lo reenvíe", async () => {
      const { itemId } = await freeTextItem({ quantity: 2 })
      await link.linkSparePartToRequestItem({ requestItemId: itemId, productId: partA.id, actor: ACTOR })

      // El formulario recargado manda la línea tal como la lee del servidor.
      const orderId = await orderFor(itemId, partA.id)
      const [orderLine] = await testDb.select().from(schema.purchaseOrderItems)
        .where(eq(schema.purchaseOrderItems.purchaseOrderId, orderId))
      expect(orderLine).toMatchObject({ requestItemId: itemId, productId: partA.id })
      // La OC no vinculó nada: el único vínculo de la bitácora es el de la hoja.
      const links = (await trail(itemId)).filter((state) => "productId" in state)
      expect(links).toEqual([{ productId: partA.id, linkedFrom: "catalog_sheet" }])
    })

    it("es idempotente: elegir otra vez el mismo repuesto no repite la bitácora", async () => {
      const { itemId } = await freeTextItem()
      await link.linkSparePartToRequestItem({ requestItemId: itemId, productId: partA.id, actor: ACTOR })
      await link.linkSparePartToRequestItem({ requestItemId: itemId, productId: partA.id, actor: ACTOR })
      expect(await trail(itemId)).toHaveLength(1)
    })

    it("rechaza un ítem que ya tiene otro producto (el que eligió quien pidió no se pisa)", async () => {
      const { itemId } = await freeTextItem({ productId: partA.id })
      await expect(link.linkSparePartToRequestItem({ requestItemId: itemId, productId: partB.id, actor: ACTOR }))
        .rejects.toThrow(/ya está vinculado a otro producto/)
      expect((await requestItem(itemId)).productId).toBe(partA.id)
      expect(await trail(itemId)).toEqual([])
    })

    it("rechaza lo que no es un repuesto activo del catálogo, y lo que no es de una solicitud de repuestos", async () => {
      const inactive = await createPart("Correa inactiva", "CO-300")
      await catalog.setSparePartActive(inactive.id, false)
      const { itemId } = await freeTextItem()
      await expect(link.linkSparePartToRequestItem({ requestItemId: itemId, productId: "p-normal", actor: ACTOR }))
        .rejects.toThrow(/no existe, está inactivo o no es un repuesto/)
      await expect(link.linkSparePartToRequestItem({ requestItemId: itemId, productId: inactive.id, actor: ACTOR }))
        .rejects.toThrow(/inactivo/)
      await expect(link.linkSparePartToRequestItem({ requestItemId: itemId, productId: "no-existe", actor: ACTOR }))
        .rejects.toThrow(/no existe/)

      const other = await freeTextItem({ requestType: "otro" })
      await expect(link.linkSparePartToRequestItem({ requestItemId: other.itemId, productId: partA.id, actor: ACTOR }))
        .rejects.toThrow(/solicitud de repuestos/)
      expect((await requestItem(itemId)).productId).toBeNull()
      expect((await requestItem(other.itemId)).productId).toBeNull()
    })

    it("rechaza un repuesto que se compra en otra unidad que la línea", async () => {
      const kit = await createPart("Kit de empaquetaduras", "KE-010", "juego")
      const { itemId } = await freeTextItem({ unitOfMeasure: "unidad" })
      await expect(link.linkSparePartToRequestItem({ requestItemId: itemId, productId: kit.id, actor: ACTOR }))
        .rejects.toThrow(`El repuesto ${kit.sku} se compra por «juego» y la línea pide «unidad»; elige otro o crea uno nuevo`)
      expect((await requestItem(itemId)).productId).toBeNull()
    })

    it("sólo ítems que siguen pendientes de compra: uno en una OC viva o ya entregado se rechaza", async () => {
      const inOrder = await freeTextItem()
      await orderFor(inOrder.itemId, null)
      await expect(link.linkSparePartToRequestItem({ requestItemId: inOrder.itemId, productId: partA.id, actor: ACTOR }))
        .rejects.toThrow(/orden de compra/)

      const delivered = await freeTextItem({ itemStatus: "delivered" })
      await expect(link.linkSparePartToRequestItem({ requestItemId: delivered.itemId, productId: partA.id, actor: ACTOR }))
        .rejects.toThrow(/pendiente de compra/)

      const closed = await freeTextItem({ requestStatus: "cancelled" })
      await expect(link.linkSparePartToRequestItem({ requestItemId: closed.itemId, productId: partA.id, actor: ACTOR }))
        .rejects.toThrow(/pendiente de compra/)

      for (const id of [inOrder.itemId, delivered.itemId, closed.itemId]) {
        expect((await requestItem(id)).productId).toBeNull()
      }
    })

    it("respeta el alcance de faenas de quien lo pide", async () => {
      const { itemId } = await freeTextItem({ worksiteId: IDS.wsBio })
      await expect(link.linkSparePartToRequestItem({
        requestItemId: itemId, productId: partA.id, actor: { ...ACTOR, worksiteScope: [IDS.wsCho] },
      })).rejects.toThrow(/No tienes acceso a la faena/)
      expect((await requestItem(itemId)).productId).toBeNull()

      await link.linkSparePartToRequestItem({
        requestItemId: itemId, productId: partA.id, actor: { ...ACTOR, worksiteScope: [IDS.wsBio] },
      })
      expect((await requestItem(itemId)).productId).toBe(partA.id)
    })

    it("un ítem que no existe se dice sin inventar", async () => {
      await expect(link.linkSparePartToRequestItem({ requestItemId: "no-existe", productId: partA.id, actor: ACTOR }))
        .rejects.toThrow(/ya no existe/)
    })
  })

  describe("crear y vincular, en una sola transacción", () => {
    it("crea el repuesto y lo deja vinculado al ítem", async () => {
      const { itemId } = await freeTextItem()
      const before = await partCount()
      const created = await link.createSparePartAndLinkToRequestItem({
        requestItemId: itemId,
        sparePart: { name: "Bujía de precalentamiento", partNumber: "BP-77", partBrand: "Bosch", unitOfMeasure: "unidad" },
        actor: ACTOR,
      })

      expect(await partCount()).toBe(before + 1)
      expect(created.sku).toMatch(/^RPT-\d+$/)
      expect(await requestItem(itemId)).toMatchObject({ productId: created.id })
      expect(await trail(itemId)).toEqual([{ productId: created.id, linkedFrom: "catalog_sheet" }])
    })

    it("si el vínculo falla, el repuesto tampoco queda creado (nada huérfano en el catálogo)", async () => {
      const { itemId } = await freeTextItem({ productId: partA.id })
      const before = await partCount()
      await expect(link.createSparePartAndLinkToRequestItem({
        requestItemId: itemId,
        sparePart: { name: "Bujía huérfana", partNumber: "BP-88", partBrand: null, unitOfMeasure: "unidad" },
        actor: ACTOR,
      })).rejects.toThrow(/ya está vinculado a otro producto/)
      expect(await partCount()).toBe(before)

      // La unidad que no es la de la línea también tumba el alta completa.
      const other = await freeTextItem({ unitOfMeasure: "unidad" })
      await expect(link.createSparePartAndLinkToRequestItem({
        requestItemId: other.itemId,
        sparePart: { name: "Kit huérfano", partNumber: "KH-1", partBrand: null, unitOfMeasure: "juego" },
        actor: ACTOR,
      })).rejects.toThrow(/se compra por «juego»/)
      expect(await partCount()).toBe(before)
    })
  })

  describe("quitar el vínculo", () => {
    it("deja la línea en texto libre, anota la baja con la misma marca y permite catalogar otro repuesto", async () => {
      const { itemId } = await freeTextItem()
      await link.linkSparePartToRequestItem({ requestItemId: itemId, productId: partA.id, actor: ACTOR })
      await link.unlinkSparePartFromRequestItem({ requestItemId: itemId, actor: ACTOR })

      expect(await requestItem(itemId)).toMatchObject({ productId: null, productNameFree: "Filtro de aire" })
      expect(await trail(itemId)).toEqual([
        { productId: partA.id, linkedFrom: "catalog_sheet" },
        { productId: null, unlinkedFrom: "catalog_sheet" },
      ])

      await link.linkSparePartToRequestItem({ requestItemId: itemId, productId: partB.id, actor: ACTOR })
      expect((await requestItem(itemId)).productId).toBe(partB.id)
    })

    it("sobre una línea sin vínculo no hace nada", async () => {
      const { itemId } = await freeTextItem()
      await link.unlinkSparePartFromRequestItem({ requestItemId: itemId, actor: ACTOR })
      expect(await trail(itemId)).toEqual([])
    })

    it("no quita el repuesto que eligió quien pidió", async () => {
      const { itemId } = await freeTextItem({ productId: partA.id })
      await expect(link.unlinkSparePartFromRequestItem({ requestItemId: itemId, actor: ACTOR }))
        .rejects.toThrow(/lo eligió quien hizo la solicitud/)
      expect((await requestItem(itemId)).productId).toBe(partA.id)
    })

    it("no lo quita mientras el ítem esté en una OC viva", async () => {
      const { itemId } = await freeTextItem()
      await link.linkSparePartToRequestItem({ requestItemId: itemId, productId: partA.id, actor: ACTOR })
      await orderFor(itemId, partA.id)
      await expect(link.unlinkSparePartFromRequestItem({ requestItemId: itemId, actor: ACTOR }))
        .rejects.toThrow(/orden de compra/)
      expect((await requestItem(itemId)).productId).toBe(partA.id)
    })

    it("respeta el alcance de faenas", async () => {
      const { itemId } = await freeTextItem()
      await link.linkSparePartToRequestItem({ requestItemId: itemId, productId: partA.id, actor: ACTOR })
      await expect(link.unlinkSparePartFromRequestItem({
        requestItemId: itemId, actor: { ...ACTOR, worksiteScope: [IDS.wsCho] },
      })).rejects.toThrow(/No tienes acceso a la faena/)
      expect((await requestItem(itemId)).productId).toBe(partA.id)
    })
  })

  describe("eliminar o anular la OC no deshace el vínculo de la hoja, y sigue siendo quitable", () => {
    it("eliminar el borrador conserva el vínculo (no es de la OC) y se puede quitar desde la línea", async () => {
      const { itemId } = await freeTextItem()
      await link.linkSparePartToRequestItem({ requestItemId: itemId, productId: partA.id, actor: ACTOR })
      await deleteOrder(await orderFor(itemId, partA.id), IDS.jefe)

      expect(await requestItem(itemId)).toMatchObject({ productId: partA.id, status: "pending_purchase" })
      await link.unlinkSparePartFromRequestItem({ requestItemId: itemId, actor: ACTOR })
      expect((await requestItem(itemId)).productId).toBeNull()
    })

    it("anular una OC emitida tampoco lo toca", async () => {
      const { itemId } = await freeTextItem({ quantity: 1 })
      await link.linkSparePartToRequestItem({ requestItemId: itemId, productId: partA.id, actor: ACTOR })
      const orderId = await orderFor(itemId, partA.id, 1)
      await issueAndSendOrder(orderId, IDS.jefe)
      await cancelOrder(orderId, IDS.jefe, "Proveedor sin stock")

      expect((await requestItem(itemId)).productId).toBe(partA.id)
      const states = await trail(itemId)
      expect(states.some((state) => state.unlinkedFrom === "purchase_order")).toBe(false)
    })

    it("el vínculo que sí hizo una OC (marca purchase_order) se sigue deshaciendo con ella", async () => {
      // Regresión del comportamiento anterior: lo que escribe `createOrder`
      // directo, sin pasar por la hoja, cae con la OC.
      const { itemId } = await freeTextItem()
      const orderId = await orderFor(itemId, partA.id)
      expect((await requestItem(itemId)).productId).toBe(partA.id)
      await deleteOrder(orderId, IDS.jefe)
      expect((await requestItem(itemId)).productId).toBeNull()
    })
  })

  describe("el remanente de una compra parcial hereda el vínculo y también se puede quitar", () => {
    it("el ítem comprado queda bloqueado por su OC y el remanente se quita solo", async () => {
      const { itemId } = await freeTextItem({ quantity: 5 })
      await link.linkSparePartToRequestItem({ requestItemId: itemId, productId: partA.id, actor: ACTOR })
      await orderFor(itemId, partA.id, 2)
      const remainder = await siblingOf(itemId)
      // El remanente copió el repuesto sin marca propia.
      expect(remainder.productId).toBe(partA.id)
      expect(await trail(remainder.id)).toEqual([])

      expect([...await link.findSheetLinkedItemIds([itemId, remainder.id])].sort()).toEqual([itemId, remainder.id].sort())
      await link.unlinkSparePartFromRequestItem({ requestItemId: remainder.id, actor: ACTOR })
      expect(await requestItem(remainder.id)).toMatchObject({ productId: null, productNameFree: "Filtro de aire" })
      await expect(link.unlinkSparePartFromRequestItem({ requestItemId: itemId, actor: ACTOR }))
        .rejects.toThrow(/orden de compra/)
    })
  })

  describe("findSheetLinkedItemIds", () => {
    it("distingue lo vinculado desde la hoja de lo que eligió quien pidió y de lo ya deshecho", async () => {
      const fromSheet = await freeTextItem()
      await link.linkSparePartToRequestItem({ requestItemId: fromSheet.itemId, productId: partA.id, actor: ACTOR })
      const fromRequester = await freeTextItem({ productId: partA.id })
      const undone = await freeTextItem()
      await link.linkSparePartToRequestItem({ requestItemId: undone.itemId, productId: partA.id, actor: ACTOR })
      await link.unlinkSparePartFromRequestItem({ requestItemId: undone.itemId, actor: ACTOR })
      const plain = await freeTextItem()

      const found = await link.findSheetLinkedItemIds([fromSheet.itemId, fromRequester.itemId, undone.itemId, plain.itemId])
      expect([...found]).toEqual([fromSheet.itemId])
      expect((await link.findSheetLinkedItemIds([])).size).toBe(0)
    })

    it("un vínculo de la hoja que apuntaba a otro repuesto no cuenta para el que tiene ahora", async () => {
      const { itemId } = await freeTextItem({ productId: partB.id })
      // Bitácora vieja de otro repuesto sobre el mismo ítem: no autoriza quitar B.
      await testDb.insert(schema.auditLog).values({
        id: `aud-${itemId}`, userId: IDS.jefe, action: "update", entityType: "request_item", entityId: itemId,
        newState: JSON.stringify({ productId: partA.id, linkedFrom: "catalog_sheet" }),
      })
      expect((await link.findSheetLinkedItemIds([itemId])).size).toBe(0)
    })
  })
})
