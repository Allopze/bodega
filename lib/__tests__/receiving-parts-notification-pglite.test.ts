/**
 * Aviso a mantención al recibir repuestos de una OT (2026-11-07).
 *
 * Regla: sólo cuando una línea que pidió una OT llega COMPLETA a faena, y una
 * vez por OT y recepción, después del commit. Una recepción parcial, la
 * llegada a oficina y las líneas sin OT no avisan a mantención.
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import path from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof testDb }
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
  lines: Array<{ quantity: number; workOrderId: string | null }>,
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
      ...(line.workOrderId ? { vehicleId: IDS.truckBio, workOrderId: line.workOrderId } : {}),
    })
    const ocItemId = `ocitem-p${n}-${index}`
    ocItemIds.push(ocItemId)
    await testDb.insert(schema.purchaseOrderItems).values({
      id: ocItemId, purchaseOrderId: orderId, requestItemId: itemId, productId: null,
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
})
