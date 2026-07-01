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
  await inMemoryDb.delete(schema.workerTrainingAssignments)
  await inMemoryDb.delete(schema.trainingCourses)
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
  await inMemoryDb.insert(schema.workers).values([
    {
      id: "w-op1",
      firstName: "Operator",
      lastName: "One",
      rut: "11.111.111-1",
      position: "operador",
      worksiteId: "ws-1",
      isActive: true,
    },
    {
      id: "w-op2",
      firstName: "Operator",
      lastName: "Two",
      rut: "22.222.222-2",
      position: "operador",
      worksiteId: "ws-1",
      isActive: true,
    },
    {
      id: "w-jt1",
      firstName: "Jefe",
      lastName: "Terreno",
      rut: "33.333.333-3",
      position: "jefe_terreno",
      worksiteId: "ws-1",
      isActive: true,
    },
  ])
})

describe("getTrainingMatrix (Feature A)", () => {
  it("cuenta requeridos por cargo y cumplientes con asignación no vencida", async () => {
    const { createTrainingCourse, assignTrainingToWorker, getTrainingMatrix } = await import("@/lib/services/prevention-training")

    const course = await createTrainingCourse({
      code: "ALT-01", name: "Trabajo en altura", validityMonths: 12,
      requiredForCargo: ["operador"],
    }, "user-1")

    // w-op1 cumple (no vencido); w-op2 no tiene asignación; w-jt1 no aplica (otro cargo)
    await assignTrainingToWorker({
      courseId: course.id, workerId: "w-op1", worksiteId: "ws-1",
      completedAt: "2026-01-01", expiresAt: "2027-01-01",
    }, "user-1", ["ws-1"])

    const matrix = await getTrainingMatrix(["ws-1"], "2026-07-01")
    const row = matrix.find((r) => r.courseId === course.id && r.cargo === "operador")
    expect(row).toBeDefined()
    expect(row!.requiredCount).toBe(2)   // w-op1 + w-op2
    expect(row!.compliantCount).toBe(1)  // solo w-op1
  })

  it("una asignación vencida no cuenta como cumpliente", async () => {
    const { createTrainingCourse, assignTrainingToWorker, getTrainingMatrix } = await import("@/lib/services/prevention-training")
    const course = await createTrainingCourse({
      code: "ALT-02", name: "Altura 2", validityMonths: 12, requiredForCargo: ["operador"],
    }, "user-1")
    await assignTrainingToWorker({
      courseId: course.id, workerId: "w-op1", worksiteId: "ws-1",
      completedAt: "2024-01-01", expiresAt: "2025-01-01",
    }, "user-1", ["ws-1"])
    const matrix = await getTrainingMatrix(["ws-1"], "2026-07-01")
    const row = matrix.find((r) => r.courseId === course.id && r.cargo === "operador")
    expect(row!.compliantCount).toBe(0)
  })
})
