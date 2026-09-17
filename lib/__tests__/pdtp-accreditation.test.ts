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
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

import { vi } from "vitest"
import { chileDateParts } from "@/lib/utils"

/* El motor sólo acredita cuando el año del programa coincide con el del evento
 * (ver `accreditation.ts`: "El evento ocurrió fuera del año del programa
 * activo"). Con el año fijo en 2026 estas pruebas dejaban de ejercitar el
 * camino feliz al cambiar de año civil. Se siembran con el año en curso. */
const PROGRAM_YEAR = chileDateParts().year


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

afterEach(() => vi.useRealTimers())

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = "user-acc-1"
const WS_ID = "ws-acc-1"
const PROGRAM_ID = "pdtp-2026-v1"
const ACT_N = 42  // número de actividad de prueba
const REVIEW_ACT_N = 43 // su hermana de "revisión y firma", con otro responsable
const ACT_ID = `${PROGRAM_ID}-a-042`

beforeEach(async () => {
  // Limpiar en orden correcto (FK)
  await inMemoryDb.delete(schema.pdtpFulfillmentEvents)
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
    year: PROGRAM_YEAR,
    title: `PDTP ${PROGRAM_YEAR} test`,
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

/**
 * PDTP-001 y ENT-001 (auditoría 2026-09-14), patrón P4: sin artefacto real la
 * ejecución quedaba siempre en `not_required` —«esta actividad no pedía
 * evidencia»—, que es una afirmación distinta y más fuerte que la verdadera:
 * «el conector no trajo documento». El enum ya tenía `pending` y ningún camino
 * automático lo escribía nunca.
 *
 * El caso comprobado es la N°62: «registrar la entrega de los EPP y **dejar
 * documentada** su entrega», disparada desde una entrega cuyo comprobante es
 * opcional. El conector sustituía el documento ausente por el texto sintético
 * «Entrega EPP: <id>» y la ejecución nacía declarando que no se requería nada.
 */
describe("PDTP-001 — «no requiere evidencia» y «faltó la evidencia»", () => {
  const DOC_ACT_ID = `${PROGRAM_ID}-a-062`
  const DOC_ACT_N = 62

  beforeEach(async () => {
    await inMemoryDb.insert(schema.pdtpActivities).values({
      id: DOC_ACT_ID,
      programId: PROGRAM_ID,
      n: DOC_ACT_N,
      activity: "Registrar la entrega de los EPP y dejar documentada su entrega",
      program: "Prevención PDTP 2026",
      responsibleSlugs: ["prevencionista"],
      responsibleDisplay: "Prevencionista",
      scheduleMode: "triggered",
      scheduleClassificationStatus: "confirmed",
      // La actividad declara que hay que documentar: es ella, y no el conector,
      // quien lo sabe.
      evidenceRequirement: "Comprobante firmado por el trabajador",
      sourceSheetRow: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).onConflictDoNothing()
  })

  const acreditar = async (evidenceRef: string | undefined, activityN = DOC_ACT_N) => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")
    await accreditPdtpFromEvent({
      sourceType: "epp",
      sourceId: `ent-${activityN}-${evidenceRef ?? "sin"}`,
      worksiteId: WS_ID,
      activityNumbers: [activityN],
      occurredAt: `${PROGRAM_YEAR}-04-15T10:00:00.000Z`,
      executedQuantity: 1,
      evidenceRef,
    })
    const rows = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, activityN === DOC_ACT_N ? DOC_ACT_ID : ACT_ID))
    return rows.at(-1)
  }

  it("un rótulo sintético sobre una actividad que exige documentar queda PENDIENTE", async () => {
    const ejecucion = await acreditar("Entrega EPP: ent-001")
    expect(ejecucion?.evidenceStatus).toBe("pending")
  })

  it("tampoco basta con no mandar nada", async () => {
    const ejecucion = await acreditar(undefined)
    expect(ejecucion?.evidenceStatus).toBe("pending")
  })

  it("un archivo real la deja entregada", async () => {
    const ejecucion = await acreditar("storage/pdtp-evidence/comprobante-firmado.pdf")
    expect(ejecucion?.evidenceStatus).toBe("provided")
    expect(ejecucion?.evidenceUrl).toBe("storage/pdtp-evidence/comprobante-firmado.pdf")
  })

  it("una URL también", async () => {
    const ejecucion = await acreditar("https://drive.chome.cl/comprobante")
    expect(ejecucion?.evidenceStatus).toBe("provided")
  })

  it("una actividad que NO declara requisito sigue en «no requiere»", async () => {
    // Sin esta distinción el arreglo habría marcado como faltante la evidencia
    // de actividades que legítimamente no piden ninguna, y el indicador habría
    // pasado de mentir por defecto a mentir al revés.
    const ejecucion = await acreditar("Inspección completada: run-x", ACT_N)
    expect(ejecucion?.evidenceStatus).toBe("not_required")
  })
})

describe("accreditPdtpFromEvent", () => {
  it("resuelve la misma identidad de catálogo al número anual correcto por año", async () => {
    const catalogActivityId = "catalog-inspection-shared"
    const nextProgramId = `pdtp-${PROGRAM_YEAR + 1}-v1`
    await inMemoryDb.insert(schema.pdtpCatalogActivities).values({
      id: catalogActivityId,
      code: "PDT-TEST-INSPECCION-COMPARTIDA",
      status: "active",
      currentRevision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await inMemoryDb.insert(schema.pdtpCatalogActivityRevisions).values({
      id: `${catalogActivityId}-r1`, catalogActivityId, revision: 1,
      title: "Inspeccionar condiciones compartidas", description: "Inspección de extintores",
      executionGuidance: "Prevención PDTP", createdAt: new Date().toISOString(),
    })
    await inMemoryDb.update(schema.pdtpActivities).set({ catalogActivityId, catalogRevision: 1 })
      .where(eq(schema.pdtpActivities.id, ACT_ID))
    await inMemoryDb.insert(schema.pdtpPrograms).values({
      id: nextProgramId, version: 1, year: PROGRAM_YEAR + 1, title: "Programa siguiente", status: "active",
      elaboratedByName: "Prevencionista Test", elaboratedByTitle: "Experto en Prevención", creationMode: "blank",
      complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    await inMemoryDb.insert(schema.pdtpActivities).values({
      id: `${nextProgramId}-a-007`, programId: nextProgramId, n: 7, catalogActivityId, catalogRevision: 1,
      activity: "Inspección de extintores", program: "Prevención PDTP", responsibleSlugs: ["prevencionista"],
      responsibleDisplay: "Prevencionista", scheduleMode: "triggered", scheduleClassificationStatus: "confirmed",
      sourceSheetRow: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })

    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")
    const current = await accreditPdtpFromEvent({
      sourceType: "inspeccion", sourceId: "catalog-current", worksiteId: WS_ID,
      catalogActivityIds: [catalogActivityId], occurredAt: `${PROGRAM_YEAR}-03-05T10:00:00.000Z`,
    })
    const next = await accreditPdtpFromEvent({
      sourceType: "inspeccion", sourceId: "catalog-next", worksiteId: WS_ID,
      catalogActivityIds: [catalogActivityId], occurredAt: `${PROGRAM_YEAR + 1}-03-05T10:00:00.000Z`,
    })

    expect(current.accredited.map((row) => row.activityN)).toEqual([ACT_N])
    expect(next.accredited.map((row) => row.activityN)).toEqual([7])
  })

  it("acredita correctamente una actividad con un evento real", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")

    const result = await accreditPdtpFromEvent({
      sourceType: "inspeccion",
      sourceId: "run-001",
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: `${PROGRAM_YEAR}-04-15T10:00:00.000Z`,
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
      occurredAt: `${PROGRAM_YEAR}-04-15T10:00:00.000Z`,
    })

    // Segundo intento con mismo sourceId
    const result = await accreditPdtpFromEvent({
      sourceType: "inspeccion",
      sourceId: "run-002",
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: `${PROGRAM_YEAR}-04-15T10:00:00.000Z`,
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
      occurredAt: `${PROGRAM_YEAR}-04-15T10:00:00.000Z`,
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
      occurredAt: `${PROGRAM_YEAR}-04-15T10:00:00.000Z`,
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
      occurredAt: `${PROGRAM_YEAR}-04-15T10:00:00.000Z`,
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
      occurredAt: `${PROGRAM_YEAR}-04-15T10:00:00.000Z`,
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
        occurredAt: `${PROGRAM_YEAR}-04-15T10:00:00.000Z`,
      }),
    ).rejects.toThrow(/Sin programa PDTP activo/)
  })

  it("no acredita una faena fuera de la membresía explícita del programa", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")
    await inMemoryDb.insert(schema.worksites).values({
      id: "ws-member-only",
      name: "Faena miembro",
      code: "FM",
      isActive: true,
    })
    await inMemoryDb.insert(schema.pdtpProgramWorksites).values({
      id: "program-member-only",
      programId: PROGRAM_ID,
      worksiteId: "ws-member-only",
      isActive: true,
      addedAt: new Date().toISOString(),
    })

    // Sin `programId`: el campo es ignorado por la resolución (ver JSDoc de
    // `AccreditationInput.programId`), así que no aporta nada pasarlo acá.
    await expect(accreditPdtpFromEvent({
      sourceType: "inspeccion",
      sourceId: "run-outside-membership",
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: `${PROGRAM_YEAR}-04-15T10:00:00.000Z`,
      autoApproveByUserId: USER_ID,
    })).rejects.toThrow(/no pertenece al programa/)
  })

  it("array vacío de activityNumbers es no-op", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")

    const result = await accreditPdtpFromEvent({
      sourceType: "inspeccion",
      sourceId: "run-007",
      worksiteId: WS_ID,
      activityNumbers: [],
      occurredAt: `${PROGRAM_YEAR}-04-15T10:00:00.000Z`,
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
      occurredAt: `${PROGRAM_YEAR}-03-01T12:00:00.000Z`,
    })

    const [execution] = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, ACT_ID))
    expect(execution!.month).toBe(3)
    expect(execution!.week).toBe(1)
  })

  it("reserva la aprobación automática inmediata para inspecciones", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")
    await expect(accreditPdtpFromEvent({
      sourceType: "capacitacion",
      sourceId: "session-auto-invalid",
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: `${PROGRAM_YEAR}-03-01T12:00:00.000Z`,
      autoApproveByUserId: USER_ID,
    })).rejects.toThrow("Sólo las inspecciones")
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
      occurredAt: `${PROGRAM_YEAR}-04-15T10:00:00.000Z`,
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
      occurredAt: `${PROGRAM_YEAR}-04-15T10:00:00.000Z`,
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

  it("revierte una aprobación automática cuando la inspección se reabre", async () => {
    const { accreditPdtpFromEvent, revokePdtpAccreditation } = await import("@/lib/services/pdtp/accreditation")
    const accredited = await accreditPdtpFromEvent({
      sourceType: "inspeccion",
      sourceId: "run-rev-auto",
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: `${PROGRAM_YEAR}-04-15T10:00:00.000Z`,
      autoApproveByUserId: USER_ID,
    })

    const result = await revokePdtpAccreditation({
      sourceType: "inspeccion",
      sourceId: "run-rev-auto",
      worksiteId: WS_ID,
      revokedBy: USER_ID,
      reason: "Inspección reabierta para corregir sus respuestas.",
    })

    expect(result.revoked).toEqual([{ activityId: ACT_ID, executionId: accredited.accredited[0]!.executionId }])
    expect(result.skippedApproved).toEqual([])
    const [execution] = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.id, accredited.accredited[0]!.executionId))
    expect(execution).toMatchObject({
      status: "draft",
      approvedByUserId: null,
      approvedAt: null,
    })
  })

  it("una aprobación humana posterior prevalece y ya no puede revocarse por el run", async () => {
    const { accreditPdtpFromEvent, revokePdtpAccreditation } = await import("@/lib/services/pdtp/accreditation")
    const { approvePdtpExecution } = await import("@/lib/services/pdtp/executions")
    const accredited = await accreditPdtpFromEvent({
      sourceType: "inspeccion",
      sourceId: "run-auto-then-manual",
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: `${PROGRAM_YEAR}-04-15T10:00:00.000Z`,
      autoApproveByUserId: USER_ID,
    })
    const executionId = accredited.accredited[0]!.executionId
    await revokePdtpAccreditation({
      sourceType: "inspeccion",
      sourceId: "run-auto-then-manual",
      worksiteId: WS_ID,
      reason: "Se rectifica la inspección.",
    })
    await inMemoryDb.update(schema.pdtpExecutions).set({ status: "submitted" })
      .where(eq(schema.pdtpExecutions.id, executionId))
    await approvePdtpExecution(executionId, USER_ID, "all")

    const revoked = await revokePdtpAccreditation({
      sourceType: "inspeccion",
      sourceId: "run-auto-then-manual",
      worksiteId: WS_ID,
      reason: "El run se cancela después de la aprobación humana.",
    })

    expect(revoked.revoked).toEqual([])
    expect(revoked.skippedApproved).toEqual([{ activityId: ACT_ID, executionId }])
    const [execution] = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.id, executionId))
    expect(execution!.status).toBe("approved")
    expect((execution!.sourceMetadataJson as Record<string, unknown>).approvalMode).toBe("manual")
  })

  it("serializa dos revocaciones simultáneas de una fila agregada histórica", async () => {
    const { revokePdtpAccreditation } = await import("@/lib/services/pdtp/accreditation")
    const keyA = `pdtp-accredit:${ACT_ID}:${WS_ID}:inspeccion:legacy-A`
    const keyB = `pdtp-accredit:${ACT_ID}:${WS_ID}:inspeccion:legacy-B`
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: "legacy-aggregate",
      activityId: ACT_ID,
      worksiteId: WS_ID,
      year: PROGRAM_YEAR,
      month: 4,
      week: 3,
      executedQuantity: 2,
      status: "approved",
      approvedByUserId: USER_ID,
      approvedAt: new Date().toISOString(),
      origin: "integration",
      sourceType: "inspeccion",
      sourceId: "legacy-A",
      idempotencyKey: keyA,
      sourceMetadataJson: {
        sourceType: "inspeccion",
        sourceId: "legacy-A",
        approvalMode: "automatic_source_event",
        accreditedKeys: [keyA, keyB],
        automaticApprovalActors: { [keyA]: USER_ID, [keyB]: USER_ID },
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    await Promise.all([
      revokePdtpAccreditation({ sourceType: "inspeccion", sourceId: "legacy-A", worksiteId: WS_ID }),
      revokePdtpAccreditation({ sourceType: "inspeccion", sourceId: "legacy-B", worksiteId: WS_ID }),
    ])

    const [execution] = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.id, "legacy-aggregate"))
    expect(execution).toMatchObject({ status: "draft", approvedByUserId: null, approvedAt: null })
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

    // Único programa activo: el del año en curso. El evento ocurre al año siguiente.
    const result = await accreditPdtpFromEvent({
      sourceType: "capacitacion",
      sourceId: "sesion-anio-siguiente",
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: `${PROGRAM_YEAR + 1}-01-20T12:00:00.000Z`,
    })

    expect(result.accredited).toHaveLength(0)
    expect(result.skippedOutOfPeriod).toMatchObject({ occurredYear: PROGRAM_YEAR + 1, programYear: PROGRAM_YEAR })

    // Antes esto creaba una ejecución del año del programa, mes 1, indistinguible de una real.
    const rows = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(rows).toHaveLength(0)
  })

  it("sí acredita cuando el año coincide, con el año de ocurrencia", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")
    await accreditPdtpFromEvent({
      sourceType: "capacitacion",
      sourceId: "sesion-anio-programa",
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: `${PROGRAM_YEAR}-01-20T12:00:00.000Z`,
    })
    const [row] = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(row!.year).toBe(PROGRAM_YEAR)
    expect(row!.month).toBe(1)
  })
})

describe("dos eventos en la misma celda de período", () => {
  it("mantiene dos inspecciones autoaprobadas independientes en el mismo período", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")
    const base = {
      sourceType: "inspeccion" as const,
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: `${PROGRAM_YEAR}-03-03T10:00:00.000Z`,
      autoApproveByUserId: USER_ID,
    }

    await accreditPdtpFromEvent({ ...base, sourceId: "run-auto-A" })
    const second = await accreditPdtpFromEvent({
      ...base,
      sourceId: "run-auto-B",
      occurredAt: `${PROGRAM_YEAR}-03-05T10:00:00.000Z`,
    })

    expect(second.accredited).toHaveLength(1)
    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(executions).toHaveLength(2)
    expect(executions.every((execution) => execution.status === "approved")).toBe(true)
    expect(executions.reduce((sum, execution) => sum + execution.executedQuantity, 0)).toBe(2)
  })

  it("reabrir una de dos inspecciones conserva la acreditación de la otra", async () => {
    const { accreditPdtpFromEvent, revokePdtpAccreditation } = await import("@/lib/services/pdtp/accreditation")
    const base = {
      sourceType: "inspeccion" as const,
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: `${PROGRAM_YEAR}-03-03T10:00:00.000Z`,
      autoApproveByUserId: USER_ID,
    }
    await accreditPdtpFromEvent({ ...base, sourceId: "run-auto-keep" })
    await accreditPdtpFromEvent({ ...base, sourceId: "run-auto-reopen", occurredAt: `${PROGRAM_YEAR}-03-05T10:00:00.000Z` })

    const revoked = await revokePdtpAccreditation({
      sourceType: "inspeccion",
      sourceId: "run-auto-reopen",
      worksiteId: WS_ID,
      revokedBy: USER_ID,
      reason: "Inspección reabierta para rectificar.",
    })

    expect(revoked.revoked).toHaveLength(1)
    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(executions).toHaveLength(2)
    expect(executions.find((execution) => execution.sourceId === "run-auto-keep")?.status).toBe("approved")
    expect(executions.find((execution) => execution.sourceId === "run-auto-reopen")?.status).toBe("draft")
  })

  it("conserva ambos eventos cuando llegan en paralelo", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")
    const base = {
      sourceType: "inspeccion" as const,
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: `${PROGRAM_YEAR}-03-03T10:00:00.000Z`, // misma semana 1 de marzo
    }

    const [first, second] = await Promise.all([
      accreditPdtpFromEvent({ ...base, sourceId: "run-A" }),
      accreditPdtpFromEvent({ ...base, sourceId: "run-B", occurredAt: `${PROGRAM_YEAR}-03-05T10:00:00.000Z` }),
    ])

    expect(first.accredited).toHaveLength(1)
    expect(second.accredited).toHaveLength(1)

    const rows = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(rows).toHaveLength(2)
    expect(rows.reduce((sum, row) => sum + row.executedQuantity, 0)).toBe(2)
  })

  it("reintentar el mismo evento no vuelve a sumar", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")
    const base = {
      sourceType: "inspeccion" as const,
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: `${PROGRAM_YEAR}-03-03T10:00:00.000Z`,
    }
    await accreditPdtpFromEvent({ ...base, sourceId: "run-A" })
    await accreditPdtpFromEvent({ ...base, sourceId: "run-B", occurredAt: `${PROGRAM_YEAR}-03-05T10:00:00.000Z` })
    await accreditPdtpFromEvent({ ...base, sourceId: "run-B", occurredAt: `${PROGRAM_YEAR}-03-05T10:00:00.000Z` })

    const rows = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(rows).toHaveLength(2)
    expect(rows.reduce((sum, row) => sum + row.executedQuantity, 0)).toBe(2)
  })

  it("no aprueba ni altera una carga manual pendiente del mismo período", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: "manual-same-period",
      activityId: ACT_ID,
      worksiteId: WS_ID,
      year: PROGRAM_YEAR,
      month: 3,
      week: 1,
      executedQuantity: 4,
      status: "submitted",
      origin: "manual",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    await accreditPdtpFromEvent({
      sourceType: "inspeccion",
      sourceId: "run-auto-with-manual",
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: `${PROGRAM_YEAR}-03-05T10:00:00.000Z`,
      autoApproveByUserId: USER_ID,
    })

    const rows = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.id === "manual-same-period")).toMatchObject({ status: "submitted", executedQuantity: 4 })
    expect(rows.find((row) => row.sourceId === "run-auto-with-manual")).toMatchObject({ status: "approved", executedQuantity: 1 })
  })

  it("no suma dos veces una inspección acreditada también como carga manual", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")
    const { getPdtpComplianceByCategoryForScope, getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
      id: "schedule-dedup-sources",
      activityId: ACT_ID,
      year: PROGRAM_YEAR,
      month: 4,
      week: 3,
      plannedQuantity: 2,
      sourceColumn: "ABRIL S3",
    })
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: "manual-same-inspection",
      activityId: ACT_ID,
      worksiteId: WS_ID,
      year: PROGRAM_YEAR,
      month: 4,
      week: 3,
      executedQuantity: 1,
      status: "approved",
      origin: "manual",
      approvedByUserId: USER_ID,
      approvedAt: `${PROGRAM_YEAR}-04-15T12:00:00.000Z`,
      createdAt: `${PROGRAM_YEAR}-04-15T12:00:00.000Z`,
      updatedAt: `${PROGRAM_YEAR}-04-15T12:00:00.000Z`,
    })
    await accreditPdtpFromEvent({
      sourceType: "inspeccion",
      sourceId: "run-also-recorded-manually",
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: `${PROGRAM_YEAR}-04-15T10:00:00.000Z`,
      autoApproveByUserId: USER_ID,
    })

    const compliance = await getPdtpComplianceIndicators(PROGRAM_ID, WS_ID)
    // Subconjunto exacto con `toEqual` estricto: la tarea 1.4 agregó
    // `zeroActivityMonths`/`zeroActivityIds` a `annual`, ajeno a lo que este
    // caso prueba (no doble-contar un evento).
    const { planned, executed, percent } = compliance!.annual
    expect({ planned, executed, percent }).toEqual({ planned: 2, executed: 1, percent: 0.5 })
    const categories = await getPdtpComplianceByCategoryForScope(PROGRAM_ID, [WS_ID])
    expect(categories).toEqual([{
      category: "Prevención PDTP 2026",
      planned: 2,
      executed: 1,
      percent: 0.5,
    }])
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
      executedAt: `${PROGRAM_YEAR}-04-15T10:00:00.000Z`,
      createdByUserId: USER_ID,
    })
  }

  it("cuenta el cumplimiento al declarar ejecutada aunque el hallazgo siga abierto", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(`${PROGRAM_YEAR}-04-15T10:00:00.000Z`))
    const service = await import("@/lib/services/prevention-inspections")
    const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
      id: "schedule-inspection-immediate",
      activityId: ACT_ID,
      year: PROGRAM_YEAR,
      month: 4,
      week: 3,
      plannedQuantity: 1,
      sourceColumn: "ABRIL S3",
    })
    await inMemoryDb.insert(schema.preventionInspectionTemplates).values({
      id: "instpl-immediate-compliance",
      code: "inspeccion_inmediata",
      versionLabel: "01",
      name: "Inspección con cumplimiento inmediato",
      kind: "inspection",
      definitionSnapshot: { sections: [] },
      contentHash: "f".repeat(64),
      status: "approved",
      pdtpActivityNumbers: [ACT_N],
      authorUserId: USER_ID,
      approvedByUserId: USER_ID,
      approvedAt: new Date().toISOString(),
    })
    const [run] = await inMemoryDb.insert(schema.preventionInspectionRuns).values({
      id: "insrun-immediate-compliance",
      code: "INS-IMMEDIATE-001",
      templateId: "instpl-immediate-compliance",
      worksiteId: WS_ID,
      status: "in_progress",
      createdByUserId: USER_ID,
    }).returning()
    await inMemoryDb.insert(schema.preventionInspectionFindings).values({
      id: "insfind-immediate-compliance",
      runId: run!.id,
      description: "Luces de freno sin funcionamiento",
      criticality: "high",
      origin: "deviation",
      status: "open",
    })

    const completed = await service.completeInspectionRun({
      runId: run!.id,
      expectedVersion: run!.version,
    }, {
      userId: USER_ID,
      scope: { mode: "all", ids: [] },
      permissions: ["prevention:inspections:execute", "prevention:inspections:view"],
    })

    const [execution] = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.sourceId, completed.run.id))
    expect(execution).toMatchObject({
      status: "approved",
      approvedByUserId: USER_ID,
      sourceType: "inspeccion",
    })
    const compliance = await getPdtpComplianceIndicators(PROGRAM_ID, WS_ID)
    // Subconjunto exacto con `toEqual` estricto: ver comentario de más arriba
    // sobre `zeroActivity*` (tarea 1.4).
    const { planned, executed, percent } = compliance!.annual
    expect({ planned, executed, percent }).toEqual({ planned: 1, executed: 1, percent: 1 })
  })

  /* Antes este caso usaba "programa en borrador" para provocar el fallo y
   * afirmaba que el run quedaba sin cerrar. Las dos cosas no son la misma: que
   * el programa todavía no esté activo es el estado normal de la plataforma
   * hasta que Prevención lo firma, y bloquear por eso el cierre de una
   * inspección en terreno es el defecto, no la garantía. La atomicidad que este
   * bloque protegía sigue fijada por el caso de abajo —una actividad PDTP
   * inexistente sí revierte el cierre—, que es una inconsistencia de verdad. */
  it("cierra el run y deja el cumplimiento pendiente cuando el programa aún no se activa", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    await inMemoryDb.insert(schema.preventionInspectionTemplates).values({
      id: "instpl-atomic-accreditation",
      code: "inspeccion_atomica",
      versionLabel: "01",
      name: "Inspección con acreditación atómica",
      kind: "inspection",
      definitionSnapshot: { sections: [] },
      contentHash: "e".repeat(64),
      status: "approved",
      pdtpActivityNumbers: [ACT_N],
      authorUserId: USER_ID,
      approvedByUserId: USER_ID,
      approvedAt: new Date().toISOString(),
    })
    const [run] = await inMemoryDb.insert(schema.preventionInspectionRuns).values({
      id: "insrun-atomic-accreditation",
      code: "INS-ATOMIC-001",
      templateId: "instpl-atomic-accreditation",
      worksiteId: WS_ID,
      status: "in_progress",
      createdByUserId: USER_ID,
    }).returning()
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "draft" })
      .where(eq(schema.pdtpPrograms.id, PROGRAM_ID))

    const completed = await service.completeInspectionRun({
      runId: run!.id,
      expectedVersion: run!.version,
    }, {
      userId: USER_ID,
      scope: { mode: "all", ids: [] },
      permissions: ["prevention:inspections:execute", "prevention:inspections:view"],
    })

    expect(completed.run.status).toBe("completed")
    const [persisted] = await inMemoryDb.select().from(schema.preventionInspectionRuns)
      .where(eq(schema.preventionInspectionRuns.id, run!.id))
    expect(persisted!.status).toBe("completed")
    expect(persisted!.executedByUserId).toBe(USER_ID)

    // El cumplimiento no se perdió: queda reprocesable para cuando el programa
    // se active.
    const events = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)
      .where(eq(schema.pdtpFulfillmentEvents.sourceId, run!.id))
    expect(events).toHaveLength(1)
    expect(events[0]!.activityNumbers).toEqual([ACT_N])
    expect(["pending", "error"]).toContain(events[0]!.status)

    // Y no se inventó una ejecución contra un programa que nadie firmó.
    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.sourceId, run!.id))
    expect(executions).toHaveLength(0)
  })

  it("no confirma el run si la plantilla referencia una actividad PDTP inexistente", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    await inMemoryDb.insert(schema.preventionInspectionTemplates).values({
      id: "instpl-missing-activity",
      code: "inspeccion_actividad_inexistente",
      versionLabel: "01",
      name: "Inspección con vínculo inválido",
      kind: "inspection",
      definitionSnapshot: { sections: [] },
      contentHash: "f".repeat(64),
      status: "approved",
      pdtpActivityNumbers: [999],
      authorUserId: USER_ID,
      approvedByUserId: USER_ID,
      approvedAt: new Date().toISOString(),
    })
    const [run] = await inMemoryDb.insert(schema.preventionInspectionRuns).values({
      id: "insrun-missing-activity",
      code: "INS-MISSING-ACTIVITY-001",
      templateId: "instpl-missing-activity",
      worksiteId: WS_ID,
      status: "in_progress",
      createdByUserId: USER_ID,
    }).returning()

    await expect(service.completeInspectionRun({
      runId: run!.id,
      expectedVersion: run!.version,
    }, {
      userId: USER_ID,
      scope: { mode: "all", ids: [] },
      permissions: ["prevention:inspections:execute", "prevention:inspections:view"],
    })).rejects.toThrow(/actividades PDTP inexistentes: 999/)

    const [persisted] = await inMemoryDb.select().from(schema.preventionInspectionRuns)
      .where(eq(schema.preventionInspectionRuns.id, run!.id))
    expect(persisted).toMatchObject({ status: "in_progress", executedAt: null, executedByUserId: null })
  })

  it("el % de la inspección entra al eje de verificación", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")
    const { getPdtpIntegralCompliance } = await import("@/lib/services/pdtp/compliance")
    await seedInspection(80)

    await accreditPdtpFromEvent({
      sourceType: "inspeccion",
      sourceId: RUN_ID,
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: `${PROGRAM_YEAR}-04-15T10:00:00.000Z`,
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
      occurredAt: `${PROGRAM_YEAR}-04-15T10:00:00.000Z`,
    })
    await inMemoryDb.update(schema.pdtpExecutions).set({ status: "approved" })

    const integral = await getPdtpIntegralCompliance(PROGRAM_ID, WS_ID)
    expect(integral!.cierre).toBe(0)
  })

  it("el cumplimiento formal depende de realizar la inspección, no de cerrar sus hallazgos", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")
    const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
    await seedInspection(20)
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
      id: "schedule-inspection-april",
      activityId: ACT_ID,
      year: PROGRAM_YEAR,
      month: 4,
      week: 1,
      plannedQuantity: 1,
      sourceColumn: "ABRIL S1",
    })
    await accreditPdtpFromEvent({
      sourceType: "inspeccion",
      sourceId: RUN_ID,
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: `${PROGRAM_YEAR}-04-15T10:00:00.000Z`,
    })
    await inMemoryDb.update(schema.pdtpExecutions).set({ status: "approved" })
    await inMemoryDb.insert(schema.preventionInspectionFindings).values({
      id: "insfind-formal-compliance",
      runId: RUN_ID,
      description: "Freno de servicio con respuesta deficiente",
      criticality: "critical",
      status: "open",
    })

    const withOpenFinding = await getPdtpComplianceIndicators(PROGRAM_ID, WS_ID)
    // Subconjunto exacto con `toEqual` estricto: ver comentario de más arriba
    // sobre `zeroActivity*` (tarea 1.4).
    const { planned: openPlanned, executed: openExecuted, percent: openPercent } = withOpenFinding!.annual
    expect({ planned: openPlanned, executed: openExecuted, percent: openPercent }).toEqual({ planned: 1, executed: 1, percent: 1 })

    await inMemoryDb.update(schema.preventionInspectionFindings).set({
      status: "closed",
      closedByUserId: USER_ID,
      closedAt: `${PROGRAM_YEAR}-04-20T10:00:00.000Z`,
    }).where(eq(schema.preventionInspectionFindings.id, "insfind-formal-compliance"))

    const withClosedFinding = await getPdtpComplianceIndicators(PROGRAM_ID, WS_ID)
    expect(withClosedFinding!.annual).toEqual(withOpenFinding!.annual)
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
      executedAt: `${PROGRAM_YEAR}-04-15T10:00:00.000Z`,
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

/* ── Reversión al anular o reabrir ────────────────────────────────────────
 * `transitionInspectionRun` borra `compliancePercent`, `executedAt` y
 * `reviewedAt` al reabrir, pero la ejecución del programa anual sobrevivía: el
 * PDTP seguía contando una inspección que el propio motor había anulado. Con la
 * acreditación de la revisión el desfase era doble.
 */
describe("cancelar o reabrir devuelve la acreditación al programa", () => {
  const TPL = "instpl-rev2-1"
  const RUN = "insrun-rev2-1"
  const REVIEWER = "user-acc-rev2"

  const ACCESS = {
    userId: REVIEWER,
    scope: { mode: "all" as const, ids: [] as [] },
    permissions: [
      "prevention:inspections:review",
      "prevention:inspections:manage",
      "prevention:inspections:view",
    ],
  }

  /** Deja el run ejecutado Y revisado, con las dos acreditaciones puestas. */
  async function seedAccredited() {
    await inMemoryDb.insert(schema.users).values({
      id: REVIEWER, email: "rev2@acc.test", name: "Revisor Dos", hashedPassword: "x",
    }).onConflictDoNothing()
    await inMemoryDb.insert(schema.preventionInspectionTemplates).values({
      id: TPL,
      code: "reporte_equipos",
      versionLabel: "02",
      name: "Reporte de Uso Diario de Equipos",
      kind: "inspection",
      definitionSnapshot: { sections: [] },
      contentHash: "c".repeat(64),
      status: "approved",
      pdtpActivityNumbers: [ACT_N],
      pdtpReviewActivityNumbers: [REVIEW_ACT_N],
      authorUserId: USER_ID,
      approvedByUserId: USER_ID,
      approvedAt: new Date().toISOString(),
    })
    const [run] = await inMemoryDb.insert(schema.preventionInspectionRuns).values({
      id: RUN,
      code: "RUE-0002",
      templateId: TPL,
      worksiteId: WS_ID,
      status: "completed",
      compliancePercent: 100,
      executedByUserId: USER_ID,
      executedAt: `${PROGRAM_YEAR}-04-15T10:00:00.000Z`,
      createdByUserId: USER_ID,
    }).returning()

    // La acreditación de la ejecución, como la habría dejado completeInspectionRun.
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")
    await accreditPdtpFromEvent({
      sourceType: "inspeccion",
      sourceId: RUN,
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: `${PROGRAM_YEAR}-04-15T10:00:00.000Z`,
    })
    return run!
  }

  async function liveExecutions() {
    const rows = await inMemoryDb.select().from(schema.pdtpExecutions)
    return rows.filter((row) => row.sourceId === RUN && row.status !== "draft")
  }

  it("reabrir para rectificar revoca las dos acreditaciones", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const run = await seedAccredited()

    // Primero se revisa: quedan las dos (ejecución + firma).
    const reviewed = await service.reviewInspectionRun({
      runId: run.id,
      expectedVersion: run.version,
      reviewComment: "Reporte revisado y firmado por el jefe de terreno.",
    }, ACCESS)
    expect(await liveExecutions()).toHaveLength(2)

    await service.transitionInspectionRun({
      runId: run.id,
      expectedVersion: reviewed.version,
      toStatus: "in_progress",
      reason: "Error de tipeo en el horómetro; se rectifica.",
    }, ACCESS)

    // Reabrir borra el cumplimiento, así que ninguna de las dos puede seguir
    // contando: una firma sin firmante es justo lo que no debe quedar viva.
    expect(await liveExecutions()).toHaveLength(0)
  })

  it("cancelar una ejecutada también la revoca", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const run = await seedAccredited()
    expect(await liveExecutions()).toHaveLength(1)

    await service.transitionInspectionRun({
      runId: run.id,
      expectedVersion: run.version,
      toStatus: "cancelled",
      reason: "El equipo salió de la faena antes de cerrar el reporte.",
    }, ACCESS)

    expect(await liveExecutions()).toHaveLength(0)
  })

  it("una ejecución ya aprobada por una persona no se revoca sola", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const run = await seedAccredited()
    // Deshacer una aprobación humana es una decisión humana, no un efecto
    // secundario de reabrir.
    await inMemoryDb.update(schema.pdtpExecutions).set({ status: "approved" })

    await service.transitionInspectionRun({
      runId: run.id,
      expectedVersion: run.version,
      toStatus: "cancelled",
      reason: "Se cancela con la acreditación ya aprobada.",
    }, ACCESS)

    const rows = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(rows.filter((row) => row.sourceId === RUN && row.status === "approved")).toHaveLength(1)
  })

  it("cancelar una planificada no toca el programa: nunca acreditó nada", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    // `cancelled_by_user_id` es FK: este caso no pasa por `seedAccredited`.
    await inMemoryDb.insert(schema.users).values({
      id: REVIEWER, email: "rev2@acc.test", name: "Revisor Dos", hashedPassword: "x",
    }).onConflictDoNothing()
    await inMemoryDb.insert(schema.preventionInspectionTemplates).values({
      id: `${TPL}-plan`,
      code: "inspeccion_carros",
      versionLabel: "01",
      name: "Inspección de Carros",
      kind: "inspection",
      definitionSnapshot: { sections: [] },
      contentHash: "d".repeat(64),
      status: "approved",
      pdtpActivityNumbers: [ACT_N],
      authorUserId: USER_ID,
      approvedByUserId: USER_ID,
      approvedAt: new Date().toISOString(),
    })
    const [planned] = await inMemoryDb.insert(schema.preventionInspectionRuns).values({
      id: `${RUN}-plan`,
      code: "RUE-0003",
      templateId: `${TPL}-plan`,
      worksiteId: WS_ID,
      status: "planned",
      createdByUserId: USER_ID,
    }).returning()

    await service.transitionInspectionRun({
      runId: planned!.id,
      expectedVersion: planned!.version,
      toStatus: "cancelled",
      reason: "La programación ya no corresponde a esta faena.",
    }, ACCESS)

    const rows = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(rows.filter((row) => row.sourceId === `${RUN}-plan`)).toHaveLength(0)
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

  it("un solo acto puede acreditar dos actividades del programa", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    /* reporte_equipos acredita n=25 (el operador lo llenó) y n=26 (el
     * supervisor lo revisó y firmó) al declararse ejecutada: transcribir el
     * papel línea por línea es revisarlo, y el formulario guarda el nombre del
     * operador porque los conductores no tienen cuenta. Decisión de Prevención
     * del 2026-08-23. */
    const template = await service.importInspectionTemplate({ definitionCode: "reporte_equipos" }, ACCESS)
    expect(template.pdtpActivityNumbers).toEqual([25, 26])
    expect(template.pdtpReviewActivityNumbers).toBeNull()
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

  /** Una identidad publicada del catálogo, que es lo que el diálogo nuevo manda. */
  async function catalogIdentity(suffix: string) {
    const id = `pdtp-catalog-tpl-${suffix}`
    const stamp = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpCatalogActivities).values({
      id, code: `PDT-TPL-${suffix.toUpperCase()}`, status: "active", currentRevision: 1,
      createdAt: stamp, updatedAt: stamp,
    }).onConflictDoNothing()
    await inMemoryDb.insert(schema.pdtpCatalogActivityRevisions).values({
      id: `${id}-r1`, catalogActivityId: id, revision: 1,
      title: `Actividad de plantilla ${suffix}`, description: "Descripción corporativa",
      executionGuidance: "Guía corporativa", createdAt: stamp,
    }).onConflictDoNothing()
    return id
  }

  it("cablear identidades de catálogo conserva los números legados como snapshot", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const template = await service.importInspectionTemplate({ definitionCode: "inspeccion_carros" }, ACCESS)
    const conNumeros = await service.setInspectionTemplatePdtpActivities(
      { templateId: template.id, expectedVersion: template.version, pdtpActivityNumbers: [33], pdtpReviewActivityNumbers: [34] },
      ACCESS,
    )

    // El diálogo nuevo manda los números en [] y la identidad por binding. Si
    // eso pisa el snapshot, revertir el código antes del segundo despliegue
    // deja la plantilla sin acreditar nada: `resolvePdtpAccreditationTarget`
    // cae a los números justamente cuando no hay binding.
    const conCatalogo = await service.setInspectionTemplatePdtpActivities(
      {
        templateId: conNumeros.id,
        expectedVersion: conNumeros.version,
        pdtpActivityNumbers: [],
        pdtpReviewActivityNumbers: [],
        catalogActivityIds: [await catalogIdentity("exec")],
        reviewCatalogActivityIds: [await catalogIdentity("review")],
      },
      ACCESS,
    )

    expect(conCatalogo.pdtpActivityNumbers).toEqual([33])
    expect(conCatalogo.pdtpReviewActivityNumbers).toEqual([34])
  })

  it("vaciar la selección apaga la acreditación en las dos representaciones", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const template = await service.importInspectionTemplate({ definitionCode: "inspeccion_contenedores" }, ACCESS)
    const conNumeros = await service.setInspectionTemplatePdtpActivities(
      { templateId: template.id, expectedVersion: template.version, pdtpActivityNumbers: [29] },
      ACCESS,
    )

    // Sin esto, conservar el snapshot revive la acreditación por el fallback:
    // el usuario destildó todo y la plantilla seguiría cerrando la N°29.
    const vaciado = await service.setInspectionTemplatePdtpActivities(
      {
        templateId: conNumeros.id, expectedVersion: conNumeros.version,
        pdtpActivityNumbers: [], catalogActivityIds: [],
      },
      ACCESS,
    )

    expect(vaciado.pdtpActivityNumbers).toBeNull()
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
