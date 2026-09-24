/**
 * lib/__tests__/pdtp-annual-minimum.test.ts
 *
 * Mínimo anual de las actividades "cuando corresponda" (decisión del
 * 2026-09-24, N°15 y N°16). Una actividad a demanda sólo entra al indicador
 * cuando hay un caso; el mínimo exige además al menos N por faena en el año.
 *
 * Cubre lo que no se ve leyendo el cálculo: que un año sin casos pasa a deber
 * el mínimo en diciembre, que un caso ya medido lo satisface (aunque se haya
 * cerrado tarde: se exige con su propia regla, no dos veces), que lo realizado
 * sin caso propio acredita el piso, que una faena excluida no lo debe, y que el
 * CHECK, el servicio y la huella firmada lo tratan como contenido del programa.
 */

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
// @ts-expect-error PGlite is compatible at runtime
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

const { getPdtpComplianceIndicators, getPdtpComplianceByCategoryForScope } = await import("@/lib/services/pdtp/compliance")
const { updatePdtpActivity } = await import("@/lib/services/pdtp/activities")
const { buildPdtpProgramContentSnapshot } = await import("@/lib/services/pdtp/content-digest")

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const USER_ID = "u-min-1"
const WS_ID = "ws-min-1"
const PROGRAM_ID = "pdtp-min-v1"
const INDUCTION_ID = "pdtp-min-act-15"
const EVALUATION_ID = "pdtp-min-act-16"
const NOW = "2026-09-24T12:00:00.000Z"

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpObligations)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteExclusions)
  await inMemoryDb.delete(schema.pdtpChangeLog)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({ id: USER_ID, name: "Prevención", email: "min@example.test", hashedPassword: "x" })
  await inMemoryDb.insert(schema.worksites).values({ id: WS_ID, name: "Faena mínimo", code: "FMIN", isActive: true })
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID,
    year: 2026,
    version: 1,
    title: "PDTP 2026 mínimo anual",
    // Borrador, como el de producción al 2026-09-24: el mínimo se declara sobre
    // el programa todavía editable.
    status: "draft",
    elaboratedByName: "Prevención",
    elaboratedByTitle: "Prevencionista",
    creationMode: "blank",
    complianceTarget: 0.9,
    pesoEjecucion: 0.5,
    pesoVerificacion: 0.3,
    pesoCierre: 0.2,
    createdAt: NOW,
    updatedAt: NOW,
  })
  const base = {
    programId: PROGRAM_ID,
    responsibleSlugs: ["prf"],
    responsibleDisplay: "PRF",
    scheduleMode: "on_demand",
    scheduleClassificationStatus: "confirmed",
    sourceSheetRow: 1,
    minAnnualExecutions: 1,
    createdAt: NOW,
    updatedAt: NOW,
  } as const
  await inMemoryDb.insert(schema.pdtpActivities).values([
    {
      ...base,
      id: INDUCTION_ID,
      n: 15,
      activity: "Dictar inducción de riesgos laborales",
      program: "Inducción IRL",
      dueDays: 0,
      indicatorMode: "closed_on_time",
    },
    {
      ...base,
      id: EVALUATION_ID,
      n: 16,
      activity: "Evaluar la capacitación de riesgos laborales",
      program: "Evaluación IRL",
      dueDays: 1,
      indicatorMode: "coverage",
      subjectSource: "trabajadores_nuevos",
    },
  ])
})

let seq = 0
async function obligation(input: { dueAt: string | null; status: "pending" | "completed"; reportedAt?: string }) {
  seq += 1
  await inMemoryDb.insert(schema.pdtpObligations).values({
    id: `obl-min-${seq}`,
    programId: PROGRAM_ID,
    activityId: INDUCTION_ID,
    worksiteId: WS_ID,
    mode: "on_demand",
    status: input.status,
    dueAt: input.dueAt,
    reportedAt: input.reportedAt ?? null,
    idempotencyKey: `obl-min-${seq}`,
    origin: "integration",
    createdAt: NOW,
    updatedAt: NOW,
  })
}

async function approvedEvaluation(month: number) {
  seq += 1
  await inMemoryDb.insert(schema.pdtpExecutions).values({
    id: `exec-min-${seq}`,
    activityId: EVALUATION_ID,
    worksiteId: WS_ID,
    year: 2026,
    month,
    week: 1,
    executedQuantity: 1,
    status: "approved",
    idempotencyKey: `exec-min-${seq}`,
    createdAt: NOW,
    updatedAt: NOW,
  })
}

describe("mínimo anual de actividades cuando corresponda", () => {
  it("un año sin casos debe el mínimo de cada actividad al cierre, no antes", async () => {
    const result = await getPdtpComplianceIndicators(PROGRAM_ID, WS_ID)
    // N°15 y N°16, una cada una, ninguna acreditada.
    expect(result?.monthly[11]).toMatchObject({ planned: 2, executed: 0, percent: 0 })
    for (const month of result!.monthly.slice(0, 11)) {
      expect(month).toMatchObject({ planned: 0, executed: 0, percent: null })
    }
    expect(result?.annual).toMatchObject({ planned: 2, executed: 0, percent: 0 })
    expect(result?.quarterly[3]).toMatchObject({ planned: 2, executed: 0 })
  })

  it("sin mínimo declarado, un año sin casos sigue sin aportar nada (comportamiento histórico)", async () => {
    await inMemoryDb.update(schema.pdtpActivities).set({ minAnnualExecutions: null })
    const result = await getPdtpComplianceIndicators(PROGRAM_ID, WS_ID)
    expect(result?.annual).toMatchObject({ planned: 0, executed: 0, percent: null })
  })

  it("un caso ya medido satisface el piso con su propia regla, aunque se haya cerrado tarde", async () => {
    // Vence el 3 de marzo, se reporta el 10: 0/1 en marzo por `closed_on_time`.
    await obligation({ dueAt: "2026-03-03T12:00:00.000Z", status: "completed", reportedAt: "2026-03-10T12:00:00.000Z" })
    const result = await getPdtpComplianceIndicators(PROGRAM_ID, WS_ID)
    expect(result?.monthly[2]).toMatchObject({ planned: 1, executed: 0 })
    // Diciembre sólo arrastra la N°16, que sigue sin casos: la N°15 no se
    // exige dos veces.
    expect(result?.monthly[11]).toMatchObject({ planned: 1, executed: 0 })
    expect(result?.annual).toMatchObject({ planned: 2, executed: 0 })
  })

  it("lo realizado sin caso propio acredita el piso", async () => {
    // Una inducción cerrada sin plazo (cambio de cargo, sin acta de ingreso) y
    // una evaluación aprobada en un mes sin trabajadores nuevos: ninguna entra
    // al denominador mensual, las dos cuentan para el mínimo.
    await obligation({ dueAt: null, status: "completed", reportedAt: "2026-05-02T12:00:00.000Z" })
    await approvedEvaluation(5)
    const result = await getPdtpComplianceIndicators(PROGRAM_ID, WS_ID)
    expect(result?.monthly[4]).toMatchObject({ planned: 0, executed: 0 })
    expect(result?.monthly[11]).toMatchObject({ planned: 2, executed: 2, percent: 1 })
  })

  it("una obligación pendiente no acredita el mínimo", async () => {
    await obligation({ dueAt: null, status: "pending" })
    const result = await getPdtpComplianceIndicators(PROGRAM_ID, WS_ID)
    expect(result?.monthly[11]).toMatchObject({ planned: 2, executed: 0 })
  })

  it("una faena donde la actividad no aplica no debe su mínimo", async () => {
    await inMemoryDb.insert(schema.pdtpActivityWorksiteExclusions).values({
      id: "excl-min-1",
      activityId: EVALUATION_ID,
      worksiteId: WS_ID,
      reason: "La faena no incorpora personal propio este año",
      createdByUserId: USER_ID,
      createdAt: NOW,
    })
    const result = await getPdtpComplianceIndicators(PROGRAM_ID, WS_ID)
    expect(result?.monthly[11]).toMatchObject({ planned: 1, executed: 0 })
  })

  it("sin faena no inventa un mínimo consolidado", async () => {
    const result = await getPdtpComplianceIndicators(PROGRAM_ID)
    expect(result?.annual).toMatchObject({ planned: 0, executed: 0 })
  })

  it("el desglose por eje cuenta el piso de la N°15 por faena", async () => {
    const byCategory = await getPdtpComplianceByCategoryForScope(PROGRAM_ID, [WS_ID])
    // La N°16 mide por cobertura y queda fuera del eje, igual que sin mínimo.
    expect(byCategory).toEqual([{ category: "Inducción IRL", planned: 1, executed: 0, percent: 0 }])
  })

  it("la base rechaza un mínimo sobre una actividad calendarizada o un mínimo menor a 1", async () => {
    await expect(inMemoryDb.update(schema.pdtpActivities).set({ scheduleMode: "scheduled" })
      .where(eq(schema.pdtpActivities.id, INDUCTION_ID))).rejects.toThrow()
    await expect(inMemoryDb.update(schema.pdtpActivities).set({ minAnnualExecutions: 0 })
      .where(eq(schema.pdtpActivities.id, INDUCTION_ID))).rejects.toThrow()
  })

  it("el servicio limpia el mínimo al calendarizar la actividad y rechaza pedirlo donde no aplica", async () => {
    await expect(updatePdtpActivity({ activityId: INDUCTION_ID, indicatorMode: "planned_vs_completed", minAnnualExecutions: 1 }, USER_ID))
      .rejects.toThrow(/mínimo anual sólo aplica/)

    await updatePdtpActivity({
      activityId: INDUCTION_ID,
      scheduleMode: "scheduled",
      indicatorMode: "planned_vs_completed",
      recurrenceRule: { frequency: "annual", interval: 1, plannedQuantity: 1, weekOfMonth: 1 },
    }, USER_ID)
    const [row] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.id, INDUCTION_ID))
    expect(row?.minAnnualExecutions).toBeNull()
    const log = await inMemoryDb.select().from(schema.pdtpChangeLog).where(eq(schema.pdtpChangeLog.programId, PROGRAM_ID))
    expect(JSON.stringify(log.map((entry) => entry.after))).toContain("\"minAnnualExecutions\":null")
  })

  it("el mínimo entra a la huella firmada desde el esquema 18, sin alterar las anteriores", async () => {
    type Shape = { activities: Record<string, unknown>[] }
    const v17 = await buildPdtpProgramContentSnapshot(PROGRAM_ID, undefined, { schemaVersion: 17 }) as unknown as Shape
    const v18 = await buildPdtpProgramContentSnapshot(PROGRAM_ID, undefined, { schemaVersion: 18 }) as unknown as Shape
    expect(v17.activities.some((activity) => "minAnnualExecutions" in activity)).toBe(false)
    expect(v18.activities.map((activity) => activity.minAnnualExecutions)).toEqual([1, 1])
  })
})
