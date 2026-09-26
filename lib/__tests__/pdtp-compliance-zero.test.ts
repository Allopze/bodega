import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
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
  it("compensa el % mensual entre actividades (fórmula intacta) y expone las que quedaron en cero", async () => {
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

    // La fórmula no cambia: R3 sigue topando el mes a 100% aunque A compensó
    // a B y C (planned=3, executed=min(3,3)=3).
    expect(march.planned).toBe(3)
    expect(march.executed).toBe(3)
    expect(march.percent).toBe(1)

    // Pero B y C no tuvieron ninguna ejecución aprobada este mes: el 100 %
    // no las cuenta como hechas, y ahora eso se puede ver.
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
})
