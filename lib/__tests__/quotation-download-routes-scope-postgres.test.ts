/**
 * Real-Postgres counterpart of quotation-download-routes-scope.test.ts
 * (CHO-003, AUDITORIA_INTEGRAL_CHOME.md). Same assertions, against an actual
 * PostgreSQL server (not mocked db.query.*.findFirst calls) — see
 * AUDITORIA_INTEGRAL_CHOME.md Pasada 10 for why this was added on top of the
 * already-passing mocked-db version. `can`/`canAccessWorksite` and the real
 * SELECT/join logic in each route run for real; only auth/fs/storage-path
 * are mocked.
 *
 * Requires a real PostgreSQL database (same pattern as
 * receiving-concurrency-postgres.test.ts).
 * Gate: QUOTATION_SCOPE_ALLOW_DESTRUCTIVE_RESET=true
 */
import path from "node:path"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { sql } from "drizzle-orm"
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

const mockReadFile = vi.hoisted(() => vi.fn())
const mockResolveQuotationAttachmentFile = vi.hoisted(() => vi.fn())
const mockResolveServiceQuotationFile = vi.hoisted(() => vi.fn())

vi.mock("node:fs", () => ({ promises: { readFile: mockReadFile } }))
vi.mock("@/lib/storage/config", () => ({
  resolveQuotationAttachmentFile: mockResolveQuotationAttachmentFile,
  resolveServiceQuotationFile: mockResolveServiceQuotationFile,
}))
vi.mock("@/lib/utils", () => ({
  encodeContentDisposition: vi.fn(() => "inline; filename=cotizacion.pdf"),
}))

const mockAuth = vi.hoisted(() => vi.fn())
vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))

const databaseUrl = process.env.QUOTATION_SCOPE_DATABASE_URL ?? process.env.DATABASE_URL
const canResetDatabase = process.env.QUOTATION_SCOPE_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canResetDatabase ? describe : describe.skip

let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined

function getTestDb() {
  if (!testDb) throw new Error("Postgres test DB was not initialized")
  return testDb
}

async function loadRoute(kind: "repuestos" | "servicios") {
  const globalWithDb = globalThis as typeof globalThis & { __db?: unknown }
  globalWithDb.__db = undefined
  process.env.DATABASE_URL = databaseUrl
  vi.resetModules()
  if (kind === "repuestos") {
    const mod = await import("@/app/api/repuestos/quotaciones/[id]/route")
    return mod.GET
  }
  const mod = await import("@/app/api/servicios/cotizaciones/[id]/route")
  return mod.GET
}

function makeSession(overrides: {
  userId?: string
  permissions?: string[]
  worksiteIds?: string[]
  isGlobal?: boolean
} = {}): Session {
  const worksiteIds = overrides.worksiteIds ?? []
  return {
    user: {
      id: overrides.userId ?? "user-a",
      name: "Test User",
      email: "test@example.com",
      roles: [],
      permissions: overrides.permissions ?? [],
      worksiteIds,
      primaryWorksiteId: worksiteIds[0] ?? null,
      avatarColor: null,
      isActive: true,
      isGlobal: overrides.isGlobal ?? false,
    },
    expires: "2099-01-01T00:00:00.000Z",
  }
}

function makeReq() {
  return new NextRequest(new URL("http://localhost/api/x/y/q-1"))
}

const routeConfigs = [
  {
    label: "repuestos quotaciones",
    kind: "repuestos" as const,
    permOwn: "repuestos:view_own",
    permAll: "repuestos:view_all",
    requestType: "repuestos",
    resolveFile: mockResolveQuotationAttachmentFile,
  },
  {
    label: "servicios cotizaciones",
    kind: "servicios" as const,
    permOwn: "servicios:view_own",
    permAll: "servicios:view_all",
    requestType: "servicios",
    resolveFile: mockResolveServiceQuotationFile,
  },
] as const

describeIf.each(routeConfigs)("$label — descarga: propiedad y alcance de faena (real Postgres)", (config) => {
  beforeAll(async () => {
    assertSafeDestructiveDatabase({
      databaseUrl: databaseUrl!,
      allowDestructiveReset: canResetDatabase,
      context: "QUOTATION_SCOPE",
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
    config.resolveFile.mockReturnValue("/tmp/fake-quotation-path.pdf")
    mockReadFile.mockResolvedValue(Buffer.from("%PDF-1.4"))

    const db = getTestDb()
    await db.delete(schema.repuestoQuotations)
    await db.delete(schema.serviceQuotations)
    await db.delete(schema.purchaseRequests)
    await db.delete(schema.users)
    await db.delete(schema.worksites)

    await db.insert(schema.worksites).values([
      { id: "ws-a", name: "Faena A", code: "FN-A" },
      { id: "ws-b", name: "Faena B", code: "FN-B" },
    ])
    await db.insert(schema.users).values([
      { id: "user-a", name: "Owner", email: "user-a@example.com", hashedPassword: "test-hash" },
      { id: "user-b", name: "Otro solicitante", email: "user-b@example.com", hashedPassword: "test-hash" },
      { id: "user-c", name: "Aprobador", email: "user-c@example.com", hashedPassword: "test-hash" },
    ])
  })

  // Seeds a purchase request (owned by user-a by default) + its quotation "q-1",
  // with the request's worksite controlled per test — mirrors the shape the
  // mocked version passed to mockFindPurchaseRequest.mockResolvedValueOnce(...).
  async function seedRequestAndQuotation(worksiteId: string, requesterId = "user-a") {
    const db = getTestDb()
    await db.insert(schema.purchaseRequests).values({
      id: "req-1",
      code: `SOL-QSCOPE-${worksiteId}-${requesterId}`,
      worksiteId,
      requesterId,
      requestType: config.requestType,
      status: "submitted",
    })
    const quotationsTable = config.kind === "repuestos" ? schema.repuestoQuotations : schema.serviceQuotations
    await db.insert(quotationsTable).values({
      id: "q-1",
      requestId: "req-1",
      fileName: "cotizacion.pdf",
      filePath: "q-1.pdf",
      totalAmount: 1000,
    })
  }

  it("returns 401 when not authenticated", async () => {
    const GET = await loadRoute(config.kind)
    mockAuth.mockResolvedValueOnce(null)
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "q-1" }) })
    expect(res.status).toBe(401)
  })

  it("returns 403 without view_own or view_all", async () => {
    const GET = await loadRoute(config.kind)
    mockAuth.mockResolvedValueOnce(makeSession({ permissions: [] }))
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "q-1" }) })
    expect(res.status).toBe(403)
  })

  it("returns 404 when the quotation does not exist", async () => {
    const GET = await loadRoute(config.kind)
    mockAuth.mockResolvedValueOnce(makeSession({ permissions: [config.permOwn], worksiteIds: ["ws-a"] }))
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "missing" }) })
    expect(res.status).toBe(404)
  })

  it("returns 404 (IDOR) for a view_own user in the right worksite but a different requester", async () => {
    await seedRequestAndQuotation("ws-a", "user-a")
    const GET = await loadRoute(config.kind)
    mockAuth.mockResolvedValueOnce(
      makeSession({ userId: "user-b", permissions: [config.permOwn], worksiteIds: ["ws-a"] }),
    )

    const res = await GET(makeReq(), { params: Promise.resolve({ id: "q-1" }) })

    expect(res.status).toBe(404)
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it("returns 200 for the owner with view_own in the right worksite", async () => {
    await seedRequestAndQuotation("ws-a", "user-a")
    const GET = await loadRoute(config.kind)
    mockAuth.mockResolvedValueOnce(
      makeSession({ userId: "user-a", permissions: [config.permOwn], worksiteIds: ["ws-a"] }),
    )

    const res = await GET(makeReq(), { params: Promise.resolve({ id: "q-1" }) })

    expect(res.status).toBe(200)
  })

  it("returns 200 for a view_all user regardless of requester, within worksite scope", async () => {
    await seedRequestAndQuotation("ws-a", "user-a")
    const GET = await loadRoute(config.kind)
    mockAuth.mockResolvedValueOnce(
      makeSession({ userId: "user-c", permissions: [config.permAll], worksiteIds: ["ws-a"] }),
    )

    const res = await GET(makeReq(), { params: Promise.resolve({ id: "q-1" }) })

    expect(res.status).toBe(200)
  })

  it("returns 404 for the owner when the parent request's worksite is out of session scope", async () => {
    await seedRequestAndQuotation("ws-a", "user-a")
    const GET = await loadRoute(config.kind)
    mockAuth.mockResolvedValueOnce(
      makeSession({ userId: "user-a", permissions: [config.permOwn], worksiteIds: ["ws-b"] }),
    )

    const res = await GET(makeReq(), { params: Promise.resolve({ id: "q-1" }) })

    expect(res.status).toBe(404)
  })

  it("returns 404 for a view_all user outside worksite scope (no global bypass)", async () => {
    await seedRequestAndQuotation("ws-a", "user-a")
    const GET = await loadRoute(config.kind)
    mockAuth.mockResolvedValueOnce(
      makeSession({ userId: "user-c", permissions: [config.permAll], worksiteIds: ["ws-b"], isGlobal: false }),
    )

    const res = await GET(makeReq(), { params: Promise.resolve({ id: "q-1" }) })

    expect(res.status).toBe(404)
  })
})

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
