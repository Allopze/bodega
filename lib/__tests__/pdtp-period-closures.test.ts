/**
 * Cierre mensual por faena (`lib/services/pdtp/period-closures.ts`) contra
 * Postgres real (PGlite).
 *
 * Lo que se prueba, en orden de importancia:
 *  · la foto: que el snapshot embeba RE-36, indicadores, desvíos y objetivos,
 *    y que su digest sea un sha256 completo;
 *  · el bloqueo: que un mes cerrado rechace toda escritura manual sobre sus
 *    celdas, y que reabrir las devuelva;
 *  · la excepción deliberada: que la acreditación por integración siga
 *    pasando y que eso quede visible como `driftedSinceClose`.
 *
 * Import dinámico dentro de cada `it()`: un import estático del barrel
 * resuelve `@/db` antes de que `globalThis.__db` quede asignado más abajo
 * (mismo patrón que `pdtp-deviations.test.ts`).
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

// Un Cloudreve en memoria para el archivado del RE-36 congelado (al final).
const fakeCloudreve = vi.hoisted(() => ({ files: new Map<string, Buffer>() }))
vi.mock("@/lib/services/cloudreve/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/cloudreve/client")>()),
  ensureCloudreveCollections: async () => undefined,
  putCloudreveKey: async (key: string, buffer: Buffer) => { fakeCloudreve.files.set(key, buffer) },
  statCloudreveKey: async (key: string) => (fakeCloudreve.files.has(key) ? { size: fakeCloudreve.files.get(key)!.length } : null),
}))
vi.mock("@/lib/services/cloudreve/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/cloudreve/settings")>()),
  readCloudreveConfig: async () => ({ baseUrl: "https://cloudreve.test", username: "u", password: "p", sstPath: "storage/sst-documents", hasCredentials: true }),
}))

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
  await inMemoryDb.delete(schema.pdtpPeriodClosures)
  await inMemoryDb.delete(schema.pdtpExecutionDeviations)
  await inMemoryDb.delete(schema.pdtpChangeLog)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivityScheduleOverrides)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteExclusions)
  await inMemoryDb.delete(schema.pdtpProgramWorksites)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  await inMemoryDb.delete(schema.pdtpSheetActivities)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.pdtpResponsibleCatalog)
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values([
    { id: "user-1", name: "Cierra", email: "u1@test", hashedPassword: "x", isActive: true },
    { id: "user-2", name: "Aprueba", email: "u2@test", hashedPassword: "x", isActive: true },
  ])
  await inMemoryDb.insert(schema.pdtpResponsibleCatalog).values([
    { slug: "prevencionista", displayName: "Prevencionista", kind: "role" },
  ])
  await inMemoryDb.insert(schema.worksites).values([
    { id: "ws-1", name: "Faena 1", code: "F1", isActive: true },
    { id: "ws-2", name: "Faena 2", code: "F2", isActive: true },
  ])
})

/**
 * El año del programa es el año en curso: cerrar exige que el mes ya haya
 * ocurrido, así que un año futuro (como los 2060 de otros tests) no sirve acá.
 */
const YEAR = new Date().getFullYear()
/** Enero siempre está en el pasado o es el mes en curso. */
const MONTH = 1

async function createActiveProgram(cell = { month: MONTH, week: 1, plannedQuantity: 4 }) {
  const { createLegacyPdtpProgramForTests, addPdtpActivity } = await import("@/lib/services/prevention-pdtp")
  const program = await createLegacyPdtpProgramForTests({ year: YEAR, title: `Programa ${YEAR}`, userId: "user-1" })
  const activity = await addPdtpActivity({
    programId: program.id,
    activity: "Charla de seguridad",
    program: "Guía de ejecución",
    responsibleSlugs: ["prevencionista"],
    responsibleDisplay: "Prevencionista",
    sheetCodes: [],
    scheduleMode: "on_demand",
  }, "user-1")
  await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
    id: `${activity.id}-s-${YEAR}-${String(cell.month).padStart(2, "0")}-${cell.week}`,
    activityId: activity.id,
    year: YEAR,
    month: cell.month,
    week: cell.week,
    plannedQuantity: cell.plannedQuantity,
    sourceColumn: "test",
  })
  const [sheet] = await inMemoryDb.select().from(schema.pdtpSheets).where(eq(schema.pdtpSheets.programId, program.id))
  await inMemoryDb.insert(schema.pdtpSheetActivities).values({
    id: `membership-${activity.id}`, sheetId: sheet!.id, sheetCode: "pdtp_general",
    activityId: activity.id, sheetRow: 1, displayOrder: 1,
  })
  // Activado a comienzos de año: todos los meses del año quedan exigibles.
  await inMemoryDb.update(schema.pdtpPrograms)
    .set({ status: "active", activatedAt: `${YEAR}-01-01T00:00:00.000Z` })
    .where(eq(schema.pdtpPrograms.id, program.id))
  const [activated] = await inMemoryDb.select().from(schema.pdtpPrograms).where(eq(schema.pdtpPrograms.id, program.id))
  return { program: activated!, activity }
}

const REASON = "Mes revisado con la jefatura de faena y conciliado con las evidencias."

describe("closePdtpPeriod: la foto congelada", () => {
  it("crea el snapshot con re36, indicadores, desvíos y objetivos, y un digest de 64 caracteres", async () => {
    const { closePdtpPeriod } = await import("@/lib/services/pdtp/period-closures")
    const { recordPdtpDeviation } = await import("@/lib/services/pdtp/deviations")
    const { program, activity } = await createActiveProgram()

    await recordPdtpDeviation({
      activityId: activity.id, worksiteId: "ws-1", year: YEAR, month: MONTH, week: 1,
      kind: "not_performed", reason: "No se alcanzó a dictar la charla por lluvia en la faena.",
    }, "user-1", "all")

    const closure = await closePdtpPeriod({
      programId: program.id, worksiteId: "ws-1", year: YEAR, month: MONTH, reason: REASON,
    }, "user-1", "all")

    expect(closure.status).toBe("closed")
    expect(closure.version).toBe(1)
    expect(closure.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(closure.id).toBe(`pdtp-close-${program.id}-ws-1-${YEAR}-01`)

    const snapshot = closure.snapshotJson as Record<string, unknown>
    expect(snapshot.schemaVersion).toBe(1)
    expect(snapshot.cutoff).toMatchObject({ year: YEAR, month: MONTH })
    expect(snapshot.re36).toBeTruthy()
    expect(snapshot.indicators).toBeTruthy()
    expect(snapshot.managementReport).toBeTruthy()
    expect(Array.isArray(snapshot.deviations)).toBe(true)
    expect((snapshot.deviations as unknown[]).length).toBe(1)
    expect(Array.isArray(snapshot.objectives)).toBe(true)
    expect(snapshot.programVersion).toMatchObject({ version: program.version })
  })

  it("deja una entrada de control de cambios y una de auditoría con acción 'close'", async () => {
    const { closePdtpPeriod } = await import("@/lib/services/pdtp/period-closures")
    const { program } = await createActiveProgram()

    await closePdtpPeriod({
      programId: program.id, worksiteId: "ws-1", year: YEAR, month: MONTH, reason: REASON,
    }, "user-1", "all")

    const changeLog = await inMemoryDb.select().from(schema.pdtpChangeLog)
    expect(changeLog.some((entry) => entry.section === `closure:${YEAR}-01`)).toBe(true)
    const audit = await inMemoryDb.select().from(schema.auditLog)
    expect(audit.some((entry) => entry.action === "close" && entry.entityType === "pdtp_period_closure")).toBe(true)
  })

  it("cerrar dos veces incrementa `version` y reemplaza el snapshot", async () => {
    const { closePdtpPeriod } = await import("@/lib/services/pdtp/period-closures")
    const { reopenPdtpPeriod } = await import("@/lib/services/pdtp/period-closures")
    const { markPdtpExecution, approvePdtpExecution } = await import("@/lib/services/prevention-pdtp")
    const { program, activity } = await createActiveProgram()

    const first = await closePdtpPeriod({
      programId: program.id, worksiteId: "ws-1", year: YEAR, month: MONTH, reason: REASON,
    }, "user-1", "all")
    expect(first.version).toBe(1)

    // Reabrir, cargar ejecución aprobada y volver a cerrar: la foto cambia.
    await reopenPdtpPeriod({ closureId: first.id, reason: "Faltaba cargar la evidencia de la charla dictada." }, "user-1", "all")
    const execution = await markPdtpExecution({
      activityId: activity.id, worksiteId: "ws-1", year: YEAR, month: MONTH, week: 1, executedQuantity: 4,
    }, "user-1", "all")
    await approvePdtpExecution(execution.id, "user-2", "all")

    const second = await closePdtpPeriod({
      programId: program.id, worksiteId: "ws-1", year: YEAR, month: MONTH, reason: REASON,
    }, "user-1", "all")
    expect(second.id).toBe(first.id)
    expect(second.version).toBe(2)
    expect(second.status).toBe("closed")
    expect(second.digest).not.toBe(first.digest)
    // La reapertura anterior deja de describir el estado vigente.
    expect(second.reopenedByUserId).toBeNull()
    expect(second.reopenReason).toBeNull()

    const rows = await inMemoryDb.select().from(schema.pdtpPeriodClosures)
    expect(rows).toHaveLength(1)
  })

  it("el snapshot es reproducible: cerrar dos veces sin cambios da el mismo digest", async () => {
    const { closePdtpPeriod, reopenPdtpPeriod } = await import("@/lib/services/pdtp/period-closures")
    const { program } = await createActiveProgram()

    const first = await closePdtpPeriod({
      programId: program.id, worksiteId: "ws-1", year: YEAR, month: MONTH, reason: REASON,
    }, "user-1", "all")
    await reopenPdtpPeriod({ closureId: first.id, reason: "Se revisa de nuevo sin cambiar ningún dato." }, "user-1", "all")
    const second = await closePdtpPeriod({
      programId: program.id, worksiteId: "ws-1", year: YEAR, month: MONTH, reason: REASON,
    }, "user-1", "all")

    expect(second.digest).toBe(first.digest)
  })
})

describe("closePdtpPeriod: validaciones", () => {
  it("no cierra un mes futuro", async () => {
    const { closePdtpPeriod } = await import("@/lib/services/pdtp/period-closures")
    const { program } = await createActiveProgram()

    await expect(closePdtpPeriod({
      programId: program.id, worksiteId: "ws-1", year: YEAR + 1, month: 12, reason: REASON,
    }, "user-1", "all")).rejects.toThrow()
  })

  it("no cierra un mes anterior a la activación del programa", async () => {
    const { closePdtpPeriod } = await import("@/lib/services/pdtp/period-closures")
    const { program } = await createActiveProgram({ month: 6, week: 1, plannedQuantity: 2 })
    await inMemoryDb.update(schema.pdtpPrograms)
      .set({ activatedAt: `${YEAR}-06-01T00:00:00.000Z` })
      .where(eq(schema.pdtpPrograms.id, program.id))

    await expect(closePdtpPeriod({
      programId: program.id, worksiteId: "ws-1", year: YEAR, month: 1, reason: REASON,
    }, "user-1", "all")).rejects.toThrow(/no estaba activo/i)
  })

  it("una faena fuera del alcance del usuario falla", async () => {
    const { closePdtpPeriod } = await import("@/lib/services/pdtp/period-closures")
    const { program } = await createActiveProgram()

    await expect(closePdtpPeriod({
      programId: program.id, worksiteId: "ws-2", year: YEAR, month: MONTH, reason: REASON,
    }, "user-1", ["ws-1"])).rejects.toThrow()
  })

  it("exige un motivo de al menos 10 caracteres", async () => {
    const { closePdtpPeriod } = await import("@/lib/services/pdtp/period-closures")
    const { program } = await createActiveProgram()

    await expect(closePdtpPeriod({
      programId: program.id, worksiteId: "ws-1", year: YEAR, month: MONTH, reason: "corto",
    }, "user-1", "all")).rejects.toThrow()
  })
})

describe("mes cerrado: bloqueo de escrituras", () => {
  async function closedProgram() {
    const { closePdtpPeriod } = await import("@/lib/services/pdtp/period-closures")
    const created = await createActiveProgram()
    const closure = await closePdtpPeriod({
      programId: created.program.id, worksiteId: "ws-1", year: YEAR, month: MONTH, reason: REASON,
    }, "user-1", "all")
    return { ...created, closure }
  }

  it("rechaza `markPdtpExecution` en el mes cerrado", async () => {
    const { markPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    const { activity } = await closedProgram()

    await expect(markPdtpExecution({
      activityId: activity.id, worksiteId: "ws-1", year: YEAR, month: MONTH, week: 1, executedQuantity: 1,
    }, "user-1", "all")).rejects.toThrow(/cerrado/i)
  })

  it("rechaza `approvePdtpExecution` de una ejecución cargada antes del cierre", async () => {
    const { markPdtpExecution, approvePdtpExecution } = await import("@/lib/services/prevention-pdtp")
    const { closePdtpPeriod } = await import("@/lib/services/pdtp/period-closures")
    const { program, activity } = await createActiveProgram()

    const execution = await markPdtpExecution({
      activityId: activity.id, worksiteId: "ws-1", year: YEAR, month: MONTH, week: 1, executedQuantity: 1,
    }, "user-1", "all")
    await closePdtpPeriod({
      programId: program.id, worksiteId: "ws-1", year: YEAR, month: MONTH, reason: REASON,
    }, "user-1", "all")

    await expect(approvePdtpExecution(execution.id, "user-2", "all")).rejects.toThrow(/cerrado/i)
  })

  it("rechaza `rejectPdtpExecution` en el mes cerrado", async () => {
    const { markPdtpExecution, rejectPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    const { closePdtpPeriod } = await import("@/lib/services/pdtp/period-closures")
    const { program, activity } = await createActiveProgram()

    const execution = await markPdtpExecution({
      activityId: activity.id, worksiteId: "ws-1", year: YEAR, month: MONTH, week: 1, executedQuantity: 1,
    }, "user-1", "all")
    await closePdtpPeriod({
      programId: program.id, worksiteId: "ws-1", year: YEAR, month: MONTH, reason: REASON,
    }, "user-1", "all")

    await expect(rejectPdtpExecution(execution.id, "user-2", "No corresponde", "all")).rejects.toThrow(/cerrado/i)
  })

  it("rechaza `recordPdtpDeviation` en el mes cerrado", async () => {
    const { recordPdtpDeviation } = await import("@/lib/services/pdtp/deviations")
    const { activity } = await closedProgram()

    await expect(recordPdtpDeviation({
      activityId: activity.id, worksiteId: "ws-1", year: YEAR, month: MONTH, week: 1,
      kind: "not_performed", reason: "No se alcanzó a dictar la charla por lluvia en la faena.",
    }, "user-1", "all")).rejects.toThrow(/cerrado/i)
  })

  it("rechaza un `reprogrammed` cuyo DESTINO cae en un mes cerrado, aunque el origen esté abierto", async () => {
    const { recordPdtpDeviation } = await import("@/lib/services/pdtp/deviations")
    const { closePdtpPeriod } = await import("@/lib/services/pdtp/period-closures")
    const { program, activity } = await createActiveProgram({ month: 2, week: 1, plannedQuantity: 3 })

    // Se cierra ENERO (destino); febrero (origen) queda abierto.
    await closePdtpPeriod({
      programId: program.id, worksiteId: "ws-1", year: YEAR, month: 1, reason: REASON,
    }, "user-1", "all")

    await expect(recordPdtpDeviation({
      activityId: activity.id, worksiteId: "ws-1", year: YEAR, month: 2, week: 1,
      kind: "reprogrammed", reason: "Se mueve la charla a la semana de enero por disponibilidad.",
      targetMonth: 1, targetWeek: 2,
    }, "user-1", "all")).rejects.toThrow(/cerrado/i)
  })

  it("rechaza `withdrawPdtpDeviation` en el mes cerrado", async () => {
    const { recordPdtpDeviation, withdrawPdtpDeviation } = await import("@/lib/services/pdtp/deviations")
    const { closePdtpPeriod } = await import("@/lib/services/pdtp/period-closures")
    const { program, activity } = await createActiveProgram()

    const deviation = await recordPdtpDeviation({
      activityId: activity.id, worksiteId: "ws-1", year: YEAR, month: MONTH, week: 1,
      kind: "not_performed", reason: "No se alcanzó a dictar la charla por lluvia en la faena.",
    }, "user-1", "all")
    await closePdtpPeriod({
      programId: program.id, worksiteId: "ws-1", year: YEAR, month: MONTH, reason: REASON,
    }, "user-1", "all")

    await expect(withdrawPdtpDeviation({
      deviationId: deviation.id, reason: "Se retira porque la charla sí se dictó ese día.",
    }, "user-1", "all")).rejects.toThrow(/cerrado/i)
  })

  it("rechaza `setPdtpActivityOverride` en el mes cerrado", async () => {
    const { setPdtpActivityOverride } = await import("@/lib/services/pdtp/overrides")
    const { activity } = await closedProgram()

    await expect(setPdtpActivityOverride({
      activityId: activity.id, worksiteId: "ws-1", year: YEAR, month: MONTH, week: 1,
      plannedQuantity: 9, reason: "Ajuste de meta por dotación de la faena.",
    }, "user-1", "all")).rejects.toThrow(/cerrado/i)
  })

  it("rechaza `deletePdtpActivityOverride` en el mes cerrado", async () => {
    // Borrar un override devuelve la meta al valor global del catálogo: cambia
    // el planificado del mes igual que crearlo. Sin este guard, el bloqueo del
    // cierre se podía saltar por la puerta de atrás.
    const { setPdtpActivityOverride, deletePdtpActivityOverride } = await import("@/lib/services/pdtp/overrides")
    const { closePdtpPeriod } = await import("@/lib/services/pdtp/period-closures")
    const { program, activity } = await createActiveProgram()

    await setPdtpActivityOverride({
      activityId: activity.id, worksiteId: "ws-1", year: YEAR, month: MONTH, week: 1,
      plannedQuantity: 9, reason: "Ajuste de meta por dotación de la faena.",
    }, "user-1", "all")
    await closePdtpPeriod({
      programId: program.id, worksiteId: "ws-1", year: YEAR, month: MONTH, reason: REASON,
    }, "user-1", "all")

    await expect(deletePdtpActivityOverride({
      activityId: activity.id, worksiteId: "ws-1", year: YEAR, month: MONTH, week: 1,
      reason: "Se revierte la meta especial de la faena.",
    }, "user-1", "all")).rejects.toThrow(/cerrado/i)
  })

  it("`deletePdtpActivityOverride` sigue funcionando en un mes abierto", async () => {
    const { setPdtpActivityOverride, deletePdtpActivityOverride } = await import("@/lib/services/pdtp/overrides")
    const { activity } = await createActiveProgram()

    await setPdtpActivityOverride({
      activityId: activity.id, worksiteId: "ws-1", year: YEAR, month: MONTH, week: 1,
      plannedQuantity: 9, reason: "Ajuste de meta por dotación de la faena.",
    }, "user-1", "all")
    await expect(deletePdtpActivityOverride({
      activityId: activity.id, worksiteId: "ws-1", year: YEAR, month: MONTH, week: 1,
      reason: "Se revierte la meta especial de la faena.",
    }, "user-1", "all")).resolves.toBeUndefined()
  })

  it("no bloquea otra faena ni otro mes", async () => {
    const { markPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    const { activity } = await closedProgram()

    // Otra faena, mismo mes.
    await expect(markPdtpExecution({
      activityId: activity.id, worksiteId: "ws-2", year: YEAR, month: MONTH, week: 1, executedQuantity: 1,
    }, "user-1", "all")).resolves.toBeTruthy()
  })
})

describe("reopenPdtpPeriod", () => {
  it("exige un motivo de al menos 10 caracteres", async () => {
    const { closePdtpPeriod, reopenPdtpPeriod } = await import("@/lib/services/pdtp/period-closures")
    const { program } = await createActiveProgram()
    const closure = await closePdtpPeriod({
      programId: program.id, worksiteId: "ws-1", year: YEAR, month: MONTH, reason: REASON,
    }, "user-1", "all")

    await expect(reopenPdtpPeriod({ closureId: closure.id, reason: "corto" }, "user-1", "all")).rejects.toThrow()
  })

  it("vuelve a permitir escrituras y conserva el snapshot", async () => {
    const { closePdtpPeriod, reopenPdtpPeriod } = await import("@/lib/services/pdtp/period-closures")
    const { markPdtpExecution } = await import("@/lib/services/prevention-pdtp")
    const { program, activity } = await createActiveProgram()

    const closure = await closePdtpPeriod({
      programId: program.id, worksiteId: "ws-1", year: YEAR, month: MONTH, reason: REASON,
    }, "user-1", "all")
    const reopened = await reopenPdtpPeriod({
      closureId: closure.id, reason: "Faltaba cargar la evidencia de la charla dictada el día 12.",
    }, "user-1", "all")

    expect(reopened.status).toBe("reopened")
    expect(reopened.reopenedByUserId).toBe("user-1")
    // La foto que ya se distribuyó no se borra al reabrir.
    expect(reopened.digest).toBe(closure.digest)
    expect(reopened.snapshotJson).toBeTruthy()

    await expect(markPdtpExecution({
      activityId: activity.id, worksiteId: "ws-1", year: YEAR, month: MONTH, week: 1, executedQuantity: 2,
    }, "user-1", "all")).resolves.toBeTruthy()
  })

  it("no reabre dos veces", async () => {
    const { closePdtpPeriod, reopenPdtpPeriod } = await import("@/lib/services/pdtp/period-closures")
    const { program } = await createActiveProgram()
    const closure = await closePdtpPeriod({
      programId: program.id, worksiteId: "ws-1", year: YEAR, month: MONTH, reason: REASON,
    }, "user-1", "all")
    await reopenPdtpPeriod({ closureId: closure.id, reason: "Se reabre para corregir la evidencia." }, "user-1", "all")

    await expect(reopenPdtpPeriod({
      closureId: closure.id, reason: "Se reabre otra vez para corregir la evidencia.",
    }, "user-1", "all")).rejects.toThrow(/ya está reabierto/i)
  })
})

describe("acreditación por integración y `driftedSinceClose`", () => {
  it("la acreditación por integración sigue pasando en un mes cerrado y el cierre queda marcado como desviado", async () => {
    const { closePdtpPeriod, getPdtpPeriodClosure } = await import("@/lib/services/pdtp/period-closures")
    const { program, activity } = await createActiveProgram()

    const closure = await closePdtpPeriod({
      programId: program.id, worksiteId: "ws-1", year: YEAR, month: MONTH, reason: REASON,
    }, "user-1", "all")
    expect((await getPdtpPeriodClosure(closure.id, "all"))!.driftedSinceClose).toBe(false)

    // Una ejecución `origin: 'integration'` escrita directamente: es lo que
    // `accreditPdtpFromEvent` deja en la tabla, y el punto es que el cierre NO
    // la impide (un hecho de otro módulo no puede fallar por esto).
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: `exec-integration-${activity.id}`,
      activityId: activity.id, worksiteId: "ws-1", year: YEAR, month: MONTH, week: 1,
      executedQuantity: 4, status: "approved", origin: "integration",
      approvedByUserId: "user-2", approvedAt: now, executedAt: now, createdAt: now, updatedAt: now,
    })

    const afterDrift = await getPdtpPeriodClosure(closure.id, "all")
    expect(afterDrift!.driftedSinceClose).toBe(true)
    // La foto congelada no cambió: sigue siendo lo que se distribuyó.
    expect(afterDrift!.digest).toBe(closure.digest)
  })
})

describe("listPdtpPeriodClosures", () => {
  it("lista los cierres del programa con faena y autor, acotado al alcance", async () => {
    const { closePdtpPeriod, listPdtpPeriodClosures } = await import("@/lib/services/pdtp/period-closures")
    const { program } = await createActiveProgram()

    await closePdtpPeriod({ programId: program.id, worksiteId: "ws-1", year: YEAR, month: MONTH, reason: REASON }, "user-1", "all")
    await closePdtpPeriod({ programId: program.id, worksiteId: "ws-2", year: YEAR, month: MONTH, reason: REASON }, "user-1", "all")

    const all = await listPdtpPeriodClosures(program.id, "all")
    expect(all).toHaveLength(2)
    expect(all[0]!.closedByName).toBe("Cierra")
    expect(all.map((row) => row.worksiteName).sort()).toEqual(["Faena 1", "Faena 2"])

    const scoped = await listPdtpPeriodClosures(program.id, ["ws-1"])
    expect(scoped).toHaveLength(1)
    expect(scoped[0]!.worksiteId).toBe("ws-1")
  })
})

describe("archivado del RE-36 congelado en Cloudreve", () => {
  it("cada versión del cierre es su propia copia; la reemplazada no se imprime con su nombre", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const storage = mkdtempSync(path.join(tmpdir(), "pdtp-closure-archive-"))
    const previous = { storage: process.env.STORAGE_PATH, flag: process.env.GENERATED_DOCS_ARCHIVE_ENABLED }
    process.env.STORAGE_PATH = storage
    process.env.GENERATED_DOCS_ARCHIVE_ENABLED = "true"
    fakeCloudreve.files.clear()
    try {
      const { closePdtpPeriod, reopenPdtpPeriod } = await import("@/lib/services/pdtp/period-closures")
      const { drainGeneratedDocuments } = await import("@/lib/services/generated-documents/drain")
      await inMemoryDb.delete(schema.generatedDocumentArchives)
      await inMemoryDb.insert(schema.systemSettings).values({ key: "storage.generated_docs.enabled", value: "true" })
        .onConflictDoUpdate({ target: schema.systemSettings.key, set: { value: "true" } })
      const { program } = await createActiveProgram()

      const first = await closePdtpPeriod({ programId: program.id, worksiteId: "ws-1", year: YEAR, month: MONTH, reason: REASON }, "user-1", "all")
      await reopenPdtpPeriod({ closureId: first.id, reason: "Faltaba cargar la evidencia de la charla dictada." }, "user-1", "all")
      await closePdtpPeriod({ programId: program.id, worksiteId: "ws-1", year: YEAR, month: MONTH, reason: REASON }, "user-1", "all")

      const queued = await inMemoryDb.select().from(schema.generatedDocumentArchives)
      expect(queued.map((row) => [row.kind, row.milestone, row.revision, row.documentYear]).sort()).toEqual([
        ["pdtp_cierre", "cierre", 1, YEAR],
        ["pdtp_cierre", "cierre", 2, YEAR],
      ])

      const summary = await drainGeneratedDocuments()
      expect(summary).toMatchObject({ processed: 2, uploaded: 1, superseded: 1 })
      const key = `Documentos generados/Faena 1/RE-36-PDTP-${YEAR}-01-F1-cierre-v2.xlsx`
      expect([...fakeCloudreve.files.keys()]).toEqual([key])
      // Un .xlsx es un ZIP: el libro se armó de verdad desde la foto.
      expect(fakeCloudreve.files.get(key)!.subarray(0, 2).toString("latin1")).toBe("PK")
    } finally {
      await inMemoryDb.delete(schema.systemSettings)
      // Asignar `undefined` a process.env deja el texto "undefined": se borra.
      if (previous.storage === undefined) delete process.env.STORAGE_PATH
      else process.env.STORAGE_PATH = previous.storage
      if (previous.flag === undefined) delete process.env.GENERATED_DOCS_ARCHIVE_ENABLED
      else process.env.GENERATED_DOCS_ARCHIVE_ENABLED = previous.flag
      rmSync(storage, { recursive: true, force: true })
    }
  })
})

