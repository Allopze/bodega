/**
 * Item State Machine Integration Tests
 *
 * Tests the database-level mutations for each state transition using PGlite.
 */

import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, vi, afterAll, beforeAll } from "vitest"
import path from "node:path"
import { eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import type { DB } from "@/db"

const pg = new PGlite()
const pgLiteDb = drizzle(pg, { schema })
const inMemoryDb = pgLiteDb as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

const migrationsFolder = path.resolve(process.cwd(), "db/migrations")

import { submitItem, approveItem, bulkApproveItems, rejectItem, returnItem, markItemPendingPurchase, postponeItem, receiveItem } from "@/lib/services/item-state"

describe("Item State Machine — DB integration", () => {
  const now = new Date().toISOString()
  const userId = "user-test"
  const worksiteId = "ws-test"
  const requestId = "req-test"
  const itemId = "item-test"

  beforeAll(async () => {
    await migratePGlite(pg, migrationsFolder)

    await inMemoryDb.insert(schema.users).values({
      id: userId, name: "Test User", email: "test@chome.cl",
      hashedPassword: "hash", isActive: true,
      createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.worksites).values({
      id: worksiteId, name: "Faena Test", code: "F-TEST",
      isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: requestId, code: "SOL-TEST", worksiteId, requesterId: userId, requestType: "epp",
      urgency: "normal", status: "draft", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: itemId, requestId, productNameFree: "Casco Test",
      quantity: 10, unitOfMeasure: "unidad", status: "draft",
      createdAt: now, updatedAt: now,
    })
  })

  afterAll(async () => { await pg.close() })

  // ── submitItem ──────────────────────────────────────────────────────────
  describe("submitItem", () => {
    it("transitions draft → requested and records audit", async () => {
      const freshItem = "item-submit-test"
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: freshItem, requestId, productNameFree: "Test", quantity: 1,
        unitOfMeasure: "unidad", status: "draft",
        createdAt: now, updatedAt: now,
      })

      await submitItem(freshItem, userId)

      const updated = await inMemoryDb.query.purchaseRequestItems
        .findFirst({ where: eq(schema.purchaseRequestItems.id, freshItem) })
      expect(updated?.status).toBe("requested")
    })

    it("throws if item does not exist", async () => {
      await expect(submitItem("nonexistent", userId)).rejects.toThrow("not found")
    })

    it("throws if item is not in draft state", async () => {
      const lockedItem = "item-already-submitted"
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: lockedItem, requestId, productNameFree: "Locked", quantity: 1,
        unitOfMeasure: "unidad", status: "requested",
        createdAt: now, updatedAt: now,
      })
      await expect(submitItem(lockedItem, userId)).rejects.toThrow("Cannot transition")
    })
  })

  // ── approveItem ─────────────────────────────────────────────────────────
  describe("approveItem", () => {
    beforeAll(async () => {
      await inMemoryDb.update(schema.purchaseRequestItems)
        .set({ status: "requested" })
        .where(eq(schema.purchaseRequestItems.id, itemId))
    })

    it("transitions requested → approved → pending_purchase, rolls up request", async () => {
      await approveItem(itemId, userId)

      const item = await inMemoryDb.query.purchaseRequestItems
        .findFirst({ where: eq(schema.purchaseRequestItems.id, itemId) })
      expect(item?.status).toBe("approved")

      const decision = await inMemoryDb.query.approvalDecisions
        .findFirst({ where: eq(schema.approvalDecisions.requestItemId, itemId) })
      expect(decision?.type).toBe("approve")
      const [activity] = await inMemoryDb.select().from(schema.operationalActivityEvents)
        .where(eq(schema.operationalActivityEvents.entityId, itemId))
      expect(activity).toMatchObject({
        eventType: "request_item.approved",
        module: "solicitudes",
        worksiteId,
        actorUserId: userId,
      })
    })

    it("allows modifiedQty override", async () => {
      const modItem = "item-mod"
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: modItem, requestId, productNameFree: "Test Mod", quantity: 5,
        unitOfMeasure: "unidad", status: "requested",
        createdAt: now, updatedAt: now,
      })
      await approveItem(modItem, userId, { modifiedQty: 3, reason: "Ajuste por disponibilidad real" })

      const updated = await inMemoryDb.query.purchaseRequestItems
        .findFirst({ where: eq(schema.purchaseRequestItems.id, modItem) })
      expect(updated?.quantity).toBe(3)
      expect(updated?.status).toBe("approved")
    })

    it("throws if item is not in approved-allowed state", async () => {
      await inMemoryDb.update(schema.purchaseRequestItems)
        .set({ status: "draft" })
        .where(eq(schema.purchaseRequestItems.id, itemId))
      await expect(approveItem(itemId, userId)).rejects.toThrow("Cannot approve")
      await inMemoryDb.update(schema.purchaseRequestItems)
        .set({ status: "requested" })
        .where(eq(schema.purchaseRequestItems.id, itemId))
    })
  })

  describe("bulkApproveItems", () => {
    it("rolls back the complete batch when one selected item cannot transition", async () => {
      const approvableId = "item-bulk-approvable"
      const blockedId = "item-bulk-blocked"
      await inMemoryDb.insert(schema.purchaseRequestItems).values([
        {
          id: approvableId, requestId, productNameFree: "Bulk approvable", quantity: 1,
          unitOfMeasure: "unidad", status: "requested", createdAt: now, updatedAt: now,
        },
        {
          id: blockedId, requestId, productNameFree: "Bulk blocked", quantity: 1,
          unitOfMeasure: "unidad", status: "draft", createdAt: now, updatedAt: now,
        },
      ])

      await expect(bulkApproveItems([approvableId, blockedId], userId)).rejects.toThrow(/No se puede aprobar/i)

      const rows = await inMemoryDb.query.purchaseRequestItems.findMany({
        where: (item, { inArray }) => inArray(item.id, [approvableId, blockedId]),
      })
      expect(rows.map((item) => item.status).sort()).toEqual(["draft", "requested"])
      const decisions = await inMemoryDb.query.approvalDecisions.findMany({
        where: (decision, { inArray }) => inArray(decision.requestItemId, [approvableId, blockedId]),
      })
      expect(decisions).toHaveLength(0)
    })
  })

  // ── rejectItem ──────────────────────────────────────────────────────────
  describe("rejectItem", () => {
    const rejectItemId = "item-reject"
    beforeAll(async () => {
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: rejectItemId, requestId, productNameFree: "Reject Test", quantity: 1,
        unitOfMeasure: "unidad", status: "requested",
        createdAt: now, updatedAt: now,
      })
    })

    it("transitions requested → rejected with reason", async () => {
      await rejectItem(rejectItemId, userId, "No autorizado")

      const item = await inMemoryDb.query.purchaseRequestItems
        .findFirst({ where: eq(schema.purchaseRequestItems.id, rejectItemId) })
      expect(item?.status).toBe("rejected")
    })

    it("throws if reason is empty", async () => {
      await expect(rejectItem(itemId, userId, "")).rejects.toThrow("Reason is required")
      await expect(rejectItem(itemId, userId, "  ")).rejects.toThrow("Reason is required")
    })

    it("throws on invalid transition", async () => {
      await expect(rejectItem(rejectItemId, userId, "duplicate")).rejects.toThrow("Cannot reject")
    })
  })

  // ── returnItem ──────────────────────────────────────────────────────────
  describe("returnItem", () => {
    const returnItemId = "item-return"
    beforeAll(async () => {
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: returnItemId, requestId, productNameFree: "Return Test", quantity: 1,
        unitOfMeasure: "unidad", status: "requested",
        createdAt: now, updatedAt: now,
      })
    })

    it("transitions requested → returned", async () => {
      await returnItem(returnItemId, userId, "Falta especificar marca")

      const item = await inMemoryDb.query.purchaseRequestItems
        .findFirst({ where: eq(schema.purchaseRequestItems.id, returnItemId) })
      expect(item?.status).toBe("returned")

      const decision = await inMemoryDb.query.approvalDecisions
        .findFirst({ where: eq(schema.approvalDecisions.requestItemId, returnItemId) })
      expect(decision?.reason).toBe("Falta especificar marca")
    })

    it("throws without reason", async () => {
      await expect(returnItem(itemId, userId, "")).rejects.toThrow("Reason is required")
    })
  })

  // ── postponeItem ────────────────────────────────────────────────────────
  describe("postponeItem", () => {
    const postponeItemId = "item-postpone"
    beforeAll(async () => {
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: postponeItemId, requestId, productNameFree: "Postpone Test", quantity: 1,
        unitOfMeasure: "unidad", status: "pending_purchase",
        createdAt: now, updatedAt: now,
      })
    })

    it("transitions pending_purchase → postponed", async () => {
      await inMemoryDb.update(schema.purchaseRequestItems)
        .set({ status: "pending_purchase" })
        .where(eq(schema.purchaseRequestItems.id, postponeItemId))
      await postponeItem(postponeItemId, userId, "Esperar presupuesto")

      const item = await inMemoryDb.query.purchaseRequestItems
        .findFirst({ where: eq(schema.purchaseRequestItems.id, postponeItemId) })
      expect(item?.status).toBe("postponed")
    })

    it("transitions approved → postponed", async () => {
      await inMemoryDb.update(schema.purchaseRequestItems)
        .set({ status: "approved" })
        .where(eq(schema.purchaseRequestItems.id, postponeItemId))
      await postponeItem(postponeItemId, userId, "Repriorización aprobada")

      const item = await inMemoryDb.query.purchaseRequestItems
        .findFirst({ where: eq(schema.purchaseRequestItems.id, postponeItemId) })
      expect(item?.status).toBe("postponed")
    })

    it("throws without reason", async () => {
      await expect(postponeItem(itemId, userId, "")).rejects.toThrow("Reason is required")
    })
  })

  // ── markItemPendingPurchase ─────────────────────────────────────────────
  describe("markItemPendingPurchase", () => {
    const pendingItemId = "item-pending"
    beforeAll(async () => {
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: pendingItemId, requestId, productNameFree: "Pending Test", quantity: 1,
        unitOfMeasure: "unidad", status: "approved",
        createdAt: now, updatedAt: now,
      })
    })

    it("transitions approved → pending_purchase", async () => {
      await markItemPendingPurchase(pendingItemId, userId)

      const item = await inMemoryDb.query.purchaseRequestItems
        .findFirst({ where: eq(schema.purchaseRequestItems.id, pendingItemId) })
      expect(item?.status).toBe("pending_purchase")
    })

    it("throws on invalid transition", async () => {
      const noTrans = "item-no-mark"
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: noTrans, requestId, productNameFree: "No Mark", quantity: 1,
        unitOfMeasure: "unidad", status: "draft",
        createdAt: now, updatedAt: now,
      })
      await expect(markItemPendingPurchase(noTrans, userId)).rejects.toThrow("Cannot move")
    })
  })

  // ── receiveItem ─────────────────────────────────────────────────────────
  describe("receiveItem", () => {
    it("acepta una segunda recepción parcial sobre un ítem ya parcialmente recibido", async () => {
      const partialId = "item-partial-twice"
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: partialId, requestId, productNameFree: "Parcial x2", quantity: 10,
        unitOfMeasure: "unidad", status: "purchased",
        createdAt: now, updatedAt: now,
      })

      await receiveItem(partialId, userId, { fullReceived: false })
      // El saldo llega en un segundo tramo que tampoco completa la línea: antes
      // reventaba con "Cannot transition item from 'partially_received' to
      // 'partially_received'" y arrastraba todo el comprobante en el rollback.
      await receiveItem(partialId, userId, { fullReceived: false })

      const item = await inMemoryDb.query.purchaseRequestItems
        .findFirst({ where: eq(schema.purchaseRequestItems.id, partialId) })
      expect(item?.status).toBe("partially_received")

      // Sin cambio de estado no se ensucia el historial: sólo la primera recepción
      // deja fila en status_history.
      const history = await inMemoryDb.query.statusHistory
        .findMany({ where: eq(schema.statusHistory.entityId, partialId) })
      expect(history).toHaveLength(1)
    })

    it("no retrocede el estado de un ítem con entrega parcial cuando llega el saldo", async () => {
      const deliveredId = "item-partial-delivered"
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: deliveredId, requestId, productNameFree: "Saldo tras entrega", quantity: 10,
        unitOfMeasure: "unidad", status: "partially_delivered",
        createdAt: now, updatedAt: now,
      })

      await receiveItem(deliveredId, userId, { fullReceived: true })

      const item = await inMemoryDb.query.purchaseRequestItems
        .findFirst({ where: eq(schema.purchaseRequestItems.id, deliveredId) })
      expect(item?.status).toBe("partially_delivered")
    })
  })

  // ── terminal state guard ────────────────────────────────────────────────
  describe("terminal states", () => {
    it("rejected items cannot be re-approved", async () => {
      const termId = "item-terminated"
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: termId, requestId, productNameFree: "Term", quantity: 1,
        unitOfMeasure: "unidad", status: "rejected",
        createdAt: now, updatedAt: now,
      })
      await expect(approveItem(termId, userId)).rejects.toThrow("Cannot approve")
    })
  })
})
