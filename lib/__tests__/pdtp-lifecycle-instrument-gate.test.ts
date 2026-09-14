/**
 * lib/__tests__/pdtp-lifecycle-instrument-gate.test.ts
 *
 * Qué frena el ciclo de vida del programa y qué sólo se informa.
 *
 * La compuerta de cobertura (`assertPdtpFulfillmentCoverage`) clasifica cada
 * actividad activa; este archivo fija quién de esas clasificaciones bloquea.
 * La regla: sólo bloquea lo que se arregla dentro del programa —el mecanismo
 * sin clasificar y el responsable que no puede registrar—. Que el curso, la
 * plantilla o el plan todavía no existan (o existan sin aprobar) no impide
 * firmar ni activar: son instrumentos externos que se crean después, y
 * mientras no existan esas actividades simplemente no acreditan cumplimiento.
 *
 * El programa tiene que poder usarse desde el día uno; la cobertura se
 * completa mientras corre.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import { chileDateParts } from "@/lib/utils"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite es compatible en runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const {
  getPdtpSubmitReviewBlockers,
  getPdtpCoverageReport,
  submitPdtpProgramForReview,
  approvePdtpProgramJdpr,
  signPdtpProgramLegal,
  activatePdtpProgram,
} = await import("@/lib/services/pdtp/lifecycle")
const { assertPdtpFulfillmentCoverage } = await import("@/lib/services/pdtp/fulfillment")

const PROGRAM_YEAR = chileDateParts().year
const PROGRAM_ID = "pdtp-gate-v1"
const WS_ID = "ws-gate-1"
const ELABORADOR = "user-gate-elaborador"
const JDPR = "user-gate-jdpr"
const LEGAL = "user-gate-legal"

async function seedProgram() {
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, version: 1, year: PROGRAM_YEAR, title: `PDTP ${PROGRAM_YEAR} compuerta`,
    status: "draft", elaboratedByName: "Prevencionista", elaboratedByTitle: "Experto en Prevención",
    creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
    // PDTP-003: el fixture no lista faenas; declara el alcance corporativo,
    // que es lo que su comportamiento significaba antes de tener que decirlo.
    appliesToAllWorksites: true,
    createdAt: now, updatedAt: now,
  })
}

/** Una actividad de enganche cuyo número nadie declara: el caso "el curso o el
 *  mapa todavía no existe". Sale de la compuerta como `config_required`. */
async function seedActivitySinInstrumento(overrides: Partial<typeof schema.pdtpActivities.$inferInsert> = {}) {
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: `${PROGRAM_ID}-a-099`, programId: PROGRAM_ID, n: 99,
    activity: "Capacitar en el riesgo crítico del mapa", program: "Prevención PDTP",
    responsibleSlugs: ["prevencionista"], responsibleDisplay: "Prevencionista",
    scheduleMode: "scheduled", scheduleClassificationStatus: "confirmed",
    mechanism: "enganche",
    sourceSheetRow: 1, createdAt: now, updatedAt: now,
    ...overrides,
  })
}

/** Recorre el ciclo completo y devuelve el programa activo. */
async function firmarYActivar() {
  await submitPdtpProgramForReview(PROGRAM_ID, ELABORADOR)
  await approvePdtpProgramJdpr(PROGRAM_ID, JDPR)
  await signPdtpProgramLegal(PROGRAM_ID, LEGAL)
  return activatePdtpProgram(PROGRAM_ID, JDPR)
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpFulfillmentEvents)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpProgramWorksites)
  await inMemoryDb.delete(schema.pdtpApprovalDecisions)
  await inMemoryDb.delete(schema.pdtpApprovalSteps)
  await inMemoryDb.delete(schema.pdtpChangeLog)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.preventionTrainingCourses)
  await inMemoryDb.delete(schema.pdtpResponsibleCatalog)
  await inMemoryDb.delete(schema.rolePermissions)
  await inMemoryDb.delete(schema.permissions)
  await inMemoryDb.delete(schema.roles)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values([
    { id: ELABORADOR, name: "Prevencionista", email: "gate-prev@example.test", hashedPassword: "x" },
    { id: JDPR, name: "Jefatura DPR", email: "gate-jdpr@example.test", hashedPassword: "x" },
    { id: LEGAL, name: "Legal", email: "gate-legal@example.test", hashedPassword: "x" },
  ])
  await inMemoryDb.insert(schema.worksites).values({ id: WS_ID, name: "Faena Compuerta", code: "FC", isActive: true })
  await inMemoryDb.insert(schema.pdtpResponsibleCatalog).values({
    slug: "prevencionista", displayName: "Prevencionista", roleName: "prevencionista_faena", kind: "rbac_role",
  })
  await inMemoryDb.insert(schema.roles).values({ id: "role-gate", name: "prevencionista_faena", label: "Prevencionista de faena" })
  await inMemoryDb.insert(schema.permissions).values([
    { id: "perm-gate-constancias", name: "prevention:constancias:execute", module: "prevention" },
    { id: "perm-gate-pdtp", name: "prevention:pdtp:execute", module: "prevention" },
  ])
  await inMemoryDb.insert(schema.rolePermissions).values([
    { roleId: "role-gate", permissionId: "perm-gate-constancias" },
    { roleId: "role-gate", permissionId: "perm-gate-pdtp" },
  ])

  await seedProgram()
})

describe("un instrumento que todavía no existe no frena el ciclo de vida", () => {
  it("el curso o el mapa sin crear se informa, pero no bloquea el envío a revisión", async () => {
    await seedActivitySinInstrumento()

    expect(await assertPdtpFulfillmentCoverage(PROGRAM_ID))
      .toEqual([expect.objectContaining({ n: 99, status: "config_required" })])
    expect(await getPdtpSubmitReviewBlockers(PROGRAM_ID)).toEqual([])
  })

  it("el programa se firma y se activa con la actividad sin instrumento declarado", async () => {
    await seedActivitySinInstrumento()

    const activado = await firmarYActivar()
    expect(activado.status).toBe("active")
  })

  it("el programa se activa con un curso declarado pero sin versión publicada", async () => {
    const now = new Date().toISOString()
    await seedActivitySinInstrumento({ id: `${PROGRAM_ID}-a-063`, n: 63 })
    await inMemoryDb.insert(schema.preventionTrainingCourses).values({
      id: "course-gate-63", code: "PDTP-63", name: "Inducción del trabajador", kind: "induction_worksite",
      minimumDurationMinutes: 60, isActive: true, createdByUserId: ELABORADOR,
      pdtpActivityNumbers: [63], createdAt: now, updatedAt: now,
    })

    expect(await assertPdtpFulfillmentCoverage(PROGRAM_ID))
      .toEqual([expect.objectContaining({ n: 63, status: "instrument_required" })])

    const activado = await firmarYActivar()
    expect(activado.status).toBe("active")
  })

  it("activar no mueve la actividad a listas: sigue sin acreditar", async () => {
    await seedActivitySinInstrumento()
    await firmarYActivar()

    // El informe se sigue pudiendo pedir con el programa ACTIVO —la pantalla
    // lo muestra ahí, que es cuando completar la cobertura es el trabajo que
    // queda— y la actividad sigue contada como trabajo prometido que no
    // acredita: 0 de 1 listas. Si alguien "arregla" esto excluyendo del
    // denominador lo que no tiene instrumento, el cumplimiento se vería sano
    // sin que nadie haya hecho el trabajo, y este test es lo que lo impide.
    const report = await getPdtpCoverageReport(PROGRAM_ID)
    expect(report.total).toBe(1)
    expect(report.ready).toBe(0)
    expect(report.groups).toEqual([
      expect.objectContaining({ status: "config_required", blocks: false }),
    ])
  })

  it("el informe de cobertura marca esas actividades como no bloqueantes", async () => {
    await seedActivitySinInstrumento()

    const report = await getPdtpCoverageReport(PROGRAM_ID)
    expect(report.total).toBe(1)
    expect(report.ready).toBe(0)
    expect(report.groups).toEqual([
      expect.objectContaining({ status: "config_required", blocks: false }),
    ])
  })
})

describe("lo que sí sigue frenando el ciclo de vida", () => {
  it("una actividad sin mecanismo clasificado bloquea el envío", async () => {
    await seedActivitySinInstrumento({ mechanism: "sin_definir" })

    const blockers = await getPdtpSubmitReviewBlockers(PROGRAM_ID)
    expect(blockers).toHaveLength(1)
    expect(blockers[0]).toMatch(/sin mecanismo de acreditación clasificado/i)
    await expect(submitPdtpProgramForReview(PROGRAM_ID, ELABORADOR)).rejects.toThrow(/mecanismo de acreditación/i)
  })

  it("un responsable que no mapea a un rol real bloquea el envío", async () => {
    await seedActivitySinInstrumento({ responsibleSlugs: ["inventado"] })

    const blockers = await getPdtpSubmitReviewBlockers(PROGRAM_ID)
    expect(blockers).toHaveLength(1)
    expect(blockers[0]).toMatch(/responsable que pueda registrar el cumplimiento/i)
    await expect(submitPdtpProgramForReview(PROGRAM_ID, ELABORADOR)).rejects.toThrow(/responsable/i)
  })

  it("un mecanismo sin clasificar sigue frenando la activación aunque se haya firmado", async () => {
    await seedActivitySinInstrumento()
    await submitPdtpProgramForReview(PROGRAM_ID, ELABORADOR)
    await approvePdtpProgramJdpr(PROGRAM_ID, JDPR)
    await signPdtpProgramLegal(PROGRAM_ID, LEGAL)

    // El contenido se degrada fuera del servicio: lo que se fija acá es que la
    // compuerta de ACTIVACIÓN sigue mirando `code_gap`, no que se pueda editar
    // un programa en revisión.
    await inMemoryDb.update(schema.pdtpActivities).set({ mechanism: "sin_definir" })
      .where(eq(schema.pdtpActivities.id, `${PROGRAM_ID}-a-099`))

    await expect(activatePdtpProgram(PROGRAM_ID, JDPR)).rejects.toThrow(/mecanismo de acreditación/i)
    // El mensaje se afirma a propósito, y el estado también: si alguien mueve
    // la compuerta de cobertura después del chequeo de digest, este caso
    // seguiría lanzando —por huella desajustada— y pasaría por el motivo
    // equivocado. Las dos aserciones juntas son lo que fija QUÉ lo frenó.
    const [program] = await inMemoryDb.select().from(schema.pdtpPrograms)
      .where(eq(schema.pdtpPrograms.id, PROGRAM_ID))
    expect(program?.status).toBe("in_review")
  })
})
