/** Real PostgreSQL proof for work permits, JSA, LOTO isolation and crew eligibility. */
import path from "node:path"
import postgres from "postgres"
import { eq, sql } from "drizzle-orm"
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

const databaseUrl = process.env.PREVENTION_PERMITS_DATABASE_URL
const canReset = process.env.PREVENTION_PERMITS_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canReset ? describe : describe.skip
const previousDatabaseUrl = process.env.DATABASE_URL
let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined

const scopeA = { mode: "some", ids: ["ws-pm-a"] } as WorksiteScope
const ALL = [
  "prevention:permits:view", "prevention:permits:manage", "prevention:permits:request",
  "prevention:permits:verify", "prevention:permits:approve", "prevention:permits:activate",
  "prevention:permits:suspend", "prevention:permits:close",
]
const REQUESTER = { userId: "pm-requester", scope: scopeA, permissions: ["prevention:permits:view", "prevention:permits:manage", "prevention:permits:request", "prevention:permits:verify"] }
const APPROVER = { userId: "pm-approver", scope: scopeA, permissions: ALL }
const OUTSIDER = { userId: "pm-outsider", scope: { mode: "some", ids: ["ws-pm-b"] } as WorksiteScope, permissions: ALL }

/**
 * Ventana planificada del permiso, relativa al reloj.
 *
 * Estaba fija en 2026-08-01: el 2026-08-05 venció sola y `evaluatePermitGates`
 * empezó a devolver el blocker `window_expired` en todos los escenarios, que
 * nada tenían que ver con la vigencia. Un permiso se pide para trabajo que
 * todavía no ocurre, así que la ventana tiene que ser futura por construcción y
 * no por la fecha en que se escribió la prueba. El caso de la ventana vencida
 * se cubre aparte, fijando fechas de 2020 explícitamente.
 */
function plannedWindow(durationHours: number) {
  const start = new Date(Date.now() + 60 * 60 * 1000)
  const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000)
  return { plannedStartAt: start.toISOString(), plannedEndAt: end.toISOString() }
}

function getDb() {
  if (!testDb) throw new Error("Test database not initialised")
  return testDb
}

describeIf("Permisos de trabajo on real PostgreSQL", () => {
  let confinedTypeId = ""
  let permitId = ""
  let permitVersion = 1

  beforeAll(async () => {
    assertSafeDestructiveDatabase({ databaseUrl: databaseUrl!, allowDestructiveReset: canReset, context: "PREVENTION_PERMITS" })
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

  it("rejects a permit type that requires measurements without declaring their validity", async () => {
    const service = await import("@/lib/services/prevention-permits")
    await expect(service.createPermitType({
      code: "BAD", name: "Tipo inválido", requiresMeasurement: true,
      legalBasis: "Prueba de validación de parámetros.",
    }, REQUESTER)).rejects.toThrow()
  })

  it("creates a confined-space permit type tied to a competency task key", async () => {
    const service = await import("@/lib/services/prevention-permits")
    const type = await service.createPermitType({
      code: "ESP-CONF", name: "Espacio confinado",
      competencyTaskKey: "espacio-confinado",
      requiresIsolation: true, requiresMeasurement: true, requiresJsa: true,
      measurementValidityMinutes: 60, maxDurationHours: 8,
      legalBasis: "DS 44 art. 18 y estándar interno de tareas críticas.",
    }, REQUESTER)
    confinedTypeId = type.id
  })

  it("refuses a window longer than the permit type allows", async () => {
    const service = await import("@/lib/services/prevention-permits")
    await expect(service.createWorkPermit({
      permitTypeId: confinedTypeId, worksiteId: "ws-pm-a",
      taskDescription: "Limpieza interior de estanque de residuos industriales.",
      location: "Estanque TK-01", supervisorUserId: "pm-approver",
      ...plannedWindow(24),
      crew: [], controls: [],
    }, REQUESTER)).rejects.toThrow(/supera el máximo/)
  })

  it("refuses crew from another worksite", async () => {
    const service = await import("@/lib/services/prevention-permits")
    await expect(service.createWorkPermit({
      permitTypeId: confinedTypeId, worksiteId: "ws-pm-a",
      taskDescription: "Limpieza interior de estanque de residuos industriales.",
      location: "Estanque TK-01", supervisorUserId: "pm-approver",
      ...plannedWindow(6),
      crew: [{ workerId: "wk-b1", role: "executor" }], controls: [],
    }, REQUESTER)).rejects.toThrow(/otra faena/)
  })

  it("denies permit creation from a foreign worksite scope", async () => {
    const service = await import("@/lib/services/prevention-permits")
    await expect(service.createWorkPermit({
      permitTypeId: confinedTypeId, worksiteId: "ws-pm-a",
      taskDescription: "Intento desde alcance ajeno a la faena.",
      location: "Estanque TK-01", supervisorUserId: "pm-approver",
      ...plannedWindow(6),
      crew: [], controls: [],
    }, OUTSIDER)).rejects.toThrow(/fuera de alcance/)
  })

  it("creates the permit with crew and mandatory controls", async () => {
    const service = await import("@/lib/services/prevention-permits")
    const permit = await service.createWorkPermit({
      permitTypeId: confinedTypeId, worksiteId: "ws-pm-a",
      taskDescription: "Limpieza interior de estanque de residuos industriales.",
      location: "Estanque TK-01", supervisorUserId: "pm-approver",
      ...plannedWindow(6),
      crew: [
        { workerId: "wk-a1", role: "executor" },
        { workerId: "wk-a2", role: "standby" },
      ],
      controls: [
        { description: "Ventilación forzada activa", isMandatory: true },
        { description: "Equipo de rescate en posición", isMandatory: true },
        { description: "Iluminación adicional", isMandatory: false },
      ],
    }, REQUESTER)
    permitId = permit.id
    permitVersion = permit.version
    expect(permit.status).toBe("draft")
  })

  it("lists every blocker at once instead of one at a time", async () => {
    const service = await import("@/lib/services/prevention-permits")
    const readiness = await service.evaluatePermitReadiness(permitId, REQUESTER)
    expect(readiness.allowed).toBe(false)
    const kinds = new Set(readiness.blockers.map((item) => item.kind))
    // Controles sin verificar, sin aislamiento, sin medición, sin AST y
    // competencia faltante, todos a la vez.
    expect(kinds).toEqual(new Set([
      "control_pending", "isolation_missing", "measurement_missing",
      "jsa_missing", "crew_competency",
    ]))
  })

  it("refuses to jump straight from draft to active", async () => {
    const service = await import("@/lib/services/prevention-permits")
    await expect(service.transitionWorkPermit({
      permitId, expectedVersion: permitVersion, toStatus: "active",
      reason: "Intento de habilitar el trabajo saltándose la aprobación.",
    }, APPROVER)).rejects.toThrow(/Transición de permiso inválida: draft → active/)
  })

  it("writes the JSA while the permit is still a draft", async () => {
    const service = await import("@/lib/services/prevention-permits")
    await service.saveJsaSteps({
      permitId,
      steps: [
        { stepOrder: 1, stepDescription: "Aislar y bloquear energías del estanque", hazards: ["Energía residual"], controls: ["LOTO aplicado y verificado"], residualRisk: "low" },
        { stepOrder: 2, stepDescription: "Medir atmósfera antes de ingresar", hazards: ["Atmósfera deficiente en oxígeno"], controls: ["Medición con equipo calibrado"], residualRisk: "medium" },
      ],
    }, REQUESTER)
    const steps = await getDb().select().from(schema.preventionJsaSteps)
      .where(eq(schema.preventionJsaSteps.permitId, permitId))
    expect(steps).toHaveLength(2)
  })

  it("blocks the requester from approving their own permit", async () => {
    const service = await import("@/lib/services/prevention-permits")
    const submitted = await service.transitionWorkPermit({
      permitId, expectedVersion: permitVersion, toStatus: "pending_approval",
      reason: "Permiso completo y enviado a aprobación de prevención.",
    }, REQUESTER)
    permitVersion = submitted.version

    await expect(service.transitionWorkPermit({
      permitId, expectedVersion: permitVersion, toStatus: "approved",
      reason: "Intento de autoaprobación por el solicitante.",
    }, { ...REQUESTER, permissions: [...REQUESTER.permissions, "prevention:permits:approve"] }))
      .rejects.toThrow(/no puede aprobarlo/)

    const approved = await service.transitionWorkPermit({
      permitId, expectedVersion: permitVersion, toStatus: "approved",
      reason: "Revisión documental y de controles conforme al estándar.",
    }, APPROVER)
    permitVersion = approved.version
  })

  it("refuses to edit the JSA once the permit is approved", async () => {
    const service = await import("@/lib/services/prevention-permits")
    await expect(service.saveJsaSteps({
      permitId,
      steps: [{ stepOrder: 1, stepDescription: "Paso alterado después de la aprobación", hazards: ["Peligro agregado sin revisión"], controls: ["Control agregado sin revisión"], residualRisk: "low" }],
    }, REQUESTER)).rejects.toThrow(/no esté aprobado/)
  })

  it("will not activate while the crew is not eligible", async () => {
    const service = await import("@/lib/services/prevention-permits")
    await expect(service.transitionWorkPermit({
      permitId, expectedVersion: permitVersion, toStatus: "active",
      reason: "Intento de habilitar con la cuadrilla sin habilitar.",
    }, APPROVER)).rejects.toThrow(/no puede habilitarse/)
  })

  it("clears the field blockers: controls, isolation, measurement and competency", async () => {
    const service = await import("@/lib/services/prevention-permits")

    const controls = await getDb().select().from(schema.preventionPermitControls)
      .where(eq(schema.preventionPermitControls.permitId, permitId))
    for (const control of controls.filter((item) => item.isMandatory)) {
      await service.verifyPermitControl({ controlId: control.id, verified: true }, REQUESTER)
    }

    const isolation = await service.addPermitIsolation({
      permitId, energySource: "electrical", equipmentTag: "TK-01-BOMBA",
      isolationMethod: "Apertura y bloqueo de interruptor principal", lockTagId: "LOTO-0091",
    }, REQUESTER)
    await service.applyPermitIsolation({ isolationId: isolation.id, verifiedZeroEnergy: true }, REQUESTER)

    await service.addPermitMeasurement({
      permitId, parameter: "O2", value: 20.9, unit: "%", acceptableMin: 19.5, acceptableMax: 23.5,
      equipmentTag: "GAS-07", calibrationDate: "2026-07-01", takenAt: new Date().toISOString(),
    }, REQUESTER)

    // Habilitación de personas: se otorga la competencia faltante.
    await getDb().insert(schema.preventionWorkerCompetencies).values([
      { id: "comp-a1", workerId: "wk-a1", courseId: "course-conf", sourceType: "external_certificate", grantedAt: "2026-07-01", expiresAt: "2028-07-01", status: "valid", evidenceReference: "cert-1", externalIssuer: "OTEC", createdByUserId: "pm-approver" },
      { id: "comp-a2", workerId: "wk-a2", courseId: "course-conf", sourceType: "external_certificate", grantedAt: "2026-07-01", expiresAt: "2028-07-01", status: "valid", evidenceReference: "cert-2", externalIssuer: "OTEC", createdByUserId: "pm-approver" },
    ])

    const readiness = await service.evaluatePermitReadiness(permitId, REQUESTER)
    expect(readiness).toEqual({ allowed: true, blockers: [] })
  })

  it("rejects an activation carrying the version read before the field mutations (TOCTOU)", async () => {
    const service = await import("@/lib/services/prevention-permits")
    // `permitVersion` es la versión leída al aprobar, antes de verificar
    // controles y registrar aislamiento y medición: activar con ella habilitaría
    // el permiso sobre una evaluación que ya no corresponde al expediente.
    await expect(service.transitionWorkPermit({
      permitId, expectedVersion: permitVersion, toStatus: "active",
      reason: "Activación con la versión previa a las mutaciones de terreno.",
    }, APPROVER)).rejects.toThrow(/cambió mientras/)

    const [current] = await getDb().select().from(schema.preventionWorkPermits)
      .where(eq(schema.preventionWorkPermits.id, permitId))
    expect(current!.version).toBeGreaterThan(permitVersion)
    permitVersion = current!.version
  })

  it("activates the permit once every gate is satisfied", async () => {
    const service = await import("@/lib/services/prevention-permits")
    const activated = await service.transitionWorkPermit({
      permitId, expectedVersion: permitVersion, toStatus: "active",
      reason: "Todos los controles verificados y cuadrilla habilitada en terreno.",
    }, APPROVER)
    permitVersion = activated.version
    expect(activated).toMatchObject({ status: "active", activatedByUserId: "pm-approver" })
  })

  it("refuses to remove an isolation while the permit is live", async () => {
    const service = await import("@/lib/services/prevention-permits")
    const [isolation] = await getDb().select().from(schema.preventionPermitIsolations)
      .where(eq(schema.preventionPermitIsolations.permitId, permitId))
    await expect(service.removePermitIsolation({
      isolationId: isolation!.id, reason: "Intento de retirar bloqueo con el trabajo en curso.",
    }, REQUESTER)).rejects.toThrow(/permiso vigente/)
  })

  it("refuses to close the permit while an isolation is still applied", async () => {
    const service = await import("@/lib/services/prevention-permits")
    await expect(service.transitionWorkPermit({
      permitId, expectedVersion: permitVersion, toStatus: "closed",
      reason: "Intento de cerrar el permiso con energías aún bloqueadas.",
    }, APPROVER)).rejects.toThrow(/aislamiento\(s\) aplicados sin retirar/)
  })

  it("suspends, removes the isolation and closes cleanly", async () => {
    const service = await import("@/lib/services/prevention-permits")
    const suspended = await service.transitionWorkPermit({
      permitId, expectedVersion: permitVersion, toStatus: "suspended",
      reason: "Trabajo terminado; se procede a normalizar energías.",
    }, APPROVER)
    permitVersion = suspended.version

    const [isolation] = await getDb().select().from(schema.preventionPermitIsolations)
      .where(eq(schema.preventionPermitIsolations.permitId, permitId))
    await service.removePermitIsolation({ isolationId: isolation!.id, reason: "Normalización de energía verificada." }, REQUESTER)
    // Retirar el aislamiento también mueve la versión del permiso.
    const [afterRemoval] = await getDb().select().from(schema.preventionWorkPermits)
      .where(eq(schema.preventionWorkPermits.id, permitId))
    expect(afterRemoval!.version).toBeGreaterThan(permitVersion)
    permitVersion = afterRemoval!.version

    const closed = await service.transitionWorkPermit({
      permitId, expectedVersion: permitVersion, toStatus: "closed",
      reason: "Permiso cerrado con área normalizada y sin desviaciones.",
    }, APPROVER)
    permitVersion = closed.version
    expect(closed.status).toBe("closed")

    const history = await getDb().select().from(schema.preventionPermitHistory)
      .where(eq(schema.preventionPermitHistory.permitId, permitId))
    expect(history.length).toBeGreaterThanOrEqual(6)
  })

  it("rejects a stale expectedVersion", async () => {
    const service = await import("@/lib/services/prevention-permits")
    await expect(service.transitionWorkPermit({
      permitId, expectedVersion: 1, toStatus: "closed", reason: "Reintento con versión antigua del permiso.",
    }, APPROVER)).rejects.toThrow(/cambió mientras|inválida/)
  })

  it("does not leak permits of another worksite", async () => {
    const service = await import("@/lib/services/prevention-permits")
    expect(await service.listWorkPermits(OUTSIDER)).toEqual([])
    expect(await service.getWorkPermitDetail(permitId, OUTSIDER)).toBeNull()
  })

  it("auto-suspends an active permit whose window has expired", async () => {
    const service = await import("@/lib/services/prevention-permits")
    const permit = await service.createWorkPermit({
      permitTypeId: confinedTypeId, worksiteId: "ws-pm-a",
      taskDescription: "Permiso de prueba para vencimiento automático de ventana.",
      location: "Estanque TK-02", supervisorUserId: "pm-approver",
      ...plannedWindow(6),
      crew: [], controls: [],
    }, REQUESTER)
    const submitted = await service.transitionWorkPermit({ permitId: permit.id, expectedVersion: permit.version, toStatus: "pending_approval", reason: "Enviado para probar vencimiento de ventana." }, REQUESTER)
    const approved = await service.transitionWorkPermit({ permitId: permit.id, expectedVersion: submitted.version, toStatus: "approved", reason: "Aprobado para probar vencimiento automático." }, APPROVER)

    await getDb().update(schema.preventionWorkPermits)
      .set({ plannedStartAt: "2020-01-01T00:00:00.000Z", plannedEndAt: "2020-01-01T06:00:00.000Z" })
      .where(eq(schema.preventionWorkPermits.id, permit.id))

    const result = await service.suspendExpiredPermits()
    expect(result.suspended).toBeGreaterThanOrEqual(1)
    const [after] = await getDb().select().from(schema.preventionWorkPermits)
      .where(eq(schema.preventionWorkPermits.id, permit.id))
    expect(after).toMatchObject({ status: "suspended" })
    expect(after!.suspensionReason).toMatch(/venció/)
    // La suspensión automática no tiene actor humano: atribuírsela al supervisor
    // falsearía el registro. El CHECK relajado de la base es lo que se prueba acá.
    expect(after!.suspendedByUserId).toBeNull()
    expect(approved.status).toBe("approved")
  })
})

async function seedFixture(database: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date().toISOString()
  await database.insert(schema.worksites).values([
    { id: "ws-pm-a", name: "Faena Norte", code: "PM-A", createdAt: now, updatedAt: now },
    { id: "ws-pm-b", name: "Faena Sur", code: "PM-B", createdAt: now, updatedAt: now },
  ])
  await database.insert(schema.workers).values([
    { id: "wk-a1", rut: "11111111-1", firstName: "Ana", lastName: "Pérez", position: "Operadora", worksiteId: "ws-pm-a", createdAt: now },
    { id: "wk-a2", rut: "22222222-2", firstName: "Bruno", lastName: "Soto", position: "Vigía", worksiteId: "ws-pm-a", createdAt: now },
    { id: "wk-b1", rut: "33333333-3", firstName: "Carla", lastName: "Díaz", position: "Operadora", worksiteId: "ws-pm-b", createdAt: now },
  ])
  await database.insert(schema.users).values([
    { id: "pm-requester", name: "Solicitante", email: "pm-requester@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "pm-approver", name: "Aprobador", email: "pm-approver@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "pm-outsider", name: "Ajeno", email: "pm-outsider@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
  ])
  // Curso y requisito de competencia con alcance `task`, que es el enlace que
  // usa el tipo de permiso para exigir habilitación.
  await database.insert(schema.preventionTrainingCourses).values({
    id: "course-conf", code: "CONF-01", name: "Trabajo en espacio confinado", kind: "certification",
    minimumDurationMinutes: 480, validityMonths: 24, requiresAssessment: true, passingScore: 70,
    createdByUserId: "pm-approver", createdAt: now, updatedAt: now,
  })
  await database.insert(schema.preventionCompetencyRequirements).values({
    id: "req-conf", courseId: "course-conf", scopeType: "task", scopeValue: "espacio-confinado",
    enforcement: "blocking", reason: "Tarea crítica: exige certificación vigente de espacio confinado.",
    createdByUserId: "pm-approver", createdAt: now, updatedAt: now,
  })
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
