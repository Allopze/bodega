import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
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
  // Antes que las faenas: la FK de CAPA hacia `worksites` es RESTRICT.
  await inMemoryDb.delete(schema.preventionCapaActions)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.sstEvaluations)
  await inMemoryDb.delete(schema.preventionExposureGroupMembers)
  await inMemoryDb.delete(schema.preventionExposureGroups)
  await inMemoryDb.delete(schema.preventionExposureAgents)
  await inMemoryDb.delete(schema.preventionEmergencyResources)
  await inMemoryDb.delete(schema.preventionEmergencyResourceTypes)
  await inMemoryDb.delete(schema.fuelVehicles)
  await inMemoryDb.delete(schema.workers)
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
    // Borrador a propósito: estos tests configuran la meta y el responsable por
    // faena, que son contenido firmado y sólo se editan con el programa abierto
    // (D17). El cálculo del indicador resuelve por `programId`, así que el estado
    // no lo afecta.
    status: "draft",
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
      program: "Prevención",
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
      // D11: la acción del PDTP vive en CAPA. Los estados del spec están en
      // vocabulario PDTP, así que se traducen al insertar.
      const A_CAPA: Record<string, string> = {
        pendiente: "pending", en_proceso: "in_progress", completado: "pending_verification",
        verificado: "verified", reabierto: "reopened", cancelado: "cancelled",
      }
      await inMemoryDb.insert(schema.preventionCapaActions).values(
        spec.estados.map((estado, index) => ({
          id: `act-${spec.execId}-${index}`, code: `CAPA-R2-${spec.execId}-${index}`,
          sourceType: "pdtp", sourceId: spec.execId, worksiteId: spec.ws,
          finding: "Hallazgo", actionDescription: "Acción", responsibleRole: "prevencionista",
          responsibleSnapshot: "Prevencionista", targetDate: "2026-02-01",
          priority: "medium", status: A_CAPA[estado] ?? "pending", evidenceRequired: true,
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
        program: activity.program,
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


/**
 * Cobertura sin padrón cargado.
 *
 * `compliance.ts` infería el padrón de la dotación activa de la faena cuando
 * nadie lo había cargado. Para la N°24 el sujeto son los extintores y para la
 * N°50 los trabajadores expuestos —un subconjunto—, así que contar la dotación
 * daba un incumplimiento permanente sin que nada fallara: seis expuestos
 * controlados de seis se reportaban como 0 de 41. El diseño además dice que el
 * padrón de las N°17/18/23/24 no se conoce, así que el código inventaba un dato
 * que el propio diseño declara desconocido.
 *
 * Ahora sin padrón la actividad se mide por lo planificado, como cualquier otra.
 * No se la saca del cálculo a propósito: eso encogería el denominador e inflaría
 * el promedio de la faena, premiando el no configurar.
 */
describe("Cobertura sin padrón — no se infiere la población", () => {
  const now = new Date().toISOString()

  async function seedScheduleAndExecution(plannedQuantity: number, executedQuantity: number) {
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
      id: `sch-nopadron-${ACT_ID}`,
      activityId: ACT_ID,
      year: 2026,
      month: 1,
      week: 1,
      plannedQuantity,
      sourceColumn: "test",
    })
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: `exec-nopadron-${ACT_ID}`,
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

  async function seedHeadcount(count: number) {
    await inMemoryDb.insert(schema.workers).values(
      Array.from({ length: count }, (_, i) => ({
        id: `wk-nopadron-${i}`,
        rut: `${10_000_000 + i}-0`,
        firstName: "Trabajador",
        lastName: `N${i}`,
        worksiteId: WS_ID,
        isActive: true,
        createdAt: now,
      })),
    )
  }

  async function annual() {
    const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
    const result = await getPdtpComplianceIndicators(PROGRAM_ID, WS_ID)
    return result!.annual
  }

  it("mide por la cantidad planificada del mes", async () => {
    await seedScheduleAndExecution(1, 1)
    expect(await annual()).toMatchObject({ planned: 1, executed: 1, percent: 1 })
  })

  it("no toma la dotación de la faena como padrón", async () => {
    // La regresión concreta: 41 en la faena, 1 control planificado y hecho.
    // Antes esto reportaba 0 de 41; el trabajo estaba hecho y el programa decía
    // que no.
    await seedHeadcount(41)
    await seedScheduleAndExecution(1, 1)
    expect(await annual()).toMatchObject({ planned: 1, executed: 1, percent: 1 })
  })

  it("sigue sin crédito parcial: lo planificado es el umbral", async () => {
    await seedHeadcount(41)
    await seedScheduleAndExecution(4, 3)
    expect(await annual()).toMatchObject({ planned: 4, executed: 0, percent: 0 })
  })

  it("vuelve a medir X de Y en cuanto se carga el padrón", async () => {
    const { setPdtpActivityWorksiteParams } = await import("@/lib/services/pdtp/worksites")
    await seedHeadcount(41)
    await seedScheduleAndExecution(1, 6)
    // Sin padrón: seis controles contra un planificado de uno.
    expect(await annual()).toMatchObject({ planned: 1, executed: 1, percent: 1 })

    await setPdtpActivityWorksiteParams(ACT_ID, WS_ID, { expectedSubjectCount: 6 }, USER_ID)
    expect(await annual()).toMatchObject({ planned: 6, executed: 6, percent: 1 })
  })
})


/**
 * Padrón derivado del registro de sujetos.
 *
 * Antes el padrón era un número tecleado en `expected_subject_count`, o sea una
 * foto que envejecía. Ahora `pdtp_activities.subject_source` declara de qué
 * registro sale y `compliance.ts` lo consulta: la dotación, el inventario de
 * extintores, los expuestos de un GES, o las actas de trabajador nuevo del mes.
 */
describe("Padrón derivado por fuente de sujetos", () => {
  const now = new Date().toISOString()

  async function setSource(source: string | null) {
    await inMemoryDb.update(schema.pdtpActivities).set({ subjectSource: source })
      .where(eq(schema.pdtpActivities.id, ACT_ID))
  }

  async function plan(month: number, plannedQuantity: number) {
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
      id: `sch-src-${month}`, activityId: ACT_ID, year: 2026, month, week: 1,
      plannedQuantity, sourceColumn: "test",
    })
  }

  async function execute(month: number, executedQuantity: number) {
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: `exec-src-${month}`, activityId: ACT_ID, worksiteId: WS_ID, year: 2026, month, week: 1,
      executedQuantity, status: "approved", executedByUserId: USER_ID, createdAt: now, updatedAt: now,
    })
  }

  async function seedWorkers(count: number, worksiteId = WS_ID, active = true) {
    await inMemoryDb.insert(schema.workers).values(
      Array.from({ length: count }, (_, i) => ({
        id: `wk-src-${worksiteId}-${i}-${active}`, rut: `${20_000_000 + i}-${active ? 1 : 2}`,
        firstName: "T", lastName: `${i}`, worksiteId, isActive: active, createdAt: now,
      })),
    )
  }

  async function annual() {
    const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
    return (await getPdtpComplianceIndicators(PROGRAM_ID, WS_ID))!.annual
  }

  // ── Stock: la dotación ──────────────────────────────────────────────────────

  it("deriva el padrón de la dotación activa sin cargar nada a mano", async () => {
    await seedWorkers(41)
    await seedWorkers(3, WS_ID, false)   // inactivos: no son padrón
    await setSource("dotacion")
    await plan(1, 1)
    await execute(1, 41)
    expect(await annual()).toMatchObject({ planned: 41, executed: 41, percent: 1 })
  })

  it("el override manual gana sobre el derivado", async () => {
    const { setPdtpActivityWorksiteParams } = await import("@/lib/services/pdtp/worksites")
    await seedWorkers(41)
    await setSource("dotacion")
    await setPdtpActivityWorksiteParams(ACT_ID, WS_ID, { expectedSubjectCount: 6 }, USER_ID)
    await plan(1, 1)
    await execute(1, 6)
    expect(await annual()).toMatchObject({ planned: 6, executed: 6, percent: 1 })
  })

  it("un registro vacío cae a lo planificado, no a un padrón de cero", async () => {
    // Con padrón 0 la actividad aportaría 0 al denominador y desaparecería del
    // cómputo, que es el sesgo que premia el no configurar.
    await setSource("extintores")
    await plan(1, 1)
    await execute(1, 1)
    expect(await annual()).toMatchObject({ planned: 1, executed: 1, percent: 1 })
  })

  // ── Stock: extintores ───────────────────────────────────────────────────────

  it("cuenta sólo los extintores operativos de la faena", async () => {
    // Una faena vecina, para que la aserción de "no suma lo ajeno" sea real.
    await inMemoryDb.insert(schema.worksites).values({ id: "ws-vecina", name: "Faena vecina", code: "FV", isActive: true })
    await inMemoryDb.insert(schema.preventionEmergencyResourceTypes).values([
      { id: "rt-ext", resourceClass: "extinguisher", agent: "PQS", capacity: 6, capacityUnit: "kg", canonicalName: "Extintor PQS 6 kg" },
      { id: "rt-bot", resourceClass: "first_aid_kit", canonicalName: "Botiquín" },
    ])
    await inMemoryDb.insert(schema.preventionEmergencyResources).values([
      { id: "res-1", worksiteId: WS_ID, typeId: "rt-ext", name: "Ext 1", kind: "extintor", location: "Portería" },
      { id: "res-2", worksiteId: WS_ID, typeId: "rt-ext", name: "Ext 2", kind: "extintor", location: "Taller" },
      // Fuera de servicio: no se inspecciona, así que no es denominador.
      { id: "res-3", worksiteId: WS_ID, typeId: "rt-ext", name: "Ext 3", kind: "extintor", location: "Bodega", status: "out_of_service" },
      // Otra clase, y un extintor de otra faena.
      { id: "res-4", worksiteId: WS_ID, typeId: "rt-bot", name: "Botiquín", kind: "botiquin", location: "Oficina" },
      { id: "res-5", worksiteId: "ws-vecina", typeId: "rt-ext", name: "Ext ajeno", kind: "extintor", location: "Otra faena" },
    ])
    await setSource("extintores")
    await plan(1, 1)
    await execute(1, 2)
    expect(await annual()).toMatchObject({ planned: 2, executed: 2, percent: 1 })
  })

  // ── Stock: expuestos de un GES ──────────────────────────────────────────────

  it("cuenta los expuestos con vigilancia requerida y membresía vigente", async () => {
    await seedWorkers(4)
    await inMemoryDb.insert(schema.preventionExposureAgents).values({
      id: "ag-1", code: "RUIDO", name: "Ruido", agentType: "physical", unit: "dB(A)",
      limitBasis: "DS 594 art. 70", createdByUserId: USER_ID,
    })
    await inMemoryDb.insert(schema.preventionExposureGroups).values([
      { id: "ges-1", code: "GES-1", name: "Con vigilancia", worksiteId: WS_ID, agentId: "ag-1",
        processDescription: "Proceso", surveillanceRequired: true, surveillanceReason: "Excedió el nivel de acción.", createdByUserId: USER_ID },
      // Sin vigilancia requerida: sus miembros no son padrón de esta actividad.
      { id: "ges-2", code: "GES-2", name: "Sin vigilancia", worksiteId: WS_ID, agentId: "ag-1",
        processDescription: "Proceso", createdByUserId: USER_ID },
    ])
    await inMemoryDb.insert(schema.preventionExposureGroupMembers).values([
      { id: "m-1", groupId: "ges-1", workerId: "wk-src-ws-r2-1-0-true", joinedOn: "2026-01-05" },
      { id: "m-2", groupId: "ges-1", workerId: "wk-src-ws-r2-1-1-true", joinedOn: "2026-01-05" },
      { id: "m-3", groupId: "ges-1", workerId: "wk-src-ws-r2-1-2-true", joinedOn: "2026-01-05" },
      // Salió del grupo: ya no está expuesto.
      { id: "m-4", groupId: "ges-1", workerId: "wk-src-ws-r2-1-3-true", joinedOn: "2026-01-05", leftOn: "2026-02-01" },
      // En el GES sin vigilancia, no suma.
      { id: "m-5", groupId: "ges-2", workerId: "wk-src-ws-r2-1-3-true", joinedOn: "2026-01-05" },
    ])
    await setSource("expuestos_ges")
    await plan(1, 1)
    await execute(1, 3)
    expect(await annual()).toMatchObject({ planned: 3, executed: 3, percent: 1 })
  })

  // ── Flujo: trabajadores nuevos del mes ──────────────────────────────────────

  async function seedActa(id: string, workerId: string, fecha: string, estado = "cerrado") {
    await inMemoryDb.insert(schema.sstEvaluations).values({
      id, worksiteId: WS_ID, workerId, createdBy: USER_ID,
      definicionCode: "trabajador_nuevo", definicionVersion: "01", tipo: "nuevo",
      fechaEvaluacion: fecha, estado, createdAt: now, updatedAt: now,
    })
  }

  it("deriva el padrón del mes de las actas de trabajador nuevo cerradas", async () => {
    await seedWorkers(3)
    await seedActa("ev-1", "wk-src-ws-r2-1-0-true", "2026-03-10")
    await seedActa("ev-2", "wk-src-ws-r2-1-1-true", "2026-03-20")
    // Un borrador no prueba nada: el acta cerrada es la que es inmutable.
    await seedActa("ev-3", "wk-src-ws-r2-1-2-true", "2026-03-25", "borrador")
    await setSource("trabajadores_nuevos")
    await plan(3, 1)
    await execute(3, 2)
    expect(await annual()).toMatchObject({ planned: 2, executed: 2, percent: 1 })
  })

  it("una fuente de flujo cuenta aunque el mes no tenga calendario", async () => {
    // La N°18 no tiene calendario —es `on_demand`— y su denominador son los casos
    // que ocurrieron. Sin este comportamiento seguiría aportando cero.
    await seedWorkers(2)
    await seedActa("ev-1", "wk-src-ws-r2-1-0-true", "2026-07-10")
    await seedActa("ev-2", "wk-src-ws-r2-1-1-true", "2026-07-11")
    await setSource("trabajadores_nuevos")
    await execute(7, 2)   // sin `plan(7, …)`
    expect(await annual()).toMatchObject({ planned: 2, executed: 2, percent: 1 })
  })

  it("una fuente de stock sin calendario en el mes sigue sin contar", async () => {
    // El contrapunto del caso anterior: un stock se barre según plan, así que sin
    // planificación no hay nada que exigir ese mes.
    await seedWorkers(10)
    await setSource("dotacion")
    await execute(7, 10)   // sin calendario
    expect(await annual()).toMatchObject({ planned: 0, executed: 0, percent: null })
  })
})
