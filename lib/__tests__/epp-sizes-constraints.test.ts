import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import { and, eq } from "drizzle-orm"
import { nanoid } from "@/lib/id"
import path from "node:path"

const pg = new PGlite()
const db = drizzle(pg, { schema })

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  await pg.close()
})

beforeEach(async () => {
  await db.delete(schema.sizeCatalog)
})

describe("size_catalog", () => {
  it("inserts valid size entries", async () => {
    await db.insert(schema.sizeCatalog).values({
      id: "size-test-m",
      family: "ropa",
      code: "M",
      displayOrder: 2,
    })
    const rows = await db.select().from(schema.sizeCatalog).where(
      and(eq(schema.sizeCatalog.family, "ropa"), eq(schema.sizeCatalog.code, "M")),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe("size-test-m")
  })

  it("rejects duplicate (family, code)", async () => {
    await db.insert(schema.sizeCatalog).values({
      id: "size-a", family: "ropa", code: "M", displayOrder: 0,
    })
    await expect(
      db.insert(schema.sizeCatalog).values({
        id: "size-b", family: "ropa", code: "M", displayOrder: 0,
      }),
    ).rejects.toThrow()
  })
})

describe("request_item_attributes value_length CHECK", () => {
  beforeEach(async () => {
    await db.delete(schema.requestItemAttributes)
    await db.delete(schema.purchaseRequestItems)
    await db.delete(schema.purchaseRequests)
    await db.delete(schema.worksites)
    await db.delete(schema.users)

    await db.insert(schema.users).values({
      id: "u-1", name: "Test", email: "t@t.test", hashedPassword: "x",
    })
    await db.insert(schema.worksites).values({
      id: "ws-1", name: "Faena", code: "FN-TEST",
    })
    await db.insert(schema.purchaseRequests).values({
      id: "pr-1", code: "SOL-TEST", worksiteId: "ws-1", requesterId: "u-1",
    })
    await db.insert(schema.purchaseRequestItems).values({
      id: "pi-1", requestId: "pr-1", quantity: 1,
    })
  })

  it("allows values between 1-64 chars", async () => {
    await db.insert(schema.requestItemAttributes).values({
      id: nanoid(),
      requestItemId: "pi-1",
      attributeName: "Talla",
      value: "M",
    })
    const rows = await db.select().from(schema.requestItemAttributes)
    expect(rows).toHaveLength(1)
  })

  it("rejects empty value", async () => {
    await expect(
      db.insert(schema.requestItemAttributes).values({
        id: nanoid(),
        requestItemId: "pi-1",
        attributeName: "Talla",
        value: "",
      }),
    ).rejects.toThrow()
  })

  it("rejects values longer than 64 chars", async () => {
    await expect(
      db.insert(schema.requestItemAttributes).values({
        id: nanoid(),
        requestItemId: "pi-1",
        attributeName: "Talla",
        value: "A".repeat(65),
      }),
    ).rejects.toThrow()
  })
})

describe("request_item_attributes unique (requestItemId, attributeName)", () => {
  beforeEach(async () => {
    await db.delete(schema.requestItemAttributes)
    await db.delete(schema.purchaseRequestItems)
    await db.delete(schema.purchaseRequests)
    await db.delete(schema.worksites)
    await db.delete(schema.users)

    await db.insert(schema.users).values({
      id: "u-1", name: "Test", email: "t@t.test", hashedPassword: "x",
    })
    await db.insert(schema.worksites).values({
      id: "ws-1", name: "Faena", code: "FN-TEST",
    })
    await db.insert(schema.purchaseRequests).values({
      id: "pr-1", code: "SOL-UQ", worksiteId: "ws-1", requesterId: "u-1",
    })
    await db.insert(schema.purchaseRequestItems).values({
      id: "pi-1", requestId: "pr-1", quantity: 1,
    })
  })

  it("rejects duplicate attribute name for the same item", async () => {
    await db.insert(schema.requestItemAttributes).values({
      id: nanoid(), requestItemId: "pi-1", attributeName: "Talla", value: "M",
    })
    await expect(
      db.insert(schema.requestItemAttributes).values({
        id: nanoid(), requestItemId: "pi-1", attributeName: "Talla", value: "L",
      }),
    ).rejects.toThrow()
  })

  it("allows same attribute name on different items", async () => {
    await db.insert(schema.purchaseRequestItems).values({
      id: "pi-2", requestId: "pr-1", quantity: 2,
    })
    await db.insert(schema.requestItemAttributes).values({
      id: nanoid(), requestItemId: "pi-1", attributeName: "Talla", value: "M",
    })
    await db.insert(schema.requestItemAttributes).values({
      id: nanoid(), requestItemId: "pi-2", attributeName: "Talla", value: "L",
    })
    const rows = await db.select().from(schema.requestItemAttributes)
    expect(rows).toHaveLength(2)
  })
})
