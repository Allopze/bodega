/**
 * lib/__tests__/pdtp-year-close.test.ts
 *
 * PREV-C03.6 (tanda T5): cierre anual manual y estricto (D21).
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

afterEach(() => vi.useRealTimers())

const YEAR = 2074
const USER_ID = "user-year-close"
const WS_A = "ws-close-a"
const WS_B = "ws-close-b"
const REASON = "Cierre anual revisado por Jefatura"

const { closePdtpProgramYear, getPdtpYearCloseReadiness } = await import("@/lib/services/pdtp/year-close")
const { archivePdtpProgram } = await import("@/lib/services/pdtp/lifecycle")

function at(date: string) {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(date))
}

async function seedVersion(version: number, status: string, activatedAt: string | null) {
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: `pdtp-${YEAR}-v${version}`, year: YEAR, version, status, title: `PDTP ${YEAR}`,
    elaboratedByName: "Prevención", elaboratedByTitle: "Sistema", creationMode: "blank",
    activatedAt, createdAt: now, updatedAt: now,
  })
}

async function addMember(programId: string, worksiteId: string, addedAt: string) {
  await inMemoryDb.insert(schema.pdtpProgramWorksites).values({
    id: `${programId}-${worksiteId}`, programId, worksiteId, isActive: true, addedAt,
  })
}

async function closeMonths(programId: string, worksiteId: string, months: number[]) {
  const now = new Date().toISOString()
  for (const month of months) {
    await inMemoryDb.insert(schema.pdtpPeriodClosures).values({
      id: `closure-${programId}-${worksiteId}-${month}`, programId, worksiteId, year: YEAR, month,
      status: "closed", snapshotJson: {}, digest: "x".repeat(64), closedByUserId: USER_ID,
      closedAt: now, closeReason: "Cierre mensual", createdAt: now, updatedAt: now,
    })
  }
}

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

beforeEach(async () => {
  vi.useRealTimers()
  await inMemoryDb.delete(schema.pdtpPeriodClosures)
  await inMemoryDb.delete(schema.pdtpProgramWorksites)
  await inMemoryDb.delete(schema.pdtpChangeLog)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)
  await inMemoryDb.insert(schema.users).values({ id: USER_ID, name: "Jefatura", email: "close@test", hashedPassword: "x" })
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS_A, name: "Faena A", code: "FA", isActive: true },
    { id: WS_B, name: "Faena B", code: "FB", isActive: true },
  ])
})

describe("qué meses debe cada faena (decisión 2026-09-26)", () => {
  it("una faena dada de baja en julio debe los meses completos anteriores, no los posteriores", async () => {
    await seedVersion(1, "active", `${YEAR}-01-02T12:00:00.000Z`)
    await addMember(`pdtp-${YEAR}-v1`, WS_A, `${YEAR}-01-01T12:00:00.000Z`)
    await addMember(`pdtp-${YEAR}-v1`, WS_B, `${YEAR}-01-01T12:00:00.000Z`)
    await closeMonths(`pdtp-${YEAR}-v1`, WS_A, ALL_MONTHS)
    await closeMonths(`pdtp-${YEAR}-v1`, WS_B, [1, 2, 3, 4])
    // Como la deja `setWorksiteActive`: membresía y faena inactivas, con fecha.
    await inMemoryDb.update(schema.pdtpProgramWorksites).set({ isActive: false }).where(eq(schema.pdtpProgramWorksites.worksiteId, WS_B))
    await inMemoryDb.update(schema.worksites).set({ isActive: false, deactivatedAt: `${YEAR}-07-15T15:00:00.000Z` }).where(eq(schema.worksites.id, WS_B))
    at(`${YEAR + 1}-01-20T15:00:00.000Z`)

    const readiness = await getPdtpYearCloseReadiness(`pdtp-${YEAR}-v1`)
    expect(readiness.missing).toEqual([{ worksiteId: WS_B, worksiteName: "Faena B", worksiteCode: "FB", months: [5, 6], deactivated: true }])

    await closeMonths(`pdtp-${YEAR}-v1`, WS_B, [5, 6])
    expect((await getPdtpYearCloseReadiness(`pdtp-${YEAR}-v1`)).canClose).toBe(true)
  })

  it("una faena dada de baja antes de la columna de fecha no debe nada: no se sabe cuándo dejó de operar", async () => {
    await seedVersion(1, "active", `${YEAR}-01-02T12:00:00.000Z`)
    await addMember(`pdtp-${YEAR}-v1`, WS_A, `${YEAR}-01-01T12:00:00.000Z`)
    await addMember(`pdtp-${YEAR}-v1`, WS_B, `${YEAR}-01-01T12:00:00.000Z`)
    await closeMonths(`pdtp-${YEAR}-v1`, WS_A, ALL_MONTHS)
    await inMemoryDb.update(schema.pdtpProgramWorksites).set({ isActive: false }).where(eq(schema.pdtpProgramWorksites.worksiteId, WS_B))
    await inMemoryDb.update(schema.worksites).set({ isActive: false }).where(eq(schema.worksites.id, WS_B))
    at(`${YEAR + 1}-01-20T15:00:00.000Z`)

    expect((await getPdtpYearCloseReadiness(`pdtp-${YEAR}-v1`)).missing).toEqual([])
  })

  it("en un programa corporativo, una faena creada en octubre debe desde octubre", async () => {
    await seedVersion(1, "active", `${YEAR}-01-02T12:00:00.000Z`)
    await inMemoryDb.update(schema.pdtpPrograms).set({ appliesToAllWorksites: true }).where(eq(schema.pdtpPrograms.id, `pdtp-${YEAR}-v1`))
    await inMemoryDb.update(schema.worksites).set({ createdAt: `${YEAR - 1}-06-01T12:00:00.000Z` }).where(eq(schema.worksites.id, WS_A))
    await inMemoryDb.update(schema.worksites).set({ createdAt: `${YEAR}-10-05T12:00:00.000Z` }).where(eq(schema.worksites.id, WS_B))
    await closeMonths(`pdtp-${YEAR}-v1`, WS_A, ALL_MONTHS)
    at(`${YEAR + 1}-01-20T15:00:00.000Z`)

    expect((await getPdtpYearCloseReadiness(`pdtp-${YEAR}-v1`)).missing)
      .toEqual([{ worksiteId: WS_B, worksiteName: "Faena B", months: [10, 11, 12] }])
  })
})

describe("closePdtpProgramYear — cuándo se puede", () => {
  it("cerrar el año exige alcance sobre todas las faenas: afecta a cada una", async () => {
    const { closePdtpProgramYear } = await import("@/lib/services/pdtp/year-close")
    await expect(closePdtpProgramYear(`pdtp-${YEAR}-v1`, USER_ID, REASON, ["ws-a"]))
      .rejects.toThrow(/alcance global de faenas/)
  })

  it("no cierra antes de que termine el año en Chile", async () => {
    await seedVersion(1, "active", `${YEAR}-01-02T12:00:00.000Z`)
    await addMember(`pdtp-${YEAR}-v1`, WS_A, `${YEAR}-01-01T12:00:00.000Z`)
    await closeMonths(`pdtp-${YEAR}-v1`, WS_A, ALL_MONTHS)
    // 31-dic 22:00 en Santiago = 1-ene 01:00 UTC: todavía es diciembre.
    at(`${YEAR + 1}-01-01T01:00:00.000Z`)
    await expect(closePdtpProgramYear(`pdtp-${YEAR}-v1`, USER_ID, REASON, "all")).rejects.toThrow(/todavía no termina/)
  })

  it("no cierra si a una faena operativa le falta un mes, y dice cuál", async () => {
    await seedVersion(1, "active", `${YEAR}-01-02T12:00:00.000Z`)
    await addMember(`pdtp-${YEAR}-v1`, WS_A, `${YEAR}-01-01T12:00:00.000Z`)
    await addMember(`pdtp-${YEAR}-v1`, WS_B, `${YEAR}-01-01T12:00:00.000Z`)
    await closeMonths(`pdtp-${YEAR}-v1`, WS_A, ALL_MONTHS)
    await closeMonths(`pdtp-${YEAR}-v1`, WS_B, ALL_MONTHS.filter((month) => month !== 12))
    at(`${YEAR + 1}-01-20T15:00:00.000Z`)

    const readiness = await getPdtpYearCloseReadiness(`pdtp-${YEAR}-v1`)
    expect(readiness.canClose).toBe(false)
    expect(readiness.missing).toEqual([{ worksiteId: WS_B, worksiteName: "Faena B", months: [12] }])
    await expect(closePdtpProgramYear(`pdtp-${YEAR}-v1`, USER_ID, REASON, "all")).rejects.toThrow(/Faena B: diciembre/)
  })

  it("una faena incorporada a mitad de año solo debe los meses desde su incorporación", async () => {
    await seedVersion(1, "active", `${YEAR}-01-02T12:00:00.000Z`)
    await addMember(`pdtp-${YEAR}-v1`, WS_A, `${YEAR}-01-01T12:00:00.000Z`)
    await addMember(`pdtp-${YEAR}-v1`, WS_B, `${YEAR}-10-10T12:00:00.000Z`)
    await closeMonths(`pdtp-${YEAR}-v1`, WS_A, ALL_MONTHS)
    await closeMonths(`pdtp-${YEAR}-v1`, WS_B, [10, 11, 12])
    at(`${YEAR + 1}-01-20T15:00:00.000Z`)
    expect((await getPdtpYearCloseReadiness(`pdtp-${YEAR}-v1`)).canClose).toBe(true)
  })

  it("no cierra con una revisión del año todavía abierta", async () => {
    await seedVersion(1, "active", `${YEAR}-01-02T12:00:00.000Z`)
    await seedVersion(2, "draft", null)
    await addMember(`pdtp-${YEAR}-v1`, WS_A, `${YEAR}-01-01T12:00:00.000Z`)
    await closeMonths(`pdtp-${YEAR}-v1`, WS_A, ALL_MONTHS)
    at(`${YEAR + 1}-01-20T15:00:00.000Z`)
    await expect(closePdtpProgramYear(`pdtp-${YEAR}-v1`, USER_ID, REASON, "all")).rejects.toThrow(/revisión abierta/)
  })
})

describe("closePdtpProgramYear — efecto", () => {
  it("acepta los cierres de cualquier versión del año y marca todas las versiones", async () => {
    // v1 vigente enero-junio (cerró sus meses), v2 desde julio.
    await seedVersion(1, "closed", `${YEAR}-01-02T12:00:00.000Z`)
    await seedVersion(2, "active", `${YEAR}-07-01T12:00:00.000Z`)
    await addMember(`pdtp-${YEAR}-v1`, WS_A, `${YEAR}-01-01T12:00:00.000Z`)
    await addMember(`pdtp-${YEAR}-v2`, WS_A, `${YEAR}-01-01T12:00:00.000Z`)
    await closeMonths(`pdtp-${YEAR}-v1`, WS_A, [1, 2, 3, 4, 5, 6])
    await closeMonths(`pdtp-${YEAR}-v2`, WS_A, [7, 8, 9, 10, 11, 12])
    at(`${YEAR + 1}-01-20T15:00:00.000Z`)

    const closed = await closePdtpProgramYear(`pdtp-${YEAR}-v2`, USER_ID, REASON, "all")
    expect(closed.status).toBe("closed")
    const versions = await inMemoryDb.select().from(schema.pdtpPrograms)
    expect(versions.every((version) => version.yearClosedAt !== null)).toBe(true)
    expect(versions.every((version) => version.yearClosedByUserId === USER_ID && version.yearCloseReason === REASON)).toBe(true)
    const [log] = await inMemoryDb.select().from(schema.pdtpChangeLog).where(eq(schema.pdtpChangeLog.programId, `pdtp-${YEAR}-v2`))
    expect(log?.note).toMatch(new RegExp(`Año ${YEAR} cerrado formalmente`))

    // Idempotente para el mismo usuario y motivo.
    await expect(closePdtpProgramYear(`pdtp-${YEAR}-v2`, USER_ID, REASON, "all")).resolves.toMatchObject({ id: `pdtp-${YEAR}-v2` })
  })

  /* Revisión final 2026-09-27 (hallazgo 3, T6 × T5): con la v2 activada a
   * mitad de marzo, las dos versiones cierran marzo por sus propias semanas
   * (cada cierre revisa sólo los pendientes de su versión). Contar cualquier
   * cierre dejaba cerrar el año con las semanas de marzo de la v1 sin
   * revisar. En un mes partido se exige el cierre de cada versión dueña. */
  it("en el mes partido por la activación exige el cierre de cada versión, y dice cuál falta", async () => {
    await seedVersion(1, "closed", `${YEAR}-01-02T12:00:00.000Z`)
    // Semana 3 de marzo.
    await seedVersion(2, "active", `${YEAR}-03-16T15:00:00.000Z`)
    await addMember(`pdtp-${YEAR}-v1`, WS_A, `${YEAR}-01-01T12:00:00.000Z`)
    await addMember(`pdtp-${YEAR}-v2`, WS_A, `${YEAR}-01-01T12:00:00.000Z`)
    await closeMonths(`pdtp-${YEAR}-v1`, WS_A, [1, 2])
    await closeMonths(`pdtp-${YEAR}-v2`, WS_A, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    at(`${YEAR + 1}-01-20T15:00:00.000Z`)

    const readiness = await getPdtpYearCloseReadiness(`pdtp-${YEAR}-v2`)
    expect(readiness.canClose).toBe(false)
    expect(readiness.missing).toEqual([expect.objectContaining({ worksiteId: WS_A, months: [3] })])
    expect(readiness.blockers.join(" ")).toMatch(/Faena A: marzo \(v1\)/)
    await expect(closePdtpProgramYear(`pdtp-${YEAR}-v2`, USER_ID, REASON, "all")).rejects.toThrow(/marzo \(v1\)/)

    await closeMonths(`pdtp-${YEAR}-v1`, WS_A, [3])
    expect((await getPdtpYearCloseReadiness(`pdtp-${YEAR}-v2`)).canClose).toBe(true)
  })

  it("en el mes partido, una faena que la v1 no operaba sólo debe el cierre de la v2", async () => {
    await seedVersion(1, "closed", `${YEAR}-01-02T12:00:00.000Z`)
    await seedVersion(2, "active", `${YEAR}-03-16T15:00:00.000Z`)
    await addMember(`pdtp-${YEAR}-v1`, WS_A, `${YEAR}-01-01T12:00:00.000Z`)
    await addMember(`pdtp-${YEAR}-v2`, WS_A, `${YEAR}-01-01T12:00:00.000Z`)
    // La faena B se incorporó recién con la v2, en marzo.
    await addMember(`pdtp-${YEAR}-v2`, WS_B, `${YEAR}-03-16T15:00:00.000Z`)
    await closeMonths(`pdtp-${YEAR}-v1`, WS_A, [1, 2, 3])
    await closeMonths(`pdtp-${YEAR}-v2`, WS_A, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    await closeMonths(`pdtp-${YEAR}-v2`, WS_B, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    at(`${YEAR + 1}-01-20T15:00:00.000Z`)
    expect((await getPdtpYearCloseReadiness(`pdtp-${YEAR}-v2`)).canClose).toBe(true)
  })

  it("un año cerrado no se puede archivar", async () => {
    await seedVersion(1, "active", `${YEAR}-01-02T12:00:00.000Z`)
    await addMember(`pdtp-${YEAR}-v1`, WS_A, `${YEAR}-01-01T12:00:00.000Z`)
    await closeMonths(`pdtp-${YEAR}-v1`, WS_A, ALL_MONTHS)
    at(`${YEAR + 1}-01-20T15:00:00.000Z`)
    await closePdtpProgramYear(`pdtp-${YEAR}-v1`, USER_ID, REASON, "all")
    await expect(archivePdtpProgram(`pdtp-${YEAR}-v1`, USER_ID, "Archivar el año ya cerrado")).rejects.toThrow(/año cerrado/)
  })

  it("el recordatorio de cierre pendiente avisa a quien puede cerrar el año qué falta", async () => {
    const { runPdtpYearCloseReminders } = await import("@/lib/services/pdtp/reminders")
    await inMemoryDb.delete(schema.notifications)
    await inMemoryDb.delete(schema.userPermissions)
    await inMemoryDb.delete(schema.permissions).where(eq(schema.permissions.name, "prevention:pdtp:lifecycle:manage"))
    await inMemoryDb.insert(schema.permissions).values({ id: "perm-lifecycle", name: "prevention:pdtp:lifecycle:manage", module: "prevention" })
    await inMemoryDb.insert(schema.userPermissions).values({ userId: USER_ID, permissionId: "perm-lifecycle" })
    await seedVersion(1, "active", `${YEAR}-01-02T12:00:00.000Z`)
    await addMember(`pdtp-${YEAR}-v1`, WS_A, `${YEAR}-01-01T12:00:00.000Z`)
    await closeMonths(`pdtp-${YEAR}-v1`, WS_A, ALL_MONTHS.filter((month) => month < 11))

    const result = await runPdtpYearCloseReminders(new Date(`${YEAR + 1}-01-12T15:00:00.000Z`))
    expect(result).toMatchObject({ closingYear: YEAR, canClose: false, pendingMonths: 2, notifiedUsers: 1 })
    const [notification] = await inMemoryDb.select().from(schema.notifications)
    expect(notification?.body).toMatch(/faltan 2 cierres mensuales/)

    // Durante el año en curso no hay nada que avisar.
    expect((await runPdtpYearCloseReminders(new Date(`${YEAR}-06-12T15:00:00.000Z`))).closingYear).toBeNull()
  })

  it("un mes de un año cerrado no se puede reabrir", async () => {
    const { reopenPdtpPeriod } = await import("@/lib/services/pdtp/period-closures")
    await seedVersion(1, "active", `${YEAR}-01-02T12:00:00.000Z`)
    await addMember(`pdtp-${YEAR}-v1`, WS_A, `${YEAR}-01-01T12:00:00.000Z`)
    await closeMonths(`pdtp-${YEAR}-v1`, WS_A, ALL_MONTHS)
    at(`${YEAR + 1}-01-20T15:00:00.000Z`)
    await closePdtpProgramYear(`pdtp-${YEAR}-v1`, USER_ID, REASON, "all")
    await expect(reopenPdtpPeriod(
      { closureId: `closure-pdtp-${YEAR}-v1-${WS_A}-6`, reason: "Corregir un registro de junio" },
      USER_ID,
      "all",
    )).rejects.toThrow(/año .* cerrado/)
  })
})
