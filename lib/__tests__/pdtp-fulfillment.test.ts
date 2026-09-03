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
})

describe("resolvePdtpFulfillmentTarget", () => {
  it("una constancia va a /prevencion/constancias", () => {
    const target = resolvePdtpFulfillmentTarget({ mechanism: "constancia" }, WS_ID)
    expect(target.module).toBe("constancias")
    expect(target.href).toBe(`/prevencion/constancias?faena=${WS_ID}`)
    expect(target.ctaLabel).toBe("Dejar constancia")
  })

  it("un enganche va a la planilla con 'ver cómo se cumple'", () => {
    const target = resolvePdtpFulfillmentTarget({ mechanism: "enganche" }, WS_ID)
    expect(target.href).toBe(`/prevencion/pdtp/actividades?faena=${WS_ID}&vista=semana`)
    expect(target.ctaLabel).toBe("Ver cómo se cumple")
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
