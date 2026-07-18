/**
 * Real-Postgres counterpart of trabajadores-scope.test.ts (CHO-001,
 * AUDITORIA_INTEGRAL_CHOME.md). Same assertions, against an actual
 * PostgreSQL server (not PGlite) — see AUDITORIA_INTEGRAL_CHOME.md Pasada 10
 * for why this was added on top of the already-passing PGlite version.
 *
 * Requires a real PostgreSQL database (same pattern as
 * receiving-concurrency-postgres.test.ts).
 * Gate: TRABAJADORES_SCOPE_ALLOW_DESTRUCTIVE_RESET=true
 */
import path from "node:path"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { eq, sql } from "drizzle-orm"
import ExcelJS from "exceljs"
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

const databaseUrl = process.env.TRABAJADORES_SCOPE_DATABASE_URL ?? process.env.DATABASE_URL
const canResetDatabase = process.env.TRABAJADORES_SCOPE_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canResetDatabase ? describe : describe.skip

let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined

function scopedSession(worksiteIds: string[]): Session {
  return {
    user: {
      id: "actor-scoped",
      name: "Prevencionista Faena A",
      email: "actor@example.com",
      roles: ["prevencionista_faena"],
      permissions: ["admin:workers"],
      worksiteIds,
      primaryWorksiteId: worksiteIds[0] ?? null,
      avatarColor: null,
      isActive: true,
      isGlobal: false,
    },
    expires: "2099-01-01T00:00:00.000Z",
  }
}

async function buildXlsx(rows: Array<Record<string, string>>): Promise<Buffer> {
  const headers = ["ID", "RUT", "Nombre", "Apellido", "Cargo", "Supervisor", "Prevencionista", "Faena", "Activo"]
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Trabajadores")
  sheet.addRow(headers)
  for (const row of rows) sheet.addRow(headers.map((h) => row[h] ?? ""))
  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}

function fileFromBuffer(buf: Buffer, name = "import.xlsx"): File {
  return new File([new Uint8Array(buf)], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
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
    exportRoute: await import("@/app/api/admin/catalogos/export/route"),
    trabajadoresActions: await import("@/app/(app)/admin/trabajadores/actions"),
  }
}

describeIf("trabajadores export/import — alcance de faena (real Postgres)", () => {
  beforeAll(async () => {
    assertSafeDestructiveDatabase({
      databaseUrl: databaseUrl!,
      allowDestructiveReset: canResetDatabase,
      context: "TRABAJADORES_SCOPE",
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
    await db.delete(schema.auditLog)
    await db.delete(schema.users)
    await db.delete(schema.workers)
    await db.delete(schema.worksites)
    await db.insert(schema.worksites).values([
      { id: "ws-a", name: "Faena A", code: "FN-A" },
      { id: "ws-b", name: "Faena B", code: "FN-B" },
    ])
    await db.insert(schema.workers).values([
      { id: "worker-a", firstName: "Ana", lastName: "Alvarez", worksiteId: "ws-a", isActive: true },
      { id: "worker-b", firstName: "Beto", lastName: "Bravo", worksiteId: "ws-b", isActive: true },
    ])
    // audit_log.user_id has a FK to users — the acting session needs a row here.
    await db.insert(schema.users).values({
      id: "actor-scoped",
      name: "Prevencionista Faena A",
      email: "actor@example.com",
      hashedPassword: "test-hash",
    })
  })

  it("export: only returns workers within the scoped session's worksites", async () => {
    const { exportRoute } = await loadActions()
    mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
    const req = { nextUrl: new URL("http://localhost/api/admin/catalogos/export?tipo=trabajadores") } as never

    const res = await exportRoute.GET(req)
    expect(res.status).toBe(200)

    const buf = Buffer.from(await res.arrayBuffer())
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buf as never)
    const sheet = workbook.worksheets[0]!
    const names = new Set<string>()
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return
      names.add(String(row.getCell(3).value))
    })

    expect(names).toEqual(new Set(["Ana"]))
    expect(names.has("Beto")).toBe(false)
  })

  it("export: a global session sees workers from every worksite", async () => {
    const { exportRoute } = await loadActions()
    mockAuth.mockResolvedValue({
      ...scopedSession([]),
      user: { ...scopedSession([]).user, roles: ["administrador"], isGlobal: true },
    })
    const req = { nextUrl: new URL("http://localhost/api/admin/catalogos/export?tipo=trabajadores") } as never

    const res = await exportRoute.GET(req)
    const buf = Buffer.from(await res.arrayBuffer())
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buf as never)
    const sheet = workbook.worksheets[0]!
    const names = new Set<string>()
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return
      names.add(String(row.getCell(3).value))
    })

    expect(names).toEqual(new Set(["Ana", "Beto"]))
  })

  it("import: rejects an update row whose existingId belongs to a worker outside scope", async () => {
    const { trabajadoresActions } = await loadActions()
    mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
    const buf = await buildXlsx([
      { ID: "worker-b", Nombre: "Beto", Apellido: "Bravo Hackeado", Faena: "Faena B", Activo: "Sí" },
    ])
    const formData = new FormData()
    formData.set("file", fileFromBuffer(buf))

    const state = await trabajadoresActions.importWorkersFromXlsx({ ok: false }, formData)

    expect(state.ok).toBe(false)
    expect(state.message).toMatch(/no pertenece a una faena de tu alcance/)

    const db = getTestDb()
    const untouched = await db.query.workers.findFirst({ where: eq(schema.workers.id, "worker-b") })
    expect(untouched?.lastName).toBe("Bravo")
  })

  it("import: accepts an update row for a worker within scope", async () => {
    const { trabajadoresActions } = await loadActions()
    mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
    const buf = await buildXlsx([
      { ID: "worker-a", Nombre: "Ana", Apellido: "Alvarez Actualizada", Faena: "Faena A", Activo: "Sí" },
    ])
    const formData = new FormData()
    formData.set("file", fileFromBuffer(buf))

    const state = await trabajadoresActions.importWorkersFromXlsx({ ok: false }, formData)

    expect(state.ok).toBe(true)
    expect(state.data).toMatchObject({ updated: 1 })

    const db = getTestDb()
    const updated = await db.query.workers.findFirst({ where: eq(schema.workers.id, "worker-a") })
    expect(updated?.lastName).toBe("Alvarez Actualizada")
  })

  it("import: rejects a create row targeting a worksite outside scope, even by exact name", async () => {
    const { trabajadoresActions } = await loadActions()
    mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
    const buf = await buildXlsx([
      { Nombre: "Carla", Apellido: "Cruz", Faena: "Faena B", Activo: "Sí" },
    ])
    const formData = new FormData()
    formData.set("file", fileFromBuffer(buf))

    const state = await trabajadoresActions.importWorkersFromXlsx({ ok: false }, formData)

    expect(state.ok).toBe(false)
    expect(state.message).toMatch(/indica una faena existente y accesible/)

    const db = getTestDb()
    const created = await db.query.workers.findFirst({ where: eq(schema.workers.firstName, "Carla") })
    expect(created).toBeUndefined()
  })

  it("updateWorker action: denies moving/editing a worker outside the session's scope", async () => {
    const { trabajadoresActions } = await loadActions()
    mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
    const formData = new FormData()
    formData.set("id", "worker-b")
    formData.set("firstName", "Beto")
    formData.set("lastName", "Hackeado")
    formData.set("worksiteId", "ws-b")

    const state = await trabajadoresActions.updateWorker({ ok: false }, formData)

    expect(state.ok).toBe(false)
    expect(state.message).toMatch(/No tienes acceso/)

    const db = getTestDb()
    const untouched = await db.query.workers.findFirst({ where: eq(schema.workers.id, "worker-b") })
    expect(untouched?.lastName).toBe("Bravo")
  })

  it("toggleWorkerActive action: denies toggling a worker outside the session's scope", async () => {
    const { trabajadoresActions } = await loadActions()
    mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
    const formData = new FormData()
    formData.set("id", "worker-b")
    formData.set("activate", "false")

    const state = await trabajadoresActions.toggleWorkerActive({ ok: false }, formData)

    expect(state.ok).toBe(false)
    const db = getTestDb()
    const untouched = await db.query.workers.findFirst({ where: eq(schema.workers.id, "worker-b") })
    expect(untouched?.isActive).toBe(true)
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
