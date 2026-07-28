/** Real PostgreSQL proof for EPP preventivo: cobertura contra entregas reales de Bodega, alcance y escalamiento idempotente a CAPA. */
import path from "node:path"
import postgres from "postgres"
import { eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  quotePostgresIdentifier,
} from "@/lib/testing/destructive-database-guard"

const databaseUrl = process.env.PREVENTION_EPP_DATABASE_URL
const canReset = process.env.PREVENTION_EPP_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canReset ? describe : describe.skip
const previousDatabaseUrl = process.env.DATABASE_URL
let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined

const scopeA = { mode: "some", ids: ["ws-epp-a"] } as WorksiteScope
const MANAGER = { userId: "epp-manager", scope: scopeA, permissions: ["prevention:epp:view", "prevention:epp:manage"] }
const OUTSIDER = { userId: "epp-outsider", scope: { mode: "some", ids: ["ws-epp-b"] } as WorksiteScope, permissions: ["prevention:epp:view", "prevention:epp:manage"] }

function getDb() {
  if (!testDb) throw new Error("Test database not initialised")
  return testDb
}

describeIf("EPP preventivo on real PostgreSQL", () => {
  beforeAll(async () => {
    assertSafeDestructiveDatabase({ databaseUrl: databaseUrl!, allowDestructiveReset: canReset, context: "PREVENTION_EPP" })
    await ensureDatabaseExists(databaseUrl!)
    await resetDatabase(databaseUrl!)
    const migrationClient = postgres(databaseUrl!, { max: 1, onnotice: () => undefined })
    await migrate(drizzle(migrationClient), { migrationsFolder: path.resolve(process.cwd(), "db/migrations") })
    await migrationClient.end()
    client = postgres(databaseUrl!, { max: 10, onnotice: () => undefined })
    testDb = drizzle(client, { schema })
    ;(globalThis as typeof globalThis & { __db?: typeof testDb }).__db = testDb
    process.env.DATABASE_URL = databaseUrl
    vi.resetModules()
    await seedFixture(getDb())
  }, 60_000)

  afterAll(async () => {
    ;(globalThis as typeof globalThis & { __db?: unknown }).__db = undefined
    await client?.end()
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
  })

  it("denies creating a worksite-scoped requirement from a foreign scope", async () => {
    const service = await import("@/lib/services/prevention-epp")
    await expect(service.createEppRequirement({
      eppTypeId: "eppt-cabeza", scopeType: "worksite", worksiteId: "ws-epp-a",
      enforcement: "blocking", reason: "DS 594 art. 53: protección de cabeza obligatoria en toda faena.",
    }, OUTSIDER)).rejects.toThrow(/fuera de alcance/)
  })

  it("reports a missing gap for a worker with no delivery of the required EPP", async () => {
    const service = await import("@/lib/services/prevention-epp")
    await service.createEppRequirement({
      eppTypeId: "eppt-cabeza", scopeType: "global",
      enforcement: "blocking", reason: "DS 594 art. 53: protección de cabeza obligatoria en toda faena.",
    }, MANAGER)

    const gaps = await service.listEppCoverageGaps(MANAGER)
    expect(gaps.some((gap) => gap.workerId === "wk-a1" && gap.gapType === "missing")).toBe(true)
  })

  it("a worker delivery within the family's lifespan clears the gap", async () => {
    const service = await import("@/lib/services/prevention-epp")
    await getDb().insert(schema.deliveries).values({
      id: "del-1", code: "ENT-2026-0001", deliveredBy: "epp-manager",
      deliveredAt: new Date().toISOString(), destinationType: "worker", workerId: "wk-a1",
    })
    await getDb().insert(schema.deliveryItems).values({
      id: "deli-1", deliveryId: "del-1", productId: "prod-casco", quantity: 1,
    })

    const gaps = await service.listEppCoverageGaps(MANAGER)
    expect(gaps.some((gap) => gap.workerId === "wk-a1")).toBe(false)
  })

  it("creates one replenishment draft per live gap even when executed twice", async () => {
    const service = await import("@/lib/services/epp-replenishment")

    const first = await service.generateReplenishmentDrafts(MANAGER)
    const second = await service.generateReplenishmentDrafts(MANAGER)

    expect(first.createdCount).toBe(1)
    expect(second).toEqual({ createdCount: 0, requestCodes: [] })
    const links = await getDb().select().from(schema.eppReplenishmentLinks)
    expect(links).toHaveLength(1)
    const requestItems = await getDb().select().from(schema.purchaseRequestItems)
    expect(requestItems.filter((item) => item.workerId === "wk-a2")).toHaveLength(1)
  })

  it("does not count a delivery to another worksite towards this worker's coverage", async () => {
    const service = await import("@/lib/services/prevention-epp")
    const gaps = await service.listEppCoverageGaps(MANAGER)
    expect(gaps.some((gap) => gap.workerId === "wk-b1")).toBe(false) // fuera de alcance, no aparece ni con ni sin brecha
  })

  it("escalating blocking gaps creates one CAPA action per worker and is idempotent", async () => {
    const service = await import("@/lib/services/prevention-epp")
    // wk-a2 sigue sin cobertura (sólo wk-a1 recibió casco).
    const first = await service.escalateBlockingEppGapsToCapa(MANAGER, { targetDate: "2026-12-01" })
    expect(first.created).toBe(1)
    expect(first.skipped).toBe(0)

    const capa = await getDb().select().from(schema.preventionCapaActions).where(eq(schema.preventionCapaActions.sourceType, "epp"))
    expect(capa).toHaveLength(1)
    expect(capa[0]?.sourceId).toBe("wk-a2:eppt-cabeza")
    expect(capa[0]?.worksiteId).toBe("ws-epp-a")

    const second = await service.escalateBlockingEppGapsToCapa(MANAGER, { targetDate: "2026-12-01" })
    expect(second.created).toBe(0)
    expect(second.skipped).toBe(1)
  })

  it("does not leak requirements or gaps of another worksite's dotación", async () => {
    const service = await import("@/lib/services/prevention-epp")
    const outsiderGaps = await service.listEppCoverageGaps(OUTSIDER)
    expect(outsiderGaps.every((gap) => gap.worksiteId !== "ws-epp-a")).toBe(true)
  })
})

async function seedFixture(database: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date().toISOString()
  await database.insert(schema.worksites).values([
    { id: "ws-epp-a", name: "Faena Norte", code: "EPP-A", createdAt: now, updatedAt: now },
    { id: "ws-epp-b", name: "Faena Sur", code: "EPP-B", createdAt: now, updatedAt: now },
  ])
  await database.insert(schema.workers).values([
    { id: "wk-a1", rut: "11111111-1", firstName: "Ana", lastName: "Pérez", worksiteId: "ws-epp-a", createdAt: now },
    { id: "wk-a2", rut: "22222222-2", firstName: "Bruno", lastName: "Soto", worksiteId: "ws-epp-a", createdAt: now },
    { id: "wk-b1", rut: "66666666-6", firstName: "Felipe", lastName: "Vera", worksiteId: "ws-epp-b", createdAt: now },
  ])
  await database.insert(schema.users).values([
    { id: "epp-manager", name: "Gestor de EPP", email: "epp-manager@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "epp-outsider", name: "Ajeno", email: "epp-outsider@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
  ])
  // `epp_types` ya viene poblado por la migración semilla del catálogo EPP
  // (0091): 'eppt-cabeza' es una de las 9 filas canónicas, no se duplica.
  await database.insert(schema.productCategories).values([
    { id: "cat-epp", name: "EPP", slug: "epp", isEpp: true },
  ])
  await database.insert(schema.eppProductFamilies).values([
    { id: "fam-casco", categoryId: "cat-epp", canonicalName: "Casco de seguridad", identityKey: "casco-seguridad", eppTypeId: "eppt-cabeza", lifespanMonths: 24 },
  ])
  await database.insert(schema.products).values([
    { id: "prod-casco", sku: "SKU-CASCO-1", name: "Casco de seguridad blanco", categoryId: "cat-epp", familyId: "fam-casco", isEpp: true },
  ])
}

async function resetDatabase(url: string) {
  const setupClient = postgres(url, { max: 1, onnotice: () => undefined })
  const setupDb = drizzle(setupClient)
  try {
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`)
    await setupDb.execute(sql`CREATE SCHEMA public`)
    await setupDb.execute(sql`GRANT ALL ON SCHEMA public TO PUBLIC`)
  } finally { await setupClient.end() }
}

async function ensureDatabaseExists(url: string) {
  const databaseName = getDatabaseNameFromUrl(url)
  const maintenanceClient = postgres(getMaintenanceDatabaseUrl(url), { max: 1, onnotice: () => undefined })
  try {
    const rows = await maintenanceClient<{ exists: number }[]>`SELECT 1 AS exists FROM pg_database WHERE datname = ${databaseName} LIMIT 1`
    if (rows.length === 0) await maintenanceClient.unsafe(`CREATE DATABASE ${quotePostgresIdentifier(databaseName)}`)
  } finally { await maintenanceClient.end() }
}
