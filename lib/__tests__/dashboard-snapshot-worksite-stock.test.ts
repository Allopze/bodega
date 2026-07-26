import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { nanoid } from "@/lib/id"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite is structurally compatible at runtime; postgres-js differs only in its result HKT.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

const { getWorkQueueSnapshot } = await import("@/lib/services/dashboard-snapshot")

describe("dashboard work snapshot stock scope", () => {
  const now = "2026-07-25T12:00:00.000Z"
  const requesterId = nanoid()
  const worksiteA = nanoid()
  const worksiteB = nanoid()
  const categoryId = nanoid()
  const productId = nanoid()
  const requestA = nanoid()
  const requestB = nanoid()
  const itemA = nanoid()
  const itemB = nanoid()
  const scopedSession = {
    user: {
      id: requesterId,
      name: "Usuario de faena",
      email: "faena@example.com",
      roles: ["solicitante_faena"],
      permissions: ["deliveries:create"],
      worksiteIds: [worksiteA],
      primaryWorksiteId: worksiteA,
      avatarColor: null,
      isActive: true,
      isGlobal: false,
    },
    expires: "2099-01-01T00:00:00.000Z",
  } as Session

  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await inMemoryDb.insert(schema.users).values({
      id: requesterId,
      name: "Usuario de faena",
      email: "faena@example.com",
      hashedPassword: "hash",
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.worksites).values([
      { id: worksiteA, name: "Faena A", code: `FA-${nanoid().slice(0, 8)}`, isActive: true, createdAt: now, updatedAt: now },
      { id: worksiteB, name: "Faena B", code: `FB-${nanoid().slice(0, 8)}`, isActive: true, createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.productCategories).values({ id: categoryId, name: "EPP", slug: `epp-${nanoid()}` })
    await inMemoryDb.insert(schema.products).values({
      id: productId,
      categoryId,
      sku: `CASCO-${nanoid().slice(0, 8)}`,
      name: "Casco",
      unitOfMeasure: "unidad",
      isEpp: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.purchaseRequests).values([
      { id: requestA, code: `SOL-A-${nanoid().slice(0, 8)}`, worksiteId: worksiteA, requesterId, status: "in_purchasing", createdAt: now, updatedAt: now },
      { id: requestB, code: `SOL-B-${nanoid().slice(0, 8)}`, worksiteId: worksiteB, requesterId, status: "in_purchasing", createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.purchaseRequestItems).values([
      { id: itemA, requestId: requestA, productId, quantity: 1, unitOfMeasure: "unidad", status: "received", createdAt: now, updatedAt: now },
      { id: itemB, requestId: requestB, productId, quantity: 1, unitOfMeasure: "unidad", status: "received", createdAt: now, updatedAt: now },
    ])
    // El mismo producto existe sólo en otra faena: no debe habilitar la entrega en A.
    await inMemoryDb.insert(schema.worksiteStock).values({
      id: nanoid(), worksiteId: worksiteB, productId, quantity: 4, minStock: 0, updatedAt: now,
    })
  })

  afterAll(async () => {
    await pg.close()
  })

  it("never treats stock in another worksite as stock for the active request item", async () => {
    const snapshot = await getWorkQueueSnapshot(scopedSession)

    expect(snapshot.items).toHaveLength(1)
    expect(snapshot.items[0]).toMatchObject({ id: itemA, worksiteId: worksiteA, hasStock: false })

    await inMemoryDb.insert(schema.worksiteStock).values({
      id: nanoid(), worksiteId: worksiteA, productId, quantity: 1, minStock: 0, updatedAt: now,
    })

    const withLocalStock = await getWorkQueueSnapshot(scopedSession)
    expect(withLocalStock.items[0]).toMatchObject({ id: itemA, hasStock: true })
  })
})
