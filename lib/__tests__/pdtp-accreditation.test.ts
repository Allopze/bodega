/**
 * lib/__tests__/pdtp-accreditation.test.ts
 *
 * Tests del motor de auto-acreditación PDTP (Fase 2, Plan 2026-07-22).
 *
 * Cobertura:
 * - accreditPdtpFromEvent: idempotencia, exclusión por faena (R4), programa
 *   no activo, actividades no encontradas, ejecución approved no se toca.
 * - revokePdtpAccreditation: revierte draft/submitted, no toca approved.
 */

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

import { vi } from "vitest"

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = "user-acc-1"
const WS_ID = "ws-acc-1"
const PROGRAM_ID = "pdtp-2026-v1"
const ACT_N = 42  // número de actividad de prueba
const REVIEW_ACT_N = 43 // su hermana de "revisión y firma", con otro responsable
const ACT_ID = `${PROGRAM_ID}-a-042`

beforeEach(async () => {
  // Limpiar en orden correcto (FK)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteExclusions)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  // Motor transversal de inspecciones: sus runs referencian worksites con
  // RESTRICT, así que van antes que la faena.
  await inMemoryDb.delete(schema.preventionInspectionFindings)
  await inMemoryDb.delete(schema.preventionInspectionAnswers)
  await inMemoryDb.delete(schema.preventionInspectionRuns)
  await inMemoryDb.delete(schema.preventionInspectionPrograms)
  await inMemoryDb.delete(schema.preventionInspectionTemplates)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: USER_ID,
    name: "Prevencionista Test",
    email: "prev-acc@example.test",
    hashedPassword: "x",
  })

  await inMemoryDb.insert(schema.worksites).values({
    id: WS_ID,
    name: "Faena Acreditación",
    code: "FA",
    isActive: true,
  })

  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID,
    version: 1,
    year: 2026,
    title: "PDTP 2026 test",
    status: "active",
    elaboratedByName: "Prevencionista Test",
    elaboratedByTitle: "Experto en Prevención",
    creationMode: "blank",
    complianceTarget: 0.9,
    pesoEjecucion: 0.5,
    pesoVerificacion: 0.3,
    pesoCierre: 0.2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  await inMemoryDb.insert(schema.pdtpActivities).values([{
    id: ACT_ID,
    programId: PROGRAM_ID,
    n: ACT_N,
    activity: "Inspección de extintores",
    program: "Prevención PDTP 2026",
    responsibleSlugs: ["prevencionista"],
    responsibleDisplay: "Prevencionista",
    scheduleMode: "triggered",
    scheduleClassificationStatus: "confirmed",
    sourceSheetRow: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, {
    // La hermana de revisión: otro responsable y otra ocurrencia, como la n=26
    // frente a la n=25 en el programa real.
    id: `${ACT_ID}-review`,
    programId: PROGRAM_ID,
    n: REVIEW_ACT_N,
    activity: "Revisión y firma de la inspección de extintores",
    program: "Prevención PDTP 2026",
    responsibleSlugs: ["jefe_terreno"],
    responsibleDisplay: "JT",
    scheduleMode: "triggered",
    scheduleClassificationStatus: "confirmed",
    sourceSheetRow: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }])
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("accreditPdtpFromEvent", () => {
  it("acredita correctamente una actividad con un evento real", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")

    const result = await accreditPdtpFromEvent({
      sourceType: "inspeccion",
      sourceId: "run-001",
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: "2026-04-15T10:00:00.000Z",
      executedQuantity: 1,
    })

    expect(result.accredited).toHaveLength(1)
    expect(result.accredited[0]!.activityN).toBe(ACT_N)
    expect(result.accredited[0]!.created).toBe(true)
    expect(result.skippedExcluded).toHaveLength(0)
    expect(result.skippedNotFound).toHaveLength(0)

    // Verificar en DB
    const [execution] = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, ACT_ID))
    expect(execution).toBeDefined()
    expect(execution!.origin).toBe("integration")
    expect(execution!.sourceType).toBe("inspeccion")
    expect(execution!.sourceId).toBe("run-001")
    expect(execution!.status).toBe("submitted")
    expect(execution!.month).toBe(4)  // Abril
    expect(execution!.executedQuantity).toBe(1)
  })

  it("es idempotente: un segundo llamado con el mismo sourceId no duplica", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")

    await accreditPdtpFromEvent({
      sourceType: "inspeccion",
      sourceId: "run-002",
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: "2026-04-15T10:00:00.000Z",
    })

    // Segundo intento con mismo sourceId
    const result = await accreditPdtpFromEvent({
      sourceType: "inspeccion",
      sourceId: "run-002",
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: "2026-04-15T10:00:00.000Z",
    })

    expect(result.accredited).toHaveLength(1)
    expect(result.accredited[0]!.created).toBe(false)  // No creó uno nuevo

    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, ACT_ID))
    expect(executions).toHaveLength(1)  // Solo una ejecución
  })

  it("respeta la exclusión por faena (R4): actividad excluida no se acredita", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")

    // Excluir la actividad de la faena
    await inMemoryDb.insert(schema.pdtpActivityWorksiteExclusions).values({
      id: "excl-1",
      activityId: ACT_ID,
      worksiteId: WS_ID,
      reason: "No aplica en esta faena",
      createdByUserId: USER_ID,
      createdAt: new Date().toISOString(),
    })

    const result = await accreditPdtpFromEvent({
      sourceType: "inspeccion",
      sourceId: "run-003",
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: "2026-04-15T10:00:00.000Z",
    })

    expect(result.accredited).toHaveLength(0)
    expect(result.skippedExcluded).toEqual([ACT_N])

    // Verificar que no se creó ejecución
    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(executions).toHaveLength(0)
  })

  it("retorna skippedNotFound cuando el número de actividad no existe en el programa", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")

    const result = await accreditPdtpFromEvent({
      sourceType: "inspeccion",
      sourceId: "run-004",
      worksiteId: WS_ID,
      activityNumbers: [999],  // No existe
      occurredAt: "2026-04-15T10:00:00.000Z",
    })

    expect(result.accredited).toHaveLength(0)
    expect(result.skippedNotFound).toEqual([999])
  })

  it("no toca una ejecución ya approved", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")

    // Primera acreditación
    const r1 = await accreditPdtpFromEvent({
      sourceType: "inspeccion",
      sourceId: "run-005",
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: "2026-04-15T10:00:00.000Z",
    })
    const executionId = r1.accredited[0]!.executionId

    // Simular aprobación manual
    await inMemoryDb.update(schema.pdtpExecutions)
      .set({ status: "approved", approvedByUserId: USER_ID, approvedAt: new Date().toISOString() })
      .where(eq(schema.pdtpExecutions.id, executionId))

    // Segundo intento
    const r2 = await accreditPdtpFromEvent({
      sourceType: "inspeccion",
      sourceId: "run-005",
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: "2026-04-15T10:00:00.000Z",
      executedQuantity: 5,  // Diferente cantidad — NO debe actualizarse
    })

    expect(r2.accredited[0]!.executionId).toBe(executionId)

    // Verificar que la ejecución sigue approved y con el Q original
    const [execution] = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.id, executionId))
    expect(execution!.status).toBe("approved")
    expect(execution!.executedQuantity).toBe(1)  // Cantidad original, no 5
  })

  it("lanza error cuando no hay programa activo", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")

    // Desactivar el programa
    await inMemoryDb.update(schema.pdtpPrograms)
      .set({ status: "draft" })
      .where(eq(schema.pdtpPrograms.id, PROGRAM_ID))

    await expect(
      accreditPdtpFromEvent({
        sourceType: "inspeccion",
        sourceId: "run-006",
        worksiteId: WS_ID,
        activityNumbers: [ACT_N],
        occurredAt: "2026-04-15T10:00:00.000Z",
      }),
    ).rejects.toThrow(/Sin programa PDTP activo/)
  })

  it("array vacío de activityNumbers es no-op", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")

    const result = await accreditPdtpFromEvent({
      sourceType: "inspeccion",
      sourceId: "run-007",
      worksiteId: WS_ID,
      activityNumbers: [],
      occurredAt: "2026-04-15T10:00:00.000Z",
    })

    expect(result.accredited).toHaveLength(0)
    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(executions).toHaveLength(0)
  })

  it("determina mes y semana correctamente desde occurredAt", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")

    // 1 de marzo → mes 3, semana 1 (día 1 → ceil(1/7)=1)
    await accreditPdtpFromEvent({
      sourceType: "capacitacion",
      sourceId: "sess-001",
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: "2026-03-01T12:00:00.000Z",
    })

    const [execution] = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, ACT_ID))
    expect(execution!.month).toBe(3)
    expect(execution!.week).toBe(1)
  })
})

describe("revokePdtpAccreditation", () => {
  it("revierte una ejecución submitted a draft", async () => {
    const { accreditPdtpFromEvent, revokePdtpAccreditation } = await import("@/lib/services/pdtp/accreditation")

    await accreditPdtpFromEvent({
      sourceType: "inspeccion",
      sourceId: "run-rev-1",
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: "2026-04-15T10:00:00.000Z",
    })

    const result = await revokePdtpAccreditation({
      sourceType: "inspeccion",
      sourceId: "run-rev-1",
      worksiteId: WS_ID,
      reason: "Inspección cancelada por error.",
    })

    expect(result.revoked).toHaveLength(1)
    expect(result.skippedApproved).toHaveLength(0)

    const [execution] = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, ACT_ID))
    expect(execution!.status).toBe("draft")
    // Verifica que se anotó la razón en metadata
    const meta = execution!.sourceMetadataJson as Record<string, unknown>
    expect(meta.revocationReason).toBe("Inspección cancelada por error.")
  })

  it("no revierte una ejecución approved", async () => {
    const { accreditPdtpFromEvent, revokePdtpAccreditation } = await import("@/lib/services/pdtp/accreditation")

    const r1 = await accreditPdtpFromEvent({
      sourceType: "inspeccion",
      sourceId: "run-rev-2",
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: "2026-04-15T10:00:00.000Z",
    })

    // Aprobar manualmente
    await inMemoryDb.update(schema.pdtpExecutions)
      .set({ status: "approved", approvedByUserId: USER_ID, approvedAt: new Date().toISOString() })
      .where(eq(schema.pdtpExecutions.id, r1.accredited[0]!.executionId))

    const result = await revokePdtpAccreditation({
      sourceType: "inspeccion",
      sourceId: "run-rev-2",
      worksiteId: WS_ID,
    })

    expect(result.revoked).toHaveLength(0)
    expect(result.skippedApproved).toHaveLength(1)

    // Sigue approved
    const [execution] = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.id, r1.accredited[0]!.executionId))
    expect(execution!.status).toBe("approved")
  })

  it("es no-op cuando no existe ninguna acreditación para ese evento", async () => {
    const { revokePdtpAccreditation } = await import("@/lib/services/pdtp/accreditation")

    const result = await revokePdtpAccreditation({
      sourceType: "inspeccion",
      sourceId: "run-inexistente",
      worksiteId: WS_ID,
    })

    expect(result.revoked).toHaveLength(0)
    expect(result.skippedApproved).toHaveLength(0)
  })
})

// ── Regresiones 2026-08-04 ────────────────────────────────────────────────────

describe("evento fuera del año del programa", () => {
  it("no acredita y lo reporta, en vez de sellar la fila con el año del programa", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")

    // Único programa activo: 2026. El evento ocurre en 2027.
    const result = await accreditPdtpFromEvent({
      sourceType: "capacitacion",
      sourceId: "sesion-2027",
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: "2027-01-20T12:00:00.000Z",
    })

    expect(result.accredited).toHaveLength(0)
    expect(result.skippedOutOfPeriod).toMatchObject({ occurredYear: 2027, programYear: 2026 })

    // Antes esto creaba una ejecución year=2026, month=1 indistinguible de una real.
    const rows = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(rows).toHaveLength(0)
  })

  it("sí acredita cuando el año coincide, con el año de ocurrencia", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")
    await accreditPdtpFromEvent({
      sourceType: "capacitacion",
      sourceId: "sesion-2026",
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: "2026-01-20T12:00:00.000Z",
    })
    const [row] = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(row!.year).toBe(2026)
    expect(row!.month).toBe(1)
  })
})

describe("dos eventos en la misma celda de período", () => {
  it("suma el segundo en vez de perderlo por el índice único", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")
    const base = {
      sourceType: "inspeccion" as const,
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: "2026-03-03T10:00:00.000Z", // misma semana 1 de marzo
    }

    const first = await accreditPdtpFromEvent({ ...base, sourceId: "run-A" })
    // Antes: 23505 sobre pdtp_executions_activity_scope_period_unique, tragado
    // por safeAccredit; la segunda inspección desaparecía sin rastro.
    const second = await accreditPdtpFromEvent({ ...base, sourceId: "run-B", occurredAt: "2026-03-05T10:00:00.000Z" })

    expect(first.accredited).toHaveLength(1)
    expect(second.accredited).toHaveLength(1)

    const rows = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.executedQuantity).toBe(2)
  })

  it("reintentar el mismo evento no vuelve a sumar", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")
    const base = {
      sourceType: "inspeccion" as const,
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: "2026-03-03T10:00:00.000Z",
    }
    await accreditPdtpFromEvent({ ...base, sourceId: "run-A" })
    await accreditPdtpFromEvent({ ...base, sourceId: "run-B", occurredAt: "2026-03-05T10:00:00.000Z" })
    await accreditPdtpFromEvent({ ...base, sourceId: "run-B", occurredAt: "2026-03-05T10:00:00.000Z" })

    const rows = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.executedQuantity).toBe(2)
  })

  it("no suma sobre una ejecución ya aprobada", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")
    const base = {
      sourceType: "inspeccion" as const,
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: "2026-03-03T10:00:00.000Z",
    }
    await accreditPdtpFromEvent({ ...base, sourceId: "run-A" })
    await inMemoryDb.update(schema.pdtpExecutions).set({ status: "approved" })

    await accreditPdtpFromEvent({ ...base, sourceId: "run-B", occurredAt: "2026-03-05T10:00:00.000Z" })

    const rows = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.executedQuantity).toBe(1)
    expect(rows[0]!.status).toBe("approved")
  })
})

// ── Integración con el motor transversal de inspecciones ─────────────────────

describe("una inspección acreditada alimenta los ejes de verificación y cierre", () => {
  const TPL_ID = "instpl-acc-1"
  const RUN_ID = "insrun-acc-1"

  async function seedInspection(compliancePercent: number) {
    await inMemoryDb.insert(schema.preventionInspectionTemplates).values({
      id: TPL_ID,
      code: "inspeccion_extintores",
      versionLabel: "01",
      name: "Inspección de extintores",
      kind: "inspection",
      definitionSnapshot: { sections: [] },
      contentHash: "a".repeat(64),
      status: "approved",
      pdtpActivityNumbers: [ACT_N],
      authorUserId: USER_ID,
      approvedByUserId: USER_ID,
      approvedAt: new Date().toISOString(),
    })
    await inMemoryDb.insert(schema.preventionInspectionRuns).values({
      id: RUN_ID,
      code: "INS-0001",
      templateId: TPL_ID,
      worksiteId: WS_ID,
      status: "completed",
      compliancePercent,
      executedByUserId: USER_ID,
      executedAt: "2026-04-15T10:00:00.000Z",
      createdByUserId: USER_ID,
    })
  }

  it("el % de la inspección entra al eje de verificación", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")
    const { getPdtpIntegralCompliance } = await import("@/lib/services/pdtp/compliance")
    await seedInspection(80)

    await accreditPdtpFromEvent({
      sourceType: "inspeccion",
      sourceId: RUN_ID,
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: "2026-04-15T10:00:00.000Z",
    })
    // El índice integral sólo considera ejecuciones aprobadas.
    await inMemoryDb.update(schema.pdtpExecutions).set({ status: "approved" })

    const integral = await getPdtpIntegralCompliance(PROGRAM_ID, WS_ID)
    // Antes daba null: computeVerificacionYCierre sólo miraba los checklists del PDTP.
    expect(integral!.verificacion).toBe(80)
  })

  it("un hallazgo sin CAPA cerrada deja el eje de cierre en 0", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")
    const { getPdtpIntegralCompliance } = await import("@/lib/services/pdtp/compliance")
    await seedInspection(50)
    await inMemoryDb.insert(schema.preventionInspectionFindings).values({
      id: "insfind-acc-1",
      runId: RUN_ID,
      description: "Extintor sin carga",
      criticality: "high",
      status: "open",
    })

    await accreditPdtpFromEvent({
      sourceType: "inspeccion",
      sourceId: RUN_ID,
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: "2026-04-15T10:00:00.000Z",
    })
    await inMemoryDb.update(schema.pdtpExecutions).set({ status: "approved" })

    const integral = await getPdtpIntegralCompliance(PROGRAM_ID, WS_ID)
    expect(integral!.cierre).toBe(0)
  })
})

/* ── Acreditación de la revisión y firma ──────────────────────────────────
 * El programa distingue ejecutar de revisar: la n=25 la llena el operador y la
 * n=26 la firma el Sup/JT. Acreditar la firma al completar daría por firmado lo
 * que nadie revisó, así que el disparador es `reviewed` — donde el servicio ya
 * garantiza que el revisor no es quien ejecutó.
 */
describe("revisar y firmar acredita su propia actividad", () => {
  const TPL = "instpl-rev-1"
  const RUN = "insrun-rev-1"
  const REVIEWER = "user-acc-reviewer"

  const EXECUTOR_ACCESS = {
    userId: USER_ID,
    scope: { mode: "all" as const, ids: [] as [] },
    permissions: ["prevention:inspections:review", "prevention:inspections:view"],
  }
  const REVIEWER_ACCESS = { ...EXECUTOR_ACCESS, userId: REVIEWER }

  async function seedReviewable() {
    await inMemoryDb.insert(schema.users).values({
      id: REVIEWER, email: "revisor@acc.test", name: "Revisor E2E", hashedPassword: "x",
    }).onConflictDoNothing()
    await inMemoryDb.insert(schema.preventionInspectionTemplates).values({
      id: TPL,
      code: "reporte_equipos",
      versionLabel: "01",
      name: "Reporte de Uso Diario de Equipos",
      kind: "inspection",
      definitionSnapshot: { sections: [] },
      contentHash: "b".repeat(64),
      status: "approved",
      pdtpActivityNumbers: [ACT_N],
      pdtpReviewActivityNumbers: [REVIEW_ACT_N],
      authorUserId: USER_ID,
      approvedByUserId: USER_ID,
      approvedAt: new Date().toISOString(),
    })
    const [run] = await inMemoryDb.insert(schema.preventionInspectionRuns).values({
      id: RUN,
      code: "RUE-0001",
      templateId: TPL,
      worksiteId: WS_ID,
      status: "completed",
      compliancePercent: 100,
      executedByUserId: USER_ID,
      executedAt: "2026-04-15T10:00:00.000Z",
      createdByUserId: USER_ID,
    }).returning()
    return run!
  }

  it("acredita la actividad de revisión, y sólo al revisar", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const run = await seedReviewable()

    // Antes de revisar, la ocurrencia de la firma no existe.
    const before = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(before.filter((row) => row.idempotencyKey?.includes(`${ACT_ID}-review`))).toHaveLength(0)

    await service.reviewInspectionRun({
      runId: run.id,
      expectedVersion: run.version,
      reviewComment: "Reporte revisado y firmado por el jefe de terreno.",
    }, REVIEWER_ACCESS)

    const after = await inMemoryDb.select().from(schema.pdtpExecutions)
    // La clave del PDTP incluye la actividad, así que la firma no colisiona con
    // la ejecución aunque compartan el mismo run.
    expect(after.filter((row) => row.idempotencyKey?.includes(`${ACT_ID}-review`))).toHaveLength(1)
  })

  it("sin actividades de revisión declaradas no acredita nada al revisar", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const run = await seedReviewable()
    await inMemoryDb.update(schema.preventionInspectionTemplates)
      .set({ pdtpReviewActivityNumbers: null })
      .where(eq(schema.preventionInspectionTemplates.id, TPL))

    await service.reviewInspectionRun({
      runId: run.id,
      expectedVersion: run.version,
      reviewComment: "Reporte revisado sin cableado de revisión.",
    }, REVIEWER_ACCESS)

    const rows = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(rows.filter((row) => row.idempotencyKey?.includes(`${ACT_ID}-review`))).toHaveLength(0)
  })

  it("quien ejecutó no puede firmar lo suyo, así que tampoco acredita la firma", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const run = await seedReviewable()

    await expect(service.reviewInspectionRun({
      runId: run.id,
      expectedVersion: run.version,
      reviewComment: "Intento de firmar mi propia inspección.",
    }, EXECUTOR_ACCESS)).rejects.toThrow(/no puede revisarla/)

    const rows = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(rows.filter((row) => row.idempotencyKey?.includes(`${ACT_ID}-review`))).toHaveLength(0)
  })
})

// ── El escritor que faltaba ───────────────────────────────────────────────────

describe("declarar qué actividades PDTP acredita una plantilla", () => {
  const ACCESS = {
    userId: USER_ID,
    scope: { mode: "all" as const, ids: [] as [] },
    permissions: ["prevention:inspections:manage", "prevention:inspections:view"],
  }

  it("importInspectionTemplate persiste los números declarados", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const template = await service.importInspectionTemplate(
      { definitionCode: "inspeccion_extintores", pdtpActivityNumbers: [ACT_N] },
      ACCESS,
    )
    expect(template.pdtpActivityNumbers).toEqual([ACT_N])
  })

  it("hereda también la actividad que acredita al revisarse", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    // reporte_equipos: n=25 al ejecutar, n=26 al revisar y firmar.
    const template = await service.importInspectionTemplate({ definitionCode: "reporte_equipos" }, ACCESS)
    expect(template.pdtpActivityNumbers).toEqual([25])
    expect(template.pdtpReviewActivityNumbers).toEqual([26])
  })

  it("sin declararlos hereda el cableado del programa: la plantilla llega acreditando", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const template = await service.importInspectionTemplate({ definitionCode: "inspeccion_taller" }, ACCESS)
    // n=27 en PDTP_2026_INSPECTION_SPECS. Antes nacía en null y la inspección
    // se ejecutaba sin que el programa anual se enterara.
    expect(template.pdtpActivityNumbers).toEqual([27])
  })

  it("un [] explícito sigue significando que no acredita", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const template = await service.importInspectionTemplate(
      { definitionCode: "inspeccion_equipos_moviles", pdtpActivityNumbers: [] },
      ACCESS,
    )
    expect(template.pdtpActivityNumbers).toBeNull()
  })

  it("no adivina cuando la definición sirve a dos actividades ni cuando no sirve a ninguna", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    // EPP es la n=64 (JT) y la n=65 (PRF): cablear ambas dejaría que un run del
    // jefe de terreno cerrara la ocurrencia del prevencionista.
    const epp = await service.importInspectionTemplate({ definitionCode: "inspeccion_epp" }, ACCESS)
    expect(epp.pdtpActivityNumbers).toBeNull()
    // La auditoría del SGSST la exige el DS 44, no el programa anual.
    const audit = await service.importInspectionTemplate({ definitionCode: "auditoria_sgsst", kind: "audit" }, ACCESS)
    expect(audit.pdtpActivityNumbers).toBeNull()
  })

  it("se pueden corregir después de incorporarla, deduplicados y ordenados", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const template = await service.importInspectionTemplate({ definitionCode: "inspeccion_carros" }, ACCESS)
    const updated = await service.setInspectionTemplatePdtpActivities(
      { templateId: template.id, expectedVersion: template.version, pdtpActivityNumbers: [34, 33, 34] },
      ACCESS,
    )
    expect(updated.pdtpActivityNumbers).toEqual([33, 34])
    expect(updated.version).toBe(template.version + 1)
  })

  it("no se pueden cambiar una vez reemplazada la plantilla", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const template = await service.importInspectionTemplate({ definitionCode: "inspeccion_contenedores" }, ACCESS)
    // Reemplazarla es lo que hace incorporar otra versión del mismo código.
    await inMemoryDb.update(schema.preventionInspectionTemplates)
      .set({ status: "superseded", supersededAt: new Date().toISOString() })
      .where(eq(schema.preventionInspectionTemplates.id, template.id))

    await expect(service.setInspectionTemplatePdtpActivities(
      { templateId: template.id, expectedVersion: template.version, pdtpActivityNumbers: [29] },
      ACCESS,
    )).rejects.toThrow(/reemplazada/i)
  })
})
