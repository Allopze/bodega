import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

// `@/lib/services/pdtp/objectives` (y el propio script) importan `@/db`
// estáticamente. Un `import` estático de este módulo aquí arriba evaluaría
// `@/db` antes de que `testGlobal.__db` quede asignado más abajo, y la
// conexión real (Postgres) quedaría fija para todo el archivo — el mismo
// cuidado que toma `lib/__tests__/pdtp-objectives.test.ts`. Se importa
// dinámicamente dentro de cada test en su lugar.

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  // Mismo orden que lib/__tests__/pdtp-objectives.test.ts: `pdtp_activities`
  // referencia `pdtp_objectives` con una FK compuesta `ON DELETE SET NULL`
  // sobre columna específica, así que las actividades se borran antes.
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpObjectives)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({ id: "user-1", name: "U1", email: "u1@test", hashedPassword: "x", isActive: true })
})

/** Programa mínimo, sin pasar por el servicio (el script no lo necesita). */
async function insertProgram(id: string, year: number, status: "draft" | "active" = "active") {
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id,
    year,
    version: 1,
    status,
    title: `Programa ${year}`,
    elaboratedByName: "Prevencionista",
    elaboratedByTitle: "Prevencionista",
    createdAt: now,
    updatedAt: now,
  })
}

/** Actividad mínima con el número de catálogo legado que decide su objetivo. */
async function insertActivity(input: { id: string; programId: string; n: number; status?: "active" | "retired"; objectiveId?: string | null }) {
  const now = new Date().toISOString()
  const retired = input.status === "retired"
  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: input.id,
    programId: input.programId,
    n: input.n,
    status: input.status ?? "active",
    objectiveId: input.objectiveId ?? null,
    displayOrder: input.n,
    activity: `Actividad N°${input.n}`,
    program: "Guía de ejecución",
    responsibleSlugs: [],
    responsibleDisplay: "Prevencionista",
    sourceSheetRow: input.n,
    // `pdtp_activities_retirement_check` exige estos tres si status=retired.
    retiredReason: retired ? "Retirada para la prueba del backfill de objetivos." : undefined,
    retiredEffectiveFrom: retired ? now.slice(0, 10) : undefined,
    retiredAt: retired ? now : undefined,
    createdAt: now,
    updatedAt: now,
  })
}

describe("planObjectiveCatalog / planObjectiveAssignments (helpers puros)", () => {
  it("planObjectiveCatalog sólo propone los códigos que faltan", async () => {
    const { planObjectiveCatalog } = await import("../apply-pdtp-2026-objectives")
    const { PDTP_2026_OBJECTIVES } = await import("@/lib/services/pdtp/objectives")
    expect(planObjectiveCatalog([])).toHaveLength(8)
    expect(planObjectiveCatalog([{ code: "1" }, { code: "2" }])).toHaveLength(6)
    expect(planObjectiveCatalog(PDTP_2026_OBJECTIVES.map((o) => ({ code: o.code })))).toHaveLength(0)
  })

  it("planObjectiveAssignments ignora las actividades ya asignadas", async () => {
    const { planObjectiveAssignments } = await import("../apply-pdtp-2026-objectives")
    const plan = planObjectiveAssignments([
      { id: "a1", n: 5, objectiveId: null },       // objetivo 1 (1..9)
      { id: "a2", n: 20, objectiveId: "already" }, // ya asignada: se ignora
      { id: "a3", n: 89, objectiveId: null },      // objetivo 8 (85..89)
      { id: "a4", n: 999, objectiveId: null },     // fuera de rango: no clasifica
    ])
    expect(plan).toEqual([
      { activityId: "a1", objectiveCode: "1" },
      { activityId: "a3", objectiveCode: "8" },
    ])
  })
})

describe("backfill de objetivos PDTP 2026 (PGlite)", () => {
  it("crea los 8 objetivos y asigna actividades activas y retiradas por número; una segunda corrida no cambia nada", async () => {
    const { planPdtp2026ObjectivesBackfill, applyPdtp2026ObjectivesPlan } = await import("../apply-pdtp-2026-objectives")
    const { PDTP_2026_OBJECTIVES } = await import("@/lib/services/pdtp/objectives")

    await insertProgram("prog-1", 2026)
    // Una actividad por cada uno de los 8 objetivos (primer número de su rango),
    // más una retirada y una fuera del rango 1..89.
    await insertActivity({ id: "act-1", programId: "prog-1", n: 1 })
    await insertActivity({ id: "act-2", programId: "prog-1", n: 10 })
    await insertActivity({ id: "act-3", programId: "prog-1", n: 35 })
    await insertActivity({ id: "act-4", programId: "prog-1", n: 51 })
    await insertActivity({ id: "act-5", programId: "prog-1", n: 61 })
    await insertActivity({ id: "act-6", programId: "prog-1", n: 66 })
    await insertActivity({ id: "act-7", programId: "prog-1", n: 79 })
    await insertActivity({ id: "act-8", programId: "prog-1", n: 85, status: "retired" })
    await insertActivity({ id: "act-9", programId: "prog-1", n: 9999 }) // no clasifica

    const plan = await planPdtp2026ObjectivesBackfill("prog-1")
    expect(plan.objectivesToCreate).toHaveLength(8)
    expect(plan.activityAssignments).toHaveLength(8) // act-9 queda fuera

    const result = await applyPdtp2026ObjectivesPlan("prog-1", plan)
    expect(result).toEqual({ objectivesCreated: 8, activitiesAssigned: 8 })

    const objectives = await inMemoryDb.select().from(schema.pdtpObjectives).where(eq(schema.pdtpObjectives.programId, "prog-1"))
    expect(objectives).toHaveLength(8)
    expect(new Set(objectives.map((o) => o.code))).toEqual(new Set(PDTP_2026_OBJECTIVES.map((o) => o.code)))

    const objectiveIdByCode = new Map(objectives.map((o) => [o.code, o.id]))
    const activities = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.programId, "prog-1"))
    const activityById = new Map(activities.map((a) => [a.id, a]))
    expect(activityById.get("act-1")?.objectiveId).toBe(objectiveIdByCode.get("1"))
    expect(activityById.get("act-2")?.objectiveId).toBe(objectiveIdByCode.get("2"))
    expect(activityById.get("act-3")?.objectiveId).toBe(objectiveIdByCode.get("3"))
    expect(activityById.get("act-4")?.objectiveId).toBe(objectiveIdByCode.get("4"))
    expect(activityById.get("act-5")?.objectiveId).toBe(objectiveIdByCode.get("5"))
    expect(activityById.get("act-6")?.objectiveId).toBe(objectiveIdByCode.get("6"))
    expect(activityById.get("act-7")?.objectiveId).toBe(objectiveIdByCode.get("7"))
    // La retirada también recibe objetivo por número.
    expect(activityById.get("act-8")?.objectiveId).toBe(objectiveIdByCode.get("8"))
    // Fuera de rango: sigue sin objetivo.
    expect(activityById.get("act-9")?.objectiveId).toBeNull()

    // Segunda corrida: idempotente. Ni objetivos duplicados ni reasignación.
    const secondPlan = await planPdtp2026ObjectivesBackfill("prog-1")
    expect(secondPlan.objectivesToCreate).toHaveLength(0)
    expect(secondPlan.activityAssignments).toHaveLength(0)
    const secondResult = await applyPdtp2026ObjectivesPlan("prog-1", secondPlan)
    expect(secondResult).toEqual({ objectivesCreated: 0, activitiesAssigned: 0 })

    const objectivesAfterSecondRun = await inMemoryDb.select().from(schema.pdtpObjectives).where(eq(schema.pdtpObjectives.programId, "prog-1"))
    expect(objectivesAfterSecondRun).toHaveLength(8)
  })

  it("no reasigna una actividad que ya tiene un objetivo manual, aunque su número indique otro", async () => {
    const { planPdtp2026ObjectivesBackfill, applyPdtp2026ObjectivesPlan } = await import("../apply-pdtp-2026-objectives")

    await insertProgram("prog-2", 2026)
    const now = new Date().toISOString()
    // Objetivo manual, con código que no pertenece al catálogo 2026, creado
    // por el usuario antes de correr el backfill.
    await inMemoryDb.insert(schema.pdtpObjectives).values({
      id: "objective-manual",
      programId: "prog-2",
      code: "manual",
      name: "Objetivo creado a mano",
      displayOrder: 0,
      createdAt: now,
      updatedAt: now,
    })
    // N°1 caería en el objetivo "1" del catálogo, pero ya está asignada a mano.
    await insertActivity({ id: "act-manual", programId: "prog-2", n: 1, objectiveId: "objective-manual" })
    await insertActivity({ id: "act-libre", programId: "prog-2", n: 2 })

    const plan = await planPdtp2026ObjectivesBackfill("prog-2")
    expect(plan.activityAssignments).toEqual([{ activityId: "act-libre", objectiveCode: "1" }])

    await applyPdtp2026ObjectivesPlan("prog-2", plan)

    const [manual] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.id, "act-manual"))
    expect(manual?.objectiveId).toBe("objective-manual")
  })
})
