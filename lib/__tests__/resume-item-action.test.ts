/**
 * Integration tests for resume postponed item (postergar → reanudar).
 *
 * Uses PGlite in-memory database (same pattern as full-flow-integration.test.ts).
 * Tests the full postpone → resume lifecycle:
 *   1. Create request with item, submit, approve
 *   2. Postpone the item → status "postponed", request rolls up
 *   3. Resume (markItemPendingPurchase) → status "pending_purchase"
 *   4. Verify request rollup and that item appears back in purchase-ready state
 *   5. Error cases: resume non-postponed item, resume nonexistent item
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
const inMemoryDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(),
  recordStatusChange: vi.fn(),
}))

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({
    handlers: {},
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  })),
  CredentialsSignin: class CredentialsSignin extends Error {
    code: string
    constructor(message: string) {
      super(message)
      this.code = "generic"
    }
  },
}))

const migrationsFolder = path.resolve(process.cwd(), "db/migrations")

import { submitItem, approveItem, postponeItem, markItemPendingPurchase } from "@/lib/services/item-state"

const now = new Date().toISOString()

// ── Seed constants ─────────────────────────────────────────────────────────

const USER_ID = "u-resume-test"
const WS_ID = "ws-resume"
const SUP_ID = "sup-resume"
const CAT_ID = "cat-resume"
const PROD_ID = "prod-resume"

let requestId: string
let requestItemId: string

// ── Tests ───────────────────────────────────────────────────────────────────

describe("resume postponed item (postergar → reanudar)", () => {
  beforeAll(async () => {
    await migratePGlite(pg, migrationsFolder)

    // Master data
    await inMemoryDb.insert(schema.users).values({
      id: USER_ID, name: "Test User", email: "test@chome.cl",
      hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now,
    })

    await inMemoryDb.insert(schema.worksites).values({
      id: WS_ID, name: "Faena Test Resume", code: "F-RESUME",
      isActive: true, createdAt: now, updatedAt: now,
    })

    await inMemoryDb.insert(schema.suppliers).values({
      id: SUP_ID, name: "Proveedor Test Resume", rut: "76.000.001-1",
      isActive: true, createdAt: now, updatedAt: now,
    })

    await inMemoryDb.insert(schema.productCategories).values({
      id: CAT_ID, name: "EPP Test", slug: "epp-test", sortOrder: 1,
    })

    await inMemoryDb.insert(schema.products).values({
      id: PROD_ID, sku: "EPP-RESUME-001", name: "Casco de Seguridad",
      categoryId: CAT_ID, unitOfMeasure: "unidad", isEpp: true, isActive: true,
      createdAt: now, updatedAt: now,
    })

    // Create a purchase request with one item
    requestId = "req-resume"
    requestItemId = "item-resume"

    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: requestId, code: "SOL-RESUME-001", worksiteId: WS_ID,
      requesterId: USER_ID, requestType: "epp", urgency: "normal",
      status: "draft", createdAt: now, updatedAt: now,
    })

    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: requestItemId, requestId, productId: PROD_ID,
      quantity: 10, unitOfMeasure: "unidad", status: "draft",
      createdAt: now, updatedAt: now,
    })
  })

  afterAll(async () => { await pg.close() })

  // ── Happy path: submit → approve → postpone → resume ────────────────────

  it("completes the full postpone → resume lifecycle", async () => {
    // 1. Submit the item
    await submitItem(requestItemId, USER_ID, { userEmail: "test@chome.cl" })
    await inMemoryDb.update(schema.purchaseRequests)
      .set({ status: "submitted", submittedAt: now, updatedAt: now })
      .where(eq(schema.purchaseRequests.id, requestId))

    let item = await inMemoryDb.query.purchaseRequestItems.findFirst({
      where: eq(schema.purchaseRequestItems.id, requestItemId),
    })
    expect(item?.status).toBe("requested")

    // 2. Approve the item
    await approveItem(requestItemId, USER_ID, { userEmail: "test@chome.cl" })

    item = await inMemoryDb.query.purchaseRequestItems.findFirst({
      where: eq(schema.purchaseRequestItems.id, requestItemId),
    })
    expect(item?.status).toBe("approved")

    let req = await inMemoryDb.query.purchaseRequests.findFirst({
      where: eq(schema.purchaseRequests.id, requestId),
    })
    expect(req?.status).toBe("approved")

    // 3. First move to pending_purchase (approved → pending_purchase)
    await markItemPendingPurchase(requestItemId, USER_ID, {
      userEmail: "test@chome.cl",
    })

    item = await inMemoryDb.query.purchaseRequestItems.findFirst({
      where: eq(schema.purchaseRequestItems.id, requestItemId),
    })
    expect(item?.status).toBe("pending_purchase")

    // 4. Postpone the item (pending_purchase → postponed)
    await postponeItem(requestItemId, USER_ID, "Reprogramado para próxima temporada", {
      userEmail: "test@chome.cl",
    })

    item = await inMemoryDb.query.purchaseRequestItems.findFirst({
      where: eq(schema.purchaseRequestItems.id, requestItemId),
    })
    expect(item?.status).toBe("postponed")

    // The request should roll up to "closed" when the only item is postponed
    req = await inMemoryDb.query.purchaseRequests.findFirst({
      where: eq(schema.purchaseRequests.id, requestId),
    })
    expect(req?.status).toBe("closed")

    // 5. Resume the postponed item (postponed → pending_purchase)
    await markItemPendingPurchase(requestItemId, USER_ID, {
      userEmail: "test@chome.cl",
    })

    item = await inMemoryDb.query.purchaseRequestItems.findFirst({
      where: eq(schema.purchaseRequestItems.id, requestItemId),
    })
    expect(item?.status).toBe("pending_purchase")

    // The request should roll up back from "closed" to "approved"
    // (pending_purchase is not yet in the purchasing flow,
    //  so the rollup sees all items as resolved & approved → "approved")
    req = await inMemoryDb.query.purchaseRequests.findFirst({
      where: eq(schema.purchaseRequests.id, requestId),
    })
    expect(req?.status).toBe("approved")
  })

  // ── Error: resume a non-postponed item (state that can't go to pending_purchase) ─

  it("rejects resuming an item that is not postponed", async () => {
    // Create a fresh item in "requested" status (can't go to pending_purchase directly)
    const req2Id = "req-resume-error"
    const item2Id = "item-resume-error"
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: req2Id, code: "SOL-RESUME-ERR", worksiteId: WS_ID,
      requesterId: USER_ID, requestType: "epp", urgency: "normal",
      status: "in_review", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: item2Id, requestId: req2Id, productId: PROD_ID,
      quantity: 5, unitOfMeasure: "unidad", status: "requested",
      createdAt: now, updatedAt: now,
    })

    await expect(
      markItemPendingPurchase(item2Id, USER_ID, { userEmail: "test@chome.cl" })
    ).rejects.toThrow("Cannot move item from 'requested' to 'pending_purchase'")
  })

  // ── Error: resume a delivered item (already resolved) ────────────────────

  it("rejects resuming a terminal item that is delivered", async () => {
    const req3Id = "req-resume-terminal"
    const item3Id = "item-resume-terminal"
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: req3Id, code: "SOL-RESUME-TERM", worksiteId: WS_ID,
      requesterId: USER_ID, requestType: "epp", urgency: "normal",
      status: "closed", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: item3Id, requestId: req3Id, productId: PROD_ID,
      quantity: 3, unitOfMeasure: "unidad", status: "delivered",
      createdAt: now, updatedAt: now,
    })

    await expect(
      markItemPendingPurchase(item3Id, USER_ID, { userEmail: "test@chome.cl" })
    ).rejects.toThrow("Cannot move item from 'delivered' to 'pending_purchase'")
  })

  // ── Error: resume a nonexistent item ─────────────────────────────────────

  it("rejects resuming a nonexistent item", async () => {
    await expect(
      markItemPendingPurchase("nonexistent-item", USER_ID, { userEmail: "test@chome.cl" })
    ).rejects.toThrow("not found")
  })
})
