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
const { countPdtpFulfillmentBacklog } = await import("@/lib/services/pdtp/backlog")
const { computePdtpProgramContentDigest } = await import("@/lib/services/pdtp/content-digest")

/* El motor sólo acredita cuando el año del programa coincide con el del
 * evento, así que se siembra con el año en curso. */
const PROGRAM_YEAR = chileDateParts().year
const USER_ID = "user-fulfill-1"
const WS_ID = "ws-fulfill-1"
const PROGRAM_ID = "pdtp-fulfill-v1"
const ACT_N = 42
const ACT_ID = `${PROGRAM_ID}-a-042`

async function seedProgram(status: "draft" | "active") {
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, version: 1, year: PROGRAM_YEAR, title: `PDTP ${PROGRAM_YEAR} fulfillment`,
    status, elaboratedByName: "Prevencionista", elaboratedByTitle: "Experto en Prevención",
    creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  })
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpFulfillmentEvents)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteExclusions)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.preventionInspectionTemplates)
  await inMemoryDb.delete(schema.preventionEmergencyPlans)
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
      activityNumbers: [ACT_N], occurredAt: new Date().toISOString(),
    })
    expect(result?.accredited).toHaveLength(1)

    const [event] = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)
      .where(eq(schema.pdtpFulfillmentEvents.sourceId, "campana-2"))
    expect(event?.status).toBe("accredited")

    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, ACT_ID))
    expect(executions).toHaveLength(1)
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

  it("un enganche declarado en STRUCTURALLY_WIRED_ACTIVITY_NUMBERS pasa (N°35, MIPER)", async () => {
    await seedProgram("draft")
    await seedActivity({ mechanism: "enganche", n: 35 })
    expect(await assertPdtpFulfillmentCoverage(PROGRAM_ID)).toEqual([])
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

    // El destino de la N°24 (Inspecciones) es otra pregunta —`destination_review`,
    // no bloqueante, y ya cubierta por el test de arriba con el mismo n=24—; lo
    // que este test verifica es específicamente que aprobar la plantilla apague
    // el `instrument_required`/`config_required`, no que la actividad quede sin
    // ningún issue.
    const issues = await assertPdtpFulfillmentCoverage(PROGRAM_ID)
    const blockingIssues = issues.filter((issue) => issue.n === 24 && issue.status !== "destination_review")
    expect(blockingIssues).toEqual([])
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
    // Ya no hay problema de configuración. Queda un `destination_review`, que
    // es otra cosa y no bloquea: el responsable del fixture no tiene el permiso
    // de simulacros.
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
  it("una compuesta cuyo acto acreditador no tiene dueño sale a revisión", async () => {
    await seedProgram("draft")
    await seedActivity({ mechanism: "compuesta", n: 52 })
    const issues = await assertPdtpFulfillmentCoverage(PROGRAM_ID)
    expect(issues).toEqual([
      expect.objectContaining({ n: 52, status: "destination_review" }),
    ])
    expect(issues[0]!.reason).toMatch(/sst:close/)
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
    expect(await assertPdtpFulfillmentCoverage(PROGRAM_ID)).toEqual([])
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

  it("un enganche cuyo responsable no tiene el permiso del destino se reporta, no bloquea", async () => {
    // El mapa de destinos es nuevo y buena parte de lo que encuentra es
    // segregación de deberes, no grants faltantes. Promoverlo a bloqueante
    // antes de que alguien revise la lista sería repetir el episodio de la N°84.
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

    const issues = await assertPdtpFulfillmentCoverage(PROGRAM_ID)
    expect(issues).toEqual([expect.objectContaining({ n: 24, status: "destination_review" })])
    expect(issues[0]!.reason).toContain("inspecciones")
  })

  it("una actividad de enganche segregada a propósito no se reporta", async () => {
    // La N°83 la redacta el prevencionista de faena y la firma otra persona:
    // `approveEmergencyPlan` rechaza que coincidan. Exigirle el permiso de
    // aprobar contradiría esa regla.
    await seedProgram("draft")
    await seedActivity({ mechanism: "enganche", n: 83 })
    expect(await assertPdtpFulfillmentCoverage(PROGRAM_ID)).toEqual([])
  })

  it("cobertura sin padrón declarado es decision_required, no bloqueante", async () => {
    await seedProgram("draft")
    await seedActivity({ indicatorMode: "coverage", subjectSource: null })
    const issues = await assertPdtpFulfillmentCoverage(PROGRAM_ID)
    expect(issues).toEqual([expect.objectContaining({ n: ACT_N, status: "decision_required" })])
  })

  it("una actividad retirada no se evalúa", async () => {
    await seedProgram("draft")
    await seedActivity({ status: "retired", mechanism: "sin_definir", retiredReason: "Motivo de retiro suficientemente largo.", retiredEffectiveFrom: "2026-01-01", retiredAt: new Date().toISOString() })
    expect(await assertPdtpFulfillmentCoverage(PROGRAM_ID)).toEqual([])
  })
})

describe("compuerta 81/81 — permiso en el módulo destino (2026-09-03)", () => {
  it("una constancia cuyo responsable no puede entrar a Constancias es permission_gap", async () => {
    await seedProgram("draft")
    await seedActivity({ mechanism: "constancia", evidenceRequirement: "Registro verificable" })
    // Se le quita al rol el permiso del módulo donde la constancia se marca.
    await inMemoryDb.delete(schema.rolePermissions).where(eq(schema.rolePermissions.permissionId, "perm-constancias-execute"))

    const issues = await assertPdtpFulfillmentCoverage(PROGRAM_ID)
    expect(issues).toEqual([expect.objectContaining({
      n: ACT_N,
      status: "permission_gap",
      reason: expect.stringContaining("prevention:constancias:execute"),
    })])
  })

  it("con el permiso cargado, la misma actividad pasa la compuerta", async () => {
    await seedProgram("draft")
    await seedActivity({ mechanism: "constancia", evidenceRequirement: "Registro verificable" })
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
    expect(issues.filter((issue) => issue.n === 35)).toEqual([])
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

  it("un programa sin huella firmada (contentDigest null) nunca reporta deriva", async () => {
    await seedProgram("draft")
    await seedActivity()
    const backlog = await countPdtpFulfillmentBacklog(PROGRAM_ID)
    expect(backlog.digestDrift).toBe(false)
  })

  it("compara la huella vigente contra la firmada cuando existe", async () => {
    await seedProgram("draft")
    await seedActivity()

    await inMemoryDb.update(schema.pdtpPrograms)
      .set({ contentDigest: "0".repeat(64) })
      .where(eq(schema.pdtpPrograms.id, PROGRAM_ID))
    expect((await countPdtpFulfillmentBacklog(PROGRAM_ID)).digestDrift).toBe(true)

    const { digest } = await computePdtpProgramContentDigest(PROGRAM_ID)
    await inMemoryDb.update(schema.pdtpPrograms)
      .set({ contentDigest: digest })
      .where(eq(schema.pdtpPrograms.id, PROGRAM_ID))
    expect((await countPdtpFulfillmentBacklog(PROGRAM_ID)).digestDrift).toBe(false)
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
})
