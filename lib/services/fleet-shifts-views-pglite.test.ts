import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { sql } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { setVehicleWorksiteForTest } from "@/lib/testing/fleet-stays"
import { IDS, seedControlFixtures } from "@/lib/combustibles/control/queries/test-fixtures"

/**
 * Lecturas de «Turnos y ralentí»: turnos del día, ranking de operadores, grilla de equipos y
 * opciones del formulario. Lo que se protege:
 * - el alcance es la faena del equipo EL DÍA del turno (un traslado a mitad de período);
 * - un turno nocturno del último día del rango cuenta entero en el ranking;
 * - un equipo sin VisionLink sólo aparece si tiene turnos, y su turno sale «Sin telemetría»;
 * - las celdas de la grilla distinguen detenido, sin señal, mantención y sin operación programada.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const { getShiftDayView, getOperatorRankingView, getEquipmentGridView, listShiftFormOptions } = await import("./fleet-shifts-views")

const V_LINKED = "veh-sv-l" // SV-L, con VisionLink, faena A
const V_GRID = "veh-sv-g" // SV-G, con VisionLink, faena A
const V_PLAIN = "veh-sv-n" // SV-N, sin VisionLink, faena B
const V_MOVED = "veh-sv-t" // SV-T, sin VisionLink, faena C hasta el 14-11 y faena A desde el 15-11

const W_ANA = "w-sv-ana" // cargo canónico «Operador de maquinaria»
const W_LUIS = "w-sv-luis"
const W_OMAR = "w-sv-omar" // cargo legado en mayúsculas
const W_NORA = "w-sv-nora"
const W_TOMAS = "w-sv-tomas"
const W_BAJA = "w-sv-baja"
const W_BEA = "w-sv-bea" // faena B

const SOURCE = "visionlink-api"
const FETCHED = "2026-12-01T12:00:00Z" // después de cualquier hora de las pruebas + 1 h

let seq = 0
async function addShift(vehicleId: string, shiftDate: string, startHour: number, endHour: number, workerId: string, name: string, extra: Partial<typeof schema.fleetOperationShifts.$inferInsert> = {}) {
  const id = `shift-sv-${++seq}`
  await testDb.insert(schema.fleetOperationShifts).values({
    id, vehicleId, shiftDate, startHour, endHour, operatorWorkerId: workerId, operatorNameSnapshot: name,
    createdBy: IDS.user, updatedBy: IDS.user, ...extra,
  })
  return id
}

async function addHours(vehicleId: string, day: string, hours: number[], seconds: { idle?: number; working?: number; running?: number }) {
  await testDb.insert(schema.fuelTelemetryHourly).values(hours.map((hour) => ({
    vehicleId, day, hour, source: SOURCE,
    idleSeconds: seconds.idle ?? 0, workingSeconds: seconds.working ?? 0, runningSeconds: seconds.running ?? 0,
  })))
}

async function addFetch(vehicleId: string, day: string, opts: { segments?: boolean; daily?: boolean } = { segments: true, daily: true }) {
  await testDb.insert(schema.fuelTelemetryFetches).values({
    vehicleId, day,
    segmentsFetchedAt: opts.segments === false ? null : FETCHED,
    dailyFetchedAt: opts.daily === false ? null : FETCHED,
  })
}

async function addDaily(vehicleId: string, day: string, litersIdle: number | null, litersWorking: number | null) {
  await testDb.insert(schema.fuelTelemetryDaily).values({
    id: `td-sv-${++seq}`, vehicleId, source: SOURCE, day, month: day.slice(0, 7),
    operatingHours: 0, idleHours: 0, litersIdle, litersWorking,
  })
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i)

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)

  const base = { type: "x", equipmentTypeId: IDS.eqType, meterType: "hour_meter" as const, performanceUnit: "liters_per_hour" as const }
  await testDb.insert(schema.fuelVehicles).values([
    { id: V_LINKED, plate: "SV-0001", code: "SV-L", serialNumber: "SN-L", worksiteId: IDS.wsA, ...base },
    { id: V_GRID, plate: "SV-0002", code: "SV-G", serialNumber: "SN-G", worksiteId: IDS.wsA, ...base },
    { id: V_PLAIN, plate: "SV-0003", code: "SV-N", worksiteId: IDS.wsB, ...base },
    { id: V_MOVED, plate: "SV-0004", code: "SV-T", worksiteId: IDS.wsC, ...base },
  ])
  await setVehicleWorksiteForTest(testDb, V_MOVED, IDS.wsA, "2026-11-15")

  await testDb.insert(schema.workerPositions).values({ id: "pos-sv-op", code: "sv-op-maq", name: "Operador de maquinaria", normalizedKey: "sv operador de maquinaria" })
  await testDb.insert(schema.workers).values([
    { id: W_ANA, firstName: "Ana", lastName: "Pérez", worksiteId: IDS.wsA, positionId: "pos-sv-op" },
    { id: W_LUIS, firstName: "Luis", lastName: "Soto", worksiteId: IDS.wsA },
    { id: W_OMAR, firstName: "Omar", lastName: "Vera", worksiteId: IDS.wsA, position: "OPERADOR DE MAQUINARIA" },
    { id: W_NORA, firstName: "Nora", lastName: "Noche", worksiteId: IDS.wsA },
    { id: W_TOMAS, firstName: "Tomás", lastName: "Traslado", worksiteId: IDS.wsA },
    { id: W_BAJA, firstName: "Baja", lastName: "Inactiva", worksiteId: IDS.wsA, isActive: false },
    { id: W_BEA, firstName: "Bea", lastName: "Rojas", worksiteId: IDS.wsB },
  ])

  // 2026-11-09 en SV-L: mañana con poco ralentí, tarde con mucho, y 2 h de motor (running) sin turno.
  await addHours(V_LINKED, "2026-11-09", range(6, 14), { idle: 600, working: 3000 })
  await addHours(V_LINKED, "2026-11-09", range(14, 22), { idle: 2000, working: 1600 })
  await addHours(V_LINKED, "2026-11-09", [22, 23], { running: 3600 })
  await addFetch(V_LINKED, "2026-11-09")

  // Noche 22–06 del 20-11 que se reparte entre dos días: 4 h de ralentí y 4 h de trabajo.
  await addHours(V_LINKED, "2026-11-20", [22, 23], { idle: 1800, working: 1800 })
  await addHours(V_LINKED, "2026-11-21", range(0, 6), { idle: 1800, working: 1800 })
  await addFetch(V_LINKED, "2026-11-20")
  await addFetch(V_LINKED, "2026-11-21")
}, 60_000)

describe("turnos del día", () => {
  it("muestra los turnos con estado y %, y avisa las horas de motor sin turno", async () => {
    await addShift(V_LINKED, "2026-11-09", 6, 14, W_ANA, "Ana Pérez")
    await addShift(V_LINKED, "2026-11-09", 14, 22, W_LUIS, "Luis Soto")
    await addShift(V_LINKED, "2026-11-09", 22, 6, W_OMAR, "Omar Vera", {
      voidedAt: "2026-11-10T00:00:00Z", voidedBy: IDS.user, voidReason: "Registrado por error",
    })

    const view = await getShiftDayView([IDS.wsA], "2026-11-09")

    expect(view.day).toBe("2026-11-09")
    expect(view.target).toBeCloseTo(0.3)
    // El turno anulado no se muestra.
    expect(view.shifts.map((s) => [s.vehicleCode, s.startHour, s.endHour, s.operatorName, s.presetLabel, s.summary.status])).toEqual([
      ["SV-L", 6, 14, "Ana Pérez", "Mañana 06–14", "en_meta"],
      ["SV-L", 14, 22, "Luis Soto", "Tarde 14–22", "sobre_meta"],
    ])
    expect(view.shifts[0]!.summary.idlePct).toBeCloseTo(4800 / 28800)
    expect(view.shifts[1]!.summary.idlePct).toBeCloseTo(16000 / 28800)

    const row = view.vehicles.find((v) => v.vehicleId === V_LINKED)!
    expect(row).toMatchObject({ vehicleCode: "SV-L", hasVisionLink: true, operationalStatus: "operativo", dayMark: null, shiftsCount: 2 })
    expect(row.summary.engineHours).toBeCloseTo(18)
    expect(row.summary.unassignedEngineHours).toBeCloseTo(2)
    expect(row.summary.warnUnassigned).toBe(true)
    // La identidad que sostiene que las cifras cuadren.
    expect(row.summary.assignedEngineHours + row.summary.unassignedEngineHours).toBeCloseTo(row.summary.engineHours)
  })

  it("el alcance de otra faena no ve el equipo ni sus turnos; sin alcance no ve nada", async () => {
    const other = await getShiftDayView([IDS.wsB], "2026-11-09")
    expect(other.shifts.filter((s) => s.vehicleId === V_LINKED)).toEqual([])
    expect(other.vehicles.find((v) => v.vehicleId === V_LINKED)).toBeUndefined()

    expect(await getShiftDayView([], "2026-11-09")).toMatchObject({ vehicles: [], shifts: [] })
    const all = await getShiftDayView("all", "2026-11-09")
    expect(all.shifts).toHaveLength(2)
  })

  it("un equipo sin VisionLink sin turnos no aparece; con un turno sí, y su turno es «Sin telemetría»", async () => {
    const before = await getShiftDayView([IDS.wsB], "2026-11-09")
    expect(before.vehicles.find((v) => v.vehicleId === V_PLAIN)).toBeUndefined()

    await addShift(V_PLAIN, "2026-11-09", 6, 14, W_BEA, "Bea Rojas")
    const after = await getShiftDayView([IDS.wsB], "2026-11-09")
    expect(after.vehicles.find((v) => v.vehicleId === V_PLAIN)).toMatchObject({ hasVisionLink: false, shiftsCount: 1 })
    expect(after.shifts.map((s) => [s.vehicleCode, s.summary.status])).toEqual([["SV-N", "sin_telemetria"]])
  })

  it("lee el estado del equipo de los intervalos que tocan el día en hora de Chile", async () => {
    // Chile está en UTC-3 en octubre: 10:00–20:00Z cae dentro del 4 de octubre.
    await testDb.insert(schema.fuelVehicleOperationalIntervals).values({
      id: "oi-sv-1", vehicleId: V_LINKED, status: "mantencion", startedAt: "2026-10-04T10:00:00Z", endedAt: "2026-10-04T20:00:00Z", reason: "Cambio de motor",
    })
    const inService = await getShiftDayView([IDS.wsA], "2026-10-04")
    expect(inService.vehicles.find((v) => v.vehicleId === V_LINKED)?.operationalStatus).toBe("mantencion")
    const next = await getShiftDayView([IDS.wsA], "2026-10-05")
    expect(next.vehicles.find((v) => v.vehicleId === V_LINKED)?.operationalStatus).toBe("operativo")
  })
})

describe("traslado a mitad de período", () => {
  it("el alcance sólo ve los turnos de los días en que el equipo estuvo en su faena", async () => {
    await addShift(V_MOVED, "2026-11-12", 6, 14, W_TOMAS, "Tomás Traslado")
    await addShift(V_MOVED, "2026-11-16", 6, 14, W_TOMAS, "Tomás Traslado")

    const q = { from: "2026-11-01", to: "2026-11-30" }
    const tomas = (rows: Awaited<ReturnType<typeof getOperatorRankingView>>["ranking"]["rows"]) => rows.find((r) => r.operatorWorkerId === W_TOMAS)?.shifts

    expect(tomas((await getOperatorRankingView([IDS.wsA], q)).ranking.rows)).toBe(1)
    expect(tomas((await getOperatorRankingView([IDS.wsC], q)).ranking.rows)).toBe(1)
    expect(tomas((await getOperatorRankingView("all", q)).ranking.rows)).toBe(2)

    const inC = await getShiftDayView([IDS.wsC], "2026-11-12")
    expect(inC.shifts.map((s) => s.vehicleCode)).toEqual(["SV-T"])
    expect((await getShiftDayView([IDS.wsA], "2026-11-12")).shifts.map((s) => s.vehicleCode)).not.toContain("SV-T")

    const inA = await getShiftDayView([IDS.wsA], "2026-11-16")
    expect(inA.shifts.map((s) => s.vehicleCode)).toEqual(["SV-T"])
    expect((await getShiftDayView([IDS.wsC], "2026-11-16")).shifts).toEqual([])
  })
})

describe("ranking de operadores", () => {
  it("un turno 22–06 del último día del rango cuenta entero, aunque sus horas pasen al día siguiente", async () => {
    await addShift(V_LINKED, "2026-11-20", 22, 6, W_NORA, "Nora Noche")
    // Un turno del día siguiente queda fuera del rango.
    await addShift(V_LINKED, "2026-11-21", 6, 14, W_LUIS, "Luis Soto")

    const { ranking, target } = await getOperatorRankingView([IDS.wsA], { from: "2026-11-20", to: "2026-11-20", vehicleId: V_LINKED })
    expect(target).toBeCloseTo(0.3)
    expect(ranking.rows).toHaveLength(1)
    expect(ranking.rows[0]).toMatchObject({ rank: 1, operatorWorkerId: W_NORA, shifts: 1, pending: 0, overTarget: 1 })
    expect(ranking.rows[0]!.engineHours).toBeCloseTo(8)
    expect(ranking.rows[0]!.idleHours).toBeCloseTo(4)
    expect(ranking.rows[0]!.idlePct).toBeCloseTo(0.5)
    expect(ranking.total.shifts).toBe(1)

    // Con «hasta» el día anterior, el turno no entra.
    const before = await getOperatorRankingView([IDS.wsA], { from: "2026-11-19", to: "2026-11-19", vehicleId: V_LINKED })
    expect(before.ranking.rows).toEqual([])
  })
})

describe("grilla de equipos: VisionLink omite los días sin uso", () => {
  it("un domingo sin datos con datos el lunes es detenido, y un día sólo con «running» es sin dato", async () => {
    const V_SUNDAY = "veh-sv-d"
    await testDb.insert(schema.fuelVehicles).values({
      // Faena C: otras pruebas listan los equipos de la faena A.
      id: V_SUNDAY, plate: "SV-0005", code: "SV-D", serialNumber: "SN-D", worksiteId: IDS.wsC,
      type: "x", equipmentTypeId: IDS.eqType, meterType: "hour_meter", performanceUnit: "liters_per_hour",
    })
    // Sábado 14: trabajó. Domingo 15: nada (VisionLink no trae el día). Lunes 16: sólo «running» (ConnectPro).
    await addHours(V_SUNDAY, "2026-11-14", range(8, 12), { idle: 900, working: 2700 })
    await addHours(V_SUNDAY, "2026-11-16", range(8, 12), { running: 3600 })
    for (const day of ["2026-11-14", "2026-11-15", "2026-11-16"]) await addFetch(V_SUNDAY, day)

    const view = await getEquipmentGridView([IDS.wsC], { from: "2026-11-14", to: "2026-11-16" })
    const row = view.rows.find((r) => r.vehicleId === V_SUNDAY)!
    expect(row.cells.map((c) => [c.day.slice(8), c.kind])).toEqual([["14", "pct"], ["15", "detenido"], ["16", "sin_dato"]])
    expect(row.cells[2]!.engineHours).toBeCloseTo(4)
  })
})

describe("grilla de equipos", () => {
  it("distingue detenido, sin señal, fuera de servicio, sin operación programada y sin datos", async () => {
    const hour = { source: SOURCE, vehicleId: V_GRID }
    await testDb.insert(schema.fuelTelemetryHourly).values(range(6, 14).map((h) => ({ ...hour, day: "2026-10-01", hour: h, idleSeconds: 600, workingSeconds: 3000, runningSeconds: 0 })))
    for (const day of ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"]) await addFetch(V_GRID, day)
    // 10-02: fila del resumen diario (transmitió). 10-03 en adelante: sin datos ni ese día ni después, y el equipo
    // lleva más de 3 días callado = sin señal.
    await addDaily(V_GRID, "2026-10-01", 10, 30)
    await addDaily(V_GRID, "2026-10-02", 5, 15)
    await testDb.insert(schema.fuelVehicleOperationalIntervals).values({
      id: "oi-sv-grid", vehicleId: V_GRID, status: "fuera_servicio", startedAt: "2026-10-04T10:00:00Z", endedAt: "2026-10-04T20:00:00Z", reason: "Falla hidráulica",
    })
    await testDb.insert(schema.fleetOperationDayMarks).values({ id: "mark-sv-1", vehicleId: V_GRID, day: "2026-10-05", reason: "sin_operacion_programada", notes: "Feriado", createdBy: IDS.user })

    const view = await getEquipmentGridView([IDS.wsA], { from: "2026-10-01", to: "2026-10-07" })
    expect(view.days).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"])
    const row = view.rows.find((r) => r.vehicleId === V_GRID)!
    expect(row.vehicleCode).toBe("SV-G")
    expect(row.cells.map((c) => [c.day.slice(8), c.kind])).toEqual([
      ["01", "pct"], ["02", "detenido"], ["03", "ss"], ["04", "fs"], ["05", "sp"], ["06", "vacio"], ["07", "vacio"],
    ])
    expect(row.cells[0]!.pct).toBeCloseTo(4800 / 28800)
    expect(row.cells[0]!.engineHours).toBeCloseTo(8)
    expect(row.engineHours).toBeCloseTo(8)
    expect(row.idlePct).toBeCloseTo(4800 / 28800)

    // Días detenidos: estado y marca, el más reciente primero.
    const stopped = view.stoppedDays.filter((d) => d.vehicleCode === "SV-G")
    expect(stopped.map((d) => [d.day, d.source, d.label, d.notes])).toEqual([
      ["2026-10-05", "marca", "Sin operación programada", "Feriado"],
      ["2026-10-04", "estado", "Fuera de servicio", "Falla hidráulica"],
    ])

    // Litros en vacío: del resumen diario, suma de vacío y trabajo como total.
    const liters = view.idleLiters.find((l) => l.vehicleCode === "SV-G")!
    expect(liters.byDay["2026-10-01"]).toBe(10)
    expect(liters.byDay["2026-10-02"]).toBe(5)
    expect(liters.byDay["2026-10-03"]).toBeNull()
    expect(liters).toMatchObject({ idleLiters: 15, totalLiters: 60, idleShare: 0.25 })
  })

  it("no muestra a otra faena y recorta el período a 62 días", async () => {
    const other = await getEquipmentGridView([IDS.wsB], { from: "2026-10-01", to: "2026-10-07" })
    expect(other.rows.find((r) => r.vehicleId === V_GRID)).toBeUndefined()

    const wide = await getEquipmentGridView("all", { from: "2026-01-01", to: "2026-12-31" })
    expect(wide.days).toHaveLength(62)
    expect(wide.days[0]).toBe("2026-01-01")
    expect(wide.days[61]).toBe("2026-03-03")
    expect(wide.rows[0]!.cells).toHaveLength(62)
  })

  it("un equipo trasladado muestra «vacío» los días en que no estaba en el alcance", async () => {
    const view = await getEquipmentGridView([IDS.wsA], { from: "2026-11-12", to: "2026-11-16" })
    const row = view.rows.find((r) => r.vehicleId === V_MOVED)
    expect(row).toBeDefined()
    expect(row!.cells.every((c) => c.kind === "vacio")).toBe(true)
  })
})

describe("uso personal del dueño", () => {
  // Faena C (otras pruebas listan la A). Tres días con 8 h de motor cada uno: 09-01, 09-02 y 09-03.
  const V_PU = "veh-sv-pu"
  const DAYS = ["2026-09-01", "2026-09-02", "2026-09-03"]
  const PERIOD_ID = "pu-sv-1"

  beforeAll(async () => {
    await testDb.insert(schema.fuelVehicles).values({
      id: V_PU, plate: "SV-0006", code: "SV-P", serialNumber: "SN-P", worksiteId: IDS.wsC,
      type: "x", equipmentTypeId: IDS.eqType, meterType: "hour_meter", performanceUnit: "liters_per_hour",
    })
    for (const day of DAYS) {
      await addHours(V_PU, day, range(8, 16), { idle: 600, working: 3000 })
      await addFetch(V_PU, day)
      await addDaily(V_PU, day, 10, 30)
    }
    // El 09-02 es del dueño; ese día el equipo también tiene un turno registrado (sigue siendo un registro).
    await testDb.insert(schema.fuelVehiclePersonalUsePeriods).values({ id: PERIOD_ID, vehicleId: V_PU, startedOn: "2026-09-02", endedOn: "2026-09-02" })
    await addShift(V_PU, "2026-09-02", 8, 16, W_LUIS, "Luis Soto")
    await addShift(V_PU, "2026-09-01", 8, 16, W_ANA, "Ana Pérez")
  })

  const rowOf = async (day: string) => (await getShiftDayView([IDS.wsC], day)).vehicles.find((v) => v.vehicleId === V_PU)!

  it("en la vista diaria el día del dueño queda marcado y no avisa «sin turno»", async () => {
    // Sin turnos que cubran las horas: un día normal sí avisa, el personal no.
    await testDb.update(schema.fleetOperationShifts).set({ voidedAt: "2026-09-10T00:00:00Z", voidedBy: IDS.user, voidReason: "QA" })
      .where(sql`${schema.fleetOperationShifts.vehicleId} = ${V_PU}`)
    try {
      const normal = await rowOf("2026-09-03")
      expect(normal.personalUse).toBe(false)
      expect(normal.summary.warnUnassigned).toBe(true)

      const personal = await rowOf("2026-09-02")
      expect(personal.personalUse).toBe(true)
      expect(personal.summary.unassignedEngineHours).toBeCloseTo(8)
      expect(personal.summary.warnUnassigned).toBe(false)
    } finally {
      await testDb.update(schema.fleetOperationShifts).set({ voidedAt: null, voidedBy: null, voidReason: null })
        .where(sql`${schema.fleetOperationShifts.vehicleId} = ${V_PU}`)
    }
  })

  it("los turnos registrados ese día siguen en la vista diaria", async () => {
    const view = await getShiftDayView([IDS.wsC], "2026-09-02")
    expect(view.shifts.filter((s) => s.vehicleId === V_PU)).toHaveLength(1)
    expect(view.vehicles.find((v) => v.vehicleId === V_PU)?.shiftsCount).toBe(1)
  })

  it("la grilla marca la celda y no suma el día a los totales de la fila ni a los litros en vacío", async () => {
    const view = await getEquipmentGridView([IDS.wsC], { from: "2026-09-01", to: "2026-09-03" })
    const row = view.rows.find((r) => r.vehicleId === V_PU)!
    expect(row.cells.map((c) => [c.day.slice(8), c.kind])).toEqual([["01", "pct"], ["02", "uso_personal"], ["03", "pct"]])
    expect(row.engineHours).toBeCloseTo(16)
    expect(row.idlePct).toBeCloseTo(600 / 3600)

    const liters = view.idleLiters.find((l) => l.vehicleCode === "SV-P")!
    expect(liters.byDay["2026-09-02"]).toBeNull()
    expect(liters).toMatchObject({ idleLiters: 20, totalLiters: 80, idleShare: 0.25 })
  })

  it("el ranking de operadores no cuenta el turno de un día de uso personal", async () => {
    const { ranking } = await getOperatorRankingView([IDS.wsC], { from: "2026-09-01", to: "2026-09-03", vehicleId: V_PU })
    expect(ranking.rows.map((r) => [r.operatorWorkerId, r.shifts])).toEqual([[W_ANA, 1]])
    expect(ranking.total.shifts).toBe(1)
  })

  it("quitar el período devuelve el día a los totales", async () => {
    await testDb.delete(schema.fuelVehiclePersonalUsePeriods).where(sql`${schema.fuelVehiclePersonalUsePeriods.id} = ${PERIOD_ID}`)
    try {
      expect((await rowOf("2026-09-02")).personalUse).toBe(false)
      const view = await getEquipmentGridView([IDS.wsC], { from: "2026-09-01", to: "2026-09-03" })
      const row = view.rows.find((r) => r.vehicleId === V_PU)!
      expect(row.cells.map((c) => c.kind)).toEqual(["pct", "pct", "pct"])
      expect(row.engineHours).toBeCloseTo(24)
      expect(view.idleLiters.find((l) => l.vehicleCode === "SV-P")).toMatchObject({ idleLiters: 30, totalLiters: 120 })
      const { ranking } = await getOperatorRankingView([IDS.wsC], { from: "2026-09-01", to: "2026-09-03", vehicleId: V_PU })
      expect(ranking.total.shifts).toBe(2)
    } finally {
      await testDb.insert(schema.fuelVehiclePersonalUsePeriods).values({ id: PERIOD_ID, vehicleId: V_PU, startedOn: "2026-09-02", endedOn: "2026-09-02" })
    }
  })
})

describe("opciones del formulario", () => {
  it("lista equipos con VisionLink primero y operadores de maquinaria primero, sin inactivos", async () => {
    const options = await listShiftFormOptions([IDS.wsA], "2026-11-09")
    // Faena A el 09-11: SV-L, SV-G (VisionLink) y KA-1 (sin). SV-T aún estaba en la faena C.
    expect(options.vehicles.map((v) => [v.code, v.hasVisionLink])).toEqual([["SV-G", true], ["SV-L", true], ["KA-1", false]])
    expect(options.operators.map((o) => [o.name, o.isMachineOperator])).toEqual([
      ["Ana Pérez", true], ["Omar Vera", true], ["Luis Soto", false], ["Nora Noche", false], ["Tomás Traslado", false],
    ])

    const later = await listShiftFormOptions([IDS.wsA], "2026-11-16")
    expect(later.vehicles.map((v) => v.code)).toContain("SV-T")

    expect(await listShiftFormOptions([], "2026-11-09")).toEqual({ vehicles: [], operators: [] })
  })
})
