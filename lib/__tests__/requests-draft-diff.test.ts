/**
 * Integration tests for lib/services/requests-draft.ts.
 *
 * Audit A-01/A-08: these tests guard the diff-based persist so the
 * regression "editing a draft wipes approved items" cannot return.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite is structurally compatible at runtime; postgres-js type differs only in result-type HKT
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  await pg.close()
})

beforeEach(async () => {
  // Truncate all rows between tests for isolation. Order matters:
  // delete children before parents because most FKs are NOT cascade.
  await inMemoryDb.delete(schema.statusHistory)
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.approvalDecisions)
  await inMemoryDb.delete(schema.requestItemAttributes)
  await inMemoryDb.delete(schema.purchaseRequestItems)
  await inMemoryDb.delete(schema.purchaseRequests)
  await inMemoryDb.delete(schema.worksiteStock)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)
  await inMemoryDb.delete(schema.codeSequences)
})

const USER_ID = "user-1"
const WS_ID   = "ws-1"

async function seedWorld() {
  await inMemoryDb.insert(schema.users).values([
    { id: USER_ID, name: "U", email: "u@example.test", hashedPassword: "x" },
    { id: "approver-1", name: "Approver", email: "a@example.test", hashedPassword: "x" },
  ])
  await inMemoryDb.insert(schema.worksites).values({
    id: WS_ID, name: "Faena A", code: "FA", isActive: true,
  })
}

async function createRequest() {
  // Use the same import the action does so we exercise the real path.
  const { persistRequestWithDiff } = await import("@/lib/services/requests-draft")

  return await persistRequestWithDiff(
    USER_ID, "u@example.test",
    {
      worksiteId: WS_ID,
      requestType: "epp",
      urgency: "normal",
      requiredDate: "2026-07-01",
      notes: "",
      items: [
        {
          productId: null,
          productNameFree: "Casco 3M",
          quantity: 2,
          unitOfMeasure: "unidad",
          urgency: "normal",
          requiredDate: "2026-07-01",
          workerId: null,
          suggestedSupplierId: null,
          supplierHint: "",
          sortOrder: 0,
          notes: "",
          attributes: [],
        },
      ],
    },
    /* isEdit */ false,
    /* actorCanEditAnyRequest */ false,
  )
}

describe("persistRequestWithDiff (A-01/A-08)", () => {
  it("creates a new request with a generated code and item", async () => {
    await seedWorld()
    const r = await createRequest()
    expect(r.isNew).toBe(true)
    expect(r.requestId).toBeTruthy()

    const request = await inMemoryDb.query.purchaseRequests.findFirst({
      where: eq(schema.purchaseRequests.id, r.requestId),
      with: { items: true },
    })
    expect(request?.status).toBe("draft")
    expect(request?.code).toBe("SOL-0001")
    expect(request?.items).toHaveLength(1)
  })

  it("preserves the original item ID when the client resends it (A-01)", async () => {
    await seedWorld()
    const r = await createRequest()
    const originalItem = (await inMemoryDb.query.purchaseRequestItems.findFirst())!
    expect(originalItem.id).toBeTruthy()

    // Edit: resend the SAME item id with an updated quantity.
    const { persistRequestWithDiff } = await import("@/lib/services/requests-draft")
    await persistRequestWithDiff(
      USER_ID, undefined,
      {
        id: r.requestId,
        worksiteId: WS_ID,
        requestType: "epp",
        urgency: "normal",
        requiredDate: "2026-07-01",
        notes: "",
        items: [
          {
            id: originalItem.id,                // SAME ID
            productId: null,
            productNameFree: null,
            quantity: 5,                        // CHANGED
            unitOfMeasure: "unidad",
            urgency: "normal",
            requiredDate: "2026-07-01",
            workerId: null,
            suggestedSupplierId: null,
            supplierHint: "",
            sortOrder: 0,
            notes: "updated",
            attributes: [],
          },
        ],
      },
      true, false,
    )

    // Same id, updated quantity, no duplicate rows.
    const items = await inMemoryDb.query.purchaseRequestItems.findMany()
    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe(originalItem.id)
    expect(items[0]?.quantity).toBe(5)
    expect(items[0]?.notes).toBe("updated")
  })

  it("preserves approval_decisions when an item is updated, not deleted (A-08)", async () => {
    await seedWorld()
    const r = await createRequest()
    const item = (await inMemoryDb.query.purchaseRequestItems.findFirst())!

    // Approver modifies the quantity — leaves a decision trail.
    await inMemoryDb.insert(schema.approvalDecisions).values({
      id: "dec-1",
      requestItemId: item.id,
      requestId: r.requestId,
      type: "modify",
      decidedBy: "approver-1",
      modifiedQty: 4,
    })

    // Edit resends the same id, just changing notes.
    const { persistRequestWithDiff } = await import("@/lib/services/requests-draft")
    await persistRequestWithDiff(
      USER_ID, undefined,
      {
        id: r.requestId,
        worksiteId: WS_ID,
        requestType: "epp",
        urgency: "normal",
        requiredDate: "2026-07-01",
        notes: "",
        items: [{
          id: item.id,
          productId: null,
          productNameFree: null,
          quantity: 4,
          unitOfMeasure: "unidad",
          urgency: "normal",
          requiredDate: "2026-07-01",
          workerId: null,
          suggestedSupplierId: null,
          supplierHint: "",
          sortOrder: 0,
          notes: "post-approval edit",
          attributes: [],
        }],
      },
      true, false,
    )

    const decisions = await inMemoryDb.query.approvalDecisions.findMany({
      where: eq(schema.approvalDecisions.requestItemId, item.id),
    })
    expect(decisions).toHaveLength(1)
    expect(decisions[0]?.modifiedQty).toBe(4)
  })

  it("deletes only the items the client removed, preserving approvals on kept items", async () => {
    await seedWorld()
    const r = await createRequest()

    // The createRequest above generates the item id with nanoid. Capture it.
    const firstItemId = (await inMemoryDb.query.purchaseRequestItems.findFirst())!.id

    // Add a second item manually.
    const secondItemId = "item-extra"
    await inMemoryDb.insert(schema.purchaseRequestItems).values({
      id: secondItemId,
      requestId: r.requestId,
      quantity: 1,
      unitOfMeasure: "unidad",
      status: "draft",
      sortOrder: 1,
      productNameFree: "extra",
    })

    // Approver logs decisions on both items.
    await inMemoryDb.insert(schema.approvalDecisions).values([
      { id: "d-1", requestItemId: firstItemId, requestId: r.requestId, type: "approve", decidedBy: "approver-1" },
      { id: "d-2", requestItemId: secondItemId,   requestId: r.requestId, type: "approve", decidedBy: "approver-1" },
    ])

    // Edit: keep first item, drop the second one.
    const { persistRequestWithDiff } = await import("@/lib/services/requests-draft")
    await persistRequestWithDiff(
      USER_ID, undefined,
      {
        id: r.requestId,
        worksiteId: WS_ID,
        requestType: "epp",
        urgency: "normal",
        requiredDate: "2026-07-01",
        notes: "",
        items: [{
          id: firstItemId,
          productId: null,
          productNameFree: null,
          quantity: 2,
          unitOfMeasure: "unidad",
          urgency: "normal",
          requiredDate: "2026-07-01",
          workerId: null,
          suggestedSupplierId: null,
          supplierHint: "",
          sortOrder: 0,
          notes: "",
          attributes: [],
        }],
      },
      true, false,
    )

    const remainingItems = await inMemoryDb.query.purchaseRequestItems.findMany({
      where: eq(schema.purchaseRequestItems.requestId, r.requestId),
    })
    expect(remainingItems.map((i) => i.id)).toEqual([firstItemId])

    // Decision on kept item survives; decision on deleted item is gone.
    const survivingDecisions = await inMemoryDb.query.approvalDecisions.findMany()
    expect(survivingDecisions).toHaveLength(1)
    expect(survivingDecisions[0]?.id).toBe("d-1")
  })

  it("inserts new items alongside existing ones", async () => {
    await seedWorld()
    const r = await createRequest()
    const firstItemId = (await inMemoryDb.query.purchaseRequestItems.findFirst())!.id

    const { persistRequestWithDiff } = await import("@/lib/services/requests-draft")
    await persistRequestWithDiff(
      USER_ID, undefined,
      {
        id: r.requestId,
        worksiteId: WS_ID,
        requestType: "epp",
        urgency: "normal",
        requiredDate: "2026-07-01",
        notes: "",
        items: [
          {
            id: firstItemId,
            productId: null,
            productNameFree: null,
            quantity: 2,
            unitOfMeasure: "unidad",
            urgency: "normal",
            requiredDate: "2026-07-01",
            workerId: null,
            suggestedSupplierId: null,
            supplierHint: "",
            sortOrder: 0,
            notes: "",
            attributes: [],
          },
          {
            // new item, no id
            productId: null,
            productNameFree: "Casco extra",
            quantity: 3,
            unitOfMeasure: "unidad",
            urgency: "normal",
            requiredDate: "2026-07-01",
            workerId: null,
            suggestedSupplierId: null,
            supplierHint: "",
            sortOrder: 1,
            notes: "",
            attributes: [],
          },
        ],
      },
      true, false,
    )

    const items = await inMemoryDb.query.purchaseRequestItems.findMany({
      where: eq(schema.purchaseRequestItems.requestId, r.requestId),
      orderBy: (i, { asc }) => [asc(i.sortOrder)],
    })
    expect(items).toHaveLength(2)
    expect(items[0]?.id).toBe(firstItemId)
    expect(items[1]?.productNameFree).toBe("Casco extra")
    expect(items[1]?.status).toBe("draft")
  })
})
