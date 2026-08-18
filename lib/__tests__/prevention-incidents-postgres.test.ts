/**
 * Real PostgreSQL proof for the canonical incident workflow.
 * Runs only against an explicitly disposable database.
 */
import path from "node:path"
import os from "node:os"
import { mkdtemp, rm } from "node:fs/promises"
import ExcelJS from "exceljs"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { eq, sql } from "drizzle-orm"
import * as schema from "@/db/schema"
import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  quotePostgresIdentifier,
} from "@/lib/testing/destructive-database-guard"

const databaseUrl = process.env.PREVENTION_INCIDENTS_DATABASE_URL
const canResetDatabase = process.env.PREVENTION_INCIDENTS_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canResetDatabase ? describe : describe.skip

let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined
let storageDir: string | undefined
const previousDatabaseUrl = process.env.DATABASE_URL
const previousStoragePath = process.env.STORAGE_PATH
const previousKey = process.env.PREVENTION_DATA_ENCRYPTION_KEY
const previousKeyVersion = process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION

describeIf("canonical incident workflow on real PostgreSQL", () => {
  beforeAll(async () => {
    assertSafeDestructiveDatabase({
      databaseUrl: databaseUrl!,
      allowDestructiveReset: canResetDatabase,
      context: "PREVENTION_INCIDENTS",
    })
    await ensureDatabaseExists(databaseUrl!)
    await resetDatabase(databaseUrl!)
    const migrationClient = postgres(databaseUrl!, { max: 1 })
    await migrate(drizzle(migrationClient), { migrationsFolder: path.resolve(process.cwd(), "db/migrations") })
    await migrationClient.end()

    client = postgres(databaseUrl!, { max: 10 })
    testDb = drizzle(client, { schema })
    const globalWithDb = globalThis as typeof globalThis & { __db?: typeof testDb }
    globalWithDb.__db = testDb
    process.env.DATABASE_URL = databaseUrl
    storageDir = await mkdtemp(path.join(os.tmpdir(), "chome-incidents-test-"))
    process.env.STORAGE_PATH = storageDir
    process.env.PREVENTION_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 23).toString("base64")
    process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION = "incident-test-v1"
    vi.resetModules()
    await seedFixture(getDb())
  }, 60_000)

  afterAll(async () => {
    const globalWithDb = globalThis as typeof globalThis & { __db?: unknown }
    globalWithDb.__db = undefined
    await client?.end()
    if (storageDir) await rm(storageDir, { recursive: true, force: true })
    restoreEnv("DATABASE_URL", previousDatabaseUrl)
    restoreEnv("STORAGE_PATH", previousStoragePath)
    restoreEnv("PREVENTION_DATA_ENCRYPTION_KEY", previousKey)
    restoreEnv("PREVENTION_DATA_ENCRYPTION_KEY_VERSION", previousKeyVersion)
  })

  it("synchronizes one contractor event once and keeps sensitive identity out of general views", async () => {
    const { getPreventionIncidentDetail, reportPreventionIncident } = await import("@/lib/services/prevention-incidents")
    const input = {
      clientSubmissionId: "offline-contractor-proof-001",
      worksiteId: "ws-incidents",
      companyName: "Contratista Segura SpA",
      companyTaxId: "76.000.000-1",
      eventType: "contractor_or_third_party",
      occurredAt: "2026-07-18T12:00:00.000Z",
      knownAt: "2026-07-18T12:05:00.000Z",
      location: "=HYPERLINK(\"https://invalid.local\",\"Patio\")",
      initialNarrative: "Persona contratista resbaló sin lesión aparente durante una inspección.",
      actualSeverity: "minor",
      potentialSeverity: "medium",
      immediateMeasures: "Se aisló el sector y se corrigió la superficie.",
      operationsSuspended: false,
      offlineSync: true,
      people: [{
        workerId: "worker-incident",
        displayLabel: "Persona involucrada 1",
        employerName: "Contratista Segura SpA",
        relationshipType: "contractor",
        sensitive: { fullName: "Nombre Reservado", nationalIdentifier: "11.111.111-1", injuryDescription: "Contusión menor" },
      }],
    }
    const reportAccess = access("incident-reporter", ["prevention:incidents:report"])
    const first = await reportPreventionIncident({ input, access: reportAccess })
    const second = await reportPreventionIncident({ input, access: reportAccess })
    expect(first.idempotentReplay).toBe(false)
    expect(second).toMatchObject({ idempotentReplay: true, incident: { id: first.incident.id } })

    const general = await getPreventionIncidentDetail({
      incidentId: first.incident.id,
      access: access("incident-reporter", ["prevention:incidents:view"]),
    })
    expect(general?.incident).toMatchObject({ companyName: "Contratista Segura SpA", worksiteId: "ws-incidents", source: "offline_sync" })
    expect(general?.people[0]).toMatchObject({ displayLabel: "Persona involucrada 1", employerName: "Contratista Segura SpA" })
    expect(general?.sensitivePeople).toEqual([])
    expect(JSON.stringify(general)).not.toContain("Nombre Reservado")
    expect(JSON.stringify(general)).not.toContain("Contusión menor")

    await expect(getPreventionIncidentDetail({
      incidentId: first.incident.id,
      includeSensitive: true,
      purpose: "investigación",
      access: access("incident-outsider", ["prevention:incidents:view"]),
    })).rejects.toThrow(/no encontrado o fuera de alcance/i)
    const reserved = await getPreventionIncidentDetail({
      incidentId: first.incident.id,
      includeSensitive: true,
      purpose: "investigación de causas",
      access: access("incident-verifier", ["prevention:incidents:view", "prevention:incidents:view_sensitive"]),
    })
    expect(reserved?.sensitivePeople[0]?.payload).toMatchObject({ fullName: "Nombre Reservado", injuryDescription: "Contusión menor" })
    const audits = await getDb().select().from(schema.preventionSensitiveAccessAudit)
      .where(eq(schema.preventionSensitiveAccessAudit.entityId, first.incident.id))
    expect(audits.map((item) => item.outcome).sort()).toEqual(["denied", "granted"])
    expect(await getDb().select().from(schema.preventionIncidents)
      .where(eq(schema.preventionIncidents.clientSubmissionId, input.clientSubmissionId))).toHaveLength(1)

    const { buildIncidentCaseExport, buildIncidentRegisterExport } = await import("@/lib/services/prevention-incident-export")
    const { buildXlsxBuffer } = await import("@/lib/reports/export")
    const exportAccess = access("incident-verifier", [
      "prevention:incidents:view",
      "prevention:incidents:view_sensitive",
      "prevention:incidents:export",
    ])
    const register = await buildIncidentRegisterExport(exportAccess)
    expect(register.sheets?.map((item) => item.worksheetName)).toEqual([
      "Registro legal",
      "Personas minimizadas",
      "Denuncias y plazos",
      "Investigaciones",
      "Evidencia operacional",
      "CAPA",
      "Historial",
    ])
    const caseReport = await buildIncidentCaseExport({
      incidentId: first.incident.id,
      includeSensitive: true,
      purpose: "fiscalización controlada del expediente",
      access: exportAccess,
    })
    expect(caseReport?.sheets?.at(-1)?.worksheetName).toBe("Datos reservados")
    const exported = new ExcelJS.Workbook()
    await exported.xlsx.load(Buffer.from(await buildXlsxBuffer(caseReport!)) as never)
    expect(exported.worksheets.map((item) => item.name)).toHaveLength(8)
    expect(exported.getWorksheet("Expediente")?.getCell("B9").value).toBe("'=HYPERLINK(\"https://invalid.local\",\"Patio\")")
    expect(exported.getWorksheet("Datos reservados")?.getCell("C2").value).toBe("sensible_salud")
    const exportAudits = await getDb().select().from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, first.incident.id))
    expect(exportAudits).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "export", entityType: "prevention_incident" }),
    ]))
  })

  it("enforces fatal/serious notification, investigation, CAPA and restart gates through closure", async () => {
    const incidents = await import("@/lib/services/prevention-incidents")
    const capaService = await import("@/lib/services/prevention-capa")
    const managerPermissions = [
      "prevention:incidents:report", "prevention:incidents:view", "prevention:incidents:triage",
      "prevention:incidents:investigate", "prevention:incidents:notify", "prevention:incidents:authorize_restart",
      "prevention:incidents:close", "prevention:capa:manage", "prevention:capa:complete",
    ]
    const manager = access("incident-reporter", managerPermissions)
    const reported = await incidents.reportPreventionIncident({
      access: manager,
      input: {
        clientSubmissionId: "fatal-workflow-proof-001",
        worksiteId: "ws-incidents",
        companyName: "Chome",
        eventType: "work_accident",
        occurredAt: "2026-07-18T08:00:00.000Z",
        knownAt: "2026-07-18T08:10:00.000Z",
        location: "Línea de clasificación",
        initialNarrative: "Evento grave controlado para probar el flujo legal y operacional completo.",
        actualSeverity: "serious",
        potentialSeverity: "critical",
        immediateMeasures: "Operación detenida, área aislada y atención de emergencia activada.",
        operationsSuspended: true,
        evacuated: true,
        isFatalOrSerious: true,
        people: [],
      },
    })
    const incidentId = reported.incident.id
    const [diat] = await getDb().select().from(schema.preventionIncidentNotifications).where(eq(schema.preventionIncidentNotifications.notificationType, "diat"))
    expect(new Date(diat!.deadlineAt!).getTime() - new Date(reported.incident.knownAt).getTime()).toBe(86_400_000)

    let incident = await incidents.triagePreventionIncident({
      access: manager,
      input: { incidentId, expectedVersion: 1, actualSeverity: "serious", potentialSeverity: "critical", isFatalOrSerious: true, operationsSuspended: true, evacuated: true, immediateMeasures: "Operación detenida, área aislada y atención de emergencia activada.", notificationResponsibleUserId: "incident-reporter", administratorName: "Mutual de prueba", reason: "Clasificación grave confirmada por triage" },
    })
    incident = await incidents.transitionPreventionIncident({ access: manager, input: { incidentId, expectedVersion: incident.version, toStatus: "immediate_measures", reason: "Medidas inmediatas verificadas en terreno" } })
    // El aprendizaje del incidente no se cierra con un checkbox: declarar la
    // MIPER actualizada exige un disparador resuelto por una versión publicada
    // después del propio disparador. Aquí se prueba la cadena completa.
    const investigationBase = {
      incidentId, methodology: "Árbol de causas",
      team: [{ userId: "incident-reporter", role: "Investigador" }], evidenceSummary: "Fotografías y entrevistas controladas",
      immediateCauses: ["Contacto con zona de riesgo"], basicCauses: ["Control físico insuficiente"],
      organizationalCauses: ["Verificación preventiva incompleta"], failedControls: ["Barrera de ingeniería"],
      conclusions: "La barrera no evitó la exposición y requiere corrección verificable.", interviews: [{ witness: "cifrado" }],
      miperUpdateRequired: true, procedureUpdateRequired: true, procedureUpdated: true,
      trainingRequired: true, trainingCompleted: true,
    }
    const opened = await incidents.savePreventionIncidentInvestigation({
      access: manager,
      input: { ...investigationBase, expectedIncidentVersion: incident.version, miperUpdated: false, complete: false, reason: "Investigación abierta; se crea el disparador MIPER" },
    })
    const [miperTrigger] = await getDb().select().from(schema.preventionRiskReviewTriggers)
      .where(eq(schema.preventionRiskReviewTriggers.idempotencyKey, `incident:miper:${incidentId}`))
    expect(miperTrigger).toMatchObject({ triggerType: "work_accident", status: "pending", worksiteId: "ws-incidents" })

    await expect(incidents.savePreventionIncidentInvestigation({
      access: manager,
      input: { ...investigationBase, expectedIncidentVersion: opened.incident.version, miperUpdated: true, complete: false, reason: "Intento de declarar la MIPER actualizada sin versión publicada" },
    })).rejects.toThrow(/disparador exige una nueva versión publicada/)

    await expect(incidents.savePreventionIncidentInvestigation({
      access: manager,
      input: { ...investigationBase, expectedIncidentVersion: opened.incident.version, miperUpdated: false, complete: true, reason: "Intento de completar la investigación con el disparador MIPER abierto" },
    })).rejects.toThrow(/antes de cerrar la investigación/)

    // Publicación real de la MIPER que resuelve el disparador, con segregación
    // autor / revisor / aprobador.
    const risk = await import("@/lib/services/prevention-risk-legal")
    const riskAccess = (userId: string, permissions: string[]) => ({ userId, scope: { mode: "some" as const, ids: ["ws-incidents"] }, permissions })
    const riskAuthor = riskAccess("incident-reporter", ["prevention:risk:view", "prevention:risk:edit"])
    const riskReviewer = riskAccess("incident-verifier", ["prevention:risk:review"])
    const riskApprover = riskAccess("incident-risk-approver", ["prevention:risk:approve", "prevention:risk:publish"])
    const methodology = await risk.ensureIspRiskMethodology(riskAuthor)
    const matrix = await risk.createRiskMatrixDraft({
      worksiteId: "ws-incidents", title: "MIPER revisada por incidente grave", methodologyId: methodology.id,
      revisionReason: "Revisión obligatoria por accidente grave con barrera de ingeniería fallida.",
      participationSummary: "Revisión con línea de mando, CPHS y operadores involucrados.",
      consultationEvidenceReference: "acta-participacion-incidente-001",
    }, riskAuthor)
    await risk.addRiskEntry({
      matrixId: matrix.id,
      process: { code: "PROC-INC", name: "Clasificación de residuos" },
      task: { code: "TASK-INC", name: "Operar línea de clasificación", isRoutine: true },
      position: { code: "POS-INC", name: "Operador de línea" },
      hazardCode: "INC-01", hazard: "Contacto con zona de riesgo por barrera insuficiente",
      riskFactor: "Operación industrial con equipos en movimiento",
      expectedEventOrDamage: "Lesión grave con tiempo perdido",
      exposedPeopleDescription: "Operadores de la línea de clasificación",
      exposedPeopleCount: 4,
      genderConsiderations: "Evaluar diferencias de exposición y ajuste de EPP.",
      sensitiveWorkerConsiderations: "Validar restricciones sin exponer diagnósticos.",
      inherentDimensions: { probability: 4, consequence: 5 }, inherentScore: 20, inherentLevel: "Alto",
      residualDimensions: { probability: 2, consequence: 5 }, residualScore: 10, residualLevel: "Medio",
      isCritical: true, responsibleSnapshot: "Jefatura de operaciones",
      controls: [{ description: "Barrera de ingeniería certificada con verificación periódica", hierarchy: "engineering", isExisting: false, isCritical: true, performanceStandard: "Resistencia certificada y anclaje verificado", verificationFrequency: "Mensual", responsibleSnapshot: "Jefatura de operaciones", status: "implemented" }],
    }, riskAuthor)
    const submitted = await risk.transitionRiskMatrix({ matrixId: matrix.id, expectedVersion: matrix.version, toStatus: "in_review", reason: "Revisión post incidente enviada al circuito formal." }, riskAuthor)
    const reviewed = await risk.transitionRiskMatrix({ matrixId: matrix.id, expectedVersion: submitted.version, toStatus: "reviewed", reason: "Causas y controles del incidente contrastados en terreno." }, riskReviewer)
    const approvedMatrix = await risk.transitionRiskMatrix({ matrixId: matrix.id, expectedVersion: reviewed.version, toStatus: "approved", reason: "Aprobación segregada de la revisión post incidente." }, riskApprover)
    await risk.transitionRiskMatrix({ matrixId: matrix.id, expectedVersion: approvedMatrix.version, toStatus: "published", reason: "Publicación de la MIPER revisada por el incidente.", effectiveFrom: "2026-07-18" }, riskApprover)
    const resolvedTrigger = await risk.resolveRiskReviewTrigger({
      triggerId: miperTrigger!.id, matrixId: matrix.id,
      resolution: "MIPER republicada incorporando la barrera certificada como control crítico.",
    }, riskReviewer)
    expect(resolvedTrigger.status).toBe("completed")

    const investigation = await incidents.savePreventionIncidentInvestigation({
      access: manager,
      input: { ...investigationBase, expectedIncidentVersion: opened.incident.version, miperUpdated: true, complete: true, reason: "Investigación concluida con controles actualizados" },
    })
    const [savedInvestigation] = await getDb().select().from(schema.preventionIncidentInvestigations)
      .where(eq(schema.preventionIncidentInvestigations.id, investigation.investigationId))
    expect(savedInvestigation).toMatchObject({ status: "completed", miperUpdateRequired: true })
    expect(savedInvestigation!.miperUpdatedAt).toBeTruthy()
    incident = await incidents.transitionPreventionIncident({ access: manager, input: { incidentId, expectedVersion: investigation.incident.version, toStatus: "pending_capa", reason: "Investigación completa; se abre control CAPA" } })
    const createdCapa = await incidents.createPreventionIncidentCapa({
      access: manager,
      input: { incidentId, expectedVersion: incident.version, finding: "Barrera de ingeniería insuficiente", actionDescription: "Instalar y verificar una barrera certificada", responsibleUserId: "incident-reporter", priority: "critical", targetDate: "2026-08-01", evidenceRequired: true },
    })
    const capaId = createdCapa.capa.id
    const capaManager = { ctx: { userId: "incident-reporter" }, scope: { mode: "some" as const, ids: ["ws-incidents"] }, permissions: managerPermissions }
    let capa = await capaService.transitionCapaAction({ ...capaManager, input: { actionId: capaId, expectedVersion: 1, toStatus: "in_progress" } })
    const evidence = await capaService.addCapaEvidence({ ...capaManager, input: { actionId: capaId, expectedVersion: capa.version, kind: "document", reference: "evidencia-barrera-certificada", description: "Acta de instalación" } })
    capa = await capaService.transitionCapaAction({ ...capaManager, input: { actionId: capaId, expectedVersion: evidence.action.version, toStatus: "pending_verification" } })
    capa = await capaService.transitionCapaAction({
      ctx: { userId: "incident-verifier" }, scope: { mode: "some", ids: ["ws-incidents"] }, permissions: ["prevention:capa:verify"],
      input: { actionId: capaId, expectedVersion: capa.version, toStatus: "verified", effectivenessStatus: "effective", effectivenessAssessment: "Barrera inspeccionada y desafío operacional superado" },
    })
    capa = await capaService.transitionCapaAction({
      ctx: { userId: "incident-verifier" }, scope: { mode: "some", ids: ["ws-incidents"] }, permissions: ["prevention:capa:close"],
      input: { actionId: capaId, expectedVersion: capa.version, toStatus: "closed" },
    })
    expect(capa.status).toBe("closed")

    incident = await incidents.transitionPreventionIncident({ access: manager, input: { incidentId, expectedVersion: createdCapa.incident.version, toStatus: "pending_verification", reason: "CAPA verificada y cerrada" } })
    // Fixed after every legal deadline so the proof is deterministic and verifies
    // that a late filing remains visible after the incident is closed.
    const sentAt = "2026-07-20T08:11:00.000Z"
    for (const notificationType of ["diat", "fatal_dt", "fatal_seremi"] as const) {
      incident = await incidents.recordPreventionIncidentNotification({
        access: manager,
        input: { incidentId, expectedVersion: incident.version, notificationType, sentAt, evidenceReference: `folio-${notificationType}`, observations: "Presentación manual registrada" },
      })
    }
    // El reinicio exige un tercero: `manager` investigó y es responsable de la
    // CAPA, así que la segregación por identidad lo rechaza (F-09).
    await expect(incidents.authorizePreventionIncidentRestart({
      access: manager,
      input: {
        incidentId, expectedVersion: incident.version,
        reason: "Controles verificados, autoridad notificada y CAPA eficaz",
        authorityName: "SEREMI de Salud",
        authorizationReference: "Res. Ex. 4321/2026",
        authorizationDate: "2026-08-10",
        evidenceReference: "storage/resoluciones/levantamiento-4321.pdf",
      },
    })).rejects.toThrow(/no participó en la investigación/i)
    // NORM-06: sin la resolución del organismo fiscalizador la faena no reanuda.
    incident = await incidents.authorizePreventionIncidentRestart({
      access: access("incident-risk-approver", ["prevention:incidents:authorize_restart"]),
      input: {
        incidentId, expectedVersion: incident.version,
        reason: "Controles verificados, autoridad notificada y CAPA eficaz",
        authorityName: "SEREMI de Salud",
        authorizationReference: "Res. Ex. 4321/2026",
        authorizationDate: "2026-08-10",
        evidenceReference: "storage/resoluciones/levantamiento-4321.pdf",
      },
    })
    incident = await incidents.transitionPreventionIncident({
      access: manager,
      input: { incidentId, expectedVersion: incident.version, toStatus: "closed", reason: "Expediente completo y reinicio controlado" },
    })
    expect(incident).toMatchObject({ status: "closed", operationsSuspended: false })
    const lanes = await getDb().select().from(schema.preventionIncidentNotifications)
      .where(eq(schema.preventionIncidentNotifications.incidentId, incidentId))
    expect(lanes.find((lane) => lane.notificationType === "restart_authorization")).toMatchObject({ status: "authorized" })
    expect(lanes.filter((lane) => lane.notificationType !== "restart_authorization").every((lane) => lane.evidenceReference)).toBe(true)
    // These historical test timestamps are intentionally late; closure must not erase that fact.
    expect(lanes.filter((lane) => lane.notificationType !== "restart_authorization").every((lane) => lane.escalatedAt)).toBe(true)
    const history = await getDb().select().from(schema.preventionIncidentHistory)
      .where(eq(schema.preventionIncidentHistory.incidentId, incidentId))
    expect(history.map((item) => item.changeType)).toEqual(expect.arrayContaining(["reported", "triage", "investigation", "capa", "notification", "restart", "closure"]))
  })

  // Reemplaza al antiguo escenario de staging SFTI: lo que interesa conservar
  // es que el job de recordatorios no reinicie el atraso de un carril legal.
  it("keeps the first escalation timestamp when the reminder job runs twice on an overdue lane", async () => {
    const incidents = await import("@/lib/services/prevention-incidents")
    const reporter = access("incident-reporter", ["prevention:incidents:report", "prevention:incidents:view"])
    const reported = await incidents.reportPreventionIncident({
      access: reporter,
      input: {
        clientSubmissionId: "overdue-lane-proof-001",
        worksiteId: "ws-incidents",
        companyName: "Chome",
        eventType: "work_accident",
        occurredAt: "2026-07-17T10:00:00.000Z",
        knownAt: "2026-07-17T10:30:00.000Z",
        location: "Patio",
        initialNarrative: "Evento con conocimiento antiguo para dejar la DIAT vencida.",
        people: [],
      },
    })

    const [lateLane] = await getDb().select().from(schema.preventionIncidentNotifications)
      .where(eq(schema.preventionIncidentNotifications.incidentId, reported.incident.id))
    expect(lateLane).toBeTruthy()

    const { runPreventionIncidentReminders } = await import("@/lib/services/prevention-incident-reminders")
    const reminderResult = await runPreventionIncidentReminders(new Date("2026-07-19T11:00:00.000Z"))
    expect(reminderResult.overdueLanes).toBeGreaterThanOrEqual(1)

    const [afterFirst] = await getDb().select().from(schema.preventionIncidentNotifications)
      .where(eq(schema.preventionIncidentNotifications.id, lateLane!.id))
    expect(afterFirst).toMatchObject({ status: "overdue" })
    expect(afterFirst?.escalatedAt).toBeTruthy()

    await runPreventionIncidentReminders(new Date("2026-07-19T15:00:00.000Z"))
    const [afterSecond] = await getDb().select().from(schema.preventionIncidentNotifications)
      .where(eq(schema.preventionIncidentNotifications.id, lateLane!.id))
    expect(afterSecond?.escalatedAt).toBe(afterFirst?.escalatedAt)
  })

  it("rejects foreign-worksite report, mutation and read without revealing the incident", async () => {
    const incidents = await import("@/lib/services/prevention-incidents")
    await expect(incidents.reportPreventionIncident({
      access: { ctx: { userId: "incident-outsider" }, scope: { mode: "some", ids: ["ws-foreign"] }, permissions: ["prevention:incidents:report"] },
      input: { clientSubmissionId: "foreign-forged-001", worksiteId: "ws-incidents", companyName: "Ajena", eventType: "dangerous_incident", occurredAt: "2026-07-18T08:00:00.000Z", knownAt: "2026-07-18T08:10:00.000Z", location: "Lugar", initialNarrative: "Intento de crear un evento en una faena no autorizada.", people: [] },
    })).rejects.toThrow(/no encontrado o fuera de alcance/i)
    const [canonical] = await getDb().select().from(schema.preventionIncidents)
      .where(eq(schema.preventionIncidents.clientSubmissionId, "offline-contractor-proof-001"))
    await expect(incidents.triagePreventionIncident({
      access: { ctx: { userId: "incident-outsider" }, scope: { mode: "some", ids: ["ws-foreign"] }, permissions: ["prevention:incidents:triage"] },
      input: { incidentId: canonical!.id, expectedVersion: canonical!.version, actualSeverity: "minor", potentialSeverity: "medium", isFatalOrSerious: false, operationsSuspended: false, evacuated: false, immediateMeasures: "Medidas fuera de alcance", reason: "Intento desde faena ajena" },
    })).rejects.toThrow(/no encontrado o fuera de alcance/i)
    await expect(incidents.getPreventionIncidentDetail({
      incidentId: canonical!.id,
      access: { ctx: { userId: "incident-outsider" }, scope: { mode: "some", ids: ["ws-foreign"] }, permissions: ["prevention:incidents:view"] },
    })).resolves.toBeNull()
  })
})

function access(userId: string, permissions: string[]) {
  return { ctx: { userId }, scope: { mode: "some" as const, ids: ["ws-incidents"] }, permissions }
}

function getDb() {
  if (!testDb) throw new Error("Incident test database was not initialized")
  return testDb
}

async function seedFixture(db: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date().toISOString()
  await db.insert(schema.worksites).values([
    { id: "ws-incidents", name: "Faena Incidentes", code: "INC-TEST", createdAt: now, updatedAt: now },
    { id: "ws-foreign", name: "Faena Ajena", code: "INC-FGN", createdAt: now, updatedAt: now },
  ])
  await db.insert(schema.workers).values({
    id: "worker-incident", rut: "11.111.111-1", firstName: "Persona", lastName: "Reservada", worksiteId: "ws-incidents", createdAt: now,
  })
  await db.insert(schema.users).values([
    { id: "incident-reporter", name: "Incident Reporter", email: "incident-reporter@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "incident-verifier", name: "Incident Verifier", email: "incident-verifier@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "incident-outsider", name: "Incident Outsider", email: "incident-outsider@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "incident-risk-approver", name: "Incident Risk Approver", email: "incident-risk-approver@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
  ])
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

async function resetDatabase(url: string) {
  const setupClient = postgres(url, { max: 1 })
  const setupDb = drizzle(setupClient)
  try {
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`)
    await setupDb.execute(sql`CREATE SCHEMA public`)
    await setupDb.execute(sql`CREATE SCHEMA drizzle`)
    await setupDb.execute(sql`GRANT ALL ON SCHEMA public TO PUBLIC`)
  } finally {
    await setupClient.end()
  }
}

async function ensureDatabaseExists(url: string) {
  const databaseName = getDatabaseNameFromUrl(url)
  const maintenanceClient = postgres(getMaintenanceDatabaseUrl(url), { max: 1 })
  try {
    const rows = await maintenanceClient<{ exists: number }[]>`
      SELECT 1 AS exists FROM pg_database WHERE datname = ${databaseName} LIMIT 1
    `
    if (rows.length === 0) await maintenanceClient.unsafe(`CREATE DATABASE ${quotePostgresIdentifier(databaseName)}`)
  } finally {
    await maintenanceClient.end()
  }
}
