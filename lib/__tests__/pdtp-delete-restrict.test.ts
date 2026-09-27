/**
 * PREV-M04 + PREV-M09 (tanda T7a, migración M-3).
 *
 * M04 — Borrar un programa arrastraba por cascada ejecuciones aprobadas, desvíos
 * y cierres firmados. La app sólo lo permitía en borrador, pero un script o un
 * SQL manual se lo llevaba todo sin dejar rastro, y `rollbackPdtpImportBatch`
 * borraba ejecuciones aprobadas si nadie había escrito en el change log (las
 * aprobaciones no escriben ahí). Ahora la base se defiende sola (`ON DELETE
 * RESTRICT` en ejecuciones, desvíos y cierres) y los dos caminos de borrado de
 * la app aplican D26: un borrador se borra sólo si no tiene ejecuciones
 * aprobadas ni cierres; lo demás que cuelga de él se borra explícitamente.
 *
 * M09 — `pdtp_executions` no tenía un índice que empezara por `activity_id`
 * (el único es el único parcial, que no sirve fuera de su predicado) y
 * `pdtp_executions_scheduled_instance_idx` duplicaba el índice único de la
 * misma columna.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

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

const NOW = new Date().toISOString()

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpPeriodClosures)
  await inMemoryDb.delete(schema.pdtpExecutionDeviations)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpImportBatches)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.pdtpResponsibleCatalog)
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({ id: "user-1", name: "U1", email: "u1@test", hashedPassword: "x", isActive: true })
  await inMemoryDb.insert(schema.worksites).values({ id: "ws-1", name: "Faena 1", code: "F1", isActive: true })
  await inMemoryDb.insert(schema.pdtpResponsibleCatalog).values([
    { slug: "prevencionista", displayName: "Prevencionista", kind: "role" },
  ])
})

async function draftProgramWithActivity(year = 2071) {
  const { createLegacyPdtpProgramForTests, addPdtpActivity } = await import("@/lib/services/prevention-pdtp")
  const program = await createLegacyPdtpProgramForTests({ year, title: `Programa ${year}`, userId: "user-1" })
  const activity = await addPdtpActivity({
    programId: program.id,
    activity: "Actividad de prueba",
    program: "Guía de ejecución",
    responsibleSlugs: ["prevencionista"],
    responsibleDisplay: "Prevencionista",
    sheetCodes: [],
    scheduleMode: "on_demand",
  }, "user-1")
  return { program, activity }
}

async function insertExecution(activityId: string, status: "draft" | "submitted" | "approved", extra: Partial<typeof schema.pdtpExecutions.$inferInsert> = {}) {
  const id = `exec-${status}-${Math.random().toString(36).slice(2, 8)}`
  await inMemoryDb.insert(schema.pdtpExecutions).values({
    id, activityId, worksiteId: "ws-1", year: 2071, month: 3, week: 1,
    executedQuantity: 1, status,
    ...(status === "approved" ? { approvedAt: NOW } : {}),
    createdAt: NOW, updatedAt: NOW,
    ...extra,
  })
  return id
}

async function insertDeviation(activityId: string) {
  await inMemoryDb.insert(schema.pdtpExecutionDeviations).values({
    id: `dev-${Math.random().toString(36).slice(2, 8)}`,
    activityId, worksiteId: "ws-1", year: 2071, month: 4, week: 2,
    kind: "not_applicable", reason: "No aplica en esta semana por detención de faena.",
    status: "active", createdByUserId: "user-1", createdAt: NOW,
  })
}

async function insertClosure(programId: string) {
  await inMemoryDb.insert(schema.pdtpPeriodClosures).values({
    id: `clo-${Math.random().toString(36).slice(2, 8)}`,
    programId, worksiteId: "ws-1", year: 2071, month: 2,
    snapshotJson: {}, digest: "d".repeat(64),
    closedByUserId: "user-1", closedAt: NOW, closeReason: "Cierre mensual de prueba.",
    createdAt: NOW, updatedAt: NOW,
  })
}

/** SQLSTATE de `ON DELETE RESTRICT` (una FK `NO ACTION`/cascada daría 23503 o nada). */
const RESTRICT_VIOLATION = "23001"

/** El código SQLSTATE del error, se reporte como se reporte. */
async function sqlState(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run()
    return undefined
  } catch (error) {
    const err = error as { code?: string; cause?: { code?: string } }
    return err.code ?? err.cause?.code
  }
}

describe("M04 — la base se defiende de un borrado manual", () => {
  it("no deja borrar una actividad con ejecuciones", async () => {
    const { activity } = await draftProgramWithActivity()
    await insertExecution(activity.id, "approved")
    expect(await sqlState(() => inMemoryDb.delete(schema.pdtpActivities).where(eq(schema.pdtpActivities.id, activity.id)))).toBe(RESTRICT_VIOLATION)
    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(1)
  })

  it("no deja borrar una actividad con desvíos", async () => {
    const { activity } = await draftProgramWithActivity()
    await insertDeviation(activity.id)
    expect(await sqlState(() => inMemoryDb.delete(schema.pdtpActivities).where(eq(schema.pdtpActivities.id, activity.id)))).toBe(RESTRICT_VIOLATION)
  })

  it("no deja borrar un programa con cierres", async () => {
    const { program } = await draftProgramWithActivity()
    await insertClosure(program.id)
    expect(await sqlState(() => inMemoryDb.delete(schema.pdtpPrograms).where(eq(schema.pdtpPrograms.id, program.id)))).toBe(RESTRICT_VIOLATION)
    expect(await inMemoryDb.select().from(schema.pdtpPeriodClosures)).toHaveLength(1)
  })

  it("no deja borrar un programa cuyas actividades tienen ejecuciones", async () => {
    const { program, activity } = await draftProgramWithActivity()
    await insertExecution(activity.id, "draft")
    expect(await sqlState(() => inMemoryDb.delete(schema.pdtpPrograms).where(eq(schema.pdtpPrograms.id, program.id)))).toBe(RESTRICT_VIOLATION)
  })
})

describe("M09 — índices de pdtp_executions y pdtp_obligations", () => {
  async function indexDef(name: string): Promise<string | null> {
    const result = await pg.query<{ indexdef: string }>("SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1", [name])
    return result.rows[0]?.indexdef ?? null
  }

  it("ejecuciones y obligaciones tienen un índice que empieza por activity_id", async () => {
    expect(await indexDef("pdtp_executions_activity_worksite_year_idx")).toMatch(/\(activity_id, worksite_id, year\)/)
    expect(await indexDef("pdtp_obligations_activity_worksite_idx")).toMatch(/\(activity_id, worksite_id\)/)
  })

  it("el índice redundante de la instancia programada se fue y el único se queda", async () => {
    expect(await indexDef("pdtp_executions_scheduled_instance_idx")).toBeNull()
    expect(await indexDef("pdtp_executions_scheduled_instance_unique")).toMatch(/UNIQUE INDEX .*\(scheduled_instance_id\)/)
  })
})

describe("D26 — deletePdtpProgram", () => {
  it("borra un borrador con ejecuciones sin aprobar y sus desvíos", async () => {
    const { deletePdtpProgram } = await import("@/lib/services/pdtp/programs")
    const { program, activity } = await draftProgramWithActivity()
    await insertExecution(activity.id, "draft")
    await insertExecution(activity.id, "submitted", { week: 2 })
    await insertDeviation(activity.id)

    await expect(deletePdtpProgram(program.id)).resolves.toBeUndefined()
    expect(await inMemoryDb.select().from(schema.pdtpPrograms).where(eq(schema.pdtpPrograms.id, program.id))).toHaveLength(0)
    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(0)
    expect(await inMemoryDb.select().from(schema.pdtpExecutionDeviations)).toHaveLength(0)
  })

  it("se niega si el borrador tiene una ejecución aprobada, y no borra nada", async () => {
    const { deletePdtpProgram } = await import("@/lib/services/pdtp/programs")
    const { program, activity } = await draftProgramWithActivity()
    await insertExecution(activity.id, "approved")
    await insertExecution(activity.id, "draft", { week: 2 })

    await expect(deletePdtpProgram(program.id)).rejects.toThrow(/aprobada/i)
    expect(await inMemoryDb.select().from(schema.pdtpPrograms).where(eq(schema.pdtpPrograms.id, program.id))).toHaveLength(1)
    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(2)
  })

  it("se niega si el borrador tiene cierres", async () => {
    const { deletePdtpProgram } = await import("@/lib/services/pdtp/programs")
    const { program } = await draftProgramWithActivity()
    await insertClosure(program.id)

    await expect(deletePdtpProgram(program.id)).rejects.toThrow(/cierre/i)
    expect(await inMemoryDb.select().from(schema.pdtpPrograms).where(eq(schema.pdtpPrograms.id, program.id))).toHaveLength(1)
  })
})

describe("D26 — rollbackPdtpImportBatch", () => {
  async function appliedBatch(programId: string) {
    const id = `batch-${Math.random().toString(36).slice(2, 8)}`
    await inMemoryDb.insert(schema.pdtpImportBatches).values({
      id, programId, status: "applied",
      sourceFileName: "historico.xlsx", sourceMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sourceSizeBytes: 10, sourceChecksumSha256: "c".repeat(64), previewJson: {},
      preApplySnapshotJson: { program: {}, activities: [], schedules: [], memberships: [], sheets: [], importedActivityIds: [], newlyCreatedActivityIds: [] },
      targetWorksiteId: "ws-1",
      requestedByUserId: "user-1", appliedByUserId: "user-1",
      createdAt: NOW, updatedAt: NOW, // Aplicado después de armar el programa: el change log del alta de la
      // actividad no cuenta como "cambio posterior al lote".
      appliedAt: new Date(Date.now() + 1_000).toISOString(),
    })
    return id
  }

  it("revierte un lote cuyas ejecuciones no están aprobadas", async () => {
    const { rollbackPdtpImportBatch } = await import("@/lib/services/pdtp/imports")
    const { program, activity } = await draftProgramWithActivity()
    const batchId = await appliedBatch(program.id)
    await insertExecution(activity.id, "submitted", { origin: "xlsx_import", importBatchId: batchId })

    await rollbackPdtpImportBatch({ batchId, userId: "user-1", reason: "Reversión controlada del lote.", scope: ["ws-1"] })
    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(0)
    const [batch] = await inMemoryDb.select().from(schema.pdtpImportBatches).where(eq(schema.pdtpImportBatches.id, batchId))
    expect(batch!.status).toBe("rolled_back")
  })

  it("se niega si el lote trajo una ejecución que ya se aprobó", async () => {
    const { rollbackPdtpImportBatch } = await import("@/lib/services/pdtp/imports")
    const { program, activity } = await draftProgramWithActivity()
    const batchId = await appliedBatch(program.id)
    await insertExecution(activity.id, "approved", { origin: "xlsx_import", importBatchId: batchId })

    await expect(rollbackPdtpImportBatch({ batchId, userId: "user-1", reason: "Reversión controlada del lote.", scope: ["ws-1"] }))
      .rejects.toThrow(/aprobada/i)
    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(1)
    const [batch] = await inMemoryDb.select().from(schema.pdtpImportBatches).where(eq(schema.pdtpImportBatches.id, batchId))
    expect(batch!.status).toBe("applied")
  })

  it("se niega si el programa ya tiene cierres en la faena del lote", async () => {
    const { rollbackPdtpImportBatch } = await import("@/lib/services/pdtp/imports")
    const { program, activity } = await draftProgramWithActivity()
    const batchId = await appliedBatch(program.id)
    await insertExecution(activity.id, "submitted", { origin: "xlsx_import", importBatchId: batchId })
    await insertClosure(program.id)

    await expect(rollbackPdtpImportBatch({ batchId, userId: "user-1", reason: "Reversión controlada del lote.", scope: ["ws-1"] }))
      .rejects.toThrow(/cierre/i)
    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(1)
  })
})
