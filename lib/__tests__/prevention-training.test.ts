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

describe("prevention training", () => {
  it("assigns a course and detects expired training by due date", async () => {
    const { createTrainingCourse, assignTrainingToWorker, listExpiredTrainings } =
      await import("@/lib/services/prevention-training")

    const course = await createTrainingCourse({
      code: "ODI",
      name: "Obligacion de informar",
      validityMonths: 12,
      requiredForCargo: ["operador"],
    }, "user-1")

    expect(course.isActive).toBe(true)

    await assignTrainingToWorker({
      courseId: course.id,
      workerId: "worker-1",
      worksiteId: "ws-1",
      completedAt: "2025-01-01",
      expiresAt: "2026-01-01",
      score: 100,
    }, "user-1", ["ws-1"])

    const expired = await listExpiredTrainings(["ws-1"], "2026-07-01")
    expect(expired).toHaveLength(1)
    expect(expired[0]!.workerId).toBe("worker-1")
  })

  it("upserts when assigning the same course twice to the same worker", async () => {
    const { createTrainingCourse, assignTrainingToWorker } = await import("@/lib/services/prevention-training")

    const course = await createTrainingCourse({
      code: "RIOHS",
      name: "Reglamento interno",
      requiredForCargo: [],
    }, "user-1")

    await assignTrainingToWorker({
      courseId: course.id,
      workerId: "worker-1",
      worksiteId: "ws-1",
      completedAt: "2025-06-01",
      expiresAt: "2026-06-01",
      score: 80,
    }, "user-1", ["ws-1"])

    const updated = await assignTrainingToWorker({
      courseId: course.id,
      workerId: "worker-1",
      worksiteId: "ws-1",
      completedAt: "2026-06-01",
      expiresAt: "2027-06-01",
      score: 95,
    }, "user-1", ["ws-1"])

    expect(updated.score).toBe(95)
    expect(updated.expiresAt).toBe("2027-06-01")

    const rows = await inMemoryDb.select().from(schema.workerTrainingAssignments)
    expect(rows).toHaveLength(1)
  })

  it("denies assignment outside worksite scope", async () => {
    const { createTrainingCourse, assignTrainingToWorker } = await import("@/lib/services/prevention-training")

    const course = await createTrainingCourse({
      code: "CHARLA",
      name: "Charla diaria",
      requiredForCargo: [],
    }, "user-1")

    await expect(assignTrainingToWorker({
      courseId: course.id,
      workerId: "worker-1",
      worksiteId: "ws-1",
      completedAt: "2026-06-01",
    }, "user-1", [])).rejects.toThrow(/sin acceso/i)
  })
})