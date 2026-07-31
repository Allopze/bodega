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

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import { registerReceipt } from "@/lib/services/receiving"

const USER_ID = "u-test"
const WS_ID   = "ws-test"
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
