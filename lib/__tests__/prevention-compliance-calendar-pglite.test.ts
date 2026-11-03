/**
 * CHART-008: los tres lectores que alimentan el calendario de cumplimiento
 * faena × mes de capacitación y alcotest.
 *
 * Lo que se afirma aquí es lo que un calendario no puede equivocar sin que
 * nadie lo note: que muestre sólo lo que el usuario puede ver (alcance y
 * permiso), que cuente las MISMAS casillas que la lista que tiene debajo, y
 * que una faena que entró tarde al programa no arrastre el atraso de los meses
 * en que el programa todavía no la exigía.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import type { WorksiteScope } from "@/lib/auth/scope"

const pg = new PGlite()
const pgLiteDb = drizzle(pg, { schema })
const inMemoryDb = pgLiteDb as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const {
  ensurePreventionTrainingOccurrencesForWorksiteTx,
  listTrainingComplianceSlots,
  listTrainingOccurrences,
} = await import("@/lib/services/prevention-training-occurrences")
const { ensureAlcotestSlotsForWorksiteTx, resolveProgramActivationPeriods } = await import("@/lib/services/prevention-program-slots")
const { listAlcotestSlotsForCalendar } = await import("@/lib/services/prevention-alcotest-slots")

const YEAR = 2026
const USER_ID = "calendar-user"
const WS_A = "calendar-ws-a"
const WS_B = "calendar-ws-b"
const WS_INACTIVE = "calendar-ws-inactive"

const ALL: WorksiteScope = { mode: "all", ids: [] }
const only = (...ids: string[]): WorksiteScope => ({ mode: "some", ids })
const access = (scope: WorksiteScope, permissions: readonly string[] = ["prevention:training:view"]) => ({
  userId: USER_ID,
  scope,
  permissions,
})

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.preventionAlcotestSlotEvidence)
  await inMemoryDb.delete(schema.preventionAlcotestSlots)
  await inMemoryDb.delete(schema.preventionTrainingOccurrenceEvidence)
  await inMemoryDb.delete(schema.preventionTrainingOccurrences)
  await inMemoryDb.delete(schema.preventionTrainingCatalogItems)
  await inMemoryDb.delete(schema.pdtpProgramWorksites)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: USER_ID,
    name: "Prevencionista Calendario",
    email: "calendar@example.test",
    hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS_A, name: "Faena Alfa", code: "CAL-A", isActive: true },
    { id: WS_B, name: "Faena Beta", code: "CAL-B", isActive: true },
    { id: WS_INACTIVE, name: "Faena Cerrada", code: "CAL-X", isActive: false },
  ])
})

async function seedTraining(...worksiteIds: string[]) {
  for (const id of worksiteIds) await ensurePreventionTrainingOccurrencesForWorksiteTx(inMemoryDb, id, YEAR)
}

describe("listTrainingComplianceSlots", () => {
  it("cuenta las mismas casillas que la lista que tiene debajo, faena por faena", async () => {
    await seedTraining(WS_A, WS_B)
    const slots = await listTrainingComplianceSlots(access(ALL), { year: YEAR })
    const list = await listTrainingOccurrences(access(ALL), { year: YEAR })
    expect(slots).toHaveLength(list.length)
    for (const id of [WS_A, WS_B]) {
      expect(slots.filter((slot) => slot.worksiteId === id)).toHaveLength(list.filter((row) => row.worksiteId === id).length)
    }
    expect(slots.every((slot) => slot.status === "pending")).toBe(true)
    expect(slots.find((slot) => slot.worksiteId === WS_A)).toMatchObject({ worksiteName: "Faena Alfa" })
  })

  it("no ofrece la casilla pendiente que el catálogo vigente ya no pide: el calendario no pinta lo que la lista oculta", async () => {
    await seedTraining(WS_A)
    const [any] = await inMemoryDb.select({ catalogItemId: schema.preventionTrainingOccurrences.catalogItemId })
      .from(schema.preventionTrainingOccurrences)
      .where(eq(schema.preventionTrainingOccurrences.slotKey, "m09-w4")).limit(1)
    await inMemoryDb.insert(schema.preventionTrainingOccurrences).values({
      id: "occ-obsoleta-calendario", catalogItemId: any!.catalogItemId, worksiteId: WS_A, year: YEAR,
      slotKey: "m03-w2", scheduledMonth: 3, scheduledWeek: 2, status: "pending", version: 1,
    } as typeof schema.preventionTrainingOccurrences.$inferInsert)

    const slots = await listTrainingComplianceSlots(access(ALL), { year: YEAR })
    const list = await listTrainingOccurrences(access(ALL), { year: YEAR })
    expect(list.some((row) => row.id === "occ-obsoleta-calendario")).toBe(false)
    expect(slots).toHaveLength(list.length)
  })

  it("no incluye las faenas inactivas, salvo la que el usuario eligió y sólo dentro de su alcance", async () => {
    await seedTraining(WS_A, WS_INACTIVE)
    const sinElegir = await listTrainingComplianceSlots(access(ALL), { year: YEAR })
    expect(new Set(sinElegir.map((slot) => slot.worksiteId))).toEqual(new Set([WS_A]))

    const conElegida = await listTrainingComplianceSlots(access(ALL), { year: YEAR, includeWorksiteId: WS_INACTIVE })
    expect(new Set(conElegida.map((slot) => slot.worksiteId))).toEqual(new Set([WS_A, WS_INACTIVE]))

    // Pedir una faena inactiva fuera del alcance no la revela.
    const fueraDeAlcance = await listTrainingComplianceSlots(access(only(WS_A)), { year: YEAR, includeWorksiteId: WS_INACTIVE })
    expect(new Set(fueraDeAlcance.map((slot) => slot.worksiteId))).toEqual(new Set([WS_A]))
  })

  it("respeta el alcance de faenas y el permiso del usuario", async () => {
    await seedTraining(WS_A, WS_B)
    const acotado = await listTrainingComplianceSlots(access(only(WS_B)), { year: YEAR })
    expect(new Set(acotado.map((slot) => slot.worksiteId))).toEqual(new Set([WS_B]))

    expect(await listTrainingComplianceSlots(access({ mode: "none", ids: [] }), { year: YEAR })).toEqual([])
    expect(await listTrainingComplianceSlots(access(only()), { year: YEAR })).toEqual([])
    await expect(listTrainingComplianceSlots(access(ALL, []), { year: YEAR })).rejects.toThrow(/fuera de alcance/)
  })

  it("un año sin catálogo no devuelve nada", async () => {
    await seedTraining(WS_A)
    expect(await listTrainingComplianceSlots(access(ALL), { year: 1999 })).toEqual([])
  })
})

describe("listAlcotestSlotsForCalendar", () => {
  it("trae las casillas de todas las faenas del alcance en su forma mínima", async () => {
    await ensureAlcotestSlotsForWorksiteTx(inMemoryDb, WS_A, YEAR)
    await ensureAlcotestSlotsForWorksiteTx(inMemoryDb, WS_B, YEAR)

    const all = await listAlcotestSlotsForCalendar("all", YEAR)
    // 12 controles + 11 envíos por faena.
    expect(all).toHaveLength(46)
    expect(all.filter((slot) => slot.kind === "control")).toHaveLength(24)
    expect(all.filter((slot) => slot.kind === "envio")).toHaveLength(22)
    expect(all[0]).toEqual({
      worksiteId: expect.any(String),
      kind: expect.stringMatching(/control|envio/),
      scheduledMonth: expect.any(Number),
      scheduledWeek: expect.any(Number),
      status: "pending",
    })
  })

  it("acota por alcance: una lista vacía son cero faenas, nunca «todas»", async () => {
    await ensureAlcotestSlotsForWorksiteTx(inMemoryDb, WS_A, YEAR)
    await ensureAlcotestSlotsForWorksiteTx(inMemoryDb, WS_B, YEAR)

    const onlyA = await listAlcotestSlotsForCalendar([WS_A], YEAR)
    expect(new Set(onlyA.map((slot) => slot.worksiteId))).toEqual(new Set([WS_A]))
    expect(onlyA).toHaveLength(23)
    expect(await listAlcotestSlotsForCalendar([], YEAR)).toEqual([])
  })

  it("sólo devuelve el año pedido", async () => {
    await ensureAlcotestSlotsForWorksiteTx(inMemoryDb, WS_A, YEAR)
    expect(await listAlcotestSlotsForCalendar("all", YEAR + 1)).toEqual([])
  })
})

describe("resolveProgramActivationPeriods", () => {
  async function seedProgram(activatedAt: string | null) {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.pdtpPrograms).values({
      id: "calendar-program", version: 1, year: YEAR, title: `PDTP ${YEAR}`,
      status: "active", appliesToAllWorksites: true, elaboratedByName: "Prevencionista", elaboratedByTitle: "Experto en Prevención",
      creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
      activatedAt, createdAt: now, updatedAt: now,
    })
  }

  it("sin programa activo del año, nada se exige: cada faena queda sin fecha de activación", async () => {
    const result = await resolveProgramActivationPeriods([WS_A, WS_B], YEAR)
    expect([...result.entries()]).toEqual([[WS_A, null], [WS_B, null]])
  })

  it("sin faenas no consulta nada", async () => {
    expect((await resolveProgramActivationPeriods([], YEAR)).size).toBe(0)
  })

  it("cada faena hereda la activación del programa, y la que se incorporó después gana la más tardía", async () => {
    // 18-mar-2026 (día 18 → semana 3) y 6-may-2026 (día 6 → semana 1), a mediodía chileno.
    await seedProgram("2026-03-18T15:00:00.000Z")
    await inMemoryDb.insert(schema.pdtpProgramWorksites).values({
      id: "calendar-pw-b", programId: "calendar-program", worksiteId: WS_B, isActive: true, addedAt: "2026-05-06T15:00:00.000Z",
    })

    const result = await resolveProgramActivationPeriods([WS_A, WS_B, WS_A], YEAR)
    expect(result.get(WS_A)).toEqual({ year: 2026, month: 3, week: 3 })
    expect(result.get(WS_B)).toEqual({ year: 2026, month: 5, week: 1 })
    expect(result.size).toBe(2)
  })

  it("un programa activo sin fecha de activación registrada no recorta nada (programa importado)", async () => {
    await seedProgram(null)
    const result = await resolveProgramActivationPeriods([WS_A], YEAR)
    expect(result.get(WS_A)).toBeNull()
  })
})
