import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
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
const WS_ID = "ws-re20-1"
const PROGRAM_ID = "pdtp-re20-prog"

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpExecutions)
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

  await inMemoryDb.insert(schema.users).values({
    id: USER_ID,
    name: "Investigador RE-20",
    email: "re20@example.test",
    hashedPassword: "x",
  })

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
