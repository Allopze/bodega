import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
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

beforeEach(async () => {
  await inMemoryDb.delete(schema.notifications)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteAssignees)
  await inMemoryDb.delete(schema.pdtpChangeLog)
  await inMemoryDb.delete(schema.pdtpActivityScheduleOverrides)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksiteUsers)
  await inMemoryDb.delete(schema.userRoles)
  await inMemoryDb.delete(schema.rolePermissions)
  await inMemoryDb.delete(schema.roles)
  await inMemoryDb.delete(schema.permissions)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)
  await inMemoryDb.insert(schema.users).values({
    id: "user-1", name: "U1", email: "u1@test", hashedPassword: "x", isActive: true,
  })
})

describe("findPdtpWeeklyPending", () => {
  it("uses only the current effective cell and excludes inactive worksites", async () => {
    const now = "2026-07-01T00:00:00.000Z"
    await inMemoryDb.insert(schema.worksites).values([
      { id: "ws-active", name: "Faena activa", code: "ACT", isActive: true },
      { id: "ws-inactive", name: "Faena histórica", code: "OLD", isActive: false },
    ])
    await inMemoryDb.insert(schema.pdtpPrograms).values({
      id: "program-2026", year: 2026, version: 1, status: "active", title: "PDTP 2026",
      elaboratedByName: "Prevención", elaboratedByTitle: "PR", activatedAt: "2026-07-08T15:00:00.000Z",
      createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.pdtpActivities).values([
      { id: "act-pending", programId: "program-2026", n: 1, activity: "Pendiente", program: "P", responsibleSlugs: [], responsibleDisplay: "PR", sourceSheetRow: 1, createdAt: now, updatedAt: now },
      { id: "act-executed", programId: "program-2026", n: 2, activity: "Ejecutada", program: "P", responsibleSlugs: [], responsibleDisplay: "PR", sourceSheetRow: 2, createdAt: now, updatedAt: now },
      { id: "act-overridden", programId: "program-2026", n: 3, activity: "Override cero", program: "P", responsibleSlugs: [], responsibleDisplay: "PR", sourceSheetRow: 3, createdAt: now, updatedAt: now },
      { id: "act-prior-week", programId: "program-2026", n: 4, activity: "Semana anterior", program: "P", responsibleSlugs: [], responsibleDisplay: "PR", sourceSheetRow: 4, createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values([
      { id: "schedule-pending", activityId: "act-pending", year: 2026, month: 7, week: 2, plannedQuantity: 1, sourceColumn: "xlsx" },
      { id: "schedule-executed", activityId: "act-executed", year: 2026, month: 7, week: 2, plannedQuantity: 1, sourceColumn: "xlsx" },
      { id: "schedule-overridden", activityId: "act-overridden", year: 2026, month: 7, week: 2, plannedQuantity: 1, sourceColumn: "xlsx" },
      { id: "schedule-prior-week", activityId: "act-prior-week", year: 2026, month: 7, week: 1, plannedQuantity: 1, sourceColumn: "xlsx" },
    ])
    await inMemoryDb.insert(schema.pdtpActivityScheduleOverrides).values({
      id: "override-zero", activityId: "act-overridden", worksiteId: "ws-active", year: 2026, month: 7, week: 2,
      plannedQuantity: 0, updatedByUserId: "user-1", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: "execution-current", activityId: "act-executed", worksiteId: "ws-active", year: 2026, month: 7, week: 2,
      executedQuantity: 1, status: "submitted", evidencePhotos: [], createdAt: now, updatedAt: now,
    })

    const { findPdtpWeeklyPending } = await import("@/lib/services/prevention-pdtp")
    const targets = await findPdtpWeeklyPending({ year: 2026, month: 7, week: 2 })

    expect(targets).toEqual([
      {
        worksiteId: "ws-active",
        worksiteName: "Faena activa",
        activityIds: ["act-pending"],
        // Sin asignación nominal el mapa va vacío y el destinatario se sigue
        // resolviendo por permiso y faena, como antes de la Fase 5.
        assigneeUserIdsByActivity: {},
      },
    ])

    // La semana 1 tenía planificación, pero la versión todavía no estaba
    // aceptada: una consulta retrospectiva no debe generar ese pendiente.
    await expect(findPdtpWeeklyPending({ year: 2026, month: 7, week: 1 })).resolves.toEqual([])
  })
})

describe("createNotifications — dedup_key", () => {
  it("mismo (userId, dedupeKey) insertado dos veces produce 1 sola fila", async () => {
    const { createNotifications } = await import("@/lib/services/notifications")

    const input = {
      type: "system_alert" as const,
      title: "Test",
      body: "Body",
      entityType: "pdtp_program",
      entityId: "p1",
      entityHref: "/x",
      dedupeKey: "pdtp-weekly:user-1:ws-1:2026:1:W1",
    }

    await createNotifications(["user-1"], input)
    await createNotifications(["user-1"], input)
    await createNotifications(["user-1"], input)

    const all = await inMemoryDb.select().from(schema.notifications)
    expect(all).toHaveLength(1)
  })

  it("distinto dedupeKey produce filas distintas", async () => {
    const { createNotifications } = await import("@/lib/services/notifications")
    const base = {
      type: "system_alert" as const,
      title: "Test",
      body: "Body",
      entityType: "pdtp_program",
      entityId: "p1",
      entityHref: "/x",
    }

    await createNotifications(["user-1"], { ...base, dedupeKey: "k1" })
    await createNotifications(["user-1"], { ...base, dedupeKey: "k2" })
    await createNotifications(["user-1"], { ...base, dedupeKey: "k1" }) // dup de k1

    const all = await inMemoryDb.select().from(schema.notifications)
    expect(all).toHaveLength(2)
  })

  it("sin dedupeKey, sigue creando duplicados (comportamiento legacy)", async () => {
    const { createNotifications } = await import("@/lib/services/notifications")
    const input = {
      type: "system_alert" as const,
      title: "Test",
      body: "Body",
      entityType: "pdtp_program",
      entityId: "p1",
      entityHref: "/x",
    }

    await createNotifications(["user-1"], input)
    await createNotifications(["user-1"], input)
    await createNotifications(["user-1"], input)

    const all = await inMemoryDb.select().from(schema.notifications)
    expect(all).toHaveLength(3)
  })

  it("distinto userId, mismo dedupeKey → filas distintas", async () => {
    await inMemoryDb.insert(schema.users).values({
      id: "user-2", name: "U2", email: "u2@test", hashedPassword: "x", isActive: true,
    })
    const { createNotifications } = await import("@/lib/services/notifications")
    const input = {
      type: "system_alert" as const,
      title: "Test",
      body: "Body",
      entityType: "pdtp_program",
      entityId: "p1",
      entityHref: "/x",
      dedupeKey: "shared-key",
    }

    await createNotifications(["user-1"], input)
    await createNotifications(["user-2"], input)
    await createNotifications(["user-1"], input) // dup

    const all = await inMemoryDb.select().from(schema.notifications)
    expect(all).toHaveLength(2)
  })
})

/**
 * Fase 5 — asignación nominal. `findPdtpWeeklyPending` es la costura por la que
 * el recordatorio deja de ser un aviso al rol completo: devuelve, por
 * actividad, quién la tiene a su nombre en esa faena. El enrutado del envío se
 * prueba en `pdtp-assignees.test.ts`, que puede interceptar el envío sin
 * romper los casos de `dedupeKey` de este archivo.
 */
describe("findPdtpWeeklyPending — asignación nominal", () => {
  const now = "2026-07-01T00:00:00.000Z"

  async function seedPendiente() {
    await inMemoryDb.insert(schema.users).values([
      { id: "jt-a", name: "Ana Jefa", email: "ana@test", hashedPassword: "x", isActive: true },
      { id: "jt-b", name: "Beto Jefe", email: "beto@test", hashedPassword: "x", isActive: true },
    ])
    await inMemoryDb.insert(schema.worksites).values({
      id: "ws-nominal", name: "Faena nominal", code: "NOM", isActive: true,
    })
    await inMemoryDb.insert(schema.pdtpPrograms).values({
      id: "program-nominal", year: 2026, version: 1, status: "active", title: "PDTP 2026",
      elaboratedByName: "Prevención", elaboratedByTitle: "PR",
      createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.pdtpActivities).values({
      id: "act-nominal", programId: "program-nominal", n: 1, activity: "Charla de seguridad",
      program: "P", responsibleSlugs: ["jt"], responsibleDisplay: "Jefe de terreno",
      sourceSheetRow: 1, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
      id: "sch-nominal", activityId: "act-nominal", year: 2026, month: 7, week: 2,
      plannedQuantity: 1, sourceColumn: "xlsx",
    })
  }

  it("sin asignación nominal el mapa va vacío y el aviso sigue siendo del rol", async () => {
    await seedPendiente()
    const { findPdtpWeeklyPending } = await import("@/lib/services/prevention-pdtp")
    const targets = await findPdtpWeeklyPending({ year: 2026, month: 7, week: 2 })
    expect(targets[0]?.assigneeUserIdsByActivity).toEqual({})
  })

  it("con asignación vigente devuelve al asignado para esa actividad", async () => {
    await seedPendiente()
    await inMemoryDb.insert(schema.pdtpActivityWorksiteAssignees).values({
      id: "asg-nominal", activityId: "act-nominal", worksiteId: "ws-nominal", userId: "jt-a",
      roleId: null, validFrom: "2026-01-01", validUntil: null,
      createdByUserId: "user-1", createdAt: now, updatedAt: now,
    })
    const { findPdtpWeeklyPending } = await import("@/lib/services/prevention-pdtp")
    const targets = await findPdtpWeeklyPending({ year: 2026, month: 7, week: 2 })
    expect(targets[0]?.assigneeUserIdsByActivity).toEqual({ "act-nominal": ["jt-a"] })
  })

  it("una asignación ya cerrada no cuenta: la actividad vuelve a ser del rol", async () => {
    await seedPendiente()
    await inMemoryDb.insert(schema.pdtpActivityWorksiteAssignees).values({
      id: "asg-cerrada", activityId: "act-nominal", worksiteId: "ws-nominal", userId: "jt-a",
      roleId: null, validFrom: "2026-01-01", validUntil: "2026-02-28",
      createdByUserId: "user-1", createdAt: now, updatedAt: now,
    })
    const { findPdtpWeeklyPending } = await import("@/lib/services/prevention-pdtp")
    const targets = await findPdtpWeeklyPending({ year: 2026, month: 7, week: 2 })
    expect(targets[0]?.assigneeUserIdsByActivity).toEqual({})
  })

  it("dos asignados por turnos se llevan los dos la actividad", async () => {
    await seedPendiente()
    await inMemoryDb.insert(schema.pdtpActivityWorksiteAssignees).values([
      {
        id: "asg-turno-a", activityId: "act-nominal", worksiteId: "ws-nominal", userId: "jt-a",
        roleId: null, validFrom: "2026-01-01", validUntil: null,
        createdByUserId: "user-1", createdAt: now, updatedAt: now,
      },
      {
        id: "asg-turno-b", activityId: "act-nominal", worksiteId: "ws-nominal", userId: "jt-b",
        roleId: null, validFrom: "2026-01-01", validUntil: null,
        createdByUserId: "user-1", createdAt: now, updatedAt: now,
      },
    ])
    const { findPdtpWeeklyPending } = await import("@/lib/services/prevention-pdtp")
    const targets = await findPdtpWeeklyPending({ year: 2026, month: 7, week: 2 })
    expect(new Set(targets[0]?.assigneeUserIdsByActivity["act-nominal"] ?? [])).toEqual(new Set(["jt-a", "jt-b"]))
  })
})
