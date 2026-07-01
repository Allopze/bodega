import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.preventionIncidentActions)
  await inMemoryDb.delete(schema.preventionIncidents)
  await inMemoryDb.delete(schema.iperRiskItems)
  await inMemoryDb.delete(schema.iperMatrices)
  await inMemoryDb.delete(schema.healthAptitudes)
  await inMemoryDb.delete(schema.healthExams)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: "user-1",
    name: "Prevencionista",
    email: "prev@example.test",
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
  })
})

describe("prevention DB check constraints", () => {
  it("rejects preventionIncidents with an invalid type", async () => {
    await expect(
      inMemoryDb.insert(schema.preventionIncidents).values({
        id: "inc-bad-type",
        worksiteId: "ws-1",
        type: "ataque_ovni" as never,
        status: "open",
        severity: "leve",
        occurredAt: new Date().toISOString(),
        title: "X",
        description: "Y",
        createdBy: "user-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/./)
  })

  it("rejects preventionIncidents with an invalid severity", async () => {
    await expect(
      inMemoryDb.insert(schema.preventionIncidents).values({
        id: "inc-bad-sev",
        worksiteId: "ws-1",
        type: "accidente",
        status: "open",
        severity: "extremo" as never,
        occurredAt: new Date().toISOString(),
        title: "X",
        description: "Y",
        createdBy: "user-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/./)
  })

  it("rejects preventionIncidentActions with an invalid status", async () => {
    await inMemoryDb.insert(schema.preventionIncidents).values({
      id: "inc-1",
      worksiteId: "ws-1",
      type: "accidente",
      status: "open",
      severity: "leve",
      occurredAt: new Date().toISOString(),
      title: "X",
      description: "Y",
      createdBy: "user-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    await expect(
      inMemoryDb.insert(schema.preventionIncidentActions).values({
        id: "act-bad",
        incidentId: "inc-1",
        description: "X",
        responsible: "Y",
        dueDate: "2026-12-01",
        status: "borrada" as never,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/./)
  })

  it("rejects iper_risk_items with invalid risk level", async () => {
    await inMemoryDb.insert(schema.iperMatrices).values({
      id: "mx-1",
      worksiteId: "ws-1",
      code: "M-1",
      version: 1,
      title: "Matriz base",
      status: "active",
      effectiveFrom: "2026-01-01",
      createdBy: "user-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    await expect(
      inMemoryDb.insert(schema.iperRiskItems).values({
        id: "rk-1",
        matrixId: "mx-1",
        process: "P",
        task: "T",
        hazard: "H",
        consequence: "C",
        initialProbability: 3,
        initialSeverity: 3,
        initialRiskScore: 9,
        initialRiskLevel: "infinito" as never,
        controls: [],
        residualProbability: 2,
        residualSeverity: 2,
        residualRiskScore: 4,
        residualRiskLevel: "bajo",
        responsible: "R",
        requiresTraining: false,
        requiresPpa: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/./)
  })

  it("rejects iper_risk_items with probability/severity out of 1..5 range", async () => {
    await inMemoryDb.insert(schema.iperMatrices).values({
      id: "mx-2",
      worksiteId: "ws-1",
      code: "M-2",
      version: 1,
      title: "Matriz base 2",
      status: "active",
      effectiveFrom: "2026-01-01",
      createdBy: "user-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    await expect(
      inMemoryDb.insert(schema.iperRiskItems).values({
        id: "rk-2",
        matrixId: "mx-2",
        process: "P",
        task: "T",
        hazard: "H",
        consequence: "C",
        initialProbability: 9,
        initialSeverity: 3,
        initialRiskScore: 27,
        initialRiskLevel: "critico",
        controls: [],
        residualProbability: 1,
        residualSeverity: 1,
        residualRiskScore: 1,
        residualRiskLevel: "bajo",
        responsible: "R",
        requiresTraining: false,
        requiresPpa: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/./)
  })

  it("rejects healthAptitudes with an invalid aptitude", async () => {
    await inMemoryDb.insert(schema.healthExams).values({
      id: "hexm-1",
      workerId: "worker-1",
      type: "preocupacional",
      performedAt: "2026-01-01",
      result: "apto",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    await expect(
      inMemoryDb.insert(schema.healthAptitudes).values({
        id: "apto-bad",
        workerId: "worker-1",
        examId: "hexm-1",
        position: "Operadora",
        aptitude: "aceptable" as never,
        restrictions: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/./)
  })
})
