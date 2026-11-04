/**
 * Qué meses sesionó cada comité (CHART-008, calendario de sesiones del CPHS).
 *
 * Protege: el alcance de faenas (quien ve la A no ve los comités de la B), que sólo
 * cuente actas cerradas, el mes civil de Chile, el año pedido, y que una sesión
 * extraordinaria en el mismo mes no duplique el mes.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import type { WorksiteScope } from "@/lib/auth/scope"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

const { listCommitteeSessionMonths } = await import("@/lib/services/prevention-cphs")

const USER = "u-cphs-months"
const WS_A = "ws-cphs-a"
const WS_B = "ws-cphs-b"
const C_A = "cphs-a"
const C_B = "cphs-b"
const VIEW = "prevention:cphs:view"
const ALL: WorksiteScope = { mode: "all", ids: [] }
const ONLY_A: WorksiteScope = { mode: "some", ids: [WS_A] }
const NONE: WorksiteScope = { mode: "none", ids: [] }
const accessOf = (scope: WorksiteScope, permissions: string[] = [VIEW]) => ({ userId: USER, scope, permissions })

let counter = 0
async function seedMeeting(committeeId: string, status: "scheduled" | "closed" | "cancelled", heldAt: string | null, type: "ordinary" | "extraordinary" = "ordinary") {
  counter += 1
  await inMemoryDb.insert(schema.preventionCommitteeMeetings).values({
    id: `mtg-${counter}`, code: `SES-${counter}`, committeeId, meetingType: type,
    scheduledFor: heldAt ?? "2026-09-15T15:00:00.000Z", heldAt, agenda: "Tabla de la sesión",
    status,
    ...(status === "closed" ? { minutes: "Acta de la sesión con quórum y acuerdos registrados.", quorumReached: true, closedByUserId: USER, closedAt: heldAt } : {}),
    ...(status === "cancelled" ? { cancellationReason: "No se pudo convocar a tiempo." } : {}),
    createdByUserId: USER,
  })
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await inMemoryDb.insert(schema.users).values({ id: USER, name: "Prevencionista", email: "cphs@months.test", hashedPassword: "x" })
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS_A, name: "Faena A", code: "CPA", isActive: true },
    { id: WS_B, name: "Faena B", code: "CPB", isActive: true },
  ])
  await inMemoryDb.insert(schema.preventionCommittees).values([
    { id: C_A, worksiteId: WS_A, name: "Comité A", constitutedOn: "2025-01-10", mandateEndsOn: "2027-01-10", status: "active", createdByUserId: USER },
    { id: C_B, worksiteId: WS_B, name: "Comité B", constitutedOn: "2025-01-10", mandateEndsOn: "2027-01-10", status: "active", createdByUserId: USER },
  ])

  // Comité A en 2026: cerradas en febrero (dos: ordinaria y extraordinaria) y marzo.
  await seedMeeting(C_A, "closed", "2026-02-10T15:00:00.000Z")
  await seedMeeting(C_A, "closed", "2026-02-24T15:00:00.000Z", "extraordinary")
  await seedMeeting(C_A, "closed", "2026-03-10T15:00:00.000Z")
  // No cuentan: convocada, cancelada.
  await seedMeeting(C_A, "scheduled", null)
  await seedMeeting(C_A, "cancelled", null)
  // 31 de agosto, 22:00 en Santiago (UTC-4) = 1 de septiembre 02:00 UTC: es de agosto.
  await seedMeeting(C_A, "closed", "2026-09-01T02:00:00.000Z")
  // Otro año.
  await seedMeeting(C_A, "closed", "2025-05-10T15:00:00.000Z")
  // Comité B: abril.
  await seedMeeting(C_B, "closed", "2026-04-10T15:00:00.000Z")
})

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const monthsOf = (rows: Array<{ committeeId: string; month: number }>, committeeId: string) =>
  rows.filter((row) => row.committeeId === committeeId).map((row) => row.month).sort((a, b) => a - b)

describe("listCommitteeSessionMonths", () => {
  it("cuenta un mes una sola vez aunque haya dos actas cerradas, y sólo las cerradas", async () => {
    const rows = await listCommitteeSessionMonths(accessOf(ALL), 2026)
    // Febrero (dos actas), marzo y agosto (la del 31 a las 22:00). La convocada y la cancelada no cuentan.
    expect(monthsOf(rows, C_A)).toEqual([2, 3, 8])
  })

  it("el mes es el civil chileno: el 31 de agosto a las 22:00 es de agosto, no de septiembre", async () => {
    const rows = await listCommitteeSessionMonths(accessOf(ALL), 2026)
    expect(monthsOf(rows, C_A)).toContain(8)
    expect(monthsOf(rows, C_A)).not.toContain(9)
  })

  it("quien ve sólo la faena A no recibe el comité B", async () => {
    const rows = await listCommitteeSessionMonths(accessOf(ONLY_A), 2026)
    expect(rows.map((row) => row.committeeId)).not.toContain(C_B)
    expect(monthsOf(rows, C_A)).toEqual([2, 3, 8])
  })

  it("con alcance total se ven los dos comités", async () => {
    const rows = await listCommitteeSessionMonths(accessOf(ALL), 2026)
    expect(monthsOf(rows, C_B)).toEqual([4])
  })

  it("sin faenas en el alcance no hay nada", async () => {
    expect(await listCommitteeSessionMonths(accessOf(NONE), 2026)).toEqual([])
  })

  it("respeta el año pedido", async () => {
    const rows = await listCommitteeSessionMonths(accessOf(ALL), 2025)
    expect(monthsOf(rows, C_A)).toEqual([5])
    expect(monthsOf(rows, C_B)).toEqual([])
  })

  it("sin el permiso de ver, falla como el resto de las consultas del módulo", async () => {
    await expect(listCommitteeSessionMonths(accessOf(ALL, []), 2026)).rejects.toThrow()
  })
})
