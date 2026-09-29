/**
 * PRV-13 (auditoría de production readiness 2026-09-28): `audit_log` y
 * `pdtp_change_log` son de sólo agregar. Esta suite apaga la excepción de
 * mantenimiento que `migratePGlite` enciende para los fixtures y ejercita el
 * trigger tal como corre en producción.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const tdb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof tdb }
// @ts-expect-error PGlite es compatible en tiempo de ejecución
testGlobal.__db = tdb
await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

beforeAll(async () => {
  await tdb.insert(schema.users).values({ id: "u-audit", name: "Audita", email: "audit@t", hashedPassword: "x", isActive: true })
  await pg.exec("SET app.audit_maintenance = 'off'")
})
afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

/** Drizzle envuelve el error de Postgres; el mensaje del trigger viaja en `cause`. */
async function expectAppendOnly(operation: Promise<unknown>) {
  const error = await operation.then(() => null, (err: unknown) => err as Error & { cause?: Error })
  expect(error, "la operación debía rechazarse").not.toBeNull()
  expect(`${error!.message} ${error!.cause?.message ?? ""}`).toMatch(/sólo agregar/)
}

describe("bitácora de sólo agregar", () => {
  it("rechaza editar o borrar una fila de audit_log", async () => {
    await tdb.insert(schema.auditLog).values({ id: "al-1", userId: "u-audit", action: "update", entityType: "pdtp:execution", entityId: "e-1", createdAt: new Date().toISOString() })
    await expectAppendOnly(tdb.update(schema.auditLog).set({ reason: "reescrita" }).where(eq(schema.auditLog.id, "al-1")))
    await expectAppendOnly(tdb.delete(schema.auditLog).where(eq(schema.auditLog.id, "al-1")))
    const [row] = await tdb.select().from(schema.auditLog).where(eq(schema.auditLog.id, "al-1"))
    expect(row?.reason ?? null).toBeNull()
  })

  it("una faena con bitácora no se borra físicamente: su SET NULL también es una edición", async () => {
    await tdb.insert(schema.worksites).values({ id: "ws-audit", name: "Faena con bitácora", code: "AUD1", isActive: true })
    await tdb.insert(schema.auditLog).values({ id: "al-ws", userId: "u-audit", action: "update", entityType: "x", entityId: "y", worksiteId: "ws-audit", createdAt: new Date().toISOString() })
    await expectAppendOnly(tdb.delete(schema.worksites).where(eq(schema.worksites.id, "ws-audit")))
  })

  it("la limpieza por retención legal sí borra lo que tiene más de 6 años", async () => {
    await tdb.insert(schema.auditLog).values({ id: "al-viejo", userId: "u-audit", action: "update", entityType: "x", entityId: "y", createdAt: "2015-01-01T00:00:00.000Z" })
    const result = await pg.query<{ deleted: string }>("SELECT cleanup_old_audit_log(6) AS deleted")
    expect(Number(result.rows[0]!.deleted)).toBe(1)
    expect(await tdb.select().from(schema.auditLog).where(eq(schema.auditLog.id, "al-viejo"))).toHaveLength(0)
    // Y la excepción no quedó encendida después de la llamada.
    await expectAppendOnly(tdb.delete(schema.auditLog).where(eq(schema.auditLog.id, "al-1")))
  })

  it("borrar un borrador arrastra su changelog y deja el resumen en audit_log (M-19)", async () => {
    const { createLegacyPdtpProgramForTests } = await import("@/lib/services/prevention-pdtp")
    const { deletePdtpProgram } = await import("@/lib/services/pdtp/programs")
    const program = await createLegacyPdtpProgramForTests({ year: 2030, title: "Borrador a borrar", userId: "u-audit" })
    await tdb.insert(schema.pdtpChangeLog).values({ id: "cl-1", programId: program.id, version: 1, changedByUserId: "u-audit", changedAt: new Date().toISOString(), section: "program" })
    await expectAppendOnly(tdb.delete(schema.pdtpChangeLog).where(eq(schema.pdtpChangeLog.id, "cl-1")))

    await deletePdtpProgram(program.id, "u-audit")

    expect(await tdb.select().from(schema.pdtpPrograms).where(eq(schema.pdtpPrograms.id, program.id))).toHaveLength(0)
    expect(await tdb.select().from(schema.pdtpChangeLog).where(eq(schema.pdtpChangeLog.id, "cl-1"))).toHaveLength(0)
    const [summary] = await tdb.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, program.id))
    expect(summary).toMatchObject({ action: "delete", entityType: "pdtp_program", userId: "u-audit" })
  })

  it("crear y borrar una hoja deja rastro en el control de cambios (M-19)", async () => {
    const { createLegacyPdtpProgramForTests } = await import("@/lib/services/prevention-pdtp")
    const { createPdtpSheet, deletePdtpSheet } = await import("@/lib/services/pdtp/sheet-management")
    const program = await createLegacyPdtpProgramForTests({ year: 2031, title: "Borrador con hojas", userId: "u-audit" })
    const sheet = await createPdtpSheet({ programId: program.id, code: "ZZ", label: "Hoja de prueba", area: "SST" }, "u-audit")
    await deletePdtpSheet(sheet.id, program.id, "u-audit")
    const entries = await tdb.select().from(schema.pdtpChangeLog).where(eq(schema.pdtpChangeLog.section, "sheet:ZZ"))
    expect(entries.map((entry) => entry.note).sort()).toEqual(['Hoja "Hoja de prueba" (ZZ) creada.', 'Hoja "Hoja de prueba" (ZZ) eliminada.'])
    expect(entries.every((entry) => entry.changedByUserId === "u-audit")).toBe(true)
  })
})
