/**
 * CHART-008 en simulacros, CGRD e higiene: el lector común de casillas por faena.
 *
 * Protege el alcance (quien ve la faena A no ve las casillas ni el plan de la B),
 * que las faenas inactivas no aparezcan como fila, que cada tipo lea SU tabla, y
 * que el calendario use el estado real de la casilla. `today` va fijo: ninguna
 * aserción depende del mes en que corre la prueba.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { and, eq } from "drizzle-orm"
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
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { listProgramSlotsForCalendar, loadProgramSlotCalendar, listCurrentEmergencyPlanIds } = await import("@/lib/services/prevention-program-calendar")
const slots = await import("@/lib/services/prevention-program-slots")

const YEAR = 2026
const USER = "u-prog-cal"
const WS_A = "ws-pcal-a"
const WS_B = "ws-pcal-b"
const WS_OFF = "ws-pcal-off"
// Junio de 2026, semana 2: marzo ya venció, septiembre es futuro.
const TODAY = { year: 2026, month: 6, week: 2 }

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await inMemoryDb.insert(schema.users).values({ id: USER, name: "Prevencionista", email: "pcal@test.cl", hashedPassword: "x" })
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS_A, name: "Faena Alfa", code: "PCA", isActive: true },
    { id: WS_B, name: "Faena Beta", code: "PCB", isActive: true },
    { id: WS_OFF, name: "Faena Cerrada", code: "PCX", isActive: false },
  ])
  // Sin programa activo se siembra el año base: 2 simulacros, 4 actas de CGRD y 1 medición de higiene por faena.
  for (const id of [WS_A, WS_B, WS_OFF]) {
    await slots.ensureEmergencyDrillSlotsForWorksiteTx(inMemoryDb, id, YEAR)
    await slots.ensureGrdMeetingSlotsForWorksiteTx(inMemoryDb, id, YEAR)
    await slots.ensureHygieneMeasurementSlotsForWorksiteTx(inMemoryDb, id, YEAR)
  }
  // La casilla de marzo de Alfa se declara «no hecha».
  await inMemoryDb.update(schema.preventionEmergencyDrillSlots).set({ status: "not_completed" })
    .where(and(eq(schema.preventionEmergencyDrillSlots.worksiteId, WS_A), eq(schema.preventionEmergencyDrillSlots.scheduledMonth, 3)))

  await inMemoryDb.insert(schema.preventionEmergencyPlans).values([
    { id: "plan-a", worksiteId: WS_A, code: "PE-A", title: "Plan Alfa", status: "draft", createdByUserId: USER },
    { id: "plan-a-old", worksiteId: WS_A, code: "PE-A0", title: "Plan Alfa anterior", status: "archived", createdByUserId: USER },
    { id: "plan-b", worksiteId: WS_B, code: "PE-B", title: "Plan Beta", status: "draft", createdByUserId: USER },
  ])
})

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

describe("listProgramSlotsForCalendar", () => {
  it("cada tipo lee su tabla: simulacros 2, CGRD 4 e higiene 1 por faena", async () => {
    expect(await listProgramSlotsForCalendar("drills", "all", YEAR)).toHaveLength(4)
    expect(await listProgramSlotsForCalendar("grd", "all", YEAR)).toHaveLength(8)
    expect(await listProgramSlotsForCalendar("hygiene", "all", YEAR)).toHaveLength(2)
  })

  it("las faenas inactivas no son una fila", async () => {
    const rows = await listProgramSlotsForCalendar("grd", "all", YEAR)
    expect(rows.map((row) => row.worksiteId)).not.toContain(WS_OFF)
  })

  it("quien ve sólo la faena A no recibe las casillas de la B, de ningún tipo", async () => {
    for (const kind of ["drills", "grd", "hygiene"] as const) {
      const rows = await listProgramSlotsForCalendar(kind, [WS_A], YEAR)
      expect(new Set(rows.map((row) => row.worksiteId))).toEqual(new Set([WS_A]))
    }
  })

  it("un alcance vacío son cero filas, nunca «sin filtro»", async () => {
    expect(await listProgramSlotsForCalendar("drills", [], YEAR)).toEqual([])
  })

  it("trae el nombre de la faena y respeta el año pedido", async () => {
    const [row] = await listProgramSlotsForCalendar("hygiene", [WS_A], YEAR)
    expect(row).toMatchObject({ worksiteName: "Faena Alfa", scheduledMonth: 2, scheduledWeek: 2, status: "pending" })
    expect(await listProgramSlotsForCalendar("hygiene", "all", 2031)).toEqual([])
  })
})

describe("loadProgramSlotCalendar", () => {
  it("arma una fila por faena activa, ordenada por nombre, con el estado real de cada casilla", async () => {
    const calendar = await loadProgramSlotCalendar("drills", "all", YEAR, TODAY)
    expect(calendar.rows.map((row) => row.label)).toEqual(["Faena Alfa", "Faena Beta"])
    const alfa = calendar.rows[0]!
    // Marzo: declarada «no hecha» y su mes ya venció. Septiembre: pendiente futuro.
    expect(alfa.cells[2]).toMatchObject({ status: "missing", exigible: 1, completed: 0, missed: 1 })
    expect(alfa.cells[8]).toMatchObject({ status: "upcoming", missed: 0 })
    // Beta no declaró nada, pero marzo ya terminó: vencida igual.
    expect(calendar.rows[1]!.cells[2]!.status).toBe("missing")
  })

  it("con alcance A sólo hay una fila", async () => {
    const calendar = await loadProgramSlotCalendar("grd", [WS_A], YEAR, TODAY)
    expect(calendar.rows.map((row) => row.id)).toEqual([WS_A])
    // Febrero a mayo, semana 1: cuatro meses vencidos a junio.
    expect(calendar.rows[0]!.missed).toBe(4)
  })

  it("higiene: una sola celda exigible por faena", async () => {
    const calendar = await loadProgramSlotCalendar("hygiene", "all", YEAR, TODAY)
    for (const row of calendar.rows) expect(row.cells.filter((cell) => cell.status !== "na")).toHaveLength(1)
  })
})

describe("listCurrentEmergencyPlanIds", () => {
  it("devuelve el plan vigente de cada faena y no el archivado", async () => {
    const plans = await listCurrentEmergencyPlanIds("all")
    expect(plans.get(WS_A)).toBe("plan-a")
    expect(plans.get(WS_B)).toBe("plan-b")
  })

  it("respeta el alcance: la faena B no aparece para quien sólo ve la A", async () => {
    const plans = await listCurrentEmergencyPlanIds([WS_A])
    expect([...plans.keys()]).toEqual([WS_A])
    expect(await listCurrentEmergencyPlanIds([])).toEqual(new Map())
  })
})
