/**
 * Two-stage receiving — rollup precedence & stage gating.
 *
 * Verifies the mandatory office → faena flow:
 *  - office reception updates quantityOfficeReceived and rolls the OC up through
 *    partially_office_received / office_received without touching stock,
 *  - faena reception is capped strictly at what arrived at office (no direct path),
 *  - the OC status rollup is deterministic from item quantities and monotonic.
 */

import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import path from "node:path"
import { eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import { nanoid } from "@/lib/id"

// ── In-memory PostgreSQL database & migrations ────────────────────────────────
const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite is structurally compatible at runtime; postgres-js type differs only in result-type HKT
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

// notifyAfterCommit queda REAL a propósito: lo que se verifica es que registerReceipt
// no lo invoque dentro de la transacción, no el primitivo en sí.
vi.mock("@/lib/services/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/notifications")>()),
  notifyManyUser: vi.fn(async () => {}),
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import { registerReceipt } from "@/lib/services/receiving"
import { closeOrder, createPurchaseOrderInvoice } from "@/lib/services/purchasing"
import { getOcReconciliation } from "@/lib/services/oc-reconciliation"
import { getPurchaseOrderInvoiceReconciliation } from "@/lib/services/purchasing-module/invoice-reconciliation-service"
import { notifyManyUser } from "@/lib/services/notifications"

const USER_ID = "u-test"
const WS_ID   = "ws-test"
const OFFICE_ID = "ws-office-test"
const SUP_ID  = "sup-test"

beforeAll(async () => {
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.users).values({
    id: USER_ID, name: "Tester", email: "tester@chome.cl",
    hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: WS_ID, name: "Faena Test", code: "FN-TEST", isActive: true, createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: OFFICE_ID, name: "Oficina CHOME", code: "OF-TEST", isActive: true, createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: "ws-other", name: "Faena Ajena", code: "FN-OTHER", isActive: true, createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.suppliers).values({
    id: SUP_ID, name: "Proveedor Test", isActive: true, createdAt: now, updatedAt: now,
  })
})

afterAll(async () => pg.close())

let ocCounter = 0
/** Creates a fresh "sent" OC with the given item quantities; returns { orderId, itemIds }. */
async function makeOrder(
  quantities: number[],
  deliveryMode: "via_oficina" | "directo_faena" = "via_oficina",
): Promise<{ orderId: string; itemIds: string[] }> {
  const orderId = `oc-${++ocCounter}`
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.purchaseOrders).values({
    id: orderId, code: `OC-TEST-${ocCounter}`, worksiteId: WS_ID, supplierId: SUP_ID,
    createdBy: USER_ID, status: "sent", deliveryMode, createdAt: now, updatedAt: now,
  })
  const itemIds: string[] = []
  for (let i = 0; i < quantities.length; i++) {
    const id = nanoid()
    itemIds.push(id)
    // productId/requestItemId left null → faena reception only updates quantities (no stock/request side effects).
    await inMemoryDb.insert(schema.purchaseOrderItems).values({
      id, purchaseOrderId: orderId, quantity: quantities[i]!, unitOfMeasure: "unidad", sortOrder: i,
    })
  }
  return { orderId, itemIds }
}

async function status(orderId: string): Promise<string> {
  const o = await inMemoryDb.query.purchaseOrders.findFirst({ where: eq(schema.purchaseOrders.id, orderId) })
  return o!.status
}

describe("two-stage receiving rollup", () => {
  it("reconciles a direct order after two receipts and two partial invoices totaling 10 units", async () => {
    const { orderId, itemIds } = await makeOrder([10], "directo_faena")
    const itemId = itemIds[0]!
    await inMemoryDb.update(schema.purchaseOrders)
      .set({ netAmount: 10000, taxAmount: 0, totalAmount: 10000 })
      .where(eq(schema.purchaseOrders.id, orderId))
    await inMemoryDb.update(schema.purchaseOrderItems)
      .set({ unitPrice: 1000, subtotal: 10000 })
      .where(eq(schema.purchaseOrderItems.id, itemId))

    const firstReceiptId = await registerReceipt({
      purchaseOrderId: orderId,
      receivedBy: USER_ID,
      stage: "faena",
      worksiteId: WS_ID,
      items: [{ purchaseOrderItemId: itemId, quantityReceived: 6 }],
    })
    await createPurchaseOrderInvoice({
      purchaseOrderId: orderId,
      invoiceNumber: `F-${orderId}-6`,
      amount: 6000,
      fileName: `${orderId}-6.pdf`,
      filePath: `storage/purchase-orders/${orderId}-6.pdf`,
      uploadedBy: USER_ID,
      receiptIds: [firstReceiptId],
      items: [{
        purchaseOrderItemId: itemId,
        productName: "EPP parcial",
        unitOfMeasure: "unidad",
        quantity: 6,
        unitPrice: 1000,
        subtotal: 6000,
      }],
    })

    let evidence = await getPurchaseOrderInvoiceReconciliation(orderId)
    expect(evidence.status).toBe("partially_invoiced")
    expect(evidence.coverage).toMatchObject({
      status: "partial",
      remainingAmount: 4000,
      pendingItemCount: 1,
      coveredItemCount: 0,
      totalItemCount: 1,
    })
    expect(evidence.items[0]).toMatchObject({
      ocQuantity: 10,
      supplierReceivedQty: 6,
      invoicedQty: 6,
    })

    const secondReceiptId = await registerReceipt({
      purchaseOrderId: orderId,
      receivedBy: USER_ID,
      stage: "faena",
      worksiteId: WS_ID,
      items: [{ purchaseOrderItemId: itemId, quantityReceived: 4 }],
    })
    await createPurchaseOrderInvoice({
      purchaseOrderId: orderId,
      invoiceNumber: `F-${orderId}-4`,
      amount: 4000,
      fileName: `${orderId}-4.pdf`,
      filePath: `storage/purchase-orders/${orderId}-4.pdf`,
      uploadedBy: USER_ID,
      receiptIds: [secondReceiptId],
      items: [{
        purchaseOrderItemId: itemId,
        productName: "EPP saldo",
        unitOfMeasure: "unidad",
        quantity: 4,
        unitPrice: 1000,
        subtotal: 4000,
      }],
    })

    evidence = await getPurchaseOrderInvoiceReconciliation(orderId)
    expect(evidence.status).toBe("matched")
    expect(evidence.coverage).toMatchObject({
      status: "complete",
      remainingAmount: 0,
      pendingItemCount: 0,
      coveredItemCount: 1,
      totalItemCount: 1,
    })
    expect(evidence.items[0]).toMatchObject({
      ocQuantity: 10,
      supplierReceivedQty: 10,
      invoicedQty: 10,
    })
  })

  it("recalculates three-way reconciliation when accepted supplier delivery advances", async () => {
    const { orderId, itemIds } = await makeOrder([2])
    await inMemoryDb.update(schema.purchaseOrderItems)
      .set({ unitPrice: 0, subtotal: 0 })
      .where(eq(schema.purchaseOrderItems.id, itemIds[0]!))
    await createPurchaseOrderInvoice({
      purchaseOrderId: orderId,
      invoiceNumber: `F-${orderId}`,
      amount: 0,
      fileName: `${orderId}.pdf`,
      filePath: `storage/purchase-orders/${orderId}.pdf`,
      uploadedBy: USER_ID,
      items: [{
        purchaseOrderItemId: itemIds[0],
        productName: "Servicio documental",
        unitOfMeasure: "unidad",
        quantity: 2,
        unitPrice: 0,
        subtotal: 0,
      }],
    })
    let order = await inMemoryDb.query.purchaseOrders.findFirst({ where: eq(schema.purchaseOrders.id, orderId) })
    expect(order?.invoiceReconciliationStatus).toBe("awaiting_receipt")

    await registerReceipt({
      purchaseOrderId: orderId,
      receivedBy: USER_ID,
      stage: "office",
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 2 }],
    })
    order = await inMemoryDb.query.purchaseOrders.findFirst({ where: eq(schema.purchaseOrders.id, orderId) })
    expect(order?.invoiceReconciliationStatus).toBe("matched")
  })

  it("partial office reception → partially_office_received", async () => {
    const { orderId, itemIds } = await makeOrder([10])
    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "office",
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 4 }],
    })
    expect(await status(orderId)).toBe("partially_office_received")
  })

  it("full office reception → office_received, without touching faena stock", async () => {
    const { orderId, itemIds } = await makeOrder([10])
    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "office",
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 10 }],
    })
    expect(await status(orderId)).toBe("office_received")
    const stock = await inMemoryDb.query.worksiteStock.findFirst({ where: eq(schema.worksiteStock.worksiteId, WS_ID) })
    expect(stock).toBeUndefined()
  })

  it("faena reception on a 'sent' OC is rejected (office is mandatory first)", async () => {
    const { orderId, itemIds } = await makeOrder([10])
    await expect(registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "faena", worksiteId: WS_ID,
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 5 }],
    })).rejects.toThrow(/oficina/i)
  })

  it("rejects a client-provided worksite different from the purchase order", async () => {
    const { orderId, itemIds } = await makeOrder([10])
    await expect(registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "office", worksiteId: "ws-other",
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 5 }],
    })).rejects.toThrow(/debe coincidir/i)

    expect(await status(orderId)).toBe("sent")
  })

  it("partial faena (after full office) → partially_received", async () => {
    const { orderId, itemIds } = await makeOrder([10])
    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "office",
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 10 }],
    })
    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "faena", worksiteId: WS_ID,
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 6 }],
    })
    expect(await status(orderId)).toBe("partially_received")
  })

  it("full faena → auto-closes the order", async () => {
    const { orderId, itemIds } = await makeOrder([10])
    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "office",
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 10 }],
    })
    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "faena", worksiteId: WS_ID,
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 10 }],
    })
    expect(await status(orderId)).toBe("closed")
  })

  it("mixed items (one fully at faena, one only at office) → partially_received (anyFaena wins)", async () => {
    const { orderId, itemIds } = await makeOrder([10, 10])
    // Both items fully received at office.
    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "office",
      items: [
        { purchaseOrderItemId: itemIds[0]!, quantityReceived: 10 },
        { purchaseOrderItemId: itemIds[1]!, quantityReceived: 10 },
      ],
    })
    // Only the first item reaches faena.
    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "faena", worksiteId: WS_ID,
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 10 }],
    })
    expect(await status(orderId)).toBe("partially_received")
  })
})

describe("two-stage receiving gating", () => {
  it("faena reception cannot exceed what arrived at office", async () => {
    const { orderId, itemIds } = await makeOrder([10])
    // Only 5 arrived at office.
    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "office",
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 5 }],
    })
    // Trying to dispatch 6 to faena exceeds the 5 available at office.
    await expect(registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "faena", worksiteId: WS_ID,
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 6 }],
    })).rejects.toThrow(/exceeds pending/i)
  })

  it("office reception cannot exceed the ordered quantity", async () => {
    const { orderId, itemIds } = await makeOrder([10])
    await expect(registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "office",
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 11 }],
    })).rejects.toThrow(/exceeds pending/i)
  })

  it("caps rejected and damaged quantities against the same stage balance", async () => {
    const { orderId, itemIds } = await makeOrder([10])
    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "office",
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 0, quantityRejected: 8 }],
    })
    await expect(registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "office",
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 0, quantityDamaged: 3 }],
    })).rejects.toThrow(/exceeds pending/i)
  })
})

describe("cierre de OC con mercadería descartada en faena", () => {
  it("permite cerrar cuando el saldo de oficina se rechazó/dañó al llegar a faena", async () => {
    const { orderId, itemIds } = await makeOrder([10])
    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "office",
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 10 }],
    })
    // Llegan las 10 a faena pero 2 vienen dañadas: quantityReceived queda en 8
    // y la disposición de la etapa se agota. Antes esto dejaba la OC sin
    // ninguna salida (no se podía recibir más, ni cerrar, ni anular).
    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "faena", worksiteId: WS_ID,
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 8, quantityDamaged: 2 }],
    })
    expect(await status(orderId)).toBe("partially_received")

    await closeOrder(orderId, USER_ID, "Saldo dañado en el traslado")
    expect(await status(orderId)).toBe("closed")
  })

  it("sigue bloqueando el cierre cuando el saldo está realmente en oficina", async () => {
    const { orderId, itemIds } = await makeOrder([10])
    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "office",
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 10 }],
    })
    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "faena", worksiteId: WS_ID,
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 6 }],
    })
    await expect(closeOrder(orderId, USER_ID, "Cierre prematuro"))
      .rejects.toThrow(/aún no llega a faena/i)
  })
})

describe("ítems sin producto de catálogo", () => {
  it("cierra el ítem y la solicitud al llegar completo a faena (no hay entrega posible)", async () => {
    const now = new Date().toISOString()
    const requestId = `req-free-${++ocCounter}`
    const requestItemId = `item-free-${ocCounter}`
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: requestId, code: `SOL-FREE-${ocCounter}`, worksiteId: WS_ID, requesterId: USER_ID,
      requestType: "servicios", urgency: "normal", status: "in_purchasing",
      createdAt: now, updatedAt: now,
    })
    // productId null: texto libre, no genera stock al recibirse, así que
    // ninguna pantalla de entrega puede despacharlo.
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: requestItemId, requestId, productId: null, productNameFree: "Mantención generador",
      quantity: 1, unitOfMeasure: "unidad", status: "purchased", urgency: "normal",
      sortOrder: 0, createdAt: now, updatedAt: now,
    })
    const orderId = `oc-free-${ocCounter}`
    const ocItemId = nanoid()
    await inMemoryDb.insert(schema.purchaseOrders).values({
      id: orderId, code: `OC-FREE-${ocCounter}`, worksiteId: WS_ID, supplierId: SUP_ID,
      createdBy: USER_ID, status: "sent", deliveryMode: "directo_faena", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseOrderItems).values({
      id: ocItemId, purchaseOrderId: orderId, requestItemId, productId: null,
      quantity: 1, unitOfMeasure: "unidad", sortOrder: 0,
    })

    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "faena", worksiteId: WS_ID,
      items: [{ purchaseOrderItemId: ocItemId, quantityReceived: 1 }],
    })

    const item = await inMemoryDb.query.purchaseRequestItems.findFirst({
      where: eq(schema.purchaseRequestItems.id, requestItemId),
    })
    expect(item!.status).toBe("delivered")
    const request = await inMemoryDb.query.purchaseRequests.findFirst({
      where: eq(schema.purchaseRequests.id, requestId),
    })
    expect(request!.status).toBe("closed")
  })

  it("un ítem con producto de catálogo sigue quedando en 'received' a la espera de entrega", async () => {
    const now = new Date().toISOString()
    const requestId = `req-cat-${++ocCounter}`
    const requestItemId = `item-cat-${ocCounter}`
    const productId = `prod-cat-${ocCounter}`
    const categoryId = `cat-${ocCounter}`
    await inMemoryDb.insert(schema.productCategories).values({
      id: categoryId, name: `Categoría ${ocCounter}`, slug: `cat-${ocCounter}`,
    })
    await inMemoryDb.insert(schema.products).values({
      id: productId, name: "Guante", sku: `SKU-${ocCounter}`, categoryId, unitOfMeasure: "unidad",
      isEpp: true, isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: requestId, code: `SOL-CAT-${ocCounter}`, worksiteId: WS_ID, requesterId: USER_ID,
      requestType: "epp", urgency: "normal", status: "in_purchasing",
      createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: requestItemId, requestId, productId, quantity: 1, unitOfMeasure: "unidad",
      status: "purchased", urgency: "normal", sortOrder: 0, createdAt: now, updatedAt: now,
    })
    const orderId = `oc-cat-${ocCounter}`
    const ocItemId = nanoid()
    await inMemoryDb.insert(schema.purchaseOrders).values({
      id: orderId, code: `OC-CAT-${ocCounter}`, worksiteId: WS_ID, supplierId: SUP_ID,
      createdBy: USER_ID, status: "sent", deliveryMode: "directo_faena", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseOrderItems).values({
      id: ocItemId, purchaseOrderId: orderId, requestItemId, productId,
      quantity: 1, unitOfMeasure: "unidad", sortOrder: 0,
    })

    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "faena", worksiteId: WS_ID,
      items: [{ purchaseOrderItemId: ocItemId, quantityReceived: 1 }],
    })

    const item = await inMemoryDb.query.purchaseRequestItems.findFirst({
      where: eq(schema.purchaseRequestItems.id, requestItemId),
    })
    expect(item!.status).toBe("received")
  })

  it("recepcionar un producto de servicio no crea stock ni movimiento de inventario", async () => {
    const now = new Date().toISOString()
    const suffix = ++ocCounter
    const categoryId = `cat-service-${suffix}`
    const productId = `prod-service-${suffix}`
    const requestId = `req-service-${suffix}`
    const requestItemId = `req-item-service-${suffix}`
    const orderId = `oc-service-${suffix}`
    const orderItemId = `oci-service-${suffix}`

    await inMemoryDb.insert(schema.productCategories).values({
      id: categoryId, name: `Servicios ${suffix}`, slug: `services-${suffix}`,
    })
    await inMemoryDb.insert(schema.products).values({
      id: productId, sku: `SRV-${suffix}`, name: "Calibración", categoryId,
      unitOfMeasure: "servicio", isService: true, isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: requestId, code: `SOL-SERVICE-${suffix}`, worksiteId: WS_ID, requesterId: USER_ID,
      urgency: "normal", status: "in_purchasing", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: requestItemId, requestId, productId, quantity: 1, unitOfMeasure: "servicio",
      status: "purchased", urgency: "normal", sortOrder: 0, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseOrders).values({
      id: orderId, code: `OC-SERVICE-${suffix}`, worksiteId: WS_ID, supplierId: SUP_ID,
      createdBy: USER_ID, status: "sent", deliveryMode: "directo_faena", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseOrderItems).values({
      id: orderItemId, purchaseOrderId: orderId, requestItemId, productId,
      quantity: 1, unitOfMeasure: "servicio", sortOrder: 0,
    })

    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "faena", worksiteId: WS_ID,
      items: [{ purchaseOrderItemId: orderItemId, quantityReceived: 1 }],
    })

    const stock = await inMemoryDb.query.worksiteStock.findFirst({
      where: eq(schema.worksiteStock.productId, productId),
    })
    const movements = await inMemoryDb.select().from(schema.inventoryMovements)
      .where(eq(schema.inventoryMovements.productId, productId))
    const requestItem = await inMemoryDb.query.purchaseRequestItems.findFirst({
      where: eq(schema.purchaseRequestItems.id, requestItemId),
    })
    expect(stock).toBeUndefined()
    expect(movements).toHaveLength(0)
    expect(requestItem?.status).toBe("delivered")
  })
})

describe("direct-to-faena receiving", () => {
  it("faena reception on a 'sent' directo_faena OC is accepted (no office needed)", async () => {
    const { orderId, itemIds } = await makeOrder([10], "directo_faena")
    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "faena", worksiteId: WS_ID,
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 4 }],
    })
    expect(await status(orderId)).toBe("partially_received")
  })

  it("full faena reception on directo_faena → auto-closes the order", async () => {
    const { orderId, itemIds } = await makeOrder([10], "directo_faena")
    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "faena", worksiteId: WS_ID,
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 10 }],
    })
    expect(await status(orderId)).toBe("closed")
  })

  it("faena reception caps at ordered quantity (not at office)", async () => {
    const { orderId, itemIds } = await makeOrder([10], "directo_faena")
    await expect(registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "faena", worksiteId: WS_ID,
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 11 }],
    })).rejects.toThrow(/exceeds pending/i)
  })

  it("office reception on a directo_faena OC is rejected", async () => {
    const { orderId, itemIds } = await makeOrder([10], "directo_faena")
    await expect(registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "office",
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 5 }],
    })).rejects.toThrow(/directo a faena/i)
  })
})

describe("receipt notifications", () => {
  it("no notifica cuando la transacción termina en rollback", async () => {
    vi.mocked(notifyManyUser).mockClear()

    // Ítem de solicitud real: sin requestItemId el aviso de oficina ni siquiera se arma.
    const now = new Date().toISOString()
    const reqId = `req-notify-${++ocCounter}`
    const reqItemId = nanoid()
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: reqId, code: `SOL-NOTIFY-${ocCounter}`, worksiteId: WS_ID, requesterId: USER_ID,
      requestType: "epp", urgency: "normal", status: "in_purchasing", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: reqItemId, requestId: reqId, productNameFree: "Casco", quantity: 10,
      unitOfMeasure: "unidad", status: "purchased", createdAt: now, updatedAt: now,
    })

    const { orderId, itemIds } = await makeOrder([10, 10])
    await inMemoryDb.update(schema.purchaseOrderItems)
      .set({ requestItemId: reqItemId })
      .where(eq(schema.purchaseOrderItems.id, itemIds[0]!))

    // La primera línea encola el aviso; la segunda revienta el saldo (5+7 > 10) y
    // arrastra todo el comprobante. El aviso no puede haber salido.
    await expect(registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "office",
      items: [
        { purchaseOrderItemId: itemIds[0]!, quantityReceived: 5 },
        { purchaseOrderItemId: itemIds[1]!, quantityReceived: 5, quantityRejected: 7 },
      ],
    })).rejects.toThrow(/exceeds pending/i)

    // Se drena la cola de microtasks: con notifyAfterCommit dentro del tx el aviso
    // ya habría salido en este punto.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(notifyManyUser).not.toHaveBeenCalled()
    expect(await status(orderId)).toBe("sent")
  })
})

describe("avance de la OC (getOcReconciliation)", () => {
  it("no suma la etapa de oficina: el recibido es sólo lo que llegó a faena", async () => {
    const { orderId, itemIds } = await makeOrder([10])
    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "office",
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 10 }],
    })
    const soloOficina = await getOcReconciliation(orderId, itemIds)
    expect(soloOficina.receivedByItem.get(itemIds[0]!) ?? 0).toBe(0)
    expect(soloOficina.totalReceived).toBe(0)

    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: USER_ID, stage: "faena", worksiteId: WS_ID,
      items: [{ purchaseOrderItemId: itemIds[0]!, quantityReceived: 10 }],
    })
    // La misma unidad generó una fila en oficina y otra en faena: 10, no 20.
    const conFaena = await getOcReconciliation(orderId, itemIds)
    expect(conFaena.receivedByItem.get(itemIds[0]!)).toBe(10)
    expect(conFaena.totalReceived).toBe(10)
  })
})
