/** Real PostgreSQL proof for Emergencias: disponibilidad del plan, segregación de aprobación y cierre de simulacro derivando a CAPA. */
import path from "node:path"
import postgres from "postgres"
import { asc, eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  quotePostgresIdentifier,
} from "@/lib/testing/destructive-database-guard"

const databaseUrl = process.env.PREVENTION_EMERGENCY_DATABASE_URL
const canReset = process.env.PREVENTION_EMERGENCY_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canReset ? describe : describe.skip
const previousDatabaseUrl = process.env.DATABASE_URL
let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined

/**
 * EMERGENCIAS-05: sin programa PDTP activo `accreditPdtpFromEvent` se traga el
 * evento y no deja rastro en ninguna tabla, así que la única forma de probar que
 * el cable entre el simulacro y el programa anual EXISTE es observar la llamada
 * al conector. Se sustituye sólo ese export; el resto del módulo queda intacto.
 */
vi.mock("@/lib/services/pdtp-adapters/pdtp-accreditation-connectors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/pdtp-adapters/pdtp-accreditation-connectors")>()),
  onEmergencyDrillCompleted: vi.fn(async () => {}),
}))

const scopeA = { mode: "some", ids: ["ws-em-a"] } as WorksiteScope
const MANAGER = { userId: "em-manager", scope: scopeA, permissions: ["prevention:emergency:view", "prevention:emergency:manage"] }
const APPROVER = { userId: "em-approver", scope: { mode: "all", ids: [] } as WorksiteScope, permissions: ["prevention:emergency:view", "prevention:emergency:approve"] }
// Mismo usuario que crea el plan, pero con el permiso de aprobar: aísla la
// segregación de funciones (servicio) del gate de permisos (RBAC), que ya
// se prueba aparte en `denies creating a plan from a foreign worksite scope`.
const MANAGER_WITH_APPROVE = { userId: "em-manager", scope: scopeA, permissions: ["prevention:emergency:view", "prevention:emergency:manage", "prevention:emergency:approve"] }
const EXECUTOR = { userId: "em-executor", scope: scopeA, permissions: ["prevention:emergency:view", "prevention:emergency:drill_execute"] }
const OUTSIDER = { userId: "em-outsider", scope: { mode: "some", ids: ["ws-em-b"] } as WorksiteScope, permissions: ["prevention:emergency:view", "prevention:emergency:manage"] }

function getDb() {
  if (!testDb) throw new Error("Test database not initialised")
  return testDb
}

/**
 * EMERGENCIAS-06: `executedAt` quedó acotado entre la fecha programada y ahora,
 * así que el calendario fijo del fixture (simulacros programados y "realizados"
 * en septiembre y noviembre de 2026) dejaba de ser válido con sólo mirar el
 * reloj. Las fechas pasan a ser relativas a la corrida: los simulacros ocurren
 * en el pasado reciente, que es lo que un simulacro completado siempre es.
 */
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString()
const HORA = 3_600_000
const DIA = 24 * HORA
const DRILL_SCHEDULED_FOR = iso(-2 * DIA)
const DRILL_EXECUTED_AT = iso(-2 * DIA + 20 * 60_000)
const SECOND_DRILL_SCHEDULED_FOR = iso(-1 * DIA)
const SECOND_DRILL_EXECUTED_AT = iso(-1 * DIA + 20 * 60_000)

describeIf("Emergencias on real PostgreSQL", () => {
  let planId = ""
  let planVersion = 1
  let drillId = ""
  let drillVersion = 1
  let resourceId = ""

  beforeAll(async () => {
    assertSafeDestructiveDatabase({ databaseUrl: databaseUrl!, allowDestructiveReset: canReset, context: "PREVENTION_EMERGENCY" })
    await ensureDatabaseExists(databaseUrl!)
    await resetDatabase(databaseUrl!)
    const migrationClient = postgres(databaseUrl!, { max: 1, onnotice: () => undefined })
    await migrate(drizzle(migrationClient), { migrationsFolder: path.resolve(process.cwd(), "db/migrations") })
    await migrationClient.end()
    client = postgres(databaseUrl!, { max: 10, onnotice: () => undefined })
    testDb = drizzle(client, { schema })
    ;(globalThis as typeof globalThis & { __db?: typeof testDb }).__db = testDb
    process.env.DATABASE_URL = databaseUrl
    vi.resetModules()
    await seedFixture(getDb())
  }, 60_000)

  afterAll(async () => {
    ;(globalThis as typeof globalThis & { __db?: unknown }).__db = undefined
    await client?.end()
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
  })

  it("denies creating a plan from a foreign worksite scope", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    await expect(service.createEmergencyPlan({
      worksiteId: "ws-em-a", title: "Plan ajeno",
    }, OUTSIDER)).rejects.toThrow(/fuera de alcance/)
  })

  it("creates the plan in draft", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    const plan = await service.createEmergencyPlan({
      worksiteId: "ws-em-a", title: "Plan de emergencia Faena Norte",
    }, MANAGER)
    planId = plan.id
    planVersion = plan.version
    expect(plan.status).toBe("draft")
  })

  it("refuses to approve a plan without scenarios nor roles", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    await expect(service.approveEmergencyPlan({
      planId, expectedVersion: planVersion,
    }, APPROVER)).rejects.toThrow(/escenario/)
  })

  it("adds a scenario and a role, rejecting a role assignee from another worksite", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    await service.addEmergencyScenario({
      planId, type: "incendio_estructural", title: "Incendio en bodega de insumos",
      responseProcedure: "Activar alarma, evacuar por ruta señalizada y usar extintores del sector.",
    }, MANAGER)

    await expect(service.addEmergencyRole({
      planId, roleName: "Jefe de emergencia", assigneeWorkerId: "wk-b1",
    }, MANAGER)).rejects.toThrow(/faena del plan/)

    await service.addEmergencyRole({
      planId, roleName: "Jefe de emergencia", assigneeWorkerId: "wk-a1", backupWorkerId: "wk-a2",
    }, MANAGER)
  })

  // El equipo se registra con el plan todavía en borrador: una vez aprobado, el
  // contenido queda congelado (ver la prueba de más abajo). Nace vencido para
  // que la bandeja de Prevención lo levante y se pueda comprobar que la
  // actualización lo apaga.
  it("registers an expired resource while the plan is still a draft", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    const resource = await service.addEmergencyResource({
      planId, name: "Extintor PQS 10 kg", kind: "Extintor", location: "Portería",
      expiresAt: "2020-01-01", nextInspectionAt: "2020-01-01",
    }, MANAGER)
    resourceId = resource.id
    expect(resource.worksiteId).toBe("ws-em-a")
    expect(resource.status).toBe("operational")
  })

  it("refuses approval by the plan's own creator, even holding the approve permission", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    await expect(service.approveEmergencyPlan({
      planId, expectedVersion: planVersion,
    }, MANAGER_WITH_APPROVE)).rejects.toThrow(/no puede aprobarlo/)
  })

  it("approves the plan once scenario and role exist, by someone other than its creator", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    const approved = await service.approveEmergencyPlan({
      planId, expectedVersion: planVersion,
    }, APPROVER)
    planVersion = approved.version
    expect(approved.status).toBe("approved")
    expect(approved.approvedByUserId).toBe("em-approver")
  })

  // EMERGENCIAS-01: el plan aprobado es el documento que se ejecuta. Si se le
  // siguen colgando escenarios, roles, recursos y contactos, lo aprobado deja de
  // ser lo vigente. La vía para cambiarlo es archivarlo y emitir el siguiente.
  it("freezes the content of an approved plan: no scenario, role, resource nor contact can be added", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    const congelado = /aprobado y su contenido quedó congelado/

    await expect(service.addEmergencyScenario({
      planId, type: "sismo", title: "Sismo de gran magnitud",
      responseProcedure: "Evacuar a zona de seguridad y esperar réplicas antes de reingresar.",
    }, MANAGER)).rejects.toThrow(congelado)

    await expect(service.addEmergencyRole({
      planId, roleName: "Encargado de evacuación", assigneeWorkerId: "wk-a2",
    }, MANAGER)).rejects.toThrow(congelado)

    await expect(service.addEmergencyResource({
      planId, name: "Botiquín", kind: "Botiquín", location: "Oficina técnica",
    }, MANAGER)).rejects.toThrow(congelado)

    await expect(service.addEmergencyContact({
      planId, name: "Mutual", org: "Mutual de Seguridad", phone: "1407",
    }, MANAGER)).rejects.toThrow(congelado)

    // El rechazo es de dominio, no un error de infraestructura filtrado.
    await expect(service.addEmergencyScenario({
      planId, type: "sismo", title: "Sismo de gran magnitud",
      responseProcedure: "Evacuar a zona de seguridad y esperar réplicas antes de reingresar.",
    }, MANAGER)).rejects.toThrow(service.EmergencyDomainError)

    // Y nada se coló: siguen el escenario y el rol del borrador, y un solo recurso.
    const [scenarios, roles, resources, contacts] = await Promise.all([
      getDb().select().from(schema.preventionEmergencyScenarios).where(eq(schema.preventionEmergencyScenarios.planId, planId)),
      getDb().select().from(schema.preventionEmergencyRoles).where(eq(schema.preventionEmergencyRoles.planId, planId)),
      getDb().select().from(schema.preventionEmergencyResources).where(eq(schema.preventionEmergencyResources.planId, planId)),
      getDb().select().from(schema.preventionEmergencyContacts).where(eq(schema.preventionEmergencyContacts.planId, planId)),
    ])
    expect(scenarios).toHaveLength(1)
    expect(roles).toHaveLength(1)
    expect(resources).toHaveLength(1)
    expect(contacts).toHaveLength(0)
  })

  it("schedules a drill only once the plan is approved", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    const drill = await service.scheduleEmergencyDrill({
      planId, scenarioType: "incendio_estructural", scheduledFor: DRILL_SCHEDULED_FOR,
    }, EXECUTOR)
    drillId = drill.id
    drillVersion = drill.version
    expect(drill.status).toBe("scheduled")
  })

  /* El gate de "esto realmente ocurrió" era la lista de participantes: se
   * escribía y ninguna consulta la leía. Desde el 2026-09-19 lo es el acta, y
   * con ella se fueron los cuatro casos que validaban la dotación. */
  it("refuses to complete a drill without any evidence", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    await expect(service.completeEmergencyDrill({
      drillId, expectedVersion: drillVersion,
      executedAt: DRILL_EXECUTED_AT,
      outcome: "satisfactory",
    }, EXECUTOR)).rejects.toThrow(/evidencia/)
  })

  /** El acta que habilita el cierre. Se inserta directo porque la subida real
   *  escribe en disco, y lo que este archivo protege es la regla, no el I/O. */
  async function attachDrillEvidence(suffix: string, targetDrillId: string = drillId) {
    await getDb().insert(schema.preventionEmergencyDrillEvidence).values({
      id: `drill-evidence-${suffix}`,
      drillId: targetDrillId,
      fileName: `acta-simulacro-${suffix}.pdf`,
      storagePath: `storage/prevention-drill-evidence/acta-${suffix}.pdf`,
      mimeType: "application/pdf",
      fileSizeBytes: 256,
      sha256: "c".repeat(64),
      state: "active",
      uploadedByUserId: "em-manager",
    })
  }

  it("completes a drill that needs improvement, deriving a CAPA action with responsible and target date", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    await attachDrillEvidence("capa")
    const completed = await service.completeEmergencyDrill({
      drillId, expectedVersion: drillVersion,
      executedAt: DRILL_EXECUTED_AT,
      durationMinutes: 12,
      evacuationSeconds: 240,
      observations: "La ruta de evacuación del sector B estaba parcialmente obstruida.",
      outcome: "needs_improvement",
      responsibleUserId: "em-manager",
      targetDate: "2026-10-15",
    }, EXECUTOR)
    expect(completed.status).toBe("completed")
    expect(completed.capaActionId).toBeTruthy()

    const capa = await getDb().select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.sourceType, "emergency"))
    expect(capa).toHaveLength(1)
    expect(capa[0]?.sourceId).toBe(drillId)
    expect(capa[0]?.worksiteId).toBe("ws-em-a")
    expect(capa[0]?.targetDate).toBe("2026-10-15")
  })

  it("rejects completing the same drill twice", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    await expect(service.completeEmergencyDrill({
      drillId, expectedVersion: 99,
      executedAt: DRILL_EXECUTED_AT,
      outcome: "satisfactory",
    }, EXECUTOR)).rejects.toThrow()
  })

  it("does not leak plans of another worksite", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    expect(await service.listEmergencyPlans(OUTSIDER)).toEqual([])
    expect(await service.getEmergencyPlanDetail(planId, OUTSIDER)).toBeNull()
  })

  /* ── EMERGENCIAS-06 · el simulacro se realizó, no se realizará ───────────── */

  it("refuses a drill executed in the future or before the date it was scheduled for", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    const scheduledFor = iso(-3 * HORA)
    const drill = await service.scheduleEmergencyDrill({
      planId, scenarioType: "derrame", scheduledFor,
    }, EXECUTOR)

    const base = {
      drillId: drill.id, expectedVersion: drill.version,
      outcome: "satisfactory" as const,
    }

    // Antes se aceptaba cualquier instante: un simulacro "realizado" el año que
    // viene acreditaba una actividad del PDTP con fecha futura.
    await expect(service.completeEmergencyDrill({ ...base, executedAt: iso(30 * DIA) }, EXECUTOR))
      .rejects.toThrow(/no puede haberse realizado en el futuro/)

    // Y tampoco antes de la fecha para la que se programó.
    await expect(service.completeEmergencyDrill({ ...base, executedAt: iso(-4 * HORA) }, EXECUTOR))
      .rejects.toThrow(/antes de la fecha para la que fue programado/)

    // Nada de eso dejó el simulacro tocado.
    const [pendiente] = await getDb().select().from(schema.preventionEmergencyDrills)
      .where(eq(schema.preventionEmergencyDrills.id, drill.id))
    expect(pendiente?.status).toBe("scheduled")
    expect(pendiente?.executedAt).toBeNull()

    // El borde de abajo es inclusivo: realizarlo justo a la hora programada vale.
    const completado = await service.completeEmergencyDrill({ ...base, executedAt: scheduledFor }, EXECUTOR)
    expect(completado.status).toBe("completed")
  })

  /* ── EMERGENCIAS-05 · el simulacro acredita el programa anual ────────────── */

  it("declares which PDTP activities the drills accredit, deduplicated and sorted, and carries them to the connector", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    const connectors = await import("@/lib/services/pdtp-adapters/pdtp-accreditation-connectors")
    const accredit = vi.mocked(connectors.onEmergencyDrillCompleted)
    accredit.mockClear()

    // Estado previo: la columna existía y nadie la escribía nunca.
    const [antes] = await getDb().select().from(schema.preventionEmergencyPlans)
      .where(eq(schema.preventionEmergencyPlans.id, planId))
    expect(antes?.pdtpActivityNumbers).toBeNull()

    await expect(service.setEmergencyPlanPdtpActivities({
      planId, expectedVersion: 99, pdtpActivityNumbers: [84],
    }, MANAGER)).rejects.toThrow(/cambió mientras/)

    // El plan está APROBADO y aun así admite el cableado: los simulacros sólo
    // existen sobre un plan aprobado, y esto no es contenido del documento.
    const conCableado = await service.setEmergencyPlanPdtpActivities({
      planId, expectedVersion: planVersion, pdtpActivityNumbers: [84, 83, 84],
    }, MANAGER)
    planVersion = conCableado.version
    expect(conCableado.status).toBe("approved")
    expect(conCableado.pdtpActivityNumbers).toEqual([83, 84])

    const historia = await getDb().select().from(schema.preventionEmergencyHistory)
      .where(eq(schema.preventionEmergencyHistory.entityId, planId))
      .orderBy(asc(schema.preventionEmergencyHistory.createdAt))
    expect(historia.map((row) => row.changeType)).toContain("pdtp_activities_set")

    // La prueba del hallazgo: completar un simulacro ahora SÍ llega al motor de
    // acreditación. Antes el conector era código inalcanzable.
    const drill = await service.scheduleEmergencyDrill({
      planId, scenarioType: "sismo", scheduledFor: iso(-2 * HORA),
    }, EXECUTOR)
    await attachDrillEvidence("acreditacion", drill.id)
    await service.completeEmergencyDrill({
      drillId: drill.id, expectedVersion: drill.version, executedAt: iso(-1 * HORA),
      outcome: "satisfactory",
    }, EXECUTOR)

    expect(accredit).toHaveBeenCalledTimes(1)
    expect(accredit.mock.calls[0]![0]).toMatchObject({
      drillId: drill.id, worksiteId: "ws-em-a", activityNumbers: [83, 84],
    })

    // Y vaciarlo vuelve a apagar la acreditación, sin dejar un array vacío.
    const sinCableado = await service.setEmergencyPlanPdtpActivities({
      planId, expectedVersion: planVersion, pdtpActivityNumbers: [],
    }, MANAGER)
    planVersion = sinCableado.version
    expect(sinCableado.pdtpActivityNumbers).toBeNull()

    accredit.mockClear()
    const mudo = await service.scheduleEmergencyDrill({
      planId, scenarioType: "nevada", scheduledFor: iso(-2 * HORA),
    }, EXECUTOR)
    await attachDrillEvidence("mudo", mudo.id)
    await service.completeEmergencyDrill({
      drillId: mudo.id, expectedVersion: mudo.version, executedAt: iso(-1 * HORA),
      outcome: "satisfactory",
    }, EXECUTOR)
    expect(accredit).not.toHaveBeenCalled()

    // Se restituye para que el resto de la suite vea el plan cableado.
    const restituido = await service.setEmergencyPlanPdtpActivities({
      planId, expectedVersion: planVersion, pdtpActivityNumbers: [84],
    }, MANAGER)
    planVersion = restituido.version
  })

  /* ── EMERGENCIAS-11 · el tope se aplica después del filtro por faena ─────── */

  it("scopes the drill roster to the plan's worksite in SQL, not in memory", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    const GLOBAL = { userId: "em-approver", scope: { mode: "all", ids: [] } as WorksiteScope, permissions: ["prevention:emergency:view"] }

    // Con alcance global y sin faena, la consulta trae toda la dotación activa:
    // es ahí donde el tope truncaba a unas faenas y a otras no.
    const todas = await service.listEmergencyWorkers(GLOBAL)
    expect(todas.map((worker) => worker.worksiteId)).toContain("ws-em-b")

    const deLaFaena = await service.listEmergencyWorkers(GLOBAL, "ws-em-a")
    expect(deLaFaena.map((worker) => worker.id).sort()).toEqual(["wk-a1", "wk-a2", "wk-a3"])

    // Una faena fuera del alcance no devuelve dotación ajena.
    expect(await service.listEmergencyWorkers(MANAGER, "ws-em-b")).toEqual([])
  })

  /* ── EMERGENCIAS-04 · el inventario deja de ser de sólo alta ─────────────── */

  async function emergencyAttention() {
    const { getPreventionAttention } = await import("@/lib/services/prevention-attention")
    const items = await getPreventionAttention({
      worksiteIds: ["ws-em-a"],
      includeActions: false,
      includeEvaluations: false,
      includePpa: false,
      includeEmergencyResources: true,
    })
    return items.filter((item) => item.id === `emergency_resource:${resourceId}`)
  }

  /**
   * EMERGENCIAS-08: el bloque de vencimientos era todo-o-nada. `includeCompliance`
   * mezclaba dos fuentes con permisos distintos, así que quien sólo veía Higiene
   * recibía además el inventario de emergencia de la faena — y al revés.
   */
  it("keeps each expiry source behind its own permission flag", async () => {
    const { getPreventionAttention } = await import("@/lib/services/prevention-attention")
    const base = {
      worksiteIds: ["ws-em-a"],
      includeActions: false, includeEvaluations: false, includePpa: false,
    }

    // El equipo está vencido y aun así no aparece si sólo se encendió higiene.
    const soloHigiene = await getPreventionAttention({ ...base, includeProtocols: true })
    expect(soloHigiene.filter((item) => item.kind === "emergency_resource")).toEqual([])

    const soloEmergencias = await getPreventionAttention({ ...base, includeEmergencyResources: true })
    expect(soloEmergencias.filter((item) => item.kind === "emergency_resource")).toHaveLength(1)
    expect(soloEmergencias.filter((item) => item.kind === "protocol")).toEqual([])

    // Sin ninguna fuente encendida no se consulta nada.
    expect(await getPreventionAttention(base)).toEqual([])
  })

  it("updating a resource takes it out of the prevention attention inbox", async () => {
    const service = await import("@/lib/services/prevention-emergency")

    // Antes: el equipo vencido no tenía forma de actualizarse, así que el aviso
    // se quedaba encendido para siempre.
    expect(await emergencyAttention()).toHaveLength(1)

    // El plan ya está aprobado y aun así el equipo se mantiene: pertenece a la
    // faena, no al documento.
    const updated = await service.updateEmergencyResource({
      resourceId,
      name: "Extintor PQS 10 kg", kind: "Extintor", location: "Portería",
      lastInspectedAt: "2026-08-01", nextInspectionAt: "2030-01-01", expiresAt: "2030-01-01",
      status: "operational",
    }, MANAGER)
    expect(updated.expiresAt).toBe("2030-01-01")

    expect(await emergencyAttention()).toEqual([])

    const historia = await getDb().select().from(schema.preventionEmergencyHistory)
      .where(eq(schema.preventionEmergencyHistory.entityId, resourceId))
      .orderBy(asc(schema.preventionEmergencyHistory.createdAt))
    expect(historia.map((row) => row.changeType)).toEqual(["added", "updated"])
  })

  it("decommissioning a resource keeps it out of the inbox and counts it as out of service", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    await service.updateEmergencyResource({
      resourceId,
      name: "Extintor PQS 10 kg", kind: "Extintor", location: "Portería",
      // Vuelve a quedar vencido: sin la baja, esto lo devolvería a la bandeja.
      nextInspectionAt: "2020-01-01", expiresAt: "2020-01-01",
      status: "out_of_service",
    }, MANAGER)

    expect(await emergencyAttention()).toEqual([])

    const counts = await service.getEmergencyDashboardCounts(APPROVER)
    expect(counts.totalResources).toBe(1)
    expect(counts.resourcesOutOfService).toBe(1)

    const historia = await getDb().select().from(schema.preventionEmergencyHistory)
      .where(eq(schema.preventionEmergencyHistory.entityId, resourceId))
      .orderBy(asc(schema.preventionEmergencyHistory.createdAt))
    expect(historia.map((row) => row.changeType)).toEqual(["added", "updated", "decommissioned"])
  })

  it("refuses to update a resource of a worksite outside the scope", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    await expect(service.updateEmergencyResource({
      resourceId, name: "Extintor ajeno", kind: "Extintor", location: "Portería", status: "operational",
    }, OUTSIDER)).rejects.toThrow(/fuera de alcance/)
  })

  /* ── EMERGENCIAS-10 · cancelar un simulacro programado ───────────────────── */

  it("cancels a scheduled drill with a reason, bumping its version and leaving history", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    const programado = await service.scheduleEmergencyDrill({
      planId, scenarioType: "sismo", scheduledFor: SECOND_DRILL_SCHEDULED_FOR,
    }, EXECUTOR)
    expect(programado.version).toBe(1)

    await expect(service.cancelEmergencyDrill({
      drillId: programado.id, expectedVersion: 99, reason: "Se suspendió por alerta meteorológica.",
    }, EXECUTOR)).rejects.toThrow(/cambió mientras/)

    const cancelado = await service.cancelEmergencyDrill({
      drillId: programado.id, expectedVersion: programado.version,
      reason: "Se suspendió por alerta meteorológica en la faena.",
    }, EXECUTOR)
    expect(cancelado.status).toBe("cancelled")
    expect(cancelado.version).toBe(programado.version + 1)

    const historia = await getDb().select().from(schema.preventionEmergencyHistory)
      .where(eq(schema.preventionEmergencyHistory.entityId, programado.id))
      .orderBy(asc(schema.preventionEmergencyHistory.createdAt))
    expect(historia.map((row) => row.changeType)).toEqual(["scheduled", "cancelled"])
    expect(historia[1]?.reason).toBe("Se suspendió por alerta meteorológica en la faena.")

    // Un simulacro cancelado ya no vuelve a cancelarse ni a completarse.
    await expect(service.cancelEmergencyDrill({
      drillId: programado.id, expectedVersion: cancelado.version, reason: "Motivo suficientemente largo.",
    }, EXECUTOR)).rejects.toThrow(/programado puede cancelarse/)
    await expect(service.completeEmergencyDrill({
      drillId: programado.id, expectedVersion: cancelado.version,
      executedAt: SECOND_DRILL_EXECUTED_AT, outcome: "satisfactory",
    }, EXECUTOR)).rejects.toThrow(/programado puede completarse/)
  })

  /* ── EMERGENCIAS-02 · archivar libera la faena para el plan siguiente ────── */

  it("blocks a second live plan for the worksite while the first one is not archived", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    // Con mensaje de dominio, no el error crudo del índice único.
    const attempt = service.createEmergencyPlan({
      worksiteId: "ws-em-a", title: "Plan de emergencia 2027",
    }, MANAGER)
    await expect(attempt).rejects.toThrow(service.EmergencyDomainError)
    await expect(attempt).rejects.toThrow(/ya tiene el plan PE-\d{4}-\w+ vigente/)
  })

  it("archives the plan with a reason and frees the worksite for the next plan", async () => {
    const service = await import("@/lib/services/prevention-emergency")

    await expect(service.archiveEmergencyPlan({
      planId, expectedVersion: planVersion, reason: "Corto",
    }, APPROVER)).rejects.toThrow()

    await expect(service.archiveEmergencyPlan({
      planId, expectedVersion: 99, reason: "Cierre del período anual del plan.",
    }, APPROVER)).rejects.toThrow(/cambió mientras/)

    // Archivar pesa lo mismo que aprobar: administrar el plan no alcanza.
    await expect(service.archiveEmergencyPlan({
      planId, expectedVersion: planVersion, reason: "Cierre del período anual del plan.",
    }, MANAGER)).rejects.toThrow(/fuera de alcance/)

    const archivado = await service.archiveEmergencyPlan({
      planId, expectedVersion: planVersion, reason: "Cierre del período anual del plan.",
    }, APPROVER)
    expect(archivado.status).toBe("archived")
    expect(archivado.version).toBe(planVersion + 1)

    const historia = await getDb().select().from(schema.preventionEmergencyHistory)
      .where(eq(schema.preventionEmergencyHistory.entityId, planId))
      .orderBy(asc(schema.preventionEmergencyHistory.createdAt))
    // El ciclo de vida del plan, aislado de las entradas de cableado al PDTP
    // que EMERGENCIAS-05 intercala en medio (`pdtp_activities_set`): lo que esta
    // prueba fija es que archivar deja su marca al final, no el largo total del
    // historial.
    expect(historia.map((row) => row.changeType).filter((type) => type !== "pdtp_activities_set"))
      .toEqual(["created", "approved", "archived"])
    expect(historia.at(-1)?.changeType).toBe("archived")
    expect(historia.at(-1)?.reason).toBe("Cierre del período anual del plan.")

    // La prueba del hallazgo: el índice parcial quedó libre y la faena puede
    // emitir el plan del período siguiente.
    const siguiente = await service.createEmergencyPlan({
      worksiteId: "ws-em-a", title: "Plan de emergencia 2027",
    }, MANAGER)
    expect(siguiente.status).toBe("draft")
    expect(siguiente.worksiteId).toBe("ws-em-a")
    expect(siguiente.id).not.toBe(planId)

    // Y el inventario de la faena sobrevivió al cambio de plan.
    const resources = await getDb().select().from(schema.preventionEmergencyResources)
    expect(resources).toHaveLength(1)
    expect(resources[0]?.worksiteId).toBe("ws-em-a")

    await expect(service.archiveEmergencyPlan({
      planId, expectedVersion: archivado.version, reason: "Cierre del período anual del plan.",
    }, APPROVER)).rejects.toThrow(/ya está archivado/)
  })
})

async function seedFixture(database: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date().toISOString()
  await database.insert(schema.worksites).values([
    { id: "ws-em-a", name: "Faena Norte", code: "EM-A", createdAt: now, updatedAt: now },
    { id: "ws-em-b", name: "Faena Sur", code: "EM-B", createdAt: now, updatedAt: now },
  ])
  await database.insert(schema.workers).values([
    { id: "wk-a1", rut: "11111111-1", firstName: "Ana", lastName: "Pérez", worksiteId: "ws-em-a", createdAt: now },
    { id: "wk-a2", rut: "22222222-2", firstName: "Bruno", lastName: "Soto", worksiteId: "ws-em-a", createdAt: now },
    { id: "wk-a3", rut: "33333333-3", firstName: "Carla", lastName: "Díaz", worksiteId: "ws-em-a", createdAt: now },
    // Pertenece a la faena A pero está inactivo: aísla la vigencia de la
    // pertenencia a la faena como motivo de rechazo.
    { id: "wk-a4", rut: "44444444-4", firstName: "Diego", lastName: "Rojas", worksiteId: "ws-em-a", isActive: false, createdAt: now },
    { id: "wk-b1", rut: "66666666-6", firstName: "Felipe", lastName: "Vera", worksiteId: "ws-em-b", createdAt: now },
  ])
  await database.insert(schema.users).values([
    { id: "em-manager", name: "Gestor de Emergencias", email: "em-manager@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "em-approver", name: "Aprobador", email: "em-approver@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "em-executor", name: "Ejecutor de simulacros", email: "em-executor@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "em-outsider", name: "Ajeno", email: "em-outsider@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
  ])
}

async function resetDatabase(url: string) {
  const setupClient = postgres(url, { max: 1, onnotice: () => undefined })
  const setupDb = drizzle(setupClient)
  try {
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`)
    await setupDb.execute(sql`CREATE SCHEMA public`)
    await setupDb.execute(sql`CREATE SCHEMA drizzle`)
    await setupDb.execute(sql`GRANT ALL ON SCHEMA public TO PUBLIC`)
  } finally { await setupClient.end() }
}

async function ensureDatabaseExists(url: string) {
  const databaseName = getDatabaseNameFromUrl(url)
  const maintenanceClient = postgres(getMaintenanceDatabaseUrl(url), { max: 1, onnotice: () => undefined })
  try {
    const rows = await maintenanceClient<{ exists: number }[]>`SELECT 1 AS exists FROM pg_database WHERE datname = ${databaseName} LIMIT 1`
    if (rows.length === 0) await maintenanceClient.unsafe(`CREATE DATABASE ${quotePostgresIdentifier(databaseName)}`)
  } finally { await maintenanceClient.end() }
}
