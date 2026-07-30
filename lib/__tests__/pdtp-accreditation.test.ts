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
const ACT_ID = `${PROGRAM_ID}-a-042`

beforeEach(async () => {
  // Limpiar en orden correcto (FK)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteExclusions)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
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

  await inMemoryDb.insert(schema.pdtpActivities).values({
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
  })
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
