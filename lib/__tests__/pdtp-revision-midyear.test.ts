/**
 * lib/__tests__/pdtp-revision-midyear.test.ts
 *
 * C05-A (plan de pendientes de la auditoría 2026-09-26): la revisión v+1 copia
 * TODO el contenido de cada actividad. Antes perdía `manualEvidencePolicy` —y
 * con ella las 19 excepciones de PREV-B02—, `scheduleDefinition`, la
 * configuración de ejecución y los recordatorios, sin avisar.
 *
 * La comparación es columna a columna vía `getTableColumns`: una columna nueva
 * que la copia olvide rompe esta prueba sin tener que acordarse de agregarla.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq, getTableColumns } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const YEAR = 2063

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpActivityWorksiteExclusions)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteAssignees)
  await inMemoryDb.delete(schema.notifications)
  await inMemoryDb.delete(schema.pdtpReminderDeliveries)
  await inMemoryDb.delete(schema.pdtpScheduledInstances)
  await inMemoryDb.delete(schema.pdtpActivityReminderRules)
  await inMemoryDb.delete(schema.pdtpActivityExecutionConfigs)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpChangeLog)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.pdtpResponsibleCatalog)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)
  await inMemoryDb.insert(schema.worksites).values({ id: "ws-rev", name: "Faena revisión", code: "FR", isActive: true })
  await inMemoryDb.insert(schema.users).values({ id: "user-1", name: "U1", email: "u1@test", hashedPassword: "x", isActive: true })
  await inMemoryDb.insert(schema.pdtpResponsibleCatalog).values([
    { slug: "prevencionista", displayName: "Prevencionista", kind: "role" },
  ])
})

async function activeProgramWithConfiguredActivity() {
  const { createLegacyPdtpProgramForTests, addPdtpActivity } = await import("@/lib/services/prevention-pdtp")
  const program = await createLegacyPdtpProgramForTests({ year: YEAR, title: `Programa ${YEAR}`, userId: "user-1" })
  const activity = await addPdtpActivity({
    programId: program.id,
    activity: "Actividad con configuración completa",
    program: "Guía de ejecución",
    responsibleSlugs: ["prevencionista"],
    responsibleDisplay: "Prevencionista",
    sheetCodes: [],
    scheduleMode: "on_demand",
  }, "user-1")
  const now = new Date().toISOString()
  // Contenido que la copia debe conservar, escrito directo para no depender
  // de los formularios.
  await inMemoryDb.update(schema.pdtpActivities).set({
    manualEvidencePolicy: "declaration_allowed",
    scheduleDefinition: { version: 1, kind: "on_demand", dueValue: 5, dueUnit: "day" },
  }).where(eq(schema.pdtpActivities.id, activity.id))
  await inMemoryDb.insert(schema.pdtpActivityExecutionConfigs).values({
    id: `pdtp-exec-config-${activity.id}`, activityId: activity.id, destinationConnectorKey: "inspections",
    completionPolicy: "source_completed", evidenceRequired: true, acceptedEvidenceKinds: ["file"],
    createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpActivityReminderRules).values({
    id: "pdtp-reminder-rule-original", activityId: activity.id, offsetValue: 2, offsetUnit: "day",
    recipientKind: "responsible", isActive: true, createdAt: now, updatedAt: now,
  })
  await inMemoryDb.update(schema.pdtpPrograms).set({ status: "active", activatedAt: now })
    .where(eq(schema.pdtpPrograms.id, program.id))
  return { program, activityId: activity.id }
}

describe("C05-A — la revisión v+1 copia todo el contenido de la actividad", () => {
  it("cada columna de la actividad llega igual a la copia, salvo las de identidad", async () => {
    const { createPdtpRevision } = await import("@/lib/services/pdtp/programs")
    const { program, activityId } = await activeProgramWithConfiguredActivity()
    const revision = await createPdtpRevision({ sourceProgramId: program.id, userId: "user-1" })

    const [source] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.id, activityId))
    const [copy] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.programId, revision.programId))
    expect(copy).toBeDefined()

    // Identidad y marcas de tiempo son propias de la copia; `objectiveId` se
    // remapea (lo cubre pdtp-objectives.test.ts).
    const ownColumns = new Set(["id", "programId", "createdAt", "updatedAt", "objectiveId"])
    const differing = Object.keys(getTableColumns(schema.pdtpActivities))
      .filter((column) => !ownColumns.has(column))
      .filter((column) => JSON.stringify((source as Record<string, unknown>)[column]) !== JSON.stringify((copy as Record<string, unknown>)[column]))
    expect(differing).toEqual([])
  })

  it("una copia a otro año no arrastra la programación fechada, pero sí la política y las reglas", async () => {
    const { createLegacyPdtpProgramForTests } = await import("@/lib/services/prevention-pdtp")
    const { program } = await activeProgramWithConfiguredActivity()
    const copy = await createLegacyPdtpProgramForTests({ year: YEAR + 1, title: `Programa ${YEAR + 1}`, userId: "user-1", copySheetsFromProgramId: program.id })
    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.programId, copy.id))
    expect(activity!.scheduleDefinition).toBeNull()
    expect(activity!.manualEvidencePolicy).toBe("declaration_allowed")
    const rules = await inMemoryDb.select().from(schema.pdtpActivityReminderRules)
      .where(eq(schema.pdtpActivityReminderRules.activityId, activity!.id))
    expect(rules).toHaveLength(1)
  })

  it("copia la configuración de ejecución y los recordatorios, con ids propios", async () => {
    const { createPdtpRevision } = await import("@/lib/services/pdtp/programs")
    const { program } = await activeProgramWithConfiguredActivity()
    const revision = await createPdtpRevision({ sourceProgramId: program.id, userId: "user-1" })
    const [copy] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.programId, revision.programId))

    const [config] = await inMemoryDb.select().from(schema.pdtpActivityExecutionConfigs)
      .where(eq(schema.pdtpActivityExecutionConfigs.activityId, copy!.id))
    expect(config).toMatchObject({
      id: `pdtp-exec-config-${copy!.id}`,
      destinationConnectorKey: "inspections",
      completionPolicy: "source_completed",
      evidenceRequired: true,
      acceptedEvidenceKinds: ["file"],
    })
    const rules = await inMemoryDb.select().from(schema.pdtpActivityReminderRules)
      .where(eq(schema.pdtpActivityReminderRules.activityId, copy!.id))
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ offsetValue: 2, offsetUnit: "day", recipientKind: "responsible", isActive: true })
    expect(rules[0]!.id).not.toBe("pdtp-reminder-rule-original")
  })
})

describe("C05-A — los recordatorios sólo salen de programas vigentes", () => {
  async function seedInstanceWithUserReminder(programStatus: "active" | "closed", scheduledFor: string, activatedAt: string) {
    const { program, activityId } = await activeProgramWithConfiguredActivity()
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: programStatus, activatedAt })
      .where(eq(schema.pdtpPrograms.id, program.id))
    await inMemoryDb.update(schema.pdtpActivityReminderRules).set({ recipientKind: "user", recipientUserId: "user-1" })
      .where(eq(schema.pdtpActivityReminderRules.activityId, activityId))
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpScheduledInstances).values({
      id: `inst-${programStatus}-${scheduledFor}`, programId: program.id, activityId, worksiteId: "ws-rev",
      scheduledFor, isoWeekYear: YEAR, isoWeek: 10, status: "pending",
      idempotencyKey: `inst-${programStatus}-${scheduledFor}`, createdAt: now, updatedAt: now,
    })
  }

  it("una instancia de un programa vigente sí avisa (control positivo)", async () => {
    const { runPdtpScheduledInstanceReminders } = await import("@/lib/services/pdtp/scheduled-reminders")
    await seedInstanceWithUserReminder("active", `${YEAR}-03-10`, `${YEAR}-01-01T12:00:00.000Z`)
    const result = await runPdtpScheduledInstanceReminders(new Date(`${YEAR}-12-31T12:00:00.000Z`))
    expect(result.notificationsCreated).toBe(1)
  })

  it("una instancia de una versión ya reemplazada (cerrada) no avisa: la v+1 tiene sus propias reglas", async () => {
    const { runPdtpScheduledInstanceReminders } = await import("@/lib/services/pdtp/scheduled-reminders")
    await seedInstanceWithUserReminder("closed", `${YEAR}-03-10`, `${YEAR}-01-01T12:00:00.000Z`)
    const result = await runPdtpScheduledInstanceReminders(new Date(`${YEAR}-12-31T12:00:00.000Z`))
    expect(result.notificationsCreated).toBe(0)
  })

  it("una actividad retirada no avisa", async () => {
    const { runPdtpScheduledInstanceReminders } = await import("@/lib/services/pdtp/scheduled-reminders")
    await seedInstanceWithUserReminder("active", `${YEAR}-03-10`, `${YEAR}-01-01T12:00:00.000Z`)
    await inMemoryDb.update(schema.pdtpActivities).set({
      status: "retired", retiredReason: "Actividad fuera del programa vigente", retiredEffectiveFrom: `${YEAR}-02-01`, retiredAt: new Date().toISOString(),
    })
    const result = await runPdtpScheduledInstanceReminders(new Date(`${YEAR}-12-31T12:00:00.000Z`))
    expect(result.notificationsCreated).toBe(0)
  })

  it("una faena excluida de la actividad o inactiva no avisa", async () => {
    const { runPdtpScheduledInstanceReminders } = await import("@/lib/services/pdtp/scheduled-reminders")
    await seedInstanceWithUserReminder("active", `${YEAR}-03-10`, `${YEAR}-01-01T12:00:00.000Z`)
    const [activity] = await inMemoryDb.select().from(schema.pdtpActivities)
    await inMemoryDb.insert(schema.pdtpActivityWorksiteExclusions).values({
      id: "excl-rev", activityId: activity!.id, worksiteId: "ws-rev", reason: "La faena no opera este riesgo", createdAt: new Date().toISOString(),
    })
    expect((await runPdtpScheduledInstanceReminders(new Date(`${YEAR}-12-31T12:00:00.000Z`))).notificationsCreated).toBe(0)
    await inMemoryDb.delete(schema.pdtpActivityWorksiteExclusions)
    await inMemoryDb.update(schema.worksites).set({ isActive: false })
    expect((await runPdtpScheduledInstanceReminders(new Date(`${YEAR}-12-31T12:00:00.000Z`))).notificationsCreated).toBe(0)
  })

  it("un aviso cuyo momento ya pasó antes de activar la versión no se reenvía (le correspondía a la anterior)", async () => {
    const { runPdtpScheduledInstanceReminders } = await import("@/lib/services/pdtp/scheduled-reminders")
    // Regla de 2 días antes: el aviso de la ocurrencia del 16-jun era el 14-jun,
    // antes de activar la versión el 15-jun.
    await seedInstanceWithUserReminder("active", `${YEAR}-06-16`, `${YEAR}-06-15T12:00:00.000Z`)
    await inMemoryDb.update(schema.pdtpActivityReminderRules).set({ offsetValue: -2 })
    const result = await runPdtpScheduledInstanceReminders(new Date(`${YEAR}-06-15T13:00:00.000Z`))
    expect(result.notificationsCreated).toBe(0)
  })

  it("una instancia anterior a la activación del programa no avisa", async () => {
    const { runPdtpScheduledInstanceReminders } = await import("@/lib/services/pdtp/scheduled-reminders")
    await seedInstanceWithUserReminder("active", `${YEAR}-03-10`, `${YEAR}-06-01T12:00:00.000Z`)
    const result = await runPdtpScheduledInstanceReminders(new Date(`${YEAR}-12-31T12:00:00.000Z`))
    expect(result.notificationsCreated).toBe(0)
  })
})

describe("C05-A — no se materializan ocurrencias anteriores a la activación", () => {
  it("un programa activado a mitad de año sólo crea ocurrencias desde su activación", async () => {
    const { materializePdtpScheduledInstances } = await import("@/lib/services/pdtp/scheduled-instances")
    const { program, activityId } = await activeProgramWithConfiguredActivity()
    await inMemoryDb.update(schema.pdtpActivities).set({
      scheduleDefinition: { version: 1, kind: "recurring", startDate: `${YEAR}-01-01`, endDate: `${YEAR}-12-31`, every: 1, unit: "month", dayOfMonth: 10 },
    }).where(eq(schema.pdtpActivities.id, activityId))
    await inMemoryDb.update(schema.pdtpPrograms).set({ activatedAt: `${YEAR}-06-15T15:00:00.000Z`, appliesToAllWorksites: true })
      .where(eq(schema.pdtpPrograms.id, program.id))

    await materializePdtpScheduledInstances({ programId: program.id })
    const instances = await inMemoryDb.select().from(schema.pdtpScheduledInstances)
      .where(eq(schema.pdtpScheduledInstances.activityId, activityId))
    expect(instances.length).toBeGreaterThan(0)
    expect(instances.every((instance) => instance.scheduledFor >= `${YEAR}-06-15`)).toBe(true)
  })
})

describe("C05-A — la v+1 hereda las asignaciones nominales vigentes al activarse", () => {
  it("traspasa las asignaciones abiertas a la actividad equivalente, desde hoy, sin tocar las cerradas", async () => {
    const { createPdtpRevision } = await import("@/lib/services/pdtp/programs")
    const { handoverPdtpWorksiteAssignees } = await import("@/lib/services/pdtp/assignees")
    const { program, activityId } = await activeProgramWithConfiguredActivity()
    await inMemoryDb.insert(schema.users).values({ id: "user-2", name: "U2", email: "u2@test", hashedPassword: "x", isActive: true })
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpActivityWorksiteAssignees).values([
      { id: "asg-open", activityId, worksiteId: "ws-rev", userId: "user-1", validFrom: `${YEAR}-01-01`, createdAt: now, updatedAt: now },
      { id: "asg-closed", activityId, worksiteId: "ws-rev", userId: "user-2", validFrom: `${YEAR}-01-01`, validUntil: `${YEAR}-02-01`, createdAt: now, updatedAt: now },
    ])
    const revision = await createPdtpRevision({ sourceProgramId: program.id, userId: "user-1" })
    const [copy] = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.programId, revision.programId))

    const moved = await inMemoryDb.transaction((tx) => handoverPdtpWorksiteAssignees([program.id], revision.programId, `${YEAR}-06-15`, tx as never))
    expect(moved).toBe(1)
    const copied = await inMemoryDb.select().from(schema.pdtpActivityWorksiteAssignees)
      .where(eq(schema.pdtpActivityWorksiteAssignees.activityId, copy!.id))
    expect(copied).toHaveLength(1)
    expect(copied[0]).toMatchObject({ userId: "user-1", worksiteId: "ws-rev", validFrom: `${YEAR}-06-15`, validUntil: null })

    // Idempotente: repetir el traspaso no duplica.
    const again = await inMemoryDb.transaction((tx) => handoverPdtpWorksiteAssignees([program.id], revision.programId, `${YEAR}-06-15`, tx as never))
    expect(again).toBe(0)
  })
})

