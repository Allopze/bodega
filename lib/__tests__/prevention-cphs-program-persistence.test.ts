/**
 * Programa de trabajo del comité y organización preventiva por faena contra
 * Postgres real (PGlite): lo que se prueba acá son los CHECK del esquema, el
 * alcance por faena y la concurrencia optimista, que la lógica pura no puede
 * cubrir.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const ALL: WorksiteScope = { mode: "all", ids: [] }
const OTHER: WorksiteScope = { mode: "some", ids: ["ws-cphs-b"] }
const MANAGER = { userId: "u-cphs", scope: ALL, permissions: ["prevention:cphs:view", "prevention:cphs:manage"] }
const VIEWER = { userId: "u-cphs", scope: ALL, permissions: ["prevention:cphs:view"] }
const OUTSIDER = { userId: "u-cphs", scope: OTHER, permissions: ["prevention:cphs:view", "prevention:cphs:manage"] }

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.preventionCommitteeProgramActivities)
  await inMemoryDb.delete(schema.preventionCommitteePrograms)
  await inMemoryDb.delete(schema.preventionCommitteeMembers)
  await inMemoryDb.delete(schema.preventionCommittees)
  await inMemoryDb.delete(schema.preventionWorksiteDelegates)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: "u-cphs", name: "Prevencionista", email: "cphs@example.test", hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values([
    { id: "ws-cphs-a", name: "Faena Cholguán", code: "CHO", isActive: true },
    { id: "ws-cphs-b", name: "Faena ajena", code: "AJE", isActive: true },
  ])
  await inMemoryDb.insert(schema.workers).values([
    { id: "wk-1", firstName: "Ana", lastName: "Rojas", worksiteId: "ws-cphs-a", isActive: true, createdAt: new Date().toISOString() },
    { id: "wk-2", firstName: "Luis", lastName: "Soto", worksiteId: "ws-cphs-a", isActive: true, createdAt: new Date().toISOString() },
    { id: "wk-3", firstName: "Marta", lastName: "Vega", worksiteId: "ws-cphs-a", isActive: true, createdAt: new Date().toISOString() },
    { id: "wk-out", firstName: "Eva", lastName: "Lira", worksiteId: "ws-cphs-b", isActive: true, createdAt: new Date().toISOString() },
  ])
  await inMemoryDb.insert(schema.preventionCommittees).values({
    id: "cphs-a", worksiteId: "ws-cphs-a", name: "CPHS Cholguán",
    constitutedOn: "2026-01-15", mandateEndsOn: "2028-01-15", createdByUserId: "u-cphs",
  })
  await inMemoryDb.insert(schema.preventionCommitteeMembers).values({
    id: "cphsm-1", committeeId: "cphs-a", workerId: "wk-1",
    representation: "workers", seat: "titular", role: "presidente", status: "active",
  })
})

describe("programa de trabajo del comité", () => {
  it("crea el programa y rechaza duplicar el año", async () => {
    const { createProgram } = await import("@/lib/services/prevention-cphs-program")
    const program = await createProgram({ committeeId: "cphs-a", year: 2026 }, MANAGER)
    expect(program.status).toBe("draft")

    await expect(createProgram({ committeeId: "cphs-a", year: 2026 }, MANAGER))
      .rejects.toThrow(/ya tiene un programa/i)
  })

  it("no deja aprobar un programa sin actividades", async () => {
    const { createProgram, activateProgram, addProgramActivity } = await import("@/lib/services/prevention-cphs-program")
    const program = await createProgram({ committeeId: "cphs-a", year: 2026 }, MANAGER)

    await expect(activateProgram({ programId: program.id, expectedVersion: program.version }, MANAGER))
      .rejects.toThrow(/no tiene actividades/i)

    await addProgramActivity({
      programId: program.id, title: "Inspección mensual de la faena", plannedMonth: 3,
    }, MANAGER)
    const activated = await activateProgram({ programId: program.id, expectedVersion: program.version }, MANAGER)
    expect(activated.status).toBe("active")
    expect(activated.approvedByUserId).toBe("u-cphs")
  })

  it("exige que el responsable sea integrante activo del propio comité", async () => {
    const { createProgram, addProgramActivity } = await import("@/lib/services/prevention-cphs-program")
    const program = await createProgram({ committeeId: "cphs-a", year: 2026 }, MANAGER)

    await expect(addProgramActivity({
      programId: program.id, title: "Actividad con responsable ajeno", plannedMonth: 4,
      responsibleMemberId: "cphsm-inexistente",
    }, MANAGER)).rejects.toThrow(/integrante activo/i)
  })

  it("cierra la actividad con evidencia y respeta la concurrencia optimista", async () => {
    const { createProgram, addProgramActivity, completeProgramActivity } = await import("@/lib/services/prevention-cphs-program")
    const program = await createProgram({ committeeId: "cphs-a", year: 2026 }, MANAGER)
    const activity = await addProgramActivity({
      programId: program.id, title: "Difusión del programa preventivo", plannedMonth: 2,
      responsibleMemberId: "cphsm-1", riskTopic: "vial",
    }, MANAGER)

    const done = await completeProgramActivity({
      activityId: activity.id, expectedVersion: activity.version,
      completionNote: "Realizada en la sesión de marzo con 12 asistentes.",
      evidenceReference: "DOC-2026-004",
    }, MANAGER)
    expect(done.status).toBe("done")
    expect(done.completedAt).not.toBeNull()

    // La misma versión ya no sirve: la actividad avanzó.
    await expect(completeProgramActivity({
      activityId: activity.id, expectedVersion: activity.version,
      completionNote: "Intento duplicado sobre una versión vieja.",
    }, MANAGER)).rejects.toThrow(/ya fue cerrada/i)
  })

  it("cierra el año del programa y lo deja congelado", async () => {
    const {
      addProgramActivity, activateProgram, cancelProgramActivity, closeProgram,
      completeProgramActivity, createProgram,
    } = await import("@/lib/services/prevention-cphs-program")
    const program = await createProgram({ committeeId: "cphs-a", year: 2026 }, MANAGER)
    const activity = await addProgramActivity({
      programId: program.id, title: "Inspección planificada del comité", plannedMonth: 5,
    }, MANAGER)

    // Un borrador no tiene nada que cerrar: sólo se cierra lo que estuvo vigente.
    await expect(closeProgram({ programId: program.id, expectedVersion: program.version }, MANAGER))
      .rejects.toThrow(/vigente puede cerrarse/i)

    const active = await activateProgram({ programId: program.id, expectedVersion: program.version }, MANAGER)
    const closed = await closeProgram({ programId: program.id, expectedVersion: active.version }, MANAGER)
    expect(closed.status).toBe("closed")
    expect(closed.version).toBe(active.version + 1)

    // Congelado: ni actividades nuevas ni cambios en las que ya tenía.
    await expect(addProgramActivity({
      programId: program.id, title: "Actividad agregada después del cierre", plannedMonth: 6,
    }, MANAGER)).rejects.toThrow(/cerrado/i)
    await expect(completeProgramActivity({
      activityId: activity.id, expectedVersion: activity.version,
      completionNote: "Cierre tardío de una actividad de un año ya cerrado.",
    }, MANAGER)).rejects.toThrow(/cerrado/i)
    await expect(cancelProgramActivity({
      activityId: activity.id, expectedVersion: activity.version,
      reason: "Cancelación tardía de una actividad de un año ya cerrado.",
    }, MANAGER)).rejects.toThrow(/cerrado/i)

    // Y el cierre deja traza, como el resto de las transiciones del programa.
    const history = await inMemoryDb.select().from(schema.preventionGovernanceHistory)
      .where(eq(schema.preventionGovernanceHistory.entityId, program.id))
    expect(history.map((row) => row.changeType)).toEqual(["created", "activated", "closed"])
  })

  it("el cierre del programa respeta la concurrencia optimista", async () => {
    const { addProgramActivity, activateProgram, closeProgram, createProgram } =
      await import("@/lib/services/prevention-cphs-program")
    const program = await createProgram({ committeeId: "cphs-a", year: 2027 }, MANAGER)
    await addProgramActivity({
      programId: program.id, title: "Difusión anual del programa", plannedMonth: 1,
    }, MANAGER)
    const active = await activateProgram({ programId: program.id, expectedVersion: program.version }, MANAGER)

    await expect(closeProgram({ programId: program.id, expectedVersion: program.version }, MANAGER))
      .rejects.toThrow(/cambió mientras lo editabas/i)
    await expect(closeProgram({ programId: program.id, expectedVersion: active.version }, MANAGER))
      .resolves.toMatchObject({ status: "closed" })
  })

  it("un programa cerrado deja de generar avisos de actividad atrasada", async () => {
    const { addProgramActivity, activateProgram, closeProgram, createProgram } =
      await import("@/lib/services/prevention-cphs-program")
    const program = await createProgram({ committeeId: "cphs-a", year: 2026 }, MANAGER)
    await addProgramActivity({
      programId: program.id, title: "Actividad vencida sin ejecutar", plannedMonth: 1,
    }, MANAGER)
    const active = await activateProgram({ programId: program.id, expectedVersion: program.version }, MANAGER)

    // El job sólo mira programas `active`: ése era el punto de tener un estado
    // terminal, que el año viejo dejara de acumular atrasos para siempre.
    const stillActive = await inMemoryDb.select().from(schema.preventionCommitteePrograms)
      .where(eq(schema.preventionCommitteePrograms.status, "active"))
    expect(stillActive).toHaveLength(1)

    await closeProgram({ programId: program.id, expectedVersion: active.version }, MANAGER)
    const afterClose = await inMemoryDb.select().from(schema.preventionCommitteePrograms)
      .where(eq(schema.preventionCommitteePrograms.status, "active"))
    expect(afterClose).toHaveLength(0)
  })

  it("niega el programa de una faena fuera de alcance sin filtrar su existencia", async () => {
    const { createProgram } = await import("@/lib/services/prevention-cphs-program")
    await expect(createProgram({ committeeId: "cphs-a", year: 2027 }, OUTSIDER))
      .rejects.toThrow(/no encontrado o fuera de alcance/i)
  })

  it("un lector no puede crear ni cerrar", async () => {
    const { createProgram } = await import("@/lib/services/prevention-cphs-program")
    await expect(createProgram({ committeeId: "cphs-a", year: 2027 }, VIEWER))
      .rejects.toThrow(/no encontrado o fuera de alcance/i)
  })
})

describe("organización preventiva por faena", () => {
  it("designa delegado y bloquea un segundo vigente en la misma faena", async () => {
    const { designateDelegate } = await import("@/lib/services/prevention-cphs-organization")
    await designateDelegate({ worksiteId: "ws-cphs-a", workerId: "wk-1", designatedOn: "2026-02-01" }, MANAGER)

    await expect(designateDelegate({ worksiteId: "ws-cphs-a", workerId: "wk-2", designatedOn: "2026-03-01" }, MANAGER))
      .rejects.toThrow(/ya tiene un delegado vigente/i)
  })

  it("el delegado debe pertenecer a la dotación de la faena", async () => {
    const { designateDelegate } = await import("@/lib/services/prevention-cphs-organization")
    await expect(designateDelegate({ worksiteId: "ws-cphs-a", workerId: "wk-out", designatedOn: "2026-02-01" }, MANAGER))
      .rejects.toThrow(/dotación de la faena/i)
  })

  it("terminar el período libera la faena para una designación nueva", async () => {
    const { designateDelegate, endDelegate } = await import("@/lib/services/prevention-cphs-organization")
    const first = await designateDelegate({ worksiteId: "ws-cphs-a", workerId: "wk-1", designatedOn: "2026-02-01" }, MANAGER)

    await endDelegate({ delegateId: first.id, expectedVersion: first.version, reason: "Cambió de faena en marzo." }, MANAGER)
    const second = await designateDelegate({ worksiteId: "ws-cphs-a", workerId: "wk-2", designatedOn: "2026-04-01" }, MANAGER)
    expect(second.status).toBe("active")
  })

  it("un delegado cuyo plazo venció no bloquea reemplazo ni cuenta como vigente", async () => {
    const { designateDelegate, getWorksiteOrganization } = await import("@/lib/services/prevention-cphs-organization")
    await designateDelegate({
      worksiteId: "ws-cphs-a", workerId: "wk-1",
      designatedOn: "2025-01-01", termEndsOn: "2025-12-31",
    }, MANAGER)

    const expiredProfile = await getWorksiteOrganization("ws-cphs-a", MANAGER)
    expect(expiredProfile?.delegate).toBeNull()

    const current = await designateDelegate({
      worksiteId: "ws-cphs-a", workerId: "wk-2", designatedOn: "2026-08-01",
    }, MANAGER)
    expect(current.status).toBe("active")
  })

  it("reporta la brecha cuando la dotación exige comité y no hay ninguno", async () => {
    const { getWorksiteOrganization } = await import("@/lib/services/prevention-cphs-organization")
    // 26 trabajadores en la faena sin comité: supera el umbral de 25.
    await inMemoryDb.insert(schema.workers).values(
      Array.from({ length: 26 }, (_, index) => ({
        id: `wk-b-${index}`, firstName: "Trab", lastName: `${index}`,
        worksiteId: "ws-cphs-b", isActive: true, createdAt: new Date().toISOString(),
      })),
    )

    const profile = await getWorksiteOrganization("ws-cphs-b", MANAGER)
    expect(profile?.headcount).toBe(27)
    expect(profile?.compliance).toMatchObject({ required: "cphs", compliant: false })
  })

  it("la faena con comité vigente queda al día", async () => {
    const { getWorksiteOrganization } = await import("@/lib/services/prevention-cphs-organization")
    const profile = await getWorksiteOrganization("ws-cphs-a", MANAGER)
    expect(profile?.committee?.id).toBe("cphs-a")
    expect(profile?.compliance.compliant).toBe(true)
  })

  it("incluye el programa de trabajo más reciente en la ficha de faena", async () => {
    const { createProgram } = await import("@/lib/services/prevention-cphs-program")
    const { getWorksiteOrganization } = await import("@/lib/services/prevention-cphs-organization")
    const program = await createProgram({ committeeId: "cphs-a", year: 2026 }, MANAGER)

    const profile = await getWorksiteOrganization("ws-cphs-a", MANAGER)
    expect(profile?.program).toMatchObject({ id: program.id, year: 2026, status: "draft" })
  })
})

describe("inmutabilidad y reemplazos del comité", () => {
  it("rechaza agregar invitados a una sesión cerrada", async () => {
    const { addMeetingGuest, scheduleCommitteeMeeting } = await import("@/lib/services/prevention-cphs")
    const meeting = await scheduleCommitteeMeeting({
      committeeId: "cphs-a",
      scheduledFor: "2026-08-10T14:00:00.000Z",
      agenda: "Revisión mensual de condiciones y acuerdos preventivos.",
    }, MANAGER)
    await inMemoryDb.update(schema.preventionCommitteeMeetings)
      .set({ status: "closed", closedAt: "2026-08-10T15:00:00.000Z" })
      .where(eq(schema.preventionCommitteeMeetings.id, meeting.id))

    await expect(addMeetingGuest({ meetingId: meeting.id, guestName: "Invitado tardío" }, MANAGER))
      .rejects.toThrow(/cerrada|no admite cambios/i)
  })

  it("acota la fecha de realización del acta entre la constitución y hoy", async () => {
    const { closeCommitteeMeeting, scheduleCommitteeMeeting } = await import("@/lib/services/prevention-cphs")
    const meeting = await scheduleCommitteeMeeting({
      committeeId: "cphs-a",
      scheduledFor: "2026-08-10T14:00:00.000Z",
      agenda: "Sesión para probar la cota de la fecha de realización.",
    }, MANAGER)
    const base = {
      meetingId: meeting.id, expectedVersion: meeting.version,
      minutes: "Acta con una fecha de realización que el comité no puede sostener.",
      attendedMemberIds: ["cphsm-1"],
    }

    // Un acta futura dejaba la cadencia "al día" para siempre.
    const future = new Date(Date.now() + 86_400_000).toISOString()
    await expect(closeCommitteeMeeting({ ...base, heldAt: future }, MANAGER))
      .rejects.toThrow(/no puede realizarse en el futuro/)
    // El comité se constituyó el 2026-01-15: antes de eso no existía.
    await expect(closeCommitteeMeeting({ ...base, heldAt: "2025-12-20T14:00:00.000Z" }, MANAGER))
      .rejects.toThrow(/anterior a la constitución del comité/)
  })

  it("un integrante reemplazado no puede volver a reemplazarse", async () => {
    const { replaceCommitteeMember } = await import("@/lib/services/prevention-cphs")
    await replaceCommitteeMember({
      memberId: "cphsm-1", workerId: "wk-2", reason: "Reemplazo titular acordado por el comité.",
    }, MANAGER)

    await expect(replaceCommitteeMember({
      memberId: "cphsm-1", workerId: "wk-3", reason: "Segundo reemplazo inválido del mismo asiento.",
    }, MANAGER))
      .rejects.toThrow(/ya no está activo|concurrentemente/i)

    const active = await inMemoryDb.select().from(schema.preventionCommitteeMembers)
      .where(eq(schema.preventionCommitteeMembers.status, "active"))
    expect(active).toHaveLength(1)
    expect(active[0]?.workerId).toBe("wk-2")
  })
})

describe("registro ante la Dirección del Trabajo", () => {
  it("rechaza una fecha anterior a la constitución del comité", async () => {
    const { recordCommitteeDtRegistration } = await import("@/lib/services/prevention-cphs")
    await expect(recordCommitteeDtRegistration({
      committeeId: "cphs-a", dtRegisteredOn: "2025-12-01", dtRegistrationReference: "F-123",
    }, MANAGER)).rejects.toThrow(/anterior a la constitución/i)
  })

  it("guarda fecha y folio", async () => {
    const { recordCommitteeDtRegistration } = await import("@/lib/services/prevention-cphs")
    const updated = await recordCommitteeDtRegistration({
      committeeId: "cphs-a", dtRegisteredOn: "2026-01-20", dtRegistrationReference: "DT-2026-0091",
    }, MANAGER)
    expect(updated.dtRegisteredOn).toBe("2026-01-20")
    expect(updated.dtRegistrationReference).toBe("DT-2026-0091")
  })
})
