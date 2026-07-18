import path from "node:path"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { eq, sql } from "drizzle-orm"
import * as schema from "@/db/schema"
import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  quotePostgresIdentifier,
} from "@/lib/testing/destructive-database-guard"

const databaseUrl = process.env.STOCK_CONCURRENCY_DATABASE_URL ?? process.env.DATABASE_URL
const canResetDatabase = process.env.STOCK_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canResetDatabase ? describe : describe.skip

let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined

describeIf("stock movement concurrency on real Postgres", () => {
  beforeAll(async () => {
    assertSafeDestructiveDatabase({
      databaseUrl: databaseUrl!,
      allowDestructiveReset: canResetDatabase,
      context: "STOCK_CONCURRENCY",
    })
    await ensureDatabaseExists(databaseUrl!)
    await resetPublicSchema(databaseUrl!)

    const migrationClient = postgres(databaseUrl!, { max: 1 })
    await migrate(drizzle(migrationClient), {
      migrationsFolder: path.resolve(process.cwd(), "db/migrations"),
    })
    await migrationClient.end()

    client = postgres(databaseUrl!, { max: 10 })
    testDb = drizzle(client, { schema })

    const globalWithDb = globalThis as typeof globalThis & {
      __db?: ReturnType<typeof drizzle<typeof schema>>
    }
    globalWithDb.__db = undefined
    process.env.DATABASE_URL = databaseUrl
    vi.resetModules()
  })

  afterAll(async () => {
    const globalWithDb = globalThis as typeof globalThis & { __db?: unknown }
    globalWithDb.__db = undefined
    await client?.end()
  })

  it("allows only one concurrent outbound movement when combined quantity exceeds available stock", async () => {
    const db = getTestDb()
    await seedStockFixture(db)

    const { applyMovement } = await import("@/lib/services/stock")
    const movement = {
      worksiteId: "ws-stock-concurrency",
      productId: "prod-stock-concurrency",
      type: "egreso_entrega" as const,
      quantity: -4,
      performedBy: "user-stock-concurrency",
      userEmail: "stock-concurrency@test.local",
      reason: "Prueba de carrera de stock",
    }

    const results = await Promise.allSettled([
      applyMovement(movement),
      applyMovement(movement),
    ])

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)

    const stock = await db.query.worksiteStock.findFirst({
      where: eq(schema.worksiteStock.id, "stock-concurrency-row"),
    })
    expect(stock?.quantity).toBe(1)

    const movementRows = await db
      .select()
      .from(schema.inventoryMovements)
      .where(eq(schema.inventoryMovements.worksiteId, "ws-stock-concurrency"))
    expect(movementRows).toHaveLength(1)
    expect(movementRows[0]!.stockBefore).toBe(5)
    expect(movementRows[0]!.stockAfter).toBe(1)
  })

  it("serializes concurrent waste movements through the same stock row", async () => {
    const db = getTestDb()
    await db.delete(schema.inventoryMovements).where(eq(schema.inventoryMovements.worksiteId, "ws-stock-concurrency"))
    await db
      .update(schema.worksiteStock)
      .set({ quantity: 5, updatedAt: new Date().toISOString() })
      .where(eq(schema.worksiteStock.id, "stock-concurrency-row"))

    const { applyMovement } = await import("@/lib/services/stock")
    const movement = {
      worksiteId: "ws-stock-concurrency",
      productId: "prod-stock-concurrency",
      type: "egreso_desecho" as const,
      quantity: 4,
      performedBy: "user-stock-concurrency",
      userEmail: "stock-concurrency@test.local",
      reason: "Prueba de carrera de desecho",
    }

    const results = await Promise.allSettled([
      applyMovement(movement),
      applyMovement(movement),
    ])

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(0)

    const stock = await db.query.worksiteStock.findFirst({
      where: eq(schema.worksiteStock.id, "stock-concurrency-row"),
    })
    expect(stock?.quantity).toBe(0)

    const movementRows = await db
      .select()
      .from(schema.inventoryMovements)
      .where(eq(schema.inventoryMovements.worksiteId, "ws-stock-concurrency"))
    expect(movementRows).toHaveLength(2)
    expect(movementRows.every((row) => row.type === "egreso_desecho")).toBe(true)
    expect(movementRows.map((row) => row.quantity).sort((a, b) => a - b)).toEqual([-4, -1])
  })
})

function getTestDb() {
  if (!testDb) throw new Error("Postgres test DB was not initialized")
  return testDb
}

async function seedStockFixture(db: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date().toISOString()

  await db.insert(schema.users).values({
    id: "user-stock-concurrency",
    name: "Stock Concurrency",
    email: "stock-concurrency@test.local",
    hashedPassword: "hash",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.worksites).values({
    id: "ws-stock-concurrency",
    name: "Faena concurrencia stock",
    code: "STOCK-CONCURRENCY",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.productCategories).values({
    id: "cat-stock-concurrency",
    name: "Categoría concurrencia",
    slug: "cat-stock-concurrency",
  })
  await db.insert(schema.products).values({
    id: "prod-stock-concurrency",
    sku: "STOCK-CONCURRENCY",
    name: "Producto concurrencia",
    categoryId: "cat-stock-concurrency",
    unitOfMeasure: "unidad",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.worksiteStock).values({
    id: "stock-concurrency-row",
    worksiteId: "ws-stock-concurrency",
    productId: "prod-stock-concurrency",
    quantity: 5,
    minStock: 0,
    updatedAt: now,
  })
}

async function resetPublicSchema(url: string) {
  const setupClient = postgres(url, { max: 1 })
  const setupDb = drizzle(setupClient)
  try {
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`)
    await setupDb.execute(sql`CREATE SCHEMA public`)
    await setupDb.execute(sql`GRANT ALL ON SCHEMA public TO PUBLIC`)
  } finally {
    await setupClient.end()
  }
}

async function ensureDatabaseExists(url: string) {
  const databaseName = getDatabaseNameFromUrl(url)
  const maintenanceClient = postgres(getMaintenanceDatabaseUrl(url), { max: 1 })
  try {
    const rows = await maintenanceClient<{ exists: number }[]>`
      SELECT 1 AS exists FROM pg_database WHERE datname = ${databaseName} LIMIT 1
    `
    if (rows.length === 0) {
      await maintenanceClient.unsafe(`CREATE DATABASE ${quotePostgresIdentifier(databaseName)}`)
    }
  } finally {
    await maintenanceClient.end()
  }
}
