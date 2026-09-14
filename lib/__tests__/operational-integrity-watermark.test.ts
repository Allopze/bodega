import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import type { DB } from "@/db"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const db = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = db
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

const { scanOperationalIntegrity, scanOperationalIntegrityAsSystem, listOperationalIntegrityCases, verifyOperationalIntegrityCase } = await import("@/lib/services/operational-integrity")
const { integrityScanWatermarkKey, INTEGRITY_SCAN_OVERLAP_MS } = await import("@/lib/services/operational-integrity/scan-watermark")

const permissions = ["warehouse:view_traceability", "warehouse:reconcile_integrity", "purchasing:view"]
function session(worksiteId: string): Session {
  return { expires: "2099-01-01", user: { id: "wm-user", email: "wm@test.local", roles: [], isGlobal: false, isActive: true, worksiteIds: [worksiteId], primaryWorksiteId: worksiteId, avatarColor: null, permissions } } as unknown as Session
}
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
/** Más viejo que la ventana: el escaneo incremental no debe volver a mirarlo. */
const ANTIGUO = daysAgo(30)

/**
 * TRZ-003 (auditoría 2026-09-14): el escaneo de integridad crecía con el
 * histórico completo. `scanStock` leía todas las filas de `worksite_stock` y
 * todos los `inventory_movements` del alcance, y `scanPurchasing` recorría todas
 * las OC no anuladas recalculando la conciliación de cada una: el costo era
 * proporcional a toda la historia operacional y no a lo ocurrido desde el último
 * escaneo, con la transacción `repeatable read` sosteniendo su snapshot cada vez
 * más tiempo.
 *
 * Estas pruebas fijan el recorte por marca de agua y —sobre todo— sus dos
 * límites: la verificación de un caso y el escaneo manual siguen mirándolo todo.
 */
describe("marca de agua del escaneo de integridad (TRZ-003)", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await db.insert(schema.worksites).values({ id: "wm-faena", code: "WM-1", name: "QA marca de agua" })
    await db.insert(schema.users).values({ id: "wm-user", name: "QA", email: "wm@test.local", hashedPassword: "hash" })
    await db.insert(schema.productCategories).values({ id: "wm-cat", name: "QA", slug: "qa-watermark" })
    await db.insert(schema.products).values([
      { id: "wm-viejo", sku: "WM-OLD", name: "Producto antiguo", categoryId: "wm-cat", unitOfMeasure: "unidad" },
      { id: "wm-nuevo", sku: "WM-NEW", name: "Producto reciente", categoryId: "wm-cat", unitOfMeasure: "unidad" },
    ])
    await db.insert(schema.suppliers).values({ id: "wm-supplier", name: "QA proveedor" })
    // Descuadre antiguo: el saldo dice 9 y el kardex terminó en 10, hace un mes.
    await db.insert(schema.worksiteStock).values({ id: "wm-stock-viejo", worksiteId: "wm-faena", productId: "wm-viejo", quantity: 9, updatedAt: ANTIGUO })
    await db.insert(schema.inventoryMovements).values({ id: "wm-mov-viejo", worksiteId: "wm-faena", productId: "wm-viejo", type: "ingreso_oc", quantity: 10, stockBefore: 0, stockAfter: 10, performedBy: "wm-user", performedAt: ANTIGUO })
  })
  afterAll(async () => { await pg.close() })

  it("la primera corrida automática no tiene marca y mira todo el histórico", async () => {
    const primera = await scanOperationalIntegrityAsSystem(["stock"])
    expect(primera.found).toBeGreaterThan(0)
    expect(primera.recorded).toBeGreaterThan(0)
  })

  it("deja la marca del dominio con el instante en que empezó", async () => {
    const [row] = await db.select().from(schema.systemSettings).where(eq(schema.systemSettings.key, integrityScanWatermarkKey("stock")))
    expect(row, "la corrida automática no dejó marca de agua").toBeDefined()
    expect(new Date(row!.value).getTime()).toBeLessThanOrEqual(Date.now())
    expect(new Date(row!.value).getTime()).toBeGreaterThan(Date.now() - 60_000)
  })

  /**
   * El corazón del hallazgo: la segunda corrida ya no vuelve a recorrer un mes
   * de kardex. Antes leía exactamente las mismas filas que la primera.
   */
  it("la segunda corrida no vuelve a procesar lo que no se movió", async () => {
    expect(await scanOperationalIntegrityAsSystem(["stock"])).toEqual({ found: 0, recorded: 0 })
  })

  /** Un escaneo manual es acotado y no comparte la marca: sigue mirando todo. */
  it("el escaneo manual de una faena sigue viendo el histórico completo", async () => {
    const manual = await scanOperationalIntegrity(session("wm-faena"), ["stock"])
    expect(manual.found).toBeGreaterThan(0)
  })

  /**
   * Riesgo del recorte: cerrar un caso porque su producto no se movió sería
   * resolverlo sin evidencia. La verificación escanea sin ventana.
   */
  it("verificar un caso antiguo no lo cierra: la verificación no usa la ventana", async () => {
    const [caso] = await listOperationalIntegrityCases(session("wm-faena"), {})
    expect(caso).toBeDefined()
    expect(await verifyOperationalIntegrityCase(session("wm-faena"), caso!.id)).toEqual({ resolved: false })
  })

  it("un movimiento dentro de la ventana sí entra en la corrida siguiente", async () => {
    await db.insert(schema.worksiteStock).values({ id: "wm-stock-nuevo", worksiteId: "wm-faena", productId: "wm-nuevo", quantity: 4 })
    await db.insert(schema.inventoryMovements).values({ id: "wm-mov-nuevo", worksiteId: "wm-faena", productId: "wm-nuevo", type: "ingreso_oc", quantity: 5, stockBefore: 0, stockAfter: 5, performedBy: "wm-user" })

    const corrida = await scanOperationalIntegrityAsSystem(["stock"])
    expect(corrida.found).toBeGreaterThan(0)
    const nuevos = await listOperationalIntegrityCases(session("wm-faena"), {})
    expect(nuevos.some((row) => row.entityId === "wm-nuevo")).toBe(true)
  })

  it("el margen sobre la marca es de una semana, no de la corrida a secas", () => {
    expect(INTEGRITY_SCAN_OVERLAP_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })

  /**
   * El N+1 más caro del escaneo: por cada OC no anulada se leían sus líneas de
   * factura, sus asignaciones línea por línea y se recalculaba la conciliación.
   */
  it("una OC intacta queda fuera de la corrida automática siguiente", async () => {
    await db.insert(schema.purchaseOrders).values({ id: "wm-po", code: "WM-PO", worksiteId: "wm-faena", supplierId: "wm-supplier", createdBy: "wm-user", status: "sent", createdAt: ANTIGUO, updatedAt: ANTIGUO })
    await db.insert(schema.purchaseOrderItems).values({ id: "wm-po-line", purchaseOrderId: "wm-po", productId: "wm-viejo", quantity: 10, unitOfMeasure: "unidad" })
    await db.insert(schema.purchaseOrderInvoices).values({ id: "wm-invoice", purchaseOrderId: "wm-po", invoiceNumber: "WM-1", amount: 100, fileName: "f.pdf", filePath: "/tmp/f.pdf", uploadedBy: "wm-user", uploadedAt: ANTIGUO })
    await db.insert(schema.purchaseOrderInvoiceItems).values({ id: "wm-invoice-line", invoiceId: "wm-invoice", productName: "QA", quantity: 10, subtotal: 100, unitPrice: 10, unitOfMeasure: "unidad" })
    // Reparte más de lo facturado: descuadre real, detectable, pero antiguo.
    await db.insert(schema.purchaseOrderInvoiceItemAllocations).values({ id: "wm-allocation", invoiceItemId: "wm-invoice-line", purchaseOrderItemId: "wm-po-line", quantity: 11, subtotal: 100, source: "operator" })

    const primera = await scanOperationalIntegrityAsSystem(["purchasing"])
    expect(primera.found, "la primera corrida de compras no tiene marca y debe ver la OC").toBeGreaterThan(0)

    expect(await scanOperationalIntegrityAsSystem(["purchasing"])).toEqual({ found: 0, recorded: 0 })
  })

  it("tocar la OC la devuelve a la ventana", async () => {
    await db.update(schema.purchaseOrders).set({ updatedAt: new Date().toISOString() }).where(eq(schema.purchaseOrders.id, "wm-po"))

    expect((await scanOperationalIntegrityAsSystem(["purchasing"])).found).toBeGreaterThan(0)
  })
})
