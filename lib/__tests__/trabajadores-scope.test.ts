/**
 * Regression tests for CHO-001 (AUDITORIA_INTEGRAL_CHOME.md): trabajadores
 * export/import must not leak or mutate workers outside the session's
 * worksite scope. Runs against a real Postgres-compatible engine (PGlite,
 * full migrations) so worksiteScopeSql and the import transaction are
 * exercised for real — only auth() and Next's revalidatePath are mocked.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import ExcelJS from "exceljs"
import type { Session } from "next-auth"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { truncateImmutableTable } from "@/lib/testing/immutable-tables"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite is structurally compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

const mockAuth = vi.hoisted(() => vi.fn())
vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import { GET as exportCatalog } from "@/app/api/admin/catalogos/export/route"
import { importWorkersFromXlsx, updateWorker, toggleWorkerActive } from "@/app/(app)/admin/trabajadores/actions"

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
  const headers = ["ID", "RUT", "Nombre", "Apellido", "Cargo", "Código cargo", "Supervisor", "Prevencionista", "Faena", "Activo"]
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

describe("trabajadores export/import — alcance de faena", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await inMemoryDb.delete(schema.auditLog)
    await inMemoryDb.delete(schema.users)
    await inMemoryDb.delete(schema.workerCapabilityOverrides)
    await truncateImmutableTable(inMemoryDb, "worker_position_history")
    await inMemoryDb.delete(schema.workers)
    await inMemoryDb.delete(schema.worksites)
    await inMemoryDb.insert(schema.worksites).values([
      { id: "ws-a", name: "Faena A", code: "FN-A" },
      { id: "ws-b", name: "Faena B", code: "FN-B" },
    ])
    await inMemoryDb.insert(schema.workers).values([
      { id: "worker-a", firstName: "Ana", lastName: "Alvarez", worksiteId: "ws-a", isActive: true },
      { id: "worker-b", firstName: "Beto", lastName: "Bravo", worksiteId: "ws-b", isActive: true },
    ])
    // audit_log.user_id has a FK to users — the acting session needs a row here.
    await inMemoryDb.insert(schema.users).values({
      id: "actor-scoped",
      name: "Prevencionista Faena A",
      email: "actor@example.com",
      hashedPassword: "test-hash",
    })
  })

  afterAll(async () => {
    delete testGlobal.__db
    await pg.close()
  })

  it("export: only returns workers within the scoped session's worksites", async () => {
    mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
    const req = { nextUrl: new URL("http://localhost/api/admin/catalogos/export?tipo=trabajadores") } as never

    const res = await exportCatalog(req)
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
    mockAuth.mockResolvedValue({
      ...scopedSession([]),
      user: { ...scopedSession([]).user, roles: ["administrador"], isGlobal: true },
    })
    const req = { nextUrl: new URL("http://localhost/api/admin/catalogos/export?tipo=trabajadores") } as never

    const res = await exportCatalog(req)
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

  it("export: incluye código, capacidades y estado de revisión del cargo", async () => {
    const capability = await inMemoryDb.query.workerCapabilities.findFirst({
      where: (item, { eq }) => eq(item.code, "drives_vehicle"),
    })
    await inMemoryDb.insert(schema.workerPositions).values({
      id: "position-export-test",
      code: "CONDUCTOR-QA",
      name: "Conductor QA",
      normalizedKey: "conductor qa",
      needsReview: true,
    }).onConflictDoNothing()
    await inMemoryDb.insert(schema.workerPositionCapabilities).values({
      positionId: "position-export-test",
      capabilityId: capability!.id,
    }).onConflictDoNothing()
    await inMemoryDb.update(schema.workers).set({
      positionId: "position-export-test",
      position: "Conductor QA",
    }).where(eq(schema.workers.id, "worker-a"))

    mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
    const req = { nextUrl: new URL("http://localhost/api/admin/catalogos/export?tipo=trabajadores") } as never
    const res = await exportCatalog(req)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()) as never)
    const sheet = workbook.worksheets[0]!
    const headers = sheet.getRow(1).values as unknown[]

    expect(headers).toEqual(expect.arrayContaining([
      "Cargo",
      "Código cargo",
      "Capacidades",
      "Cargo pendiente de revisión",
    ]))
    const headerIndex = new Map(headers.flatMap((header, index) => (
      header == null ? [] : [[String(header), index] as const]
    )))
    const ana = sheet.getRow(2)
    expect(ana.getCell(headerIndex.get("Cargo")!).value).toBe("Conductor QA")
    expect(ana.getCell(headerIndex.get("Código cargo")!).value).toBe("CONDUCTOR-QA")
    expect(ana.getCell(headerIndex.get("Capacidades")!).value).toBe("Conduce vehículos")
    expect(ana.getCell(headerIndex.get("Cargo pendiente de revisión")!).value).toBe("Sí")
  })

  it("import: rejects an update row whose existingId belongs to a worker outside scope", async () => {
    mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
    const buf = await buildXlsx([
      { ID: "worker-b", Nombre: "Beto", Apellido: "Bravo Hackeado", Faena: "Faena B", Activo: "Sí" },
    ])
    const formData = new FormData()
    formData.set("file", fileFromBuffer(buf))

    const state = await importWorkersFromXlsx({ ok: false }, formData)

    expect(state.ok).toBe(false)
    expect(state.message).toMatch(/no pertenece a una faena de tu alcance/)

    const untouched = await inMemoryDb.query.workers.findFirst({ where: eq(schema.workers.id, "worker-b") })
    expect(untouched?.lastName).toBe("Bravo")
  })

  it("import: accepts an update row for a worker within scope", async () => {
    mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
    const buf = await buildXlsx([
      { ID: "worker-a", Nombre: "Ana", Apellido: "Alvarez Actualizada", Faena: "Faena A", Activo: "Sí" },
    ])
    const formData = new FormData()
    formData.set("file", fileFromBuffer(buf))

    const state = await importWorkersFromXlsx({ ok: false }, formData)

    expect(state.ok).toBe(true)
    expect(state.data).toMatchObject({ updated: 1 })

    const updated = await inMemoryDb.query.workers.findFirst({ where: eq(schema.workers.id, "worker-a") })
    expect(updated?.lastName).toBe("Alvarez Actualizada")
  })

  it("import: crea una sola vez un cargo desconocido normalizado, pendiente y sin capacidades", async () => {
    mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
    const buf = await buildXlsx([
      { Nombre: "Carmen", Apellido: "Norte", Cargo: " Operador ÁREA QA ", Faena: "Faena A", Activo: "Sí" },
      { Nombre: "Diego", Apellido: "Sur", Cargo: "operador area qa", Faena: "Faena A", Activo: "Sí" },
    ])
    const formData = new FormData()
    formData.set("file", fileFromBuffer(buf))

    const state = await importWorkersFromXlsx({ ok: false }, formData)

    expect(state).toMatchObject({
      ok: true,
      data: { created: 2, positionsCreated: 1 },
    })
    const imported = await inMemoryDb.query.workers.findMany({
      where: (worker, { inArray }) => inArray(worker.firstName, ["Carmen", "Diego"]),
    })
    expect(new Set(imported.map((worker) => worker.positionId))).toEqual(new Set([imported[0]?.positionId]))
    expect(imported[0]?.positionId).toBeTruthy()

    const position = await inMemoryDb.query.workerPositions.findFirst({
      where: (catalog, { eq }) => eq(catalog.id, imported[0]!.positionId!),
      with: { capabilities: true },
    })
    expect(position).toMatchObject({
      normalizedKey: "operador area qa",
      needsReview: true,
      capabilities: [],
    })
  })

  it("import: rejects a create row targeting a worksite outside scope, even by exact name", async () => {
    mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
    const buf = await buildXlsx([
      { Nombre: "Carla", Apellido: "Cruz", Faena: "Faena B", Activo: "Sí" },
    ])
    const formData = new FormData()
    formData.set("file", fileFromBuffer(buf))

    const state = await importWorkersFromXlsx({ ok: false }, formData)

    expect(state.ok).toBe(false)
    expect(state.message).toMatch(/indica una faena existente y accesible/)

    const created = await inMemoryDb.query.workers.findFirst({ where: eq(schema.workers.firstName, "Carla") })
    expect(created).toBeUndefined()
  })

  it("updateWorker action: denies moving/editing a worker outside the session's scope", async () => {
    mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
    const formData = new FormData()
    formData.set("id", "worker-b")
    formData.set("firstName", "Beto")
    formData.set("lastName", "Hackeado")
    formData.set("worksiteId", "ws-b")

    const state = await updateWorker({ ok: false }, formData)

    expect(state.ok).toBe(false)
    expect(state.message).toMatch(/No tienes acceso/)

    const untouched = await inMemoryDb.query.workers.findFirst({ where: eq(schema.workers.id, "worker-b") })
    expect(untouched?.lastName).toBe("Bravo")
  })

  it("toggleWorkerActive action: denies toggling a worker outside the session's scope", async () => {
    mockAuth.mockResolvedValue(scopedSession(["ws-a"]))
    const formData = new FormData()
    formData.set("id", "worker-b")
    formData.set("activate", "false")

    const state = await toggleWorkerActive({ ok: false }, formData)

    expect(state.ok).toBe(false)
    const untouched = await inMemoryDb.query.workers.findFirst({ where: eq(schema.workers.id, "worker-b") })
    expect(untouched?.isActive).toBe(true)
  })
})
