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
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest"
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
import { createRequest, resolveCatalogItemQuantitiesTx } from "@/lib/services/requests-draft-create"

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
    await inMemoryDb.insert(schema.productCategories).values({
      id: "cat-csr-epp", name: "EPP CSR", slug: "cat-csr-epp", isEpp: true,
    })
    await inMemoryDb.insert(schema.products).values({
      id: "prod-csr-epp", sku: "CSR-EPP", name: "Casco CSR", categoryId: "cat-csr-epp",
      isEpp: true, isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.worksiteStock).values({
      id: "stock-csr-epp", worksiteId, productId: "prod-csr-epp", quantity: 4, minStock: 0, updatedAt: now,
    })
    await inMemoryDb.insert(schema.products).values({
      id: "prod-csr-epp-driver", sku: "CSR-EPP-DRIVER", name: "Kit de dosis CSR", categoryId: "cat-csr-epp",
      isEpp: true, isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.productAttributes).values({
      id: "attr-csr-epp-driver", productId: "prod-csr-epp-driver", name: "Número de dosis", type: "integer",
      isRequired: true, drivesQuantity: true, sortOrder: 0,
    })
    await inMemoryDb.insert(schema.worksiteStock).values({
      id: "stock-csr-epp-driver", worksiteId, productId: "prod-csr-epp-driver", quantity: 5, minStock: 0, updatedAt: now,
    })
    await inMemoryDb.insert(schema.products).values({
      id: "prod-csr-epp-snapshot-driver", sku: "CSR-EPP-SNAPSHOT-DRIVER", name: "Kit de dosis con snapshot", categoryId: "cat-csr-epp",
      isEpp: true, isActive: true, createdAt: now, updatedAt: now,
    })
    // Legacy data can bypass the form schema, so the service must still reject
    // an optional quantity driver that reached the database historically.
    await inMemoryDb.insert(schema.products).values({
      id: "prod-csr-epp-optional-driver", sku: "CSR-EPP-OPTIONAL-DRIVER", name: "Kit con driver opcional", categoryId: "cat-csr-epp",
      isEpp: true, isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.productAttributes).values({
      id: "attr-csr-epp-optional-driver", productId: "prod-csr-epp-optional-driver", name: "Dosis opcional", type: "integer",
      isRequired: false, drivesQuantity: true, sortOrder: 0,
    })
    await inMemoryDb.insert(schema.worksiteStock).values({
      id: "stock-csr-epp-optional-driver", worksiteId, productId: "prod-csr-epp-optional-driver", quantity: 4, minStock: 0, updatedAt: now,
    })
    await inMemoryDb.insert(schema.workers).values([
      { id: "worker-csr-own", firstName: "Ana", lastName: "Propia", worksiteId, isActive: true, createdAt: now },
      { id: "worker-csr-other", firstName: "Beto", lastName: "Ajeno", worksiteId: otherWorksiteId, isActive: true, createdAt: now },
    ])
  })

  afterAll(async () => { await pg.close() })
  afterEach(() => vi.unstubAllEnvs())

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

  function created(result: Awaited<ReturnType<typeof createSubmittedRequest>>) {
    expect(result.kind).toBe("created")
    if (result.kind !== "created") throw new Error("Expected a created request")
    return result
  }

  it("crea la solicitud ya enviada con ítems requested, en una sola transacción", async () => {
    const { requestId, code } = created(await createSubmittedRequest(userId, "csr-test@chome.cl", baseData()))
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
    const { requestId } = created(await createSubmittedRequest(userId, "csr-test@chome.cl", baseData({
      items: [{
        productId: null, productNameFree: "Casco", quantity: 1, unitOfMeasure: "unidad",
        urgency: "normal", workerId: "worker-csr-own", suggestedSupplierId: null, supplierHint: null,
        notes: null, sortOrder: 0, attributes: [],
      }],
    })))
    const items = await inMemoryDb.select().from(schema.purchaseRequestItems).where(eq(schema.purchaseRequestItems.requestId, requestId))
    expect(items[0]!.workerId).toBe("worker-csr-own")
  })

  it("returns a stock warning without creating request rows, then creates exactly once after explicit confirmation", async () => {
    vi.stubEnv("AUTH_SECRET", "create-submitted-request-test-secret")
    const data = baseData({
      items: [{
        productId: "prod-csr-epp", productNameFree: null, quantity: 3, unitOfMeasure: "unidad",
        urgency: "normal", workerId: null, suggestedSupplierId: null, supplierHint: null,
        notes: null, sortOrder: 0, attributes: [],
      }],
    })
    const submissionKey = "csr-stock-confirmation-0001"

    const warning = await createSubmittedRequest(userId, "csr-test@chome.cl", data, { submissionKey })
    expect(warning.kind).toBe("epp-stock-warning")
    if (warning.kind !== "epp-stock-warning") throw new Error("Expected an EPP stock warning")
    expect(warning.items).toEqual([expect.objectContaining({ productId: "prod-csr-epp", availableQuantity: 4, coverage: "total" })])

    const requestsBeforeConfirmation = await inMemoryDb.select().from(schema.purchaseRequests)
      .where(eq(schema.purchaseRequests.submissionKey, submissionKey))
    expect(requestsBeforeConfirmation).toHaveLength(0)

    const firstCreation = created(await createSubmittedRequest(userId, "csr-test@chome.cl", data, {
      submissionKey,
      confirmationToken: warning.confirmationToken,
    }))
    expect(firstCreation.replayed).toBe(false)

    const replay = created(await createSubmittedRequest(userId, "csr-test@chome.cl", data, { submissionKey }))
    expect(replay).toMatchObject({ requestId: firstCreation.requestId, code: firstCreation.code, replayed: true })

    const persisted = await inMemoryDb.select().from(schema.purchaseRequests)
      .where(eq(schema.purchaseRequests.submissionKey, submissionKey))
    expect(persisted).toHaveLength(1)
    expect(persisted[0]!.submissionPayloadHash).toBeTruthy()
  })

  it("returns a renewed warning when stock changes and rejects reuse of the key with another payload", async () => {
    vi.stubEnv("AUTH_SECRET", "create-submitted-request-test-secret")
    const submissionKey = "csr-stock-confirmation-0002"
    const data = baseData({
      items: [{
        productId: "prod-csr-epp", productNameFree: null, quantity: 3, unitOfMeasure: "unidad",
        urgency: "normal", workerId: null, suggestedSupplierId: null, supplierHint: null,
        notes: null, sortOrder: 0, attributes: [],
      }],
    })
    const firstWarning = await createSubmittedRequest(userId, "csr-test@chome.cl", data, { submissionKey })
    expect(firstWarning.kind).toBe("epp-stock-warning")
    if (firstWarning.kind !== "epp-stock-warning") throw new Error("Expected an EPP stock warning")

    await inMemoryDb.update(schema.worksiteStock).set({ quantity: 1 }).where(eq(schema.worksiteStock.id, "stock-csr-epp"))
    const renewedWarning = await createSubmittedRequest(userId, "csr-test@chome.cl", data, {
      submissionKey,
      confirmationToken: firstWarning.confirmationToken,
    })
    expect(renewedWarning).toMatchObject({ kind: "epp-stock-warning", items: [expect.objectContaining({ availableQuantity: 1, coverage: "partial" })] })

    const createdRequest = created(await createSubmittedRequest(userId, "csr-test@chome.cl", data, {
      submissionKey,
      confirmationToken: renewedWarning.kind === "epp-stock-warning" ? renewedWarning.confirmationToken : "",
    }))
    await expect(createSubmittedRequest(userId, "csr-test@chome.cl", baseData({
      ...data,
      items: [{ ...data.items[0]!, quantity: 4 }],
    }), { submissionKey })).rejects.toThrow(/clave de envío|otra solicitud/i)
    expect(createdRequest.replayed).toBe(false)
  })

  it("uses an EPP quantity-driving attribute for both the stock warning and persisted item", async () => {
    vi.stubEnv("AUTH_SECRET", "create-submitted-request-test-secret")
    const submissionKey = "csr-stock-driver-quantity-0001"
    const data = baseData({
      items: [{
        productId: "prod-csr-epp-driver", productNameFree: null, quantity: 1, unitOfMeasure: "unidad",
        urgency: "normal", workerId: null, suggestedSupplierId: null, supplierHint: null,
        notes: null, sortOrder: 0,
        attributes: [{ attributeId: "attr-csr-epp-driver", attributeName: "Número de dosis", value: "3" }],
      }],
    })

    const warning = await createSubmittedRequest(userId, "csr-test@chome.cl", data, { submissionKey })
    expect(warning.kind).toBe("epp-stock-warning")
    if (warning.kind !== "epp-stock-warning") throw new Error("Expected an EPP stock warning")
    expect(warning.items).toEqual([expect.objectContaining({
      productId: "prod-csr-epp-driver", requestedQuantity: 3, availableQuantity: 5, coverage: "total",
    })])

    const request = created(await createSubmittedRequest(userId, "csr-test@chome.cl", data, {
      submissionKey,
      confirmationToken: warning.confirmationToken,
    }))
    const [persistedItem] = await inMemoryDb.select().from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.requestId, request.requestId))
    expect(persistedItem!.quantity).toBe(3)
  })

  it("persists the already-resolved catalog quantity when a later driving rule appears in the same transaction", async () => {
    const data = baseData({
      items: [{
        productId: "prod-csr-epp-snapshot-driver", productNameFree: null, quantity: 1, unitOfMeasure: "unidad",
        urgency: "normal", workerId: null, suggestedSupplierId: null, supplierHint: null,
        notes: null, sortOrder: 0,
        attributes: [{ attributeId: null, attributeName: "Dosis configurada durante envío", value: "3" }],
      }],
    })

    let requestId = ""
    await inMemoryDb.transaction(async (tx) => {
      const resolvedCatalogQuantities = await resolveCatalogItemQuantitiesTx(tx, data.items)
      expect(resolvedCatalogQuantities).toEqual(new Map())

      // Simulates the first quantity driver being configured after the stock
      // snapshot has already been derived and signed. Re-resolving here would
      // turn the user's quantity 1 into the attribute value 3 instead of
      // persisting the snapshot's original quantity.
      await tx.insert(schema.productAttributes).values({
        id: "attr-csr-epp-snapshot-late-driver",
        productId: "prod-csr-epp-snapshot-driver",
        name: "Dosis configurada durante envío",
        type: "integer",
        isRequired: true,
        drivesQuantity: true,
        sortOrder: 1,
      })

      const createdRequest = await createRequest(
        tx,
        data,
        userId,
        "csr-test@chome.cl",
        undefined,
        resolvedCatalogQuantities,
      )
      requestId = createdRequest.requestId
    })

    const [persistedItem] = await inMemoryDb.select().from(schema.purchaseRequestItems)
      .where(eq(schema.purchaseRequestItems.requestId, requestId))
    expect(persistedItem).toMatchObject({
      productId: "prod-csr-epp-snapshot-driver",
      quantity: 1,
    })
  })

  it("rejects a legacy optional quantity driver before warning or request creation", async () => {
    vi.stubEnv("AUTH_SECRET", "create-submitted-request-test-secret")
    const submissionKey = "csr-optional-driver-invalid-0001"
    const data = baseData({
      items: [{
        productId: "prod-csr-epp-optional-driver", productNameFree: null, quantity: 1, unitOfMeasure: "unidad",
        urgency: "normal", workerId: null, suggestedSupplierId: null, supplierHint: null,
        notes: null, sortOrder: 0, attributes: [],
      }],
    })

    await expect(createSubmittedRequest(userId, "csr-test@chome.cl", data, { submissionKey }))
      .rejects.toThrow(/gobierna la cantidad|debe ser obligatorio|catálogo inválido/i)

    const persisted = await inMemoryDb.select().from(schema.purchaseRequests)
      .where(eq(schema.purchaseRequests.submissionKey, submissionKey))
    expect(persisted).toHaveLength(0)
  })
})
