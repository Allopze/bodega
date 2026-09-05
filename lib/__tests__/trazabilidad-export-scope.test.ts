import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import ExcelJS from "exceljs"
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
import type { Session } from "next-auth"

/**
 * El export corre sobre el mismo pipeline consolidado que la pantalla, así que
 * estas pruebas cubren las dos superficies: alcance de faena, filtros, y que
 * las cantidades del archivo sean las que se ven en la tabla.
 */
describe("trazabilidad export scoping and filter tests", () => {
  beforeEach(async () => {
    // Truncate tables for test isolation
    await inMemoryDb.delete(schema.deliveryItems)
    await inMemoryDb.delete(schema.deliveries)
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

    const { rows } = await buildTrazabilidadRows(scopedSession(["ws-visible"]))

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      productName: "Guantes visibles",
      worksiteName: "Faena Visible",
      requestCode: "SOL-2026-VISIBLE",
      requested: 3,
      requesterName: "Usuario Faena",
      uom: "par",
    })
  })

  it("una faena fuera del alcance no devuelve sus filas ni pidiéndola por id", async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.worksites).values({
      id: "ws-hidden", name: "Faena Oculta", code: "F-OCULTA", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: "req-hidden", code: "SOL-OCULTA", worksiteId: "ws-hidden", requesterId: "u-1",
      status: "submitted", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: "item-hidden", requestId: "req-hidden", productNameFree: "Guantes", quantity: 1,
      unitOfMeasure: "par", status: "approved", createdAt: now, updatedAt: now,
    })

    const { rows } = await buildTrazabilidadRows(scopedSession(["ws-otra"]), { worksiteId: "ws-hidden" })

    expect(rows).toEqual([])
  })

  it("returns empty array for scoped session with no allowed worksites", async () => {
    const { rows } = await buildTrazabilidadRows(scopedSession([]))
    expect(rows).toEqual([])
  })

  it("returns empty array when no requests match criteria", async () => {
    const { rows } = await buildTrazabilidadRows(globalSession())
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

    const { rows } = await buildTrazabilidadRows(globalSession())
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
    const { rows } = await buildTrazabilidadRows(globalSession(), {
      fromDate: "2026-06-10",
      toDate: "2026-06-18",
      worksiteId: "ws-1",
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.productName).toBe("New Item")
  })

  it("una fecha inválida se ignora en vez de reventar la consulta", async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.worksites).values({
      id: "ws-1", name: "Faena 1", code: "F-1", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: "req-1", code: "SOL-0001", worksiteId: "ws-1", requesterId: "u-1",
      status: "submitted", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: "item-1", requestId: "req-1", productNameFree: "Guantes", quantity: 2,
      unitOfMeasure: "par", status: "approved", createdAt: now, updatedAt: now,
    })

    // `?desde=ayer` se interpolaba como literal de timestamp y Postgres
    // abortaba la consulta: la pantalla entera respondía 500.
    const { rows } = await buildTrazabilidadRows(globalSession(), {
      fromDate: "ayer",
      toDate: "2026-13-45",
    })

    expect(rows).toHaveLength(1)
  })

  // TR-05 (auditoría 2026-09-05): los filtros de fecha consultaban días UTC
  // mientras la interfaz muestra días chilenos. Una solicitud de las 22:00 de
  // Chile (02:00 UTC del día siguiente en septiembre, -03) quedaba fuera del
  // día que el usuario seleccionaba. El 04-09 el día civil chileno abarca
  // [2026-09-04T03:00Z, 2026-09-05T03:00Z): la solicitud de las 01:00Z del
  // 05-09 pertenece al 04-09 en Chile y debe aparecer en el filtro.
  it("incluye una solicitud de la noche chilena dentro del día seleccionado (TR-05)", async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.worksites).values({
      id: "ws-1", name: "Faena 1", code: "F-1", isActive: true, createdAt: now, updatedAt: now,
    })
    // 22:00 Chile en septiembre (-03) = 01:00 UTC del 05-09.
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: "req-chile-night", code: "SOL-2026-NOCHE", worksiteId: "ws-1", requesterId: "u-1",
      status: "submitted",
      createdAt: "2026-09-05T01:00:00.000Z",
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: "item-chile-night", requestId: "req-chile-night", productNameFree: "Casco nocturno",
      quantity: 1, unitOfMeasure: "unidad", status: "approved", createdAt: now, updatedAt: now,
    })

    const { rows } = await buildTrazabilidadRows(globalSession(), {
      fromDate: "2026-09-04",
      toDate: "2026-09-04",
      worksiteId: "ws-1",
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.productName).toBe("Casco nocturno")
  })

  it("handles full matrix with products, purchase orders, approval decisions and receipts", async () => {
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

    await inMemoryDb.insert(schema.suppliers).values({
      id: "sup-1",
      name: "Proveedor 1",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })

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

    // `quantityReceived` es el contador canónico de lo recibido en faena
    // (ARQ-12 en el esquema de purchase_order_items): la vista y el export
    // leen de ahí, no de la suma de líneas de recepción.
    await inMemoryDb.insert(schema.purchaseOrderItems).values({
      id: "poi-1",
      purchaseOrderId: "po-1",
      requestItemId: "item-1",
      productId: "prod-1",
      quantity: 6,
      unitOfMeasure: "par",
      unitPrice: 15000,
      subtotal: 90000,
      quantityReceived: 5,
    })

    await inMemoryDb.insert(schema.receipts).values({
      id: "rec-1",
      code: "REC-0001",
      purchaseOrderId: "po-1",
      receivedBy: "u-1",
      locationType: "faena",
      receivedAt: now,
      createdAt: now,
    })

    await inMemoryDb.insert(schema.receiptItems).values({
      id: "reci-1",
      receiptId: "rec-1",
      purchaseOrderItemId: "poi-1",
      quantityReceived: 5,
    })

    const { rows } = await buildTrazabilidadRows(globalSession())

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      productName: "Bota de seguridad",
      productSku: "BOTA-SEC-01",
      categoryName: "Calzado",
      suppliers: "Proveedor 1",
      ocCodes: "OC-2026-0001",
      requested: 10,
      approved: 8,
      inOc: 6,
      receivedFaena: 5,
      delivered: 0,
      // El pendiente se mide contra lo aprobado (8), no contra lo pedido (10).
      pendingTotal: 8,
      notYetOrdered: 2,
      alert: true,
    })
    // La columna dice "Estado Consolidado": tiene que traer la etiqueta que se
    // ve en la tabla, no el `status` crudo del ítem.
    expect(rows[0]?.status).toBe("Parcial en faena")
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

    const { rows } = await buildTrazabilidadRows(globalSession())

    expect(rows).toHaveLength(1)
    expect(rows[0]?.inOc).toBe(10)
    expect(rows[0]?.ocCodes).toBe("OC-ACTIVE")
  })

  it("una entrega anulada no cuenta como entregada", async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.worksites).values({
      id: "ws-1", name: "Faena 1", code: "F-1", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: "req-1", code: "SOL-0001", worksiteId: "ws-1", requesterId: "u-1",
      status: "approved", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: "item-1", requestId: "req-1", productNameFree: "Guantes", quantity: 10,
      unitOfMeasure: "par", status: "approved", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.deliveries).values([
      {
        id: "del-ok", code: "ENT-0001", deliveredBy: "u-1", deliveredAt: now,
        destinationType: "faena", worksiteId: "ws-1", createdAt: now,
      },
      {
        id: "del-void", code: "ENT-0002", deliveredBy: "u-1", deliveredAt: now,
        destinationType: "faena", worksiteId: "ws-1", createdAt: now,
        voidedAt: now, voidedBy: "u-1", voidReason: "Se anuló por error de digitación",
      },
    ])
    await inMemoryDb.insert(schema.deliveryItems).values([
      { id: "di-ok", deliveryId: "del-ok", requestItemId: "item-1", quantity: 4, unitOfMeasure: "par" },
      { id: "di-void", deliveryId: "del-void", requestItemId: "item-1", quantity: 6, unitOfMeasure: "par" },
    ])

    const { rows } = await buildTrazabilidadRows(globalSession())

    expect(rows).toHaveLength(1)
    // Con la anulada contada, `delivered` daba 10 y el ítem salía "Entregado"
    // con 6 pares todavía en la faena.
    expect(rows[0]?.delivered).toBe(4)
    expect(rows[0]?.pendingTotal).toBe(6)
    expect(rows[0]?.status).toBe("Parcialmente entregado")
  })

  it("el export respeta los filtros de la pantalla", async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.worksites).values({
      id: "ws-1", name: "Faena 1", code: "F-1", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: "req-1", code: "SOL-0001", worksiteId: "ws-1", requesterId: "u-1",
      status: "submitted", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values([
      {
        id: "item-guantes", requestId: "req-1", productNameFree: "Guantes de cabritilla",
        quantity: 5, unitOfMeasure: "par", status: "requested", createdAt: now, updatedAt: now,
      },
      {
        id: "item-casco", requestId: "req-1", productNameFree: "Casco dieléctrico",
        quantity: 2, unitOfMeasure: "unidad", status: "requested", createdAt: now, updatedAt: now,
      },
    ])

    // Antes sólo viajaban faena y fechas: el archivo traía las dos filas
    // aunque la tabla mostrara una.
    const { rows } = await buildTrazabilidadRows(globalSession(), { q: "casco" })

    expect(rows.map((r) => r.productName)).toEqual(["Casco dieléctrico"])
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

  // TR-B1 (auditoría 2026-09-05): la hoja "Órdenes de compra" se construía con
  // `request.orders`, cuya proyección por solicitud truncaba los `requestIds`
  // de una OC compartida. Si dos solicitudes comparten la misma OC, la hoja
  // debe listar UNA OC con AMBAS solicitudes vinculadas, sin importar el orden
  // de recorrido de las faenas.
  it("deduplica una OC compartida conservando todas sus solicitudes en el Excel (TR-B1)", async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.worksites).values({
      id: "ws-1", name: "Faena 1", code: "F-1", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.productCategories).values({
      id: "cat-1", name: "Calzado", slug: "calzado",
    })
    await inMemoryDb.insert(schema.products).values({
      id: "prod-1", name: "Bota compartida", sku: "BOTA-COMP", categoryId: "cat-1",
      isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.suppliers).values({
      id: "sup-1", name: "Proveedor Uno", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequests).values([
      { id: "req-a", code: "SOL-0001", worksiteId: "ws-1", requesterId: "u-1", status: "submitted", createdAt: now, updatedAt: now },
      { id: "req-b", code: "SOL-0002", worksiteId: "ws-1", requesterId: "u-1", status: "submitted", createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.purchaseRequestItems).values([
      { id: "item-a1", requestId: "req-a", productId: "prod-1", quantity: 2, unitOfMeasure: "unidad", status: "approved", createdAt: now, updatedAt: now },
      { id: "item-b1", requestId: "req-b", productId: "prod-1", quantity: 3, unitOfMeasure: "unidad", status: "approved", createdAt: now, updatedAt: now },
    ])
    // La misma OC mezcla líneas de ambas solicitudes (compartida).
    await inMemoryDb.insert(schema.purchaseOrders).values({
      id: "po-shared", code: "OC-2026-SHARED", worksiteId: "ws-1", supplierId: "sup-1",
      createdBy: "u-1", status: "sent", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseOrderItems).values([
      { id: "poi-a1", purchaseOrderId: "po-shared", requestItemId: "item-a1", productId: "prod-1", quantity: 2, unitOfMeasure: "unidad", unitPrice: 100, subtotal: 200 },
      { id: "poi-b1", purchaseOrderId: "po-shared", requestItemId: "item-b1", productId: "prod-1", quantity: 3, unitOfMeasure: "unidad", unitPrice: 100, subtotal: 300 },
    ])

    const res = await getTrazabilidadXlsx(globalSession(), { worksiteId: "ws-1" })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(res.buffer) as never)

    const ordersSheet = workbook.getWorksheet("Órdenes de compra")
    expect(ordersSheet).toBeDefined()
    // Encabezado + una fila: la OC compartida aparece una sola vez.
    expect(ordersSheet?.rowCount).toBe(2)
    expect(ordersSheet?.getCell("A2").value).toBe("OC-2026-SHARED")
    // "Solicitudes vinculadas" conserva TODAS las solicitudes que la integran
    // (por id; es el contrato del DTO `ConsolidatedOrder.requestIds`). Antes
    // sólo aparecía la de la última faena recorrida.
    const linked = String(ordersSheet?.getCell("D2").value ?? "")
    expect(linked).toContain("req-a")
    expect(linked).toContain("req-b")
  })
})

function scopedSession(worksiteIds: string[]): Session {
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

function globalSession(): Session {
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
