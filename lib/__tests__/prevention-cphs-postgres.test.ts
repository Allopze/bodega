/** Real PostgreSQL proof for CPHS governance: parity, quorum, minutes and management review. */
import path from "node:path"
import postgres from "postgres"
import { and, eq, sql } from "drizzle-orm"
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

const databaseUrl = process.env.PREVENTION_CPHS_DATABASE_URL
const canReset = process.env.PREVENTION_CPHS_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canReset ? describe : describe.skip
const previousDatabaseUrl = process.env.DATABASE_URL
let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined

const scopeA = { mode: "some", ids: ["ws-cp-a"] } as WorksiteScope
const MANAGER = { userId: "cp-manager", scope: scopeA, permissions: ["prevention:cphs:view", "prevention:cphs:manage"] }
const DIRECTOR = { userId: "cp-director", scope: { mode: "all", ids: [] } as WorksiteScope, permissions: ["prevention:cphs:view", "prevention:governance:review"] }
const OUTSIDER = { userId: "cp-outsider", scope: { mode: "some", ids: ["ws-cp-b"] } as WorksiteScope, permissions: ["prevention:cphs:view", "prevention:cphs:manage"] }

function getDb() {
  if (!testDb) throw new Error("Test database not initialised")
  return testDb
}

describeIf("CPHS y gobernanza on real PostgreSQL", () => {
  let committeeId = ""
  let meetingId = ""
  let meetingVersion = 1
  let secondMeetingId = ""
  let secondMeetingVersion = 1
  const memberIds: Record<string, string> = {}

  beforeAll(async () => {
    assertSafeDestructiveDatabase({ databaseUrl: databaseUrl!, allowDestructiveReset: canReset, context: "PREVENTION_CPHS" })
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

  it("refuses a mandate that ends before it starts", async () => {
    const service = await import("@/lib/services/prevention-cphs")
    await expect(service.constituteCommittee({
      worksiteId: "ws-cp-a", name: "Comité inválido",
      constitutedOn: "2026-08-01", mandateEndsOn: "2026-07-01",
    }, MANAGER)).rejects.toThrow()
  })

  it("denies constitution from a foreign worksite scope", async () => {
    const service = await import("@/lib/services/prevention-cphs")
    await expect(service.constituteCommittee({
      worksiteId: "ws-cp-a", name: "Comité ajeno",
      constitutedOn: "2026-08-01", mandateEndsOn: "2028-08-01",
    }, OUTSIDER)).rejects.toThrow(/fuera de alcance/)
  })

  it("constitutes the committee", async () => {
    const service = await import("@/lib/services/prevention-cphs")
    const committee = await service.constituteCommittee({
      worksiteId: "ws-cp-a", name: "Comité Paritario Faena Norte",
      constitutedOn: "2026-08-01", mandateEndsOn: "2028-08-01", meetingDayOfMonth: 10,
    }, MANAGER)
    committeeId = committee.id
    expect(committee.status).toBe("active")
  })

  it("allows only one active committee per worksite", async () => {
    const service = await import("@/lib/services/prevention-cphs")
    await expect(service.constituteCommittee({
      worksiteId: "ws-cp-a", name: "Segundo comité del mismo centro",
      constitutedOn: "2026-08-01", mandateEndsOn: "2028-08-01",
    }, MANAGER)).rejects.toThrow()
  })

  it("refuses a member from another worksite", async () => {
    const service = await import("@/lib/services/prevention-cphs")
    await expect(service.addCommitteeMember({
      committeeId, workerId: "wk-b1", representation: "workers", seat: "titular",
    }, MANAGER)).rejects.toThrow(/otra faena/)
  })

  it("reports the committee as invalid while parity and roles are incomplete", async () => {
    const service = await import("@/lib/services/prevention-cphs")
    const first = await service.addCommitteeMember({
      committeeId, workerId: "wk-a1", representation: "company", seat: "titular", role: "presidente",
    }, MANAGER)
    memberIds.c1 = first.id

    const status = await service.getCommitteeStatus(committeeId, MANAGER)
    expect(status?.parity.valid).toBe(false)
    // Falta el par de trabajadores y falta secretaría.
    expect(status?.parity.issues.map((issue) => issue.kind)).toEqual(
      expect.arrayContaining(["parity_mismatch", "missing_role"]),
    )
  })

  it("becomes valid once parity, president and secretary are in place", async () => {
    const service = await import("@/lib/services/prevention-cphs")
    memberIds.c2 = (await service.addCommitteeMember({ committeeId, workerId: "wk-a2", representation: "company", seat: "titular" }, MANAGER)).id
    memberIds.w1 = (await service.addCommitteeMember({ committeeId, workerId: "wk-a3", representation: "workers", seat: "titular", role: "secretario", hasFuero: true }, MANAGER)).id
    memberIds.w2 = (await service.addCommitteeMember({ committeeId, workerId: "wk-a4", representation: "workers", seat: "titular" }, MANAGER)).id
    memberIds.s1 = (await service.addCommitteeMember({ committeeId, workerId: "wk-a5", representation: "company", seat: "suplente" }, MANAGER)).id

    const status = await service.getCommitteeStatus(committeeId, MANAGER)
    expect(status?.parity).toEqual({ valid: true, issues: [] })
    expect(status?.mandateExpired).toBe(false)
    // Sin sesiones cerradas todavía, la cadencia se reporta vencida.
    expect(status?.cadence.overdue).toBe(true)
  })

  it("schedules a meeting convening every active member", async () => {
    const service = await import("@/lib/services/prevention-cphs")
    const meeting = await service.scheduleCommitteeMeeting({
      committeeId, scheduledFor: "2026-08-10T14:00:00.000Z",
      agenda: "Revisión de incidentes del mes, avance del programa y estado de acciones CAPA.",
    }, MANAGER)
    meetingId = meeting.id
    meetingVersion = meeting.version

    const attendance = await getDb().select().from(schema.preventionCommitteeAttendance)
      .where(eq(schema.preventionCommitteeAttendance.meetingId, meetingId))
    expect(attendance).toHaveLength(5)
    expect(attendance.every((row) => row.attended === false)).toBe(true)
  })

  it("refuses to close the minutes without quorum", async () => {
    const service = await import("@/lib/services/prevention-cphs")
    await expect(service.closeCommitteeMeeting({
      meetingId, expectedVersion: meetingVersion, heldAt: "2026-08-10T14:00:00.000Z",
      minutes: "Sesión sin quórum suficiente que se intenta cerrar igualmente.",
      attendedMemberIds: [memberIds.c1!],
    }, MANAGER)).rejects.toThrow(/no alcanzó quórum/)
  })

  it("closes the minutes with quorum and derives every agreement to CAPA", async () => {
    const service = await import("@/lib/services/prevention-cphs")
    const closed = await service.closeCommitteeMeeting({
      meetingId, expectedVersion: meetingVersion, heldAt: "2026-08-10T14:00:00.000Z",
      minutes: "Se revisaron los incidentes del período y se acordaron medidas con responsable y plazo.",
      attendedMemberIds: [memberIds.c1!, memberIds.w1!, memberIds.w2!],
      excuses: [{ memberId: memberIds.c2!, reason: "Con licencia médica en la fecha de la sesión." }],
      agreements: [
        { description: "Señalización deficiente en el patio de maniobras", actionDescription: "Reponer y reforzar la señalización del patio", priority: "high", targetDate: "2026-09-15" },
        { description: "Difusión pendiente del procedimiento de emergencia", actionDescription: "Realizar difusión y registrar acuse", priority: "medium", targetDate: "2026-09-30" },
      ],
    }, MANAGER)
    meetingVersion = closed.meeting.version

    expect(closed.agreementsCreated).toBe(2)
    expect(closed.quorum.reached).toBe(true)
    expect(closed.meeting.quorumReached).toBe(true)

    const capa = await getDb().select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.sourceType, "cphs"))
    expect(capa).toHaveLength(2)
    expect(capa.every((action) => action.worksiteId === "ws-cp-a")).toBe(true)

    // El acuerdo ya no tiene columna `status`: su estado es el de la CAPA a la
    // que apunta, así que lo único que hay que probar acá es el vínculo.
    const agreements = await getDb().select().from(schema.preventionCommitteeAgreements)
      .where(eq(schema.preventionCommitteeAgreements.meetingId, meetingId))
    expect(agreements.every((row) => row.capaActionId !== null)).toBe(true)

    const excused = await getDb().select().from(schema.preventionCommitteeAttendance)
      .where(eq(schema.preventionCommitteeAttendance.memberId, memberIds.c2!))
    expect(excused[0]?.excuseReason).toContain("licencia")
  })

  it("rejects closing the same minutes twice", async () => {
    const service = await import("@/lib/services/prevention-cphs")
    await expect(service.closeCommitteeMeeting({
      meetingId, expectedVersion: meetingVersion, heldAt: "2026-08-10T14:00:00.000Z",
      minutes: "Intento de cerrar dos veces la misma acta del comité.",
      attendedMemberIds: [memberIds.c1!, memberIds.w1!, memberIds.w2!],
    }, MANAGER)).rejects.toThrow(/ya fue cerrada/)
  })

  it("reports the cadence as up to date after a closed meeting", async () => {
    const service = await import("@/lib/services/prevention-cphs")
    const status = await service.getCommitteeStatus(committeeId, MANAGER)
    expect(status?.cadence.monthsWithoutMeeting).toBeLessThan(2)
  })

  it("refuses to close a session held by a single representation", async () => {
    const service = await import("@/lib/services/prevention-cphs")
    const meeting = await service.scheduleCommitteeMeeting({
      committeeId, scheduledFor: "2026-08-12T14:00:00.000Z",
      agenda: "Segunda sesión: seguimiento de acuerdos y revisión del programa del comité.",
    }, MANAGER)
    secondMeetingId = meeting.id
    secondMeetingVersion = meeting.version

    // c1 y c2 son la mayoría de titulares (2 de 4), pero ambos representan a la
    // empresa: el comité es paritario y no sesiona sin la otra representación.
    await expect(service.closeCommitteeMeeting({
      meetingId: secondMeetingId, expectedVersion: secondMeetingVersion, heldAt: "2026-08-12T14:00:00.000Z",
      minutes: "Sesión con la sola representación del empleador que se intenta cerrar igualmente.",
      attendedMemberIds: [memberIds.c1!, memberIds.c2!],
    }, MANAGER)).rejects.toThrow(/no alcanzó quórum: no hubo representante de las personas trabajadoras presente/)
  })

  it("refuses attendance from someone who does not belong to the committee", async () => {
    const service = await import("@/lib/services/prevention-cphs")
    await expect(service.closeCommitteeMeeting({
      meetingId: secondMeetingId, expectedVersion: secondMeetingVersion, heldAt: "2026-08-12T14:00:00.000Z",
      minutes: "Acta que nombra en la asistencia a alguien que no integra el comité.",
      attendedMemberIds: [memberIds.c1!, memberIds.w1!, "cphsm-de-otro-comite"],
    }, MANAGER)).rejects.toThrow(/sólo admite integrantes de este comité/)
  })

  it("refuses minutes dated in the future or before the committee existed", async () => {
    const service = await import("@/lib/services/prevention-cphs")
    const base = {
      meetingId: secondMeetingId, expectedVersion: secondMeetingVersion,
      minutes: "Acta con una fecha de realización que el comité no puede sostener.",
      attendedMemberIds: [memberIds.c1!, memberIds.w1!, memberIds.w2!],
    }
    // Un acta futura silenciaba el aviso de cadencia para siempre: la última
    // sesión "cerrada" quedaba adelantada y `assessMeetingCadence` no reclamaba.
    const future = new Date(Date.now() + 86_400_000).toISOString()
    // Lo rechaza el esquema, así que llega como ZodError: su mensaje serializa
    // los issues y contiene el texto de la regla.
    await expect(service.closeCommitteeMeeting({ ...base, heldAt: future }, MANAGER))
      .rejects.toThrow(/no puede realizarse en el futuro/)
    // El comité se constituyó el 2026-08-01.
    await expect(service.closeCommitteeMeeting({ ...base, heldAt: "2026-07-20T14:00:00.000Z" }, MANAGER))
      .rejects.toThrow(/anterior a la constitución del comité/)
  })

  it("reconciles nominal attendance with the roster in force when closing", async () => {
    const service = await import("@/lib/services/prevention-cphs")
    // El padrón cambia DESPUÉS de convocar: se reemplaza a c2, así que su fila
    // de asistencia sobra y la del reemplazante no existe.
    const replacement = await service.replaceCommitteeMember({
      memberId: memberIds.c2!, workerId: "wk-a6",
      reason: "Cambio de faena de la persona titular durante el período del mandato.",
    }, MANAGER)
    memberIds.c2b = replacement.id

    const beforeClose = await getDb().select().from(schema.preventionCommitteeAttendance)
      .where(eq(schema.preventionCommitteeAttendance.meetingId, secondMeetingId))
    expect(beforeClose.map((row) => row.memberId)).toContain(memberIds.c2)
    expect(beforeClose.map((row) => row.memberId)).not.toContain(memberIds.c2b)

    const closed = await service.closeCommitteeMeeting({
      meetingId: secondMeetingId, expectedVersion: secondMeetingVersion, heldAt: "2026-08-12T14:00:00.000Z",
      minutes: "Se revisó el avance de los acuerdos anteriores y el programa anual del comité.",
      attendedMemberIds: [memberIds.c1!, memberIds.c2b!, memberIds.w1!, memberIds.w2!],
    }, MANAGER)
    expect(closed.quorum.reached).toBe(true)

    const attendance = await getDb().select().from(schema.preventionCommitteeAttendance)
      .where(eq(schema.preventionCommitteeAttendance.meetingId, secondMeetingId))
    const byMember = new Map(attendance.map((row) => [row.memberId, row]))
    // El padrón vigente son los cinco integrantes activos, ni uno más.
    expect(attendance).toHaveLength(5)
    expect(byMember.has(memberIds.c2!)).toBe(false)
    expect(byMember.get(memberIds.c2b!)?.attended).toBe(true)
    expect(byMember.get(memberIds.s1!)?.attended).toBe(false)
  })

  it("expires a committee whose mandate has passed, leaving history, and blocks new meetings", async () => {
    const service = await import("@/lib/services/prevention-cphs")
    // El constraint exige mandato posterior a la constitución, así que se
    // retrocede el par completo para simular un mandato ya vencido.
    await getDb().update(schema.preventionCommittees)
      .set({ constitutedOn: "2019-01-01", mandateEndsOn: "2020-01-01" })
      .where(eq(schema.preventionCommittees.id, committeeId))
    const [before] = await getDb().select().from(schema.preventionCommittees)
      .where(eq(schema.preventionCommittees.id, committeeId))

    const result = await service.expireLapsedCommittees()
    expect(result.expired).toBe(1)

    // Era la única transición del comité que cambiaba estado sin dejar rastro.
    const [after] = await getDb().select().from(schema.preventionCommittees)
      .where(eq(schema.preventionCommittees.id, committeeId))
    expect(after?.status).toBe("expired")
    expect(after?.version).toBe(before!.version + 1)

    const expiredHistory = await getDb().select().from(schema.preventionGovernanceHistory)
      .where(and(
        eq(schema.preventionGovernanceHistory.entityId, committeeId),
        eq(schema.preventionGovernanceHistory.changeType, "expired"),
      ))
    expect(expiredHistory).toHaveLength(1)
    expect(expiredHistory[0]?.worksiteId).toBe("ws-cp-a")

    // Idempotente: la segunda corrida no reexpira ni duplica el historial.
    expect((await service.expireLapsedCommittees()).expired).toBe(0)
    const afterSecondRun = await getDb().select().from(schema.preventionGovernanceHistory)
      .where(and(
        eq(schema.preventionGovernanceHistory.entityId, committeeId),
        eq(schema.preventionGovernanceHistory.changeType, "expired"),
      ))
    expect(afterSecondRun).toHaveLength(1)

    await expect(service.scheduleCommitteeMeeting({
      committeeId, scheduledFor: "2026-09-10T14:00:00.000Z",
      agenda: "Intento de convocar con el mandato del comité ya vencido.",
    }, MANAGER)).rejects.toThrow(/disuelto o vencido/)
  })

  it("closes a management review deriving commitments to CAPA", async () => {
    const service = await import("@/lib/services/prevention-cphs")
    const review = await service.createManagementReview({
      worksiteId: "ws-cp-a", periodLabel: "2026-S1", heldAt: "2026-07-30T15:00:00.000Z",
      inputs: { indicadores: "frecuencia y gravedad del semestre", capaVencidas: 3, auditorias: 1 },
    }, DIRECTOR)
    expect(review.status).toBe("draft")

    const closed = await service.closeManagementReview({
      reviewId: review.id, expectedVersion: review.version,
      conclusions: "El sistema opera, pero la verificación de controles críticos está bajo lo comprometido.",
      resourceDecisions: "Se aprueba reforzar la dotación preventiva de la faena.",
      commitments: [{
        description: "Verificación de controles críticos bajo lo comprometido",
        actionDescription: "Reprogramar la verificación mensual y reportar avance a la dirección",
        worksiteId: "ws-cp-a", priority: "high", targetDate: "2026-09-30",
      }],
    }, DIRECTOR)
    expect(closed.commitmentsCreated).toBe(1)
    expect(closed.review.status).toBe("closed")

    const capa = await getDb().select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.sourceId, review.id))
    expect(capa).toHaveLength(1)
  })

  it("scopes management reviews by worksite, keeping the corporate ones visible", async () => {
    const service = await import("@/lib/services/prevention-cphs")
    // Sin faena = revisión corporativa: la ve cualquiera que pueda revisar.
    await service.createManagementReview({
      periodLabel: "2026-CORP", heldAt: "2026-07-31T15:00:00.000Z",
      inputs: { alcance: "toda la empresa" },
    }, DIRECTOR)

    // Un revisor acotado a ws-cp-b no puede ver ni cerrar la de ws-cp-a. Hoy el
    // permiso lo tienen roles globales; el alcance tiene que sostenerse igual.
    const SCOPED_REVIEWER = {
      userId: "cp-outsider",
      scope: { mode: "some", ids: ["ws-cp-b"] } as WorksiteScope,
      permissions: ["prevention:cphs:view", "prevention:governance:review"],
    }
    const visible = await service.listManagementReviews(SCOPED_REVIEWER)
    expect(visible.map((row) => row.review.periodLabel)).toEqual(["2026-CORP"])
    expect(await service.listManagementReviews(DIRECTOR)).toHaveLength(2)

    const [foreign] = await getDb().select().from(schema.preventionManagementReviews)
      .where(eq(schema.preventionManagementReviews.worksiteId, "ws-cp-a"))
    await expect(service.closeManagementReview({
      reviewId: foreign!.id, expectedVersion: foreign!.version,
      conclusions: "Intento de cerrar la revisión de una faena fuera del alcance del revisor.",
    }, SCOPED_REVIEWER)).rejects.toThrow(/fuera de alcance/)
  })

  it("does not leak committees of another worksite", async () => {
    const service = await import("@/lib/services/prevention-cphs")
    expect(await service.listCommittees(OUTSIDER)).toEqual([])
    expect(await service.getCommitteeStatus(committeeId, OUTSIDER)).toBeNull()
  })
})

async function seedFixture(database: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date().toISOString()
  await database.insert(schema.worksites).values([
    { id: "ws-cp-a", name: "Faena Norte", code: "CP-A", createdAt: now, updatedAt: now },
    { id: "ws-cp-b", name: "Faena Sur", code: "CP-B", createdAt: now, updatedAt: now },
  ])
  await database.insert(schema.workers).values([
    { id: "wk-a1", rut: "11111111-1", firstName: "Ana", lastName: "Pérez", worksiteId: "ws-cp-a", createdAt: now },
    { id: "wk-a2", rut: "22222222-2", firstName: "Bruno", lastName: "Soto", worksiteId: "ws-cp-a", createdAt: now },
    { id: "wk-a3", rut: "33333333-3", firstName: "Carla", lastName: "Díaz", worksiteId: "ws-cp-a", createdAt: now },
    { id: "wk-a4", rut: "44444444-4", firstName: "Diego", lastName: "Rojas", worksiteId: "ws-cp-a", createdAt: now },
    { id: "wk-a5", rut: "55555555-5", firstName: "Elena", lastName: "Muñoz", worksiteId: "ws-cp-a", createdAt: now },
    { id: "wk-a6", rut: "77777777-7", firstName: "Gabriel", lastName: "Toro", worksiteId: "ws-cp-a", createdAt: now },
    { id: "wk-b1", rut: "66666666-6", firstName: "Felipe", lastName: "Vera", worksiteId: "ws-cp-b", createdAt: now },
  ])
  await database.insert(schema.users).values([
    { id: "cp-manager", name: "Gestor CPHS", email: "cp-manager@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "cp-director", name: "Dirección", email: "cp-director@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "cp-outsider", name: "Ajeno", email: "cp-outsider@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
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
