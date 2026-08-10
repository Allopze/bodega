import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import path from "node:path"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite is structurally compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

vi.mock("@/lib/auth/auth", () => ({ auth: vi.fn() }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import { buildTrazabilidadRows, getTrazabilidadXlsx } from "@/lib/services/trazabilidad-export"

describe("trazabilidad export scoping and filter tests", () => {
  beforeEach(async () => {
    // Truncate tables for test isolation
    await inMemoryDb.delete(schema.receiptItems)
    await inMemoryDb.delete(schema.receipts)
    await inMemoryDb.delete(schema.purchaseOrderItems)
    await inMemoryDb.delete(schema.purchaseOrders)
    await inMemoryDb.delete(schema.suppliers)
    await inMemoryDb.delete(schema.approvalDecisions)
    await inMemoryDb.delete(schema.purchaseRequestItems)
    await inMemoryDb.delete(schema.purchaseRequests)
    await inMemoryDb.delete(schema.products)
    await inMemoryDb.delete(schema.productCategories)
    await inMemoryDb.delete(schema.worksites)
    await inMemoryDb.delete(schema.users)

    await inMemoryDb.insert(schema.users).values({
      id: "u-1",
      name: "Usuario 1",
      email: "u1@chome.cl",
      hashedPassword: "x",
      isActive: true,
    })
  })

  afterAll(async () => {
    await pg.close()
  })

  it("returns only rows for worksites visible to a scoped session", async () => {
    const now = new Date().toISOString()
    const userId = "user-scoped"

    await inMemoryDb.insert(schema.users).values({
      id: userId,
      name: "Usuario Faena",
      email: "faena@chome.cl",
      hashedPassword: "hashed_password_placeholder",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })

    await inMemoryDb.insert(schema.worksites).values([
      {
        id: "ws-visible",
        name: "Faena Visible",
        code: "F-VISIBLE",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "ws-hidden",
        name: "Faena Oculta",
        code: "F-OCULTA",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ])

    await inMemoryDb.insert(schema.purchaseRequests).values([
      {
        id: "req-visible",
        code: "SOL-2026-VISIBLE",
        worksiteId: "ws-visible",
        requesterId: userId,
        status: "submitted",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "req-hidden",
        code: "SOL-2026-OCULTA",
        worksiteId: "ws-hidden",
        requesterId: userId,
        status: "submitted",
        createdAt: now,
        updatedAt: now,
      },
    ])

    await inMemoryDb.insert(schema.purchaseRequestItems).values([
      {
        id: "item-visible",
        requestId: "req-visible",
        productNameFree: "Guantes visibles",
        quantity: 3,
        unitOfMeasure: "par",
        status: "approved",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "item-hidden",
        requestId: "req-hidden",
        productNameFree: "Guantes ocultos",
        quantity: 7,
        unitOfMeasure: "par",
        status: "approved",
        createdAt: now,
        updatedAt: now,
      },
    ])

    const rows = await buildTrazabilidadRows(scopedSession(["ws-visible"]))

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      productName: "Guantes visibles",
      worksiteName: "Faena Visible",
      requestCode: "SOL-2026-VISIBLE",
      requested: 3,
    })
  })

  it("returns empty array for scoped session with no allowed worksites", async () => {
    const rows = await buildTrazabilidadRows(scopedSession([]))
    expect(rows).toEqual([])
  })

  it("returns empty array when no requests match criteria", async () => {
    const rows = await buildTrazabilidadRows(globalSession())
    expect(rows).toEqual([])
  })

  it("returns empty array when requests match but they have no items", async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.worksites).values({
      id: "ws-1",
      name: "Faena 1",
      code: "F-1",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: "req-1",
      code: "SOL-0001",
      worksiteId: "ws-1",
      requesterId: "u-1",
      status: "submitted",
      createdAt: now,
      updatedAt: now,
    })

    const rows = await buildTrazabilidadRows(globalSession())
    expect(rows).toEqual([])
  })

  it("builds correct query when filters (fromDate, toDate, worksiteId) are used", async () => {
    const now = "2026-06-20T12:00:00"
    await inMemoryDb.insert(schema.worksites).values({
      id: "ws-1",
      name: "Faena 1",
      code: "F-1",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequests).values([
      {
        id: "req-old",
        code: "SOL-0001",
        worksiteId: "ws-1",
        requesterId: "u-1",
        status: "submitted",
        createdAt: "2026-06-01T12:00:00.000Z",
        updatedAt: now,
      },
      {
        id: "req-new",
        code: "SOL-0002",
        worksiteId: "ws-1",
        requesterId: "u-1",
        status: "submitted",
        createdAt: "2026-06-15T12:00:00.000Z",
        updatedAt: now,
      },
    ])
    await inMemoryDb.insert(schema.purchaseRequestItems).values([
      {
        id: "item-old",
        requestId: "req-old",
        productNameFree: "Old Item",
        quantity: 1,
        unitOfMeasure: "un",
        status: "draft",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "item-new",
        requestId: "req-new",
        productNameFree: "New Item",
        quantity: 1,
        unitOfMeasure: "un",
        status: "draft",
        createdAt: now,
        updatedAt: now,
      },
    ])

    // Query filtering by date range
    const rows = await buildTrazabilidadRows(globalSession(), {
      fromDate: "2026-06-10",
      toDate: "2026-06-18",
      worksiteId: "ws-1",
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.productName).toBe("New Item")
  })

  it("handles full matrix with products, purchase orders, approval decisions and receipt items", async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.worksites).values({
      id: "ws-1",
      name: "Faena 1",
      code: "F-1",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.productCategories).values({
      id: "cat-1",
      name: "Calzado",
      slug: "calzado",
    })
    await inMemoryDb.insert(schema.products).values({
      id: "prod-1",
      name: "Bota de seguridad",
      sku: "BOTA-SEC-01",
      categoryId: "cat-1",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: "req-1",
      code: "SOL-0001",
      worksiteId: "ws-1",
      requesterId: "u-1",
      status: "submitted",
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: "item-1",
      requestId: "req-1",
      productId: "prod-1",
      quantity: 10,
      unitOfMeasure: "par",
      status: "approved",
      createdAt: now,
      updatedAt: now,
    })

    // Seed approval decisions (modify quantity to 8)
    await inMemoryDb.insert(schema.approvalDecisions).values({
      id: "dec-1",
      requestItemId: "item-1",
      requestId: "req-1",
      type: "modify",
      decidedBy: "u-1",
      modifiedQty: 8,
      decidedAt: now,
    })

    // Seed supplier
    await inMemoryDb.insert(schema.suppliers).values({
      id: "sup-1",
      name: "Proveedor 1",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })

    // Seed purchase order first!
    await inMemoryDb.insert(schema.purchaseOrders).values({
      id: "po-1",
      code: "OC-2026-0001",
      worksiteId: "ws-1",
      supplierId: "sup-1",
      createdBy: "u-1",
      status: "sent",
      createdAt: now,
      updatedAt: now,
    })

    // Seed purchase order items
    await inMemoryDb.insert(schema.purchaseOrderItems).values({
      id: "poi-1",
      purchaseOrderId: "po-1",
      requestItemId: "item-1",
      productId: "prod-1",
      quantity: 6,
      unitOfMeasure: "par",
      unitPrice: 15000,
      subtotal: 90000,
    })

    // Seed receipts at faena
    await inMemoryDb.insert(schema.receipts).values({
      id: "rec-1",
      code: "REC-0001",
      purchaseOrderId: "po-1",
      receivedBy: "u-1",
      locationType: "faena",
      receivedAt: now,
      createdAt: now,
    })

    // Seed receipt items (received 5 items)
    await inMemoryDb.insert(schema.receiptItems).values({
      id: "reci-1",
      receiptId: "rec-1",
      purchaseOrderItemId: "poi-1",
      quantityReceived: 5,
    })

    const rows = await buildTrazabilidadRows(globalSession())

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      productName: "Bota de seguridad",
      productSku: "BOTA-SEC-01",
      requested: 10,
      approved: 8,
      inOc: 6,
      received: 5,
      alert: true,
    })
    expect(rows[0]?.alert).toBe(true)
  })

  it("excludes cancelled purchase order items from inOc totals", async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.worksites).values({
      id: "ws-1",
      name: "Faena 1",
      code: "F-1",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.suppliers).values({
      id: "sup-1",
      name: "Proveedor 1",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: "req-1",
      code: "SOL-0001",
      worksiteId: "ws-1",
      requesterId: "u-1",
      status: "approved",
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: "item-1",
      requestId: "req-1",
      productNameFree: "Guantes",
      quantity: 10,
      unitOfMeasure: "par",
      status: "pending_purchase",
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseOrders).values([
      {
        id: "po-cancelled",
        code: "OC-CANCELLED",
        worksiteId: "ws-1",
        supplierId: "sup-1",
        createdBy: "u-1",
        status: "cancelled",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "po-active",
        code: "OC-ACTIVE",
        worksiteId: "ws-1",
        supplierId: "sup-1",
        createdBy: "u-1",
        status: "sent",
        createdAt: now,
        updatedAt: now,
      },
    ])
    await inMemoryDb.insert(schema.purchaseOrderItems).values([
      {
        id: "poi-cancelled",
        purchaseOrderId: "po-cancelled",
        requestItemId: "item-1",
        quantity: 10,
        unitOfMeasure: "par",
        unitPrice: 1000,
        subtotal: 10000,
        status: "cancelled",
      },
      {
        id: "poi-active",
        purchaseOrderId: "po-active",
        requestItemId: "item-1",
        quantity: 10,
        unitOfMeasure: "par",
        unitPrice: 1000,
        subtotal: 10000,
      },
    ])

    const rows = await buildTrazabilidadRows(globalSession())

    expect(rows).toHaveLength(1)
    expect(rows[0]?.inOc).toBe(10)
  })

  it("getTrazabilidadXlsx constructs excel workbook buffer and truncates rows if requested", async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.worksites).values({
      id: "ws-1",
      name: "Faena 1",
      code: "F-1",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequests).values([
      { id: "req-1", code: "SOL-0001", worksiteId: "ws-1", requesterId: "u-1", status: "submitted", createdAt: now, updatedAt: now },
      { id: "req-2", code: "SOL-0002", worksiteId: "ws-1", requesterId: "u-1", status: "submitted", createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.purchaseRequestItems).values([
      { id: "item-1", requestId: "req-1", productNameFree: "Item 1", quantity: 5, unitOfMeasure: "un", status: "approved", createdAt: now, updatedAt: now },
      { id: "item-2", requestId: "req-2", productNameFree: "Item 2", quantity: 5, unitOfMeasure: "un", status: "approved", createdAt: now, updatedAt: now },
    ])

    const res = await getTrazabilidadXlsx(globalSession(), {}, 1)

    expect(res.truncated).toBe(true)
    expect(res.filename).toContain("trazabilidad-")
    expect(res.buffer).toBeInstanceOf(ArrayBuffer)
  })
})

function scopedSession(worksiteIds: string[]): Parameters<typeof buildTrazabilidadRows>[0] {
  return {
    expires: new Date(Date.now() + 60_000).toISOString(),
    user: {
      id: "user-scoped",
      name: "Usuario Faena",
      email: "faena@chome.cl",
      roles: ["solicitante_faena"],
      permissions: ["reports:view"],
      worksiteIds,
      primaryWorksiteId: worksiteIds[0] ?? null,
      avatarColor: null,
      isActive: true,
    },
  }
}

function globalSession(): Parameters<typeof buildTrazabilidadRows>[0] {
  return {
    expires: new Date(Date.now() + 60_000).toISOString(),
    user: {
      id: "user-global",
      name: "Usuario Global",
      email: "global@chome.cl",
      roles: ["administrador"],
      permissions: ["reports:view"],
      worksiteIds: [],
      primaryWorksiteId: null,
      avatarColor: null,
      isActive: true,
    },
  }
}
