import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
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

beforeEach(async () => {
  await inMemoryDb.delete(schema.sstActionPlan)
  await inMemoryDb.delete(schema.sstScheduledFollowups)
  await inMemoryDb.delete(schema.sstResponses)
  await inMemoryDb.delete(schema.sstEvaluations)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)
})

async function seedEvaluation(evaluationId = "sst-1") {
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
  await inMemoryDb.insert(schema.worksites).values({
    id: "ws-2",
    name: "Faena B",
    code: "FB",
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
    createdAt: "2026-06-19T00:00:00.000Z",
  })
  await inMemoryDb.insert(schema.sstEvaluations).values({
    id: evaluationId,
    worksiteId: "ws-1",
    workerId: "worker-1",
    createdBy: "user-1",
    definicionCode: "trabajador_nuevo",
    definicionVersion: "01",
    tipo: "nuevo",
    fechaEvaluacion: "2026-06-19",
    estado: "borrador",
    cargosJson: ["conductor_ampliroll"],
    createdAt: "2026-06-19T00:00:00.000Z",
    updatedAt: "2026-06-19T00:00:00.000Z",
  })
  await inMemoryDb.insert(schema.sstResponses).values({
    id: "response-1",
    evaluationId,
    seccionId: "documentos",
    itemId: "licencia",
    estado: "cumple",
  })
  await inMemoryDb.insert(schema.sstScheduledFollowups).values({
    id: "followup-1",
    evaluationId,
    instancia: "dia_7",
    fechaProgramada: "2026-06-26",
    realizado: false,
  })
  await inMemoryDb.insert(schema.sstActionPlan).values({
    id: "plan-1",
    evaluationId,
    n: 1,
    hallazgo: "Hallazgo",
    accion: "Accion",
    responsable: "Responsable",
    plazo: "2026-06-30",
    estado: "pendiente",
  })
}

describe("deleteEvaluation", () => {
  it("deletes an evaluation and its dependent SST records within scope", async () => {
    await seedEvaluation()
    const { deleteEvaluation } = await import("@/lib/services/sst")

    await deleteEvaluation("sst-1", ["ws-1"])

    expect(await inMemoryDb.select().from(schema.sstEvaluations)).toHaveLength(0)
    expect(await inMemoryDb.select().from(schema.sstResponses)).toHaveLength(0)
    expect(await inMemoryDb.select().from(schema.sstScheduledFollowups)).toHaveLength(0)
    expect(await inMemoryDb.select().from(schema.sstActionPlan)).toHaveLength(0)
  })

  it("rejects deletion outside the caller worksite scope", async () => {
    await seedEvaluation()
    const { deleteEvaluation } = await import("@/lib/services/sst")

    await expect(deleteEvaluation("sst-1", ["ws-2"]))
      .rejects.toThrow("Evaluación no encontrada o sin acceso.")

    const [evaluation] = await inMemoryDb
      .select()
      .from(schema.sstEvaluations)
      .where(eq(schema.sstEvaluations.id, "sst-1"))
      .limit(1)
    expect(evaluation).toBeTruthy()
  })

  it("rejects deleting a closed evaluation and preserves its evidence", async () => {
    await seedEvaluation()
    await inMemoryDb
      .update(schema.sstEvaluations)
      .set({ estado: "cerrado" })
      .where(eq(schema.sstEvaluations.id, "sst-1"))
    const { deleteEvaluation } = await import("@/lib/services/sst")

    await expect(deleteEvaluation("sst-1", ["ws-1"]))
      .rejects.toThrow("cerrada")

    expect(await inMemoryDb.select().from(schema.sstEvaluations)).toHaveLength(1)
    expect(await inMemoryDb.select().from(schema.sstResponses)).toHaveLength(1)
    expect(await inMemoryDb.select().from(schema.sstScheduledFollowups)).toHaveLength(1)
    expect(await inMemoryDb.select().from(schema.sstActionPlan)).toHaveLength(1)
  })
})

describe("closeEvaluation", () => {
  it("rejects closing when applicable checklist items are unanswered", async () => {
    await seedEvaluation()
    const { closeEvaluation } = await import("@/lib/services/sst")

    await expect(closeEvaluation("sst-1", { evaluationId: "sst-1" }, ["ws-1"]))
      .rejects.toThrow("sin responder")

    const [evaluation] = await inMemoryDb
      .select()
      .from(schema.sstEvaluations)
      .where(eq(schema.sstEvaluations.id, "sst-1"))
      .limit(1)
    expect(evaluation?.estado).toBe("borrador")
  })
})

describe("markWeekCompleted", () => {
  it("rejects completing a weekly evaluation before its unlock date", async () => {
    await seedEvaluation()
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    await inMemoryDb.insert(schema.sstWeeklyEvaluations).values({
      id: "week-1",
      evaluationId: "sst-1",
      semana: 1,
      fechaDesbloqueo: tomorrow,
      estado: "pendiente",
      fechaCompletada: null,
      alertSentAt: null,
    })
    const { markWeekCompleted } = await import("@/lib/services/sst")

    await expect(markWeekCompleted("week-1", ["ws-1"]))
      .rejects.toThrow("bloqueada")

    const [week] = await inMemoryDb
      .select()
      .from(schema.sstWeeklyEvaluations)
      .where(eq(schema.sstWeeklyEvaluations.id, "week-1"))
      .limit(1)
    expect(week?.estado).toBe("pendiente")
    expect(week?.fechaCompletada).toBeNull()
  })
})

describe("saveActionPlanItem", () => {
  it("allows continuing the corrective action plan after the evaluation is closed", async () => {
    await seedEvaluation()
    await inMemoryDb
      .update(schema.sstEvaluations)
      .set({ estado: "cerrado" })
      .where(eq(schema.sstEvaluations.id, "sst-1"))
    const { saveActionPlanItem } = await import("@/lib/services/sst")

    const item = await saveActionPlanItem({
      evaluationId: "sst-1",
      n: 2,
      hallazgo: "Hallazgo posterior",
      accion: "Revisar control",
      responsable: "Prevencionista",
      plazo: "2026-07-05",
      estado: "pendiente",
    }, ["ws-1"], "user-1")

    expect(item.id).toBeTruthy()
    const rows = await inMemoryDb.select().from(schema.sstActionPlan)
    expect(rows).toHaveLength(2)
  })
})
