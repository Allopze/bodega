/**
 * Prueba contra PGlite del backfill de las 12 sesiones ordinarias del CPHS
 * (Task 10, ronda de corrección 1): un programa `active` "de antes" de la
 * migración 0322 —simulado acá insertando el estado directamente, sin pasar
 * por `activateProgram`, igual que quedaron los programas reales creados
 * antes de este cambio— no tiene ninguna fila `isMandatorySession`. El script
 * debe llenarlas, y reejecutarlo no debe duplicar ni fallar.
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

import { backfillCphsMandatorySessions } from "@/scripts/backfill-cphs-mandatory-sessions"

const USER_ID = "user-backfill-cphs"
const WORKSITE_ID = "ws-backfill-cphs"
const COMMITTEE_ID = "cphs-backfill"
const PROGRAM_ID = "cphspg-backfill-2026"

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  const now = new Date().toISOString()

  await inMemoryDb.insert(schema.users).values({
    id: USER_ID, name: "Prevencionista", email: "backfill-cphs@example.test", hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: WORKSITE_ID, name: "Faena Backfill", code: "BKF", isActive: true,
  })
  await inMemoryDb.insert(schema.preventionCommittees).values({
    id: COMMITTEE_ID, worksiteId: WORKSITE_ID, name: "CPHS Backfill",
    constitutedOn: "2026-01-15", mandateEndsOn: "2028-01-15", createdByUserId: USER_ID,
  })

  // Estado "pre-migración": un programa ya `active`, aprobado antes de que
  // existiera `isMandatorySession`, con una sola actividad manual y CERO
  // filas de sesión — exactamente como quedaron los programas reales creados
  // antes de la migración 0322 (ver el docblock del script).
  await inMemoryDb.insert(schema.preventionCommitteePrograms).values({
    id: PROGRAM_ID, committeeId: COMMITTEE_ID, year: 2026, status: "active",
    approvedByUserId: USER_ID, approvedAt: now, version: 2, createdByUserId: USER_ID,
  })
  await inMemoryDb.insert(schema.preventionCommitteeProgramActivities).values({
    id: "cphspa-backfill-manual", programId: PROGRAM_ID, title: "Difusión ya cargada antes del backfill",
    plannedMonth: 3, createdByUserId: USER_ID,
  })
})

afterAll(async () => { await pg.close() })

describe("backfillCphsMandatorySessions()", () => {
  it("llena las 12 sesiones de un programa active que quedó sin ellas", async () => {
    const report = await backfillCphsMandatorySessions()

    expect(report.modo).toBe("aplicado")
    expect(report.programasActivos).toBe(1)
    expect(report.creadas).toBe(12)
    expect(report.detalle).toEqual([{ programId: PROGRAM_ID, year: 2026, creadas: 12 }])

    const sessions = await inMemoryDb.select().from(schema.preventionCommitteeProgramActivities)
      .where(and(
        eq(schema.preventionCommitteeProgramActivities.programId, PROGRAM_ID),
        eq(schema.preventionCommitteeProgramActivities.isMandatorySession, true),
      ))
    expect(sessions).toHaveLength(12)
    expect(sessions.map((row) => row.plannedMonth).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 12 }, (_, index) => index + 1))
    expect(sessions.every((row) => row.status === "planned")).toBe(true)

    // La actividad manual que ya tenía antes del backfill sigue intacta.
    const manual = await inMemoryDb.select().from(schema.preventionCommitteeProgramActivities)
      .where(eq(schema.preventionCommitteeProgramActivities.id, "cphspa-backfill-manual"))
    expect(manual).toHaveLength(1)
  })

  it("reejecutarlo no falla ni duplica", async () => {
    const second = await backfillCphsMandatorySessions()

    // Ya no crea nada: las 12 filas del programa ya existen (idempotencia por
    // id determinístico + onConflictDoNothing).
    expect(second.creadas).toBe(0)
    expect(second.detalle).toEqual([])

    const sessions = await inMemoryDb.select().from(schema.preventionCommitteeProgramActivities)
      .where(and(
        eq(schema.preventionCommitteeProgramActivities.programId, PROGRAM_ID),
        eq(schema.preventionCommitteeProgramActivities.isMandatorySession, true),
      ))
    expect(sessions).toHaveLength(12)

    // Y el total del programa (12 sesiones + 1 manual) tampoco creció.
    const total = await inMemoryDb.select().from(schema.preventionCommitteeProgramActivities)
      .where(eq(schema.preventionCommitteeProgramActivities.programId, PROGRAM_ID))
    expect(total).toHaveLength(13)
  })

  it("no toca un programa `draft`: sólo backfillea los `active`", async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.preventionCommitteePrograms).values({
      id: "cphspg-backfill-draft-2027", committeeId: COMMITTEE_ID, year: 2027, status: "draft",
      version: 1, createdByUserId: USER_ID, createdAt: now, updatedAt: now,
    })

    const report = await backfillCphsMandatorySessions()
    expect(report.detalle.some((row) => row.programId === "cphspg-backfill-draft-2027")).toBe(false)

    const draftSessions = await inMemoryDb.select().from(schema.preventionCommitteeProgramActivities)
      .where(eq(schema.preventionCommitteeProgramActivities.programId, "cphspg-backfill-draft-2027"))
    expect(draftSessions).toHaveLength(0)
  })
})
