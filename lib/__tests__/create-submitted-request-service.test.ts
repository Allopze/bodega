/**
 * createSubmittedRequest — DB integration (TST-5 parcial, SEC-1).
 *
 * El corazón del rediseño (EPP/otro nacen `submitted` con ítems `requested`
 * en una sola transacción) sólo se probaba antes con el servicio mockeado.
 * Corre contra PGlite real para verificar filas reales de
 * purchaseRequests/purchaseRequestItems/statusHistory, y el rechazo de
 * SEC-1 (workerId de otra faena).
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import path from "node:path"
import { and, eq } from "drizzle-orm"
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

import { createSubmittedRequest } from "@/lib/services/requests-draft"

describe("createSubmittedRequest — DB integration", () => {
  const now = new Date().toISOString()
  const userId = "user-csr-test"
  const worksiteId = "ws-csr-test"
  const otherWorksiteId = "ws-csr-other"

  beforeAll(async () => {
    await migratePGlite(pg, migrationsFolder)

    await inMemoryDb.insert(schema.users).values({
      id: userId, name: "Test User", email: "csr-test@chome.cl",
      hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.worksites).values([
      { id: worksiteId, name: "Faena CSR Test", code: "CSR-TEST", isActive: true, createdAt: now, updatedAt: now },
      { id: otherWorksiteId, name: "Faena CSR Otra", code: "CSR-OTHER", isActive: true, createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.workers).values([
      { id: "worker-csr-own", firstName: "Ana", lastName: "Propia", worksiteId, isActive: true, createdAt: now },
      { id: "worker-csr-other", firstName: "Beto", lastName: "Ajeno", worksiteId: otherWorksiteId, isActive: true, createdAt: now },
    ])
  })

  afterAll(async () => { await pg.close() })

  function baseData(overrides: Partial<Parameters<typeof createSubmittedRequest>[2]> = {}) {
    return {
      worksiteId, requestType: "epp" as const, urgency: "normal" as const,
      requiredDate: "2026-09-01", deliveryMode: "via_oficina" as const,
      items: [{
        productId: null, productNameFree: "Casco", quantity: 2, unitOfMeasure: "unidad",
        urgency: "normal" as const, workerId: null, suggestedSupplierId: null, supplierHint: null,
        notes: null, sortOrder: 0, attributes: [],
      }],
      ...overrides,
    }
  }

  it("crea la solicitud ya enviada con ítems requested, en una sola transacción", async () => {
    const { requestId, code } = await createSubmittedRequest(userId, "csr-test@chome.cl", baseData())
    expect(code).toMatch(/^SOL-/)

    const [request] = await inMemoryDb.select().from(schema.purchaseRequests).where(eq(schema.purchaseRequests.id, requestId))
    expect(request!.status).toBe("submitted")
    expect(request!.submittedAt).toBeTruthy()

    const items = await inMemoryDb.select().from(schema.purchaseRequestItems).where(eq(schema.purchaseRequestItems.requestId, requestId))
    expect(items).toHaveLength(1)
    expect(items[0]!.status).toBe("requested")

    const history = await inMemoryDb.select().from(schema.statusHistory).where(and(
      eq(schema.statusHistory.entityType, "purchase_request"), eq(schema.statusHistory.entityId, requestId),
    ))
    expect(history.some((h) => h.toStatus === "submitted")).toBe(true)
  })

  it("rechaza un ítem con workerId de otra faena (SEC-1)", async () => {
    await expect(createSubmittedRequest(userId, "csr-test@chome.cl", baseData({
      items: [{
        productId: null, productNameFree: "Casco", quantity: 1, unitOfMeasure: "unidad",
        urgency: "normal", workerId: "worker-csr-other", suggestedSupplierId: null, supplierHint: null,
        notes: null, sortOrder: 0, attributes: [],
      }],
    }))).rejects.toThrow("El trabajador no pertenece a la faena de la solicitud")
  })

  it("acepta un ítem con workerId de la misma faena", async () => {
    const { requestId } = await createSubmittedRequest(userId, "csr-test@chome.cl", baseData({
      items: [{
        productId: null, productNameFree: "Casco", quantity: 1, unitOfMeasure: "unidad",
        urgency: "normal", workerId: "worker-csr-own", suggestedSupplierId: null, supplierHint: null,
        notes: null, sortOrder: 0, attributes: [],
      }],
    }))
    const items = await inMemoryDb.select().from(schema.purchaseRequestItems).where(eq(schema.purchaseRequestItems.requestId, requestId))
    expect(items[0]!.workerId).toBe("worker-csr-own")
  })
})
