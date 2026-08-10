/**
 * Concurrency test for deliveries service.
 *
 * Validates that two concurrent registerWorkerEppDelivery calls against the
 * same request item are serialized by SELECT ... FOR UPDATE, so only one
 * succeeds when the combined quantity exceeds the pending amount.
 *
 * Requires a real PostgreSQL database (same pattern as stock-concurrency-postgres.test.ts).
 * Gate: DELIVERIES_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET=true
 */
import path from "node:path"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { eq, and, sql } from "drizzle-orm"
import * as schema from "@/db/schema"
import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  quotePostgresIdentifier,
} from "@/lib/testing/destructive-database-guard"

const databaseUrl = process.env.DELIVERIES_CONCURRENCY_DATABASE_URL ?? process.env.DATABASE_URL
const canResetDatabase = process.env.DELIVERIES_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canResetDatabase ? describe : describe.skip

let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined

describeIf("delivery concurrency on real Postgres", () => {
  beforeAll(async () => {
    assertSafeDestructiveDatabase({
      databaseUrl: databaseUrl!,
      allowDestructiveReset: canResetDatabase,
      context: "DELIVERIES_CONCURRENCY",
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

  it("allows only one concurrent worker EPP delivery when combined quantity exceeds pending", async () => {
    const db = getTestDb()
    await seedDeliveryFixture(db)

    const { registerWorkerEppDelivery } = await import("@/lib/services/deliveries")

    const deliveryInput = {
      worksiteId: "ws-dc-test",
      workerId: "worker-dc-test",
      requestItemId: "pri-dc-test",
      quantity: 8,
      deliveredBy: "user-dc-test",
      userEmail: "delivery-concurrency@test.local",
    }

    const results = await Promise.allSettled([
      registerWorkerEppDelivery({ ...deliveryInput }),
      registerWorkerEppDelivery({ ...deliveryInput }),
    ])

    const fulfilled = results.filter((r) => r.status === "fulfilled")
    const rejected = results.filter((r) => r.status === "rejected")

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    // Total delivered should be exactly 8 (not 16)
    const deliveryRows = await db
      .select({ quantity: schema.deliveryItems.quantity })
      .from(schema.deliveryItems)
      .where(eq(schema.deliveryItems.requestItemId, "pri-dc-test"))
    const totalDelivered = deliveryRows.reduce((sum, row) => sum + row.quantity, 0)
    expect(totalDelivered).toBe(8)

    // Only 1 delivery should exist
    const deliveries = await db
      .select()
      .from(schema.deliveries)
      .where(eq(schema.deliveries.worksiteId, "ws-dc-test"))
    expect(deliveries).toHaveLength(1)

    // Stock should be decremented by exactly 8
    const [stock] = await db
      .select({ quantity: schema.worksiteStock.quantity })
      .from(schema.worksiteStock)
      .where(and(
        eq(schema.worksiteStock.worksiteId, "ws-dc-test"),
        eq(schema.worksiteStock.productId, "prod-dc-test"),
      ))
    expect(stock!.quantity).toBe(2) // 10 - 8 = 2
  })
})

function getTestDb() {
  if (!testDb) throw new Error("Postgres test DB was not initialized")
  return testDb
}

async function seedDeliveryFixture(db: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date().toISOString()

  await db.insert(schema.users).values({
    id: "user-dc-test",
    name: "Delivery Concurrency",
    email: "delivery-concurrency@test.local",
    hashedPassword: "hash",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.worksites).values({
    id: "ws-dc-test",
    name: "Faena concurrencia entregas",
    code: "DC-TEST",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.workers).values({
    id: "worker-dc-test",
    firstName: "Juan",
    lastName: "Pérez",
    worksiteId: "ws-dc-test",
    isActive: true,
  })
  await db.insert(schema.productCategories).values({
    id: "cat-dc-test",
    name: "Categoría concurrencia entregas",
    slug: "cat-dc-test",
    isEpp: true,
  })
  await db.insert(schema.products).values({
    id: "prod-dc-test",
    sku: "DC-TEST",
    name: "Producto concurrencia entregas",
    categoryId: "cat-dc-test",
    unitOfMeasure: "unidad",
    isEpp: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.suppliers).values({
    id: "supplier-dc-test",
    name: "Proveedor concurrencia entregas",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseRequests).values({
    id: "pr-dc-test",
    code: "SOL-DC-TEST",
    worksiteId: "ws-dc-test",
    requesterId: "user-dc-test",
    status: "approved",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseRequestItems).values({
    id: "pri-dc-test",
    requestId: "pr-dc-test",
    productId: "prod-dc-test",
    quantity: 10,
    status: "received",
    unitOfMeasure: "unidad",
  })
  await db.insert(schema.worksiteStock).values({
    id: "stock-dc-test",
    worksiteId: "ws-dc-test",
    productId: "prod-dc-test",
    quantity: 10,
    minStock: 0,
    updatedAt: now,
  })
  await db.insert(schema.purchaseOrders).values({
    id: "po-dc-test",
    code: "OC-DC-TEST",
    worksiteId: "ws-dc-test",
    supplierId: "supplier-dc-test",
    createdBy: "user-dc-test",
    status: "received",
    deliveryMode: "directo_faena",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseOrderItems).values({
    id: "poi-dc-test",
    purchaseOrderId: "po-dc-test",
    requestItemId: "pri-dc-test",
    productId: "prod-dc-test",
    quantity: 10,
    unitOfMeasure: "unidad",
    quantityReceived: 10,
    status: "issued",
  })
  await db.insert(schema.receipts).values({
    id: "receipt-dc-test",
    code: "REC-DC-TEST",
    purchaseOrderId: "po-dc-test",
    receivedBy: "user-dc-test",
    receivedAt: now,
    locationType: "faena",
    worksiteId: "ws-dc-test",
    status: "closed",
    createdAt: now,
  })
  await db.insert(schema.receiptItems).values({
    id: "receipt-item-dc-test",
    receiptId: "receipt-dc-test",
    purchaseOrderItemId: "poi-dc-test",
    quantityReceived: 10,
    status: "received",
  })
}

async function resetPublicSchema(url: string) {
  const setupClient = postgres(url, { max: 1 })
  const setupDb = drizzle(setupClient)
  try {
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`)
    await setupDb.execute(sql`CREATE SCHEMA public`)
    await setupDb.execute(sql`CREATE SCHEMA drizzle`)
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
