import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import path from "node:path"
import { and, eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import type { Session } from "next-auth"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

vi.mock("@/lib/auth/auth", () => ({ auth: vi.fn() }))

const migrationsFolder = path.resolve(process.cwd(), "db/migrations")
const now = new Date().toISOString()

const session = {
  user: {
    id: "user-count",
    name: "Bodeguero",
    email: "count@test.local",
    permissions: ["warehouse:adjust_stock"],
    roles: ["bodeguero"],
    worksiteIds: ["ws-count"],
    isGlobal: false,
  },
  expires: new Date(Date.now() + 86_400_000).toISOString(),
} as unknown as Session

describe("physical inventory service", () => {
  beforeAll(async () => {
    await migratePGlite(pg, migrationsFolder)

    await inMemoryDb.insert(schema.users).values({
      id: "user-count",
      name: "Bodeguero",
      email: "count@test.local",
      hashedPassword: "x",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.worksites).values([
      {
        id: "ws-count",
        name: "Faena Conteo",
        code: "F-COUNT",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "ws-other-count",
        name: "Faena Fuera Scope",
        code: "F-OTHER-COUNT",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ])
    await inMemoryDb.insert(schema.productCategories).values({
      id: "cat-count",
      name: "Categoria Conteo",
      slug: "cat-count",
      sortOrder: 1,
    })
    await inMemoryDb.insert(schema.products).values([
      {
        id: "prod-count-a",
        sku: "COUNT-A",
        name: "Producto Conteo A",
        categoryId: "cat-count",
        unitOfMeasure: "unidad",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "prod-count-b",
        sku: "COUNT-B",
        name: "Producto Conteo B",
        categoryId: "cat-count",
        unitOfMeasure: "unidad",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "prod-count-zero",
        sku: "COUNT-ZERO",
        name: "Producto Conteo Saldo Cero",
        categoryId: "cat-count",
        unitOfMeasure: "unidad",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ])
    await inMemoryDb.insert(schema.worksiteStock).values([
      {
        id: "stock-count-a",
        worksiteId: "ws-count",
        productId: "prod-count-a",
        quantity: 10,
        minStock: 0,
        updatedAt: now,
      },
      {
        id: "stock-count-b",
        worksiteId: "ws-count",
        productId: "prod-count-b",
        quantity: 3,
        minStock: 0,
        updatedAt: now,
      },
    ])
  })

  afterAll(async () => {
    await pg.close()
  })

  it("closes a count and applies stock adjustments for every difference", async () => {
    const { closePhysicalInventoryCount } = await import("@/lib/services/physical-inventory")

    const result = await closePhysicalInventoryCount(
      session,
      {
        worksiteId: "ws-count",
        notes: "Conteo de cierre mensual",
        items: [
          { productId: "prod-count-a", countedQuantity: 8, notes: "Faltan 2" },
          { productId: "prod-count-b", countedQuantity: 5, notes: "Sobran 2" },
        ],
      },
      ["ws-count"],
    )

    expect(result.code).toMatch(/^CON-/)
    expect(result.adjustmentCount).toBe(2)

    const count = await inMemoryDb.query.physicalInventoryCounts.findFirst({
      where: eq(schema.physicalInventoryCounts.id, result.id),
    })
    expect(count).toMatchObject({
      worksiteId: "ws-count",
      status: "closed",
      countedBy: "user-count",
      closedBy: "user-count",
      notes: "Conteo de cierre mensual",
    })

    const itemA = await inMemoryDb.query.physicalInventoryCountItems.findFirst({
      where: and(
        eq(schema.physicalInventoryCountItems.countId, result.id),
        eq(schema.physicalInventoryCountItems.productId, "prod-count-a"),
      ),
    })
    expect(itemA).toMatchObject({
      expectedQuantity: 10,
      countedQuantity: 8,
      difference: -2,
    })

    const stockA = await inMemoryDb.query.worksiteStock.findFirst({
      where: and(
        eq(schema.worksiteStock.worksiteId, "ws-count"),
        eq(schema.worksiteStock.productId, "prod-count-a"),
      ),
    })
    const stockB = await inMemoryDb.query.worksiteStock.findFirst({
      where: and(
        eq(schema.worksiteStock.worksiteId, "ws-count"),
        eq(schema.worksiteStock.productId, "prod-count-b"),
      ),
    })
    expect(stockA?.quantity).toBe(8)
    expect(stockB?.quantity).toBe(5)
  })

  it("blocks scoped users from closing a count outside their worksite scope", async () => {
    const { closePhysicalInventoryCount } = await import("@/lib/services/physical-inventory")

    await expect(
      closePhysicalInventoryCount(
        session,
        {
          worksiteId: "ws-other-count",
          items: [{ productId: "prod-count-a", countedQuantity: 1 }],
        },
        ["ws-count"],
      ),
    ).rejects.toThrow("No tienes acceso")
  })

  it("uses the locked database balance and creates stock from a zero balance", async () => {
    const { closePhysicalInventoryCount } = await import("@/lib/services/physical-inventory")

    const result = await closePhysicalInventoryCount(
      session,
      {
        worksiteId: "ws-count",
        items: [{ productId: "prod-count-zero", countedQuantity: 4 }],
      },
      ["ws-count"],
    )

    expect(result.adjustmentCount).toBe(1)
    const item = await inMemoryDb.query.physicalInventoryCountItems.findFirst({
      where: and(
        eq(schema.physicalInventoryCountItems.countId, result.id),
        eq(schema.physicalInventoryCountItems.productId, "prod-count-zero"),
      ),
    })
    expect(item).toMatchObject({ expectedQuantity: 0, countedQuantity: 4, difference: 4 })
    const stock = await inMemoryDb.query.worksiteStock.findFirst({
      where: and(
        eq(schema.worksiteStock.worksiteId, "ws-count"),
        eq(schema.worksiteStock.productId, "prod-count-zero"),
      ),
    })
    expect(stock?.quantity).toBe(4)
  })
})
