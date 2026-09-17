/**
 * Distribución del cierre mensual por notificación y correo
 * (`lib/services/pdtp/period-closure-distribution.ts`), contra Postgres real
 * (PGlite).
 *
 * Tres preguntas:
 *  · ¿quién recibe? — la intersección de "puede ver el PDTP en esa faena" con
 *    la lista de roles, no una de las dos sola;
 *  · ¿se duplica al reenviar? — no, mientras la versión del cierre no cambie;
 *  · ¿queda constancia? — `distributedAt` y `distributionJson`.
 *
 * El envío de correo se corta en `sendEmail` (mock): acá se prueba el
 * destinatario y la deduplicación, no SMTP.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

vi.mock("@/lib/email/smtp", () => ({
  sendEmail: vi.fn(async () => undefined),
  sendBatchEmails: vi.fn(async () => undefined),
  getAppBaseUrl: () => "https://chome.test",
}))

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

const YEAR = new Date().getFullYear()
const MONTH = 1

/** Foto mínima con la forma que lee el resumen del correo. */
const SNAPSHOT = {
  schemaVersion: 1,
  cutoff: { year: YEAR, month: MONTH, asOf: `${YEAR}-01-31T23:59:59.999Z` },
  indicators: {
    monthly: [{ month: MONTH, planned: 10, executed: 8, percent: 0.8, zeroActivities: 2, zeroActivityIds: [], declaredNotPerformed: 1 }],
  },
  deviations: [{ n: 1 }, { n: 2 }, { n: 3 }],
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.notifications)
  await inMemoryDb.delete(schema.pdtpPeriodClosures)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.rolePermissions)
  await inMemoryDb.delete(schema.userRoles)
  await inMemoryDb.delete(schema.worksiteUsers)
  await inMemoryDb.delete(schema.permissions)
  await inMemoryDb.delete(schema.roles)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.worksites).values([
    { id: "ws-1", name: "Faena Uno", code: "F1", isActive: true },
    { id: "ws-2", name: "Faena Dos", code: "F2", isActive: true },
  ])
  await inMemoryDb.insert(schema.permissions).values([
    { id: "perm-view", name: "prevention:pdtp:view", description: "Ver PDTP", module: "prevention" },
  ])
  await inMemoryDb.insert(schema.roles).values([
    // De la lista de distribución, global (ve todas las faenas).
    { id: "rol-jefa", name: "jefa_chome", label: "Jefatura", isGlobal: true },
    // De la lista, acotado por faena.
    { id: "rol-prf", name: "prevencionista_faena", label: "Prevencionista faena", isGlobal: false },
    // FUERA de la lista, aunque pueda ver el PDTP.
    { id: "rol-sup", name: "supervisor_terreno", label: "Supervisor", isGlobal: false },
  ])
  await inMemoryDb.insert(schema.rolePermissions).values([
    { roleId: "rol-jefa", permissionId: "perm-view" },
    { roleId: "rol-prf", permissionId: "perm-view" },
    { roleId: "rol-sup", permissionId: "perm-view" },
  ])
  await inMemoryDb.insert(schema.users).values([
    { id: "u-jefa", name: "Jefa", email: "jefa@test.cl", hashedPassword: "x", isActive: true },
    { id: "u-prf-1", name: "PRF Faena Uno", email: "prf1@test.cl", hashedPassword: "x", isActive: true },
    { id: "u-prf-2", name: "PRF Faena Dos", email: "prf2@test.cl", hashedPassword: "x", isActive: true },
    { id: "u-sup", name: "Supervisor", email: "sup@test.cl", hashedPassword: "x", isActive: true },
    { id: "u-cierra", name: "Quien cierra", email: "cierra@test.cl", hashedPassword: "x", isActive: true },
  ])
  await inMemoryDb.insert(schema.userRoles).values([
    { userId: "u-jefa", roleId: "rol-jefa" },
    { userId: "u-prf-1", roleId: "rol-prf" },
    { userId: "u-prf-2", roleId: "rol-prf" },
    { userId: "u-sup", roleId: "rol-sup" },
  ])
  await inMemoryDb.insert(schema.worksiteUsers).values([
    { worksiteId: "ws-1", userId: "u-prf-1" },
    { worksiteId: "ws-2", userId: "u-prf-2" },
    { worksiteId: "ws-1", userId: "u-sup" },
  ])

  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: "prog-1", year: YEAR, version: 1, status: "active", title: "Programa",
    elaboratedByName: "X", elaboratedByTitle: "Y", createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpPeriodClosures).values({
    id: "close-1", programId: "prog-1", worksiteId: "ws-1", year: YEAR, month: MONTH,
    status: "closed", version: 1, snapshotJson: SNAPSHOT, digest: "a".repeat(64),
    closedByUserId: "u-cierra", closedAt: now,
    closeReason: "Mes revisado con la jefatura de faena y conciliado.",
    distributionJson: [], createdAt: now, updatedAt: now,
  })
})

describe("resolvePdtpClosureRecipients", () => {
  it("son los usuarios con `view` en la faena Y con un rol de la lista", async () => {
    const { resolvePdtpClosureRecipients } = await import("@/lib/services/pdtp/period-closure-distribution")

    const recipients = await resolvePdtpClosureRecipients("ws-1")
    const ids = recipients.map((recipient) => recipient.userId).sort()

    // Jefatura (rol global, ve todas las faenas) + PRF asignado a ws-1.
    expect(ids).toEqual(["u-jefa", "u-prf-1"])
    // El supervisor ve el PDTP en ws-1 pero su rol no está en la lista.
    expect(ids).not.toContain("u-sup")
    // El PRF de la otra faena no recibe el cierre de ésta.
    expect(ids).not.toContain("u-prf-2")
    expect(recipients.find((recipient) => recipient.userId === "u-jefa")?.email).toBe("jefa@test.cl")
  })

  it("un usuario inactivo no recibe nada", async () => {
    const { resolvePdtpClosureRecipients } = await import("@/lib/services/pdtp/period-closure-distribution")
    await inMemoryDb.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, "u-prf-1"))

    const ids = (await resolvePdtpClosureRecipients("ws-1")).map((recipient) => recipient.userId)
    expect(ids).not.toContain("u-prf-1")
  })
})

describe("distributePdtpPeriodClosure", () => {
  it("crea una notificación por destinatario, con enlace al detalle y resumen del mes", async () => {
    const { distributePdtpPeriodClosure } = await import("@/lib/services/pdtp/period-closure-distribution")

    const result = await distributePdtpPeriodClosure({ closureId: "close-1" }, "u-cierra", "all")
    expect(result.recipients).toBe(2)

    const notifications = await inMemoryDb.select().from(schema.notifications)
    expect(notifications).toHaveLength(2)
    const first = notifications[0]!
    expect(first.type).toBe("pdtp_period_closed")
    expect(first.title).toContain(`Cierre PDTP 01/${YEAR}`)
    expect(first.title).toContain("Faena Uno")
    expect(first.body).toContain("80 %")
    expect(first.body).toContain("2 actividades en cero")
    expect(first.body).toContain("3 desvíos declarados")
    expect(first.entityType).toBe("pdtp_period_closure")
    expect(first.entityHref).toBe(`/prevencion/pdtp/prog-1/cierres/close-1`)
    expect(first.dedupeKey).toBe("pdtp-closure-close-1-v1")
  })

  it("reenviar el mismo cierre no duplica notificaciones (dedupe por closureId + versión)", async () => {
    const { distributePdtpPeriodClosure } = await import("@/lib/services/pdtp/period-closure-distribution")

    await distributePdtpPeriodClosure({ closureId: "close-1" }, "u-cierra", "all")
    await distributePdtpPeriodClosure({ closureId: "close-1" }, "u-cierra", "all")

    expect(await inMemoryDb.select().from(schema.notifications)).toHaveLength(2)
  })

  it("una versión nueva del cierre sí vuelve a notificar", async () => {
    const { distributePdtpPeriodClosure } = await import("@/lib/services/pdtp/period-closure-distribution")

    await distributePdtpPeriodClosure({ closureId: "close-1" }, "u-cierra", "all")
    await inMemoryDb.update(schema.pdtpPeriodClosures).set({ version: 2 })
      .where(eq(schema.pdtpPeriodClosures.id, "close-1"))
    await distributePdtpPeriodClosure({ closureId: "close-1" }, "u-cierra", "all")

    const notifications = await inMemoryDb.select().from(schema.notifications)
    expect(notifications).toHaveLength(4)
    expect(new Set(notifications.map((row) => row.dedupeKey))).toEqual(
      new Set(["pdtp-closure-close-1-v1", "pdtp-closure-close-1-v2"]),
    )
  })

  it("registra `distributedAt` y la nómina en `distributionJson`", async () => {
    const { distributePdtpPeriodClosure } = await import("@/lib/services/pdtp/period-closure-distribution")

    await distributePdtpPeriodClosure({ closureId: "close-1" }, "u-cierra", "all")

    const [closure] = await inMemoryDb.select().from(schema.pdtpPeriodClosures)
      .where(eq(schema.pdtpPeriodClosures.id, "close-1"))
    expect(closure!.distributedAt).toBeTruthy()
    const distribution = closure!.distributionJson as Array<{ userId: string; email: string }>
    expect(distribution.map((entry) => entry.userId).sort()).toEqual(["u-jefa", "u-prf-1"])
  })

  it("una faena fuera del alcance del usuario falla", async () => {
    const { distributePdtpPeriodClosure } = await import("@/lib/services/pdtp/period-closure-distribution")

    await expect(distributePdtpPeriodClosure({ closureId: "close-1" }, "u-cierra", ["ws-2"]))
      .rejects.toThrow()
  })
})
