/**
 * #33: la hoja de SST de un trabajador listaba todas sus evaluaciones sólo por
 * `workerId`. Una persona que cambió de faena arrastra las actas de la
 * anterior, y quien sólo ve la faena actual las leía igual.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error - PGlite is compatible at runtime with the app db shape used by these tests.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  await pg.close()
})

const { listWorkerEvaluations } = await import("@/lib/services/sst-module/worker-evaluations")

function evaluation(id: string, worksiteId: string, createdAt: string) {
  return {
    id, worksiteId, workerId: "worker-1", createdBy: "user-1",
    definicionCode: "trabajador_nuevo", definicionVersion: "01", tipo: "nuevo",
    fechaEvaluacion: createdAt.slice(0, 10), estado: "cerrada", cargosJson: ["conductor_ampliroll"],
    createdAt, updatedAt: createdAt,
  }
}

beforeAll(async () => {
  await inMemoryDb.insert(schema.users).values({ id: "user-1", name: "Evaluador", email: "eval@example.test", hashedPassword: "x" })
  await inMemoryDb.insert(schema.worksites).values([
    { id: "ws-1", name: "Faena A", code: "FA", isActive: true },
    { id: "ws-2", name: "Faena B", code: "FB", isActive: true },
  ])
  // Hoy está en ws-1; antes trabajó en ws-2 y ahí quedó una evaluación.
  await inMemoryDb.insert(schema.workers).values({
    id: "worker-1", firstName: "Ada", lastName: "Lovelace", rut: "11.111.111-1",
    position: "Operadora", worksiteId: "ws-1", isActive: true, createdAt: "2026-01-01T00:00:00.000Z",
  })
  await inMemoryDb.insert(schema.sstEvaluations).values([
    evaluation("sst-ws2", "ws-2", "2026-03-01T00:00:00.000Z"),
    evaluation("sst-ws1", "ws-1", "2026-06-01T00:00:00.000Z"),
  ])
})

describe("listWorkerEvaluations", () => {
  it("no muestra evaluaciones de faenas fuera del alcance", async () => {
    const rows = await listWorkerEvaluations("worker-1", ["ws-1"])
    expect(rows.map((row) => row.id)).toEqual(["sst-ws1"])
  })

  it("el alcance total ve todo el historial, del más reciente al más antiguo", async () => {
    const rows = await listWorkerEvaluations("worker-1", "all")
    expect(rows.map((row) => row.id)).toEqual(["sst-ws1", "sst-ws2"])
  })

  it("sin faenas no ve ninguna", async () => {
    expect(await listWorkerEvaluations("worker-1", [])).toEqual([])
  })
})
