/**
 * Los datos del calendario de cierres mensuales del PDTP (CHART-008).
 *
 * Lo que protege, en orden de gravedad:
 *
 * 1. **El alcance de faenas.** Quien ve la faena A no ve las filas ni los cierres
 *    de la B.
 * 2. **La misma regla que el cierre anual.** El cierre de cualquier versión del
 *    año cuenta, la incorporación más antigua gana, un cierre reabierto no vale
 *    y una faena dada de baja debe sólo los meses anteriores a su baja.
 * 3. **Un programa sin activar no exige nada** (no dibuja deuda sobre un borrador).
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

const { getPdtpClosureCalendarData } = await import("@/lib/services/pdtp/closure-calendar")

const YEAR = 2026
const USER = "u-closure-cal"
const WS_A = "ws-closure-a"
const WS_B = "ws-closure-b"
const WS_BAJA = "ws-closure-baja"
const V1 = "pdtp-cal-2026-v1"
const V2 = "pdtp-cal-2026-v2"
const DRAFT_YEAR_PROGRAM = "pdtp-cal-2027-draft"
const NOW = "2026-06-10T12:00:00.000Z"

async function seedProgram(id: string, version: number, year: number, status: string, activatedAt: string | null) {
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id, year, version, status, title: `PDTP ${year}`, elaboratedByName: "Prevención", elaboratedByTitle: "Sistema",
    creationMode: "blank", appliesToAllWorksites: false, activatedAt, createdAt: NOW, updatedAt: NOW,
  })
}
async function seedMember(programId: string, worksiteId: string, addedAt: string) {
  await inMemoryDb.insert(schema.pdtpProgramWorksites).values({ id: `${programId}-${worksiteId}`, programId, worksiteId, isActive: true, addedAt })
}
async function seedClosure(programId: string, worksiteId: string, month: number, status: "closed" | "reopened" = "closed") {
  await inMemoryDb.insert(schema.pdtpPeriodClosures).values({
    id: `cl-${programId}-${worksiteId}-${month}`, programId, worksiteId, year: YEAR, month, status, version: 1,
    snapshotJson: {}, digest: "a".repeat(64), closedByUserId: USER, closedAt: NOW,
    closeReason: "Mes revisado y conciliado con la jefatura.",
    ...(status === "reopened" ? { reopenedByUserId: USER, reopenedAt: NOW, reopenReason: "Se corrige una ejecución mal fechada." } : {}),
    distributionJson: [], createdAt: NOW, updatedAt: NOW,
  })
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await inMemoryDb.insert(schema.users).values({ id: USER, name: "Prevencionista", email: "cierres@cal.test", hashedPassword: "x" })
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS_A, name: "Faena Alfa", code: "CCA", isActive: true, createdAt: "2025-01-01T12:00:00.000Z" },
    { id: WS_B, name: "Faena Beta", code: "CCB", isActive: true, createdAt: "2025-01-01T12:00:00.000Z" },
    { id: WS_BAJA, name: "Faena Baja", code: "CCX", isActive: false, deactivatedAt: "2026-05-15T12:00:00.000Z", createdAt: "2025-01-01T12:00:00.000Z" },
  ])

  // Año 2026: v1 activa desde febrero; v2 activada en abril (cierres de la v1 siguen valiendo).
  await seedProgram(V1, 1, YEAR, "closed", "2026-02-03T12:00:00.000Z")
  await seedProgram(V2, 2, YEAR, "active", "2026-04-07T12:00:00.000Z")
  await seedMember(V1, WS_A, "2026-02-03T12:00:00.000Z")
  await seedMember(V2, WS_A, "2026-04-07T12:00:00.000Z")
  // La faena B se incorporó en abril, ya con la v2.
  await seedMember(V2, WS_B, "2026-04-20T12:00:00.000Z")
  await seedMember(V1, WS_BAJA, "2026-02-03T12:00:00.000Z")
  await inMemoryDb.update(schema.pdtpProgramWorksites).set({ isActive: false }).where(
    (await import("drizzle-orm")).eq(schema.pdtpProgramWorksites.worksiteId, WS_BAJA),
  )

  // Cierres: A cerró febrero y marzo con la v1 y abril con la v2; marzo de B está reabierto; la faena de baja cerró febrero.
  await seedClosure(V1, WS_A, 2)
  await seedClosure(V1, WS_A, 3)
  await seedClosure(V2, WS_A, 4)
  await seedClosure(V2, WS_B, 4, "reopened")
  await seedClosure(V1, WS_BAJA, 2)

  // Año 2027: un borrador que nunca se activó.
  await seedProgram(DRAFT_YEAR_PROGRAM, 1, 2027, "draft", null)
})

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

describe("getPdtpClosureCalendarData", () => {
  it("el cierre de cualquier versión del año vale y la exigibilidad parte con la primera activación", async () => {
    const data = await getPdtpClosureCalendarData(V2, "all")
    expect(data?.year).toBe(YEAR)
    const alfa = data!.worksites.find((row) => row.id === WS_A)!
    // Activada en febrero (v1), no en abril (v2): febrero a diciembre.
    expect(alfa).toMatchObject({ label: "Faena Alfa", firstMonth: 2, lastMonth: 12 })
    expect([...data!.closedMonths.get(WS_A)!].sort()).toEqual([2, 3, 4])
  })

  it("la incorporación de la faena marca desde cuándo se le debe", async () => {
    const data = await getPdtpClosureCalendarData(V2, "all")
    expect(data!.worksites.find((row) => row.id === WS_B)).toMatchObject({ firstMonth: 4, lastMonth: 12 })
  })

  it("un cierre reabierto no cuenta como cerrado", async () => {
    const data = await getPdtpClosureCalendarData(V2, "all")
    expect(data!.closedMonths.get(WS_B)).toBeUndefined()
  })

  it("una faena dada de baja con cierres sigue en el calendario y sólo debe los meses anteriores a su baja", async () => {
    const data = await getPdtpClosureCalendarData(V2, "all")
    // Baja el 15 de mayo: debe hasta abril.
    expect(data!.worksites.find((row) => row.id === WS_BAJA)).toMatchObject({ firstMonth: 2, lastMonth: 4 })
    expect([...data!.closedMonths.get(WS_BAJA)!]).toEqual([2])
  })

  it("quien ve sólo la faena A no recibe ni la fila ni los cierres de la B ni de la de baja", async () => {
    const data = await getPdtpClosureCalendarData(V2, [WS_A])
    expect(data!.worksites.map((row) => row.id)).toEqual([WS_A])
    expect([...data!.closedMonths.keys()]).toEqual([WS_A])
  })

  it("sin faenas en el alcance no hay calendario", async () => {
    const data = await getPdtpClosureCalendarData(V2, [])
    expect(data).toMatchObject({ year: YEAR, worksites: [] })
    expect(data!.closedMonths.size).toBe(0)
  })

  it("un programa que nunca se activó no exige nada", async () => {
    const data = await getPdtpClosureCalendarData(DRAFT_YEAR_PROGRAM, "all")
    expect(data).toMatchObject({ year: 2027, worksites: [] })
  })

  it("un programa que no existe devuelve null", async () => {
    expect(await getPdtpClosureCalendarData("no-existe", "all")).toBeNull()
  })
})
