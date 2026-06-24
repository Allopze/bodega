import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"

const mockNotifyManyUser = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockGetUserIdsWithPermission = vi.hoisted(() => vi.fn().mockResolvedValue(["u-jefa-prev-1"]))

vi.mock("@/lib/services/notifications", () => ({
  notifyManyUser: mockNotifyManyUser,
  getUserIdsWithPermission: mockGetUserIdsWithPermission,
}))

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import { checkOverdueWeeklyAlerts } from "@/lib/services/sst-alerts"

describe("sst-alerts service", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    
    await inMemoryDb.delete(schema.sstWeeklyEvaluations)
    await inMemoryDb.delete(schema.sstEvaluations)
    await inMemoryDb.delete(schema.workers)
    await inMemoryDb.delete(schema.worksiteUsers)
    await inMemoryDb.delete(schema.userRoles)
    await inMemoryDb.delete(schema.roles)
    await inMemoryDb.delete(schema.users)
    await inMemoryDb.delete(schema.worksites)

    // Seed worksite
    await inMemoryDb.insert(schema.worksites).values([
      { id: "ws-1", name: "Faena Norte", code: "FN-01", isActive: true },
    ])

    // Seed users
    await inMemoryDb.insert(schema.users).values([
      { id: "u-prev-faena", email: "prev_faena@test.cl", name: "Prev Faena", hashedPassword: "dummy_hash", isActive: true },
      { id: "u-admin-contrato", email: "admin_contrato@test.cl", name: "Admin Contrato", hashedPassword: "dummy_hash", isActive: true },
      { id: "u-cond-lider", email: "lider@test.cl", name: "Cond Lider", hashedPassword: "dummy_hash", isActive: true },
    ])

    // Seed roles
    await inMemoryDb.insert(schema.roles).values([
      { id: "rol-prev-faena", name: "prevencionista_faena", label: "Prev Faena", isGlobal: false },
      { id: "rol-admin-contrato", name: "admin_contrato", label: "Admin Contrato", isGlobal: false },
    ])

    // Assign scoped roles
    await inMemoryDb.insert(schema.userRoles).values([
      { id: "ur-1", userId: "u-prev-faena", roleId: "rol-prev-faena" },
      { id: "ur-2", userId: "u-admin-contrato", roleId: "rol-admin-contrato" },
    ])

    // Map users to worksite
    await inMemoryDb.insert(schema.worksiteUsers).values([
      { id: "wu-1", userId: "u-prev-faena", worksiteId: "ws-1" },
      { id: "wu-2", userId: "u-admin-contrato", worksiteId: "ws-1" },
    ])

    // Seed worker
    await inMemoryDb.insert(schema.workers).values({
      id: "worker-1",
      rut: "12345678-9",
      firstName: "Juan",
      lastName: "Perez",
      position: "operador",
      worksiteId: "ws-1",
      isActive: true,
    })

    // Seed evaluation
    await inMemoryDb.insert(schema.sstEvaluations).values({
      id: "eval-1",
      workerId: "worker-1",
      worksiteId: "ws-1",
      createdBy: "u-prev-faena",
      definicionCode: "trabajador_nuevo",
      definicionVersion: "1.0",
      evaluatorRole: "prevencionista_faena",
      tipo: "nuevo",
      estado: "borrador",
      fechaEvaluacion: "2026-06-01",
      cargos: ["operador"],
      resultado: "apto",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  })

  afterAll(async () => {
    const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
    delete testGlobal.__db
    await pg.close()
  })

  it("returns processed=0 if there are no overdue evaluations", async () => {
    // 1. Future date desbloqueo
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = tomorrow.toISOString().slice(0, 10)

    await inMemoryDb.insert(schema.sstWeeklyEvaluations).values({
      id: "week-future",
      evaluationId: "eval-1",
      semana: 1,
      fechaDesbloqueo: tomorrowStr,
      estado: "pendiente",
    })

    const res = await checkOverdueWeeklyAlerts()
    expect(res).toEqual({ processed: 0, errors: 0 })
    expect(mockNotifyManyUser).not.toHaveBeenCalled()
  })

  it("notifies prevencionista, admin contrato, and jefa prev of overdue week and updates alertSentAt", async () => {
    // 1. Desbloqueo 5 days ago (overdue by more than 3 days)
    const fiveDaysAgo = new Date()
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5)
    const fiveDaysAgoStr = fiveDaysAgo.toISOString().slice(0, 10)

    await inMemoryDb.insert(schema.sstWeeklyEvaluations).values({
      id: "week-overdue",
      evaluationId: "eval-1",
      semana: 1,
      fechaDesbloqueo: fiveDaysAgoStr,
      estado: "pendiente",
    })

    const res = await checkOverdueWeeklyAlerts()
    expect(res).toEqual({ processed: 1, errors: 0 })

    // Verify notifications were sent to merged users:
    // Scoped (u-prev-faena, u-admin-contrato) + global (u-jefa-prev-1)
    expect(mockNotifyManyUser).toHaveBeenCalled()
    const targetUserIds = mockNotifyManyUser.mock.calls[0][0] as string[]
    expect(targetUserIds).toContain("u-prev-faena")
    expect(targetUserIds).toContain("u-admin-contrato")
    expect(targetUserIds).toContain("u-jefa-prev-1")

    // Verify alert body details
    const notificationPayload = mockNotifyManyUser.mock.calls[0][1]
    expect(notificationPayload.title).toContain("Semana 1 de acompañamiento sin evaluar")
    expect(notificationPayload.body).toContain("Faena Norte")

    // Verify DB update
    const [updatedWeek] = await inMemoryDb.select().from(schema.sstWeeklyEvaluations).where(eq(schema.sstWeeklyEvaluations.id, "week-overdue"))
    expect(updatedWeek.alertSentAt).not.toBeNull()
  })
})

import { eq } from "drizzle-orm"
