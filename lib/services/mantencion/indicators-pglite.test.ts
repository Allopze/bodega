import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { resolveIndicatorPeriod } from "@/lib/indicators/period"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

/**
 * Indicadores de mantención contra Postgres de verdad: alcance (quién ve qué OT, registros y
 * equipos) y las agregaciones principales (OT creadas/cerradas/backlog por mes, MTTR, costo,
 * OT abiertas por estado, ranking de reparaciones, registros P/C y días fuera de servicio).
 *
 * El «hoy» es fijo (2026-11-13) para que las cifras no dependan del día en que corre la prueba.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

const {
  loadOpenWorkOrdersByStatus, loadOutOfService, loadPautaState, loadRecordIndicators,
  loadTopRepairEquipment, loadWorkOrderPeriodStats, loadWorkOrderSeries,
} = await import("@/lib/services/mantencion/indicators")
const { loadPanel } = await import("@/lib/services/mantencion/panel")

const TODAY = "2026-11-13"
const NOW = new Date("2026-11-13T15:00:00Z")
const period = resolveIndicatorPeriod({ desde: "2026-09-01", hasta: TODAY }, TODAY)
const QUERY = { from: period.from, to: period.to, granularity: period.granularity, previous: period.previous, today: TODAY }

const WS = { a: "ws-ind-a", b: "ws-ind-b" } as const
const V = { a1: "v-ind-a1", a2: "v-ind-a2", b1: "v-ind-b1" } as const
const U = { reqA: "u-ind-req-a", reqB: "u-ind-req-b", mech: "u-ind-mech" } as const

const GLOBAL = { userId: "u-ind-viewer", email: null, permissions: ["mant:records:view_all", "mant:ot:view_all"], worksiteIds: [], isGlobal: true }
const SCOPED_A = { userId: "u-ind-viewer", email: null, permissions: ["mant:records:view_worksite", "mant:ot:view_worksite"], worksiteIds: [WS.a], isGlobal: false }
const NO_OT = { userId: "u-ind-viewer", email: null, permissions: ["mant:records:view_worksite"], worksiteIds: [WS.a], isGlobal: false }

const snapshot = (code: string, plate: string, worksite: string) => ({ code, plate, noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite, unit: "km" as const })
const SNAP = { [V.a1]: snapshot("KA-A1", "AAAA-01", "Faena A"), [V.a2]: snapshot("KA-A2", "AAAA-02", "Faena A"), [V.b1]: snapshot("KA-B1", "BBBB-01", "Faena B") }

interface OtInput {
  id: string; vehicleId: string; worksiteId: string; requestDate: string
  repair: boolean; maintenance: boolean; requestedBy: string
  status: "solicitada" | "en_ejecucion" | "cerrada" | "anulada"
  entryAt?: string; exitAt?: string; closedAt?: string; voidedAt?: string; cost?: number
}

async function insertOt(input: OtInput) {
  const snap = SNAP[input.vehicleId as keyof typeof SNAP]
  const inShop = input.status === "en_ejecucion" || input.status === "cerrada"
  const closed = input.status === "cerrada"
  await testDb.insert(schema.mantWorkOrders).values({
    id: input.id, folio: `OT-${input.id}`, vehicleId: input.vehicleId, worksiteId: input.worksiteId, equipmentSnapshot: snap,
    repair: input.repair, maintenance: input.maintenance, requestDate: input.requestDate,
    requestedByUserId: input.requestedBy, requesterName: "Solicitante de Prueba",
    repairDescription: input.repair ? "Reparación de prueba" : null,
    totalCost: input.cost ?? null,
    status: input.status,
    assignedToUserId: input.status === "solicitada" || input.status === "anulada" ? null : U.mech,
    assignedByUserId: input.status === "solicitada" || input.status === "anulada" ? null : U.mech,
    assignedAt: input.status === "solicitada" || input.status === "anulada" ? null : input.entryAt,
    ...(inShop ? { workshopKind: "interno", workshopEntryAt: input.entryAt, estimatedDeliveryDate: "2026-12-01", startedAt: input.entryAt, startedByUserId: U.mech } : {}),
    ...(closed
      ? {
          workshopExitAt: input.exitAt, finishedAt: input.exitAt, finishedByUserId: U.mech,
          receivedAt: input.exitAt, receiverName: "Recibe Taller", receivedByUserId: U.mech, receivedRecordedAt: input.exitAt,
          faenaReceivedAt: input.closedAt, faenaReceiverName: "Recibe Faena", faenaReceivedByUserId: U.mech, closedAt: input.closedAt,
        }
      : {}),
    ...(input.status === "anulada" ? { voidedAt: input.voidedAt, voidedByUserId: U.mech, voidReason: "Pedida por error" } : {}),
  })
}

async function insertRecord(input: { id: string; kind: "P" | "C"; vehicleId: string; worksiteId: string; workDate: string; status?: "vigente" | "anulado" }) {
  await testDb.insert(schema.mantRecords).values({
    id: input.id, folio: `MR-${input.id}`, kind: input.kind, vehicleId: input.vehicleId,
    equipmentSnapshot: SNAP[input.vehicleId as keyof typeof SNAP], worksiteId: input.worksiteId,
    reading: 10_000, unit: "km", workDate: input.workDate,
    registeredBy: U.mech, executorKind: "yo", executorUserId: U.mech, executorName: "Mecánico de Prueba",
    signedAt: `${input.workDate}T15:00:00Z`, receivedAt: `${input.workDate}T15:00:00Z`,
    status: input.status ?? "vigente",
    ...(input.kind === "P"
      ? { scheduleVersion: 1, scheduleNameSnapshot: "Camiones", intervalValue: 10_000, suggestedIntervalValue: 10_000, notes: "Mantención preventiva" }
      : {}),
  })
}

beforeAll(async () => {
  await migratePGlite(pg, "db/migrations")
  const now = new Date().toISOString()
  await testDb.insert(schema.users).values(
    Object.values(U).map((id) => ({ id, name: id, email: `${id}@chome.test`, hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now })),
  )
  const worksite = (id: string, name: string) => ({ id, name, code: id.toUpperCase(), isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.worksites).values([worksite(WS.a, "Faena A"), worksite(WS.b, "Faena B")])
  await testDb.insert(schema.fuelEquipmentTypes).values({ id: "fet-ind", slug: "ind-km", name: "Camión", category: "truck", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter" })
  await testDb.insert(schema.mantBrands).values({ id: "b-ind", name: "Scania", nameKey: "scania" })
  const vehicle = (id: string, code: string, plate: string, worksiteId: string) => ({ id, code, plate, type: "Camión", equipmentTypeId: "fet-ind", worksiteId, model: "R450", year: 2021, brand: "Scania" })
  await testDb.insert(schema.fuelVehicles).values([
    vehicle(V.a1, "KA-A1", "AAAA-01", WS.a), vehicle(V.a2, "KA-A2", "AAAA-02", WS.a), vehicle(V.b1, "KA-B1", "BBBB-01", WS.b),
  ])
  await testDb.insert(schema.mantEquipmentProfiles).values([V.a1, V.a2, V.b1].map((vehicleId) => ({ vehicleId, brandId: "b-ind" })))

  // OT. «Antes del rango» cerrada en el período anterior (19-06 → 31-08).
  await insertOt({ id: "a0", vehicleId: V.a1, worksiteId: WS.a, requestDate: "2026-07-01", repair: true, maintenance: false, requestedBy: U.reqA, status: "cerrada", entryAt: "2026-07-02T12:00:00Z", exitAt: "2026-07-04T12:00:00Z", closedAt: "2026-07-20T15:00:00Z", cost: 10_000 })
  await insertOt({ id: "a1", vehicleId: V.a1, worksiteId: WS.a, requestDate: "2026-09-10", repair: true, maintenance: false, requestedBy: U.reqA, status: "cerrada", entryAt: "2026-09-12T12:00:00Z", exitAt: "2026-09-14T12:00:00Z", closedAt: "2026-10-03T15:00:00Z", cost: 100_000 })
  await insertOt({ id: "a2", vehicleId: V.a1, worksiteId: WS.a, requestDate: "2026-10-05", repair: true, maintenance: true, requestedBy: U.reqA, status: "cerrada", entryAt: "2026-10-06T12:00:00Z", exitAt: "2026-10-06T18:00:00Z", closedAt: "2026-11-02T15:00:00Z", cost: 50_000 })
  await insertOt({ id: "a3", vehicleId: V.a2, worksiteId: WS.a, requestDate: "2026-10-20", repair: false, maintenance: true, requestedBy: U.reqA, status: "solicitada" })
  await insertOt({ id: "a4", vehicleId: V.a2, worksiteId: WS.a, requestDate: "2026-11-03", repair: true, maintenance: false, requestedBy: U.reqA, status: "en_ejecucion", entryAt: "2026-11-04T12:00:00Z" })
  await insertOt({ id: "a5", vehicleId: V.a1, worksiteId: WS.a, requestDate: "2026-10-07", repair: true, maintenance: false, requestedBy: U.reqA, status: "anulada", voidedAt: "2026-10-08T15:00:00Z" })
  await insertOt({ id: "b1", vehicleId: V.b1, worksiteId: WS.b, requestDate: "2026-11-05", repair: true, maintenance: false, requestedBy: U.reqB, status: "solicitada" })

  // Registros: 2 preventivos en el rango, 1 correctivo, 1 preventivo anulado (no cuenta), 1 preventivo del período anterior.
  await insertRecord({ id: "p1", kind: "P", vehicleId: V.a1, worksiteId: WS.a, workDate: "2026-09-15" })
  await insertRecord({ id: "p2", kind: "P", vehicleId: V.a1, worksiteId: WS.a, workDate: "2026-10-10" })
  await insertRecord({ id: "c1", kind: "C", vehicleId: V.a2, worksiteId: WS.a, workDate: "2026-10-12" })
  await insertRecord({ id: "p3", kind: "P", vehicleId: V.a1, worksiteId: WS.a, workDate: "2026-10-13", status: "anulado" })
  await insertRecord({ id: "p0", kind: "P", vehicleId: V.a1, worksiteId: WS.a, workDate: "2026-07-10" })
  await insertRecord({ id: "pb", kind: "P", vehicleId: V.b1, worksiteId: WS.b, workDate: "2026-10-14" })

  // Intervalos de detención (hora de Chile = UTC-3 en este período).
  const interval = (id: string, vehicleId: string, status: string, startedAt: string, endedAt: string | null) => ({ id, vehicleId, status, startedAt, endedAt })
  await testDb.insert(schema.fuelVehicleOperationalIntervals).values([
    interval("i-a1-old", V.a1, "mantencion", "2026-07-01T03:00:00Z", "2026-07-04T03:00:00Z"), // 3 días, período anterior
    interval("i-a1-ok", V.a1, "operativo", "2026-07-04T03:00:00Z", "2026-11-10T03:00:00Z"), // operativo: no cuenta
    interval("i-a1-open", V.a1, "mantencion", "2026-11-10T03:00:00Z", null), // abierto: 3,5 días hasta `NOW`
    interval("i-a2", V.a2, "fuera_servicio", "2026-10-30T03:00:00Z", "2026-11-02T03:00:00Z"), // 2 días en oct, 1 en nov
    interval("i-b1", V.b1, "mantencion", "2026-10-01T03:00:00Z", "2026-10-03T03:00:00Z"), // 2 días en oct (faena B)
  ])
})

describe("alcance", () => {
  it("un visor de faena ve sólo las OT de su faena; el filtro de faena sólo achica", async () => {
    expect(await loadOpenWorkOrdersByStatus(GLOBAL, undefined)).toEqual([{ status: "solicitada", count: 2 }, { status: "en_ejecucion", count: 1 }])
    expect(await loadOpenWorkOrdersByStatus(SCOPED_A, undefined)).toEqual([{ status: "solicitada", count: 1 }, { status: "en_ejecucion", count: 1 }])
    // Pedir la faena B siendo de la A no la abre.
    expect(await loadOpenWorkOrdersByStatus(SCOPED_A, WS.b)).toEqual([])
    expect(await loadOpenWorkOrdersByStatus(GLOBAL, WS.b)).toEqual([{ status: "solicitada", count: 1 }])
  })

  it("sin permiso de OT no se ve ninguna orden", async () => {
    expect(await loadOpenWorkOrdersByStatus(NO_OT, undefined)).toEqual([])
    expect((await loadWorkOrderPeriodStats(NO_OT, QUERY)).closed).toBe(0)
    expect(await loadTopRepairEquipment(NO_OT, QUERY)).toEqual([])
  })

  it("los registros y los equipos respetan el alcance de faenas", async () => {
    const global = await loadRecordIndicators(GLOBAL, QUERY)
    const scoped = await loadRecordIndicators(SCOPED_A, QUERY)
    expect(global.preventive).toBe(3) // p1, p2 y pb
    expect(scoped.preventive).toBe(2)
    expect((await loadPautaState(GLOBAL, undefined, TODAY)).total).toBe(3)
    expect((await loadPautaState(SCOPED_A, undefined, TODAY)).total).toBe(2)
    expect((await loadPautaState(SCOPED_A, WS.b, TODAY)).total).toBe(0)
  })

  it("los días fuera de servicio sólo suman los equipos del alcance", async () => {
    expect((await loadOutOfService(GLOBAL, QUERY, NOW)).total).toBe(8.5)
    expect((await loadOutOfService(SCOPED_A, QUERY, NOW)).total).toBe(6.5)
    expect((await loadOutOfService(SCOPED_A, { ...QUERY, worksiteId: WS.b }, NOW)).total).toBe(0)
  })
})

describe("órdenes de trabajo", () => {
  it("creadas, cerradas y backlog por mes, sin contar las anuladas como creadas", async () => {
    const series = await loadWorkOrderSeries(GLOBAL, QUERY)
    expect(series.map((point) => point.key)).toEqual(["2026-09", "2026-10", "2026-11"])
    expect(series.map((point) => point.created)).toEqual([1, 2, 2])
    expect(series.map((point) => point.closed)).toEqual([0, 1, 1])
    // Fin de septiembre: a1 (se cierra el 3-10). Fin de octubre: a2 y a3 (a5 se anuló el 8-10). Hoy: a3, a4 y b1.
    expect(series.map((point) => point.backlog)).toEqual([1, 2, 3])
    expect(series.map((point) => [point.repairOnly, point.maintenanceOnly, point.both])).toEqual([[1, 0, 0], [0, 1, 1], [2, 0, 0]])
    expect(series.map((point) => point.partial)).toEqual([false, false, true])
  })

  it("el alcance también recorta la serie", async () => {
    const series = await loadWorkOrderSeries(SCOPED_A, QUERY)
    expect(series.map((point) => point.created)).toEqual([1, 2, 1])
    expect(series.at(-1)!.backlog).toBe(2)
  })

  it("cerradas del período vs anterior, tiempo medio de reparación y costo", async () => {
    const stats = await loadWorkOrderPeriodStats(GLOBAL, QUERY)
    expect(stats.closed).toBe(2)
    expect(stats.closedPrevious).toBe(1)
    expect(stats.repairClosed).toBe(2)
    // a1: 48 h; a2: 6 h → promedio 27 h.
    expect(stats.mttrHours).toBeCloseTo(27, 5)
    expect(stats.cost).toBe(150_000)
  })

  it("sin cierres con costo en el período, el costo es null y no 0", async () => {
    const stats = await loadWorkOrderPeriodStats(GLOBAL, { ...QUERY, from: "2026-11-05", to: TODAY, previous: { from: "2026-10-27", to: "2026-11-04" } })
    expect(stats.closed).toBe(0)
    expect(stats.closedPrevious).toBe(1) // a2 se cerró el 2-11
    expect(stats.mttrHours).toBeNull()
    expect(stats.cost).toBeNull()
  })

  it("ranking de equipos con más OT de reparación: sólo con 2 o más, sin anuladas y desempate por patente", async () => {
    // AAAA-02 y BBBB-01 tienen una sola OT: no son un ranking.
    const ranking = await loadTopRepairEquipment(GLOBAL, QUERY)
    expect(ranking.map((row) => [row.plate, row.count])).toEqual([["AAAA-01", 2]])
    // Con el piso en 1 sí aparecen todos, y el empate se ordena por patente.
    const all = await loadTopRepairEquipment(GLOBAL, QUERY, 50, 1)
    expect(all.map((row) => [row.plate, row.count])).toEqual([["AAAA-01", 2], ["AAAA-02", 1], ["BBBB-01", 1]])
    expect(await loadTopRepairEquipment(GLOBAL, QUERY, 1, 1)).toHaveLength(1)
    // Sin repeticiones en el alcance, no hay ranking.
    expect(await loadTopRepairEquipment(SCOPED_A, { ...QUERY, from: "2026-11-01" })).toEqual([])
  })
})

describe("pautas, registros y disponibilidad", () => {
  it("estado de las pautas de hoy: sin pauta asignada, ningún equipo se evalúa", async () => {
    const state = await loadPautaState(GLOBAL, undefined, TODAY)
    expect(state.counts.sin_pauta).toBe(3)
    expect(state.counts.al_dia).toBe(0)
  })

  it("registros preventivos y correctivos por mes, sin anulados, y el preventivo del período anterior", async () => {
    const records = await loadRecordIndicators(SCOPED_A, QUERY)
    expect(records.points.map((point) => [point.key, point.preventive, point.corrective])).toEqual([["2026-09", 1, 0], ["2026-10", 1, 1], ["2026-11", 0, 0]])
    expect(records.preventive).toBe(2)
    expect(records.preventivePrevious).toBe(1)
  })

  it("el Panel conserva su serie de 8 semanas (misma consulta, extraída)", async () => {
    const panel = await loadPanel(GLOBAL, { period: "todo" }, TODAY)
    expect(panel.weeks).toHaveLength(8)
    const sum = (kind: "preventive" | "corrective") => panel.weeks.reduce((total, week) => total + week[kind], 0)
    // 8 semanas hacia atrás desde el lunes 9-11: desde el 21-09. p2, pb (octubre) y c1.
    expect(sum("preventive")).toBe(2)
    expect(sum("corrective")).toBe(1)
  })

  it("días fuera de servicio por mes: sólo mantención y fuera de servicio, el abierto hasta `now`", async () => {
    const result = await loadOutOfService(SCOPED_A, QUERY, NOW)
    expect(result.points.map((point) => [point.key, point.days])).toEqual([["2026-09", 0], ["2026-10", 2], ["2026-11", 4.5]])
    expect(result.total).toBe(6.5)
    expect(result.totalPrevious).toBe(3)
    expect(result.points.map((point) => point.partial)).toEqual([false, false, true])
  })
})
