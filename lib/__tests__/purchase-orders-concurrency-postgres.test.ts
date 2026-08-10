/**
 * Concurrency tests for the purchase-order lifecycle.
 *
 * These scenarios require PostgreSQL because the invariant depends on the
 * same SELECT ... FOR UPDATE rows being serialized by the final database
 * engine. PGlite covers the lifecycle rules separately, but not that lock.
 *
 * Gate: PURCHASE_ORDERS_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET=true
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

const databaseUrl = process.env.PURCHASE_ORDERS_CONCURRENCY_DATABASE_URL ?? process.env.DATABASE_URL
const canResetDatabase = process.env.PURCHASE_ORDERS_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canResetDatabase ? describe : describe.skip
const originalDatabaseUrl = process.env.DATABASE_URL

let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined

describeIf("purchase-order lifecycle concurrency on real Postgres", () => {
  beforeAll(async () => {
    assertSafeDestructiveDatabase({
      databaseUrl: databaseUrl!,
      allowDestructiveReset: canResetDatabase,
      context: "PURCHASE_ORDERS_CONCURRENCY",
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
    await seedSharedFixture(getTestDb())
    // El hook reconstruye el esquema y aplica las ~150 migraciones sobre TCP: el
    // `hookTimeout` global de 30 s no alcanza fuera de un runner con la base al
    // lado, y el fallo se leía como "Hook timed out", no como "es lento".
  }, 300_000)

  afterAll(async () => {
    const globalWithDb = globalThis as typeof globalThis & { __db?: unknown }
    globalWithDb.__db = undefined
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = originalDatabaseUrl
    await client?.end()
  })

  it("never leaves an item pending while a concurrent replacement order remains active after cancellation", async () => {
    const fixture = await seedOrderFixture(getTestDb(), "cancel")
    const [{ createOrder }, { cancelOrder }] = await Promise.all([
      import("@/lib/services/purchasing-module/purchase-orders-create"),
      import("@/lib/services/purchasing-module/purchase-orders-status"),
    ])

    const results = await Promise.allSettled([
      createOrder(createOrderInput(fixture.requestItemId)),
      cancelOrder(fixture.orderId, "user-oc-concurrency", "Prueba de carrera controlada"),
    ])

    await expectCoverageInvariant({
      db: getTestDb(),
      requestItemId: fixture.requestItemId,
      results,
    })
  })

  it("two simultaneous orders over the same approved item produce exactly one", async () => {
    // Dos compradores viendo la misma fila de la cola de Compras y pulsando
    // "Generar OC" a la vez. El lock de `createOrdersBySupplier` y la
    // re-verificación de cobertura bajo ese lock tienen que dejar UNA sola OC
    // activa: dos dejarían el ítem comprado el doble sin que nada lo señale.
    const fixture = await seedPendingItemFixture(getTestDb(), "double-create")
    const { createOrder } = await import("@/lib/services/purchasing-module/purchase-orders-create")

    const results = await Promise.allSettled([
      createOrder(createOrderInput(fixture.requestItemId)),
      createOrder(createOrderInput(fixture.requestItemId)),
    ])

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
    await expectCoverageInvariant({
      db: getTestDb(),
      requestItemId: fixture.requestItemId,
      results,
    })
    const activeLines = await getTestDb()
      .select({ id: schema.purchaseOrderItems.id })
      .from(schema.purchaseOrderItems)
      .innerJoin(schema.purchaseOrders, eq(schema.purchaseOrderItems.purchaseOrderId, schema.purchaseOrders.id))
      .where(eq(schema.purchaseOrderItems.requestItemId, fixture.requestItemId))
    expect(activeLines).toHaveLength(1)
  })

  it("never leaves an item pending while a concurrent replacement order remains active after deletion", async () => {
    const fixture = await seedOrderFixture(getTestDb(), "delete")
    const [{ createOrder }, { deleteOrder }] = await Promise.all([
      import("@/lib/services/purchasing-module/purchase-orders-create"),
      import("@/lib/services/purchasing-module/purchase-orders-delete"),
    ])

    const results = await Promise.allSettled([
      createOrder(createOrderInput(fixture.requestItemId)),
      deleteOrder(fixture.orderId, "user-oc-concurrency"),
    ])

    await expectCoverageInvariant({
      db: getTestDb(),
      requestItemId: fixture.requestItemId,
      results,
    })
  })
})

function getTestDb() {
  if (!testDb) throw new Error("Postgres test DB was not initialized")
  return testDb
}

function createOrderInput(requestItemId: string) {
  return {
    worksiteId: "ws-oc-concurrency",
    supplierId: "sup-oc-concurrency",
    createdBy: "user-oc-concurrency",
    userEmail: "purchase-order-concurrency@test.local",
    items: [{
      requestItemId,
      productId: "prod-oc-concurrency",
      productNameFree: null,
      quantity: 10,
      unitOfMeasure: "unidad",
      unitPrice: 1_000,
      subtotal: 1_000,
    }],
  }
}

async function expectCoverageInvariant({
  db,
  requestItemId,
  results,
}: {
  db: ReturnType<typeof drizzle<typeof schema>>
  requestItemId: string
  results: PromiseSettledResult<unknown>[]
}) {
  // A legitimate interleaving either creates the replacement after the
  // lifecycle mutation, or rejects creation while the original coverage is
  // still locked. Neither branch may expose inconsistent final coverage.
  expect(results.some((result) => result.status === "fulfilled")).toBe(true)

  const [requestItem] = await db
    .select({ quantity: schema.purchaseRequestItems.quantity, status: schema.purchaseRequestItems.status })
    .from(schema.purchaseRequestItems)
    .where(eq(schema.purchaseRequestItems.id, requestItemId))

  const lines = await db
    .select({
      quantity: schema.purchaseOrderItems.quantity,
      orderStatus: schema.purchaseOrders.status,
      orderItemStatus: schema.purchaseOrderItems.status,
      deletedAt: schema.purchaseOrders.deletedAt,
    })
    .from(schema.purchaseOrderItems)
    .innerJoin(schema.purchaseOrders, eq(schema.purchaseOrderItems.purchaseOrderId, schema.purchaseOrders.id))
    .where(eq(schema.purchaseOrderItems.requestItemId, requestItemId))

  const activeCoverage = lines
    .filter((line) => line.orderStatus !== "cancelled" && line.orderItemStatus !== "cancelled" && !line.deletedAt)
    .reduce((total, line) => total + line.quantity, 0)

  expect(activeCoverage).toBeLessThanOrEqual(requestItem!.quantity)
  if (activeCoverage > 0) {
    expect(requestItem!.status).toBe("in_purchase_order")
  } else {
    expect(requestItem!.status).toBe("pending_purchase")
  }
}

async function seedSharedFixture(db: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date().toISOString()
  await db.insert(schema.users).values({
    id: "user-oc-concurrency",
    name: "Purchase order concurrency",
    email: "purchase-order-concurrency@test.local",
    hashedPassword: "hash",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.worksites).values({
    id: "ws-oc-concurrency",
    name: "Faena concurrencia OC",
    code: "OC-CONC",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.suppliers).values({
    id: "sup-oc-concurrency",
    name: "Proveedor concurrencia OC",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.productCategories).values({
    id: "cat-oc-concurrency",
    name: "Categoría concurrencia OC",
    slug: "cat-oc-concurrency",
  })
  await db.insert(schema.products).values({
    id: "prod-oc-concurrency",
    sku: "OC-CONC-001",
    name: "Producto concurrencia OC",
    categoryId: "cat-oc-concurrency",
    unitOfMeasure: "unidad",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
}

async function seedOrderFixture(
  db: ReturnType<typeof drizzle<typeof schema>>,
  scenario: "cancel" | "delete",
) {
  const now = new Date().toISOString()
  const requestId = `pr-oc-concurrency-${scenario}`
  const requestItemId = `pri-oc-concurrency-${scenario}`
  const orderId = `po-oc-concurrency-${scenario}`

  await db.insert(schema.purchaseRequests).values({
    id: requestId,
    code: `SOL-OC-CONC-${scenario.toUpperCase()}`,
    worksiteId: "ws-oc-concurrency",
    requesterId: "user-oc-concurrency",
    status: "approved",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseRequestItems).values({
    id: requestItemId,
    requestId,
    productId: "prod-oc-concurrency",
    quantity: 10,
    unitOfMeasure: "unidad",
    status: "in_purchase_order",
  })
  await db.insert(schema.purchaseOrders).values({
    id: orderId,
    code: `OC-CONC-${scenario.toUpperCase()}`,
    worksiteId: "ws-oc-concurrency",
    supplierId: "sup-oc-concurrency",
    createdBy: "user-oc-concurrency",
    status: "draft",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseOrderItems).values({
    id: `poi-oc-concurrency-${scenario}`,
    purchaseOrderId: orderId,
    requestItemId,
    productId: "prod-oc-concurrency",
    quantity: 10,
    unitOfMeasure: "unidad",
    status: "issued",
  })

  return { requestItemId, orderId }
}

/** Un ítem aprobado y sin ninguna OC: la fila que la cola de Compras ofrece. */
async function seedPendingItemFixture(
  db: ReturnType<typeof drizzle<typeof schema>>,
  scenario: string,
) {
  const now = new Date().toISOString()
  const requestId = `pr-oc-concurrency-${scenario}`
  const requestItemId = `pri-oc-concurrency-${scenario}`

  await db.insert(schema.purchaseRequests).values({
    id: requestId,
    code: `SOL-OC-CONC-${scenario.toUpperCase()}`,
    worksiteId: "ws-oc-concurrency",
    requesterId: "user-oc-concurrency",
    status: "approved",
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.purchaseRequestItems).values({
    id: requestItemId,
    requestId,
    productId: "prod-oc-concurrency",
    quantity: 10,
    unitOfMeasure: "unidad",
    status: "approved",
  })

  return { requestItemId }
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
