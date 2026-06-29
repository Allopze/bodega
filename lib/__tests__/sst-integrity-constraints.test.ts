import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.sstActionPlan)
  await inMemoryDb.delete(schema.sstResponses)
  await inMemoryDb.delete(schema.sstEvaluations)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: "user-1",
    name: "Admin",
    email: "admin@example.test",
    hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: "ws-1",
    name: "Faena A",
    code: "FA",
    isActive: true,
  })
  await inMemoryDb.insert(schema.workers).values({
    id: "worker-1",
    firstName: "Ada",
    lastName: "Lovelace",
    rut: "11.111.111-1",
    position: "Operadora",
    worksiteId: "ws-1",
    isActive: true,
    createdAt: "2026-06-29T00:00:00.000Z",
  })
  await inMemoryDb.insert(schema.sstEvaluations).values({
    id: "sst-1",
    worksiteId: "ws-1",
    workerId: "worker-1",
    createdBy: "user-1",
    definicionCode: "trabajador_nuevo",
    definicionVersion: "01",
    tipo: "nuevo",
    fechaEvaluacion: "2026-06-29",
    estado: "borrador",
    cargosJson: ["conductor_ampliroll"],
    createdAt: "2026-06-29T00:00:00.000Z",
    updatedAt: "2026-06-29T00:00:00.000Z",
  })
})

describe("SST database integrity constraints", () => {
  it("rejects duplicate responses for the same evaluation section item", async () => {
    await inMemoryDb.insert(schema.sstResponses).values({
      id: "response-1",
      evaluationId: "sst-1",
      seccionId: "documentos",
      itemId: "licencia",
      estado: "cumple",
    })

    await expect(inMemoryDb.insert(schema.sstResponses).values({
      id: "response-2",
      evaluationId: "sst-1",
      seccionId: "documentos",
      itemId: "licencia",
      estado: "no_cumple",
    })).rejects.toThrow()
  })

  it("rejects duplicate action plan numbers for the same evaluation", async () => {
    await inMemoryDb.insert(schema.sstActionPlan).values({
      id: "plan-1",
      evaluationId: "sst-1",
      n: 1,
      hallazgo: "Hallazgo",
      accion: "Accion",
      responsable: "Responsable",
      plazo: "2026-07-10",
      estado: "pendiente",
    })

    await expect(inMemoryDb.insert(schema.sstActionPlan).values({
      id: "plan-2",
      evaluationId: "sst-1",
      n: 1,
      hallazgo: "Hallazgo duplicado",
      accion: "Otra accion",
      responsable: "Responsable",
      plazo: "2026-07-11",
      estado: "pendiente",
    })).rejects.toThrow()
  })
})
