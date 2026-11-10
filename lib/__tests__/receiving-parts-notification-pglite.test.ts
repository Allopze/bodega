/**
 * Aviso a mantención al recibir repuestos de una OT (2026-11-07).
 *
 * Regla: sólo cuando una línea que pidió una OT llega COMPLETA a faena, y una
 * vez por OT y recepción, después del commit. Una recepción parcial, la
 * llegada a oficina y las líneas sin OT no avisan a mantención.
 *
 * Catálogo de repuestos (2026-11-09): el repuesto de catálogo es de consumo
 * directo, así que su recepción no mueve stock ni kárdex y deja el ítem
 * `delivered` (la OT deja de esperarlo). Está al final de este archivo.
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import path from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { eq, sql } from "drizzle-orm"
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

// El aviso al solicitante queda simulado; `notifyAfterCommit` queda REAL, porque
// lo que se verifica es que el aviso a mantención salga por él y después del commit.
vi.mock("@/lib/services/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/notifications")>()),
  notifyManyUser: vi.fn(async () => {}),
}))

/** Lo que la simulación vio en el instante de cada llamada: el ítem ya debe estar confirmado en la BD. */
const calls = vi.hoisted(() => [] as Array<{ input: Record<string, unknown>; itemStatusAtCall: string | null }>)
vi.mock("@/lib/services/mantencion/work-orders/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/mantencion/work-orders/notifications")>()),
  notifyWorkOrderPartsReceived: vi.fn(async (input: Record<string, unknown>) => {
    const db = (globalThis as typeof globalThis & { __db?: typeof testDb }).__db!
    const [item] = await db.select({ status: schema.purchaseRequestItems.status }).from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.workOrderId, String(input.workOrderId)))
    calls.push({ input, itemStatusAtCall: item?.status ?? null })
  }),
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { IDS, seedMantFixtures } = await import("./mantencion-sync-fixtures")
const { createWorkOrderWithClient } = await import("@/lib/services/mantencion/work-orders/create")
const { registerReceipt } = await import("@/lib/services/receiving")
const { notifyWorkOrderPartsReceived } = await import("@/lib/services/mantencion/work-orders/notifications")
const { voidReceipt } = await import("@/lib/services/receiving-void")
const { createSparePartTx } = await import("@/lib/services/spare-parts-catalog")
const { isWaitingParts, loadWorkOrderPartsRequests, partsPendingExistsSql } = await import("@/lib/services/mantencion/work-orders/parts-requests")

const now = new Date().toISOString()
let otA = ""
let otB = ""
let counter = 0

async function newWorkOrder(): Promise<string> {
  const created = await testDb.transaction((tx) => createWorkOrderWithClient(tx as never, {
    vehicleId: IDS.truckBio, inspectionFindingId: null, repair: true, maintenance: false,
    repairDescription: "Fuga hidráulica", observations: null, requesterName: "Alexis Morales",
  }, { userId: IDS.jefe, name: "Alexis Morales" }))
  return created.id
}

/**
 * Una solicitud de repuestos con una línea por entrada de `lines` y una OC que
 * las compra. `workOrderId: null` = línea sin OT (ni vínculo de vehículo).
 */
async function seedOrder(
  lines: Array<{ quantity: number; workOrderId: string | null; productId?: string | null }>,
  deliveryMode: "directo_faena" | "via_oficina" = "directo_faena",
) {
  const n = ++counter
  const requestId = `req-p${n}`
  await testDb.insert(schema.purchaseRequests).values({
    id: requestId, code: `REP-P${n}`, worksiteId: IDS.wsBio, requesterId: IDS.jefe, requestType: "repuestos",
    status: "in_purchasing", urgency: "high", deliveryMode, createdAt: now, updatedAt: now,
  })
  const orderId = `oc-p${n}`
  await testDb.insert(schema.purchaseOrders).values({
    id: orderId, code: `OC-P${n}`, worksiteId: IDS.wsBio, supplierId: "sup-p", createdBy: IDS.jefe,
    status: "sent", deliveryMode, createdAt: now, updatedAt: now,
  })
  const ocItemIds: string[] = []
  for (const [index, line] of lines.entries()) {
    const itemId = `item-p${n}-${index}`
    await testDb.insert(schema.purchaseRequestItems).values({
      id: itemId, requestId, productNameFree: `Repuesto ${index}`, quantity: line.quantity, unitOfMeasure: "unidad",
      status: "purchased", urgency: "high", sortOrder: index, createdAt: now, updatedAt: now,
      productId: line.productId ?? null,
      ...(line.workOrderId ? { vehicleId: IDS.truckBio, workOrderId: line.workOrderId } : {}),
    })
    const ocItemId = `ocitem-p${n}-${index}`
    ocItemIds.push(ocItemId)
    await testDb.insert(schema.purchaseOrderItems).values({
      id: ocItemId, purchaseOrderId: orderId, requestItemId: itemId, productId: line.productId ?? null,
      quantity: line.quantity, unitOfMeasure: "unidad", sortOrder: index,
    })
  }
  return { orderId, ocItemIds }
}

/** Deja correr el microtask de `notifyAfterCommit` y lo que éste encadena. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20))

describe("recepción de repuestos vinculados a una OT", () => {
  beforeAll(async () => {
    await seedMantFixtures(testDb as unknown as DB)
    await testDb.insert(schema.suppliers).values({
      id: "sup-p", name: "Repuestos del Sur", rut: "76.000.222-2", isActive: true, createdAt: now, updatedAt: now,
    })
    otA = await newWorkOrder()
    otB = await newWorkOrder()
  })

  beforeEach(() => {
    calls.length = 0
    vi.mocked(notifyWorkOrderPartsReceived).mockClear()
  })

  afterAll(async () => {
    await pg.close()
  })

  it("una recepción completa en faena de ítems con work_order_id dispara notifyWorkOrderPartsReceived después del commit, una vez por OT", async () => {
    // Tres líneas: dos de la OT A y una de la OT B, todas en la misma recepción.
    const { orderId, ocItemIds } = await seedOrder([
      { quantity: 2, workOrderId: otA }, { quantity: 1, workOrderId: otA }, { quantity: 1, workOrderId: otB },
    ])

    const receiptId = await registerReceipt({
      purchaseOrderId: orderId, receivedBy: IDS.mecBio, stage: "faena", worksiteId: IDS.wsBio,
      items: [
        { purchaseOrderItemId: ocItemIds[0]!, quantityReceived: 2 },
        { purchaseOrderItemId: ocItemIds[1]!, quantityReceived: 1 },
        { purchaseOrderItemId: ocItemIds[2]!, quantityReceived: 1 },
      ],
    })
    await settle()

    expect(notifyWorkOrderPartsReceived).toHaveBeenCalledTimes(2)
    const byOrder = new Map(calls.map((call) => [call.input.workOrderId, call]))
    expect(byOrder.get(otA)!.input).toEqual({ workOrderId: otA, receiptId, actorUserId: IDS.mecBio, itemCount: 2 })
    expect(byOrder.get(otB)!.input).toEqual({ workOrderId: otB, receiptId, actorUserId: IDS.mecBio, itemCount: 1 })
    // Salió después del commit: al llamarse, el ítem ya figuraba recibido en la BD.
    expect(calls.every((call) => call.itemStatusAtCall === "delivered")).toBe(true)
  })

  it("una recepción parcial no avisa; la completa sí", async () => {
    const { orderId, ocItemIds } = await seedOrder([{ quantity: 3, workOrderId: otA }])

    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: IDS.mecBio, stage: "faena", worksiteId: IDS.wsBio,
      items: [{ purchaseOrderItemId: ocItemIds[0]!, quantityReceived: 1 }],
    })
    await settle()
    expect(notifyWorkOrderPartsReceived).not.toHaveBeenCalled()

    const receiptId = await registerReceipt({
      purchaseOrderId: orderId, receivedBy: IDS.mecBio, stage: "faena", worksiteId: IDS.wsBio,
      items: [{ purchaseOrderItemId: ocItemIds[0]!, quantityReceived: 2 }],
    })
    await settle()
    expect(notifyWorkOrderPartsReceived).toHaveBeenCalledTimes(1)
    expect(notifyWorkOrderPartsReceived).toHaveBeenCalledWith({ workOrderId: otA, receiptId, actorUserId: IDS.mecBio, itemCount: 1 })
  })

  it("la recepción en oficina no avisa a mantención", async () => {
    await testDb.insert(schema.worksites).values({
      id: "ws-oficina-p", name: "Oficina CHOME", code: "OF-P", isActive: true, createdAt: now, updatedAt: now,
    }).onConflictDoNothing()
    const { orderId, ocItemIds } = await seedOrder([{ quantity: 1, workOrderId: otA }], "via_oficina")

    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: IDS.mecBio, stage: "office",
      items: [{ purchaseOrderItemId: ocItemIds[0]!, quantityReceived: 1 }],
    })
    await settle()

    expect(notifyWorkOrderPartsReceived).not.toHaveBeenCalled()
  })

  it("una línea sin OT no avisa a mantención", async () => {
    const { orderId, ocItemIds } = await seedOrder([{ quantity: 1, workOrderId: null }])

    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: IDS.mecBio, stage: "faena", worksiteId: IDS.wsBio,
      items: [{ purchaseOrderItemId: ocItemIds[0]!, quantityReceived: 1 }],
    })
    await settle()

    expect(notifyWorkOrderPartsReceived).not.toHaveBeenCalled()
  })

  it("si la recepción se revierte en la transacción no hay aviso, aunque una línea ya estuviera completa", async () => {
    // La primera línea queda completa y se acumula; la segunda excede el saldo y revierte todo.
    const { orderId, ocItemIds } = await seedOrder([{ quantity: 1, workOrderId: otA }, { quantity: 1, workOrderId: otA }])

    await expect(registerReceipt({
      purchaseOrderId: orderId, receivedBy: IDS.mecBio, stage: "faena", worksiteId: IDS.wsBio,
      items: [
        { purchaseOrderItemId: ocItemIds[0]!, quantityReceived: 1 },
        { purchaseOrderItemId: ocItemIds[1]!, quantityReceived: 5 },
      ],
    })).rejects.toThrow(/excede el saldo pendiente/)
    await settle()

    expect(notifyWorkOrderPartsReceived).not.toHaveBeenCalled()
    const [first] = await testDb.select({ status: schema.purchaseRequestItems.status }).from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.id, `item-p${counter}-0`))
    expect(first!.status).toBe("purchased")
  })

  describe("repuesto de catálogo: consumo directo (sin stock ni kárdex)", () => {
    let sparePartId = ""
    let plainProductId = ""

    beforeAll(async () => {
      sparePartId = (await testDb.transaction((tx) => createSparePartTx(tx as unknown as Tx, {
        name: "Filtro hidráulico", partNumber: "HF-35", unitOfMeasure: "unidad", createdByUserId: IDS.jefe,
      }))).id
      // Control: un producto físico común sí entra al stock al recibirse.
      await testDb.insert(schema.productCategories).values({
        id: "cat-rec-control", name: "Insumos (control)", slug: "insumos-control", isEpp: false, requiresPrevencion: false, sortOrder: 1,
      })
      plainProductId = "prod-rec-control"
      await testDb.insert(schema.products).values({
        id: plainProductId, sku: "PRD-CTL-1", name: "Aceite hidráulico", categoryId: "cat-rec-control", unitOfMeasure: "unidad",
      })
    })

    const stockRows = (productId: string) => testDb.select().from(schema.worksiteStock).where(eq(schema.worksiteStock.productId, productId))
    const movementRows = (productId: string) => testDb.select().from(schema.inventoryMovements).where(eq(schema.inventoryMovements.productId, productId))
    const itemStatus = async (orderItemId: string) => {
      const [row] = await testDb
        .select({ status: schema.purchaseRequestItems.status })
        .from(schema.purchaseOrderItems)
        .innerJoin(schema.purchaseRequestItems, eq(schema.purchaseRequestItems.id, schema.purchaseOrderItems.requestItemId))
        .where(eq(schema.purchaseOrderItems.id, orderItemId))
      return row?.status
    }
    const waiting = async (workOrderId: string) => {
      const [row] = await testDb
        .select({ waiting: sql<boolean>`${partsPendingExistsSql(schema.mantWorkOrders.id)}` })
        .from(schema.mantWorkOrders)
        .where(eq(schema.mantWorkOrders.id, workOrderId))
      return row?.waiting === true
    }

    it("la recepción completa en faena deja el ítem entregado, sin filas de stock ni de kárdex, y la OT deja de esperar el repuesto", async () => {
      const ot = await newWorkOrder()
      const { orderId, ocItemIds } = await seedOrder([{ quantity: 2, workOrderId: ot, productId: sparePartId }])
      expect(await waiting(ot)).toBe(true)

      const receiptId = await registerReceipt({
        purchaseOrderId: orderId, receivedBy: IDS.mecBio, stage: "faena", worksiteId: IDS.wsBio,
        items: [{ purchaseOrderItemId: ocItemIds[0]!, quantityReceived: 2 }],
      })
      await settle()

      expect(await itemStatus(ocItemIds[0]!)).toBe("delivered")
      expect(await stockRows(sparePartId)).toEqual([])
      expect(await movementRows(sparePartId)).toEqual([])
      // La recepción sí queda registrada: la línea de OC cuenta lo recibido.
      const [line] = await testDb.select().from(schema.purchaseOrderItems).where(eq(schema.purchaseOrderItems.id, ocItemIds[0]!))
      expect(line!.quantityReceived).toBe(2)
      const receiptLines = await testDb.select().from(schema.receiptItems).where(eq(schema.receiptItems.receiptId, receiptId))
      expect(receiptLines).toHaveLength(1)

      // La OT ya no «espera repuesto»: ni por la consulta SQL ni por la regla sobre las filas.
      expect(await waiting(ot)).toBe(false)
      const rows = await loadWorkOrderPartsRequests(ot)
      expect(rows.map((row) => row.itemStatus)).toEqual(["delivered"])
      expect(isWaitingParts("en_ejecucion", rows)).toBe(false)
      // El aviso a mantención sigue saliendo: es lo que le dice a la OT que el repuesto llegó.
      expect(notifyWorkOrderPartsReceived).toHaveBeenCalledWith({ workOrderId: ot, receiptId, actorUserId: IDS.mecBio, itemCount: 1 })
    })

    it("control: un producto físico común recibido en faena sí ingresa stock y kárdex y queda «recibido» para su entrega", async () => {
      const ot = await newWorkOrder()
      const { orderId, ocItemIds } = await seedOrder([{ quantity: 3, workOrderId: ot, productId: plainProductId }])

      await registerReceipt({
        purchaseOrderId: orderId, receivedBy: IDS.mecBio, stage: "faena", worksiteId: IDS.wsBio,
        items: [{ purchaseOrderItemId: ocItemIds[0]!, quantityReceived: 3 }],
      })

      expect(await itemStatus(ocItemIds[0]!)).toBe("received")
      expect(await stockRows(plainProductId)).toMatchObject([{ worksiteId: IDS.wsBio, quantity: 3 }])
      expect(await movementRows(plainProductId)).toMatchObject([{ type: "ingreso_oc", quantity: 3 }])
    })

    it("una recepción parcial deja el ítem en «recibido parcial» y la OT sigue esperando; el saldo lo entrega, todo sin stock", async () => {
      const ot = await newWorkOrder()
      const { orderId, ocItemIds } = await seedOrder([{ quantity: 4, workOrderId: ot, productId: sparePartId }])

      await registerReceipt({
        purchaseOrderId: orderId, receivedBy: IDS.mecBio, stage: "faena", worksiteId: IDS.wsBio,
        items: [{ purchaseOrderItemId: ocItemIds[0]!, quantityReceived: 1 }],
      })
      expect(await itemStatus(ocItemIds[0]!)).toBe("partially_received")
      expect(await waiting(ot)).toBe(true)

      await registerReceipt({
        purchaseOrderId: orderId, receivedBy: IDS.mecBio, stage: "faena", worksiteId: IDS.wsBio,
        items: [{ purchaseOrderItemId: ocItemIds[0]!, quantityReceived: 3 }],
      })
      expect(await itemStatus(ocItemIds[0]!)).toBe("delivered")
      expect(await waiting(ot)).toBe(false)
      expect(await stockRows(sparePartId)).toEqual([])
      expect(await movementRows(sparePartId)).toEqual([])
    })

    it("vía oficina: la llegada a oficina no ingresa stock ni prepara guía de despacho, y la recepción en faena lo deja entregado", async () => {
      await testDb.insert(schema.worksites).values({
        id: "ws-oficina-p", name: "Oficina CHOME", code: "OF-P", isActive: true, createdAt: now, updatedAt: now,
      }).onConflictDoNothing()
      const ot = await newWorkOrder()
      const { orderId, ocItemIds } = await seedOrder([{ quantity: 1, workOrderId: ot, productId: sparePartId }], "via_oficina")

      await registerReceipt({
        purchaseOrderId: orderId, receivedBy: IDS.mecBio, stage: "office",
        items: [{ purchaseOrderItemId: ocItemIds[0]!, quantityReceived: 1 }],
      })
      expect(await itemStatus(ocItemIds[0]!)).toBe("office_received")
      expect(await stockRows(sparePartId)).toEqual([])
      expect(await movementRows(sparePartId)).toEqual([])
      // Sin stock en la oficina no hay qué trasladar: una guía de despacho sería imposible de despachar.
      expect(await testDb.select().from(schema.dispatchGuides).where(eq(schema.dispatchGuides.purchaseOrderId, orderId))).toEqual([])

      await registerReceipt({
        purchaseOrderId: orderId, receivedBy: IDS.mecBio, stage: "faena", worksiteId: IDS.wsBio,
        items: [{ purchaseOrderItemId: ocItemIds[0]!, quantityReceived: 1 }],
      })
      expect(await itemStatus(ocItemIds[0]!)).toBe("delivered")
      expect(await stockRows(sparePartId)).toEqual([])
      expect(await movementRows(sparePartId)).toEqual([])
      expect(await waiting(ot)).toBe(false)
    })

    it("anular la recepción de oficina de un repuesto no busca stock que nunca ingresó", async () => {
      await testDb.insert(schema.worksites).values({
        id: "ws-oficina-p", name: "Oficina CHOME", code: "OF-P", isActive: true, createdAt: now, updatedAt: now,
      }).onConflictDoNothing()
      const ot = await newWorkOrder()
      const { orderId, ocItemIds } = await seedOrder([{ quantity: 2, workOrderId: ot, productId: sparePartId }], "via_oficina")
      const receiptId = await registerReceipt({
        purchaseOrderId: orderId, receivedBy: IDS.mecBio, stage: "office",
        items: [{ purchaseOrderItemId: ocItemIds[0]!, quantityReceived: 2 }],
      })

      // Sin la excepción del repuesto el reverso exigiría 2 unidades en la oficina y fallaría con «quedan 0».
      const result = await voidReceipt({ receiptId, reason: "Se registró contra la orden equivocada", voidedBy: IDS.jefe })

      expect(result.reversedMovements).toBe(0)
      const [line] = await testDb.select().from(schema.purchaseOrderItems).where(eq(schema.purchaseOrderItems.id, ocItemIds[0]!))
      expect(line!.quantityOfficeReceived).toBe(0)
      expect(await itemStatus(ocItemIds[0]!)).toBe("purchased")
      expect(await movementRows(sparePartId)).toEqual([])
    })
  })
})
