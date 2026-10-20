import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { and, eq, inArray } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { IncidentAccess } from "@/lib/services/prevention-incidents"
import { chileDateParts } from "@/lib/utils"

/* El motor sólo acredita cuando el año del programa coincide con el del evento
 * (ver `accreditation.ts`: "El evento ocurrió fuera del año del programa
 * activo"). Con el año fijo en 2026 estas pruebas dejaban de ejercitar el
 * camino feliz al cambiar de año civil. Se siembran con el año en curso. */
const PROGRAM_YEAR = chileDateParts().year

/* El incidente ocurre "hace un rato": así cae siempre dentro del año del
 * programa y los SLA (aviso 3 h, declaración 24 h) se miden sobre una ventana
 * fresca, no sobre una fecha de mayo de 2026 que envejece. */
const OCCURRED_AT = new Date(Date.now() - 60 * 60_000).toISOString()
const KNOWN_AT = new Date(Date.now() - 50 * 60_000).toISOString()


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
  // PREV-I04: la historia de las ejecuciones PDTP vive en `audit_log`, que referencia a `users`.
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.pdtpFulfillmentEvents)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.preventionCapaActions)
  await inMemoryDb.delete(schema.preventionIncidentFollowups)
  await inMemoryDb.delete(schema.preventionIncidentDiffusion)
  await inMemoryDb.delete(schema.preventionIncidentStatements)
  await inMemoryDb.delete(schema.preventionIncidentInvestigations)
  await inMemoryDb.delete(schema.preventionIncidentNotifications)
  await inMemoryDb.delete(schema.preventionIncidentPeople)
  await inMemoryDb.delete(schema.preventionIncidentRe20QualityReviews)
  await inMemoryDb.delete(schema.preventionIncidentRe20Mutations)
  await inMemoryDb.delete(schema.preventionIncidentRe20Workspaces)
  await inMemoryDb.delete(schema.preventionIncidentRe20Policy)
  await inMemoryDb.delete(schema.preventionIncidents)
  // PREV-M04 (0333): ejecuciones, desvíos y cierres son RESTRICT hacia la
  // actividad/programa; la cascada ya no los limpia.
  await inMemoryDb.delete(schema.pdtpPeriodClosures)
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
    year: PROGRAM_YEAR,
    version: 1,
    title: `PDTP ${PROGRAM_YEAR} RE-20 Test`,
    status: "active",
    appliesToAllWorksites: true,
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

  // Actividades PDTP RE-20 (66-78). Doce de las trece (todas salvo la 76)
  // pasan por obligación desde la Fase 3 (2026-09-02): `createPdtpObligation`
  // exige `dueDays`/`dueHours` y `evidenceRequirement`, así que el fixture
  // los declara igual que lo haría `apply-pdtp-2026-demand-slas.ts`.
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
      scheduleMode: "on_demand",
      scheduleClassificationStatus: "confirmed",
      dueHours: 24,
      evidenceRequirement: "Evidencia del RE-20",
      indicatorMode: "closed_on_time",
      mechanism: "enganche",
      sourceSheetRow: n,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  }
})

/** Revisión de calidad sembrada directamente: para probar lo que ocurre DESPUÉS de una decisión sin recorrer todo el flujo. */
async function seedQualityReview(incidentId: string, decision: "approved" | "approved_with_observations" | "changes_required", workspaceVersion = 1) {
  await inMemoryDb.insert(schema.preventionIncidentRe20QualityReviews).values({
    id: `re20review-seed-${Math.random().toString(36).slice(2)}`,
    incidentId,
    workspaceVersion,
    criteria: [],
    decision,
    observation: decision === "approved" ? null : "Observación de la revisión",
    reviewerRole: "jefa_chome",
    reviewerUserId: OTHER_USER_ID,
    reviewedAt: new Date().toISOString(),
  })
}

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
        occurredAt: OCCURRED_AT,
        knownAt: KNOWN_AT,
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
        occurredAt: OCCURRED_AT,
        knownAt: KNOWN_AT,
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

    // Desde la Fase 3, el reporte preliminar REPORTA la obligación creada al
    // abrirse el caso — el `sourceId` de la ejecución es el propio incidente
    // (compartido entre las doce actividades), así que se filtra por actividad.
    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(inArray(schema.pdtpExecutions.activityId, ["act-68", "act-70"]))

    expect(executions).toHaveLength(2)
    expect(executions.every((e) => e.status === "submitted" && e.obligationId)).toBe(true)
  })

  it("registra declaración de involucrado (SLA 24h) y auto-acredita 69", async () => {
    const { reportPreventionIncident, recordIncidentStatement } = await import("@/lib/services/prevention-incidents")

    const res = await reportPreventionIncident({
      access,
      input: {
        worksiteId: WS_ID,
        companyName: "Empresa Test",
        eventType: "work_accident",
        occurredAt: OCCURRED_AT,
        knownAt: KNOWN_AT,
        location: "Planta Principal",
        initialNarrative: "Golpe en mano",
        people: [],
        clientSubmissionId: "sub-re20-3",
      },
    })

    const previousKey = process.env.PREVENTION_DATA_ENCRYPTION_KEY
    const previousVersion = process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION
    process.env.PREVENTION_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 52).toString("base64")
    process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION = "re20-statement-test-v1"
    try {
      await recordIncidentStatement({
        incidentId: res.incident.id,
        kind: "involved",
        deponentName: "Juan Pérez",
        statementText: "El equipo no tenía la protección colocada al iniciar la maniobra.",
        purpose: "Investigación del accidente",
        access: {
          ...access,
          permissions: [...access.permissions, "prevention:incidents:view_sensitive"],
        } as unknown as Parameters<typeof recordIncidentStatement>[0]["access"],
      })
    } finally {
      if (previousKey === undefined) delete process.env.PREVENTION_DATA_ENCRYPTION_KEY
      else process.env.PREVENTION_DATA_ENCRYPTION_KEY = previousKey
      if (previousVersion === undefined) delete process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION
      else process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION = previousVersion
    }

    const [statement] = await inMemoryDb.select().from(schema.preventionIncidentStatements)
      .where(eq(schema.preventionIncidentStatements.incidentId, res.incident.id))
    expect(statement?.encryptedPayload).toBeTruthy()
    expect(statement?.statementText).toBeNull()
    expect(JSON.stringify(statement)).not.toContain("Juan Pérez")
    expect(JSON.stringify(statement)).not.toContain("El equipo no tenía")

    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, "act-69"))

    expect(executions).toHaveLength(1)
    expect(executions[0]!.status).toBe("submitted")
    expect(executions[0]!.obligationId).toBeTruthy()
  })

  it("difunde ONE PAGE RE-20-06 (SLA 24h) y auto-acredita 78", async () => {
    const { reportPreventionIncident, publishOnePageDiffusion } = await import("@/lib/services/prevention-incidents")

    const res = await reportPreventionIncident({
      access,
      input: {
        worksiteId: WS_ID,
        companyName: "Empresa Test",
        eventType: "work_accident",
        occurredAt: OCCURRED_AT,
        knownAt: KNOWN_AT,
        location: "Planta Principal",
        initialNarrative: "Incidente en bodega",
        people: [],
        clientSubmissionId: "sub-re20-4",
      },
    })

    // RE-20-13: la difusión sólo sale tras la revisión de calidad aprobada.
    await seedQualityReview(res.incident.id, "approved")
    await publishOnePageDiffusion({
      incidentId: res.incident.id,
      onePageSummary: "Resumen de lección aprendida del incidente en bodega.",
      rootCauseText: "Falta de bloqueo LOTO durante mantenimiento.",
      actionPlanSummary: "Instalar dispositivo LOTO adicional y capacitar.",
      access: access as unknown as Parameters<typeof publishOnePageDiffusion>[0]["access"],
    })

    const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.activityId, "act-78"))

    expect(executions).toHaveLength(1)
    expect(executions[0]!.status).toBe("submitted")
    expect(executions[0]!.obligationId).toBeTruthy()
  })

  /* Confirmar una difusión dejó de exigir `incidents:close`. Eran dos actos
   * distintos con un solo permiso, y el resultado es que la n=71 y la n=75 —que
   * la planilla asigna al jefe de terreno— sólo las podía cerrar jefatura. La
   * regla de las dos personas ahora se verifica por actor y no por el permiso,
   * que es lo que siempre quiso decir. */
  describe("difusión del incidente: confirmar no es cerrar (n=71, n=75)", () => {
    const OTRO_USER = "u-re20-confirma"

    async function marcarDifusion() {
      const { reportPreventionIncident, markIncidentDiffusion } = await import("@/lib/services/prevention-incidents")
      const res = await reportPreventionIncident({
        access,
        input: {
          worksiteId: WS_ID,
          companyName: "Empresa Test",
          eventType: "work_accident",
          occurredAt: OCCURRED_AT,
          knownAt: KNOWN_AT,
          location: "Planta Principal",
          initialNarrative: "Incidente para difundir en el turno",
          people: [],
          clientSubmissionId: `sub-re20-dif-${Math.random().toString(36).slice(2)}`,
        },
      })
      const diffusion = await markIncidentDiffusion({
        incidentId: res.incident.id,
        kind: "shift",
        summary: "Se difundió el incidente al turno entrante en la charla de inicio.",
        access,
      })
      return { incidentId: res.incident.id, diffusionId: diffusion.id }
    }

    it("quien marcó la difusión no puede confirmarla", async () => {
      const { confirmIncidentDiffusion } = await import("@/lib/services/prevention-incidents")
      const { diffusionId } = await marcarDifusion()

      await expect(confirmIncidentDiffusion({
        diffusionId,
        // Mismo usuario que la marcó, ahora además con el permiso de confirmar.
        access: {
          ctx: { userId: USER_ID },
          scope: { mode: "all", ids: [] },
          permissions: [...access.permissions, "prevention:incidents:diffuse"],
        } as IncidentAccess,
      })).rejects.toThrow(/no puede confirmarla/i)
    })

    it("otra persona con `diffuse` la confirma y acredita la n=71, sin `close`", async () => {
      const { confirmIncidentDiffusion } = await import("@/lib/services/prevention-incidents")
      const { diffusionId } = await marcarDifusion()
      await inMemoryDb.insert(schema.users).values({
        id: OTRO_USER, name: "Jefe de terreno", email: `${OTRO_USER}@example.test`, hashedPassword: "x",
      }).onConflictDoNothing()

      const confirmed = await confirmIncidentDiffusion({
        diffusionId,
        access: {
          ctx: { userId: OTRO_USER },
          scope: { mode: "all", ids: [] },
          // Sin `prevention:incidents:close`: es justo el punto.
          permissions: ["prevention:incidents:view", "prevention:incidents:diffuse"],
        } as IncidentAccess,
      })
      expect(confirmed.status).toBe("confirmed")

      const executions = await inMemoryDb.select().from(schema.pdtpExecutions)
        .where(eq(schema.pdtpExecutions.activityId, "act-71"))
      expect(executions).toHaveLength(1)
    })
  })
})

/*
 * M1.1: las 10 obligaciones filtrables del RE-20 (68-75,77,78) sólo deben
 * abrirse cuando el tipo de evento/severidad efectivamente exige
 * investigación (`incidentRequiresInvestigation`), y la N°72 (DIAT)
 * específicamente sólo cuando el tipo de evento la exige
 * (`requiredIncidentNotificationTypes`). La N°66/67 se mantienen siempre.
 */
describe("Filtrado del RE-20 por tipo de evento (M1.1)", () => {
  const access: IncidentAccess = {
    ctx: { userId: USER_ID },
    scope: { mode: "all", ids: [] },
    permissions: [
      "prevention:incidents:view", "prevention:incidents:report",
      "prevention:incidents:investigate", "prevention:incidents:triage",
    ],
  }

  const FILTERABLE_NUMBERS = [68, 69, 70, 71, 72, 73, 74, 75, 77, 78]

  async function obligationsOf(incidentId: string) {
    return inMemoryDb.select().from(schema.pdtpObligations)
      .where(and(eq(schema.pdtpObligations.sourceType, "incident"), eq(schema.pdtpObligations.sourceId, incidentId)))
  }

  it("un daño material de baja severidad no requiere investigación: no crea ninguna de las 10 filtrables (sólo 66/67)", async () => {
    const { reportPreventionIncident } = await import("@/lib/services/prevention-incidents")

    const res = await reportPreventionIncident({
      access,
      input: {
        worksiteId: WS_ID,
        companyName: "Empresa Test",
        eventType: "material_damage",
        occurredAt: OCCURRED_AT,
        knownAt: KNOWN_AT,
        location: "Bodega principal",
        initialNarrative: "Golpe de un montacargas contra una estantería vacía, sin heridos ni pérdidas relevantes.",
        actualSeverity: "none",
        potentialSeverity: "low",
        isFatalOrSerious: false,
        people: [],
        clientSubmissionId: "sub-re20-filter-material-baja",
      },
    })

    const activityIds = (await obligationsOf(res.incident.id)).map((o) => o.activityId)
    expect(activityIds).toEqual(expect.arrayContaining(["act-66", "act-67"]))
    for (const n of FILTERABLE_NUMBERS) {
      expect(activityIds).not.toContain(`act-${n}`)
    }
  })

  it("un incidente peligroso de baja severidad sí requiere investigación por tipo de evento: crea las 10 filtrables salvo la DIAT (72)", async () => {
    const { reportPreventionIncident } = await import("@/lib/services/prevention-incidents")

    const res = await reportPreventionIncident({
      access,
      input: {
        worksiteId: WS_ID,
        companyName: "Empresa Test",
        eventType: "dangerous_incident",
        occurredAt: OCCURRED_AT,
        knownAt: KNOWN_AT,
        location: "Planta Principal",
        initialNarrative: "Casi-accidente: caída de una herramienta desde altura, sin golpear a nadie.",
        actualSeverity: "none",
        potentialSeverity: "low",
        isFatalOrSerious: false,
        people: [],
        clientSubmissionId: "sub-re20-filter-dangerous",
      },
    })

    const activityIds = (await obligationsOf(res.incident.id)).map((o) => o.activityId)
    for (const n of [66, 67, 68, 69, 70, 71, 73, 74, 75, 77, 78]) {
      expect(activityIds).toContain(`act-${n}`)
    }
    // "dangerous_incident" nunca exige DIAT (sólo work_accident/commute_accident la exigen).
    expect(activityIds).not.toContain("act-72")
  })

  it("un accidente del trabajo sin fatal/grave sí crea las 10 filtrables, incluida la N°72 (DIAT)", async () => {
    const { reportPreventionIncident } = await import("@/lib/services/prevention-incidents")

    const res = await reportPreventionIncident({
      access,
      input: {
        worksiteId: WS_ID,
        companyName: "Empresa Test",
        eventType: "work_accident",
        occurredAt: OCCURRED_AT,
        knownAt: KNOWN_AT,
        location: "Planta Principal",
        initialNarrative: "Corte superficial en la mano al manipular una herramienta manual.",
        actualSeverity: "minor",
        potentialSeverity: "low",
        isFatalOrSerious: false,
        people: [],
        clientSubmissionId: "sub-re20-filter-work-accident",
      },
    })

    const activityIds = (await obligationsOf(res.incident.id)).map((o) => o.activityId)
    for (const n of [66, 67, ...FILTERABLE_NUMBERS]) {
      expect(activityIds).toContain(`act-${n}`)
    }
  })

  // M-23 (auditoría 2026-09-28): antes esperaba al barrido horario.
  it("el triage que sube la severidad abre en el acto las obligaciones que pasan a aplicar", async () => {
    const { reportPreventionIncident, triagePreventionIncident } = await import("@/lib/services/prevention-incidents")
    const res = await reportPreventionIncident({
      access,
      input: {
        worksiteId: WS_ID,
        companyName: "Empresa Test",
        eventType: "material_damage",
        occurredAt: OCCURRED_AT,
        knownAt: KNOWN_AT,
        location: "Bodega principal",
        initialNarrative: "Golpe de un montacargas contra una estantería vacía, en principio sin daño relevante.",
        actualSeverity: "none",
        potentialSeverity: "low",
        isFatalOrSerious: false,
        people: [],
        clientSubmissionId: "sub-re20-triage-agrava",
      },
    })
    expect((await obligationsOf(res.incident.id)).map((o) => o.activityId)).not.toContain("act-73")

    await triagePreventionIncident({
      access,
      input: {
        incidentId: res.incident.id,
        expectedVersion: res.incident.version,
        actualSeverity: "minor",
        potentialSeverity: "medium",
        isFatalOrSerious: false,
        operationsSuspended: false,
        evacuated: false,
        immediateMeasures: "Se aisló el panel eléctrico dañado y se señalizó el área.",
        reason: "En terreno se vio daño a un panel eléctrico: amerita investigación formal del RE-20.",
      },
    })
    expect((await obligationsOf(res.incident.id)).map((o) => o.activityId)).toContain("act-73")
  })

  it("el triage que baja la severidad de un daño material a 'sin investigación' cancela las obligaciones filtrables ya creadas", async () => {
    const { reportPreventionIncident, triagePreventionIncident } = await import("@/lib/services/prevention-incidents")

    const res = await reportPreventionIncident({
      access,
      input: {
        worksiteId: WS_ID,
        companyName: "Empresa Test",
        eventType: "material_damage",
        occurredAt: OCCURRED_AT,
        knownAt: KNOWN_AT,
        location: "Bodega principal",
        initialNarrative: "Golpe de un montacargas contra una estantería, con daño visible a un panel eléctrico.",
        actualSeverity: "minor",
        potentialSeverity: "medium",
        isFatalOrSerious: false,
        people: [],
        clientSubmissionId: "sub-re20-triage-reclasifica",
      },
    })

    const before = await obligationsOf(res.incident.id)
    const beforeActivityIds = before.map((o) => o.activityId)
    // Confirma la premisa: la severidad inicial exigió investigación y abrió las filtrables.
    expect(beforeActivityIds).toEqual(expect.arrayContaining(
      [68, 69, 70, 71, 73, 74, 75, 77, 78].map((n) => `act-${n}`),
    ))
    const filterableBeforeIds = beforeActivityIds.filter((id) => id !== "act-66" && id !== "act-67")
    expect(filterableBeforeIds.length).toBeGreaterThan(0)

    await triagePreventionIncident({
      access,
      input: {
        incidentId: res.incident.id,
        expectedVersion: res.incident.version,
        actualSeverity: "none",
        potentialSeverity: "low",
        isFatalOrSerious: false,
        operationsSuspended: false,
        evacuated: false,
        immediateMeasures: "Se limpió el área y se reforzó la señalización de tránsito interno.",
        reason: "Tras revisar en terreno, el daño fue sólo material y menor: no amerita investigación formal del RE-20.",
      },
    })

    const afterFilterable = await inMemoryDb.select().from(schema.pdtpObligations)
      .where(inArray(schema.pdtpObligations.id, before.filter((o) => filterableBeforeIds.includes(o.activityId)).map((o) => o.id)))
    expect(afterFilterable.length).toBe(filterableBeforeIds.length)
    for (const obligation of afterFilterable) {
      expect(obligation.status).toBe("cancelled")
      expect(obligation.cancellationReason).toBe("Reclasificado en el triage: el tipo de evento ya no exige esta actividad del RE-20.")
    }

    // 66/67 no son tocadas por la reconciliación: siguen reportadas.
    const untouched = await inMemoryDb.select().from(schema.pdtpObligations)
      .where(inArray(schema.pdtpObligations.activityId, ["act-66", "act-67"]))
    expect(untouched.every((o) => o.status === "reported")).toBe(true)
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
        occurredAt: OCCURRED_AT,
        knownAt: KNOWN_AT,
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

/*
 * D4 (T3): los hitos RE-20 llaman al conector después de confirmar su
 * transacción y el conector sólo registra en el log. Si el proceso cae entre
 * el commit y el conector, el incidente queda sin sus obligaciones o sin el
 * reporte del hito, y el indicador de plazo simplemente no lo ve. El barrido
 * horario repara desde la fuente de verdad (las tablas del incidente).
 */
describe("barrido RE-20 (D4): reconcileIncidentRe20Obligations", () => {
  const CREATED_AT = new Date(Date.now() - 2 * 60 * 60_000).toISOString()
  const sweepAccess: IncidentAccess = {
    ctx: { userId: USER_ID },
    scope: { mode: "all", ids: [] },
    permissions: ["prevention:incidents:view", "prevention:incidents:report", "prevention:incidents:investigate"],
  }

  async function insertIncidentDirectly(id: string, overrides: Partial<typeof schema.preventionIncidents.$inferInsert> = {}) {
    await inMemoryDb.insert(schema.preventionIncidents).values({
      id, code: `INC-${id}`, clientSubmissionId: `sub-${id}`, worksiteId: WS_ID, companyName: "Empresa Test",
      eventType: "work_accident", occurredAt: OCCURRED_AT, knownAt: KNOWN_AT, location: "Planta",
      initialNarrative: "Caída en escalera", reportedByUserId: USER_ID, actualSeverity: "medical_treatment",
      potentialSeverity: "high", createdAt: CREATED_AT, updatedAt: CREATED_AT, ...overrides,
    })
  }

  async function obligationsFor(incidentId: string) {
    const rows = await inMemoryDb.select({
      n: schema.pdtpActivities.n,
      status: schema.pdtpObligations.status,
      reportedAt: schema.pdtpObligations.reportedAt,
      id: schema.pdtpObligations.id,
    }).from(schema.pdtpObligations)
      .innerJoin(schema.pdtpActivities, eq(schema.pdtpActivities.id, schema.pdtpObligations.activityId))
      .where(and(eq(schema.pdtpObligations.sourceType, "incident"), eq(schema.pdtpObligations.sourceId, incidentId)))
    return new Map(rows.map((row) => [row.n, row]))
  }

  beforeEach(async () => {
    await inMemoryDb.delete(schema.pdtpPeriodClosures)
    await inMemoryDb.delete(schema.pdtpObligations)
    await inMemoryDb.update(schema.pdtpPrograms).set({ activatedAt: `${PROGRAM_YEAR}-01-01T03:00:00.000Z` })
  })

  it("crea las obligaciones de un incidente cuyo conector post-commit no corrió y reporta el aviso con su fecha", async () => {
    const { reconcileIncidentRe20Obligations } = await import("@/lib/services/pdtp-adapters/incident-accreditation-connector")
    await insertIncidentDirectly("inc-lost-1")
    const summary = await reconcileIncidentRe20Obligations()
    expect(summary.errors).toBe(0)

    const obligations = await obligationsFor("inc-lost-1")
    // Un accidente con tratamiento médico exige investigación: 66-78 salvo la 76.
    expect([...obligations.keys()].sort((a, b) => a - b)).toEqual([66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 77, 78])
    expect(obligations.get(66)?.status).toBe("reported")
    expect(obligations.get(67)?.status).toBe("reported")
    expect(new Date(obligations.get(66)!.reportedAt!).toISOString()).toBe(CREATED_AT)
    expect(obligations.get(68)?.status).toMatch(/pending|overdue/)
  })

  it("reporta con la fecha real del hito una obligación que quedó pendiente", async () => {
    const { reconcileIncidentRe20Obligations } = await import("@/lib/services/pdtp-adapters/incident-accreditation-connector")
    await insertIncidentDirectly("inc-lost-2")
    await reconcileIncidentRe20Obligations()
    const preliminaryAt = new Date(Date.now() - 90 * 60_000).toISOString()
    await inMemoryDb.insert(schema.preventionIncidentInvestigations).values({
      id: "inv-lost-2", incidentId: "inc-lost-2", methodology: "arbol_causas", preliminaryReportText: "Informe preliminar",
      preliminaryReportAt: preliminaryAt, startedByUserId: OTHER_USER_ID, startedAt: preliminaryAt, updatedAt: preliminaryAt,
    })

    await reconcileIncidentRe20Obligations()
    const obligations = await obligationsFor("inc-lost-2")
    for (const n of [68, 70]) {
      expect(obligations.get(n)?.status).toBe("reported")
      expect(new Date(obligations.get(n)!.reportedAt!).toISOString()).toBe(preliminaryAt)
    }
  })

  it("no reenvía una ejecución que una persona rechazó", async () => {
    const { reportPreventionIncident, createPreliminaryReport } = await import("@/lib/services/prevention-incidents")
    const { rejectPdtpExecution } = await import("@/lib/services/pdtp/executions")
    const { reconcileIncidentRe20Obligations } = await import("@/lib/services/pdtp-adapters/incident-accreditation-connector")
    const res = await reportPreventionIncident({
      access: sweepAccess,
      input: {
        worksiteId: WS_ID, companyName: "Empresa Test", eventType: "work_accident", occurredAt: OCCURRED_AT, knownAt: KNOWN_AT,
        location: "Planta", initialNarrative: "Caída de altura", people: [], clientSubmissionId: "sub-d4-rejected",
      },
    })
    await createPreliminaryReport({
      incidentId: res.incident.id,
      preliminaryReportText: "Informe preliminar enviado dentro de las 3 horas del evento.",
      access: sweepAccess as unknown as Parameters<typeof createPreliminaryReport>[0]["access"],
    })
    const [execution] = await inMemoryDb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.activityId, "act-68"))
    await rejectPdtpExecution(execution!.id, OTHER_USER_ID, "El informe no trae la firma del supervisor", "all")

    await reconcileIncidentRe20Obligations()
    const [after] = await inMemoryDb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.id, execution!.id))
    expect(after).toMatchObject({ status: "rejected", rejectionReason: "El informe no trae la firma del supervisor" })
    expect((await obligationsFor(res.incident.id)).get(68)?.status).toMatch(/pending|overdue/)
  })

  it("no reporta un hito en un mes cerrado", async () => {
    const { reconcileIncidentRe20Obligations } = await import("@/lib/services/pdtp-adapters/incident-accreditation-connector")
    const month = chileDateParts(new Date(CREATED_AT)).month
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpPeriodClosures).values({
      id: "closure-d4", programId: PROGRAM_ID, worksiteId: WS_ID, year: PROGRAM_YEAR, month, status: "closed",
      snapshotJson: {}, digest: "a".repeat(64), closedByUserId: OTHER_USER_ID, closedAt: now, closeReason: "Cierre del mes",
      createdAt: now, updatedAt: now,
    })
    await insertIncidentDirectly("inc-closed-month")
    const summary = await reconcileIncidentRe20Obligations()
    expect(summary.skippedClosedPeriod).toBeGreaterThan(0)
    const obligations = await obligationsFor("inc-closed-month")
    expect(obligations.get(66)?.status).toMatch(/pending|overdue/)
  })

  it("completa una pérdida parcial: con sólo 66/67 reportadas crea las que faltan", async () => {
    const { reconcileIncidentRe20Obligations } = await import("@/lib/services/pdtp-adapters/incident-accreditation-connector")
    await insertIncidentDirectly("inc-partial")
    await reconcileIncidentRe20Obligations()
    // Simula la caída a mitad del conector: se pierden las filtrables.
    const existing = await obligationsFor("inc-partial")
    const filterableIds = [...existing.values()].filter((row) => row.n !== 66 && row.n !== 67).map((row) => row.id)
    await inMemoryDb.delete(schema.pdtpObligations).where(inArray(schema.pdtpObligations.id, filterableIds))
    expect((await obligationsFor("inc-partial")).size).toBe(2)

    await reconcileIncidentRe20Obligations()
    expect((await obligationsFor("inc-partial")).size).toBe(12)
  })

  it("no crea obligaciones para incidentes anteriores a la activación del programa", async () => {
    const { reconcileIncidentRe20Obligations } = await import("@/lib/services/pdtp-adapters/incident-accreditation-connector")
    await inMemoryDb.update(schema.pdtpPrograms).set({ activatedAt: new Date(Date.now() - 30 * 60_000).toISOString() })
    await insertIncidentDirectly("inc-before-activation")
    await reconcileIncidentRe20Obligations()
    expect((await obligationsFor("inc-before-activation")).size).toBe(0)
  })

  it("guarda la investigación RE-20 con hechos y cifras sensibles cifradas", async () => {
    const service = await import("@/lib/services/prevention-incidents")
    const save = Reflect.get(service, "savePreventionIncidentRe20Workspace")
    expect(save).toBeTypeOf("function")
    if (typeof save !== "function") return

    const previousKey = process.env.PREVENTION_DATA_ENCRYPTION_KEY
    const previousVersion = process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION
    process.env.PREVENTION_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 51).toString("base64")
    process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION = "re20-test-v1"
    try {
      await insertIncidentDirectly("inc-re20-workspace-secure")
      const result = await Reflect.apply(save, undefined, [{
        input: {
          incidentId: "inc-re20-workspace-secure",
          expectedVersion: 0,
          mutationId: "secure-workspace-save-001",
          data: {
            methodology: "causal_tree",
            team: [{ userId: USER_ID, role: "Investigador responsable" }],
            preliminary: { immediateResponse: "Se aisló el sector" },
            tasks: [],
            causalTree: {
              events: [
                { id: "H1", description: "La carga se desplazó", verified: true, source: "Foto 1" },
                { id: "H2", description: "La carga cayó", verified: true, source: "Foto 2" },
              ],
              relations: [{ from: "H1", to: "H2", type: "chain" }],
            },
            definitive: { chronology: [], preventiveInstruments: [] },
            measures: [],
            diffusion: { recipients: [] },
            accidentFollowups: [],
            damageFollowups: [],
            nearMiss: { seriousOrFatalPotential: false, do36TreeRequired: false },
            classification: {},
          },
          sensitive: {
            purpose: "Investigación RE-20",
            declarations: [{ id: "dec-1", kind: "witness", name: "Nombre reservado", statement: "Texto confidencial de la persona testigo.", reserveIdentity: true, attachmentReferences: [] }],
            injuredInterview: { task: "Antecedente de entrevista reservado" },
            diat: { form: { nationalIdentifier: "12.345.678-9" }, status: "prepared" },
          },
        },
        access: {
          ctx: { userId: USER_ID },
          scope: { mode: "all", ids: [] },
          permissions: ["prevention:incidents:investigate", "prevention:incidents:view_sensitive"],
        },
      }])

      expect(result).toMatchObject({ workspace: { version: 1 }, incidentId: "inc-re20-workspace-secure", idempotentReplay: false })
      const [stored] = await inMemoryDb.select().from(schema.preventionIncidentRe20Workspaces)
        .where(eq(schema.preventionIncidentRe20Workspaces.incidentId, "inc-re20-workspace-secure"))
      expect(stored?.data).toMatchObject({ preliminary: { immediateResponse: "Se aisló el sector" } })
      expect(stored?.encryptedSensitivePayload).toBeTruthy()
      expect(JSON.stringify(stored)).not.toContain("Texto confidencial")
      expect(JSON.stringify(stored)).not.toContain("Nombre reservado")
      expect(JSON.stringify(stored)).not.toContain("12.345.678-9")

      const replay = await Reflect.apply(save, undefined, [{
        input: {
          incidentId: "inc-re20-workspace-secure",
          expectedVersion: 0,
          mutationId: "secure-workspace-save-001",
          data: { ...stored?.data },
          sensitive: {
            purpose: "Investigación RE-20",
            declarations: [{ id: "dec-1", kind: "witness", name: "Nombre reservado", statement: "Texto confidencial de la persona testigo.", reserveIdentity: true, attachmentReferences: [] }],
            injuredInterview: { task: "Antecedente de entrevista reservado" },
            diat: { form: { nationalIdentifier: "12.345.678-9" }, status: "prepared" },
          },
        },
        access: {
          ctx: { userId: USER_ID }, scope: { mode: "all", ids: [] },
          permissions: ["prevention:incidents:investigate", "prevention:incidents:view_sensitive"],
        },
      }])
      expect(replay).toMatchObject({ workspace: { version: 1 }, idempotentReplay: true })
    } finally {
      if (previousKey === undefined) delete process.env.PREVENTION_DATA_ENCRYPTION_KEY
      else process.env.PREVENTION_DATA_ENCRYPTION_KEY = previousKey
      if (previousVersion === undefined) delete process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION
      else process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION = previousVersion
    }
  })

  it("permite conservar un borrador RE-20 incompleto en campos todavía en captura", async () => {
    const { savePreventionIncidentRe20Workspace } = await import("@/lib/services/prevention-incidents")
    await insertIncidentDirectly("inc-re20-partial-draft")
    const previousKey = process.env.PREVENTION_DATA_ENCRYPTION_KEY
    const previousVersion = process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION
    process.env.PREVENTION_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 73).toString("base64")
    process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION = "re20-partial-draft-test-v1"
    try {
    const result = await savePreventionIncidentRe20Workspace({
      input: {
        incidentId: "inc-re20-partial-draft",
        expectedVersion: 0,
        mutationId: "partial-draft-save-001",
        data: {
          methodology: "causal_tree",
          team: [{ userId: "", role: "" }],
          definitive: { chronology: [{ description: "" }], preventiveInstruments: [{ name: "", result: "pending" }] },
          causalTree: { events: [{ id: "H1", description: "", verified: false }], relations: [] },
          measures: [{ id: "measure-1", description: "", effectiveness: "pending", evidenceReferences: [] }],
        },
        sensitive: {
          purpose: "Borrador investigación",
          declarations: [{ id: "dec-draft", kind: "witness", name: "", statement: "", reserveIdentity: false, attachmentReferences: [] }],
        },
      },
      access: {
        ctx: { userId: USER_ID }, scope: { mode: "all", ids: [] },
        permissions: ["prevention:incidents:investigate", "prevention:incidents:view_sensitive"],
      },
    })
    expect(result.workspace.version).toBe(1)
    expect(result.workspace.data).toMatchObject({
      team: [{ userId: "", role: "" }],
      causalTree: { events: [{ id: "H1", description: "", verified: false }] },
      measures: [{ id: "measure-1", description: "" }],
    })
    const [stored] = await inMemoryDb.select().from(schema.preventionIncidentRe20Workspaces)
      .where(eq(schema.preventionIncidentRe20Workspaces.incidentId, "inc-re20-partial-draft"))
    expect(stored?.encryptedSensitivePayload).toBeTruthy()
    expect(JSON.stringify(stored)).not.toContain('"kind":"witness"')
    } finally {
      if (previousKey === undefined) delete process.env.PREVENTION_DATA_ENCRYPTION_KEY
      else process.env.PREVENTION_DATA_ENCRYPTION_KEY = previousKey
      if (previousVersion === undefined) delete process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION
      else process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION = previousVersion
    }
  })

  it("segrega la revisión de calidad y no permite la autoaprobación", async () => {
    const { RE20_QUALITY_CRITERIA } = await import("@/lib/prevention/incidents")
    const { savePreventionIncidentRe20Workspace, reviewPreventionIncidentRe20Quality } = await import("@/lib/services/prevention-incidents")
    const writer: IncidentAccess = {
      ctx: { userId: USER_ID }, scope: { mode: "all", ids: [] },
      permissions: ["prevention:incidents:view", "prevention:incidents:investigate"],
    }
    const reviewer: IncidentAccess = { ctx: { userId: OTHER_USER_ID }, scope: { mode: "all", ids: [] }, permissions: ["prevention:incidents:investigate", "prevention:incidents:review_quality"], roles: ["quality_reviewer"] }
    const allMeet = RE20_QUALITY_CRITERIA.map(({ id }) => ({ id, result: "meets" as const }))
    await insertIncidentDirectly("inc-re20-quality-review")
    await savePreventionIncidentRe20Workspace({
      input: { incidentId: "inc-re20-quality-review", expectedVersion: 0, mutationId: "review-workspace-save-001", data: { methodology: "causal_tree" } },
      access: writer,
    })
    // Sin informe definitivo completado no hay investigación que aprobar.
    await expect(reviewPreventionIncidentRe20Quality({
      input: { incidentId: "inc-re20-quality-review", expectedWorkspaceVersion: 1, decision: "approved", criteria: allMeet },
      access: reviewer,
    })).rejects.toThrow("Marca el informe definitivo como completado")
    const completedData = {
      methodology: "causal_tree",
      team: [{ userId: USER_ID, role: "Investigador responsable" }],
      tasks: [{ id: "definitive_report", sheet: "INV.DEF.ACC", label: "Informe definitivo", status: "completed", completedAt: "2026-09-21T12:00:00.000Z" }],
      definitive: { conclusion: "El resguardo retirado permitió el contacto con la transmisión.", chronology: [], preventiveInstruments: [] },
      causalTree: {
        events: [
          { id: "H1", description: "Lesión en la mano derecha", verified: true },
          { id: "H2", description: "La mano entró en la transmisión", verified: true },
          { id: "H3", description: "El resguardo fijo estaba retirado", verified: true },
        ],
        relations: [{ from: "H3", to: "H2", type: "chain" }, { from: "H2", to: "H1", type: "chain" }],
      },
      measures: [{ id: "m1", rootCauseId: "H3", description: "Instalar resguardo fijo con enclavamiento", controlType: "Ingeniería", responsibleUserId: USER_ID, verifierUserId: OTHER_USER_ID, dueAt: "2026-12-01T12:00:00.000Z" }],
    }
    await savePreventionIncidentRe20Workspace({
      input: { incidentId: "inc-re20-quality-review", expectedVersion: 1, mutationId: "review-workspace-save-002", data: completedData },
      access: writer,
    })
    const input = {
      incidentId: "inc-re20-quality-review",
      expectedWorkspaceVersion: 2,
      decision: "approved",
      criteria: allMeet,
    }
    await expect(reviewPreventionIncidentRe20Quality({
      input,
      access: { ctx: { userId: USER_ID }, scope: { mode: "all", ids: [] }, permissions: ["prevention:incidents:investigate", "prevention:incidents:review_quality"] },
    })).rejects.toThrow("Quien investigó o modificó el expediente no puede aprobar su propia revisión de calidad.")
    // Pedir correcciones no da por terminada la investigación: reabre el informe y sube la versión.
    await reviewPreventionIncidentRe20Quality({
      input: { ...input, decision: "changes_required", observation: "Falta respaldar la fuente de H3.", criteria: allMeet.map((criterion, index) => index === 0 ? { ...criterion, result: "partial" as const } : criterion) },
      access: reviewer,
    })
    const investigationOf = async () => (await inMemoryDb.select().from(schema.preventionIncidentInvestigations)
      .where(eq(schema.preventionIncidentInvestigations.incidentId, "inc-re20-quality-review")))[0]
    expect(await investigationOf()).toBeUndefined()
    const [reopened] = await inMemoryDb.select().from(schema.preventionIncidentRe20Workspaces)
      .where(eq(schema.preventionIncidentRe20Workspaces.incidentId, "inc-re20-quality-review"))
    expect(reopened?.version).toBe(3)
    expect((reopened?.data as { tasks: Array<{ id: string; status: string }> }).tasks.find((task) => task.id === "definitive_report")?.status).toBe("in_progress")
    // La versión revisada ya no es la vigente.
    await expect(reviewPreventionIncidentRe20Quality({ input, access: reviewer })).rejects.toThrow("El expediente cambió")

    await savePreventionIncidentRe20Workspace({
      input: { incidentId: "inc-re20-quality-review", expectedVersion: 3, mutationId: "review-workspace-save-003", data: completedData },
      access: writer,
    })
    const approved = await reviewPreventionIncidentRe20Quality({ input: { ...input, expectedWorkspaceVersion: 4 }, access: reviewer })
    expect(approved).toMatchObject({ decision: "approved", workspaceVersion: 4, reviewerUserId: OTHER_USER_ID, reviewerRole: "quality_reviewer" })
    // La aprobación completa la investigación canónica: es la compuerta de CAPA, cierre y reinicio.
    expect(await investigationOf()).toMatchObject({
      status: "completed",
      methodology: "Árbol de causas",
      basicCauses: ["El resguardo fijo estaba retirado"],
      immediateCauses: ["La mano entró en la transmisión"],
      completedByUserId: OTHER_USER_ID,
    })
  })

  it("conserva la versión SLA fijada al expediente cuando cambia la política global", async () => {
    const {
      getPreventionIncidentRe20Workspace,
      savePreventionIncidentRe20Policy,
      savePreventionIncidentRe20Workspace,
    } = await import("@/lib/services/prevention-incidents")
    await insertIncidentDirectly("inc-re20-policy-snapshot")
    const policyAccess: IncidentAccess = {
      ctx: { userId: USER_ID }, scope: { mode: "all", ids: [] },
      permissions: ["prevention:incidents:configure_re20"],
    }
    const initialPolicy = {
      preliminaryHours: 4,
      witnessStatementsHours: 5,
      injuredInterviewHours: 24,
      definitiveHours: 72,
      diffusionHours: 24,
      followupDays: 14,
    }
    const revisedPolicy = { ...initialPolicy, preliminaryHours: 6, followupDays: 7 }
    await savePreventionIncidentRe20Policy({ input: initialPolicy, access: policyAccess })
    await savePreventionIncidentRe20Workspace({
      input: { incidentId: "inc-re20-policy-snapshot", expectedVersion: 0, mutationId: "policy-snapshot-save-001", data: { methodology: "causal_tree" } },
      access: { ...policyAccess, permissions: ["prevention:incidents:investigate"] },
    })
    await savePreventionIncidentRe20Policy({ input: revisedPolicy, access: policyAccess })
    await savePreventionIncidentRe20Workspace({
      input: { incidentId: "inc-re20-policy-snapshot", expectedVersion: 1, mutationId: "policy-snapshot-save-002", data: { methodology: "causal_tree", definitive: { conclusion: "Conclusión revisada" } } },
      access: { ...policyAccess, permissions: ["prevention:incidents:investigate"] },
    })

    const result = await getPreventionIncidentRe20Workspace({
      incidentId: "inc-re20-policy-snapshot",
      access: { ...policyAccess, permissions: ["prevention:incidents:view"] },
    })
    expect(result?.workspace).toMatchObject({
      version: 2,
      policyVersion: 1,
      policySnapshot: { version: 1, preliminaryHours: 4, followupDays: 14 },
    })
    expect(result?.policy).toMatchObject({ version: 1, preliminaryHours: 4, followupDays: 14 })
  })

  it("rechaza una escritura offline con versión antigua y conserva la versión aceptada", async () => {
    const { savePreventionIncidentRe20Workspace } = await import("@/lib/services/prevention-incidents")
    await insertIncidentDirectly("inc-re20-stale-save")
    const writerAccess: IncidentAccess = {
      ctx: { userId: USER_ID }, scope: { mode: "all", ids: [] },
      permissions: ["prevention:incidents:investigate"],
    }
    await savePreventionIncidentRe20Workspace({
      input: { incidentId: "inc-re20-stale-save", expectedVersion: 0, mutationId: "stale-save-001", data: { methodology: "causal_tree", definitive: { conclusion: "Versión aceptada" } } },
      access: writerAccess,
    })
    await expect(savePreventionIncidentRe20Workspace({
      input: { incidentId: "inc-re20-stale-save", expectedVersion: 0, mutationId: "stale-save-002", data: { methodology: "5_whys", definitive: { conclusion: "Versión local obsoleta" } } },
      access: writerAccess,
    })).rejects.toThrow("Otra persona modificó el expediente RE-20. Conserva tu borrador y recarga para resolver el conflicto.")
    const [stored] = await inMemoryDb.select().from(schema.preventionIncidentRe20Workspaces)
      .where(eq(schema.preventionIncidentRe20Workspaces.incidentId, "inc-re20-stale-save"))
    expect(stored).toMatchObject({ version: 1, data: { definitive: { conclusion: "Versión aceptada" } } })
  })

  it("cifra los anexos RE-20 en disco, los lee por identificador idempotente y bloquea el acceso no sensible", async () => {
    const { storePreventionIncidentRe20Attachment: store, getPreventionIncidentRe20Attachment: read } =
      await import("@/lib/services/prevention-incident-re20-attachments")
    const { mkdtemp, readdir, readFile, rm } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const { resolvePreventionSensitiveFilesDir } = await import("@/lib/storage/config")

    const previousKey = process.env.PREVENTION_DATA_ENCRYPTION_KEY
    const previousVersion = process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION
    const previousStorage = process.env.STORAGE_PATH
    const storageDir = await mkdtemp(path.join(tmpdir(), "re20-attachments-"))
    process.env.STORAGE_PATH = storageDir
    process.env.PREVENTION_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 72).toString("base64")
    process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION = "re20-attachment-test-v1"
    try {
      await insertIncidentDirectly("inc-re20-attachment")
      const access: IncidentAccess = {
        ctx: { userId: USER_ID }, scope: { mode: "all", ids: [] },
        permissions: ["prevention:incidents:view", "prevention:incidents:investigate", "prevention:incidents:view_sensitive"],
      }
      const bytes = new TextEncoder().encode("Contenido reservado de la evidencia RE-20")
      const input = {
        incidentId: "inc-re20-attachment",
        clientAttachmentId: "attachment-re20-001",
        expectedWorkspaceVersion: 0,
        purpose: "Investigación del incidente",
        fileName: "evidencia-reservada.txt",
        mimeType: "text/plain",
      }
      const created = await store({ input, bytes, access })
      const replay = await store({ input, bytes, access })
      expect(created.idempotentReplay).toBe(false)
      expect(replay).toMatchObject({ attachmentId: created.attachmentId, clientAttachmentId: input.clientAttachmentId, idempotentReplay: true })

      const [stored] = await inMemoryDb.select().from(schema.preventionIncidentRe20Attachments)
        .where(eq(schema.preventionIncidentRe20Attachments.clientAttachmentId, input.clientAttachmentId))
      expect(stored?.encryptedFile).toBeNull()
      expect(stored?.sensitiveFileId).toBeTruthy()
      expect(JSON.stringify(stored)).not.toContain("evidencia-reservada.txt")
      const [file] = await inMemoryDb.select().from(schema.preventionSensitiveFiles)
        .where(eq(schema.preventionSensitiveFiles.id, stored!.sensitiveFileId!))
      expect(file).toMatchObject({ domain: "incident_re20", entityId: input.incidentId, mimeType: "text/plain" })
      expect(JSON.stringify(file)).not.toContain("evidencia-reservada.txt")
      const onDisk = await readdir(resolvePreventionSensitiveFilesDir())
      expect(onDisk).toHaveLength(1)
      const raw = await readFile(path.join(resolvePreventionSensitiveFilesDir(), onDisk[0]!))
      expect(raw.toString("utf8")).not.toContain("Contenido reservado")

      const result = await read({ incidentId: input.incidentId, attachmentId: input.clientAttachmentId, purpose: input.purpose, access })
      expect(Buffer.from(result.buffer).toString("utf8")).toBe("Contenido reservado de la evidencia RE-20")
      expect(result.metadata).toMatchObject({ fileName: "evidencia-reservada.txt", mimeType: "text/plain" })
      await expect(read({
        incidentId: input.incidentId, attachmentId: input.clientAttachmentId, purpose: input.purpose,
        access: { ...access, permissions: ["prevention:incidents:view"] },
      })).rejects.toThrow("No tienes autorización para abrir el anexo sensible RE-20.")

      // El MIME registrado es el detectado: un .png que en realidad es texto se rechaza y no deja rastro.
      await expect(store({
        input: { ...input, clientAttachmentId: "attachment-re20-fake", fileName: "foto.png", mimeType: "image/png" },
        bytes: new TextEncoder().encode("esto no es un PNG"),
        access,
      })).rejects.toThrow()
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
      await expect(store({
        input: { ...input, clientAttachmentId: "attachment-re20-mismatch", fileName: "nota.txt", mimeType: "text/plain" },
        bytes: pngBytes,
        access,
      })).rejects.toThrow("no coincide")
      const all = await inMemoryDb.select().from(schema.preventionIncidentRe20Attachments)
      expect(all).toHaveLength(1)
      expect(await readdir(resolvePreventionSensitiveFilesDir())).toHaveLength(1)

      // Las filas LEGADO (binario en Postgres) siguen siendo legibles hasta migrarlas a disco.
      const { encryptPreventionBuffer, encryptPreventionPayload } = await import("@/lib/security/prevention-field-encryption")
      const legacyAad = "incident-re20-attachment:inc-re20-attachment:attachment-legacy-1"
      const legacyBytes = Buffer.from("anexo legado")
      const legacyFile = encryptPreventionBuffer(legacyBytes, `${legacyAad}:file`)
      const legacyMeta = encryptPreventionPayload({ fileName: "legado.txt", mimeType: "text/plain", size: legacyBytes.length }, `${legacyAad}:metadata`)
      await inMemoryDb.insert(schema.preventionIncidentRe20Attachments).values({
        id: "re20att-legacy", incidentId: input.incidentId, clientAttachmentId: "attachment-legacy-1",
        encryptedFile: legacyFile.encryptedBuffer.toString("base64"), fileIv: legacyFile.iv, fileAuthTag: legacyFile.authTag, fileKeyVersion: legacyFile.keyVersion,
        encryptedMetadata: legacyMeta.encryptedPayload, metadataIv: legacyMeta.iv, metadataAuthTag: legacyMeta.authTag, metadataKeyVersion: legacyMeta.keyVersion,
        checksumSha256: "0".repeat(64), fileSize: legacyBytes.length, createdByUserId: USER_ID, createdAt: new Date().toISOString(),
      })
      const legacy = await read({ incidentId: input.incidentId, attachmentId: "attachment-legacy-1", purpose: input.purpose, access })
      expect(Buffer.from(legacy.buffer).toString("utf8")).toBe("anexo legado")
    } finally {
      await inMemoryDb.delete(schema.preventionIncidentRe20Attachments)
      await inMemoryDb.delete(schema.preventionSensitiveFiles)
      await rm(storageDir, { recursive: true, force: true })
      if (previousStorage === undefined) delete process.env.STORAGE_PATH
      else process.env.STORAGE_PATH = previousStorage
      if (previousKey === undefined) delete process.env.PREVENTION_DATA_ENCRYPTION_KEY
      else process.env.PREVENTION_DATA_ENCRYPTION_KEY = previousKey
      if (previousVersion === undefined) delete process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION
      else process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION = previousVersion
    }
  })

  it("es idempotente", async () => {
    const { reconcileIncidentRe20Obligations } = await import("@/lib/services/pdtp-adapters/incident-accreditation-connector")
    await insertIncidentDirectly("inc-idem")
    await reconcileIncidentRe20Obligations()
    const obligationsBefore = await inMemoryDb.select().from(schema.pdtpObligations)
    const executionsBefore = await inMemoryDb.select().from(schema.pdtpExecutions)
    const second = await reconcileIncidentRe20Obligations()
    expect(second).toMatchObject({ created: 0, reported: 0, errors: 0 })
    expect(await inMemoryDb.select().from(schema.pdtpObligations)).toHaveLength(obligationsBefore.length)
    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(executionsBefore.length)
  })
})

/* ── Fase 1: lógica fiel al Excel RE-20 v3 ─────────────────────────────── */
describe("RE-20 v3: reglas del servidor, revisión de calidad, CAPA, difusión y seguimiento", () => {
  const writer: IncidentAccess = {
    ctx: { userId: USER_ID }, scope: { mode: "all", ids: [] },
    permissions: ["prevention:incidents:view", "prevention:incidents:investigate", "prevention:capa:manage"],
  }
  const reviewer: IncidentAccess = {
    ctx: { userId: OTHER_USER_ID }, scope: { mode: "all", ids: [] },
    permissions: ["prevention:incidents:investigate", "prevention:incidents:review_quality"], roles: ["jefa_chome"],
  }
  const CREATED = new Date(Date.now() - 2 * 60 * 60_000).toISOString()

  async function incident(id: string, overrides: Partial<typeof schema.preventionIncidents.$inferInsert> = {}) {
    await inMemoryDb.insert(schema.preventionIncidents).values({
      id, code: `INC-${id}`, clientSubmissionId: `sub-${id}`, worksiteId: WS_ID, companyName: "Empresa Test",
      eventType: "work_accident", occurredAt: OCCURRED_AT, knownAt: KNOWN_AT, location: "Planta",
      initialNarrative: "Caída en escalera", reportedByUserId: USER_ID, actualSeverity: "medical_treatment",
      potentialSeverity: "high", createdAt: CREATED, updatedAt: CREATED, ...overrides,
    })
  }

  const tree = {
    events: [
      { id: "H1", description: "Lesión en la mano derecha", verified: true },
      { id: "H2", description: "La mano entró en la transmisión", verified: true },
      { id: "H3", description: "El resguardo fijo estaba retirado", verified: true },
    ],
    relations: [{ from: "H3", to: "H2", type: "chain", justification: "Sin resguardo la transmisión quedó expuesta" }, { from: "H2", to: "H1", type: "chain" }],
  }
  const measure = { id: "m1", rootCauseId: "H3", description: "Instalar resguardo fijo con enclavamiento", controlType: "Ingeniería", priority: "Alta", responsibleUserId: USER_ID, verifierUserId: OTHER_USER_ID, dueAt: "2027-01-15T12:00:00.000Z" }
  const completedTask = { id: "definitive_report", sheet: "INV.DEF.ACC", label: "Informe definitivo", status: "completed", completedAt: "2026-09-21T12:00:00.000Z" }
  const baseData = {
    methodology: "causal_tree",
    team: [{ userId: USER_ID, role: "Investigador responsable" }],
    definitive: { conclusion: "El resguardo retirado permitió el contacto con la transmisión.", chronology: [], preventiveInstruments: [] },
    causalTree: tree,
    measures: [measure],
  }

  let mutation = 0
  async function save(incidentId: string, expectedVersion: number, data: Record<string, unknown>, access = writer) {
    const { savePreventionIncidentRe20Workspace } = await import("@/lib/services/prevention-incidents")
    return savePreventionIncidentRe20Workspace({
      input: { incidentId, expectedVersion, mutationId: `fase1-mutation-${++mutation}-${incidentId}`, data },
      access,
    })
  }
  const allMeet = async () => (await import("@/lib/prevention/incidents")).RE20_QUALITY_CRITERIA.map(({ id }) => ({ id, result: "meets" as const }))
  const storedWorkspace = async (incidentId: string) => (await inMemoryDb.select().from(schema.preventionIncidentRe20Workspaces)
    .where(eq(schema.preventionIncidentRe20Workspaces.incidentId, incidentId)))[0]
  const investigationOf = async (incidentId: string) => (await inMemoryDb.select().from(schema.preventionIncidentInvestigations)
    .where(eq(schema.preventionIncidentInvestigations.incidentId, incidentId)))[0]

  it("rechaza una medida cuyo verificador es su propio responsable (INV.DEF.ACC!B112)", async () => {
    await incident("inc-f1-verifier")
    await expect(save("inc-f1-verifier", 0, { ...baseData, measures: [{ ...measure, verifierUserId: USER_ID }] }))
      .rejects.toThrow(/distinta de su responsable/)
    expect(await storedWorkspace("inc-f1-verifier")).toBeUndefined()
  })

  it("una causa raíz sin medida, o una medida sin responsable o verificador, bloquea el informe definitivo", async () => {
    await incident("inc-f1-rootcause")
    await expect(save("inc-f1-rootcause", 0, { ...baseData, tasks: [completedTask], measures: [] }))
      .rejects.toThrow("La causa raíz H3 no tiene ninguna medida asociada.")
    await expect(save("inc-f1-rootcause", 0, { ...baseData, tasks: [completedTask], measures: [{ ...measure, verifierUserId: null }] }))
      .rejects.toThrow("no tiene verificador")
    await expect(save("inc-f1-rootcause", 0, { ...baseData, tasks: [completedTask], measures: [{ ...measure, responsibleUserId: null }] }))
      .rejects.toThrow("no tiene responsable")
    await expect(save("inc-f1-rootcause", 0, { ...baseData, tasks: [completedTask], definitive: { conclusion: "", chronology: [], preventiveInstruments: [] } }))
      .rejects.toThrow("conclusión")
    // Un borrador sí se guarda sin medidas: la regla es de la tarea completada.
    await save("inc-f1-rootcause", 0, { ...baseData, measures: [] })
    await save("inc-f1-rootcause", 1, { ...baseData, tasks: [completedTask] })
    expect((await storedWorkspace("inc-f1-rootcause"))?.version).toBe(2)
  })

  it("la metodología sólo cambia hacia el árbol de causas; las heredadas se conservan pero no se eligen", async () => {
    await incident("inc-f1-method")
    await expect(save("inc-f1-method", 0, { ...baseData, methodology: "5_whys" })).rejects.toThrow("árbol de causas")
    // Un expediente que ya traía «5 porqués» se puede seguir guardando sin cambiar el método.
    await inMemoryDb.insert(schema.preventionIncidentRe20Workspaces).values({
      id: "re20-legacy-method", incidentId: "inc-f1-method", version: 1, data: { methodology: "5_whys" }, policyVersion: 1, policySnapshot: {},
      createdByUserId: USER_ID, updatedByUserId: USER_ID, createdAt: CREATED, updatedAt: CREATED,
    })
    await save("inc-f1-method", 1, { ...baseData, methodology: "5_whys" })
    expect((await storedWorkspace("inc-f1-method"))?.data).toMatchObject({ methodology: "5_whys" })
  })

  it("las tres decisiones de la revisión de calidad: sólo las aprobaciones completan la investigación", async () => {
    const { reviewPreventionIncidentRe20Quality } = await import("@/lib/services/prevention-incidents")
    const criteria = await allMeet()
    const withPartial = criteria.map((criterion, index) => index === 0 ? { ...criterion, result: "partial" as const } : criterion)
    const withFailure = criteria.map((criterion, index) => index === 0 ? { ...criterion, result: "does_not_meet" as const } : criterion)

    await incident("inc-f1-decisions")
    await save("inc-f1-decisions", 0, { ...baseData, tasks: [completedTask] })

    // La decisión la manda el revisor, pero tiene que ser coherente con los criterios.
    await expect(reviewPreventionIncidentRe20Quality({ input: { incidentId: "inc-f1-decisions", expectedWorkspaceVersion: 1, decision: "approved", criteria: withPartial }, access: reviewer })).rejects.toThrow("los 13 criterios deben cumplir")
    await expect(reviewPreventionIncidentRe20Quality({ input: { incidentId: "inc-f1-decisions", expectedWorkspaceVersion: 1, decision: "approved_with_observations", criteria: withPartial }, access: reviewer })).rejects.toThrow("observación final")
    await expect(reviewPreventionIncidentRe20Quality({ input: { incidentId: "inc-f1-decisions", expectedWorkspaceVersion: 1, decision: "approved_with_observations", observation: "Falta una fuente.", criteria: withFailure }, access: reviewer })).rejects.toThrow("No se puede aprobar con observaciones")
    await expect(reviewPreventionIncidentRe20Quality({ input: { incidentId: "inc-f1-decisions", expectedWorkspaceVersion: 1, decision: "changes_required", criteria: withFailure }, access: reviewer })).rejects.toThrow("observación final")

    // changes_required reabre la tarea y sube la versión en la misma transacción.
    await reviewPreventionIncidentRe20Quality({ input: { incidentId: "inc-f1-decisions", expectedWorkspaceVersion: 1, decision: "changes_required", observation: "Documenta la fuente de H3.", criteria: withFailure }, access: reviewer })
    const reopened = await storedWorkspace("inc-f1-decisions")
    expect(reopened?.version).toBe(2)
    expect((reopened?.data as { tasks: Array<{ id: string; status: string }> }).tasks.find((task) => task.id === "definitive_report")?.status).toBe("in_progress")
    expect(await investigationOf("inc-f1-decisions")).toBeUndefined()

    // La corrección vuelve a completar el informe; «aprobado con observaciones» cierra la investigación.
    await save("inc-f1-decisions", 2, { ...baseData, tasks: [completedTask] })
    const review = await reviewPreventionIncidentRe20Quality({ input: { incidentId: "inc-f1-decisions", expectedWorkspaceVersion: 3, decision: "approved_with_observations", observation: "Archivar el croquis en el anexo B.", criteria: withPartial }, access: reviewer })
    expect(review).toMatchObject({ decision: "approved_with_observations", reviewerRole: "jefa_chome", workspaceVersion: 3 })
    expect(await investigationOf("inc-f1-decisions")).toMatchObject({ status: "completed", basicCauses: ["El resguardo fijo estaba retirado"] })
    // La aprobación cierra la tarea de revisión (etapa 5) en la misma transacción.
    const approvedWorkspace = await storedWorkspace("inc-f1-decisions")
    expect(approvedWorkspace?.version).toBe(4)
    expect((approvedWorkspace?.data as { tasks: Array<{ id: string; status: string; note?: string | null }> }).tasks.find((task) => task.id === "quality_review"))
      .toMatchObject({ status: "completed", note: "Archivar el croquis en el anexo B." })
  })

  it("un accidente de trayecto no puede completar las tareas que el protocolo no le pide", async () => {
    await incident("inc-f1-commute", { eventType: "commute_accident" })
    await expect(save("inc-f1-commute", 0, { ...baseData, tasks: [completedTask] })).rejects.toThrow("no aplica a este tipo de evento")
    await save("inc-f1-commute", 0, { tasks: [{ id: "witness_statements", sheet: "DECLARACIÓN INDIVIDUAL", label: "Declaraciones iniciales", status: "completed" }] })
    expect((await storedWorkspace("inc-f1-commute"))?.version).toBe(1)
  })

  it("un cuasi accidente de potencial grave o fatal exige el árbol y no se puede desmarcar; uno leve no lo exige", async () => {
    await incident("inc-f1-nearmiss-serious", { eventType: "dangerous_incident", actualSeverity: "none", potentialSeverity: "critical" })
    // El valor anterior del potencial se acepta y se normaliza al del libro.
    await save("inc-f1-nearmiss-serious", 0, { nearMiss: { potential: "critical", do36TreeRequired: false }, definitive: baseData.definitive })
    const stored = await storedWorkspace("inc-f1-nearmiss-serious")
    expect(stored?.data).toMatchObject({ nearMiss: { potential: "Grave o fatal", do36TreeRequired: true, seriousOrFatalPotential: true } })
    await expect(save("inc-f1-nearmiss-serious", 1, { nearMiss: { potential: "Grave o fatal" }, definitive: baseData.definitive, tasks: [completedTask] }))
      .rejects.toThrow("Falta el hecho final H1")

    await incident("inc-f1-nearmiss-low", { eventType: "dangerous_incident", actualSeverity: "none", potentialSeverity: "low" })
    await save("inc-f1-nearmiss-low", 0, { nearMiss: { potential: "Bajo" }, definitive: baseData.definitive, tasks: [completedTask] })
    expect((await storedWorkspace("inc-f1-nearmiss-low"))?.version).toBe(1)
  })

  it("convierte una medida en CAPA, la vincula con la misma versión optimista y rechaza una CAPA ajena", async () => {
    const { createCapaFromRe20Measure, createPreventionIncidentCapa } = await import("@/lib/services/prevention-incidents")
    await incident("inc-f1-capa")
    await incident("inc-f1-capa-other")
    await save("inc-f1-capa", 0, baseData)

    // Versión vieja: no pisa lo que otra persona guardó.
    await expect(createCapaFromRe20Measure({ input: { incidentId: "inc-f1-capa", measureId: "m1", expectedWorkspaceVersion: 7 }, access: writer })).rejects.toThrow("Otra persona modificó")
    await expect(createCapaFromRe20Measure({ input: { incidentId: "inc-f1-capa", measureId: "nope", expectedWorkspaceVersion: 1 }, access: writer })).rejects.toThrow("no existe")

    const created = await createCapaFromRe20Measure({ input: { incidentId: "inc-f1-capa", measureId: "m1", expectedWorkspaceVersion: 1 }, access: writer })
    expect(created).toMatchObject({ workspaceVersion: 2, measureId: "m1" })
    const [capa] = await inMemoryDb.select().from(schema.preventionCapaActions).where(eq(schema.preventionCapaActions.id, created.capa.id))
    expect(capa).toMatchObject({
      sourceType: "incident", sourceId: "inc-f1-capa", sourceItemId: "re20-measure:m1", priority: "high",
      actionDescription: "Instalar resguardo fijo con enclavamiento", responsibleUserId: USER_ID, targetDate: "2027-01-15",
    })
    const linked = await storedWorkspace("inc-f1-capa")
    expect(linked?.version).toBe(2)
    expect((linked?.data as { measures: Array<{ capaId: string }> }).measures[0]?.capaId).toBe(created.capa.id)
    await expect(createCapaFromRe20Measure({ input: { incidentId: "inc-f1-capa", measureId: "m1", expectedWorkspaceVersion: 2 }, access: writer })).rejects.toThrow("ya tiene una CAPA")

    // Un guardado que no conoce el vínculo no lo borra.
    await save("inc-f1-capa", 2, baseData)
    expect((await storedWorkspace("inc-f1-capa"))?.data).toMatchObject({ measures: [{ capaId: created.capa.id }] })

    // Una CAPA de otro incidente no se puede colgar de esta medida.
    const [otherIncident] = await inMemoryDb.select().from(schema.preventionIncidents).where(eq(schema.preventionIncidents.id, "inc-f1-capa-other"))
    const foreign = await createPreventionIncidentCapa({
      input: { incidentId: "inc-f1-capa-other", expectedVersion: otherIncident!.version, finding: "Hallazgo ajeno", actionDescription: "Acción ajena", priority: "low", targetDate: "2027-02-01" },
      access: writer,
    })
    await expect(save("inc-f1-capa", 3, { ...baseData, measures: [{ ...measure, capaId: foreign.capa.id }] })).rejects.toThrow("no existe o no pertenece a este incidente")
    await expect(save("inc-f1-capa", 3, { ...baseData, measures: [{ ...measure, capaId: "capa-inexistente" }] })).rejects.toThrow("no existe o no pertenece a este incidente")
  })

  it("acepta y descarta la difusión, el seguimiento y la clasificación libres anteriores, conservándolos en `legacy`", async () => {
    await incident("inc-f1-legacy")
    const legacyData = {
      ...baseData,
      diffusion: { summary: "Difundido en la charla de las 8", recipients: ["Turno A"] },
      accidentFollowups: [{ id: "f1", occurredOn: "2026-09-01", lostDays: 2, verified: false }],
      damageFollowups: [],
      classification: { event_type: "Accidente del trabajo CTP" },
    }
    await save("inc-f1-legacy", 0, legacyData)
    const first = (await storedWorkspace("inc-f1-legacy"))?.data as Record<string, unknown>
    expect(first).not.toHaveProperty("diffusion")
    expect(first).not.toHaveProperty("accidentFollowups")
    expect(first).not.toHaveProperty("classification")
    expect(first.legacy).toMatchObject({
      diffusion: { summary: "Difundido en la charla de las 8" },
      accidentFollowups: [{ id: "f1" }],
      classification: { event_type: "Accidente del trabajo CTP" },
    })
    // Un cliente que ya no conoce `legacy` no lo pierde al guardar.
    await save("inc-f1-legacy", 1, baseData)
    expect(((await storedWorkspace("inc-f1-legacy"))?.data as Record<string, unknown>).legacy).toMatchObject({ diffusion: { summary: "Difundido en la charla de las 8" } })
  })

  it("guardar el expediente RE-20 lleva el caso de «Medidas inmediatas» a «En investigación»", async () => {
    // Era lo que hacía la «Investigación guiada» retirada; sin esto ningún control movía el caso.
    await incident("inc-f3-status", { status: "immediate_measures", version: 3 })
    await save("inc-f3-status", 0, { methodology: "causal_tree" })
    const [row] = await inMemoryDb.select().from(schema.preventionIncidents).where(eq(schema.preventionIncidents.id, "inc-f3-status"))
    expect(row).toMatchObject({ status: "under_investigation", version: 4 })
    const history = await inMemoryDb.select().from(schema.preventionIncidentHistory).where(eq(schema.preventionIncidentHistory.incidentId, "inc-f3-status"))
    expect(history).toContainEqual(expect.objectContaining({ fromStatus: "immediate_measures", toStatus: "under_investigation" }))
    // Un segundo guardado no vuelve a mover ni a versionar el caso.
    await save("inc-f3-status", 1, { methodology: "causal_tree" })
    const [again] = await inMemoryDb.select().from(schema.preventionIncidents).where(eq(schema.preventionIncidents.id, "inc-f3-status"))
    expect(again).toMatchObject({ status: "under_investigation", version: 4 })
  })

  it("no difunde antes de la aprobación, y arma la tabla causa / medida / responsable / plazo / estatus desde las medidas", async () => {
    const { publishOnePageDiffusion } = await import("@/lib/services/prevention-incidents")
    await incident("inc-f1-diffusion")
    await save("inc-f1-diffusion", 0, { ...baseData, measures: [{ ...measure, status: "Pendiente" }], definitive: { ...baseData.definitive, closure: { learningDetail: "Revisar resguardos en todas las faenas" } } })

    await expect(publishOnePageDiffusion({ incidentId: "inc-f1-diffusion", access: writer })).rejects.toThrow("revisión de calidad RE-20 aprobada")
    await seedQualityReview("inc-f1-diffusion", "changes_required")
    await expect(publishOnePageDiffusion({ incidentId: "inc-f1-diffusion", access: writer })).rejects.toThrow("revisión de calidad RE-20 aprobada")

    await new Promise((resolve) => setTimeout(resolve, 5))
    await seedQualityReview("inc-f1-diffusion", "approved_with_observations")
    const published = await publishOnePageDiffusion({ incidentId: "inc-f1-diffusion", access: writer })
    expect(published).toMatchObject({
      rootCauseText: "El resguardo fijo estaba retirado",
      actionPlanSummary: "Instalar resguardo fijo con enclavamiento",
      learning: "Revisar resguardos en todas las faenas",
      workspaceVersion: 1,
    })
    expect(published?.measuresTable).toEqual([{
      rootCauseId: "H3", rootCause: "El resguardo fijo estaba retirado", measure: "Instalar resguardo fijo con enclavamiento",
      responsible: "Investigador RE-20", dueAt: "2027-01-15T12:00:00.000Z", status: "Pendiente",
    }])
  })

  it("el seguimiento guarda el estado triple, exige coherencia y no se duplica al reintentarse", async () => {
    const { recordBiweeklyFollowup } = await import("@/lib/services/prevention-incidents")
    await incident("inc-f1-followup")
    await save("inc-f1-followup", 0, baseData)
    const base = { incidentId: "inc-f1-followup", followupDate: "2026-10-20", note: "Resguardo instalado y probado", measureId: "m1", rootCauseId: "H3", controlType: "Ingeniería", access: writer }

    await expect(recordBiweeklyFollowup({ ...base, effective: true })).rejects.toThrow("eficaz debe estar verificada")
    await expect(recordBiweeklyFollowup({ ...base, verified: true, verifierUserId: OTHER_USER_ID })).rejects.toThrow("implementada")
    await expect(recordBiweeklyFollowup({ ...base, implementedAt: "2026-10-19", verified: true })).rejects.toThrow("quién la verificó")
    await expect(recordBiweeklyFollowup({ ...base, implementedAt: "2026-10-19", verified: true, verifierUserId: USER_ID })).rejects.toThrow("distinta del responsable")
    await expect(recordBiweeklyFollowup({ ...base, measureId: "no-existe" })).rejects.toThrow("no existe en el expediente")

    const triple = { ...base, implementedAt: "2026-10-19", verified: true, verifierUserId: OTHER_USER_ID, verifiedAt: "2026-10-20", effective: true, residualRisk: "Bajo" }
    const first = await recordBiweeklyFollowup(triple)
    expect(first).toMatchObject({
      kind: "accident", measureId: "m1", rootCauseId: "H3", controlType: "Ingeniería", verifierUserId: OTHER_USER_ID,
      verified: true, effective: true, residualRisk: "Bajo", idempotentReplay: false,
    })
    expect(first.implementedAt).toBeTruthy()
    const replay = await recordBiweeklyFollowup(triple)
    expect(replay).toMatchObject({ id: first.id, idempotentReplay: true })
    expect(await inMemoryDb.select().from(schema.preventionIncidentFollowups).where(eq(schema.preventionIncidentFollowups.incidentId, "inc-f1-followup"))).toHaveLength(1)

    // El seguimiento de un daño material (RE-20-09) es de otro tipo, sin medida obligatoria.
    const damage = await recordBiweeklyFollowup({ incidentId: "inc-f1-followup", followupDate: "2026-10-21", note: "Se repuso la defensa dañada", kind: "damage", lossDescription: "Defensa metálica", access: writer })
    expect(damage).toMatchObject({ kind: "damage", verified: false, effective: false, implementedAt: null })
  })

  it("el catálogo se lista en el orden del libro, con la categoría de cada agente, sin valores heredados", async () => {
    const { listIncidentClassificationCatalog } = await import("@/lib/services/prevention-incidents")
    const activities = await listIncidentClassificationCatalog("activity")
    const rows = activities.map((row) => Number(row.code.slice(1)))
    expect(rows.length).toBeGreaterThan(10)
    expect(rows).toEqual([...rows].sort((a, b) => a - b))
    expect(activities.map((row) => row.sortOrder)).toEqual(rows)

    const agents = await listIncidentClassificationCatalog("causal_agent")
    const parentOf = (code: string) => agents.find((row) => row.code === code)?.parentCode
    expect([parentOf("r12"), parentOf("r25"), parentOf("r26"), parentOf("r44"), parentOf("r45"), parentOf("r63"), parentOf("r64"), parentOf("r65")])
      .toEqual(["r12", "r12", "r26", "r32", "r45", "r45", "r64", "r65"])
    const categories = await listIncidentClassificationCatalog("agent_category")
    expect(categories.map((row) => row.name)).toEqual(["Equipos", "Materiales", "Ambiente", "Ambiente higiénico", "Organización del trabajo", "Otros"])

    const everything = await listIncidentClassificationCatalog()
    expect(everything.some((row) => row.category.startsWith("legacy_"))).toBe(false)
    expect((await listIncidentClassificationCatalog(undefined, { includeLegacy: true })).some((row) => row.category.startsWith("legacy_"))).toBe(true)
  })

  it("un guardado repetido (cola offline) no vuelve a acreditar los hitos", async () => {
    const { savePreventionIncidentRe20Workspace, reportPreventionIncident } = await import("@/lib/services/prevention-incidents")
    // Por el flujo real: abrir el caso crea las obligaciones PDTP que el hito reporta.
    const reported = await reportPreventionIncident({
      access: { ...writer, permissions: [...writer.permissions, "prevention:incidents:report"] },
      input: {
        worksiteId: WS_ID, companyName: "Empresa Test", eventType: "work_accident", occurredAt: OCCURRED_AT, knownAt: KNOWN_AT,
        location: "Planta", initialNarrative: "Golpe en la mano con la transmisión", people: [], clientSubmissionId: "sub-f1-replay-001",
      },
    })
    const input = {
      incidentId: reported.incident.id, expectedVersion: 0, mutationId: "fase1-replay-mutation-001",
      data: { methodology: "causal_tree", tasks: [{ id: "preliminary_report", sheet: "INV.PRE.ACC", label: "Informe preliminar", status: "completed", completedAt: new Date().toISOString() }] },
    }
    const first = await savePreventionIncidentRe20Workspace({ input, access: writer })
    expect(first.idempotentReplay).toBe(false)
    const eventsAfterFirst = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)
    const executionsAfterFirst = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(executionsAfterFirst.some((row) => row.activityId === "act-68")).toBe(true)

    const second = await savePreventionIncidentRe20Workspace({ input, access: writer })
    expect(second.idempotentReplay).toBe(true)
    expect(await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)).toHaveLength(eventsAfterFirst.length)
    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(executionsAfterFirst.length)
    expect((await storedWorkspace(reported.incident.id))?.version).toBe(1)
  })
})
