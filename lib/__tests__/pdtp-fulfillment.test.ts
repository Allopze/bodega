/**
 * lib/__tests__/pdtp-fulfillment.test.ts
 *
 * Tests de la plataforma de cumplimiento (Fase 2, 2026-09-02).
 *
 * Cobertura:
 * - recordPdtpFulfillmentEvent: escribe el evento durable aunque el programa
 *   no esté activo, y lo reconcilia cuando el programa se activa después.
 * - recordPdtpFulfillmentRevocation: idem, en sentido inverso.
 * - reconcilePdtpFulfillmentEvents: reprocesa los `pending`/`error` sin
 *   duplicar lo que ya se acreditó.
 * - resolvePdtpFulfillmentTarget: el destino por mecanismo.
 * - assertPdtpFulfillmentCoverage: clasifica cada actividad activa.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import { chileDateParts } from "@/lib/utils"

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

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const {
  recordPdtpFulfillmentEvent,
  recordPdtpFulfillmentRevocation,
  reconcilePdtpFulfillmentEvents,
  resolvePdtpFulfillmentTarget,
  assertPdtpFulfillmentCoverage,
} = await import("@/lib/services/pdtp/fulfillment")
const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")
const { countPdtpFulfillmentBacklog, describePdtpRejection } = await import("@/lib/services/pdtp/backlog")
const { computePdtpProgramContentDigest } = await import("@/lib/services/pdtp/content-digest")

/* El motor sólo acredita cuando el año del programa coincide con el del
 * evento, así que se siembra con el año en curso. */
const PROGRAM_YEAR = chileDateParts().year
const USER_ID = "user-fulfill-1"
const WS_ID = "ws-fulfill-1"
const PROGRAM_ID = "pdtp-fulfill-v1"
const ACT_N = 42
const ACT_ID = `${PROGRAM_ID}-a-042`

async function seedProgram(status: "draft" | "active", version = 1) {
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, version, year: PROGRAM_YEAR, title: `PDTP ${PROGRAM_YEAR} fulfillment`,
    status, appliesToAllWorksites: true, elaboratedByName: "Prevencionista", elaboratedByTitle: "Experto en Prevención",
    creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  })
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpFulfillmentEvents)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivityExecutorAssignments)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteParams)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteExclusions)
  await inMemoryDb.delete(schema.pdtpProgramWorksites)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.preventionInspectionTemplates)
  await inMemoryDb.delete(schema.preventionEmergencyPlans)
  await inMemoryDb.delete(schema.preventionTrainingCourseVersions)
  await inMemoryDb.delete(schema.preventionTrainingCourses)
  await inMemoryDb.delete(schema.sstDocumentTypes)
  await inMemoryDb.delete(schema.sstDocumentCategories)
  await inMemoryDb.delete(schema.pdtpResponsibleCatalog)
  await inMemoryDb.delete(schema.rolePermissions)
  await inMemoryDb.delete(schema.permissions)
  await inMemoryDb.delete(schema.roles)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({ id: USER_ID, name: "Prevencionista", email: "prev-fulfill@example.test", hashedPassword: "x" })
  await inMemoryDb.insert(schema.worksites).values({ id: WS_ID, name: "Faena Fulfillment", code: "FF", isActive: true })
  await inMemoryDb.insert(schema.pdtpResponsibleCatalog).values({
    slug: "prevencionista", displayName: "Prevencionista", roleName: "prevencionista_faena", kind: "rbac_role",
  })
  // La compuerta exige que el rol del responsable tenga permiso en el módulo
  // donde se registra el cumplimiento, así que el grant es parte del fixture:
  // sin él, toda actividad `constancia` es un `permission_gap` legítimo.
  await inMemoryDb.insert(schema.roles).values({ id: "role-prf", name: "prevencionista_faena", label: "Prevencionista de faena" })
  await inMemoryDb.insert(schema.permissions).values([
    { id: "perm-constancias-execute", name: "prevention:constancias:execute", module: "prevention" },
    { id: "perm-pdtp-execute", name: "prevention:pdtp:execute", module: "prevention" },
  ])
  await inMemoryDb.insert(schema.rolePermissions).values([
    { roleId: "role-prf", permissionId: "perm-constancias-execute" },
    { roleId: "role-prf", permissionId: "perm-pdtp-execute" },
  ])
})

async function seedActivity(overrides: Partial<typeof schema.pdtpActivities.$inferInsert> = {}) {
  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: ACT_ID, programId: PROGRAM_ID, n: ACT_N,
    activity: "Inspección de extintores", program: "Prevención PDTP",
    responsibleSlugs: ["prevencionista"], responsibleDisplay: "Prevencionista",
    scheduleMode: "scheduled", scheduleClassificationStatus: "confirmed",
    mechanism: "constancia", evidenceRequirement: "Registro verificable",
    sourceSheetRow: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  })
}

async function seedExecutor(roleId = "role-prf") {
  await inMemoryDb.insert(schema.pdtpActivityExecutorAssignments).values({
    id: `executor-${roleId}`,
    activityId: ACT_ID,
    roleId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
}

describe("recordPdtpFulfillmentEvent — el hecho no se pierde", () => {
  it("deja el evento en pending sin programa activo, en vez de perderlo", async () => {
    await seedProgram("draft")
    await seedActivity()

    const result = await recordPdtpFulfillmentEvent({
      sourceType: "campana", sourceId: "campana-1", worksiteId: WS_ID,
      activityNumbers: [ACT_N], occurredAt: new Date().toISOString(),
    })
    expect(result).toBeNull() // el motor lanzó: sin programa activo.

    const [event] = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)
      .where(eq(schema.pdtpFulfillmentEvents.sourceId, "campana-1"))
    expect(event).toBeTruthy()
    expect(event?.status).toBe("error")
    expect(event?.lastError).toMatch(/programa PDTP activo/i)
    expect(event?.activityNumbers).toEqual([ACT_N])
  })

  it("acredita y marca el evento como accredited cuando el programa está activo", async () => {
    await seedProgram("active")
    await seedActivity()

    const result = await recordPdtpFulfillmentEvent({
      sourceType: "campana", sourceId: "campana-2", worksiteId: WS_ID,
      activityNumbers: [ACT_N], programId: "programo-sugerido-por-conector", occurredAt: new Date().toISOString(),
    })
    expect(result?.accredited).toHaveLength(1)

    const [event] = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)
      .where(eq(schema.pdtpFulfillmentEvents.sourceId, "campana-2"))
    expect(event?.status).toBe("accredited")
    expect(event?.programId).toBe(PROGRAM_ID)

    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, ACT_ID))
    expect(executions).toHaveLength(1)
  })

  it("persiste el objetivo normalizado y resuelve la instancia anual sin usar el número como fuente", async () => {
    await seedProgram("active")
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpCatalogActivities).values({ id: "catalog-fulfillment-42", code: "PDT-TEST-FULFILLMENT", status: "active", currentRevision: 1, createdAt: now, updatedAt: now }).onConflictDoNothing()
    await inMemoryDb.insert(schema.pdtpCatalogActivityRevisions).values({ id: "catalog-fulfillment-42-r1", catalogActivityId: "catalog-fulfillment-42", revision: 1, title: "Inspeccionar extintores de prueba", description: "Inspección de extintores", executionGuidance: "Prevención PDTP", createdAt: now }).onConflictDoNothing()
    await seedActivity({ catalogActivityId: "catalog-fulfillment-42", catalogRevision: 1 })

    const result = await recordPdtpFulfillmentEvent({
      sourceType: "campana", sourceId: "campana-catalog", worksiteId: WS_ID,
      catalogActivityIds: ["catalog-fulfillment-42"], occurredAt: now,
    })
    expect(result?.accredited[0]).toMatchObject({ activityId: ACT_ID, activityN: ACT_N })
    const [event] = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents).where(eq(schema.pdtpFulfillmentEvents.sourceId, "campana-catalog"))
    expect(event?.activityNumbers).toEqual([])
    const [target] = await inMemoryDb.select().from(schema.pdtpFulfillmentEventTargets).where(eq(schema.pdtpFulfillmentEventTargets.eventId, event!.id))
    expect(target).toMatchObject({ catalogActivityId: "catalog-fulfillment-42", resolvedActivityId: ACT_ID, activityNumberSnapshot: ACT_N })
  })

  it("es idempotente: reintentar el mismo sourceId no duplica la ejecución", async () => {
    await seedProgram("active")
    await seedActivity()

    const input = {
      sourceType: "campana" as const, sourceId: "campana-3", worksiteId: WS_ID,
      activityNumbers: [ACT_N], occurredAt: new Date().toISOString(),
    }
    await recordPdtpFulfillmentEvent(input)
    await recordPdtpFulfillmentEvent(input)

    const events = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)
      .where(eq(schema.pdtpFulfillmentEvents.sourceId, "campana-3"))
    expect(events).toHaveLength(1)
    expect(events[0]?.attempts).toBe(2)

    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, ACT_ID))
    expect(executions).toHaveLength(1)
  })
})

describe("recordPdtpFulfillmentRevocation", () => {
  it("marca el evento revoked cuando la revocación se completa", async () => {
    await seedProgram("active")
    await seedActivity()
    await recordPdtpFulfillmentEvent({
      sourceType: "campana", sourceId: "campana-4", worksiteId: WS_ID,
      activityNumbers: [ACT_N], occurredAt: new Date().toISOString(),
    })

    await recordPdtpFulfillmentRevocation({ sourceType: "campana", sourceId: "campana-4", worksiteId: WS_ID })

    // Dos filas conviven bajo el mismo sourceId: una por el evento `completed`
    // (ya `accredited`) y otra por el `revoked` — cada dirección es su propio
    // evento durable, con su propia clave idempotente.
    const events = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)
      .where(eq(schema.pdtpFulfillmentEvents.sourceId, "campana-4"))
    expect(events).toHaveLength(2)
    expect(events.find((e) => e.eventType === "revoked")?.status).toBe("revoked")
    expect(events.find((e) => e.eventType === "completed")?.status).toBe("accredited")
  })
})

describe("reconcilePdtpFulfillmentEvents", () => {
  it("reprocesa un evento pendiente y lo deja accredited al activarse el programa", async () => {
    await seedProgram("draft")
    await seedActivity()
    await recordPdtpFulfillmentEvent({
      sourceType: "campana", sourceId: "campana-5", worksiteId: WS_ID,
      activityNumbers: [ACT_N], occurredAt: new Date().toISOString(),
    })
    const [beforeEvent] = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)
      .where(eq(schema.pdtpFulfillmentEvents.sourceId, "campana-5"))
    expect(beforeEvent?.status).toBe("error")

    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "active" }).where(eq(schema.pdtpPrograms.id, PROGRAM_ID))
    const summary = await reconcilePdtpFulfillmentEvents()
    expect(summary).toMatchObject({ processed: 1, accredited: 1, errored: 0 })

    const [afterEvent] = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)
      .where(eq(schema.pdtpFulfillmentEvents.sourceId, "campana-5"))
    expect(afterEvent?.status).toBe("accredited")
    const executions = await inMemoryDb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.activityId, ACT_ID))
    expect(executions).toHaveLength(1)
  })

  it("conserva el año planificado y la aprobación automática al reconciliar", async () => {
    await seedProgram("draft")
    await seedActivity()
    const plannedYear = PROGRAM_YEAR
    await recordPdtpFulfillmentEvent({
      sourceType: "capacitacion_ocurrencia", sourceId: "training-annual-1", worksiteId: WS_ID,
      activityNumbers: [ACT_N], occurredAt: `${PROGRAM_YEAR + 1}-11-20T12:00:00.000Z`,
      plannedYear, autoApproveByUserId: USER_ID,
    })

    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "active" }).where(eq(schema.pdtpPrograms.id, PROGRAM_ID))
    const summary = await reconcilePdtpFulfillmentEvents()
    expect(summary).toMatchObject({ processed: 1, accredited: 1, errored: 0 })

    const [execution] = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, ACT_ID))
    expect(execution).toMatchObject({ status: "approved", approvedByUserId: USER_ID, year: plannedYear })
    const [event] = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)
      .where(eq(schema.pdtpFulfillmentEvents.sourceId, "training-annual-1"))
    expect(event).toMatchObject({ plannedYear, autoApproveByUserId: USER_ID, status: "accredited" })
  })

  it("permite una nueva finalización posterior a una revocación ya registrada", async () => {
    await seedProgram("draft")
    await seedActivity()
    const input = {
      sourceType: "capacitacion_ocurrencia" as const, sourceId: "training-corrected-1", worksiteId: WS_ID,
      activityNumbers: [ACT_N], occurredAt: new Date().toISOString(),
    }
    await recordPdtpFulfillmentEvent(input)
    await recordPdtpFulfillmentRevocation({ sourceType: "capacitacion_ocurrencia", sourceId: input.sourceId, worksiteId: WS_ID })
    await recordPdtpFulfillmentEvent(input)

    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "active" }).where(eq(schema.pdtpPrograms.id, PROGRAM_ID))
    const summary = await reconcilePdtpFulfillmentEvents()
    // La revocación se resuelve al registrarse: si todavía no había ejecución,
    // el resultado vacío es igualmente terminal (`revoked`). Sólo la nueva
    // finalización queda para reconciliar cuando el programa se activa.
    expect(summary).toMatchObject({ processed: 1, accredited: 1, rejected: 0, errored: 0 })

    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(1)
    const events = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)
      .where(eq(schema.pdtpFulfillmentEvents.sourceId, input.sourceId))
    expect(events.find((event) => event.eventType === "completed")?.status).toBe("accredited")
    expect(events.find((event) => event.eventType === "revoked")?.status).toBe("revoked")
  })

  it("no reprocesa lo que ya está accredited", async () => {
    await seedProgram("active")
    await seedActivity()
    await recordPdtpFulfillmentEvent({
      sourceType: "campana", sourceId: "campana-6", worksiteId: WS_ID,
      activityNumbers: [ACT_N], occurredAt: new Date().toISOString(),
    })
    const summary = await reconcilePdtpFulfillmentEvents()
    expect(summary).toMatchObject({ processed: 0 })
  })

  it("no vuelve a acreditar un hecho que ya fue revocado", async () => {
    await seedProgram("draft") // el completed queda pendiente
    await seedActivity()
    await recordPdtpFulfillmentEvent({
      sourceType: "epp", sourceId: "entrega-1", worksiteId: WS_ID,
      activityNumbers: [ACT_N], occurredAt: new Date().toISOString(), executedQuantity: 1,
    })
    await recordPdtpFulfillmentRevocation({
      sourceType: "epp", sourceId: "entrega-1", worksiteId: WS_ID, reason: "Entrega anulada",
    })

    await inMemoryDb.update(schema.pdtpPrograms)
      .set({ status: "active", activatedAt: new Date().toISOString() })
      .where(eq(schema.pdtpPrograms.id, PROGRAM_ID))

    await reconcilePdtpFulfillmentEvents({})

    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toEqual([])
    const completed = (await inMemoryDb.select().from(schema.pdtpFulfillmentEvents))
      .find((event) => event.eventType === "completed")
    expect(completed?.status).toBe("rejected")
    expect(completed?.lastError).toContain("revocado")
  })
})

describe("resolvePdtpFulfillmentTarget", () => {
  it("una constancia va a /prevencion/constancias", () => {
    const target = resolvePdtpFulfillmentTarget({ mechanism: "constancia" }, WS_ID)
    expect(target.module).toBe("constancias")
    expect(target.href).toBe(`/prevencion/constancias?faena=${WS_ID}`)
    expect(target.ctaLabel).toBe("Dejar constancia")
  })

  it("un enganche sin número declarado cae a la planilla", () => {
    const target = resolvePdtpFulfillmentTarget({ mechanism: "enganche" }, WS_ID)
    expect(target.href).toBe(`/prevencion/pdtp/actividades?faena=${WS_ID}&vista=semana`)
    expect(target.ctaLabel).toBe("Ver cómo se cumple")
  })

  /* Con número, manda al módulo donde el trabajo se hace. Es lo que la cola de
   * pendientes consume: sin esto el responsable de la n=10 aterrizaba en la
   * planilla, que le muestra el estado y no le deja cumplir nada. */
  it.each([
    [10, "inspecciones", "/prevencion/inspecciones"],
    [53, "capacitacion", "/prevencion/capacitacion"],
    [62, "epp", "/prevencion/epp-preventivo"],
    [35, "riesgos", "/prevencion/miper"],
    [84, "emergencias", "/prevencion/emergencias"],
  ])("la n=%i se cumple en %s", (n, moduleName, prefix) => {
    const target = resolvePdtpFulfillmentTarget({ mechanism: "enganche", n: n as number }, WS_ID)
    expect(target.module).toBe(moduleName)
    expect(target.href).toBe(`${prefix}?faena=${WS_ID}`)
    expect(target.ctaLabel).toBe("Ir a cumplirla")
  })

  it.each([15, 18, 23, 52])("la compuesta n=%i se cumple en el alta del trabajador", (n) => {
    const target = resolvePdtpFulfillmentTarget({ mechanism: "compuesta", n }, WS_ID)
    expect(target.module).toBe("sst")
    expect(target.href).toBe(`/prevencion/nueva?faena=${WS_ID}`)
    expect(target.ctaLabel).toBe("Ir a cumplirla")
  })

  it("conserva el destino histórico de una campaña que aún no migró al catálogo", () => {
    const target = resolvePdtpFulfillmentTarget({ mechanism: "enganche", n: 88 }, WS_ID)
    expect(target.kind).toBe("operational")
    expect(target.module).toBe("campanas")
    expect(target.href).toBe(`/prevencion/campanas?faena=${WS_ID}`)
  })

  it("la N°1 lleva al flujo de aprobación del programa concreto", () => {
    const target = resolvePdtpFulfillmentTarget({ mechanism: "enganche", n: 1, programId: PROGRAM_ID }, WS_ID)
    expect(target.module).toBe("pdtp")
    expect(target.href).toBe(`/prevencion/pdtp/${PROGRAM_ID}?faena=${WS_ID}`)
    expect(target.ctaLabel).toBe("Ir a cumplirla")
  })

  it("la N°1 sin programa concreto se declara fallback y no inventa un destino", () => {
    const target = resolvePdtpFulfillmentTarget({ mechanism: "enganche", n: 1 }, WS_ID)
    expect(target.kind).toBe("fallback")
    expect(target.href).toBe(`/prevencion/pdtp/actividades?faena=${WS_ID}&vista=semana`)
  })

  it("la N°11 lleva a la organización preventiva de la faena", () => {
    const target = resolvePdtpFulfillmentTarget({ mechanism: "enganche", n: 11 }, WS_ID)
    expect(target.module).toBe("faenas")
    expect(target.href).toBe(`/prevencion/faenas/${WS_ID}`)
    expect(target.ctaLabel).toBe("Ir a cumplirla")
  })
})

describe("assertPdtpFulfillmentCoverage — compuerta 81/81", () => {
  it("no reporta problemas para un programa sin actividades", async () => {
    await seedProgram("draft")
    expect(await assertPdtpFulfillmentCoverage(PROGRAM_ID)).toEqual([])
  })

  it("una actividad sin mecanismo clasificado es code_gap", async () => {
    await seedProgram("draft")
    await seedActivity({ mechanism: "sin_definir", evidenceRequirement: null })
    const issues = await assertPdtpFulfillmentCoverage(PROGRAM_ID)
    expect(issues).toEqual([expect.objectContaining({ n: ACT_N, status: "code_gap" })])
  })

  it("una constancia sin evidencia mínima es config_required", async () => {
    await seedProgram("draft")
    await seedActivity({ mechanism: "constancia", evidenceRequirement: null })
    const issues = await assertPdtpFulfillmentCoverage(PROGRAM_ID)
    expect(issues).toEqual([expect.objectContaining({ n: ACT_N, status: "config_required" })])
  })

  it("un responsable sin rol RBAC real es permission_gap", async () => {
    await seedProgram("draft")
    await seedActivity({ responsibleSlugs: ["inventado"] })
    const issues = await assertPdtpFulfillmentCoverage(PROGRAM_ID)
    expect(issues).toEqual([expect.objectContaining({ n: ACT_N, status: "permission_gap" })])
  })

  it("un enganche sin plantilla, curso, campaña o plan declarado es config_required", async () => {
    await seedProgram("draft")
    await seedActivity({ mechanism: "enganche", n: 99 })
    const issues = await assertPdtpFulfillmentCoverage(PROGRAM_ID)
    expect(issues).toEqual([expect.objectContaining({ n: 99, status: "config_required" })])
  })

  it("un enganche ejecutable que aún cae a la planilla genérica es destination_not_configured", async () => {
    await seedProgram("draft")
    await seedActivity({ mechanism: "enganche", n: 99 })
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.preventionInspectionTemplates).values({
      id: "tpl-approved-99", code: "pdtp_sin_destino", versionLabel: "01", status: "approved",
      name: "Instrumento sin destino operativo", kind: "inspection", executorOfRecord: "platform_user",
      definitionSnapshot: {}, contentHash: "b".repeat(64), pdtpActivityNumbers: [99],
      authorUserId: USER_ID, approvedByUserId: USER_ID, approvedAt: now, createdAt: now, updatedAt: now,
    })

    const issues = await assertPdtpFulfillmentCoverage(PROGRAM_ID)
    expect(issues).toEqual([expect.objectContaining({ n: 99, status: "destination_not_configured" })])
    expect(issues[0]!.reason).toMatch(/destino operativo/i)
  })

  it("la N°63 exige un curso con versión publicada aunque tenga otro conector", async () => {
    await seedProgram("draft")
    await seedActivity({ mechanism: "enganche", n: 63 })
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.preventionTrainingCourses).values({
      id: "course-pdtp-63", code: "PDTP-63", name: "Inducción del trabajador", kind: "induction_worksite",
      minimumDurationMinutes: 60, isActive: true, createdByUserId: USER_ID,
      pdtpActivityNumbers: [63], createdAt: now, updatedAt: now,
    })

    const issues = await assertPdtpFulfillmentCoverage(PROGRAM_ID)
    expect(issues).toEqual([expect.objectContaining({ n: 63, status: "instrument_required" })])
    expect(issues[0]!.reason).toMatch(/versión publicada/i)
  })

  it("un curso publicado más corto que el mínimo del catálogo no vuelve ejecutable la actividad", async () => {
    await seedProgram("draft")
    await seedActivity({ mechanism: "enganche", n: 56 })
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.preventionTrainingCourses).values({
      id: "course-pdtp-56", code: "PDTP-56", name: "Manejo a la defensiva", kind: "practical_training",
      minimumDurationMinutes: 480, validityMonths: 24, isActive: true, createdByUserId: USER_ID,
      pdtpActivityNumbers: [56], createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.preventionTrainingCourseVersions).values({
      id: "version-pdtp-56-short", courseId: "course-pdtp-56", versionLabel: "Corta",
      status: "published", contentOutline: [{ title: "Conducción", minutes: 60 }], durationMinutes: 60,
      modality: "presencial", assessmentType: "practical", passingScore: 70,
      contentHash: "a".repeat(64), authorUserId: USER_ID, publishedByUserId: USER_ID,
      publishedAt: now, version: 1, createdAt: now, updatedAt: now,
    })

    const issues = await assertPdtpFulfillmentCoverage(PROGRAM_ID)
    expect(issues).toEqual([expect.objectContaining({ n: 56, status: "instrument_required" })])
    expect(issues[0]!.reason).toMatch(/duración|versión publicada/i)
  })

  it("un enganche declarado en STRUCTURALLY_WIRED_ACTIVITY_NUMBERS pasa (N°35, MIPER)", async () => {
    await seedProgram("draft")
    await seedActivity({ mechanism: "enganche", n: 35 })
    expect(await assertPdtpFulfillmentCoverage(PROGRAM_ID)).toEqual([
      expect.objectContaining({ n: 35, status: "segregated_valid", destinationModule: "riesgos" }),
    ])
  })

  it("una plantilla en borrador declara el número pero no lo vuelve ejecutable", async () => {
    await seedProgram("draft")
    await seedActivity({ n: 24, mechanism: "enganche", evidenceRequirement: null })
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.preventionInspectionTemplates).values({
      id: "tpl-draft-24", code: "inspeccion_extintores", versionLabel: "02", status: "draft",
      name: "Inspección de extintores", kind: "inspection", executorOfRecord: "platform_user",
      definitionSnapshot: {}, contentHash: "a".repeat(64),
      pdtpActivityNumbers: [24], authorUserId: USER_ID, createdAt: now, updatedAt: now,
    })

    const issues = await assertPdtpFulfillmentCoverage(PROGRAM_ID)
    const n24 = issues.filter((issue) => issue.n === 24)
    expect(n24).toEqual([expect.objectContaining({ status: "instrument_required" })])
    expect(n24[0]!.reason).toContain("aprobada")
  })

  it("aprobar la plantilla limpia el bloqueo de instrumento", async () => {
    await seedProgram("draft")
    await seedActivity({ n: 24, mechanism: "enganche", evidenceRequirement: null })
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.preventionInspectionTemplates).values({
      id: "tpl-approved-24", code: "inspeccion_extintores", versionLabel: "02", status: "approved",
      name: "Inspección de extintores", kind: "inspection", executorOfRecord: "platform_user",
      definitionSnapshot: {}, contentHash: "a".repeat(64),
      pdtpActivityNumbers: [24], authorUserId: USER_ID, createdAt: now, updatedAt: now,
      approvedByUserId: USER_ID, approvedAt: now,
    })

    // En una v1 histórica no se inventan ejecutores. Este test verifica que
    // aprobar la plantilla apague específicamente `instrument_required`/
    // `config_required`; v+1 cubre la asignación explícita abajo.
    const issues = await assertPdtpFulfillmentCoverage(PROGRAM_ID)
    expect(issues.filter((issue) => issue.n === 24)).toEqual([])
  })

  it("la N°84 exige un plan en TODAS las faenas del programa, no en cualquiera", async () => {
    // Antes las cinco tablas se leían juntas y globalmente, así que un plan en
    // una faena daba la N°84 por resuelta en las siete. El informe no podía
    // decir "no hay plan en la faena X", que es lo único accionable.
    await inMemoryDb.insert(schema.worksites).values({ id: "ws-fulfill-2", name: "Faena Sin Plan", code: "FSP", isActive: true })
    await seedProgram("draft")
    await seedActivity({ mechanism: "enganche", n: 84 })

    const sinPlanes = await assertPdtpFulfillmentCoverage(PROGRAM_ID)
    expect(sinPlanes).toEqual([expect.objectContaining({ n: 84, status: "config_required" })])

    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.preventionEmergencyPlans).values({
      id: "plan-fulfill-1", worksiteId: WS_ID, code: "PE-01", title: "Plan de emergencia",
      status: "draft", version: 1, pdtpActivityNumbers: [84],
      createdByUserId: USER_ID, createdAt: now, updatedAt: now,
    })

    const conUnPlan = (await assertPdtpFulfillmentCoverage(PROGRAM_ID)).filter((i) => i.status === "config_required")
    expect(conUnPlan).toHaveLength(1)
    expect(conUnPlan[0]!.reason).toContain("Faena Sin Plan")

    await inMemoryDb.insert(schema.preventionEmergencyPlans).values({
      id: "plan-fulfill-2", worksiteId: "ws-fulfill-2", code: "PE-02", title: "Plan de emergencia",
      status: "draft", version: 1, pdtpActivityNumbers: [84],
      createdByUserId: USER_ID, createdAt: now, updatedAt: now,
    })
    // Ya no hay problema de configuración. La v1 histórica conserva sus
    // responsables sin fabricar ejecutores para la actividad.
    expect((await assertPdtpFulfillmentCoverage(PROGRAM_ID)).filter((i) => i.status === "config_required")).toEqual([])
  })

  it("una actividad excluida de una faena no exige configuración en esa faena", async () => {
    // Misma N°84 que arriba, pero con la faena secundaria excluida: ya no
    // cuenta en el denominador, así que un plan sólo en la faena principal
    // debería bastar.
    await inMemoryDb.insert(schema.worksites).values({ id: "ws-fulfill-2", name: "Faena Sin Plan", code: "FSP", isActive: true })
    await seedProgram("draft")
    const activityId = `${PROGRAM_ID}-a-084`
    await seedActivity({ id: activityId, n: 84, mechanism: "enganche", activity: "Simulacros", evidenceRequirement: null })
    const now = new Date().toISOString()

    // Sólo la faena principal declara el número; la segunda no tiene plan.
    await inMemoryDb.insert(schema.preventionEmergencyPlans).values({
      id: "plan-excl-1", worksiteId: WS_ID, code: "PE-01", title: "Plan de emergencia",
      status: "draft", version: 1, pdtpActivityNumbers: [84],
      createdByUserId: USER_ID, createdAt: now, updatedAt: now,
    })

    const antes = (await assertPdtpFulfillmentCoverage(PROGRAM_ID))
      .filter((i) => i.n === 84 && i.status === "config_required")
    expect(antes).toHaveLength(1)

    await inMemoryDb.insert(schema.pdtpActivityWorksiteExclusions).values({
      id: "excl-84-ws2", activityId, worksiteId: "ws-fulfill-2",
      reason: "Oficina sin operación de terreno", createdByUserId: USER_ID, createdAt: now,
    })

    const despues = (await assertPdtpFulfillmentCoverage(PROGRAM_ID))
      .filter((i) => i.n === 84 && i.status === "config_required")
    expect(despues).toEqual([])
  })

  it("una compuesta sin destino declarado ya no pasa gratis", async () => {
    // La verificación de cableado corría sólo para `enganche`. La exención de
    // `compuesta` estaba razonada para el chequeo de PERMISO —nadie la ejecuta—
    // y se había arrastrado hasta acá, que es lo que dejaba pasar a la N°16 y la
    // N°17 sin ningún componente que las acreditara.
    await seedProgram("draft")
    await seedActivity({ mechanism: "compuesta", n: 98 })
    const issues = await assertPdtpFulfillmentCoverage(PROGRAM_ID)
    expect(issues).toEqual([expect.objectContaining({ n: 98, status: "config_required" })])
  })

  it("una compuesta con conector propio pasa el cableado (N°52)", async () => {
    await seedProgram("draft")
    await seedActivity({ mechanism: "compuesta", n: 52 })
    const issues = await assertPdtpFulfillmentCoverage(PROGRAM_ID)
    expect(issues.filter((i) => i.status === "config_required")).toEqual([])
  })

  /* El destino de una `compuesta` se verifica igual que el de un `enganche`.
   * La exención venía del chequeo de PERMISO de la planilla —nadie la ejecuta—
   * y no aplica al acto que la acredita: la N°52 cierra con el acta de
   * trabajador nuevo, que exige `sst:close`, y su responsable no lo tiene. Es
   * lo que la compuerta dejaba pasar sin decir nada. */
  it("una compuesta histórica no recibe ejecutores inventados", async () => {
    await seedProgram("draft")
    await seedActivity({ mechanism: "compuesta", n: 52 })
    const issues = await assertPdtpFulfillmentCoverage(PROGRAM_ID)
    expect(issues).toEqual([])
  })

  it("la N°43 la declara el tipo de documento al publicar", async () => {
    await seedProgram("draft")
    await seedActivity({ mechanism: "enganche", n: 43 })
    expect(await assertPdtpFulfillmentCoverage(PROGRAM_ID)).toEqual([
      expect.objectContaining({ n: 43, status: "config_required" }),
    ])

    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.sstDocumentCategories).values({
      slug: "gestion_preventiva", name: "Gestión preventiva", sortOrder: 10, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.sstDocumentTypes).values({
      id: "sstdt-pts", categorySlug: "gestion_preventiva", code: "PTS", name: "Procedimiento de trabajo seguro",
      pdtpActivityNumbers: [43], createdAt: now, updatedAt: now,
    })
    expect(await assertPdtpFulfillmentCoverage(PROGRAM_ID)).toEqual([
      expect.objectContaining({ n: 43, status: "segregated_valid", destinationModule: "documentacion" }),
    ])
  })

  it("la N°36 declarada sólo en la columna de acuse también cuenta como cableada", async () => {
    // Son dos columnas porque son dos momentos, pero para "¿tiene destino?"
    // cualquiera de las dos sirve.
    await seedProgram("draft")
    await seedActivity({ mechanism: "enganche", n: 36 })
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.sstDocumentCategories).values({
      slug: "gestion_preventiva", name: "Gestión preventiva", sortOrder: 10, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.sstDocumentTypes).values({
      id: "sstdt-miper-dif", categorySlug: "gestion_preventiva", code: "MIPER-DIF", name: "Difusión MIPER",
      pdtpActivityNumbers: null, pdtpAcknowledgmentActivityNumbers: [36], createdAt: now, updatedAt: now,
    })
    expect((await assertPdtpFulfillmentCoverage(PROGRAM_ID)).filter((i) => i.status === "config_required")).toEqual([])
  })

  it("un enganche histórico no convierte al responsable en ejecutor", async () => {
    await seedProgram("draft")
    // La N°24 se cumple en Inspecciones y exige `inspections:execute`; el rol
    // del fixture sólo tiene el permiso de constancias.
    await seedActivity({ mechanism: "enganche", n: 24 })
    await inMemoryDb.insert(schema.preventionInspectionTemplates).values({
      id: "tpl-fulfill-24", code: "inspeccion_extintores", versionLabel: "01",
      name: "Inspección de extintores", kind: "inspection", definitionSnapshot: {},
      contentHash: "x".repeat(64), status: "approved", authorUserId: USER_ID,
      // El CHECK `prevention_inspection_template_approved_consistent` exige
      // firmante y fecha en una plantilla aprobada.
      approvedByUserId: USER_ID, approvedAt: new Date().toISOString(),
      pdtpActivityNumbers: [24],
    })

    expect(await assertPdtpFulfillmentCoverage(PROGRAM_ID)).toEqual([])
  })

  it("una revisión v+1 exige un ejecutor antes de enviarse a revisión", async () => {
    await seedProgram("draft", 2)
    await seedActivity({ mechanism: "constancia" })
    expect(await assertPdtpFulfillmentCoverage(PROGRAM_ID)).toEqual([
      expect.objectContaining({ n: ACT_N, status: "executor_required", requiredPermission: "prevention:constancias:execute" }),
    ])
  })

  it("acredita cada hecho en la versión vigente en su fecha, aunque se reintente después", async () => {
    await seedProgram("active", 1)
    await seedActivity({ id: `${PROGRAM_ID}-v1-a-042` })
    await inMemoryDb.update(schema.pdtpPrograms).set({
      status: "closed",
      activatedAt: "2026-01-01T00:00:00.000Z",
    }).where(eq(schema.pdtpPrograms.id, PROGRAM_ID))
    await inMemoryDb.insert(schema.pdtpPrograms).values({
      id: "pdtp-fulfill-v2",
      version: 2,
      year: PROGRAM_YEAR,
      title: `PDTP ${PROGRAM_YEAR} fulfillment v2`,
      status: "active",
      appliesToAllWorksites: true,
      sourceProgramId: PROGRAM_ID,
      sourceContentVersion: 1,
      elaboratedByName: "Prevencionista",
      elaboratedByTitle: "Experto en Prevención",
      creationMode: "blank",
      complianceTarget: 0.9,
      pesoEjecucion: 0.5,
      pesoVerificacion: 0.3,
      pesoCierre: 0.2,
      activatedAt: "2026-06-01T00:00:00.000Z",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await inMemoryDb.insert(schema.pdtpActivities).values({
      id: "pdtp-fulfill-v2-a-042",
      programId: "pdtp-fulfill-v2",
      n: ACT_N,
      activity: "Inspección de extintores v2",
      program: "Prevención PDTP",
      responsibleSlugs: ["prevencionista"],
      responsibleDisplay: "Prevencionista",
      scheduleMode: "scheduled",
      scheduleClassificationStatus: "confirmed",
      mechanism: "constancia",
      evidenceRequirement: "Registro verificable",
      sourceSheetRow: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const beforeCutover = await accreditPdtpFromEvent({
      sourceType: "campana",
      sourceId: "cutover-before",
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: "2026-05-31T12:00:00.000Z",
    })
    const afterCutover = await accreditPdtpFromEvent({
      sourceType: "campana",
      sourceId: "cutover-after",
      worksiteId: WS_ID,
      activityNumbers: [ACT_N],
      occurredAt: "2026-06-01T12:00:00.000Z",
    })

    expect(beforeCutover.accredited).toEqual([
      expect.objectContaining({ activityId: `${PROGRAM_ID}-v1-a-042`, activityN: ACT_N }),
    ])
    expect(afterCutover.accredited).toEqual([
      expect.objectContaining({ activityId: "pdtp-fulfill-v2-a-042", activityN: ACT_N }),
    ])
  })

  it("una revisión v+1 distingue ejecutor sin permiso de uno válido", async () => {
    await seedProgram("draft", 2)
    await seedActivity({ mechanism: "enganche", n: 24 })
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.preventionInspectionTemplates).values({
      id: "tpl-v2-24", code: "inspeccion-v2", versionLabel: "01", status: "approved",
      name: "Inspección v2", kind: "inspection", executorOfRecord: "platform_user",
      definitionSnapshot: {}, contentHash: "v".repeat(64), pdtpActivityNumbers: [24],
      authorUserId: USER_ID, approvedByUserId: USER_ID, approvedAt: now, createdAt: now, updatedAt: now,
    })
    await seedExecutor()
    expect(await assertPdtpFulfillmentCoverage(PROGRAM_ID)).toEqual([
      expect.objectContaining({ n: 24, status: "executor_permission_gap", requiredPermission: "prevention:inspections:execute" }),
    ])
    await inMemoryDb.insert(schema.permissions).values({ id: "perm-inspections-execute", name: "prevention:inspections:execute", module: "prevention" })
    await inMemoryDb.insert(schema.rolePermissions).values({ roleId: "role-prf", permissionId: "perm-inspections-execute" })
    expect(await assertPdtpFulfillmentCoverage(PROGRAM_ID)).toEqual([])
  })

  it("una actividad de enganche segregada a propósito queda explícita como válida", async () => {
    // La N°83 la redacta el prevencionista de faena y la firma otra persona:
    // `approveEmergencyPlan` rechaza que coincidan. Exigirle el permiso de
    // aprobar contradiría esa regla.
    await seedProgram("draft")
    await seedActivity({ mechanism: "enganche", n: 83 })
    expect(await assertPdtpFulfillmentCoverage(PROGRAM_ID)).toEqual([
      expect.objectContaining({ n: 83, status: "segregated_valid", destinationModule: "emergencias" }),
    ])
  })

  it("cobertura sin padrón declarado es decision_required, no bloqueante", async () => {
    await seedProgram("draft")
    await seedActivity({ indicatorMode: "coverage", subjectSource: null })
    const issues = await assertPdtpFulfillmentCoverage(PROGRAM_ID)
    expect(issues).toEqual([expect.objectContaining({ n: ACT_N, status: "decision_required" })])
  })

  it("cobertura con padrón manual en todas las faenas aplicables no queda como decisión pendiente", async () => {
    await seedProgram("draft")
    await seedActivity({ indicatorMode: "coverage", subjectSource: null })
    await inMemoryDb.insert(schema.pdtpActivityWorksiteParams).values({
      id: "param-coverage-manual", activityId: ACT_ID, worksiteId: WS_ID,
      expectedSubjectCount: 8, updatedByUserId: USER_ID,
    })

    expect(await assertPdtpFulfillmentCoverage(PROGRAM_ID)).toEqual([])
  })

  it("una actividad retirada no se evalúa", async () => {
    await seedProgram("draft")
    await seedActivity({ status: "retired", mechanism: "sin_definir", retiredReason: "Motivo de retiro suficientemente largo.", retiredEffectiveFrom: "2026-01-01", retiredAt: new Date().toISOString() })
    expect(await assertPdtpFulfillmentCoverage(PROGRAM_ID)).toEqual([])
  })
})

describe("compuerta 81/81 — permiso en el módulo destino (2026-09-03)", () => {
  it("una constancia v+1 cuyo ejecutor no puede entrar a Constancias es executor_permission_gap", async () => {
    await seedProgram("draft", 2)
    await seedActivity({ mechanism: "constancia", evidenceRequirement: "Registro verificable" })
    await seedExecutor()
    // Se le quita al ejecutor el permiso del módulo donde la constancia se marca.
    await inMemoryDb.delete(schema.rolePermissions).where(eq(schema.rolePermissions.permissionId, "perm-constancias-execute"))

    const issues = await assertPdtpFulfillmentCoverage(PROGRAM_ID)
    expect(issues).toEqual([expect.objectContaining({
      n: ACT_N,
      status: "executor_permission_gap",
      requiredPermission: "prevention:constancias:execute",
    })])
  })

  it("con ejecutor y permiso cargados, la misma actividad v+1 pasa la compuerta", async () => {
    await seedProgram("draft", 2)
    await seedActivity({ mechanism: "constancia", evidenceRequirement: "Registro verificable" })
    await seedExecutor()
    expect(await assertPdtpFulfillmentCoverage(PROGRAM_ID)).toEqual([])
  })

  it("las de enganche no se verifican por permiso: su módulo destino no está declarado en ninguna parte", async () => {
    await seedProgram("draft")
    // Sin ningún permiso cargado para el rol, una `enganche` con conector
    // estructural sigue pasando: la compuerta prefiere no afirmar nada antes
    // que verificar contra el módulo equivocado.
    await inMemoryDb.delete(schema.rolePermissions)
    await seedActivity({ mechanism: "enganche", n: 35, id: `${PROGRAM_ID}-a-035` })

    const issues = await assertPdtpFulfillmentCoverage(PROGRAM_ID)
    expect(issues.filter((issue) => issue.n === 35)).toEqual([
      expect.objectContaining({ status: "segregated_valid" }),
    ])
  })
})

describe("countPdtpFulfillmentBacklog — el libro de cumplimiento hecho visible", () => {
  it("cuenta pending y errored por separado, con el último error", async () => {
    await seedProgram("draft")
    await seedActivity()
    // Sin programa activo, este evento queda en error.
    await recordPdtpFulfillmentEvent({
      sourceType: "campana", sourceId: "campana-backlog-1", worksiteId: WS_ID,
      activityNumbers: [ACT_N], occurredAt: new Date().toISOString(),
    })

    const backlog = await countPdtpFulfillmentBacklog(PROGRAM_ID)
    expect(backlog.errored).toBe(1)
    expect(backlog.pending).toBe(0)
    expect(backlog.lastError).toMatch(/programa PDTP activo/i)
    expect(backlog.digestDrift).toBe(false)
  })

  it("no atribuye al programa errores de una faena que no pertenece a él", async () => {
    await seedProgram("draft")
    await seedActivity()
    await inMemoryDb.insert(schema.worksites).values({ id: "ws-outside", name: "Faena externa", code: "EXT", isActive: true })
    await inMemoryDb.insert(schema.pdtpProgramWorksites).values({
      id: "member-backlog", programId: PROGRAM_ID, worksiteId: WS_ID,
      isActive: true, addedByUserId: USER_ID, addedAt: new Date().toISOString(),
    })
    await recordPdtpFulfillmentEvent({
      sourceType: "emergencia", sourceId: "plan-outside", worksiteId: "ws-outside",
      activityNumbers: [83], occurredAt: new Date().toISOString(),
    })

    const backlog = await countPdtpFulfillmentBacklog(PROGRAM_ID)
    expect(backlog.errored).toBe(0)
    expect(backlog.lastError).toBeNull()
  })

  it("respeta el alcance visible de la sesión al mostrar un programa sin membresías", async () => {
    await seedProgram("draft")
    await seedActivity()
    await inMemoryDb.insert(schema.worksites).values({ id: "ws-outside", name: "Faena externa", code: "EXT", isActive: true })
    await recordPdtpFulfillmentEvent({
      sourceType: "campana", sourceId: "campana-visible", worksiteId: WS_ID,
      activityNumbers: [ACT_N], occurredAt: new Date().toISOString(),
    })
    await recordPdtpFulfillmentEvent({
      sourceType: "campana", sourceId: "campana-oculta", worksiteId: "ws-outside",
      activityNumbers: [ACT_N], occurredAt: new Date().toISOString(),
    })

    const scoped = await countPdtpFulfillmentBacklog(PROGRAM_ID, { worksiteIds: [WS_ID] })
    expect(scoped.errored).toBe(1)
    expect(scoped.recentRejected).toHaveLength(0)

    const emptyScope = await countPdtpFulfillmentBacklog(PROGRAM_ID, { worksiteIds: [] })
    expect(emptyScope.errored).toBe(0)
  })

  it("limita un programa corporativo a faenas activas al contar el libro", async () => {
    await seedProgram("draft")
    await seedActivity()
    await inMemoryDb.insert(schema.worksites).values({
      id: "ws-inactive", name: "Faena desactivada", code: "OFF", isActive: false,
    })
    await recordPdtpFulfillmentEvent({
      sourceType: "campana", sourceId: "campana-corporativa-activa", worksiteId: WS_ID,
      activityNumbers: [ACT_N], occurredAt: new Date().toISOString(),
    })
    await recordPdtpFulfillmentEvent({
      sourceType: "campana", sourceId: "campana-corporativa-inactiva", worksiteId: "ws-inactive",
      activityNumbers: [ACT_N], occurredAt: new Date().toISOString(),
    })

    const backlog = await countPdtpFulfillmentBacklog(PROGRAM_ID)
    expect(backlog.errored).toBe(1)
    expect(backlog.lastError).toMatch(/programa PDTP activo/i)
  })

  /**
   * PDTP-002 (auditoría 2026-09-14) — Un evento de cumplimiento rechazado no
   * aparecía en ninguna pantalla. El panel sólo contaba `pending` y `error`;
   * un hecho con fecha retroactiva fuera del año del programa quedaba
   * `rejected` y desaparecía: el trabajo se hizo, la plataforma decidió no
   * acreditarlo y esa decisión no se veía en ninguna parte.
   */
  it("cuenta los hechos que el motor decidió no acreditar y dice por qué", async () => {
    await seedProgram("active")
    await seedActivity()
    await recordPdtpFulfillmentEvent({
      sourceType: "campana", sourceId: "campana-retroactiva", worksiteId: WS_ID,
      activityNumbers: [ACT_N], occurredAt: `${PROGRAM_YEAR - 1}-05-10T12:00:00.000Z`,
    })

    const [event] = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)
      .where(eq(schema.pdtpFulfillmentEvents.sourceId, "campana-retroactiva"))
    expect(event?.status).toBe("rejected")

    const backlog = await countPdtpFulfillmentBacklog(PROGRAM_ID)
    expect(backlog.rejected).toBe(1)
    // No se confunde con un fallo de cableado: el cron no lo va a reintentar.
    expect(backlog.errored).toBe(0)
    expect(backlog.recentRejected).toHaveLength(1)
    expect(backlog.recentRejected[0]?.sourceId).toBe("campana-retroactiva")
    expect(backlog.recentRejected[0]?.reason).toContain(String(PROGRAM_YEAR - 1))
  })

  it("traduce las tres razones normales de rechazo", () => {
    expect(describePdtpRejection({ skippedOutOfPeriod: { occurredYear: 2025, programYear: 2026 } }))
      .toMatch(/ocurrió en 2025.*cubre 2026/)
    expect(describePdtpRejection({ skippedExcluded: [12], skippedNotFound: [] }))
      .toMatch(/N°12 excluidas de esta faena/)
    expect(describePdtpRejection({ skippedExcluded: [], skippedNotFound: [77] }))
      .toMatch(/N°77 no existen/)
    expect(describePdtpRejection({ accredited: [], skippedExcluded: [], skippedNotFound: [] }))
      .toMatch(/no encontró ninguna actividad/)
  })

  it("un programa sin huella firmada (contentDigest null) nunca reporta deriva", async () => {
    await seedProgram("draft")
    await seedActivity()
    const backlog = await countPdtpFulfillmentBacklog(PROGRAM_ID)
    expect(backlog.digestDrift).toBe(false)
  })

  it("compara la huella vigente contra la firmada cuando existe", async () => {
    await seedProgram("draft")
    await seedActivity()

    const current = await computePdtpProgramContentDigest(PROGRAM_ID)
    await inMemoryDb.update(schema.pdtpPrograms)
      .set({ contentDigest: "0".repeat(64), reviewSnapshotJson: current.snapshot })
      .where(eq(schema.pdtpPrograms.id, PROGRAM_ID))
    expect((await countPdtpFulfillmentBacklog(PROGRAM_ID)).digestDrift).toBe(true)

    const { digest, snapshot } = current
    await inMemoryDb.update(schema.pdtpPrograms)
      .set({ contentDigest: digest, reviewSnapshotJson: snapshot })
      .where(eq(schema.pdtpPrograms.id, PROGRAM_ID))
    expect((await countPdtpFulfillmentBacklog(PROGRAM_ID)).digestDrift).toBe(false)
  })

  it("expone una huella histórica sin esquema como no verificable, no como drift", async () => {
    await seedProgram("active")
    await seedActivity()

    await inMemoryDb.update(schema.pdtpPrograms)
      .set({ contentDigest: "f".repeat(64), reviewSnapshotJson: null })
      .where(eq(schema.pdtpPrograms.id, PROGRAM_ID))

    const backlog = await countPdtpFulfillmentBacklog(PROGRAM_ID)
    expect(backlog.digestDrift).toBe(false)
    expect(backlog.digestVerificationUnavailable).toBe(true)
    expect(backlog.digestVerificationMessage).toMatch(/sin versión de esquema declarada/i)
  })
})

describe("getPdtpCoverageReport — el informe desagregado", () => {
  it("cuenta listas sobre el total y agrupa los problemas, con lo bloqueante primero", async () => {
    const { getPdtpCoverageReport } = await import("@/lib/services/pdtp/lifecycle")
    await seedProgram("draft")
    // Una lista, una sin mecanismo, y una de cobertura sin padrón (informativa).
    await seedActivity()
    await seedActivity({ id: `${PROGRAM_ID}-a-050`, n: 50, mechanism: "sin_definir" })
    // Constancia con evidencia: pasa los chequeos previos y llega al de
    // cobertura. Una `enganche` con número no cableado se detendría antes, en
    // `config_required`, y nunca alcanzaría el `decision_required`.
    await seedActivity({ id: `${PROGRAM_ID}-a-054`, n: 54, mechanism: "constancia", evidenceRequirement: "Registro verificable", indicatorMode: "coverage", subjectSource: null })

    const report = await getPdtpCoverageReport(PROGRAM_ID)
    expect(report.total).toBe(3)
    expect(report.ready).toBe(1)
    expect(report.groups.map((group) => group.status)).toEqual(["code_gap", "decision_required"])
    expect(report.groups[0]).toMatchObject({ blocks: true, issues: [expect.objectContaining({ n: 50 })] })
    // La de cobertura se informa pero no frena el envío.
    expect(report.groups[1]).toMatchObject({ blocks: false, issues: [expect.objectContaining({ n: 54 })] })
  })

  it("un programa sin problemas reporta todas listas", async () => {
    const { getPdtpCoverageReport } = await import("@/lib/services/pdtp/lifecycle")
    await seedProgram("draft")
    await seedActivity()
    const report = await getPdtpCoverageReport(PROGRAM_ID)
    expect(report).toMatchObject({ total: 1, ready: 1, groups: [] })
  })

  it("un flujo segregado se muestra, pero sigue contando como listo", async () => {
    const { getPdtpCoverageReport } = await import("@/lib/services/pdtp/lifecycle")
    await seedProgram("draft")
    await seedActivity({ mechanism: "enganche", n: 83 })

    const report = await getPdtpCoverageReport(PROGRAM_ID)
    expect(report).toMatchObject({ total: 1, ready: 1 })
    expect(report.groups).toEqual([
      expect.objectContaining({ status: "segregated_valid", blocks: false, issues: [expect.objectContaining({ n: 83 })] }),
    ])
  })

  it("acota los nombres de faena del informe al alcance solicitado", async () => {
    const { getPdtpCoverageReport } = await import("@/lib/services/pdtp/lifecycle")
    const outsideWorksiteId = "ws-fulfill-outside"
    await inMemoryDb.insert(schema.worksites).values({
      id: outsideWorksiteId,
      name: "Faena fuera del alcance",
      code: "FOA",
      isActive: true,
    })
    await seedProgram("draft")
    await seedActivity({ n: 84, mechanism: "enganche" })
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.preventionEmergencyPlans).values({
      id: "plan-fulfill-visible",
      worksiteId: WS_ID,
      code: "PE-VISIBLE",
      title: "Plan de emergencia visible",
      status: "approved",
      version: 1,
      pdtpActivityNumbers: [84],
      createdByUserId: USER_ID,
      approvedByUserId: USER_ID,
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    })

    const globalReport = await getPdtpCoverageReport(PROGRAM_ID)
    const globalIssue = globalReport.groups.flatMap((group) => group.issues).find((issue) => issue.n === 84)
    expect(globalIssue?.reason).toContain("Faena fuera del alcance")

    const scopedReport = await getPdtpCoverageReport(PROGRAM_ID, { worksiteIds: [WS_ID] })
    expect(scopedReport).toMatchObject({ total: 1, ready: 1, groups: [] })
  })
})
