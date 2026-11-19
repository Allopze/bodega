/**
 * Programación de lunes a sábado (Reporte de Equipos v03), contra Postgres real.
 *
 * El día de la semana lo decide el snapshot de la plantilla del programa
 * (`scheduleSkipsSundays`), no el registro de definiciones en código. La
 * contraparte es igual de importante: una plantilla v02, sin el campo, sigue
 * creando ejecuciones en domingo.
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import type { WorksiteScope } from "@/lib/auth/scope"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb
const clock = { today: "2026-11-15" }

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))
vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  todayInChile: () => clock.today,
}))

import { createInspectionProgram } from "@/lib/services/prevention-inspections"
import { materializeProgramRuns } from "@/lib/services/prevention-inspection-scheduler"
import { isSunday } from "@/lib/prevention/inspections"

const worksiteId = "ws-sundays"
const userId = "user-sundays"
const TEMPLATE_V03 = "tpl-sundays-v03"
const TEMPLATE_V02 = "tpl-sundays-v02"
const access = {
  userId,
  scope: { mode: "some", ids: [worksiteId] } as WorksiteScope,
  permissions: ["prevention:inspections:view", "prevention:inspections:manage", "prevention:inspections:execute"],
}

async function seedTemplate(id: string, snapshot: Record<string, unknown>, status = "approved") {
  const now = new Date().toISOString()
  await testDb.insert(schema.preventionInspectionTemplates).values({
    id, code: id, versionLabel: "01", name: "Reporte de Equipos", kind: "inspection",
    sourceDefinitionCode: "reporte_equipos", definitionSnapshot: snapshot,
    contentHash: id.padEnd(64, "0").slice(0, 64), status,
    authorUserId: userId, approvedByUserId: userId, approvedAt: now, createdAt: now, updatedAt: now,
  })
}

async function programOf(templateId: string, startsOn: string) {
  return createInspectionProgram({ templateId, worksiteId, frequency: "daily", startsOn }, access)
}
const nextDueOf = async (programId: string) =>
  (await testDb.select().from(schema.preventionInspectionPrograms).where(eq(schema.preventionInspectionPrograms.id, programId)))[0]!.nextDueOn
const runsOf = (programId: string) =>
  testDb.select().from(schema.preventionInspectionRuns).where(eq(schema.preventionInspectionRuns.programId, programId))

describe("programación de lunes a sábado", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    const now = new Date().toISOString()
    await testDb.insert(schema.users).values({
      id: userId, name: "Prevencionista", email: "sundays@chome.cl", hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now,
    })
    await testDb.insert(schema.worksites).values({ id: worksiteId, name: "Faena Domingos", code: "SUND", isActive: true, createdAt: now, updatedAt: now })
    await seedTemplate(TEMPLATE_V03, { scheduleSkipsSundays: true })
    await seedTemplate(TEMPLATE_V02, { version: "02" })
  })

  afterEach(async () => {
    // El barrido del cron recorre TODOS los programas vencidos: cada caso arranca limpio.
    await testDb.delete(schema.preventionInspectionRuns)
    await testDb.delete(schema.preventionInspectionPrograms)
  })

  afterAll(async () => pg.close())

  it("un vencimiento en domingo no crea nada: la fecha pasa al lunes", async () => {
    clock.today = "2026-11-15" // domingo
    const program = await programOf(TEMPLATE_V03, "2026-11-15")
    const result = await materializeProgramRuns()
    expect(result).toMatchObject({ created: 0, skippedSunday: 1, errors: 0 })
    expect(await runsOf(program.id)).toHaveLength(0)
    expect(await nextDueOf(program.id)).toBe("2026-11-16")

    // Idempotente: otro disparo el mismo domingo ya no encuentra el programa vencido.
    expect(await materializeProgramRuns()).toMatchObject({ examined: 0, created: 0, skippedSunday: 0 })
    expect(await nextDueOf(program.id)).toBe("2026-11-16")
  })

  it("el lunes crea la ejecución del lunes y la siguiente fecha es el martes", async () => {
    clock.today = "2026-11-16"
    const program = await programOf(TEMPLATE_V03, "2026-11-16")
    await materializeProgramRuns()
    const runs = await runsOf(program.id)
    expect(runs.map((run) => run.scheduledFor)).toEqual(["2026-11-16"])
    expect(await nextDueOf(program.id)).toBe("2026-11-17")
  })

  it("si el cron no corrió el domingo, el lunes crea la del lunes y nunca una con fecha de domingo", async () => {
    clock.today = "2026-11-16"
    const program = await programOf(TEMPLATE_V03, "2026-11-15")
    await materializeProgramRuns()
    const runs = await runsOf(program.id)
    expect(runs.map((run) => run.scheduledFor)).toEqual(["2026-11-16"])
    expect(await nextDueOf(program.id)).toBe("2026-11-17")
  })

  it("un programa atrasado varias semanas crea UNA ejecución y la siguiente fecha salta el domingo", async () => {
    clock.today = "2026-11-21" // sábado
    const program = await programOf(TEMPLATE_V03, "2026-10-05")
    await materializeProgramRuns()
    const runs = await runsOf(program.id)
    expect(runs).toHaveLength(1)
    expect(runs.some((run) => isSunday(run.scheduledFor!))).toBe(false)
    expect(await nextDueOf(program.id)).toBe("2026-11-23") // el domingo 22 se salta

    // Y el barrido siguiente (hoy sigue siendo sábado) ya no encuentra nada vencido.
    expect(await materializeProgramRuns()).toMatchObject({ examined: 0, created: 0 })
    expect(await runsOf(program.id)).toHaveLength(1)
  })

  it("«Ejecutar ahora» sobre un domingo crea la ejecución del lunes", async () => {
    clock.today = "2026-11-15"
    const program = await programOf(TEMPLATE_V03, "2026-11-15")
    const result = await materializeProgramRuns({ programId: program.id })
    expect(result.created).toBe(1)
    expect((await runsOf(program.id)).map((run) => run.scheduledFor)).toEqual(["2026-11-16"])
    expect(await nextDueOf(program.id)).toBe("2026-11-17")
  })

  it("no avisa ni cuenta como plantilla detenida cuando el domingo cae sobre una plantilla reemplazada", async () => {
    await seedTemplate("tpl-sundays-superseded", { scheduleSkipsSundays: true }, "superseded")
    clock.today = "2026-11-15"
    const program = await programOf(TEMPLATE_V03, "2026-11-15")
    await testDb.update(schema.preventionInspectionPrograms)
      .set({ templateId: "tpl-sundays-superseded" })
      .where(eq(schema.preventionInspectionPrograms.id, program.id))
    const result = await materializeProgramRuns()
    expect(result).toMatchObject({ skippedSunday: 1, skippedTemplate: 0, created: 0 })
  })

  it("una plantilla v02 (sin el campo) sigue creando la ejecución del domingo", async () => {
    clock.today = "2026-11-15"
    const program = await programOf(TEMPLATE_V02, "2026-11-15")
    const result = await materializeProgramRuns()
    expect(result).toMatchObject({ created: 1, skippedSunday: 0 })
    expect((await runsOf(program.id)).map((run) => run.scheduledFor)).toEqual(["2026-11-15"])
    expect(await nextDueOf(program.id)).toBe("2026-11-16")
  })

  it("el campo sólo manda con frecuencia diaria: un semanal no lo usa", async () => {
    clock.today = "2026-11-15"
    const weekly = await createInspectionProgram({ templateId: TEMPLATE_V03, worksiteId, frequency: "weekly", startsOn: "2026-11-15" }, access)
    await materializeProgramRuns()
    expect((await runsOf(weekly.id)).map((run) => run.scheduledFor)).toEqual(["2026-11-15"])
  })
})
