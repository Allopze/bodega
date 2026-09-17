import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

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
  await inMemoryDb.delete(schema.pdtpActivityScheduleOverrides)
  await inMemoryDb.delete(schema.pdtpExecutionDeviations)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  await inMemoryDb.delete(schema.pdtpSheetActivities)
  await inMemoryDb.delete(schema.pdtpSheets)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpObjectives)
  await inMemoryDb.delete(schema.pdtpResponsibleCatalog)
  await inMemoryDb.delete(schema.pdtpChangeLog)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)
})

/**
 * Helper: ejecuta `fn` y devuelve el `message` del error principal y del
 * `cause` concatenado. Vitest's `.toThrow(regex)` no inspecciona `cause`,
 * por eso hacemos match manual.
 *
 * Cuando se pasa `constraintName`, el match es contra el nombre exacto del
 * constraint (p. ej. "pdtp_objectives_code_check") en vez del patrón laxo
 * genérico: un patrón laxo lo satisface cualquier otra violación y el test
 * pasaría sin llegar nunca al CHECK o FK que quiere probar.
 */
async function expectCheckViolation(promise: Promise<unknown>, constraintName?: string): Promise<void> {
  let thrown: unknown = null
  try { await promise } catch (e) { thrown = e }
  expect(thrown).toBeTruthy()
  const cause = (thrown as { cause?: { message?: string } }).cause
  const msg = `${(thrown as Error).message}\n${cause?.message ?? ""}`
  if (constraintName) {
    expect(msg).toContain(constraintName)
  } else {
    expect(msg).toMatch(/check|constraint|violates|Failing row/i)
  }
}

describe("PDTP CHECK constraints SQL", () => {
  beforeEach(async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.users).values({
      id: "u1", name: "U1", email: "u1@test", hashedPassword: "x", isActive: true,
    }).onConflictDoNothing()
    await inMemoryDb.insert(schema.worksites).values({
      id: "w1", name: "W1", code: "W1", isActive: true,
    }).onConflictDoNothing()
    await inMemoryDb.insert(schema.pdtpPrograms).values({
      id: "p1", year: 2026, version: 1, status: "active", title: "T",
      elaboratedByName: "X", elaboratedByTitle: "Y",
      createdAt: now, updatedAt: now,
    }).onConflictDoNothing()
    await inMemoryDb.insert(schema.pdtpActivities).values({
      id: "a1", programId: "p1", n: 1, activity: "A", program: "P", responsibleSlugs: [], responsibleDisplay: "R",
      sourceSheetRow: 1, createdAt: now, updatedAt: now,
    }).onConflictDoNothing()
  })

  it("pdtp_executions rechaza status inválido", async () => {
    const now = new Date().toISOString()
    await expectCheckViolation(
      inMemoryDb.insert(schema.pdtpExecutions).values({
        id: "e1", activityId: "a1", worksiteId: "w1",
        year: 2026, month: 1, week: 1,
        executedQuantity: 1, status: "invalid",
        evidencePhotos: [], createdAt: now, updatedAt: now,
      } as never),
    )
  })

  it("pdtp_executions acepta status válidos (sanity)", async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: "e-ok", activityId: "a1", worksiteId: "w1",
      year: 2026, month: 1, week: 1,
      executedQuantity: 1, status: "submitted",
      evidencePhotos: [], createdAt: now, updatedAt: now,
    })
  })

  it("pdtp_executions rechaza month fuera de 1-12", async () => {
    const now = new Date().toISOString()
    await expectCheckViolation(
      inMemoryDb.insert(schema.pdtpExecutions).values({
        id: "e2", activityId: "a1", worksiteId: "w1",
        year: 2026, month: 13, week: 1,
        executedQuantity: 1, status: "submitted",
        evidencePhotos: [], createdAt: now, updatedAt: now,
      } as never),
    )
  })

  it("pdtp_executions rechaza week fuera de 1-4", async () => {
    const now = new Date().toISOString()
    await expectCheckViolation(
      inMemoryDb.insert(schema.pdtpExecutions).values({
        id: "e3", activityId: "a1", worksiteId: "w1",
        year: 2026, month: 1, week: 5,
        executedQuantity: 1, status: "submitted",
        evidencePhotos: [], createdAt: now, updatedAt: now,
      } as never),
    )
  })

  it("pdtp_executions rechaza executedQuantity negativa", async () => {
    const now = new Date().toISOString()
    await expectCheckViolation(
      inMemoryDb.insert(schema.pdtpExecutions).values({
        id: "e4", activityId: "a1", worksiteId: "w1",
        year: 2026, month: 1, week: 1,
        executedQuantity: -1, status: "submitted",
        evidencePhotos: [], createdAt: now, updatedAt: now,
      } as never),
    )
  })

  it("pdtp_programs rechaza status inválido", async () => {
    const now = new Date().toISOString()
    await expectCheckViolation(
      inMemoryDb.insert(schema.pdtpPrograms).values({
        id: "p-invalid", year: 2027, version: 1, status: "impossible",
        title: "T", elaboratedByName: "X", elaboratedByTitle: "Y",
        createdAt: now, updatedAt: now,
      } as never),
    )
  })

  it("pdtp_programs rechaza compliance_target fuera de 0-1", async () => {
    const now = new Date().toISOString()
    await expectCheckViolation(
      inMemoryDb.insert(schema.pdtpPrograms).values({
        id: "p-bad-target", year: 2027, version: 1, status: "draft",
        title: "T", elaboratedByName: "X", elaboratedByTitle: "Y",
        complianceTarget: 1.5,
        createdAt: now, updatedAt: now,
      } as never),
    )
  })

  it("pdtp_activities rechaza display_order negativo", async () => {
    const now = new Date().toISOString()
    await expectCheckViolation(
      inMemoryDb.insert(schema.pdtpActivities).values({
        id: "a-bad-order", programId: "p1", n: 1, displayOrder: -1, activity: "A", program: "P",
        responsibleSlugs: [], responsibleDisplay: "R",
        sourceSheetRow: 1, createdAt: now, updatedAt: now,
      } as never),
    )
  })

  it("pdtp_activity_schedule rechaza planned_quantity negativa", async () => {
    await expectCheckViolation(
      inMemoryDb.insert(schema.pdtpActivitySchedule).values({
        id: "s1", activityId: "a1", year: 2026, month: 1, week: 1,
        plannedQuantity: -1, sourceColumn: "x",
      } as never),
    )
  })

  describe("pdtp_objectives", () => {
    function insertObjective(overrides: {
      id?: string
      programId?: string
      code: string
      name: string
    }) {
      const now = new Date().toISOString()
      return inMemoryDb.insert(schema.pdtpObjectives).values({
        id: overrides.id ?? "obj-1",
        programId: overrides.programId ?? "p1",
        code: overrides.code,
        name: overrides.name,
        createdAt: now,
        updatedAt: now,
      } as never)
    }

    it("rechaza código vacío o en blanco", async () => {
      await expectCheckViolation(insertObjective({ code: " ", name: "X" }), "pdtp_objectives_code_check")
    })

    it("rechaza nombre vacío o en blanco", async () => {
      await expectCheckViolation(insertObjective({ code: "1", name: " " }), "pdtp_objectives_name_check")
    })

    it("un objetivo de otro programa es rechazado por la FK compuesta", async () => {
      const now = new Date().toISOString()
      // Segundo programa real y distinto de p1: la FK compuesta debe comparar
      // programId, no solo el id del objetivo.
      await inMemoryDb.insert(schema.pdtpPrograms).values({
        id: "p2", year: 2026, version: 2, status: "active", title: "T2",
        elaboratedByName: "X", elaboratedByTitle: "Y",
        createdAt: now, updatedAt: now,
      })
      await insertObjective({ id: "p2-obj-1", programId: "p2", code: "1", name: "Otro" })

      await expectCheckViolation(
        inMemoryDb.update(schema.pdtpActivities)
          .set({ objectiveId: "p2-obj-1" })
          .where(eq(schema.pdtpActivities.id, "a1")),
        "pdtp_activities_objective_same_program_fk",
      )
    })
  })

  describe("pdtp_execution_deviations", () => {
    function insertDeviation(overrides: Partial<{
      id: string
      activityId: string
      worksiteId: string
      year: number
      month: number
      week: number
      kind: string
      reason: string
      targetMonth: number | null
      targetWeek: number | null
      status: string
      createdByUserId: string
      withdrawnByUserId: string | null
      withdrawnAt: string | null
      withdrawReason: string | null
    }> = {}) {
      const now = new Date().toISOString()
      return inMemoryDb.insert(schema.pdtpExecutionDeviations).values({
        id: overrides.id ?? "dev-1",
        activityId: overrides.activityId ?? "a1",
        worksiteId: overrides.worksiteId ?? "w1",
        year: overrides.year ?? 2026,
        month: overrides.month ?? 1,
        week: overrides.week ?? 1,
        kind: overrides.kind ?? "not_performed",
        reason: overrides.reason ?? "Lluvia intensa toda la semana",
        targetMonth: overrides.targetMonth ?? null,
        targetWeek: overrides.targetWeek ?? null,
        status: overrides.status ?? "active",
        createdByUserId: overrides.createdByUserId ?? "u1",
        createdAt: now,
        withdrawnByUserId: overrides.withdrawnByUserId ?? null,
        withdrawnAt: overrides.withdrawnAt ?? null,
        withdrawReason: overrides.withdrawReason ?? null,
      } as never)
    }

    it("acepta un desvío 'not_performed' válido (sanity)", async () => {
      await insertDeviation({})
    })

    it("rechaza kind inválido", async () => {
      await expectCheckViolation(
        insertDeviation({ kind: "weather" }),
        "pdtp_execution_deviations_kind_check",
      )
    })

    it("rechaza reason con menos de 10 caracteres", async () => {
      await expectCheckViolation(
        insertDeviation({ reason: "corto" }),
        "pdtp_execution_deviations_reason_check",
      )
    })

    it("acepta 'reprogrammed' con destino distinto de la celda de origen", async () => {
      await insertDeviation({
        kind: "reprogrammed",
        reason: "Se reprograma por falta de insumos",
        targetMonth: 2,
        targetWeek: 1,
      })
    })

    it("rechaza 'reprogrammed' sin destino (mitad 1 de la equivalencia)", async () => {
      await expectCheckViolation(
        insertDeviation({ kind: "reprogrammed", reason: "Se reprograma por falta de insumos" }),
        "pdtp_execution_deviations_target_check",
      )
    })

    it("rechaza un tipo distinto de 'reprogrammed' que trae destino (mitad 2 de la equivalencia)", async () => {
      await expectCheckViolation(
        insertDeviation({
          kind: "not_applicable",
          reason: "No aplica esta semana por cierre",
          targetMonth: 2,
          targetWeek: 1,
        }),
        "pdtp_execution_deviations_target_check",
      )
    })

    it("rechaza 'reprogrammed' cuyo destino es la misma celda de origen", async () => {
      await expectCheckViolation(
        insertDeviation({
          kind: "reprogrammed",
          reason: "Se reprograma por falta de insumos",
          month: 1, week: 1,
          targetMonth: 1, targetWeek: 1,
        }),
        "pdtp_execution_deviations_target_not_same_cell_check",
      )
    })

    it("rechaza 'reprogrammed' con solo target_month (destino a medias)", async () => {
      await expectCheckViolation(
        insertDeviation({
          kind: "reprogrammed",
          reason: "Se reprograma por falta de insumos",
          targetMonth: 2,
          targetWeek: null,
        }),
        "pdtp_execution_deviations_target_both_or_neither_check",
      )
    })

    it("rechaza 'reprogrammed' con solo target_week (destino a medias)", async () => {
      await expectCheckViolation(
        insertDeviation({
          kind: "reprogrammed",
          reason: "Se reprograma por falta de insumos",
          targetMonth: null,
          targetWeek: 2,
        }),
        "pdtp_execution_deviations_target_both_or_neither_check",
      )
    })

    it("rechaza 'reprogrammed' con target_month = month y target_week NULL (el agujero: sin el CHECK both_or_neither, la comparación de tuplas evalúa a NULL y el CHECK de 'misma celda' lo deja pasar)", async () => {
      await expectCheckViolation(
        insertDeviation({
          kind: "reprogrammed",
          reason: "Se reprograma por falta de insumos",
          month: 1, week: 1,
          targetMonth: 1, targetWeek: null,
        }),
        "pdtp_execution_deviations_target_both_or_neither_check",
      )
    })

    it("rechaza status inválido", async () => {
      await expectCheckViolation(
        insertDeviation({ status: "cancelled" }),
        "pdtp_execution_deviations_status_check",
      )
    })

    it("rechaza 'withdrawn' sin actor, fecha o motivo", async () => {
      await expectCheckViolation(
        insertDeviation({ status: "withdrawn" }),
        "pdtp_execution_deviations_withdrawn_check",
      )
    })

    it("rechaza 'withdrawn' con motivo demasiado corto", async () => {
      const now = new Date().toISOString()
      await expectCheckViolation(
        insertDeviation({
          status: "withdrawn",
          withdrawnByUserId: "u1",
          withdrawnAt: now,
          withdrawReason: "corto",
        }),
        "pdtp_execution_deviations_withdrawn_check",
      )
    })

    it("acepta 'withdrawn' con actor, fecha y motivo válidos (sanity)", async () => {
      const now = new Date().toISOString()
      await insertDeviation({
        status: "withdrawn",
        withdrawnByUserId: "u1",
        withdrawnAt: now,
        withdrawReason: "Se retira porque se hizo la actividad tarde",
      })
    })

    it("un segundo desvío activo en la misma celda viola el índice único parcial", async () => {
      await insertDeviation({ id: "dev-a" })
      await expectCheckViolation(
        insertDeviation({ id: "dev-b" }),
        "pdtp_execution_deviations_cell_active_unique",
      )
    })

    it("un desvío retirado no bloquea registrar uno nuevo activo en la misma celda", async () => {
      const now = new Date().toISOString()
      await insertDeviation({
        id: "dev-withdrawn",
        status: "withdrawn",
        withdrawnByUserId: "u1",
        withdrawnAt: now,
        withdrawReason: "Se retira porque se hizo la actividad tarde",
      })
      // Mismo activityId/worksiteId/year/month/week que el anterior, pero el
      // índice único parcial sólo mira las filas `status = 'active'`.
      await insertDeviation({ id: "dev-new-active" })
    })
  })

  /* ── Cierres mensuales por faena (Fase 4) ───────────────────────────────── */
  describe("pdtp_period_closures", () => {
    function insertClosure(overrides: Partial<{
      id: string
      programId: string
      worksiteId: string
      year: number
      month: number
      status: string
      version: number
      digest: string
      closeReason: string
      reopenedByUserId: string | null
      reopenedAt: string | null
      reopenReason: string | null
    }> = {}) {
      const now = new Date().toISOString()
      return inMemoryDb.insert(schema.pdtpPeriodClosures).values({
        id: overrides.id ?? "pdtp-close-p1-w1-2026-01",
        programId: overrides.programId ?? "p1",
        worksiteId: overrides.worksiteId ?? "w1",
        year: overrides.year ?? 2026,
        month: overrides.month ?? 1,
        status: overrides.status ?? "closed",
        version: overrides.version ?? 1,
        snapshotJson: { schemaVersion: 1 },
        digest: overrides.digest ?? "a".repeat(64),
        closedByUserId: "u1",
        closedAt: now,
        closeReason: overrides.closeReason ?? "Cierre del mes revisado con jefatura de faena.",
        reopenedByUserId: overrides.reopenedByUserId ?? null,
        reopenedAt: overrides.reopenedAt ?? null,
        reopenReason: overrides.reopenReason ?? null,
        distributionJson: [],
        createdAt: now,
        updatedAt: now,
      })
    }

    it("acepta un cierre válido (sanity)", async () => {
      await insertClosure()
    })

    it("rechaza el mes 13", async () => {
      await expectCheckViolation(insertClosure({ month: 13 }), "pdtp_period_closures_month_check")
    })

    it("rechaza el mes 0", async () => {
      await expectCheckViolation(insertClosure({ month: 0 }), "pdtp_period_closures_month_check")
    })

    it("rechaza un año fuera de 2024-2100", async () => {
      await expectCheckViolation(insertClosure({ year: 2023 }), "pdtp_period_closures_year_check")
    })

    it("rechaza un digest más corto que 64 caracteres", async () => {
      await expectCheckViolation(insertClosure({ digest: "abc123" }), "pdtp_period_closures_digest_check")
    })

    it("rechaza un estado que no sea 'closed' ni 'reopened'", async () => {
      await expectCheckViolation(insertClosure({ status: "abierto" }), "pdtp_period_closures_status_check")
    })

    it("rechaza una versión menor que 1", async () => {
      await expectCheckViolation(insertClosure({ version: 0 }), "pdtp_period_closures_version_check")
    })

    it("rechaza un motivo de cierre de menos de 10 caracteres", async () => {
      await expectCheckViolation(insertClosure({ closeReason: "corto" }), "pdtp_period_closures_close_reason_check")
    })

    it("rechaza 'reopened' sin actor, fecha ni motivo", async () => {
      await expectCheckViolation(insertClosure({ status: "reopened" }), "pdtp_period_closures_reopened_check")
    })

    it("rechaza 'reopened' con motivo demasiado corto", async () => {
      const now = new Date().toISOString()
      await expectCheckViolation(
        insertClosure({ status: "reopened", reopenedByUserId: "u1", reopenedAt: now, reopenReason: "corto" }),
        "pdtp_period_closures_reopened_check",
      )
    })

    it("acepta 'reopened' con actor, fecha y motivo válidos", async () => {
      const now = new Date().toISOString()
      await insertClosure({
        status: "reopened",
        reopenedByUserId: "u1",
        reopenedAt: now,
        reopenReason: "Se reabre para corregir una ejecución cargada con la semana equivocada.",
      })
    })

    it("un segundo cierre del mismo programa, faena, año y mes viola el índice único", async () => {
      await insertClosure({ id: "close-a" })
      await expectCheckViolation(insertClosure({ id: "close-b" }), "pdtp_period_closures_period_unique")
    })
  })
})
