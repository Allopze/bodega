import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { and, eq, inArray } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { IncidentAccess } from "@/lib/services/prevention-incidents"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite compatibility
testGlobal.__db = inMemoryDb

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

const USER_ID = "u-re20-1"
const OTHER_USER_ID = "u-re20-2"
const WS_ID = "ws-re20-1"
const PROGRAM_ID = "pdtp-re20-prog"

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.preventionCapaActions)
  await inMemoryDb.delete(schema.preventionIncidentFollowups)
  await inMemoryDb.delete(schema.preventionIncidentDiffusion)
  await inMemoryDb.delete(schema.preventionIncidentStatements)
  await inMemoryDb.delete(schema.preventionIncidentInvestigations)
  await inMemoryDb.delete(schema.preventionIncidentNotifications)
  await inMemoryDb.delete(schema.preventionIncidentPeople)
  await inMemoryDb.delete(schema.preventionIncidents)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values([
    { id: USER_ID, name: "Investigador RE-20", email: "re20@example.test", hashedPassword: "x" },
    { id: OTHER_USER_ID, name: "Jefatura RE-20", email: "re20-jefatura@example.test", hashedPassword: "x" },
  ])

  await inMemoryDb.insert(schema.worksites).values({
    id: WS_ID,
    name: "Faena RE-20",
    code: "FRE20",
    isActive: true,
  })

  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID,
    year: 2026,
    version: 1,
    title: "PDTP 2026 RE-20 Test",
    status: "active",
    elaboratedByName: "Investigador",
    elaboratedByTitle: "Experto SST",
    creationMode: "blank",
    complianceTarget: 0.9,
    pesoEjecucion: 0.5,
    pesoVerificacion: 0.3,
    pesoCierre: 0.2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  // Actividades PDTP RE-20 (66-78)
  const actNumbers = [66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78]
  for (const n of actNumbers) {
    await inMemoryDb.insert(schema.pdtpActivities).values({
      id: `act-${n}`,
      programId: PROGRAM_ID,
      n,
      activity: `Actividad RE-20 N° ${n}`,
      program: "Prevención",
      responsibleSlugs: ["prevencionista"],
      responsibleDisplay: "Prevencionista",
      scheduleMode: "triggered",
      scheduleClassificationStatus: "confirmed",
      sourceSheetRow: n,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  }
})

describe("Módulo de Investigación RE-20 y Auto-acreditación PDTP (66-78)", () => {
  const access: IncidentAccess = {
    ctx: { userId: USER_ID },
    scope: { mode: "all", ids: [] },
    permissions: ["prevention:incidents:view", "prevention:incidents:report", "prevention:incidents:investigate"],
  }

  it("reporta incidente y auto-acredita aviso inicial (66, 67)", async () => {
    const { reportPreventionIncident } = await import("@/lib/services/prevention-incidents")

    const res = await reportPreventionIncident({
      access,
      input: {
        worksiteId: WS_ID,
        companyName: "Empresa Test",
        eventType: "work_accident",
        occurredAt: "2026-05-10T08:00:00.000Z",
        knownAt: "2026-05-10T08:10:00.000Z",
        location: "Planta Principal",
        initialNarrative: "Caída de altura desde plataforma",
        actualSeverity: "medical_treatment",
        potentialSeverity: "high",
        people: [],
        clientSubmissionId: "sub-re20-1",
      },
    })

    expect(res.incident.id).toBeDefined()

    // Verificar ejecuciones PDTP de aviso (66, 67)
    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.sourceType, "incident"))

    const actNs = executions.map((e) => e.activityId)
    expect(actNs).toContain("act-66")
    expect(actNs).toContain("act-67")
  })

  it("registra informe preliminar (3h) y auto-acredita 68, 70", async () => {
    const { reportPreventionIncident, createPreliminaryReport } = await import("@/lib/services/prevention-incidents")

    const res = await reportPreventionIncident({
      access,
      input: {
        worksiteId: WS_ID,
        companyName: "Empresa Test",
        eventType: "work_accident",
        occurredAt: "2026-05-10T08:00:00.000Z",
        knownAt: "2026-05-10T08:10:00.000Z",
        location: "Planta Principal",
        initialNarrative: "Caída de altura",
        people: [],
        clientSubmissionId: "sub-re20-2",
      },
    })

    await createPreliminaryReport({
      incidentId: res.incident.id,
      preliminaryReportText: "Informe preliminar enviado dentro de las 3 horas del evento.",
      access: access as unknown as Parameters<typeof createPreliminaryReport>[0]["access"],
    })

    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.sourceId, `${res.incident.id}:preliminar`))

    const actIds = executions.map((e) => e.activityId)
    expect(actIds).toContain("act-68")
    expect(actIds).toContain("act-70")
  })

  it("registra declaración de involucrado (SLA 24h) y auto-acredita 69", async () => {
    const { reportPreventionIncident, recordIncidentStatement } = await import("@/lib/services/prevention-incidents")

    const res = await reportPreventionIncident({
      access,
      input: {
        worksiteId: WS_ID,
        companyName: "Empresa Test",
        eventType: "work_accident",
        occurredAt: "2026-05-10T08:00:00.000Z",
        knownAt: "2026-05-10T08:10:00.000Z",
        location: "Planta Principal",
        initialNarrative: "Golpe en mano",
        people: [],
        clientSubmissionId: "sub-re20-3",
      },
    })

    await recordIncidentStatement({
      incidentId: res.incident.id,
      kind: "involved",
      deponentName: "Juan Pérez",
      statementText: "El equipo no tenía la protección colocada al iniciar la maniobra.",
      access: access as unknown as Parameters<typeof recordIncidentStatement>[0]["access"],
    })

    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.sourceId, `${res.incident.id}:declaracion`))

    expect(executions).toHaveLength(1)
    expect(executions[0]!.activityId).toBe("act-69")
  })

  it("difunde ONE PAGE RE-20-06 (SLA 24h) y auto-acredita 78", async () => {
    const { reportPreventionIncident, publishOnePageDiffusion } = await import("@/lib/services/prevention-incidents")

    const res = await reportPreventionIncident({
      access,
      input: {
        worksiteId: WS_ID,
        companyName: "Empresa Test",
        eventType: "work_accident",
        occurredAt: "2026-05-10T08:00:00.000Z",
        knownAt: "2026-05-10T08:10:00.000Z",
        location: "Planta Principal",
        initialNarrative: "Incidente en bodega",
        people: [],
        clientSubmissionId: "sub-re20-4",
      },
    })

    await publishOnePageDiffusion({
      incidentId: res.incident.id,
      onePageSummary: "Resumen de lección aprendida del incidente en bodega.",
      rootCauseText: "Falta de bloqueo LOTO durante mantenimiento.",
      actionPlanSummary: "Instalar dispositivo LOTO adicional y capacitar.",
      access: access as unknown as Parameters<typeof publishOnePageDiffusion>[0]["access"],
    })

    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.sourceId, `${res.incident.id}:one-page`))

    expect(executions).toHaveLength(1)
    expect(executions[0]!.activityId).toBe("act-78")
  })
})

describe("Expediente cerrado e independencia del reinicio (F-04, F-09)", () => {
  const access: IncidentAccess = {
    ctx: { userId: USER_ID },
    scope: { mode: "all", ids: [] },
    permissions: [
      "prevention:incidents:view", "prevention:incidents:report", "prevention:incidents:investigate",
      "prevention:incidents:notify", "prevention:capa:manage",
    ],
  }
  const restartAccess = (userId: string, extra: string[] = []): IncidentAccess => ({
    ctx: { userId },
    scope: { mode: "all", ids: [] },
    permissions: ["prevention:incidents:authorize_restart", ...extra],
  })

  async function reportSeriousIncident(clientSubmissionId: string) {
    const { reportPreventionIncident } = await import("@/lib/services/prevention-incidents")
    const { incident } = await reportPreventionIncident({
      access,
      input: {
        worksiteId: WS_ID,
        companyName: "Empresa Test",
        eventType: "work_accident",
        occurredAt: "2026-05-10T08:00:00.000Z",
        knownAt: "2026-05-10T08:10:00.000Z",
        location: "Planta Principal",
        initialNarrative: "Atrapamiento con lesión grave en la línea de clasificación.",
        actualSeverity: "serious",
        potentialSeverity: "critical",
        immediateMeasures: "Operación detenida, área aislada y atención de emergencia activada.",
        operationsSuspended: true,
        isFatalOrSerious: true,
        people: [],
        clientSubmissionId,
      },
    })
    return incident
  }

  /** Deja el incidente con investigación completa, CAPA verificada y autoridades notificadas. */
  async function makeRestartReady(incidentId: string, participantUserId: string) {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.preventionIncidentInvestigations).values({
      id: `inci-${incidentId}`,
      incidentId,
      status: "completed",
      methodology: "Árbol de causas",
      team: [{ userId: participantUserId, role: "Investigador" }],
      startedByUserId: participantUserId,
      startedAt: now,
      completedByUserId: participantUserId,
      completedAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.preventionCapaActions).values({
      id: `capa-${incidentId}`,
      code: `CAPA-${incidentId}`,
      sourceType: "incident",
      sourceId: incidentId,
      worksiteId: WS_ID,
      finding: "Barrera de ingeniería insuficiente",
      actionDescription: "Instalar y verificar barrera certificada",
      responsibleUserId: participantUserId,
      priority: "critical",
      targetDate: "2026-06-01",
      status: "verified",
      createdByUserId: participantUserId,
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.update(schema.preventionIncidentNotifications)
      .set({ status: "sent", sentAt: now, evidenceReference: "folio-autoridad", updatedAt: now })
      .where(and(
        eq(schema.preventionIncidentNotifications.incidentId, incidentId),
        inArray(schema.preventionIncidentNotifications.notificationType, ["fatal_dt", "fatal_seremi"]),
      ))
  }

  it("rechaza toda mutación del expediente una vez cerrado (F-04)", async () => {
    const incidents = await import("@/lib/services/prevention-incidents")
    const incident = await reportSeriousIncident("sub-f04-1")
    await inMemoryDb.update(schema.preventionIncidents)
      .set({ status: "closed", closedAt: new Date().toISOString(), closedByUserId: USER_ID })
      .where(eq(schema.preventionIncidents.id, incident.id))

    await expect(incidents.recordPreventionIncidentNotification({
      access,
      input: {
        incidentId: incident.id, expectedVersion: incident.version, notificationType: "diat",
        sentAt: "2026-05-11T08:00:00.000Z", evidenceReference: "folio-diat-tardio",
      },
    })).rejects.toThrow(/cerrado/i)

    await expect(incidents.addPreventionIncidentEvidence({
      access,
      input: {
        incidentId: incident.id, expectedVersion: incident.version,
        kind: "note", reference: "Nota agregada después del cierre",
      },
    })).rejects.toThrow(/cerrado/i)

    await expect(incidents.createPreventionIncidentCapa({
      access,
      input: {
        incidentId: incident.id, expectedVersion: incident.version,
        finding: "Hallazgo posterior al cierre", actionDescription: "Acción posterior al cierre",
        priority: "high", targetDate: "2026-07-01",
      },
    })).rejects.toThrow(/cerrado/i)

    const [evidence] = await inMemoryDb.select().from(schema.preventionIncidentEvidence)
      .where(eq(schema.preventionIncidentEvidence.incidentId, incident.id))
    expect(evidence).toBeUndefined()
  })

  it("rechaza el reinicio autorizado por quien participó, salvo excepción fundamentada (F-09)", async () => {
    const incidents = await import("@/lib/services/prevention-incidents")
    const incident = await reportSeriousIncident("sub-f09-1")
    await makeRestartReady(incident.id, USER_ID)

    await expect(incidents.authorizePreventionIncidentRestart({
      access: restartAccess(USER_ID),
      input: {
        incidentId: incident.id,
        expectedVersion: incident.version,
        reason: "Autorizo el reinicio de la operación.",
        authorityName: "SEREMI de Salud",
        authorizationReference: "Res. Ex. 1234/2026",
        authorizationDate: "2026-08-10",
        evidenceReference: "storage/resoluciones/levantamiento-1234.pdf",
      },
    })).rejects.toThrow(/no participó en la investigación/i)

    const authorized = await incidents.authorizePreventionIncidentRestart({
      access: restartAccess(USER_ID, ["prevention:incidents:override_segregation"]),
      input: {
        incidentId: incident.id,
        expectedVersion: incident.version,
        reason: "Autorizo el reinicio de la operación.",
        authorityName: "SEREMI de Salud",
        authorizationReference: "Res. Ex. 1234/2026",
        authorizationDate: "2026-08-10",
        evidenceReference: "storage/resoluciones/levantamiento-1234.pdf",
        segregationExceptionReason: "Faena aislada sin otra persona habilitada; excepción visada por gerencia.",
      },
    })
    expect(authorized.operationsSuspended).toBe(false)
    const [restartHistory] = await inMemoryDb.select().from(schema.preventionIncidentHistory)
      .where(and(
        eq(schema.preventionIncidentHistory.incidentId, incident.id),
        eq(schema.preventionIncidentHistory.changeType, "restart"),
      ))
    expect(restartHistory!.changeSet).toMatchObject({ segregationOverride: { actorUserId: USER_ID } })
  })

  it("autoriza el reinicio a un tercero sin relación con la investigación ni la CAPA (F-09)", async () => {
    const incidents = await import("@/lib/services/prevention-incidents")
    const incident = await reportSeriousIncident("sub-f09-2")
    await makeRestartReady(incident.id, USER_ID)

    const authorized = await incidents.authorizePreventionIncidentRestart({
      access: restartAccess(OTHER_USER_ID),
      input: {
        incidentId: incident.id,
        expectedVersion: incident.version,
        reason: "Controles verificados y autoridad notificada.",
        authorityName: "SEREMI de Salud",
        authorizationReference: "Res. Ex. 1234/2026",
        authorizationDate: "2026-08-10",
        evidenceReference: "storage/resoluciones/levantamiento-1234.pdf",
      },
    })
    expect(authorized.operationsSuspended).toBe(false)
    const [lane] = await inMemoryDb.select().from(schema.preventionIncidentNotifications)
      .where(and(
        eq(schema.preventionIncidentNotifications.incidentId, incident.id),
        eq(schema.preventionIncidentNotifications.notificationType, "restart_authorization"),
      ))
    expect(lane).toMatchObject({
      status: "authorized",
      restartAuthorizedByUserId: OTHER_USER_ID,
      // NORM-06: la faena no reanuda sin la resolución del organismo fiscalizador.
      administratorName: "SEREMI de Salud",
      evidenceReference: "storage/resoluciones/levantamiento-1234.pdf",
    })
  })
})
