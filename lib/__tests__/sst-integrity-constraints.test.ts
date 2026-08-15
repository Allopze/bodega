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
  await inMemoryDb.delete(schema.preventionCapaActions)
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

  /**
   * D11: la garantía se mudó de `sst_action_plan_evaluation_n_unique` al índice
   * parcial `prevention_capa_sst_evaluation_n_unique`, que la reproduce sobre
   * `(source_id, (source_ref->>'n')::int)` para las CAPA de origen
   * `sst_evaluation`. Sin él, dos guardados concurrentes de la misma fila del
   * acta crearían dos acciones.
   */
  it("rejects duplicate action plan numbers for the same evaluation", async () => {
    const base = {
      sourceType: "sst_evaluation", sourceId: "sst-1", worksiteId: "ws-1",
      priority: "medium", status: "pending", evidenceRequired: true,
      createdByUserId: "user-1",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    await inMemoryDb.insert(schema.preventionCapaActions).values({
      ...base,
      id: "plan-1", code: "CAPA-SST-INT-001",
      finding: "Hallazgo", actionDescription: "Accion",
      responsibleSnapshot: "Responsable", targetDate: "2026-07-10",
      sourceRef: { n: 1 },
    })

    await expect(inMemoryDb.insert(schema.preventionCapaActions).values({
      ...base,
      id: "plan-2", code: "CAPA-SST-INT-002",
      finding: "Hallazgo duplicado", actionDescription: "Otra accion",
      responsibleSnapshot: "Responsable", targetDate: "2026-07-11",
      sourceRef: { n: 1 },
    })).rejects.toThrow()
  })

  /** El índice es parcial: otra evaluación puede reusar el mismo `n`. */
  it("allows the same action plan number in a different evaluation", async () => {
    const base = {
      sourceType: "sst_evaluation", worksiteId: "ws-1", finding: "Hallazgo",
      actionDescription: "Accion", responsibleSnapshot: "Responsable",
      priority: "medium", targetDate: "2026-07-10", status: "pending",
      evidenceRequired: true, sourceRef: { n: 1 }, createdByUserId: "user-1",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    await inMemoryDb.insert(schema.preventionCapaActions).values([
      { ...base, id: "plan-a", code: "CAPA-SST-INT-010", sourceId: "sst-1" },
      { ...base, id: "plan-b", code: "CAPA-SST-INT-011", sourceId: "sst-2" },
    ])
    expect(await inMemoryDb.select().from(schema.preventionCapaActions)).toHaveLength(2)
  })
})
