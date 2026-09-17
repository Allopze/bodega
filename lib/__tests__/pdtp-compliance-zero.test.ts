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
  await inMemoryDb.insert(schema.pdtpExecutions).values({
    id: `exec-${activityId}-${worksiteId}-${year}-${month}-${week}`,
    activityId,
    worksiteId,
    year,
    month,
    week,
    executedQuantity,
    status: "approved",
    executedByUserId: USER_ID,
    createdAt: now(),
    updatedAt: now(),
  })
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
})
