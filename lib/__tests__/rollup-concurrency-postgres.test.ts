/**
 * Concurrency tests for rollupRequestStatus (F1-6/DAT-1) and the lock order
 * between cancelRequest and approveItem (F1-1/F1-2/DAT-2).
 *
 * DAT-1: sin lockear el padre, dos aprobaciones concurrentes de ítems
 * distintos de la misma solicitud pueden leer hermanos sin commitear y dejar
 * el padre en `in_review` con cero ítems pendientes.
 *
 * DAT-2 (lock order): cancelRequest lockea ítems antes que el padre; el resto
 * del código (approveItem → rollupRequestStatus) también lockea el ítem antes
 * que el padre. Si alguno invirtiera el orden, una cancelación y una
 * aprobación concurrentes sobre la misma solicitud podrían deadlockearse en
 * vez de simplemente serializarse.
 *
 * Requires a real PostgreSQL database.
 * Gate: ROLLUP_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET=true
 */
import path from "node:path"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { eq, sql } from "drizzle-orm"
import * as schema from "@/db/schema"
import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  quotePostgresIdentifier,
} from "@/lib/testing/destructive-database-guard"

const databaseUrl = process.env.ROLLUP_CONCURRENCY_DATABASE_URL ?? process.env.DATABASE_URL
const canResetDatabase = process.env.ROLLUP_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canResetDatabase ? describe : describe.skip

let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined

describeIf("rollup and cancellation concurrency on real Postgres", () => {
  beforeAll(async () => {
    assertSafeDestructiveDatabase({
      databaseUrl: databaseUrl!,
      allowDestructiveReset: canResetDatabase,
      context: "ROLLUP_CONCURRENCY",
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

    const globalWithDb = globalThis as typeof globalThis & { __db?: unknown }
    globalWithDb.__db = undefined
    process.env.DATABASE_URL = databaseUrl
    vi.resetModules()
  })

  afterAll(async () => {
    const globalWithDb = globalThis as typeof globalThis & { __db?: unknown }
    globalWithDb.__db = undefined
    await client?.end()
  })

  beforeEach(async () => {
    const db = getTestDb()
    await db.delete(schema.statusHistory)
    await db.delete(schema.approvalDecisions)
    await db.delete(schema.purchaseRequestItems)
    await db.delete(schema.purchaseRequests)
  })

  // DAT-1, cerrado: el lock del padre se movió a los callers, tomado después
  // del ítem y ANTES del insert en `approval_decisions` (ver
  // `lockRequestsForRollupTx`). Era `it.fails` mientras la carrera estaba
  // abierta; el día que pasó, falló-al-no-fallar y avisó que ya tocaba
  // convertirlo en un test normal. Ahora custodia el arreglo: si un caller
  // nuevo llega al rollup sin lockear su padre, esto vuelve a rojo.
  it("two concurrent approvals of different items in the same request never leave the parent stale (DAT-1)", async () => {
    const db = getTestDb()
    await seedRequestWithItems(db, ["item-a", "item-b"])

    const { approveItem } = await import("@/lib/services/item-state")

    await Promise.all([
      approveItem("item-a", "user-rc-test", { roleContext: "jefa_chome" }),
      approveItem("item-b", "user-rc-test", { roleContext: "jefa_chome" }),
    ])

    const [request] = await db.select().from(schema.purchaseRequests).where(eq(schema.purchaseRequests.id, "pr-rc-test"))
    // Ambos ítems quedaron aprobados: el padre debería reflejarlo, no quedar
    // varado en 'in_review' por una lectura de hermanos obsoleta.
    expect(request!.status).toBe("approved")
  })

  it("a cancellation racing an approval on the same request never deadlocks (lock order)", async () => {
    const db = getTestDb()
    await seedRequestWithItems(db, ["item-c", "item-d"])

    const { approveItem } = await import("@/lib/services/item-state")
    const { cancelRequest } = await import("@/lib/requests/request-service-module/cancel-request")

    const results = await Promise.allSettled([
      approveItem("item-c", "user-rc-test", { roleContext: "jefa_chome" }),
      cancelRequest("pr-rc-test", "user-rc-test", "Carrera de prueba"),
    ])

    // Lo único que no debe pasar es un deadlock sin resolver: Postgres aborta
    // una de las dos con un error legible (fulfilled o rejected, cualquiera de
    // las dos combinaciones es un resultado válido — lo que se prueba es que
    // AMBAS terminan, ninguna cuelga).
    expect(results).toHaveLength(2)
    const errors = results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason)
    for (const error of errors) {
      expect(String(error)).not.toMatch(/deadlock/i)
    }
  })
})

function getTestDb() {
  if (!testDb) throw new Error("Postgres test DB was not initialized")
  return testDb
}

async function seedRequestWithItems(db: ReturnType<typeof drizzle<typeof schema>>, itemIds: string[]) {
  const now = new Date().toISOString()

  await db.insert(schema.users).values({
    id: "user-rc-test", name: "Rollup Concurrency", email: "rollup-concurrency@test.local",
    hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now,
  }).onConflictDoNothing()
  await db.insert(schema.worksites).values({
    id: "ws-rc-test", name: "Faena concurrencia rollup", code: "RC-TEST",
    isActive: true, createdAt: now, updatedAt: now,
  }).onConflictDoNothing()
  await db.insert(schema.productCategories).values({
    id: "cat-rc-test", name: "Categoria concurrencia rollup", slug: "cat-rc-test",
  }).onConflictDoNothing()
  await db.insert(schema.products).values({
    id: "prod-rc-test", sku: "RC-TEST", name: "Producto concurrencia rollup",
    categoryId: "cat-rc-test", unitOfMeasure: "unidad", isActive: true,
    createdAt: now, updatedAt: now,
  }).onConflictDoNothing()
  await db.insert(schema.purchaseRequests).values({
    id: "pr-rc-test", code: `SOL-RC-${Date.now()}`, worksiteId: "ws-rc-test",
    requesterId: "user-rc-test", status: "submitted", createdAt: now, updatedAt: now,
  })
  await db.insert(schema.purchaseRequestItems).values(
    itemIds.map((id) => ({
      id, requestId: "pr-rc-test", productId: "prod-rc-test",
      quantity: 10, status: "requested", unitOfMeasure: "unidad",
    })),
  )
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
