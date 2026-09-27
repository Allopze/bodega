/**
 * lib/__tests__/prevention-ops-alerts.test.ts
 *
 * PREV-I13 (alertas): hasta la decisión D28 las alertas de Prevención eran sólo
 * logs. Ahora, con la infraestructura de notificaciones que ya existe (bandeja
 * de la plataforma + correo por el mismo transporte, `lib/email/smtp.ts`):
 *
 * - el escaneo `pdtp-evidence-integrity` avisa si encuentra archivos perdidos o
 *   alterados, a quienes tienen `admin:backups` (quienes pueden restaurar);
 * - un cron de Prevención que falla avisa a quienes tienen `admin:ops_settings`;
 * - como máximo una alerta por job y por día;
 * - sin correo configurado se registra y se sigue: la alerta nunca rompe el cron.
 *
 * El transporte de correo está simulado: esta prueba no envía nada.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

const mail = vi.hoisted(() => ({
  sendEmail: vi.fn(async () => ({ sent: true as const })),
  sendBatchEmails: vi.fn(async (messages: unknown[]) => ({ sent: true as const, count: messages.length })),
}))
const log = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }))

vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
vi.mock("@/lib/logger", () => ({ logger: log }))
vi.mock("@/lib/email/smtp", () => ({
  sendEmail: mail.sendEmail,
  sendBatchEmails: mail.sendBatchEmails,
  getAppBaseUrl: () => "https://plataforma.test",
}))

const { withCronLock } = await import("@/lib/services/cron-lock")
const { alertPdtpEvidenceIntegrityIssues, alertPreventionCronFailure, PREVENTION_ALERT_JOBS } = await import("@/lib/services/prevention-ops-alerts")

const ADMIN = "user-ops-admin"
const BACKUPS = "user-ops-backups"
const FIELD = "user-ops-field"

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
})

beforeEach(async () => {
  vi.clearAllMocks()
  process.env.RESEND_API_KEY = "re_test_key"
  await testDb.delete(schema.notifications)
  await testDb.delete(schema.cronRuns)
  await testDb.delete(schema.userRoles)
  await testDb.delete(schema.rolePermissions)
  await testDb.delete(schema.roles)
  await testDb.delete(schema.permissions)
  await testDb.delete(schema.users)
  await testDb.insert(schema.users).values([ADMIN, BACKUPS, FIELD].map((id) => ({
    id, name: id, email: `${id}@test`, hashedPassword: "x", isActive: true,
  })))
  await testDb.insert(schema.permissions).values([
    { id: "p-adm-ops", name: "admin:ops_settings", module: "admin" },
    { id: "p-adm-bkp", name: "admin:backups", module: "admin" },
  ])
  await testDb.insert(schema.roles).values([
    { id: "rol-admin", name: "administrador", label: "Administrador", isGlobal: true },
    { id: "rol-jefa", name: "jefa_chome", label: "Jefatura", isGlobal: true },
    { id: "rol-jt", name: "jefe_terreno", label: "Jefe de terreno", isGlobal: false },
  ])
  await testDb.insert(schema.rolePermissions).values([
    { roleId: "rol-admin", permissionId: "p-adm-ops" },
    { roleId: "rol-admin", permissionId: "p-adm-bkp" },
    { roleId: "rol-jefa", permissionId: "p-adm-bkp" },
  ])
  await testDb.insert(schema.userRoles).values([
    { userId: ADMIN, roleId: "rol-admin" },
    { userId: BACKUPS, roleId: "rol-jefa" },
    { userId: FIELD, roleId: "rol-jt" },
  ])
})

async function notificationsFor(userId: string) {
  const rows = await testDb.select().from(schema.notifications)
  return rows.filter((row) => row.userId === userId)
}

function integrityResult(overrides: Record<string, unknown> = {}) {
  return {
    ok: false, references: 12, checkedFiles: 10, missingCount: 2, checksumMismatchCount: 1, withoutChecksum: 0,
    missing: [
      { path: "storage/pdtp-evidence/perdida-1.pdf", owners: [] },
      { path: "storage/pdtp-evidence/perdida-2.pdf", owners: [] },
    ],
    checksumMismatches: [{ path: "storage/pdtp-evidence/alterada.pdf", expected: "a", actual: "b", owners: [] }],
    ...overrides,
  }
}

describe("alerta de un cron de Prevención que falla", () => {
  it("withCronLock avisa por la plataforma y por correo a quien administra la operación", async () => {
    await expect(withCronLock("prevention-capa-reminders", async () => { throw new Error("la base no respondió") }))
      .rejects.toThrow("la base no respondió")

    const [notice] = await notificationsFor(ADMIN)
    expect(notice?.type).toBe("system_alert")
    expect(notice?.title).toMatch(/prevention-capa-reminders/)
    expect(notice?.body).toMatch(/la base no respondió/)
    expect(await notificationsFor(FIELD)).toHaveLength(0)
    expect(await notificationsFor(BACKUPS)).toHaveLength(0)
    expect(mail.sendBatchEmails).toHaveBeenCalledTimes(1)
    expect(mail.sendBatchEmails.mock.calls[0]![0]).toEqual([expect.objectContaining({ to: `${ADMIN}@test` })])
  })

  it("como máximo una alerta por job y por día", async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(withCronLock("pdtp-weekly-reminders", async () => { throw new Error(`intento ${attempt}`) })).rejects.toThrow()
    }
    expect(await notificationsFor(ADMIN)).toHaveLength(1)
    expect(mail.sendBatchEmails).toHaveBeenCalledTimes(1)
    // Otro job el mismo día sí avisa: la llave es por job.
    await expect(withCronLock("prevention-incident-reminders", async () => { throw new Error("otro") })).rejects.toThrow()
    expect(await notificationsFor(ADMIN)).toHaveLength(2)
  })

  it("un cron de otro módulo no dispara la alerta de Prevención", async () => {
    await expect(withCronLock("fuel-copec-sync", async () => { throw new Error("copec caído") })).rejects.toThrow()
    expect(await notificationsFor(ADMIN)).toHaveLength(0)
    expect(mail.sendBatchEmails).not.toHaveBeenCalled()
  })

  it("una corrida exitosa no avisa", async () => {
    await withCronLock("prevention-capa-reminders", async () => ({ sent: 0 }))
    expect(await notificationsFor(ADMIN)).toHaveLength(0)
  })

  it("si la alerta misma falla, el cron sigue relanzando su propio error", async () => {
    await testDb.delete(schema.userRoles)
    await testDb.delete(schema.rolePermissions)
    await expect(withCronLock("prevention-cphs-alerts", async () => { throw new Error("original") }))
      .rejects.toThrow("original")
    expect(log.error).toHaveBeenCalledWith(expect.stringMatching(/nadie a quien avisar/))
  })

  it("los jobs de Prevención declarados incluyen el escaneo de integridad y el GC", () => {
    expect(PREVENTION_ALERT_JOBS).toEqual(expect.arrayContaining(["pdtp-evidence-integrity", "pdtp-evidence-gc", "pdtp-weekly-reminders"]))
  })
})

describe("alerta del escaneo de integridad de la evidencia PDTP", () => {
  it("avisa con conteos y una muestra de rutas a quienes pueden restaurar", async () => {
    await alertPdtpEvidenceIntegrityIssues(integrityResult())
    for (const userId of [ADMIN, BACKUPS]) {
      const [notice] = await notificationsFor(userId)
      expect(notice?.title).toMatch(/evidencia/i)
      expect(notice?.body).toMatch(/2 archivos? perdidos?/)
      expect(notice?.body).toMatch(/1 alterado/)
      expect(notice?.body).toMatch(/perdida-1\.pdf/)
    }
    expect(await notificationsFor(FIELD)).toHaveLength(0)
    expect(mail.sendBatchEmails).toHaveBeenCalledTimes(1)
  })

  it("sin hallazgos no avisa", async () => {
    await alertPdtpEvidenceIntegrityIssues(integrityResult({ ok: true, missingCount: 0, checksumMismatchCount: 0, missing: [], checksumMismatches: [] }))
    expect(await notificationsFor(ADMIN)).toHaveLength(0)
    expect(mail.sendBatchEmails).not.toHaveBeenCalled()
  })

  it("una vez por día aunque el escaneo corra varias veces", async () => {
    await alertPdtpEvidenceIntegrityIssues(integrityResult())
    await alertPdtpEvidenceIntegrityIssues(integrityResult())
    expect(await notificationsFor(ADMIN)).toHaveLength(1)
    expect(mail.sendBatchEmails).toHaveBeenCalledTimes(1)
  })
})

describe("sin correo configurado", () => {
  it("deja la alerta en la plataforma, lo registra y no lanza", async () => {
    delete process.env.RESEND_API_KEY
    await expect(alertPreventionCronFailure("prevention-training-reminders", new Error("x"))).resolves.toBeUndefined()
    expect(await notificationsFor(ADMIN)).toHaveLength(1)
    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/correo no configurado/i))
  })
})
