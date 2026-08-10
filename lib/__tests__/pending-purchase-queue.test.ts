/**
 * La cola de Compras: "solicitud aprobada que todavía necesita OC".
 *
 * Lo que se prueba acá no es un formato de pantalla, es que el resumen y los
 * registros salgan del mismo predicado. La divergencia que originó este módulo
 * era exactamente esa: el contador de /compras aplicaba estado + solicitud viva,
 * el selector de /compras/nueva aplicaba además la cobertura activa, y al cerrar
 * una OC sin recibir nada el ítem volvía a `pending_purchase` con su línea de OC
 * todavía viva — la bandeja anunciaba un pendiente que "Crear OC" no encontraba.
 *
 * Se ejecuta contra PGlite y no con aserciones sobre el SQL generado: lo que
 * importa es qué filas vuelven.
 */

import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { eq, inArray } from "drizzle-orm"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { DB } from "@/db"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

const {
  countPendingPurchaseItems, countPendingPurchaseRequests, listPendingPurchaseRequests,
} = await import("@/lib/services/purchasing-module/pending-purchase-queue")
const { createOrder, issueAndSendOrder, cancelOrder, closeOrder } =
  await import("@/lib/services/purchasing")

const now = "2026-08-10T12:00:00.000Z"
const USER = "u-cola"
const WS = "ws-cola"
const WS_AJENA = "ws-cola-ajena"

async function seedRequest(id: string, code: string, opts: {
  worksiteId?: string
  status?: string
  urgency?: string
} = {}) {
  await inMemoryDb.insert(schema.purchaseRequests).values({
    id, code,
    worksiteId: opts.worksiteId ?? WS,
    requesterId: USER,
    requestType: "epp",
    urgency: opts.urgency ?? "normal",
    status: opts.status ?? "partially_approved",
    submittedAt: now,
    createdAt: now, updatedAt: now,
  })
}

async function seedItem(id: string, requestId: string, opts: {
  status?: string
  quantity?: number
  productId?: string | null
  name?: string
  supplierId?: string | null
  sortOrder?: number
} = {}) {
  await inMemoryDb.insert(schema.purchaseRequestItems).values({
    id, requestId,
    productId: opts.productId === undefined ? "prod-cola" : opts.productId,
    productNameFree: opts.name ?? null,
    quantity: opts.quantity ?? 5,
    unitOfMeasure: "unidad",
    status: opts.status ?? "approved",
    suggestedSupplierId: opts.supplierId === undefined ? "sup-cola" : opts.supplierId,
    sortOrder: opts.sortOrder ?? 0,
    createdAt: now, updatedAt: now,
  })
}

/** Los ítems que la cola entrega, aplanados y ordenados: la unidad accionable. */
async function pendingItemIds() {
  const requests = await listPendingPurchaseRequests(undefined, {}, { limit: 50, offset: 0 })
  return requests
    .flatMap((request) => request.items.filter((item) => item.stage === "pending_order").map((item) => item.id))
    .sort()
}

async function pendingRequestCodes() {
  const requests = await listPendingPurchaseRequests(undefined, {}, { limit: 50, offset: 0 })
  return requests.map((request) => request.code).sort()
}

describe("cola de Compras — solicitudes aprobadas sin OC", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

    await inMemoryDb.insert(schema.users).values({
      id: USER, name: "Compradora", email: "compradora@cola.test",
      hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.worksites).values([
      { id: WS, name: "Faena Cola", code: "F-COLA", isActive: true, createdAt: now, updatedAt: now },
      { id: WS_AJENA, name: "Faena Ajena", code: "F-AJENA", isActive: true, createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.suppliers).values({
      id: "sup-cola", name: "Proveedor Cola", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.productCategories).values({
      id: "cat-cola", name: "Cat Cola", slug: "cat-cola", sortOrder: 1,
    })
    await inMemoryDb.insert(schema.products).values({
      id: "prod-cola", sku: "P-COLA", name: "Guante Cola", categoryId: "cat-cola",
      unitOfMeasure: "unidad", isActive: true, createdAt: now, updatedAt: now,
    })
  })

  afterAll(async () => { await pg.close() })

  it("el ítem recién aprobado aparece sin ninguna acción manual intermedia", async () => {
    await seedRequest("req-1", "SOL-COLA-0001")
    await seedItem("it-1a", "req-1", { status: "approved" })

    expect(await pendingItemIds()).toEqual(["it-1a"])
    expect(await countPendingPurchaseItems(undefined)).toBe(1)
  })

  it("el ítem rechazado nunca entra a la cola, y su solicitud tampoco por él", async () => {
    await seedItem("it-1b", "req-1", { status: "rejected", sortOrder: 1 })

    expect(await pendingItemIds()).toEqual(["it-1a"])

    // Pero sí es visible en el desglose: una aprobación parcial tiene que
    // leerse como parcial, no como si la solicitud entera esperara compra.
    const [request] = await listPendingPurchaseRequests(undefined, {}, { limit: 50, offset: 0 })
    expect(request!.items.find((item) => item.id === "it-1b")?.stage).toBe("rejected")
    expect(request!.pendingItemCount).toBe(1)
  })

  it("el ítem que sigue en aprobación se distingue del aprobado sin OC", async () => {
    await seedItem("it-1c", "req-1", { status: "requested", sortOrder: 2 })

    expect(await pendingItemIds()).toEqual(["it-1a"])
    const [request] = await listPendingPurchaseRequests(undefined, {}, { limit: 50, offset: 0 })
    expect(request!.items.find((item) => item.id === "it-1c")?.stage).toBe("awaiting_approval")
  })

  it("el contador y los registros salen del mismo predicado", async () => {
    await seedRequest("req-2", "SOL-COLA-0002")
    await seedItem("it-2a", "req-2", { status: "approved" })
    await seedItem("it-2b", "req-2", { status: "pending_purchase", sortOrder: 1 })

    const items = await pendingItemIds()
    expect(await countPendingPurchaseItems(undefined)).toBe(items.length)
    expect(await countPendingPurchaseRequests(undefined)).toBe((await pendingRequestCodes()).length)
  })

  it("una solicitud terminal no genera trabajo pendiente aunque le quede un ítem aprobado", async () => {
    await seedRequest("req-cerrada", "SOL-COLA-0009", { status: "closed" })
    await seedItem("it-cerrada", "req-cerrada", { status: "approved" })

    expect(await pendingItemIds()).not.toContain("it-cerrada")
    expect(await pendingRequestCodes()).not.toContain("SOL-COLA-0009")
  })

  it("la OC saca de la cola sólo los ítems que incluyó; el resto sigue visible", async () => {
    // Aprobación parcial de #2: se compran los dos ítems aprobados de la
    // solicitud 2 salvo uno, que debe seguir en la cola con su solicitud.
    await seedRequest("req-3", "SOL-COLA-0003")
    await seedItem("it-3a", "req-3", { status: "approved", name: "Casco" })
    await seedItem("it-3b", "req-3", { status: "approved", name: "Guantes", sortOrder: 1 })
    await seedItem("it-3c", "req-3", { status: "approved", name: "Protector auditivo", sortOrder: 2 })
    await seedItem("it-3d", "req-3", { status: "rejected", name: "Zapatos", sortOrder: 3 })

    const orderId = await createOrder({
      worksiteId: WS,
      supplierId: "sup-cola",
      createdBy: USER,
      items: [
        { requestItemId: "it-3a", productId: "prod-cola", productNameFree: null, quantity: 5, unitOfMeasure: "unidad", unitPrice: 1000 },
        { requestItemId: "it-3b", productId: "prod-cola", productNameFree: null, quantity: 5, unitOfMeasure: "unidad", unitPrice: 2000 },
      ],
    })

    const pending = await pendingItemIds()
    expect(pending).not.toContain("it-3a")
    expect(pending).not.toContain("it-3b")
    expect(pending).toContain("it-3c")
    expect(pending).not.toContain("it-3d")
    // La solicitud sigue en la cola mientras le quede un aprobado sin OC.
    expect(await pendingRequestCodes()).toContain("SOL-COLA-0003")

    const request = (await listPendingPurchaseRequests(undefined, {}, { limit: 50, offset: 0 }))
      .find((row) => row.code === "SOL-COLA-0003")!
    expect(request.pendingItemCount).toBe(1)
    expect(request.items.find((item) => item.id === "it-3a")?.stage).toBe("in_order")
    expect(request.items.find((item) => item.id === "it-3a")?.orderId).toBe(orderId)

    // Y cuando ya no le queda ninguno, desaparece de la cola activa sin que
    // nadie la mueva a mano.
    await createOrder({
      worksiteId: WS,
      supplierId: "sup-cola",
      createdBy: USER,
      items: [
        { requestItemId: "it-3c", productId: "prod-cola", productNameFree: null, quantity: 5, unitOfMeasure: "unidad", unitPrice: 3000 },
      ],
    })
    expect(await pendingRequestCodes()).not.toContain("SOL-COLA-0003")
  })

  it("anular la OC devuelve sus ítems a la cola", async () => {
    await seedRequest("req-4", "SOL-COLA-0004")
    await seedItem("it-4a", "req-4", { status: "approved" })

    const orderId = await createOrder({
      worksiteId: WS, supplierId: "sup-cola", createdBy: USER,
      items: [{ requestItemId: "it-4a", productId: "prod-cola", productNameFree: null, quantity: 5, unitOfMeasure: "unidad", unitPrice: 500 }],
    })
    expect(await pendingItemIds()).not.toContain("it-4a")

    await cancelOrder(orderId, USER, "proveedor sin stock")
    expect(await pendingItemIds()).toContain("it-4a")
  })

  it("cerrar una OC sin recibir nada devuelve el ítem a la cola SIN cobertura fantasma", async () => {
    // La regresión concreta: `closeOrderTx` devolvía el ítem a
    // `pending_purchase` pero dejaba su línea de OC en 'issued', o sea con
    // cobertura activa. El contador lo contaba y el selector lo descartaba.
    await seedRequest("req-5", "SOL-COLA-0005")
    await seedItem("it-5a", "req-5", { status: "approved", name: "Recibido" })
    await seedItem("it-5b", "req-5", { status: "approved", name: "Nunca llegó", sortOrder: 1 })

    const orderId = await createOrder({
      worksiteId: WS, supplierId: "sup-cola", createdBy: USER,
      items: [
        { requestItemId: "it-5a", productId: "prod-cola", productNameFree: null, quantity: 5, unitOfMeasure: "unidad", unitPrice: 100 },
        { requestItemId: "it-5b", productId: "prod-cola", productNameFree: null, quantity: 5, unitOfMeasure: "unidad", unitPrice: 100 },
      ],
    })
    await issueAndSendOrder(orderId, USER)

    // Una línea recibida en oficina y en faena; la otra nunca llega.
    const orderItems = await inMemoryDb
      .select({ id: schema.purchaseOrderItems.id, requestItemId: schema.purchaseOrderItems.requestItemId })
      .from(schema.purchaseOrderItems)
      .where(eq(schema.purchaseOrderItems.purchaseOrderId, orderId))
    const receivedLine = orderItems.find((line) => line.requestItemId === "it-5a")!
    await inMemoryDb
      .update(schema.purchaseOrderItems)
      .set({ quantityOfficeReceived: 5, quantityReceived: 5 })
      .where(eq(schema.purchaseOrderItems.id, receivedLine.id))
    await inMemoryDb
      .update(schema.purchaseOrders)
      .set({ status: "partially_received" })
      .where(eq(schema.purchaseOrders.id, orderId))
    await inMemoryDb
      .update(schema.purchaseRequestItems)
      .set({ status: "received" })
      .where(eq(schema.purchaseRequestItems.id, "it-5a"))

    await closeOrder(orderId, USER, "el proveedor no repuso el saldo")

    // El ítem no recibido vuelve a la cola…
    expect(await pendingItemIds()).toContain("it-5b")
    // …y el resumen dice lo mismo que la tabla: era justo acá donde divergían.
    expect(await countPendingPurchaseItems(undefined)).toBe((await pendingItemIds()).length)
    // La línea muerta queda anulada, que es lo que hace que las dos coincidan.
    const [deadLine] = await inMemoryDb
      .select({ status: schema.purchaseOrderItems.status })
      .from(schema.purchaseOrderItems)
      .where(inArray(schema.purchaseOrderItems.id, [orderItems.find((l) => l.requestItemId === "it-5b")!.id]))
    expect(deadLine!.status).toBe("cancelled")
  })

  it("el scope de faena acota la cola y su contador por igual", async () => {
    await seedRequest("req-ajena", "SOL-COLA-0006", { worksiteId: WS_AJENA })
    await seedItem("it-ajena", "req-ajena", { status: "approved" })

    const ownScope = inArray(schema.purchaseRequests.worksiteId, [WS])
    const codes = (await listPendingPurchaseRequests(ownScope, {}, { limit: 50, offset: 0 })).map((r) => r.code)
    expect(codes).not.toContain("SOL-COLA-0006")
    expect(await countPendingPurchaseRequests(ownScope)).toBe(codes.length)
  })

  it("filtra por texto, faena y proveedor sugerido sin que el contador se desacople", async () => {
    const filters = { q: "SOL-COLA-0002" }
    const rows = await listPendingPurchaseRequests(undefined, filters, { limit: 50, offset: 0 })
    expect(rows.map((row) => row.code)).toEqual(["SOL-COLA-0002"])
    expect(await countPendingPurchaseRequests(undefined, filters)).toBe(1)
    expect(await countPendingPurchaseItems(undefined, filters)).toBe(
      rows[0]!.pendingItemCount,
    )

    const bySupplier = { supplierId: "sup-cola" }
    expect(await countPendingPurchaseRequests(undefined, bySupplier))
      .toBe((await listPendingPurchaseRequests(undefined, bySupplier, { limit: 50, offset: 0 })).length)
  })

  it("expone quién solicitó, la faena y el proveedor sugerido de cada solicitud", async () => {
    const row = (await listPendingPurchaseRequests(undefined, { q: "SOL-COLA-0002" }, { limit: 50, offset: 0 }))[0]!
    expect(row.requesterName).toBe("Compradora")
    expect(row.worksiteName).toBe("Faena Cola")
    expect(row.supplierNames).toEqual(["Proveedor Cola"])
    expect(row.date).toBe(now)
  })
})
