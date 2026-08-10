/**
 * Integration tests for lib/services/trazabilidad-item.ts — getItemDetail.
 *
 * Uses PGlite in-memory database (same pattern as stock-service.test.ts).
 * Tests the full lifecycle data retrieval: request → approvals → OC → receipts → deliveries → timeline.
 */

import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, vi, afterAll, beforeAll } from "vitest"
import path from "node:path"
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

import { getItemDetail } from "@/lib/services/trazabilidad-item"

const now = new Date().toISOString()

// ── Session helpers ─────────────────────────────────────────────────────────

function globalSession() {
  return {
    expires: new Date(Date.now() + 60_000).toISOString(),
    user: {
      id: "user-global",
      name: "Usuario Global",
      email: "global@chome.cl",
      roles: ["administrador"],
      permissions: [],
      worksiteIds: [],
      primaryWorksiteId: null,
      avatarColor: null,
      isActive: true,
    },
  }
}

function scopedSession(worksiteIds: string[]) {
  return {
    expires: new Date(Date.now() + 60_000).toISOString(),
    user: {
      id: "user-scoped",
      name: "Usuario Faena",
      email: "faena@chome.cl",
      roles: ["solicitante_faena"],
      permissions: [],
      worksiteIds,
      primaryWorksiteId: worksiteIds[0] ?? null,
      avatarColor: null,
      isActive: true,
    },
  }
}

// ── Seed data constants ─────────────────────────────────────────────────────

const WS_1 = "ws-tz-1"
const WS_2 = "ws-tz-2"
const USER_REQ = "u-tz-req"
const USER_APR = "u-tz-apr"
const USER_BOD = "u-tz-bod"
const PROD_1 = "prod-tz-1"
const CAT = "cat-tz"
const SUP = "sup-tz"
const REQ = "req-tz"
const ITEM = "item-tz"

// ── Master data seeding ─────────────────────────────────────────────────────

async function seedMasterData() {
  await inMemoryDb.insert(schema.users).values([
    {
      id: USER_REQ, name: "Solicitante", email: "req@chome.cl",
      hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now,
    },
    {
      id: USER_APR, name: "Aprobador", email: "apr@chome.cl",
      hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now,
    },
    {
      id: USER_BOD, name: "Bodeguero", email: "bod@chome.cl",
      hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now,
    },
    {
      id: "user-global", name: "Usuario Global", email: "global@chome.cl",
      hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now,
    },
  ])

  await inMemoryDb.insert(schema.worksites).values([
    {
      id: WS_1, name: "Faena Alfa", code: "F-ALFA",
      isActive: true, createdAt: now, updatedAt: now,
    },
    {
      id: WS_2, name: "Faena Beta", code: "F-BETA",
      isActive: true, createdAt: now, updatedAt: now,
    },
  ])

  await inMemoryDb.insert(schema.productCategories).values({
    id: CAT, name: "EPP", slug: "epp", sortOrder: 1,
  })

  await inMemoryDb.insert(schema.products).values({
    id: PROD_1, sku: "EPP-001", name: "Guantes Nitrilo",
    categoryId: CAT, unitOfMeasure: "par", isActive: true,
    createdAt: now, updatedAt: now,
  })

  await inMemoryDb.insert(schema.workers).values({
    id: "wrk-tz-1", firstName: "Juan", lastName: "Pérez",
    rut: "12.345.678-9", worksiteId: WS_1, isActive: true,
    createdAt: now,
  })

  await inMemoryDb.insert(schema.suppliers).values({
    id: SUP, name: "Proveedor Test", isActive: true,
    createdAt: now, updatedAt: now,
  })
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("getItemDetail", () => {
  beforeAll(async () => {
    await migratePGlite(pg, migrationsFolder)
    await seedMasterData()
  })

  afterAll(async () => { await pg.close() })

  // ── Null / Access control ───────────────────────────────────────────────

  describe("returns null for missing or inaccessible items", () => {
    it("returns null for non-existent item ID", async () => {
      const result = await getItemDetail(globalSession(), "nonexistent-id")
      expect(result).toBeNull()
    })

    it("returns null when scoped user lacks worksite access", async () => {
      // Seed a request on WS_1
      await inMemoryDb.insert(schema.purchaseRequests).values({
        id: "req-hidden", code: "SOL-HIDDEN", worksiteId: WS_1,
        requesterId: USER_REQ, status: "submitted", createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: "item-hidden", requestId: "req-hidden", productId: PROD_1,
        quantity: 5, unitOfMeasure: "par", status: "approved",
        createdAt: now, updatedAt: now,
      })

      // Scoped to WS_2 (different from WS_1)
      const result = await getItemDetail(scopedSession([WS_2]), "item-hidden")
      expect(result).toBeNull()
    })
  })

  // ── Basic item data ────────────────────────────────────────────────────

  describe("basic item data", () => {
    beforeAll(async () => {
      await inMemoryDb.insert(schema.purchaseRequests).values({
        id: REQ, code: "SOL-TZ-001", worksiteId: WS_1,
        requesterId: USER_REQ, status: "approved", createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: ITEM, requestId: REQ, productId: PROD_1,
        quantity: 10, unitOfMeasure: "par", status: "approved",
        urgency: "high", requiredDate: "2026-07-01",
        notes: "Urgente para faena", createdAt: now, updatedAt: now,
      })
    })

    it("returns complete item detail with correct fields", async () => {
      const result = await getItemDetail(globalSession(), ITEM)

      expect(result).not.toBeNull()
      expect(result!.item.id).toBe(ITEM)
      expect(result!.item.requestCode).toBe("SOL-TZ-001")
      expect(result!.item.worksiteName).toBe("Faena Alfa")
      expect(result!.item.productName).toBe("Guantes Nitrilo")
      expect(result!.item.productSku).toBe("EPP-001")
      expect(result!.item.quantity).toBe(10)
      expect(result!.item.unitOfMeasure).toBe("par")
      expect(result!.item.status).toBe("approved")
      expect(result!.item.urgency).toBe("high")
      expect(result!.item.requiredDate).toBe("2026-07-01")
      expect(result!.item.notes).toBe("Urgente para faena")
      expect(result!.item.requesterName).toBe("Solicitante")
      expect(result!.item.requesterEmail).toBe("req@chome.cl")
    })

    it("returns empty arrays for approvals, ocItems, receipts, deliveries, timeline", async () => {
      const result = await getItemDetail(globalSession(), ITEM)

      expect(result).not.toBeNull()
      expect(result!.approvals).toEqual([])
      expect(result!.ocItems).toEqual([])
      expect(result!.receipts).toEqual([])
      expect(result!.deliveries).toEqual([])
      expect(result!.timeline).toEqual([])
    })
  })

  // ── Item without product (productNameFree fallback) ────────────────────

  describe("item without product", () => {
    it("uses productNameFree when productId is null", async () => {
      await inMemoryDb.insert(schema.purchaseRequests).values({
        id: "req-freetxt", code: "SOL-FREE", worksiteId: WS_1,
        requesterId: USER_REQ, status: "submitted", createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseRequestItems).values({
        id: "item-freetxt", requestId: "req-freetxt", productId: null,
        productNameFree: "Clavos de acero 3 pulgadas",
        quantity: 100, unitOfMeasure: "kg", status: "requested",
        createdAt: now, updatedAt: now,
      })

      const result = await getItemDetail(globalSession(), "item-freetxt")
      expect(result).not.toBeNull()
      expect(result!.item.productName).toBe("Clavos de acero 3 pulgadas")
      expect(result!.item.productNameFree).toBe("Clavos de acero 3 pulgadas")
      expect(result!.item.productSku).toBeNull()
    })
  })

  // ── Attributes ─────────────────────────────────────────────────────────

  describe("item attributes", () => {
    it("returns attributes for the item", async () => {
      await inMemoryDb.insert(schema.requestItemAttributes).values([
        {
          id: "attr-1", requestItemId: ITEM, attributeName: "Talla",
          value: "L",
        },
        {
          id: "attr-2", requestItemId: ITEM, attributeName: "Color",
          value: "Negro",
        },
      ])

      const result = await getItemDetail(globalSession(), ITEM)
      expect(result).not.toBeNull()
      expect(result!.item.attributes).toHaveLength(2)
      expect(result!.item.attributes).toContainEqual({ name: "Talla", value: "L" })
      expect(result!.item.attributes).toContainEqual({ name: "Color", value: "Negro" })
    })
  })

  // ── Approvals ──────────────────────────────────────────────────────────

  describe("approval decisions", () => {
    it("returns approvals with user info and role context", async () => {
      await inMemoryDb.insert(schema.approvalDecisions).values({
        id: "dec-1", requestItemId: ITEM, requestId: REQ,
        type: "approve", decidedBy: USER_APR,
        decidedAt: now, reason: "Cumple normativa",
        modifiedQty: null, roleContext: "jefa_chome",
      })

      const result = await getItemDetail(globalSession(), ITEM)
      expect(result).not.toBeNull()
      expect(result!.approvals).toHaveLength(1)
      expect(result!.approvals[0]).toMatchObject({
        type: "approve",
        decidedByName: "Aprobador",
        decidedByEmail: "apr@chome.cl",
        reason: "Cumple normativa",
        roleContext: "jefa_chome",
        modifiedQty: null,
      })
    })
  })

  // ── OC items ───────────────────────────────────────────────────────────

  describe("OC items", () => {
    it("returns OC items with supplier name and quantities", async () => {
      await inMemoryDb.insert(schema.purchaseOrders).values({
        id: "oc-tz-1", code: "OC-2026-001", worksiteId: WS_1,
        supplierId: SUP, createdBy: USER_BOD, status: "received",
        createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.purchaseOrderItems).values({
        id: "poi-tz-1", purchaseOrderId: "oc-tz-1", requestItemId: ITEM,
        productId: PROD_1, quantity: 8, unitOfMeasure: "par",
        unitPrice: 5000, subtotal: 40000, quantityReceived: 8, quantityOfficeReceived: 8,
      })

      const result = await getItemDetail(globalSession(), ITEM)
      expect(result).not.toBeNull()
      expect(result!.ocItems).toHaveLength(1)
      expect(result!.ocItems[0]).toMatchObject({
          ocCode: "OC-2026-001",
          ocStatus: "received",
        supplierName: "Proveedor Test",
        quantity: 8,
        unitPrice: 5000,
        receivedAtFaena: 8,
        receivedAtOffice: 8,
      })
    })
  })

  // ── Receipts ───────────────────────────────────────────────────────────

  describe("receipts", () => {
    it("returns receipt items linked to OC items", async () => {
      await inMemoryDb.insert(schema.receipts).values({
        id: "rec-tz-1", code: "REC-2026-001", purchaseOrderId: "oc-tz-1",
        receivedBy: USER_BOD, locationType: "faena", status: "closed",
        receivedAt: now, createdAt: now,
      })
      await inMemoryDb.insert(schema.receiptItems).values({
        id: "reci-tz-1", receiptId: "rec-tz-1",
        purchaseOrderItemId: "poi-tz-1",
        quantityReceived: 8, quantityRejected: 0,
      })

      const result = await getItemDetail(globalSession(), ITEM)
      expect(result).not.toBeNull()
      expect(result!.receipts).toHaveLength(1)
      expect(result!.receipts[0]).toMatchObject({
        code: "REC-2026-001",
        locationType: "faena",
        receivedByName: "Bodeguero",
        quantityReceived: 8,
        quantityRejected: 0,
      })
    })
  })

  // ── Deliveries ─────────────────────────────────────────────────────────

  describe("deliveries", () => {
    it("returns delivery items with worker name concatenation", async () => {
      await inMemoryDb.insert(schema.deliveries).values({
        id: "del-tz-1", code: "ENT-2026-001", deliveredBy: USER_BOD,
        destinationType: "worker", worksiteId: WS_1,
        workerId: "wrk-tz-1", deliveredAt: now, createdAt: now,
      })
      await inMemoryDb.insert(schema.deliveryItems).values({
        id: "deli-tz-1", deliveryId: "del-tz-1",
        requestItemId: ITEM, productId: PROD_1,
        quantity: 5, unitOfMeasure: "par",
      })

      const result = await getItemDetail(globalSession(), ITEM)
      expect(result).not.toBeNull()
      expect(result!.deliveries).toHaveLength(1)
      expect(result!.deliveries[0]).toMatchObject({
        code: "ENT-2026-001",
        destinationType: "worker",
        deliveredByName: "Bodeguero",
        workerName: "Juan Pérez",
        quantity: 5,
      })
    })

    it("uses receiverName fallback when no worker is linked", async () => {
      await inMemoryDb.insert(schema.deliveries).values({
        id: "del-tz-2", code: "ENT-2026-002", deliveredBy: USER_BOD,
        destinationType: "faena", worksiteId: WS_1,
        receiverName: "Jefe de faena", deliveredAt: now, createdAt: now,
      })
      await inMemoryDb.insert(schema.deliveryItems).values({
        id: "deli-tz-2", deliveryId: "del-tz-2",
        requestItemId: ITEM, productId: PROD_1,
        quantity: 3, unitOfMeasure: "par",
        returnQuantity: 1, returnReason: "desgastado",
      })

      const result = await getItemDetail(globalSession(), ITEM)
      expect(result).not.toBeNull()
      const del = result!.deliveries.find((d) => d.code === "ENT-2026-002")
      expect(del).toBeDefined()
      expect(del!.workerName).toBe("Jefe de faena")
      expect(del!.returnQuantity).toBe(1)
      expect(del!.returnReason).toBe("desgastado")
    })
  })

  // ── Timeline ───────────────────────────────────────────────────────────

  describe("status history / timeline", () => {
    it("returns timeline entries with user info, ordered by changedAt DESC", async () => {
      await inMemoryDb.insert(schema.statusHistory).values([
        {
          id: "sh-1", entityType: "request_item", entityId: ITEM,
          fromStatus: "draft", toStatus: "requested",
          changedBy: USER_REQ, changedAt: "2026-06-01T10:00:00Z",
        },
        {
          id: "sh-2", entityType: "request_item", entityId: ITEM,
          fromStatus: "requested", toStatus: "approved",
          changedBy: USER_APR, changedAt: "2026-06-02T14:00:00Z",
          reason: "Aprobado por jefa",
        },
      ])

      const result = await getItemDetail(globalSession(), ITEM)
      expect(result).not.toBeNull()
      expect(result!.timeline).toHaveLength(2)
      // Ordered by changedAt DESC — most recent first
      expect(result!.timeline[0]!.toStatus).toBe("approved")
      expect(result!.timeline[0]!.userName).toBe("Aprobador")
      expect(result!.timeline[0]!.reason).toBe("Aprobado por jefa")
      expect(result!.timeline[1]!.toStatus).toBe("requested")
      expect(result!.timeline[1]!.userName).toBe("Solicitante")
    })
  })

  // ── RBAC scoping ───────────────────────────────────────────────────────

  describe("RBAC scoping", () => {
    it("global session can access any worksite", async () => {
      const result = await getItemDetail(globalSession(), ITEM)
      expect(result).not.toBeNull()
    })

    it("scoped session can access its own worksite", async () => {
      const result = await getItemDetail(scopedSession([WS_1]), ITEM)
      expect(result).not.toBeNull()
      expect(result!.item.worksiteName).toBe("Faena Alfa")
    })

    it("scoped session cannot access other worksites", async () => {
      const result = await getItemDetail(scopedSession([WS_2]), ITEM)
      expect(result).toBeNull()
    })
  })
})
