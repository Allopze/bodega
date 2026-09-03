import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import type { DB } from "@/db"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

import {
  resolveTraceabilityIntegrityCase,
  scanTraceabilityIntegrity,
} from "@/lib/services/traceability-integrity-cases"

const now = "2026-08-09T12:00:00.000Z"
const session = {
  expires: "2099-01-01T00:00:00.000Z",
  user: {
    id: "integrity-user",
    email: "integrity@test.local",
    roles: ["administrador"],
    isGlobal: true,
    worksiteIds: [],
    primaryWorksiteId: null,
    avatarColor: null,
    isActive: true,
    permissions: ["warehouse:reconcile_integrity"],
  },
} as Session

describe("traceability integrity case resolution", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await inMemoryDb.insert(schema.users).values({
      id: "integrity-user", name: "Integrity User", email: "integrity@test.local", hashedPassword: "x",
      isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.worksites).values([
      { id: "integrity-ws", name: "Faena íntegra", code: "INT", isActive: true, createdAt: now, updatedAt: now },
      { id: "integrity-ws-other", name: "Faena ajena", code: "INT-OTHER", isActive: true, createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.productCategories).values({ id: "integrity-cat", name: "Integridad", slug: "integridad", sortOrder: 1 })
    await inMemoryDb.insert(schema.products).values({
      id: "integrity-product", sku: "INT-001", name: "Casco integridad", categoryId: "integrity-cat",
      unitOfMeasure: "unidad", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: "integrity-request", code: "SOL-INTEGRITY", worksiteId: "integrity-ws", requesterId: "integrity-user",
      requestType: "epp", urgency: "normal", status: "approved", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: "integrity-request-item", requestId: "integrity-request", productId: "integrity-product", quantity: 1,
      unitOfMeasure: "unidad", status: "received", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.traceabilityIntegrityCases).values([
      {
        id: "integrity-case-wrong-adjustment", findingKey: "integrity-case-wrong-adjustment-key",
        requestItemId: "integrity-request-item", worksiteId: "integrity-ws",
        findingCode: "DELIVERY_EXCEEDS_FAENA_RECEIPT", snapshot: { receivedAtFaena: 0, delivered: 1 }, detectedAt: now,
      },
      {
        id: "integrity-case-resolve-once", findingKey: "integrity-case-resolve-once-key",
        requestItemId: "integrity-request-item", worksiteId: "integrity-ws",
        findingCode: "DELIVERY_BEFORE_FAENA_RECEIPT", snapshot: { firstFaenaReceiptAt: now }, detectedAt: now,
      },
    ])
    await inMemoryDb.insert(schema.inventoryMovements).values([
      {
        id: "integrity-adjustment-other", worksiteId: "integrity-ws-other", productId: "integrity-product", type: "ajuste",
        quantity: 1, stockBefore: 0, stockAfter: 1, performedBy: "integrity-user", performedAt: now, reason: "Ajuste otra faena",
      },
      {
        id: "integrity-adjustment-own", worksiteId: "integrity-ws", productId: "integrity-product", type: "ajuste",
        quantity: 1, stockBefore: 0, stockAfter: 1, performedBy: "integrity-user", performedAt: now, reason: "Ajuste de conciliación",
      },
    ])
  })

  afterAll(async () => {
    await pg.close()
    testGlobal.__db = undefined
  })

  it("rejects an adjustment from another worksite without appending a resolution", async () => {
    await expect(resolveTraceabilityIntegrityCase({
      caseId: "integrity-case-wrong-adjustment",
      action: "compensating_movement",
      compensatingMovementId: "integrity-adjustment-other",
      reason: "El ajuste pertenece a otra faena y no puede usarse.",
      userId: "integrity-user",
      userEmail: "integrity@test.local",
      session,
    })).rejects.toThrow("misma faena")

    const resolutions = await inMemoryDb.select().from(schema.traceabilityIntegrityResolutions)
    expect(resolutions).toHaveLength(0)
  })

  it("appends one resolution and prevents a second resolution for the same case", async () => {
    const input = {
      caseId: "integrity-case-resolve-once",
      action: "compensating_movement" as const,
      compensatingMovementId: "integrity-adjustment-own",
      reason: "Se vincula el ajuste ya registrado para documentar la excepción.",
      userId: "integrity-user",
      userEmail: "integrity@test.local",
      session,
    }
    await resolveTraceabilityIntegrityCase(input)
    await expect(resolveTraceabilityIntegrityCase(input)).rejects.toThrow("ya fue regularizado")

    const resolutions = await inMemoryDb.select().from(schema.traceabilityIntegrityResolutions)
    expect(resolutions).toHaveLength(1)
    expect(resolutions[0]).toMatchObject({
      caseId: "integrity-case-resolve-once",
      action: "compensating_movement",
      compensatingMovementId: "integrity-adjustment-own",
    })
  })

  it("excludes a free stock delivery without requestItemId from findings", async () => {
    await inMemoryDb.insert(schema.deliveries).values({
      id: "integrity-free-delivery", code: "ENT-INTEGRITY-FREE", deliveredBy: "integrity-user",
      deliveredAt: now, destinationType: "faena", worksiteId: "integrity-ws", createdAt: now,
    })
    await inMemoryDb.insert(schema.deliveryItems).values({
      id: "integrity-free-delivery-item", deliveryId: "integrity-free-delivery", requestItemId: null,
      productId: "integrity-product", productNameFree: null, quantity: 1, unitOfMeasure: "unidad",
    })

    const result = await scanTraceabilityIntegrity(session)
    expect(result.findings).toEqual([])
    expect(result.recordedCount).toBe(0)
  })
})
