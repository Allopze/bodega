import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const { createMiper } = await import("@/lib/services/miper/matrices")
const { saveMiperEntry, saveMiperControl } = await import("@/lib/services/miper/entries")
const { buildMiperSnapshot, snapshotSha } = await import("@/lib/services/miper/snapshots")
const author = { userId: "u-s", scope: { mode: "all" as const, ids: [] as [] }, permissions: ["prevention:risk:edit"] }

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values({ id: "ws-s", name: "Faena S", code: "S" })
  await testDb.insert(schema.users).values({ id: "u-s", name: "Autora", email: "s@s.cl", hashedPassword: "x", isActive: true })
}, 60_000)

describe("foto viva del MIPER", () => {
  it("lleva nombres de diccionario y factor, filas ordenadas y medidas", async () => {
    const { id } = await createMiper({ worksiteId: "ws-s", period: 2026, revisionReason: "Período para probar la foto." }, author)
    const a = await saveMiperEntry({ matrixId: id, values: { activity: "Carga", task: "Izaje", position: "Operador", location: "Patio", riskFactorId: "riskfactor-mecanico", hazard: "Carga suspendida", risk: "Golpe", probableDamage: "Fractura", probability: 2, consequence: 4, controlledStatus: "partial", isRoutine: true } }, author)
    await saveMiperEntry({ matrixId: id, values: { hazard: "Segunda" } }, author)
    await saveMiperControl({ matrixId: id, entryId: a.id, values: { hierarchy: "engineering", description: "Limitador de carga", responsibleName: "Mantención", dueDate: "2026-10-31" } }, author)
    const snapshot = await buildMiperSnapshot(testDb, id)
    expect(snapshot.header).toMatchObject({ period: 2026, worksiteName: "Faena S", iperCode: "RE-04" })
    expect(snapshot.entries.map((e) => e.rowNumber)).toEqual([1, 2])
    expect(snapshot.entries[0]).toMatchObject({ activity: "Carga", task: "Izaje", position: "Operador", location: "Patio", riskFactor: "Mecánico", magnitude: 8, classification: "important" })
    expect(snapshot.entries[0]!.controls).toEqual([expect.objectContaining({ description: "Limitador de carga", responsibleName: "Mantención", dueDate: "2026-10-31" })])
    expect(snapshotSha(snapshot)).toMatch(/^[a-f0-9]{64}$/)
  })
})
