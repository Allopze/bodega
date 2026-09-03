/**
 * lib/__tests__/pdtp-constancias.test.ts
 *
 * Submódulo Constancias (G17): `listPdtpConstanciaActivities` replica la
 * regla "primer mes impago" de la cola operacional (`impago.mes` en
 * operational-work-queue.ts) para que el badge de /pendientes y esta lista
 * cuenten exactamente lo mismo, y `assertPdtpActivityMechanism` es la
 * compuerta que evita que `prevention:constancias:execute` sirva para marcar
 * cualquier actividad de la planilla.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import { chileDateParts } from "@/lib/utils"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const { listPdtpConstanciaActivities, assertPdtpActivityMechanism } = await import("@/lib/services/pdtp/constancias")

const { year: PROGRAM_YEAR, month: CURRENT_MONTH } = chileDateParts()
/** Enero no tiene mes anterior dentro del año: el caso "vencida" se apoya en
 * el mes en curso y las pruebas que lo necesitan se saltan sin él. */
const PREVIOUS_MONTH = CURRENT_MONTH > 1 ? CURRENT_MONTH - 1 : null
const PROGRAM_ID = "pdtp-constancias-v1"
const WS_A = "ws-constancias-a"
const WS_B = "ws-constancias-b"
const ACT_N = 61
const ACT_ID = `${PROGRAM_ID}-a-${String(ACT_N).padStart(3, "0")}`

async function seedProgram(status: "draft" | "active" = "active") {
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, version: 1, year: PROGRAM_YEAR, title: `PDTP ${PROGRAM_YEAR} constancias`,
    status, elaboratedByName: "Prevencionista", elaboratedByTitle: "Experto en Prevención",
    creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  })
}

async function seedActivity(overrides: Partial<typeof schema.pdtpActivities.$inferInsert> = {}) {
  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: ACT_ID, programId: PROGRAM_ID, n: ACT_N,
    activity: "Controlar los certificados que acrediten la idoneidad del producto",
    program: "Prevención PDTP",
    responsibleSlugs: ["prf"], responsibleDisplay: "Prevencionista de riesgos en faena",
    scheduleMode: "scheduled", scheduleClassificationStatus: "confirmed",
    mechanism: "constancia", evidenceRequirement: "Certificado vigente",
    sourceSheetRow: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  })
}

async function seedSchedule(worksiteId: string, month: number, plannedQuantity = 1) {
  await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
    id: `${ACT_ID}-s-${PROGRAM_YEAR}-${String(month).padStart(2, "0")}-1`,
    activityId: ACT_ID, year: PROGRAM_YEAR, month, week: 1, plannedQuantity, sourceColumn: "manual",
  })
  // La planificación no es por faena en el schema (es una sola fila por
  // actividad/mes/semana); lo que cambia por faena es si hay ejecución. Un
  // segundo `insert` con el mismo `id` para otra faena violaría la PK, así
  // que sólo se siembra una vez y el test usa `worksiteId` sólo para elegir
  // dónde marcar la ejecución.
  void worksiteId
}

async function markExecuted(worksiteId: string, month: number, status: "submitted" | "approved" | "draft" = "approved") {
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.pdtpExecutions).values({
    id: `${ACT_ID}-e-${worksiteId}-${PROGRAM_YEAR}-${String(month).padStart(2, "0")}-1`,
    activityId: ACT_ID, worksiteId, year: PROGRAM_YEAR, month, week: 1,
    executedQuantity: 1, status, origin: "manual", createdAt: now, updatedAt: now,
  })
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteExclusions)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  await inMemoryDb.delete(schema.pdtpProgramWorksites)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.pdtpResponsibleCatalog)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({ id: "user-constancias-1", name: "U1", email: "u1-constancias@test", hashedPassword: "x" })
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS_A, name: "Faena A", code: "FA", isActive: true },
    { id: WS_B, name: "Faena B", code: "FB", isActive: true },
  ])
  await inMemoryDb.insert(schema.pdtpResponsibleCatalog).values({
    slug: "prf", displayName: "Prevencionista de riesgos en faena", roleName: "prevencionista_faena", kind: "rbac_role",
  })
})

describe("listPdtpConstanciaActivities", () => {
  it("sin programa activo, devuelve null (no hay dónde marcar)", async () => {
    await seedProgram("draft")
    await seedActivity()
    await seedSchedule(WS_A, CURRENT_MONTH)
    expect(await listPdtpConstanciaActivities("all")).toBeNull()
  })

  it("una actividad planificada este mes sin marcar es 'pending', con el mes en curso como deuda", async () => {
    await seedProgram("active")
    await seedActivity()
    await seedSchedule(WS_A, CURRENT_MONTH)

    // Acotado a WS_A: en scope "all" la misma fila de schedule (no es por
    // faena) también generaría deuda para WS_B, que no es lo que este caso
    // prueba — eso lo cubre el test de alcance más abajo.
    const view = await listPdtpConstanciaActivities([WS_A])
    expect(view?.debts).toHaveLength(1)
    expect(view?.debts[0]).toMatchObject({
      activityId: ACT_ID, n: ACT_N, worksiteId: WS_A, dueMonth: CURRENT_MONTH, status: "pending", overdueMonths: 0,
    })
  })

  it("un mes anterior sin marcar es 'overdue' y queda como el mes que corresponde marcar, no el actual", async () => {
    if (PREVIOUS_MONTH === null) return // enero: no hay mes anterior en el año
    await seedProgram("active")
    await seedActivity()
    await seedSchedule(WS_A, PREVIOUS_MONTH)
    await seedSchedule(WS_A, CURRENT_MONTH)

    const view = await listPdtpConstanciaActivities([WS_A])
    expect(view?.debts).toHaveLength(1) // una fila, no una por mes vencido
    expect(view?.debts[0]).toMatchObject({ dueMonth: PREVIOUS_MONTH, status: "overdue", overdueMonths: 1 })
  })

  it("marcar con status 'submitted' o 'approved' salda la deuda; 'draft' no", async () => {
    await seedProgram("active")
    await seedActivity()
    await seedSchedule(WS_A, CURRENT_MONTH)
    await markExecuted(WS_A, CURRENT_MONTH, "submitted")
    expect((await listPdtpConstanciaActivities([WS_A]))?.debts).toHaveLength(0)

    await inMemoryDb.delete(schema.pdtpExecutions)
    await markExecuted(WS_A, CURRENT_MONTH, "draft")
    const view = await listPdtpConstanciaActivities([WS_A])
    expect(view?.debts).toHaveLength(1) // draft no cuenta como marcado
  })

  it("respeta el alcance de faenas del usuario: sin acceso a WS_B, su deuda no aparece", async () => {
    await seedProgram("active")
    await seedActivity()
    await seedSchedule(WS_A, CURRENT_MONTH)

    const view = await listPdtpConstanciaActivities([WS_A])
    expect(view?.debts.map((debt) => debt.worksiteId)).toEqual([WS_A])
  })

  it("una faena excluida de la actividad (R4) no aporta deuda", async () => {
    await seedProgram("active")
    await seedActivity()
    await seedSchedule(WS_A, CURRENT_MONTH)
    await inMemoryDb.insert(schema.pdtpActivityWorksiteExclusions).values({
      id: `${ACT_ID}-excl-${WS_A}`, activityId: ACT_ID, worksiteId: WS_A,
      reason: "Faena sin el requisito.", createdByUserId: "user-constancias-1", createdAt: new Date().toISOString(),
    })
    const view = await listPdtpConstanciaActivities([WS_A])
    expect(view?.debts).toHaveLength(0)
  })

  it("una actividad de otro mecanismo (enganche) no entra a la lista", async () => {
    await seedProgram("active")
    await seedActivity({ mechanism: "enganche" })
    await seedSchedule(WS_A, CURRENT_MONTH)
    const view = await listPdtpConstanciaActivities("all")
    expect(view?.debts).toHaveLength(0)
  })

  it("sin actividad planificada este mes ni antes, no hay deuda (no confundir con 'al día')", async () => {
    await seedProgram("active")
    await seedActivity()
    const view = await listPdtpConstanciaActivities("all")
    expect(view?.debts).toHaveLength(0)
    expect(view?.programId).toBe(PROGRAM_ID)
  })
})

describe("assertPdtpActivityMechanism", () => {
  it("resuelve cuando el mecanismo coincide", async () => {
    await seedProgram("active")
    await seedActivity({ mechanism: "constancia" })
    await expect(assertPdtpActivityMechanism(ACT_ID, "constancia")).resolves.toBeUndefined()
  })

  it("lanza cuando el mecanismo no coincide — la compuerta de alcance de prevention:constancias:execute", async () => {
    await seedProgram("active")
    await seedActivity({ mechanism: "enganche" })
    await expect(assertPdtpActivityMechanism(ACT_ID, "constancia")).rejects.toThrow(/no se puede registrar desde Constancias/)
  })

  it("lanza cuando la actividad no existe", async () => {
    await expect(assertPdtpActivityMechanism("no-existe", "constancia")).rejects.toThrow()
  })
})
