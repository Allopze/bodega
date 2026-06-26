import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"

const mockUnlink = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock("node:fs/promises", () => ({
  default: {
    unlink: mockUnlink,
  },
}))

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import { deleteRequest } from "@/lib/services/requests-delete"

describe("requests-delete service", () => {
  beforeEach(async () => {
    vi.clearAllMocks()

    // Clean database
    await inMemoryDb.delete(schema.auditLog)
    await inMemoryDb.delete(schema.purchaseRequests)
    await inMemoryDb.delete(schema.worksites)
    await inMemoryDb.delete(schema.users)

    // Seed base data
    await inMemoryDb.insert(schema.users).values([
      { id: "u-1", email: "user@test.cl", name: "User", hashedPassword: "dummy_hash", isActive: true },
    ])
    await inMemoryDb.insert(schema.worksites).values([
      { id: "ws-1", name: "Faena Test", code: "FT-01", isActive: true },
    ])
  })

  afterAll(async () => {
    const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
    delete testGlobal.__db
    await pg.close()
  })

  it("throws error if request is not found", async () => {
    await expect(deleteRequest("non-existent", "u-1")).rejects.toThrow("Solicitud no encontrada")
  })

  it("throws error if request is in a non-deletable status", async () => {
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: "req-1",
      code: "REQ-0001",
      worksiteId: "ws-1",
      requesterId: "u-1",
      requestType: "repuestos",
      status: "approved", // non-deletable
      urgency: "normal",
      requiredDate: "2026-12-31",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    await expect(deleteRequest("req-1", "u-1")).rejects.toThrow("No se puede eliminar una solicitud en estado 'approved'")
  })

  it("successfully deletes a draft repuestos request and cleans up database and files", async () => {
    // 1. Insert deletable request
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: "req-rep",
      code: "REQ-REP-01",
      worksiteId: "ws-1",
      requesterId: "u-1",
      requestType: "repuestos",
      status: "draft",
      urgency: "high",
      requiredDate: "2026-12-31",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    // 2. Insert dependent request items
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: "item-rep-1",
      requestId: "req-rep",
      productNameFree: "Perno cabeza hexagonal",
      quantity: 10,
      unitOfMeasure: "unidades",
    })

    // 3. Insert approval decisions
    await inMemoryDb.insert(schema.approvalDecisions).values({
      id: "dec-1",
      requestId: "req-rep",
      requestItemId: "item-rep-1",
      type: "approve",
      decidedBy: "u-1",
      decidedAt: new Date().toISOString(),
    })

    // 4. Insert quotations
    await inMemoryDb.insert(schema.repuestoQuotations).values({
      id: "q-rep-1",
      requestId: "req-rep",
      totalAmount: 15000,
      filePath: "storage/repuestos/q-rep-1.pdf",
      fileName: "cot1.pdf",
      uploadedBy: "u-1",
    })

    // 5. Delete request
    await deleteRequest("req-rep", "u-1", { userEmail: "user@test.cl" })

    // Verify DB records are gone
    const reqs = await inMemoryDb.select().from(schema.purchaseRequests).where(eq(schema.purchaseRequests.id, "req-rep"))
    expect(reqs).toHaveLength(0)

    const items = await inMemoryDb.select().from(schema.purchaseRequestItems).where(eq(schema.purchaseRequestItems.id, "item-rep-1"))
    expect(items).toHaveLength(0)

    const decs = await inMemoryDb.select().from(schema.approvalDecisions).where(eq(schema.approvalDecisions.requestId, "req-rep"))
    expect(decs).toHaveLength(0)

    const quots = await inMemoryDb.select().from(schema.repuestoQuotations).where(eq(schema.repuestoQuotations.id, "q-rep-1"))
    expect(quots).toHaveLength(0)

    // Verify filesystem unlink was called (file path contains the mocked storage filename)
    expect(mockUnlink).toHaveBeenCalled()
    const calledPath = mockUnlink.mock.calls[0]![0] as string
    expect(calledPath).toContain("q-rep-1.pdf")
  })

  it("successfully deletes a draft servicios request and cleans up database and files", async () => {
    // 1. Insert deletable request
    await inMemoryDb.insert(schema.purchaseRequests).values({
      id: "req-srv",
      code: "REQ-SRV-01",
      worksiteId: "ws-1",
      requesterId: "u-1",
      requestType: "servicios",
      status: "draft",
      urgency: "normal",
      requiredDate: "2026-12-31",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    // 2. Insert items
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: "item-srv-1",
      requestId: "req-srv",
      productNameFree: "Mantención de bomba hidráulica",
      quantity: 1,
      unitOfMeasure: "servicio",
    })

    // 3. Insert quotations
    await inMemoryDb.insert(schema.serviceQuotations).values({
      id: "q-srv-1",
      requestId: "req-srv",
      totalAmount: 450000,
      filePath: "storage/servicios/q-srv-1.pdf",
      fileName: "cot_srv.pdf",
      uploadedBy: "u-1",
    })

    // 5. Delete request
    await deleteRequest("req-srv", "u-1", { userEmail: "user@test.cl" })

    // Verify DB records are gone
    const reqs = await inMemoryDb.select().from(schema.purchaseRequests).where(eq(schema.purchaseRequests.id, "req-srv"))
    expect(reqs).toHaveLength(0)

    const quots = await inMemoryDb.select().from(schema.serviceQuotations).where(eq(schema.serviceQuotations.id, "q-srv-1"))
    expect(quots).toHaveLength(0)

    // Verify filesystem unlink was called
    expect(mockUnlink).toHaveBeenCalled()
    const calledPath = mockUnlink.mock.calls[0]![0] as string
    expect(calledPath).toContain("q-srv-1.pdf")
  })
})

import { eq } from "drizzle-orm"
