import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible with app db shape in tests.
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
  await inMemoryDb.delete(schema.iperRiskItems)
  await inMemoryDb.delete(schema.iperMatrices)
  await inMemoryDb.delete(schema.worksiteUsers)
  await inMemoryDb.delete(schema.userRoles)
  await inMemoryDb.delete(schema.roles)
  await inMemoryDb.delete(schema.permissions)
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
  await inMemoryDb.insert(schema.worksites).values({
    id: "ws-2",
    name: "Faena B",
    code: "FB",
    isActive: true,
  })
})

describe("IPER matrix", () => {
  it("creates a matrix and calculates residual risk level", async () => {
    const { createIperMatrix, addIperRiskItem } = await import("@/lib/services/prevention-iper")

    const matrix = await createIperMatrix({
      worksiteId: "ws-1",
      code: "IPER-FA-2026",
      version: 1,
      title: "IPER Faena A",
      effectiveFrom: "2026-07-01",
    }, "user-1", ["ws-1"])

    expect(matrix.status).toBe("draft")

    const item = await addIperRiskItem({
      matrixId: matrix.id,
      process: "Operacion",
      task: "Conduccion",
      hazard: "Interaccion equipo-persona",
      consequence: "Atropello",
      initialProbability: 5,
      initialSeverity: 5,
      controls: ["Segregacion", "PPA", "Charla diaria"],
      residualProbability: 2,
      residualSeverity: 5,
      responsible: "Jefe de faena",
    }, ["ws-1"])

    expect(item.initialRiskScore).toBe(25)
    expect(item.initialRiskLevel).toBe("critico")
    expect(item.residualRiskScore).toBe(10)
    expect(item.residualRiskLevel).toBe("alto")
  })

  it("rejects creating a matrix outside worksite scope", async () => {
    const { createIperMatrix } = await import("@/lib/services/prevention-iper")

    await expect(createIperMatrix({
      worksiteId: "ws-1",
      code: "IPER-FA-2026",
      version: 1,
      title: "IPER Faena A",
      effectiveFrom: "2026-07-01",
    }, "user-1", ["ws-2"])).rejects.toThrow(/sin acceso/i)
  })

  it("classifies risk levels across the full scale", async () => {
    const { classifyRisk } = await import("@/lib/services/prevention-iper")
    expect(classifyRisk(1)).toBe("bajo")
    expect(classifyRisk(4)).toBe("bajo")
    expect(classifyRisk(5)).toBe("medio")
    expect(classifyRisk(9)).toBe("medio")
    expect(classifyRisk(10)).toBe("alto")
    expect(classifyRisk(19)).toBe("alto")
    expect(classifyRisk(20)).toBe("critico")
    expect(classifyRisk(25)).toBe("critico")
  })
})