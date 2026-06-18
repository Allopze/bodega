/**
 * Concurrency test for receiving service.
 *
 * Validates that two concurrent registerReceipt calls against the same
 * purchase order item are serialized by SELECT ... FOR UPDATE, so only
 * one succeeds when the combined quantity exceeds the pending amount.
 *
 * Requires a real PostgreSQL database (same pattern as stock-concurrency-postgres.test.ts).
 * Gate: RECEIVING_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET=true
 */
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

const databaseUrl = process.env.RECEIVING_CONCURRENCY_DATABASE_URL ?? process.env.DATABASE_URL
const canResetDatabase = process.env.RECEIVING_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canResetDatabase ? describe : describe.skip

let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined

describeIf("receiving concurrency on real Postgres", () => {
  beforeAll(async () => {
    assertSafeDestructiveDatabase({
      databaseUrl: databaseUrl!,
      allowDestructiveReset: canResetDatabase,
      context: "RECEIVING_CONCURRENCY",
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

  it("allows only one concurrent receipt when combined quantity exceeds pending", async () => {
    const db = getTestDb()
    await seedReceivingFixture(db)

    const { registerReceipt } = await import("@/lib/services/receiving")

    const receiptInput = {
      purchaseOrderId: "po-rc-test",
      receivedBy: "user-rc-test",
      userEmail: "receiving-concurrency@test.local",
      stage: "office" as const,
      worksiteId: "ws-rc-test",
      items: [
        {
          purchaseOrderItemId: "poi-rc-test",
          quantityReceived: 8,
        },
      ],
    }

    const results = await Promise.allSettled([
      registerReceipt({ ...receiptInput }),
      registerReceipt({ ...receiptInput }),
    ])

    const fulfilled = results.filter((r) => r.status === "fulfilled")
    const rejected = results.filter((r) => r.status === "rejected")

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    // The item should have exactly 8 received (not 16)
    const [poi] = await db
      .select({
        quantityOfficeReceived: schema.purchaseOrderItems.quantityOfficeReceived,
      })
      .from(schema.purchaseOrderItems)
      .where(eq(schema.purchaseOrderItems.id, "poi-rc-test"))

    expect(poi!.quantityOfficeReceived).toBe(8)

    // Only 1 receipt should exist
    const receiptRows = await db
      .select()
      .from(schema.receipts)
      .where(eq(schema.receipts.purchaseOrderId, "po-rc-test"))
    expect(receiptRows).toHaveLength(1)
  })
})

function getTestDb() {
  if (!testDb) throw new Error("Postgres test DB was not initialized")
  return testDb
}

async function seedReceivingFixture(db: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date().toISOString()

  await db.insert(schema.users).values({
    id: "user-rc-test",
    name: "Receiving Concurrency",
    email: "receiving-concurrency@test.local",
    hashedPassword: "hash",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.worksites).values({
    id: "ws-rc-test",
    name: "Faena concurrencia recepción",
    code: "RC-TEST",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.suppliers).values({
    id: "sup-rc-test",
    name: "Proveedor concurrencia recepción",
  })
  await db.insert(schema.productCategories).values({
    id: "cat-rc-test",
    name: "Categoría concurrencia recepción",
    slug: "cat-rc-test",
  })
  await db.insert(schema.products).values({
    id: "prod-rc-test",
    sku: "RC-TEST",
    name: "Producto concurrencia recepción",
    categoryId: "cat-rc-test",
    unitOfMeasure: "unidad",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseRequests).values({
    id: "pr-rc-test",
    code: "SOL-RC-TEST",
    worksiteId: "ws-rc-test",
    requesterId: "user-rc-test",
    status: "approved",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseRequestItems).values({
    id: "pri-rc-test",
    requestId: "pr-rc-test",
    productId: "prod-rc-test",
    quantity: 10,
    status: "in_purchase_order",
    unitOfMeasure: "unidad",
  })
  await db.insert(schema.purchaseOrders).values({
    id: "po-rc-test",
    code: "OC-RC-TEST",
    worksiteId: "ws-rc-test",
    supplierId: "sup-rc-test",
    createdBy: "user-rc-test",
    status: "sent",
    sentAt: now,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseOrderItems).values({
    id: "poi-rc-test",
    purchaseOrderId: "po-rc-test",
    requestItemId: "pri-rc-test",
    productId: "prod-rc-test",
    quantity: 10,
    quantityOfficeReceived: 0,
    quantityReceived: 0,
    status: "issued",
    unitOfMeasure: "unidad",
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
