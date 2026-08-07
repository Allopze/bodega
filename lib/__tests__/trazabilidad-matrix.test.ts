import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import path from "node:path"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error - PGlite is structurally compatible at runtime.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

vi.mock("@/lib/auth/auth", () => ({ auth: vi.fn() }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import { getTrazabilidadMatrix } from "@/lib/services/trazabilidad-matrix"

describe("getTrazabilidadMatrix", () => {
  beforeEach(async () => {
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
        status: "issued",
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
        status: "cancelled",
      },
      {
        id: "poi-active",
        purchaseOrderId: "po-active",
        requestItemId: "item-1",
        quantity: 10,
        unitOfMeasure: "par",
        unitPrice: 1000,
      },
    ])

    const result = await getTrazabilidadMatrix({}, globalSession())

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.inOc).toBe(10)
  })

  // El banner de /trazabilidad y el desplegable de faena se presentan como
  // totales, así que no pueden salir de `rows`, que es una sola página de 50.
  it("cuenta las alertas de todo el universo y ofrece las faenas del alcance, no las de la página", async () => {
    const base = Date.parse("2026-01-01T00:00:00.000Z")
    const at = (minutes: number) => new Date(base + minutes * 60_000).toISOString()

    await inMemoryDb.insert(schema.worksites).values([
      { id: "ws-1", name: "Faena 1", code: "F-1", isActive: true, createdAt: at(0), updatedAt: at(0) },
      { id: "ws-2", name: "Faena 2", code: "F-2", isActive: true, createdAt: at(0), updatedAt: at(0) },
    ])
    await inMemoryDb.insert(schema.purchaseRequests).values([
      { id: "req-1", code: "SOL-0001", worksiteId: "ws-1", requesterId: "u-1", status: "approved", createdAt: at(0), updatedAt: at(0) },
      { id: "req-2", code: "SOL-0002", worksiteId: "ws-2", requesterId: "u-1", status: "approved", createdAt: at(0), updatedAt: at(0) },
    ])
    await inMemoryDb.insert(schema.purchaseRequestItems).values([
      // Dos aprobados sin OC (alerta) y viejos: caen fuera de las 50 filas más recientes.
      { id: "old-ws1", requestId: "req-1", productNameFree: "Guantes", quantity: 5, unitOfMeasure: "par", status: "approved", createdAt: at(1), updatedAt: at(1) },
      { id: "old-ws2", requestId: "req-2", productNameFree: "Casco", quantity: 5, unitOfMeasure: "unidad", status: "approved", createdAt: at(2), updatedAt: at(2) },
      // 50 ítems más nuevos, sin aprobar: llenan la página y no generan alerta.
      ...Array.from({ length: 50 }, (_, i) => ({
        id: `new-${i}`,
        requestId: "req-1",
        productNameFree: `Item ${i}`,
        quantity: 1,
        unitOfMeasure: "unidad",
        status: "requested",
        createdAt: at(100 + i),
        updatedAt: at(100 + i),
      })),
    ])

    const result = await getTrazabilidadMatrix({}, globalSession())

    expect(result.rows).toHaveLength(50)
    expect(result.rows.some((r) => r.alert)).toBe(false)
    expect(result.alertCount).toBe(2)
    expect(result.visibleWorksites.map((w) => w.id)).toEqual(["ws-1", "ws-2"])
  })
})

function globalSession(): Parameters<typeof getTrazabilidadMatrix>[1] {
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
