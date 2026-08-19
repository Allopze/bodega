/**
 * Integration tests for lib/services/stock.ts — applyMovement.
 *
 * Tests the atomic inventory movement system: ingress, egress, egress_desecho,
 * insufficient stock, inactive worksite, and audit trail.
 */

import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, vi, afterAll, beforeAll } from "vitest"
import path from "node:path"
import { eq, and } from "drizzle-orm"
import * as schema from "@/db/schema"
import type { DB } from "@/db"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

// Defense-in-depth: ensure NextAuth runtime is never loaded in this pure-service test
vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
}))

const migrationsFolder = path.resolve(process.cwd(), "db/migrations")

import { applyMovement, registerStockAdjustment, registerStockDiscard, registerStockReturn } from "@/lib/services/stock"

const now = new Date().toISOString()
const userId = "u-stock"

describe("Stock service — applyMovement", () => {
  beforeAll(async () => {
    await migratePGlite(pg, migrationsFolder)

    await inMemoryDb.insert(schema.users).values({
      id: userId, name: "Bodeguero", email: "bodega@chome.cl",
      hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.worksites).values({
      id: "ws-stock", name: "Faena Stock", code: "F-STOCK",
      isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.worksites).values({
      id: "ws-inactive", name: "Faena Inactiva", code: "F-INACT",
      isActive: false, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.productCategories).values({
      id: "cat-stock", name: "Cat Stock", slug: "cat-stock", sortOrder: 1,
    })
    await inMemoryDb.insert(schema.products).values({
      id: "prod-stock", sku: "S-001", name: "Producto Stock",
      categoryId: "cat-stock", unitOfMeasure: "unidad", isActive: true,
      createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.products).values({
      id: "prod-stock-2", sku: "S-002", name: "Producto Stock 2",
      categoryId: "cat-stock", unitOfMeasure: "unidad", isActive: true,
      createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.products).values({
      id: "prod-stock-3", sku: "S-003", name: "Producto Stock 3",
      categoryId: "cat-stock", unitOfMeasure: "unidad", isActive: true,
      createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.products).values({
      id: "prod-stock-return", sku: "S-004", name: "Producto devolución",
      categoryId: "cat-stock", unitOfMeasure: "unidad", isActive: true,
      createdAt: now, updatedAt: now,
    })
  })

  afterAll(async () => { await pg.close() })

  // ── Ingress ────────────────────────────────────────────────────────────

  describe("ingress (ingreso_oc)", () => {
    it("creates stock from zero on first ingress", async () => {
      const newQty = await applyMovement({
        worksiteId: "ws-stock",
        productId: "prod-stock",
        type: "ingreso_oc",
        quantity: 10,
        referenceType: "purchase_order",
        referenceId: "oc-test-1",
        performedBy: userId,
      })

      expect(newQty).toBe(10)

      const stock = await inMemoryDb.query.worksiteStock.findFirst({
        where: and(
          eq(schema.worksiteStock.worksiteId, "ws-stock"),
          eq(schema.worksiteStock.productId, "prod-stock"),
        ),
      })
      expect(stock?.quantity).toBe(10)
    })

    it("increments existing stock on subsequent ingress", async () => {
      const newQty = await applyMovement({
        worksiteId: "ws-stock",
        productId: "prod-stock",
        type: "ingreso_oc",
        quantity: 5,
        referenceType: "purchase_order",
        referenceId: "oc-test-2",
        performedBy: userId,
      })

      expect(newQty).toBe(15)

      const stock = await inMemoryDb.query.worksiteStock.findFirst({
        where: and(
          eq(schema.worksiteStock.worksiteId, "ws-stock"),
          eq(schema.worksiteStock.productId, "prod-stock"),
        ),
      })
      expect(stock?.quantity).toBe(15)
    })
  })

  // ── Egress ─────────────────────────────────────────────────────────────

  describe("egress (egreso_entrega)", () => {
    it("decrements stock correctly", async () => {
      const newQty = await applyMovement({
        worksiteId: "ws-stock",
        productId: "prod-stock",
        type: "egreso_entrega",
        quantity: -3,
        referenceType: "delivery",
        referenceId: "del-test-1",
        performedBy: userId,
      })

      expect(newQty).toBe(12)

      const stock = await inMemoryDb.query.worksiteStock.findFirst({
        where: and(
          eq(schema.worksiteStock.worksiteId, "ws-stock"),
          eq(schema.worksiteStock.productId, "prod-stock"),
        ),
      })
      expect(stock?.quantity).toBe(12)
    })

    it("throws when egress would drive stock negative", async () => {
      await expect(
        applyMovement({
          worksiteId: "ws-stock",
          productId: "prod-stock",
          type: "egreso_entrega",
          quantity: -100,
          performedBy: userId,
        })
      ).rejects.toThrow("Stock insuficiente")
    })
  })

  describe("delivery-linked returns", () => {
    it("links the return to one delivery item and caps it atomically at that item balance", async () => {
      await inMemoryDb.insert(schema.deliveries).values({
        id: "del-return-source",
        code: "ENT-RET-0001",
        deliveredBy: userId,
        deliveredAt: now,
        destinationType: "faena",
        worksiteId: "ws-stock",
        receiverName: "Encargado de faena",
        createdAt: now,
      })
      await inMemoryDb.insert(schema.deliveryItems).values({
        id: "del-item-return-source",
        deliveryId: "del-return-source",
        productId: "prod-stock-return",
        quantity: 5,
        unitOfMeasure: "unidad",
      })

      const result = await registerStockReturn({
        deliveryItemId: "del-item-return-source",
        quantity: 3,
        performedBy: userId,
        reason: "Sobrante sin utilizar",
      }, ["ws-stock"])

      const stockReturn = await inMemoryDb.query.stockReturns.findFirst({
        where: eq(schema.stockReturns.id, result.id),
      })
      expect(stockReturn).toMatchObject({
        deliveryItemId: "del-item-return-source",
        worksiteId: "ws-stock",
        productId: "prod-stock-return",
        quantity: 3,
      })

      const movement = await inMemoryDb.query.inventoryMovements.findFirst({
        where: eq(schema.inventoryMovements.referenceId, result.id),
      })
      expect(movement).toMatchObject({
        type: "ingreso_devolucion",
        referenceType: "delivery_return",
        quantity: 3,
      })

      await expect(registerStockReturn({
        deliveryItemId: "del-item-return-source",
        quantity: 3,
        performedBy: userId,
        reason: "Segundo intento",
      }, ["ws-stock"])).rejects.toThrow("Máximo devolvible: 2")

      const returns = await inMemoryDb
        .select()
        .from(schema.stockReturns)
        .where(eq(schema.stockReturns.deliveryItemId, "del-item-return-source"))
      expect(returns).toHaveLength(1)
    })
  })

  // ── egress_desecho ────────────────────────────────────────────────────────

  describe("egress_desecho", () => {
    it("deducts from stock (item retired from worksite inventory)", async () => {
      const stockBefore = await inMemoryDb.query.worksiteStock.findFirst({
        where: and(
          eq(schema.worksiteStock.worksiteId, "ws-stock"),
          eq(schema.worksiteStock.productId, "prod-stock"),
        ),
      })
      const qtyBefore = stockBefore?.quantity ?? 0

      const newQty = await applyMovement({
        worksiteId: "ws-stock",
        productId: "prod-stock",
        type: "egreso_desecho",
        quantity: 2,
        performedBy: userId,
        reason: "EPP desgastado",
      })

      // Stock SHOULD decrease
      expect(newQty).toBe(qtyBefore - 2)

      const stockAfter = await inMemoryDb.query.worksiteStock.findFirst({
        where: and(
          eq(schema.worksiteStock.worksiteId, "ws-stock"),
          eq(schema.worksiteStock.productId, "prod-stock"),
        ),
      })
      expect(stockAfter?.quantity).toBe(qtyBefore - 2)
    })

    it("requires quantity > 0", async () => {
      await expect(
        applyMovement({
          worksiteId: "ws-stock",
          productId: "prod-stock",
          type: "egreso_desecho",
          quantity: 0,
          performedBy: userId,
        })
      ).rejects.toThrow("mayor que cero")
    })

    it("creates an inventory movement record", async () => {
      await applyMovement({
        worksiteId: "ws-stock",
        productId: "prod-stock",
        type: "egreso_desecho",
        quantity: 1,
        performedBy: userId,
        reason: "Retiro por daño",
      })

      const movements = await inMemoryDb.query.inventoryMovements.findMany({
        where: eq(schema.inventoryMovements.type, "egreso_desecho"),
      })
      expect(movements.length).toBeGreaterThanOrEqual(1)
      const last = movements[movements.length - 1]!
      expect(last.productId).toBe("prod-stock")
      expect(last.quantity).toBe(-1) // stored as negative (egress)
      expect(last.reason).toBe("Retiro por daño")
    })

    it("records movement even when stock is already zero (EPP already delivered)", async () => {
      // Use prod-stock-3 which has never been touched (stock = 0)
      const newQty = await applyMovement({
        worksiteId: "ws-stock",
        productId: "prod-stock-3",
        type: "egreso_desecho",
        quantity: 5,
        performedBy: userId,
        reason: "EPP ya entregado, descartado por trabajador",
      })

      // Stock stays at 0 (record-only when no stock to deduct)
      expect(newQty).toBe(0)

      const movements = await inMemoryDb.query.inventoryMovements.findMany({
        where: eq(schema.inventoryMovements.productId, "prod-stock-3"),
      })
      expect(movements.length).toBeGreaterThanOrEqual(1)
      const last = movements[movements.length - 1]!
      expect(last.quantity).toBe(0) // 0 deducted (record-only)
    })
  })

  // ── Validation ─────────────────────────────────────────────────────────

  // ── Documentos manuales: ajuste y baja comparten cabecera ─────────────────

  describe("registerStockDiscard", () => {
    it("emite folio DES, cabecera kind='desecho' y descuenta el saldo", async () => {
      const before = await inMemoryDb.query.worksiteStock.findFirst({
        where: and(
          eq(schema.worksiteStock.worksiteId, "ws-stock"),
          eq(schema.worksiteStock.productId, "prod-stock"),
        ),
      })
      const qtyBefore = before?.quantity ?? 0

      const discard = await registerStockDiscard({
        worksiteId: "ws-stock",
        productId: "prod-stock",
        quantity: 3,
        performedBy: userId,
        reason: "Dañado en faena",
      })

      expect(discard.code).toMatch(/^DES-\d{4}-\d{4}$/)

      const [header] = await inMemoryDb
        .select()
        .from(schema.stockAdjustments)
        .where(eq(schema.stockAdjustments.id, discard.id))
      expect(header?.kind).toBe("desecho")
      // La cabecera guarda el efecto sobre el saldo: una baja resta.
      expect(header?.quantity).toBe(-3)

      const after = await inMemoryDb.query.worksiteStock.findFirst({
        where: and(
          eq(schema.worksiteStock.worksiteId, "ws-stock"),
          eq(schema.worksiteStock.productId, "prod-stock"),
        ),
      })
      expect(after?.quantity).toBe(qtyBefore - 3)
    })

    it("deja el movimiento enlazado a su documento", async () => {
      const discard = await registerStockDiscard({
        worksiteId: "ws-stock",
        productId: "prod-stock",
        quantity: 1,
        performedBy: userId,
        reason: "Vencido",
      })

      const movements = await inMemoryDb
        .select()
        .from(schema.inventoryMovements)
        .where(eq(schema.inventoryMovements.referenceId, discard.id))
      expect(movements).toHaveLength(1)
      expect(movements[0]?.type).toBe("egreso_desecho")
      expect(movements[0]?.referenceType).toBe("stock_adjustment")
    })

    it("rechaza una cantidad no positiva", async () => {
      await expect(registerStockDiscard({
        worksiteId: "ws-stock",
        productId: "prod-stock",
        quantity: 0,
        performedBy: userId,
        reason: "Nada",
      })).rejects.toThrow(/mayor que cero/)
    })
  })

  describe("registerStockAdjustment", () => {
    it("sigue produciendo folio AJU y cabecera kind='ajuste' tras generalizar el servicio", async () => {
      const adjustment = await registerStockAdjustment({
        worksiteId: "ws-stock",
        productId: "prod-stock",
        type: "ajuste",
        quantity: 4,
        performedBy: userId,
        reason: "Conteo manual",
      })

      expect(adjustment.code).toMatch(/^AJU-\d{4}-\d{4}$/)

      const [header] = await inMemoryDb
        .select()
        .from(schema.stockAdjustments)
        .where(eq(schema.stockAdjustments.id, adjustment.id))
      expect(header?.kind).toBe("ajuste")
      expect(header?.quantity).toBe(4)
    })

    it("rechaza un tipo que no sea ajuste", async () => {
      await expect(registerStockAdjustment({
        worksiteId: "ws-stock",
        productId: "prod-stock",
        type: "egreso_desecho",
        quantity: 1,
        performedBy: userId,
        reason: "x",
      })).rejects.toThrow(/no corresponde a un ajuste/)
    })
  })

  describe("validation", () => {
    it("throws when worksite does not exist", async () => {
      await expect(
        applyMovement({
          worksiteId: "nonexistent",
          productId: "prod-stock",
          type: "ingreso_oc",
          quantity: 5,
          performedBy: userId,
        })
      ).rejects.toThrow("not found")
    })

    it("throws when worksite is inactive", async () => {
      await expect(
        applyMovement({
          worksiteId: "ws-inactive",
          productId: "prod-stock",
          type: "ingreso_oc",
          quantity: 5,
          performedBy: userId,
        })
      ).rejects.toThrow("not active")
    })
  })

  // ── Audit trail ────────────────────────────────────────────────────────

  describe("audit trail", () => {
    it("records an inventory_movement with stockBefore and stockAfter", async () => {
      // Do a known movement on prod-stock-2 (fresh product)
      await applyMovement({
        worksiteId: "ws-stock",
        productId: "prod-stock-2",
        type: "ingreso_oc",
        quantity: 8,
        performedBy: userId,
      })

      const movements = await inMemoryDb.query.inventoryMovements.findMany({
        where: and(
          eq(schema.inventoryMovements.worksiteId, "ws-stock"),
          eq(schema.inventoryMovements.productId, "prod-stock-2"),
        ),
      })
      expect(movements).toHaveLength(1)
      expect(movements[0]?.stockBefore).toBe(0)
      expect(movements[0]?.stockAfter).toBe(8)
      expect(movements[0]?.type).toBe("ingreso_oc")
    })

    it("records an audit log entry", async () => {
      const auditBefore = await inMemoryDb.query.auditLog.findMany({
        where: eq(schema.auditLog.entityType, "inventory_movement"),
      })
      const countBefore = auditBefore.length

      await applyMovement({
        worksiteId: "ws-stock",
        productId: "prod-stock-2",
        type: "ingreso_oc",
        quantity: 2,
        performedBy: userId,
      })

      const auditAfter = await inMemoryDb.query.auditLog.findMany({
        where: eq(schema.auditLog.entityType, "inventory_movement"),
      })
      expect(auditAfter.length).toBe(countBefore + 1)
    })
  })
})
