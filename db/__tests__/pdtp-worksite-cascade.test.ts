import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
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

/**
 * H-B12: documenta la política de cascade entre `worksites` y las
 * tablas PDTP. La política adoptada es:
 * - `pdtp_executions.worksiteId`: NO ACTION. Las ejecuciones (datos
 *   legales/trazabilidad) deben sobrevivir a la eliminación de la
 *   faena. Si negocio necesita "borrar" una faena, debe usar
 *   `isActive = false` (soft delete).
 * - `pdtp_activity_schedule_overrides.worksiteId`: CASCADE. Los
 *   overrides son configuración de planificación, no datos legales.
 */
describe("PDTP — política de cascade en worksite (H-B12)", () => {
  beforeEach(async () => {
    await inMemoryDb.delete(schema.pdtpActivityScheduleOverrides)
    await inMemoryDb.delete(schema.pdtpExecutions)
    await inMemoryDb.delete(schema.pdtpActivitySchedule)
    await inMemoryDb.delete(schema.pdtpSheetActivities)
    await inMemoryDb.delete(schema.pdtpSheets)
    await inMemoryDb.delete(schema.pdtpActivities)
    await inMemoryDb.delete(schema.pdtpResponsibleCatalog)
    await inMemoryDb.delete(schema.pdtpChangeLog)
    await inMemoryDb.delete(schema.pdtpPrograms)
    await inMemoryDb.delete(schema.worksites)
    await inMemoryDb.delete(schema.users)
  })

  async function setupProgramAndActivity() {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.users).values({
      id: "u1", name: "U1", email: "u1@test", hashedPassword: "x", isActive: true,
    })
    await inMemoryDb.insert(schema.worksites).values({
      id: "w1", name: "W1", code: "W1", isActive: true,
    })
    await inMemoryDb.insert(schema.pdtpPrograms).values({
      id: "p1", year: 2026, version: 1, status: "active", title: "T",
      elaboratedByName: "X", elaboratedByTitle: "Y",
      createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.pdtpActivities).values({
      id: "a1", programId: "p1", n: 1, activity: "A", program: "P", responsibleSlugs: [], responsibleDisplay: "R",
      sourceSheetRow: 1, createdAt: now, updatedAt: now,
    })
  }

  it("pdtp_executions NO se borra en cascada cuando se elimina la faena (política de trazabilidad)", async () => {
    await setupProgramAndActivity()
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: "e1", activityId: "a1", worksiteId: "w1",
      year: 2026, month: 1, week: 1,
      executedQuantity: 1, status: "submitted",
      evidencePhotos: [], createdAt: now, updatedAt: now,
    })

    // Eliminar la faena debe fallar por FK constraint (NO ACTION).
    let thrown: unknown = null
    try { await inMemoryDb.delete(schema.worksites).where(eq(schema.worksites.id, "w1")) }
    catch (e) { thrown = e }
    expect(thrown).toBeTruthy()
    const cause = (thrown as { cause?: { message?: string } }).cause
    const msg = `${(thrown as Error).message}\n${cause?.message ?? ""}`
    expect(msg).toMatch(/violates foreign key|constraint/i)

    // La ejecución sigue existiendo (no se borró en cascada).
    const execs = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(execs).toHaveLength(1)
  })

  it("pdtp_activity_schedule_overrides SÍ se borra en cascada cuando se elimina la faena (configuración)", async () => {
    await setupProgramAndActivity()
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpActivityScheduleOverrides).values({
      id: "ov1", activityId: "a1", worksiteId: "w1",
      year: 2026, month: 1, week: 1,
      plannedQuantity: 5, updatedByUserId: "u1",
      createdAt: now, updatedAt: now,
    })

    // Para poder borrar la faena, primero borramos la ejecución
    // (que no se borra en cascada).
    await inMemoryDb.delete(schema.pdtpExecutions)

    // Ahora sí podemos borrar la faena. El override se va en cascada.
    await inMemoryDb.delete(schema.worksites).where(eq(schema.worksites.id, "w1"))

    const overrides = await inMemoryDb.select().from(schema.pdtpActivityScheduleOverrides)
    expect(overrides).toHaveLength(0)
  })
})
