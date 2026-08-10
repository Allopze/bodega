/**
 * Real-Postgres counterpart of combustibles-scope.test.ts (CHO-002,
 * AUDITORIA_INTEGRAL_CHOME.md). Same assertions, against an actual
 * PostgreSQL server (not PGlite) — see AUDITORIA_INTEGRAL_CHOME.md Pasada 10
 * for why this was added on top of the already-passing PGlite version.
 *
 * Requires a real PostgreSQL database (same pattern as
 * receiving-concurrency-postgres.test.ts).
 * Gate: COMBUSTIBLES_SCOPE_ALLOW_DESTRUCTIVE_RESET=true
 */
import path from "node:path"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { eq, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import type { Session } from "next-auth"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  quotePostgresIdentifier,
} from "@/lib/testing/destructive-database-guard"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

const mockAuth = vi.hoisted(() => vi.fn())
vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))

const databaseUrl = process.env.COMBUSTIBLES_SCOPE_DATABASE_URL ?? process.env.DATABASE_URL
const canResetDatabase = process.env.COMBUSTIBLES_SCOPE_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canResetDatabase ? describe : describe.skip

let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined

function scopedSession(worksiteIds: string[]): Session {
  return {
    user: {
      id: "actor-scoped",
      name: "Admin Contrato Faena A",
      email: "actor@example.com",
      roles: ["admin_contrato"],
      permissions: ["combustibles:manage_vehicles", "combustibles:revert", "combustibles:import"],
      worksiteIds,
      primaryWorksiteId: worksiteIds[0] ?? null,
      avatarColor: null,
      isActive: true,
      isGlobal: false,
    },
    expires: "2099-01-01T00:00:00.000Z",
  }
}

function getTestDb() {
  if (!testDb) throw new Error("Postgres test DB was not initialized")
  return testDb
}

async function loadActions() {
  const globalWithDb = globalThis as typeof globalThis & { __db?: unknown }
  globalWithDb.__db = undefined
  process.env.DATABASE_URL = databaseUrl
  vi.resetModules()
  return {
    vehicles: await import("@/app/(app)/combustibles/actions-module/vehicles"),
    consumos: await import("@/app/(app)/combustibles/actions-consumos"),
    importRoute: await import("@/app/api/combustibles/import/route"),
  }
}

describeIf("combustibles — alcance de faena en mutaciones masivas y vinculación (real Postgres)", () => {
  beforeAll(async () => {
    assertSafeDestructiveDatabase({
      databaseUrl: databaseUrl!,
      allowDestructiveReset: canResetDatabase,
      context: "COMBUSTIBLES_SCOPE",
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
  })

  afterAll(async () => {
    const globalWithDb = globalThis as typeof globalThis & { __db?: unknown }
    globalWithDb.__db = undefined
    await client?.end()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    const db = getTestDb()
    await db.delete(schema.fuelConsumptionRecords)
    await db.delete(schema.fuelImportBatches)
    await db.delete(schema.fuelVehicles)
    await db.delete(schema.fuelEquipmentTypes)
    await db.delete(schema.auditLog)
    await db.delete(schema.users)
    await db.delete(schema.worksites)

    await db.insert(schema.worksites).values([
      { id: "ws-a", name: "Faena A", code: "FN-A" },
      { id: "ws-b", name: "Faena B", code: "FN-B" },
    ])
    await db.insert(schema.users).values({
      id: "actor-scoped",
      name: "Admin Contrato Faena A",
      email: "actor@example.com",
      hashedPassword: "test-hash",
    })
    await db.insert(schema.fuelEquipmentTypes).values({
      id: "fet-camioneta",
      slug: "camioneta",
      name: "Camioneta",
    })
    await db.insert(schema.fuelVehicles).values([
      { id: "veh-a", plate: "AAAA11", type: "camioneta", equipmentTypeId: "fet-camioneta", worksiteId: "ws-a", isActive: true },
      { id: "veh-b", plate: "BBBB22", type: "camioneta", equipmentTypeId: "fet-camioneta", worksiteId: "ws-b", isActive: true },
    ])
  })

  describe("bulkToggleFuelVehicleActiveAction", () => {
    it("rejects the whole batch when one id is outside the session's worksite scope", async () => {
      const { vehicles } = await loadActions()
      mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
      const formData = new FormData()
      formData.set("ids", "veh-a,veh-b")
      formData.set("activate", "false")

      const state = await vehicles.bulkToggleFuelVehicleActiveAction({ ok: false }, formData)

      expect(state.ok).toBe(false)
      expect(state.message).toMatch(/fuera de tu alcance/)

      const db = getTestDb()
      const untouchedA = await db.query.fuelVehicles.findFirst({ where: eq(schema.fuelVehicles.id, "veh-a") })
      const untouchedB = await db.query.fuelVehicles.findFirst({ where: eq(schema.fuelVehicles.id, "veh-b") })
      expect(untouchedA?.isActive).toBe(true)
      expect(untouchedB?.isActive).toBe(true)
    })

    it("allows toggling vehicles that are entirely within scope", async () => {
      const { vehicles } = await loadActions()
      mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
      const formData = new FormData()
      formData.set("ids", "veh-a")
      formData.set("activate", "false")

      const state = await vehicles.bulkToggleFuelVehicleActiveAction({ ok: false }, formData)

      expect(state.ok).toBe(true)
      const db = getTestDb()
      const updated = await db.query.fuelVehicles.findFirst({ where: eq(schema.fuelVehicles.id, "veh-a") })
      expect(updated?.isActive).toBe(false)
    })
  })

  describe("linkConsumptionPlateAction", () => {
    async function seedBatch(worksiteId: string) {
      const db = getTestDb()
      await db.insert(schema.fuelImportBatches).values({
        id: "batch-1",
        worksiteId,
        periodoDesde: "2026-06-01",
        periodoHasta: "2026-06-30",
        archivoNombre: "consumos.xlsx",
        hashArchivo: "hash-1",
        importadoPor: "actor-scoped",
      })
      await db.insert(schema.fuelConsumptionRecords).values({
        id: "rec-1",
        batchId: "batch-1",
        worksiteId,
        patente: "ZZZZ99",
        cantidadUnidad: 10,
        monto: 1000,
        periodoDesde: "2026-06-01",
        periodoHasta: "2026-06-30",
      })
    }

    it("rejects linking a vehicle from another worksite, even when the batch is in scope", async () => {
      await seedBatch("ws-a")
      const { consumos } = await loadActions()
      mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
      const formData = new FormData()
      formData.set("batchId", "batch-1")
      formData.set("patente", "ZZZZ99")
      formData.set("vehicleId", "veh-b") // belongs to ws-b, not the batch's ws-a

      const state = await consumos.linkConsumptionPlateAction({ ok: false }, formData)

      expect(state.ok).toBe(false)
      expect(state.message).toMatch(/no pertenece a la faena del lote/)

      const db = getTestDb()
      const record = await db.query.fuelConsumptionRecords.findFirst({ where: eq(schema.fuelConsumptionRecords.id, "rec-1") })
      expect(record?.vehicleId).toBeNull()
    })

    it("rejects operating on a batch outside the session's worksite scope", async () => {
      await seedBatch("ws-b")
      const { consumos } = await loadActions()
      mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
      const formData = new FormData()
      formData.set("batchId", "batch-1")
      formData.set("patente", "ZZZZ99")
      formData.set("vehicleId", "veh-b")

      const state = await consumos.linkConsumptionPlateAction({ ok: false }, formData)

      expect(state.ok).toBe(false)
      expect(state.message).toMatch(/No tienes acceso a esta faena/)
    })

    it("allows linking a vehicle that matches the batch's worksite", async () => {
      await seedBatch("ws-a")
      const { consumos } = await loadActions()
      mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
      const formData = new FormData()
      formData.set("batchId", "batch-1")
      formData.set("patente", "ZZZZ99")
      formData.set("vehicleId", "veh-a")

      const state = await consumos.linkConsumptionPlateAction({ ok: false }, formData)

      expect(state.ok).toBe(true)
      const db = getTestDb()
      const record = await db.query.fuelConsumptionRecords.findFirst({ where: eq(schema.fuelConsumptionRecords.id, "rec-1") })
      expect(record?.vehicleId).toBe("veh-a")
    })
  })

  describe("POST /api/combustibles/import — creación de faenas y mapeo fuera de alcance", () => {
    function minimalLoad(worksiteName: string) {
      return {
        rowIndex: 1,
        loadDate: "2026-06-01",
        month: "2026-06",
        serviceType: "TCT",
        vehicle: "AAAA11",
        supplier: "Proveedor X",
        worksite: worksiteName,
        product: "diesel",
        receiptNumber: "F-1",
        liters: 100,
        baseAmount: 1000,
        totalAmount: 1000,
      }
    }

    function importRequest(body: unknown) {
      return new NextRequest("http://localhost/api/combustibles/import", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      })
    }

    it("rejects CREATE_FAENA for a non-global session without admin:worksites", async () => {
      const { importRoute } = await loadActions()
      mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
      const req = importRequest({
        loads: [minimalLoad("Faena Nueva")],
        faenaMapping: { "Faena Nueva": "__create__" },
      })

      const res = await importRoute.POST(req)

      expect(res.status).toBe(500)
      const db = getTestDb()
      const createdWorksite = await db.query.worksites.findFirst({ where: eq(schema.worksites.name, "Faena Nueva") })
      expect(createdWorksite).toBeUndefined()
    })

    it("rejects mapping to an existing worksite outside the session's scope", async () => {
      const { importRoute } = await loadActions()
      mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
      const req = importRequest({
        loads: [minimalLoad("Faena B (archivo)")],
        faenaMapping: { "Faena B (archivo)": "ws-b" },
      })

      const res = await importRoute.POST(req)

      expect(res.status).toBe(500)
      const db = getTestDb()
      const loadsInB = await db.query.fuelLoads.findMany({ where: eq(schema.fuelLoads.worksiteId, "ws-b") })
      expect(loadsInB).toHaveLength(0)
    })
  })
})

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
