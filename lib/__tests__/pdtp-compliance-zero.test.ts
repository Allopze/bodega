import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

// Patrón de `lib/__tests__/prevention-pdtp.test.ts` / `pdtp-coverage-r2.test.ts`:
// PGlite en memoria, `@/db` mockeado hacia ella, migraciones reales aplicadas
// una sola vez. Cada `it()` importa los servicios con `await import(...)`
// dinámico — un import estático del barrel resolvería `@/db` (y por lo tanto
// `db/schema`) antes de que `globalThis.__db` quede asignado más abajo, y el
// primer `db.select()` reventaría contra una conexión real inexistente.
const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite es compatible en runtime con el driver esperado.
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

const USER_ID = "u-zero-1"
const now = () => new Date().toISOString()

async function seedProgram(programId: string, year: number) {
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: programId,
    year,
    version: 1,
    title: `PDTP actividades en cero ${programId}`,
    // Borrador a propósito: el cálculo de cumplimiento resuelve por
    // `programId`/`year` y no exige que el programa esté activo (mismo
    // criterio que `pdtp-coverage-r2.test.ts`).
    status: "draft",
    elaboratedByName: "Usuaria de prueba",
    elaboratedByTitle: "Prevencionista",
    creationMode: "blank",
    complianceTarget: 0.9,
    pesoEjecucion: 0.5,
    pesoVerificacion: 0.3,
    pesoCierre: 0.2,
    createdAt: now(),
    updatedAt: now(),
  })
}

async function seedActivity(
  programId: string,
  id: string,
  n: number,
  indicatorMode: "planned_vs_completed" | "coverage" = "planned_vs_completed",
) {
  await inMemoryDb.insert(schema.pdtpActivities).values({
    id,
    programId,
    n,
    activity: `Actividad ${id}`,
    program: "Prevención",
    responsibleSlugs: ["prevencionista"],
    responsibleDisplay: "Prevencionista",
    indicatorMode,
    sourceSheetRow: n,
    createdAt: now(),
    updatedAt: now(),
  })
}

async function seedSchedule(activityId: string, year: number, month: number, plannedQuantity: number, week = 1) {
  await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
    id: `sch-${activityId}-${year}-${month}-${week}`,
    activityId,
    year,
    month,
    week,
    plannedQuantity,
    sourceColumn: "test",
  })
}

async function seedApprovedExecution(
  activityId: string,
  worksiteId: string,
  year: number,
  month: number,
  executedQuantity: number,
  week = 1,
) {
  await seedExecution(activityId, worksiteId, year, month, executedQuantity, "approved", week)
}

/** Como `seedApprovedExecution`, pero con el estado explícito — para los
 * casos que necesitan una ejecución `submitted` (enviada, sin aprobar). */
async function seedExecution(
  activityId: string,
  worksiteId: string,
  year: number,
  month: number,
  executedQuantity: number,
  status: "draft" | "submitted" | "approved" | "rejected",
  week = 1,
) {
  await inMemoryDb.insert(schema.pdtpExecutions).values({
    id: `exec-${activityId}-${worksiteId}-${year}-${month}-${week}-${status}`,
    activityId,
    worksiteId,
    year,
    month,
    week,
    executedQuantity,
    status,
    executedByUserId: USER_ID,
    createdAt: now(),
    updatedAt: now(),
  })
}

/**
 * `getPdtpSheetViewByProgram` exige que las actividades pertenezcan a una
 * hoja del programa (`pdtpSheetActivities`). Se crea program-scoped: cascada
 * al borrar el programa en `beforeEach`, sin limpieza aparte.
 */
async function seedSheetMembership(programId: string, sheetCode: string, activityIds: string[]) {
  const sheetId = `sheet-${programId}-${sheetCode}`
  await inMemoryDb.insert(schema.pdtpSheets).values({
    id: sheetId,
    code: sheetCode,
    programId,
    label: "General",
    area: "General",
    defaultScopeRoles: [],
  })
  await inMemoryDb.insert(schema.pdtpSheetActivities).values(
    activityIds.map((activityId, index) => ({
      id: `${sheetId}-m-${index}`,
      sheetId,
      sheetCode,
      activityId,
      sheetRow: index + 1,
      displayOrder: index + 1,
    })),
  )
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpActivityWorksiteParams)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: USER_ID,
    name: "Usuaria de prueba",
    email: "zero@example.test",
    hashedPassword: "x",
  })
})

/**
 * Tarea 1.4: el % mensual de cumplimiento sigue topando el ejecutado al total
 * del mes (decisión de jefatura, no se toca). Estos tests documentan por qué
 * eso no basta solo: un mes puede marcar 100 % con actividades que no tuvieron
 * ninguna ejecución, porque otra las compensó. `zeroActivities` expone esas
 * actividades sin cambiar ni `percent` ni `executed`.
 */
describe("Actividades planificadas en cero junto al cumplimiento mensual", () => {
  it("una actividad sobreejecutada no compensa a las que quedaron en cero (PREV-C02, reemplaza la respuesta 2.4)", async () => {
    const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")

    const programId = "pdtp-zero-prog-1"
    const worksiteId = "ws-zero-1"
    await inMemoryDb.insert(schema.worksites).values({ id: worksiteId, name: "Faena Zero 1", code: "FZ1", isActive: true })
    await seedProgram(programId, 2033)

    const actA = "act-zero-a"
    const actB = "act-zero-b"
    const actC = "act-zero-c"
    await seedActivity(programId, actA, 1)
    await seedActivity(programId, actB, 2)
    await seedActivity(programId, actC, 3)

    // Las tres planificadas 1 en marzo (mes 3).
    await seedSchedule(actA, 2033, 3, 1)
    await seedSchedule(actB, 2033, 3, 1)
    await seedSchedule(actC, 2033, 3, 1)

    // Solo A tiene ejecución aprobada, y sobreejecutada: 3 en vez de 1.
    await seedApprovedExecution(actA, worksiteId, 2033, 3, 3)

    const result = await getPdtpComplianceIndicators(programId, worksiteId)
    const march = result!.monthly[2]!

    // Tope por actividad y mes: A aporta como máximo su plan (1), y B y C en
    // cero no se cubren con el excedente de A (planned=3, executed=1).
    expect(march.planned).toBe(3)
    expect(march.executed).toBe(1)
    expect(march.percent).toBe(0.33)

    // B y C no tuvieron ninguna ejecución aprobada este mes.
    expect(march.zeroActivities).toBe(2)
    expect(new Set(march.zeroActivityIds)).toEqual(new Set([actB, actC]))

    // El resto de los meses no tuvo planificación: cero actividades en cero
    // ahí (no hay nada que medir, distinto de "en cero").
    expect(result!.monthly[0]!.zeroActivities).toBe(0)
    expect(result!.monthly[5]!.zeroActivities).toBe(0)

    // Anual: un solo mes con actividades en cero, y la unión de ids del año
    // es la misma pareja (no se duplica por mes).
    expect(result!.annual.zeroActivityMonths).toBe(1)
    expect(new Set(result!.annual.zeroActivityIds)).toEqual(new Set([actB, actC]))
  })

  it("una actividad de cobertura planificada y en cero no cuenta como actividad planificada en cero", async () => {
    const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")

    const programId = "pdtp-zero-prog-2"
    const worksiteId = "ws-zero-2"
    await inMemoryDb.insert(schema.worksites).values({ id: worksiteId, name: "Faena Zero 2", code: "FZ2", isActive: true })
    await seedProgram(programId, 2034)

    const coverageAct = "act-zero-coverage"
    await seedActivity(programId, coverageAct, 1, "coverage")
    // Planificada en abril (mes 4), sin padrón declarado: el denominador cae
    // a la cantidad planificada (3). Sin ejecución aprobada.
    await seedSchedule(coverageAct, 2034, 4, 3)

    const result = await getPdtpComplianceIndicators(programId, worksiteId)
    const april = result!.monthly[3]!

    // Todo-o-nada de cobertura: no acredita nada (percent 0%), pero esa regla
    // es suya, no la de "resto" — el CERO de cobertura significa "no se
    // acreditó el padrón", no "no se hizo nada" (R1/R2).
    expect(april.planned).toBe(3)
    expect(april.executed).toBe(0)
    expect(april.zeroActivities).toBe(0)
    expect(april.zeroActivityIds).toEqual([])
  })

  it("getPdtpComplianceIndicatorsForScope une los ids en cero entre faenas sin duplicar", async () => {
    const { getPdtpComplianceIndicatorsForScope } = await import("@/lib/services/pdtp/compliance")

    const programId = "pdtp-zero-prog-3"
    const wsA = "ws-zero-3a"
    const wsB = "ws-zero-3b"
    await inMemoryDb.insert(schema.worksites).values([
      { id: wsA, name: "Faena Zero 3A", code: "FZ3A", isActive: true },
      { id: wsB, name: "Faena Zero 3B", code: "FZ3B", isActive: true },
    ])
    await seedProgram(programId, 2035)

    // `shared` queda en cero en LAS DOS faenas (el cronograma es del
    // programa, no por faena: sin ejecución en ninguna, ambas la ven en
    // cero). `onlyInA` tiene ejecución aprobada en B, así que solo está en
    // cero en A.
    const shared = "act-zero-shared"
    const onlyInA = "act-zero-only-a"
    await seedActivity(programId, shared, 1)
    await seedActivity(programId, onlyInA, 2)
    await seedSchedule(shared, 2035, 5, 1)
    await seedSchedule(onlyInA, 2035, 5, 1)
    await seedApprovedExecution(onlyInA, wsB, 2035, 5, 1)

    const scoped = await getPdtpComplianceIndicatorsForScope(programId, [wsA, wsB])
    const may = scoped!.monthly[4]!

    // Por faena: A tiene las dos en cero, B solo `shared`.
    const perA = scoped!.perWorksite.find((entry) => entry.worksiteId === wsA)!.indicators!
    const perB = scoped!.perWorksite.find((entry) => entry.worksiteId === wsB)!.indicators!
    expect(perA.monthly[4]!.zeroActivities).toBe(2)
    expect(perB.monthly[4]!.zeroActivities).toBe(1)

    // El agregado es la UNIÓN de ids (2), no la suma de conteos por faena
    // (2 + 1 = 3): `shared` está en cero en ambas y cuenta una sola vez.
    expect(new Set(may.zeroActivityIds)).toEqual(new Set([shared, onlyInA]))
    expect(may.zeroActivities).toBe(2)
  })

  /**
   * Ronda 2/5: el visor de actividades (`getPdtpSheetViewByProgram`) no
   * tenía ningún test que ejercitara este camino con ejecuciones de estado
   * real. El filtro "en cero" del visor (`isPdtpActivityZeroThisMonth`) se
   * alimentaba de `effectiveMonthlyExecuted`, que cuenta cualquier estado —
   * correcto para lo que la tabla MUESTRA (una `submitted` es trabajo
   * cargado, se ve como "Ejecutado"), pero no para lo que el indicador de
   * cumplimiento CUENTA (solo `approved`, `compliance.ts` línea ~212). Una
   * actividad con una única ejecución `submitted` aparecía "Ejecutado" en la
   * tabla y quedaba afuera del filtro "en cero", pese a que el indicador la
   * seguía contando en cero — el mismo agujero que esta tarea existía para
   * cerrar, con otra causa. `approvedMonthlyExecuted` (nuevo campo de
   * `PdtpSheetView`) es lo que arregla esto: solo suma `approved`.
   */
  it("getPdtpSheetViewByProgram: el filtro 'en cero' solo cuenta ejecuciones aprobadas, igual que el indicador", async () => {
    const { getPdtpSheetViewByProgram } = await import("@/lib/services/pdtp/sheets")
    const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
    const { isPdtpActivityZeroThisMonth } = await import("@/lib/services/pdtp/period")

    const programId = "pdtp-zero-prog-4"
    const worksiteId = "ws-zero-4"
    const sheetCode = "pdtp_general"
    await inMemoryDb.insert(schema.worksites).values({ id: worksiteId, name: "Faena Zero 4", code: "FZ4", isActive: true })
    await seedProgram(programId, 2036)

    // Espejo: misma cantidad planificada y ejecutada, un solo estado distinto.
    const actSubmitted = "act-zero-submitted"
    const actApproved = "act-zero-approved"
    await seedActivity(programId, actSubmitted, 1)
    await seedActivity(programId, actApproved, 2)
    await seedSchedule(actSubmitted, 2036, 6, 1)
    await seedSchedule(actApproved, 2036, 6, 1)
    await seedSheetMembership(programId, sheetCode, [actSubmitted, actApproved])
    await seedExecution(actSubmitted, worksiteId, 2036, 6, 1, "submitted")
    await seedExecution(actApproved, worksiteId, 2036, 6, 1, "approved")

    const view = await getPdtpSheetViewByProgram(programId, sheetCode, worksiteId)
    const period = { year: 2036, month: 6, week: 1 }
    const submittedActivity = view!.activities.find((a) => a.id === actSubmitted)!
    const approvedActivity = view!.activities.find((a) => a.id === actApproved)!

    // PREV-C01: la tabla cuenta como ejecutado sólo lo aprobado —igual que el
    // indicador—; lo enviado se muestra aparte, como pendiente de aprobación.
    expect(submittedActivity.effectiveMonthlyExecuted[5]).toBe(0)
    expect(submittedActivity.pendingMonthlyExecuted?.[5]).toBe(1)
    expect(submittedActivity.pendingTotalExecuted).toBe(1)
    // Pero el campo que alimenta el filtro solo mira lo aprobado.
    expect(submittedActivity.approvedMonthlyExecuted[5]).toBe(0)
    expect(
      isPdtpActivityZeroThisMonth(submittedActivity, submittedActivity.effectiveMonthlyPlanned, submittedActivity.approvedMonthlyExecuted, period),
    ).toBe(true)

    expect(approvedActivity.effectiveMonthlyExecuted[5]).toBe(1)
    expect(approvedActivity.totalExecuted).toBe(1)
    expect(approvedActivity.pendingTotalExecuted).toBe(0)
    expect(approvedActivity.approvedMonthlyExecuted[5]).toBe(1)
    expect(
      isPdtpActivityZeroThisMonth(approvedActivity, approvedActivity.effectiveMonthlyPlanned, approvedActivity.approvedMonthlyExecuted, period),
    ).toBe(false)

    // Y coincide con lo que el indicador de cumplimiento cuenta el mismo
    // mes — la razón de ser de este test.
    const compliance = await getPdtpComplianceIndicators(programId, worksiteId)
    const june = compliance!.monthly[5]!
    expect(june.zeroActivityIds).toContain(actSubmitted)
    expect(june.zeroActivityIds).not.toContain(actApproved)
  })

  it("getPdtpSheetViewByProgram: una ejecución rechazada no suma ni como ejecutada ni como pendiente (PREV-C01)", async () => {
    const { getPdtpSheetViewByProgram } = await import("@/lib/services/pdtp/sheets")
    const programId = "pdtp-zero-prog-5"
    const worksiteId = "ws-zero-5"
    const sheetCode = "pdtp_general"
    await inMemoryDb.insert(schema.worksites).values({ id: worksiteId, name: "Faena Zero 5", code: "FZ5", isActive: true })
    await seedProgram(programId, 2037)
    const activityId = "act-zero-rejected"
    await seedActivity(programId, activityId, 1)
    await seedSchedule(activityId, 2037, 3, 1)
    await seedSheetMembership(programId, sheetCode, [activityId])
    await seedExecution(activityId, worksiteId, 2037, 3, 1, "rejected")

    const view = await getPdtpSheetViewByProgram(programId, sheetCode, worksiteId)
    const activity = view!.activities.find((a) => a.id === activityId)!
    expect(activity.monthlyExecuted[2]).toBe(0)
    expect(activity.totalExecuted).toBe(0)
    expect(activity.pendingTotalExecuted).toBe(0)
  })

  it("el avance por eje usa el mismo tope mensual que el indicador (PREV-C01)", async () => {
    const { getPdtpComplianceByCategoryForScope, getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
    const programId = "pdtp-zero-prog-6"
    const worksiteId = "ws-zero-6"
    await inMemoryDb.insert(schema.worksites).values({ id: worksiteId, name: "Faena Zero 6", code: "FZ6", isActive: true })
    await seedProgram(programId, 2038)
    const activityId = "act-zero-category"
    await seedActivity(programId, activityId, 1)
    await seedSchedule(activityId, 2038, 1, 1)
    await seedSchedule(activityId, 2038, 3, 1)
    // Enero cumplido; marzo en cero; julio (sin plan) con una ejecución extra.
    await seedExecution(activityId, worksiteId, 2038, 1, 1, "approved")
    await seedExecution(activityId, worksiteId, 2038, 7, 1, "approved")

    const indicators = await getPdtpComplianceIndicators(programId, worksiteId)
    expect(indicators!.annual).toMatchObject({ planned: 2, executed: 1 })
    const categories = await getPdtpComplianceByCategoryForScope(programId, [worksiteId])
    const total = categories!.reduce((acc, row) => ({ planned: acc.planned + row.planned, executed: acc.executed + row.executed }), { planned: 0, executed: 0 })
    expect(total).toEqual({ planned: 2, executed: 1 })
  })

  it("expone el cumplimiento a la fecha además del avance anual (PREV-I15)", async () => {
    const { getPdtpComplianceIndicators, getPdtpComplianceIndicatorsForScope } = await import("@/lib/services/pdtp/compliance")
    const { chileDateParts } = await import("@/lib/utils")
    const { year, month } = chileDateParts()
    if (month === 12) return // sin meses futuros no hay diferencia que medir
    const programId = "pdtp-zero-prog-7"
    const worksiteId = "ws-zero-7"
    await inMemoryDb.insert(schema.worksites).values({ id: worksiteId, name: "Faena Zero 7", code: "FZ7", isActive: true })
    await seedProgram(programId, year)
    const activityId = "act-zero-to-date"
    await seedActivity(programId, activityId, 1)
    await seedSchedule(activityId, year, 1, 1)
    await seedSchedule(activityId, year, 12, 1)
    await seedExecution(activityId, worksiteId, year, 1, 1, "approved")

    const indicators = await getPdtpComplianceIndicators(programId, worksiteId)
    expect(indicators!.annual).toMatchObject({ planned: 2, executed: 1, percent: 0.5 })
    expect(indicators!.toDate).toEqual({ throughMonth: month, planned: 1, executed: 1, percent: 1 })

    const scope = await getPdtpComplianceIndicatorsForScope(programId, [worksiteId])
    expect(scope!.toDate).toEqual({ throughMonth: month, planned: 1, executed: 1, percent: 1 })
  })

  it("la carga manual y la acreditación de la misma semana no suman dos, ni cubren otra actividad en cero (R2 de la auditoría)", async () => {
    const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
    const programId = "pdtp-zero-prog-8"
    const worksiteId = "ws-zero-8"
    await inMemoryDb.insert(schema.worksites).values({ id: worksiteId, name: "Faena Zero 8", code: "FZ8", isActive: true })
    await seedProgram(programId, 2039)
    await seedActivity(programId, "act-r2-a", 1)
    await seedActivity(programId, "act-r2-b", 2)
    await seedSchedule("act-r2-a", 2039, 4, 1)
    await seedSchedule("act-r2-b", 2039, 4, 1)
    await seedApprovedExecution("act-r2-a", worksiteId, 2039, 4, 1)
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: "exec-r2-integration", activityId: "act-r2-a", worksiteId, year: 2039, month: 4, week: 1,
      executedQuantity: 1, status: "approved", origin: "integration", sourceType: "capacitacion_ocurrencia", sourceId: "occ-r2",
      idempotencyKey: "pdtp-accredit:act-r2-a:ws-zero-8:capacitacion_ocurrencia:occ-r2", createdAt: now, updatedAt: now,
    })

    const april = (await getPdtpComplianceIndicators(programId, worksiteId))!.monthly[3]!
    expect(april).toMatchObject({ planned: 2, executed: 1, percent: 0.5 })
  })

  it("lo ejecutado en un mes sin plan para esa actividad no cubre otra actividad planificada en cero", async () => {
    const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
    const programId = "pdtp-zero-prog-9"
    const worksiteId = "ws-zero-9"
    await inMemoryDb.insert(schema.worksites).values({ id: worksiteId, name: "Faena Zero 9", code: "FZ9", isActive: true })
    await seedProgram(programId, 2040)
    await seedActivity(programId, "act-noplan-a", 1)
    await seedActivity(programId, "act-noplan-b", 2)
    await seedSchedule("act-noplan-a", 2040, 5, 1)
    await seedApprovedExecution("act-noplan-b", worksiteId, 2040, 5, 1)
    const may = (await getPdtpComplianceIndicators(programId, worksiteId))!.monthly[4]!
    expect(may).toMatchObject({ planned: 1, executed: 0 })
  })

  it("el avance por eje topa por faena, actividad y mes (PREV-C02)", async () => {
    const { getPdtpComplianceByCategoryForScope } = await import("@/lib/services/pdtp/compliance")
    const programId = "pdtp-zero-prog-10"
    await inMemoryDb.insert(schema.worksites).values([
      { id: "ws-zero-10a", name: "Faena 10A", code: "F10A", isActive: true },
      { id: "ws-zero-10b", name: "Faena 10B", code: "F10B", isActive: true },
    ])
    await seedProgram(programId, 2041)
    await seedActivity(programId, "act-eje-a", 1)
    await seedActivity(programId, "act-eje-b", 2)
    await seedSchedule("act-eje-a", 2041, 6, 1)
    await seedSchedule("act-eje-b", 2041, 6, 1)
    // A sobreejecutada en la faena A; B en cero; nada en la faena B.
    await seedApprovedExecution("act-eje-a", "ws-zero-10a", 2041, 6, 2)

    const onlyA = await getPdtpComplianceByCategoryForScope(programId, ["ws-zero-10a"])
    const totalA = onlyA!.reduce((acc, row) => ({ planned: acc.planned + row.planned, executed: acc.executed + row.executed }), { planned: 0, executed: 0 })
    expect(totalA).toEqual({ planned: 2, executed: 1 })

    const both = await getPdtpComplianceByCategoryForScope(programId, ["ws-zero-10a", "ws-zero-10b"])
    const totalBoth = both!.reduce((acc, row) => ({ planned: acc.planned + row.planned, executed: acc.executed + row.executed }), { planned: 0, executed: 0 })
    expect(totalBoth).toEqual({ planned: 4, executed: 1 })
  })

  it("una obligación que vence en el año siguiente cuenta en diciembre de su programa, no en enero ni en ninguno (PREV-M07)", async () => {
    const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
    const programId = "pdtp-zero-prog-11"
    const worksiteId = "ws-zero-11"
    await inMemoryDb.insert(schema.worksites).values({ id: worksiteId, name: "Faena Zero 11", code: "FZ11", isActive: true })
    await seedProgram(programId, 2042)
    await inMemoryDb.insert(schema.pdtpActivities).values({
      id: "act-m07", programId, n: 1, activity: "Investigar incidentes", program: "Prevención",
      responsibleSlugs: ["prevencionista"], responsibleDisplay: "Prevencionista",
      scheduleMode: "on_demand", indicatorMode: "closed_on_time", sourceSheetRow: 1, createdAt: now(), updatedAt: now(),
    })
    const obligation = (id: string, dueAt: string) => ({
      id, programId, activityId: "act-m07", worksiteId, mode: "on_demand", status: "completed",
      dueAt, reportedAt: dueAt, completedAt: dueAt, idempotencyKey: id, origin: "manual", manualReason: "Caso registrado en la faena", createdAt: now(), updatedAt: now(),
    })
    await inMemoryDb.insert(schema.pdtpObligations).values([
      obligation("obl-m07-jan", "2042-01-15T15:00:00.000Z"),
      obligation("obl-m07-next-year", "2043-01-10T15:00:00.000Z"),
    ])

    const result = await getPdtpComplianceIndicators(programId, worksiteId)
    expect(result!.monthly[0]).toMatchObject({ planned: 1, executed: 1 })
    // El caso nació en 2042 y la actividad es del programa 2042: el de 2043
    // no lo ve nunca (sus actividades son otras), así que descartarlo aquí lo
    // perdía. Cuenta en el último mes del año de su programa.
    expect(result!.monthly[11]).toMatchObject({ planned: 1, executed: 1 })
    expect(result!.annual.planned).toBe(2)
  })

  it("el reporte de gestión topa por actividad y mes y no cuenta dos veces la misma semana (PREV-C02)", async () => {
    const { getPdtpManagementReport } = await import("@/lib/services/pdtp/management-report")
    const programId = "pdtp-zero-prog-12"
    const worksiteId = "ws-zero-12"
    await inMemoryDb.insert(schema.worksites).values({ id: worksiteId, name: "Faena Zero 12", code: "FZ12", isActive: true })
    await seedProgram(programId, 2043)
    await inMemoryDb.update(schema.pdtpPrograms).set({ appliesToAllWorksites: true }).where(eq(schema.pdtpPrograms.id, programId))
    await seedActivity(programId, "act-rep-a", 1)
    await inMemoryDb.update(schema.pdtpActivities).set({ scheduleMode: "scheduled" }).where(eq(schema.pdtpActivities.id, "act-rep-a"))
    await seedSchedule("act-rep-a", 2043, 1, 1)
    await seedSchedule("act-rep-a", 2043, 3, 1)
    // Enero: manual 2 aprobada + acreditación 1 la misma semana; marzo en cero.
    await seedApprovedExecution("act-rep-a", worksiteId, 2043, 1, 2)
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: "exec-rep-int", activityId: "act-rep-a", worksiteId, year: 2043, month: 1, week: 1,
      executedQuantity: 1, status: "approved", origin: "integration", sourceType: "inspeccion", sourceId: "run-rep",
      idempotencyKey: "pdtp-accredit:act-rep-a:ws-zero-12:inspeccion:run-rep", createdAt: now, updatedAt: now,
    })

    const report = await getPdtpManagementReport({ programId, worksiteId, scope: "all" })
    const row = report!.activities.find((activity) => activity.activityNumber === 1)!
    expect(row).toMatchObject({ planned: 2, executed: 1, percent: 0.5 })
  })

  it("una ejecución enlazada a una instancia completada no suma encima de la instancia (PREV-I08-a)", async () => {
    const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
    const programId = "pdtp-zero-prog-14"
    const worksiteId = "ws-zero-14"
    const year = 2045
    await inMemoryDb.insert(schema.worksites).values({ id: worksiteId, name: "Faena Zero 14", code: "FZ14", isActive: true })
    await seedProgram(programId, year)
    await seedActivity(programId, "act-inst-a", 1)
    await inMemoryDb.update(schema.pdtpActivities).set({
      scheduleMode: "scheduled",
      scheduleDefinition: { version: 1, kind: "recurring", startDate: `${year}-01-01`, endDate: `${year}-12-31`, every: 2, unit: "week", weekdays: [1] },
    }).where(eq(schema.pdtpActivities.id, "act-inst-a"))
    const instance = (id: string, day: string, status: string) => ({
      id, programId, activityId: "act-inst-a", worksiteId,
      scheduledFor: `${year}-06-${day}`, isoWeekYear: year, isoWeek: 23, plannedQuantity: 1,
      status, completedAt: status === "completed" ? `${year}-06-${day}T14:00:00.000Z` : null,
      completedByUserId: status === "completed" ? USER_ID : null,
      idempotencyKey: `pdtp-scheduled:act-inst-a:${worksiteId}:${year}-06-${day}`,
      sourceMetadataJson: { generatedFrom: "schedule_definition" }, createdAt: now(), updatedAt: now(),
    })
    // Dos ocurrencias en junio: una completada (con su ejecución enlazada) y
    // otra pendiente. El mes vale 1 de 2, no 2 de 2.
    await inMemoryDb.insert(schema.pdtpScheduledInstances).values([
      instance("inst-done", "02", "completed"),
      instance("inst-pending", "16", "pending"),
    ])
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: "exec-inst-done", activityId: "act-inst-a", worksiteId, year, month: 6, week: 1,
      executedQuantity: 1, status: "approved", scheduledInstanceId: "inst-done",
      executedByUserId: USER_ID, createdAt: now(), updatedAt: now(),
    })

    const june = (await getPdtpComplianceIndicators(programId, worksiteId))!.monthly[5]!
    expect(june).toMatchObject({ planned: 2, executed: 1, percent: 0.5 })
  })

  it("la planilla agregada cuenta una vez la misma semana también en los totales por faena (PREV-C02)", async () => {
    const { getPdtpAggregatedSheetViewByProgram } = await import("@/lib/services/pdtp/sheets")
    const programId = "pdtp-zero-prog-15"
    const worksiteId = "ws-zero-15"
    const sheetCode = "pdtp_general"
    await inMemoryDb.insert(schema.worksites).values({ id: worksiteId, name: "Faena Zero 15", code: "FZ15", isActive: true })
    await seedProgram(programId, 2046)
    await inMemoryDb.update(schema.pdtpPrograms).set({ appliesToAllWorksites: true }).where(eq(schema.pdtpPrograms.id, programId))
    await seedActivity(programId, "act-agg-a", 1)
    await seedSchedule("act-agg-a", 2046, 2, 1)
    await seedSheetMembership(programId, sheetCode, ["act-agg-a"])
    await seedApprovedExecution("act-agg-a", worksiteId, 2046, 2, 1)
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: "exec-agg-int", activityId: "act-agg-a", worksiteId, year: 2046, month: 2, week: 1,
      executedQuantity: 1, status: "approved", origin: "integration", sourceType: "inspeccion", sourceId: "run-agg",
      idempotencyKey: "pdtp-accredit:act-agg-a:ws-zero-15:inspeccion:run-agg", createdAt: now(), updatedAt: now(),
    })

    const view = await getPdtpAggregatedSheetViewByProgram(programId, sheetCode, [worksiteId], { year: 2046, month: 12, week: 4 })
    const summary = view!.worksiteSummaries.find((row) => row.worksiteId === worksiteId)!
    expect(summary.historicalExecuted).toBe(1)
    expect(summary.executed).toBe(1)
    expect(view!.activities[0]!.monthlyExecuted[1]).toBe(1)
  })

  it("la planilla y su Excel no cuentan dos veces la misma semana y el % sale de su columna computable (PREV-C02)", async () => {
    const { getPdtpSheetViewByProgram, buildPdtpExport } = await import("@/lib/services/pdtp/sheets")
    const programId = "pdtp-zero-prog-13"
    const worksiteId = "ws-zero-13"
    const sheetCode = "pdtp_general"
    await inMemoryDb.insert(schema.worksites).values({ id: worksiteId, name: "Faena Zero 13", code: "FZ13", isActive: true })
    await seedProgram(programId, 2044)
    await seedActivity(programId, "act-sheet-a", 1)
    await seedSchedule("act-sheet-a", 2044, 1, 1)
    await seedSchedule("act-sheet-a", 2044, 3, 1)
    await seedSheetMembership(programId, sheetCode, ["act-sheet-a"])
    // Enero: manual 2 aprobada + acreditación 1 la misma semana; marzo en cero.
    await seedApprovedExecution("act-sheet-a", worksiteId, 2044, 1, 2)
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: "exec-sheet-int", activityId: "act-sheet-a", worksiteId, year: 2044, month: 1, week: 1,
      executedQuantity: 1, status: "approved", origin: "integration", sourceType: "inspeccion", sourceId: "run-sheet",
      idempotencyKey: "pdtp-accredit:act-sheet-a:ws-zero-13:inspeccion:run-sheet", createdAt: now, updatedAt: now,
    })

    const view = await getPdtpSheetViewByProgram(programId, sheetCode, worksiteId)
    const activity = view!.activities.find((a) => a.id === "act-sheet-a")!
    // La celda cuenta una vez: max(manual 2, integración 1) = 2. La
    // sobreejecución se sigue viendo, pero no suma la acreditación encima.
    expect(activity.monthlyExecuted[0]).toBe(2)
    expect(activity.totalExecuted).toBe(2)
    expect(view!.monthlyTotals[0]!.executed).toBe(2)
    // Lo computable topa por mes: enero 1 de 1, marzo 0 de 1.
    expect(activity.countedTotalExecuted).toBe(1)

    const report = await buildPdtpExport({ programId, year: 2044, sheetCode, worksiteId, scope: [worksiteId] })
    const row = report.rows[0]!
    const cell = (header: string) => row[report.headers.indexOf(header)]
    expect(cell("Ejecutado anual histórico")).toBe(2)
    expect(cell("Ejecutado computable histórico")).toBe(1)
    expect(cell("% histórico")).toBe(50)
  })
})

