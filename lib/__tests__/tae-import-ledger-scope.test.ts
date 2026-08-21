/**
 * CO-013: el ledger de importaciones TAE describe un archivo multi-faena. Un rol
 * acotado no puede leer sus contadores globales, su hash ni sus filas rechazadas,
 * y sólo debe ver lotes donde tenga cargas propias, con cifras recalculadas sobre
 * ellas. Corre sobre PGlite con migraciones reales para ejercitar el join y el
 * agregado tal cual los verá Postgres.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { nanoid } from "@/lib/id"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { countTaeImportBatches, listTaeImportBatches } = await import("@/lib/combustibles/tae-import-ledger")

const worksiteA = nanoid()
const worksiteB = nanoid()
const productId = nanoid()
const userId = nanoid()
const mixedBatch = nanoid()
const foreignBatch = nanoid()

function session(worksiteIds: string[] | null): Session {
  return {
    user: {
      id: userId,
      name: "Operador",
      email: "operador@example.com",
      roles: worksiteIds === null ? ["administrador"] : ["admin_contrato"],
      permissions: ["combustibles:tae_import"],
      worksiteIds: worksiteIds ?? [],
      primaryWorksiteId: worksiteIds?.[0] ?? null,
      avatarColor: null,
      isActive: true,
      isGlobal: worksiteIds === null,
    },
    expires: "2099-01-01T00:00:00.000Z",
  } as unknown as Session
}

function submission(batchId: string, worksiteId: string, liters: number, status: string) {
  return {
    id: nanoid(),
    clientSubmissionId: nanoid(),
    importBatchId: batchId,
    source: "legacy_xlsx",
    publicResultToken: nanoid(),
    worksiteId,
    productId,
    equipmentCodeSnapshot: "EQ-1",
    loadedAt: "2026-08-01T12:00:00.000Z",
    submittedAt: "2026-08-01T12:00:00.000Z",
    driverNameSnapshot: "Conductor",
    supervisorNameSnapshot: "Supervisor",
    meterType: "odometer",
    liters,
    status,
    createdBy: userId,
  }
}

describe("ledger de importaciones TAE con alcance por faena", () => {
  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values([
      { id: worksiteA, name: "Faena A", code: `FA-${nanoid().slice(0, 8)}`, isActive: true },
      { id: worksiteB, name: "Faena B", code: `FB-${nanoid().slice(0, 8)}`, isActive: true },
    ])
    await inMemoryDb.insert(schema.users).values({ id: userId, name: "Operador", email: `op-${nanoid()}@example.com`, hashedPassword: "x", isActive: true })
    await inMemoryDb.insert(schema.fuelProducts).values({ id: productId, code: `DIESEL-${nanoid().slice(0, 6)}`, name: "Diésel", category: "diesel", unit: "liter" })
    await inMemoryDb.insert(schema.fuelTaeImportBatches).values([
      { id: mixedBatch, fileName: "mixto.xlsx", fileHash: nanoid(), status: "imported", totalRows: 10, validRows: 6, observedRows: 2, invalidRows: 2, totalLiters: 900, importedBy: userId, createdAt: "2026-08-10T10:00:00.000Z" },
      { id: foreignBatch, fileName: "ajeno.xlsx", fileHash: nanoid(), status: "imported", totalRows: 4, validRows: 4, observedRows: 0, invalidRows: 0, totalLiters: 400, importedBy: userId, createdAt: "2026-08-11T10:00:00.000Z" },
    ])
    await inMemoryDb.insert(schema.fuelTaeSubmissions).values([
      submission(mixedBatch, worksiteA, 100, "validated"),
      submission(mixedBatch, worksiteA, 50, "observed"),
      submission(mixedBatch, worksiteB, 750, "validated"),
      submission(foreignBatch, worksiteB, 400, "validated"),
    ])
    await inMemoryDb.insert(schema.fuelTaeImportRejections).values({
      id: nanoid(), batchId: mixedBatch, rowIndex: 7, stage: "worksite", message: "Faena no resuelta",
      rawRow: { faena: "Faena B", equipo: "EQ-SECRETO" },
    })
  })

  it("un rol global conserva los contadores del archivo completo", async () => {
    const rows = await listTaeImportBatches(session(null), { limit: 25 })
    const mixed = rows.find((row) => row.id === mixedBatch)
    expect(rows).toHaveLength(2)
    expect(mixed).toMatchObject({ totalRows: 10, validRows: 6, observedRows: 2, invalidRows: 2, totalLiters: 900 })
    expect(mixed?.fileHash).toBeTruthy()
    expect(await countTaeImportBatches(session(null))).toBe(2)
  })

  it("un rol acotado sólo ve lotes con cargas suyas y con cifras recalculadas", async () => {
    const scoped = session([worksiteA])
    const rows = await listTaeImportBatches(scoped, { limit: 25 })

    expect(rows.map((row) => row.id)).toEqual([mixedBatch])
    expect(rows[0]).toMatchObject({ validRows: 1, observedRows: 1, totalLiters: 150 })
    // Lo no atribuible viaja como `null`, nunca como cero.
    expect(rows[0]?.totalRows).toBeNull()
    expect(rows[0]?.invalidRows).toBeNull()
    expect(rows[0]?.fileHash).toBeNull()
    expect(await countTaeImportBatches(scoped)).toBe(1)
  })

  it("un rol sin faenas no ve ningún lote", async () => {
    const none = session([])
    expect(await listTaeImportBatches(none, { limit: 25 })).toEqual([])
    expect(await countTaeImportBatches(none)).toBe(0)
  })
})
