import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite compatibility
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

const USER_ID = "u-r2-1"
const WS_ID = "ws-r2-1"
const PROGRAM_ID = "pdtp-r2-prog"
const ACT_ID = "pdtp-r2-act-1"

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpActivityWorksiteParams)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: USER_ID,
    name: "User R2",
    email: "r2@example.test",
    hashedPassword: "x",
  })

  await inMemoryDb.insert(schema.worksites).values({
    id: WS_ID,
    name: "Faena R2",
    code: "FR2",
    isActive: true,
  })

  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID,
    year: 2026,
    version: 1,
    title: "PDTP 2026 R2 Test",
    status: "active",
    elaboratedByName: "User R2",
    elaboratedByTitle: "Prevencionista",
    creationMode: "blank",
    complianceTarget: 0.9,
    pesoEjecucion: 0.5,
    pesoVerificacion: 0.3,
    pesoCierre: 0.2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: ACT_ID,
    programId: PROGRAM_ID,
    n: 54,
    activity: "Capacitación Masiva Conductores",
    objective: "Cobertura de personas",
    objectiveOrder: 1,
    program: "Prevención",
    responsibleSlugs: ["prevencionista"],
    responsibleDisplay: "Prevencionista",
    scheduleMode: "scheduled",
    scheduleClassificationStatus: "confirmed",
    indicatorMode: "coverage",
    sourceSheetRow: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
})

describe("Pdtp Activity Worksite Params & Coverage (R1/R2)", () => {
  it("permite guardar y consultar parámetros por faena (esperado sujetos R1 y meta R2)", async () => {
    const { setPdtpActivityWorksiteParams, listPdtpActivityWorksiteParams } = await import("@/lib/services/pdtp/worksites")

    await setPdtpActivityWorksiteParams(ACT_ID, WS_ID, {
      expectedSubjectCount: 15,
      targetCoveragePercent: 90.0,
    }, USER_ID)

    const params = await listPdtpActivityWorksiteParams([ACT_ID], WS_ID)
    expect(params).toHaveLength(1)
    expect(params[0]!.expectedSubjectCount).toBe(15)
    expect(Number(params[0]!.targetCoveragePercent)).toBe(90)
  })

  it("actualiza parámetros existentes de forma idempotente", async () => {
    const { setPdtpActivityWorksiteParams, listPdtpActivityWorksiteParams } = await import("@/lib/services/pdtp/worksites")

    await setPdtpActivityWorksiteParams(ACT_ID, WS_ID, {
      expectedSubjectCount: 10,
    }, USER_ID)

    await setPdtpActivityWorksiteParams(ACT_ID, WS_ID, {
      expectedSubjectCount: 20,
      targetCoveragePercent: 95.5,
    }, USER_ID)

    const params = await listPdtpActivityWorksiteParams([ACT_ID], WS_ID)
    expect(params).toHaveLength(1)
    expect(params[0]!.expectedSubjectCount).toBe(20)
    expect(Number(params[0]!.targetCoveragePercent)).toBe(95.5)
  })
})

/**
 * El cálculo de cobertura (R2). `targetCoveragePercent` se guardaba y se editaba
 * en la matriz de aplicabilidad desde hace tiempo, pero `compliance.ts` lo
 * ignoraba y seguía exigiendo el padrón completo: una actividad con meta 90 %
 * marcaba 0 % de cumplimiento hasta cubrir al último trabajador.
 */
describe("Cobertura R2 — umbral de acreditación en el cumplimiento", () => {
  const now = new Date().toISOString()

  async function seedScheduleAndExecution(executedQuantity: number) {
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
      id: `sch-${ACT_ID}-1`,
      activityId: ACT_ID,
      year: 2026,
      month: 1,
      week: 1,
      plannedQuantity: 1,
      sourceColumn: "test",
    })
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: `exec-${ACT_ID}-1`,
      activityId: ACT_ID,
      worksiteId: WS_ID,
      year: 2026,
      month: 1,
      week: 1,
      executedQuantity,
      status: "approved",
      executedByUserId: USER_ID,
      createdAt: now,
      updatedAt: now,
    })
  }

  async function annualForCoverage(executedQuantity: number, params: {
    expectedSubjectCount: number
    targetCoveragePercent?: number
  }) {
    const { setPdtpActivityWorksiteParams } = await import("@/lib/services/pdtp/worksites")
    const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
    await setPdtpActivityWorksiteParams(ACT_ID, WS_ID, params, USER_ID)
    await seedScheduleAndExecution(executedQuantity)
    const result = await getPdtpComplianceIndicators(PROGRAM_ID, WS_ID)
    return result!.annual
  }

  it("acredita el padrón completo al alcanzar la meta configurada", async () => {
    // Padrón 50, meta 90 % → umbral 45. Sin crédito parcial: aporta 50, no 45.
    const annual = await annualForCoverage(45, { expectedSubjectCount: 50, targetCoveragePercent: 90 })
    expect(annual).toMatchObject({ planned: 50, executed: 50, percent: 1 })
  })

  it("no acredita nada si queda bajo la meta", async () => {
    const annual = await annualForCoverage(44, { expectedSubjectCount: 50, targetCoveragePercent: 90 })
    expect(annual).toMatchObject({ planned: 50, executed: 0, percent: 0 })
  })

  it("sin meta configurada sigue exigiendo el padrón completo", async () => {
    const annual = await annualForCoverage(49, { expectedSubjectCount: 50 })
    expect(annual).toMatchObject({ planned: 50, executed: 0, percent: 0 })
  })

  it("sin meta configurada acredita al cubrir el padrón entero", async () => {
    const annual = await annualForCoverage(50, { expectedSubjectCount: 50 })
    expect(annual).toMatchObject({ planned: 50, executed: 50, percent: 1 })
  })
})

/**
 * El integral agregado NO puede ser el promedio de los integrales por faena:
 * `verificacion` es un promedio de checklists y `cierre` un ratio de acciones, y
 * las faenas rara vez tienen la misma cantidad de cada uno. Promediar promedios
 * da un número distinto y equivocado.
 */
describe("Cumplimiento integral agregado sobre varias faenas", () => {
  const WS_B = "ws-r2-2"
  const ACT_B = "pdtp-r2-act-2"
  const now = new Date().toISOString()

  async function seedTwoWorksites() {
    await inMemoryDb.insert(schema.worksites).values({
      id: WS_B, name: "Faena R2 B", code: "FR2B", isActive: true,
    })
    // Segunda actividad, sin modo cobertura, para no arrastrar la regla R2.
    await inMemoryDb.insert(schema.pdtpActivities).values({
      id: ACT_B, programId: PROGRAM_ID, n: 55, activity: "Inspección planificada",
      objective: "Inspecciones", objectiveOrder: 2, program: "Prevención",
      responsibleSlugs: ["prevencionista"], responsibleDisplay: "Prevencionista",
      scheduleMode: "scheduled", scheduleClassificationStatus: "confirmed",
      indicatorMode: "completed_count", sourceSheetRow: 2,
      createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
      id: `sch-${ACT_B}-1`, activityId: ACT_B, year: 2026, month: 1, week: 1,
      plannedQuantity: 1, sourceColumn: "test",
    })

    // Faena A: 1 checklist al 100 %, 1 acción cerrada.
    // Faena B: 3 checklists al 0 %, 3 acciones abiertas.
    // Promediar por faena daría verificación 50 %; lo correcto sobre las filas
    // crudas es 25 % (1 de 4 instancias al 100).
    const specs = [
      { ws: WS_ID, execId: "exec-agg-a", checklists: [100], estados: ["verificado"] },
      { ws: WS_B, execId: "exec-agg-b", checklists: [0, 0, 0], estados: ["pendiente", "pendiente", "pendiente"] },
    ]
    for (const spec of specs) {
      await inMemoryDb.insert(schema.pdtpExecutions).values({
        id: spec.execId, activityId: ACT_B, worksiteId: spec.ws, year: 2026, month: 1, week: 1,
        executedQuantity: 1, status: "approved", executedByUserId: USER_ID,
        createdAt: now, updatedAt: now,
      })
      await inMemoryDb.insert(schema.pdtpExecutionChecklists).values(
        spec.checklists.map((pct, index) => ({
          id: `chk-${spec.execId}-${index}`, executionId: spec.execId,
          definitionSnapshotJson: {}, overallStatus: "completado",
          // Una instancia por sujeto: la tabla es única en (executionId, subjectId).
          subjectType: "trabajador", subjectId: `w-${spec.execId}-${index}`,
          porcentajeCumplimiento: pct, createdAt: now, updatedAt: now,
        })),
      )
      await inMemoryDb.insert(schema.pdtpActionPlan).values(
        spec.estados.map((estado, index) => ({
          id: `act-${spec.execId}-${index}`, executionId: spec.execId, n: index + 1,
          hallazgo: "Hallazgo", accion: "Acción", responsableRole: "prevencionista",
          responsable: "Prevencionista", plazo: "2026-02-01", estado,
          createdByUserId: USER_ID, createdAt: now, updatedAt: now,
        })),
      )
    }
  }

  it("agrega verificación y cierre sobre las filas, no promediando por faena", async () => {
    const { getPdtpIntegralComplianceForScope, getPdtpIntegralCompliance } =
      await import("@/lib/services/pdtp/compliance")
    await seedTwoWorksites()

    const scoped = await getPdtpIntegralComplianceForScope(PROGRAM_ID, [WS_ID, WS_B])
    expect(scoped).not.toBeNull()

    // 1 de 4 instancias al 100 % → 25 %. Y 1 de 4 acciones cerrada → 25 %.
    expect(scoped!.verificacion).toBe(25)
    expect(scoped!.cierre).toBe(25)

    // El promedio de los integrales por faena da otro número: es justo el
    // atajo que esta función existe para no tomar.
    const perA = await getPdtpIntegralCompliance(PROGRAM_ID, WS_ID)
    const perB = await getPdtpIntegralCompliance(PROGRAM_ID, WS_B)
    const naiveAverage = ((perA!.verificacion ?? 0) + (perB!.verificacion ?? 0)) / 2
    expect(naiveAverage).toBe(50)
    expect(scoped!.verificacion).not.toBe(naiveAverage)
  })

  it("falla cerrado sin faenas en el alcance", async () => {
    const { getPdtpIntegralComplianceForScope } = await import("@/lib/services/pdtp/compliance")
    expect(await getPdtpIntegralComplianceForScope(PROGRAM_ID, [])).toBeNull()
  })
})

describe("Avance por eje SG-SST", () => {
  const WS_B = "ws-cat-2"
  const now = new Date().toISOString()

  async function seedTwoCategories() {
    await inMemoryDb.insert(schema.worksites).values({
      id: WS_B, name: "Faena Cat B", code: "FCB", isActive: true,
    })
    const activities = [
      { id: "act-cat-seg", n: 60, program: "Seguridad" },
      { id: "act-cat-salud", n: 61, program: "Salud Ocupacional" },
    ]
    for (const activity of activities) {
      await inMemoryDb.insert(schema.pdtpActivities).values({
        id: activity.id, programId: PROGRAM_ID, n: activity.n, activity: `Actividad ${activity.n}`,
        objective: "Objetivo", objectiveOrder: 3, program: activity.program,
        responsibleSlugs: ["prevencionista"], responsibleDisplay: "Prevencionista",
        scheduleMode: "scheduled", scheduleClassificationStatus: "confirmed",
        indicatorMode: "completed_count", sourceSheetRow: activity.n,
        createdAt: now, updatedAt: now,
      })
      // 2 planificadas por actividad; el schedule es global, no por faena, pero
      // el agregado lo cuenta una vez por faena en alcance.
      await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
        id: `sch-${activity.id}`, activityId: activity.id, year: 2026, month: 1, week: 1,
        plannedQuantity: 2, sourceColumn: "test",
      })
    }

    // Seguridad: 2 aprobadas en faena A. Salud: 1 aprobada + 1 submitted (no cuenta).
    const executions = [
      { id: "ex-seg-a", activityId: "act-cat-seg", ws: WS_ID, qty: 2, status: "approved" },
      { id: "ex-salud-a", activityId: "act-cat-salud", ws: WS_ID, qty: 1, status: "approved" },
      { id: "ex-salud-b", activityId: "act-cat-salud", ws: WS_B, qty: 5, status: "submitted" },
    ]
    for (const execution of executions) {
      await inMemoryDb.insert(schema.pdtpExecutions).values({
        id: execution.id, activityId: execution.activityId, worksiteId: execution.ws,
        year: 2026, month: 1, week: 1, executedQuantity: execution.qty, status: execution.status,
        executedByUserId: USER_ID, createdAt: now, updatedAt: now,
      })
    }
  }

  it("agrupa por eje contando solo ejecuciones aprobadas", async () => {
    const { getPdtpComplianceByCategoryForScope } = await import("@/lib/services/pdtp/compliance")
    await seedTwoCategories()

    const rows = await getPdtpComplianceByCategoryForScope(PROGRAM_ID, [WS_ID, WS_B])
    const byCategory = new Map(rows!.map((row) => [row.category, row]))

    // Planificado: 2 por faena × 2 faenas = 4 en cada eje.
    expect(byCategory.get("Seguridad")).toMatchObject({ planned: 4, executed: 2 })
    // La ejecución `submitted` de la faena B no aporta: solo cuenta 1.
    expect(byCategory.get("Salud Ocupacional")).toMatchObject({ planned: 4, executed: 1 })
  })

  it("excluye las actividades de cobertura del desglose", async () => {
    const { getPdtpComplianceByCategoryForScope } = await import("@/lib/services/pdtp/compliance")
    await seedTwoCategories()
    // ACT_ID es `indicatorMode: "coverage"` y su eje es "Prevención".
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
      id: `sch-${ACT_ID}-cat`, activityId: ACT_ID, year: 2026, month: 1, week: 1,
      plannedQuantity: 9, sourceColumn: "test",
    })

    const rows = await getPdtpComplianceByCategoryForScope(PROGRAM_ID, [WS_ID, WS_B])
    expect(rows!.map((row) => row.category)).not.toContain("Prevención")
  })

  it("falla cerrado sin faenas en el alcance", async () => {
    const { getPdtpComplianceByCategoryForScope } = await import("@/lib/services/pdtp/compliance")
    expect(await getPdtpComplianceByCategoryForScope(PROGRAM_ID, [])).toBeNull()
  })
})
