import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, seedMantFixtures } from "./mantencion-sync-fixtures"

/**
 * Cifras de OT (Flota, Control operacional, Tablero) contra Postgres de verdad:
 * alcance de faena, las anuladas no cuentan, el recorte de las horas en taller al
 * período, las sin asignar y la entrega estimada vencida.
 *
 * Las OT se insertan directo en `mant_work_orders` —sin pasar por el servicio de
 * transiciones— respetando los `check` por estado de la tabla: lo que se prueba es
 * la lectura, no el flujo.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))
vi.mock("server-only", () => ({}))

const { getUserRbacById } = await import("@/lib/auth/rbac")
const { getFleetOverview, getFleetVehicleDetail } = await import("@/lib/services/fleet")
const {
  getVehicleWorkOrderMetrics,
  getWorkOrderGlobalMetrics,
  listRecentVehicleWorkOrders,
  meanTimeToRepairHours,
  workOrderMetricsScope,
} = await import("@/lib/services/mantencion/work-orders/metrics")

async function sessionOf(userId: string): Promise<Session> {
  const rbac = await getUserRbacById(userId, true)
  if (!rbac) throw new Error(`Sin RBAC para ${userId}`)
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: rbac.id, name: rbac.name, email: rbac.email, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal, roles: rbac.roles },
  } as unknown as Session
}

const SNAPSHOT = { code: "KA-135", plate: "RBYD-98", noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Biodiversa", unit: "km" as const }

type Status = "solicitada" | "asignada" | "en_ejecucion" | "trabajo_terminado" | "cerrada" | "anulada"

interface Seed {
  id: string
  vehicleId: string
  worksiteId: string
  status: Status
  repair?: boolean
  maintenance?: boolean
  entry?: string
  exit?: string
  estimated?: string
  closedAt?: string
  createdAt?: string
  totalCost?: number
}

/** Una fila que cumple los `check` del estado pedido; cada estado suma lo que el anterior ya exigía. */
async function insertOt(seed: Seed) {
  const who = { userId: IDS.mecBio, name: "Javier Roa" }
  const status = seed.status
  const assigned = status !== "solicitada" && status !== "anulada"
  const started = ["en_ejecucion", "trabajo_terminado", "cerrada"].includes(status)
  const finished = ["trabajo_terminado", "cerrada"].includes(status)
  await testDb.insert(schema.mantWorkOrders).values({
    id: seed.id,
    folio: `OT-TST-${seed.id}`,
    vehicleId: seed.vehicleId,
    worksiteId: seed.worksiteId,
    equipmentSnapshot: SNAPSHOT,
    repair: seed.repair ?? true,
    maintenance: seed.maintenance ?? false,
    requestDate: "2026-02-20",
    requestedByUserId: IDS.jefe,
    requesterName: "Alexis Morales",
    repairDescription: seed.repair === false ? null : "Falla de frenos en la cabina",
    totalCost: seed.totalCost ?? null,
    status,
    ...(assigned ? { assignedToUserId: who.userId, assignedByUserId: IDS.jefe, assignedAt: "2026-02-21T12:00:00Z" } : {}),
    ...(started ? {
      workshopKind: "interno",
      workshopEntryAt: seed.entry,
      estimatedDeliveryDate: seed.estimated ?? "2026-12-31",
      startedAt: seed.entry,
      startedByUserId: who.userId,
    } : {}),
    ...(finished ? { workshopExitAt: seed.exit, finishedAt: seed.exit, finishedByUserId: who.userId } : {}),
    ...(status === "cerrada" ? {
      receivedAt: seed.exit,
      receiverName: "Pedro Soto",
      receivedByUserId: IDS.jefe,
      receivedRecordedAt: seed.exit,
      faenaReceivedAt: seed.closedAt,
      faenaReceiverName: "Admin Contrato",
      faenaReceivedByUserId: IDS.jefe,
      closedAt: seed.closedAt,
    } : {}),
    ...(status === "anulada" ? { voidedAt: "2026-03-02T12:00:00Z", voidedByUserId: IDS.jefe, voidReason: "Pedida por error" } : {}),
    ...(seed.createdAt ? { createdAt: seed.createdAt } : {}),
  })
}

const MARCH = { from: "2026-03-01", to: "2026-03-31" }
/** «Ahora» fijo: la OT que sigue en taller cuenta hasta este instante. */
const NOW = new Date("2026-03-20T08:00:00Z")
const TODAY = "2026-03-25"

beforeAll(async () => {
  await migratePGlite(pg, "db/migrations")
  await seedMantFixtures(testDb)

  // ── KA-135 (Biodiversa) ──
  await insertOt({ id: "ot-sol", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, status: "solicitada", createdAt: "2026-03-01T10:00:00Z" })
  await insertOt({ id: "ot-asig", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, status: "asignada", createdAt: "2026-03-02T10:00:00Z" })
  // En taller desde el 10/03 08:00, sin salida; estimada ya vencida al 25/03.
  // Abierta con costo: no suma al período hasta que se cierre.
  await insertOt({
    id: "ot-ejec", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, status: "en_ejecucion", totalCost: 20_000,
    entry: "2026-03-10T08:00:00Z", estimated: "2026-03-20", createdAt: "2026-03-03T10:00:00Z",
  })
  // Reparación que cruza el inicio del período: entró el 27/02 12:00 y salió el 02/03 12:00.
  await insertOt({
    id: "ot-rep", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, status: "cerrada", repair: true, totalCost: 100_000,
    entry: "2026-02-27T12:00:00Z", exit: "2026-03-02T12:00:00Z", closedAt: "2026-03-05T12:00:00Z", createdAt: "2026-02-25T10:00:00Z",
  })
  // Sólo mantención, entera dentro del período: 24 h.
  await insertOt({
    id: "ot-mant", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, status: "cerrada", repair: false, maintenance: true, totalCost: 50_000,
    entry: "2026-03-10T00:00:00Z", exit: "2026-03-11T00:00:00Z", closedAt: "2026-03-12T12:00:00Z", createdAt: "2026-03-04T10:00:00Z",
  })
  // Cerrada en febrero: no entra a «cerradas del período» ni suma horas en marzo.
  await insertOt({
    id: "ot-feb", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, status: "cerrada", repair: true, totalCost: 30_000,
    entry: "2026-02-01T00:00:00Z", exit: "2026-02-02T00:00:00Z", closedAt: "2026-02-05T12:00:00Z", createdAt: "2026-02-01T10:00:00Z",
  })
  // Anulada: no cuenta en nada.
  await insertOt({ id: "ot-anul", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, status: "anulada", totalCost: 999_999, createdAt: "2026-03-06T10:00:00Z" })

  // ── MQ-01 (Biodiversa): ya salió del taller, falta recepcionarla ──
  await insertOt({
    id: "ot-term", vehicleId: IDS.machineBio, worksiteId: IDS.wsBio, status: "trabajo_terminado",
    entry: "2026-03-15T00:00:00Z", exit: "2026-03-16T12:00:00Z", estimated: "2026-03-10", createdAt: "2026-03-07T10:00:00Z",
  })

  // ── KA-200 (Cholguán): fuera del alcance de un supervisor de Biodiversa ──
  await insertOt({
    id: "ot-cho", vehicleId: IDS.truckCho, worksiteId: IDS.wsCho, status: "en_ejecucion",
    entry: "2026-03-18T00:00:00Z", estimated: "2026-04-10", createdAt: "2026-03-08T10:00:00Z",
  })
})

describe("workOrderMetricsScope", () => {
  it("sin mant:ot:view_* no hay alcance: el llamador no consulta ni pinta", async () => {
    // El mecánico ejecuta OT en el teléfono, pero no tiene las vistas de la web.
    expect(workOrderMetricsScope(await sessionOf(IDS.mecBio))).toBeNull()
    expect(workOrderMetricsScope(await sessionOf(IDS.plain))).toBeNull()
  })

  it("view_all ve todas las faenas", async () => {
    expect(workOrderMetricsScope(await sessionOf(IDS.jefe))).toBe("all")
  })

  it("view_worksite se acota a las faenas de la sesión", async () => {
    expect(workOrderMetricsScope(await sessionOf(IDS.supBio))).toEqual([IDS.wsBio])
  })

  it("un rol global con sólo view_worksite ve todas, como en el resto de la plataforma", () => {
    const session = { user: { id: "g", permissions: ["mant:ot:view_worksite"], isGlobal: true, worksiteIds: [] } } as unknown as Session
    expect(workOrderMetricsScope(session)).toBe("all")
  })

  it("view_worksite sin ninguna faena asignada no ve nada (no «todas»)", async () => {
    const session = { user: { id: "n", permissions: ["mant:ot:view_worksite"], isGlobal: false, worksiteIds: [] } } as unknown as Session
    const scope = workOrderMetricsScope(session)
    expect(scope).toEqual([])
    expect((await getWorkOrderGlobalMetrics(scope!)).openCount).toBe(0)
  })
})

describe("getVehicleWorkOrderMetrics", () => {
  it("cuenta las abiertas y las sin asignar por equipo, sin las cerradas ni las anuladas", async () => {
    const byVehicle = await getVehicleWorkOrderMetrics("all", { period: MARCH, now: NOW })
    const truck = byVehicle.get(IDS.truckBio)!
    // solicitada + asignada + en ejecución; la anulada y las tres cerradas no cuentan.
    expect(truck.openCount).toBe(3)
    expect(truck.unassignedOpen).toBe(1)
    // «Terminada, por recibir» sigue abierta (falta la conformidad) aunque ya salió del taller.
    expect(byVehicle.get(IDS.machineBio)).toMatchObject({ openCount: 1, unassignedOpen: 0 })
  })

  it("«en taller ahora» es sólo la OT en ejecución con ingreso y sin salida", async () => {
    const byVehicle = await getVehicleWorkOrderMetrics("all", { period: MARCH, now: NOW })
    expect(byVehicle.get(IDS.truckBio)!.inWorkshopNow).toBe(true)
    expect(byVehicle.get(IDS.machineBio)!.inWorkshopNow).toBe(false)
  })

  it("recorta las horas en taller al período y cuenta hasta «ahora» la OT que sigue dentro", async () => {
    const truck = (await getVehicleWorkOrderMetrics("all", { period: MARCH, now: NOW })).get(IDS.truckBio)!
    // El período arranca a medianoche de Chile (UTC-3 en marzo = 03:00Z), no a medianoche UTC:
    // 33 h de la reparación (del 01/03 03:00Z al 02/03 12:00Z, no las 72 h completas)
    // + 24 h de la mantención + 240 h de la que sigue en taller (10/03 08:00Z → 20/03 08:00Z).
    expect(truck.workshopHoursInPeriod).toBeCloseTo(33 + 24 + 240, 5)
    // La cerrada en febrero no aporta nada a marzo.
    const february = (await getVehicleWorkOrderMetrics("all", { period: { from: "2026-02-01", to: "2026-02-28" }, now: NOW })).get(IDS.truckBio)!
    // `ot-feb` desde la medianoche de Chile del 01/02 (03:00Z) hasta su salida (02/02 00:00Z): 21 h,
    // + la reparación desde el 27/02 12:00Z hasta la medianoche de Chile del 01/03 (03:00Z): 39 h.
    expect(february.workshopHoursInPeriod).toBeCloseTo(21 + 39, 5)
  })

  it("una OT que termina antes del período no suma horas en él", async () => {
    const april = (await getVehicleWorkOrderMetrics("all", { period: { from: "2026-04-01", to: "2026-04-30" }, now: new Date("2026-04-02T00:00:00Z") })).get(IDS.machineBio)!
    expect(april.workshopHoursInPeriod).toBe(0)
  })

  it("cuenta las cerradas por fecha de cierre dentro del período", async () => {
    const truck = (await getVehicleWorkOrderMetrics("all", { period: MARCH, now: NOW })).get(IDS.truckBio)!
    expect(truck.closedInPeriod).toBe(2)
    const february = (await getVehicleWorkOrderMetrics("all", { period: { from: "2026-02-01", to: "2026-02-28" }, now: NOW })).get(IDS.truckBio)!
    expect(february.closedInPeriod).toBe(1)
  })

  it("las reparaciones cerradas del período miden el ingreso → salida completos, no el recorte (base del MTTR)", async () => {
    const truck = (await getVehicleWorkOrderMetrics("all", { period: MARCH, now: NOW })).get(IDS.truckBio)!
    // Sólo `ot-rep` es reparación cerrada en marzo: 27/02 12:00 → 02/03 12:00 = 72 h (febrero tiene 28 días). La de sólo mantención no entra.
    expect(truck.repairClosedInPeriod).toBe(1)
    expect(truck.repairClosedWorkshopHours).toBeCloseTo(72, 5)
    expect(meanTimeToRepairHours(truck.repairClosedInPeriod, truck.repairClosedWorkshopHours)).toBeCloseTo(72, 5)
  })

  it("MTTR sin reparaciones cerradas es null, no 0", () => {
    expect(meanTimeToRepairHours(0, 0)).toBeNull()
  })

  it("suma el costo de las OT cerradas del período y no el de las abiertas, anuladas o de otro mes", async () => {
    const truck = (await getVehicleWorkOrderMetrics("all", { period: MARCH, now: NOW })).get(IDS.truckBio)!
    // `ot-rep` 100.000 + `ot-mant` 50.000; `ot-ejec` sigue abierta y `ot-anul` está anulada.
    expect(truck.maintenanceCostInPeriod).toBe(150_000)

    const february = (await getVehicleWorkOrderMetrics("all", { period: { from: "2026-02-01", to: "2026-02-28" }, now: NOW })).get(IDS.truckBio)!
    expect(february.maintenanceCostInPeriod).toBe(30_000)

    // Sin período no hay cifra del período: null, no 0.
    const noPeriod = (await getVehicleWorkOrderMetrics("all", { now: NOW })).get(IDS.truckBio)!
    expect(noPeriod.maintenanceCostInPeriod).toBeNull()

    // Equipo sin OT cerrada con costo: null, no 0.
    const machine = (await getVehicleWorkOrderMetrics("all", { period: MARCH, now: NOW })).get(IDS.machineBio)!
    expect(machine.maintenanceCostInPeriod).toBeNull()
  })

  it("trae la última salida de taller y la última OT cerrada", async () => {
    const truck = (await getVehicleWorkOrderMetrics("all", { period: MARCH, now: NOW })).get(IDS.truckBio)!
    expect(new Date(truck.lastExitAt!).toISOString()).toBe("2026-03-11T00:00:00.000Z")
    // Por fecha de cierre: `ot-mant` (12/03) es posterior a `ot-rep` (05/03).
    expect(truck.lastClosedWorkOrderId).toBe("ot-mant")
    const machine = (await getVehicleWorkOrderMetrics("all", { period: MARCH, now: NOW })).get(IDS.machineBio)!
    expect(machine.lastClosedWorkOrderId).toBeNull()
  })

  it("sin período no calcula nada del período (Flota sólo pide las abiertas)", async () => {
    const truck = (await getVehicleWorkOrderMetrics("all", { now: NOW })).get(IDS.truckBio)!
    expect(truck).toMatchObject({ openCount: 3, closedInPeriod: 0, workshopHoursInPeriod: 0, repairClosedInPeriod: 0, repairClosedWorkshopHours: 0 })
  })

  it("respeta el alcance de faena: un supervisor de Biodiversa no ve Cholguán", async () => {
    const scope = workOrderMetricsScope(await sessionOf(IDS.supBio))!
    const scoped = await getVehicleWorkOrderMetrics(scope, { period: MARCH, now: NOW })
    expect([...scoped.keys()].sort()).toEqual([IDS.machineBio, IDS.truckBio].sort())
    expect((await getVehicleWorkOrderMetrics("all", { period: MARCH, now: NOW })).has(IDS.truckCho)).toBe(true)
  })

  it("la faena elegida se intersecta con el alcance, nunca lo reemplaza", async () => {
    expect([...(await getVehicleWorkOrderMetrics([IDS.wsBio], { worksiteId: IDS.wsCho, now: NOW })).keys()]).toEqual([])
    expect([...(await getVehicleWorkOrderMetrics("all", { worksiteId: IDS.wsCho, now: NOW })).keys()]).toEqual([IDS.truckCho])
  })

  it("se acota a los equipos pedidos, y una lista vacía no consulta nada", async () => {
    expect([...(await getVehicleWorkOrderMetrics("all", { vehicleIds: [IDS.machineBio], now: NOW })).keys()]).toEqual([IDS.machineBio])
    expect((await getVehicleWorkOrderMetrics("all", { vehicleIds: [], now: NOW })).size).toBe(0)
  })
})

describe("getWorkOrderGlobalMetrics", () => {
  it("cuenta abiertas, sin asignar y con entrega estimada vencida (sólo en ejecución)", async () => {
    // Abiertas: 3 de KA-135 + 1 de MQ-01 + 1 de KA-200. Vencida: `ot-ejec` (estimada 20/03);
    // `ot-term` también tiene estimada pasada pero ya salió del taller, y `ot-cho` vence en abril.
    expect(await getWorkOrderGlobalMetrics("all", { today: TODAY })).toEqual({ openCount: 5, unassignedOpen: 1, estimateOverdue: 1 })
  })

  it("«hoy» decide qué estimada está vencida: el mismo día no lo está", async () => {
    expect((await getWorkOrderGlobalMetrics("all", { today: "2026-03-20" })).estimateOverdue).toBe(0)
    expect((await getWorkOrderGlobalMetrics("all", { today: "2026-03-21" })).estimateOverdue).toBe(1)
    expect((await getWorkOrderGlobalMetrics("all", { today: "2026-04-11" })).estimateOverdue).toBe(2)
  })

  it("respeta el alcance y la faena elegida", async () => {
    expect(await getWorkOrderGlobalMetrics([IDS.wsBio], { today: TODAY })).toEqual({ openCount: 4, unassignedOpen: 1, estimateOverdue: 1 })
    expect(await getWorkOrderGlobalMetrics("all", { worksiteId: IDS.wsCho, today: TODAY })).toEqual({ openCount: 1, unassignedOpen: 0, estimateOverdue: 0 })
    expect(await getWorkOrderGlobalMetrics([IDS.wsBio], { worksiteId: IDS.wsCho, today: TODAY })).toEqual({ openCount: 0, unassignedOpen: 0, estimateOverdue: 0 })
  })
})

describe("listRecentVehicleWorkOrders", () => {
  it("lista las últimas OT del equipo, la más reciente primero y sin las anuladas", async () => {
    const rows = await listRecentVehicleWorkOrders("all", IDS.truckBio)
    expect(rows.map((row) => row.id)).toEqual(["ot-mant", "ot-ejec", "ot-asig", "ot-sol", "ot-rep", "ot-feb"])
    expect(rows.find((row) => row.id === "ot-rep")).toMatchObject({ status: "cerrada", repair: true, maintenance: false, requestDate: "2026-02-20" })
    expect(rows.find((row) => row.id === "ot-sol")).toMatchObject({ workshopEntryAt: null, workshopExitAt: null })
  })

  it("respeta el límite", async () => {
    expect((await listRecentVehicleWorkOrders("all", IDS.truckBio, 2)).map((row) => row.id)).toEqual(["ot-mant", "ot-ejec"])
  })

  it("no muestra las OT de una faena fuera del alcance", async () => {
    expect(await listRecentVehicleWorkOrders([IDS.wsBio], IDS.truckCho)).toEqual([])
    expect((await listRecentVehicleWorkOrders([IDS.wsCho], IDS.truckCho)).map((row) => row.id)).toEqual(["ot-cho"])
  })
})

describe("Flota con OT", () => {
  const FLEET_SESSION = {
    user: { id: IDS.jefe, isGlobal: true, worksiteIds: [], permissions: ["flota:view", "combustibles:view", "mant:ot:view_all"] },
  } as unknown as Session
  const NO_OT_SESSION = {
    user: { id: IDS.jefe, isGlobal: true, worksiteIds: [], permissions: ["flota:view", "combustibles:view"] },
  } as unknown as Session

  beforeAll(async () => {
    await testDb.insert(schema.fuelOperationBatches).values({
      id: "batch-ot", archivoNombre: "log.xlsx", hashArchivo: "h", periodoDesde: "2026-01-01", periodoHasta: "2026-04-30", importadoPor: IDS.jefe,
    })
    const record = (fecha: string, rendimiento: number) => ({
      id: `rec-${fecha}`, batchId: "batch-ot", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, plate: "RBYD-98", fecha, liters: 100, rendimiento,
    })
    await testDb.insert(schema.fuelOperationRecords).values([
      record("2026-01-15", 99), record("2026-02-20", 4), record("2026-03-01", 6), record("2026-03-02", 100), record("2026-03-10", 8), record("2026-04-05", 8),
    ])
  })

  it("la lista suma OT abiertas por equipo sólo si se pide y hay capacidad", async () => {
    const rows = await getFleetOverview(FLEET_SESSION, undefined, undefined, { workOrders: true })
    expect(rows.find((row) => row.id === IDS.truckBio)).toMatchObject({ openWorkOrders: 3, inWorkshopNow: true })
    expect(rows.find((row) => row.id === IDS.machineBio)).toMatchObject({ openWorkOrders: 1, inWorkshopNow: false })
    expect(rows.find((row) => row.id === IDS.truckAra)).toMatchObject({ openWorkOrders: 0, inWorkshopNow: false })

    const withoutOption = await getFleetOverview(FLEET_SESSION)
    expect(withoutOption.every((row) => row.openWorkOrders === null)).toBe(true)
    const withoutCapability = await getFleetOverview(NO_OT_SESSION, undefined, undefined, { workOrders: true })
    expect(withoutCapability.every((row) => row.openWorkOrders === null)).toBe(true)
  })

  it("la ficha trae las últimas OT y el rendimiento ±30 días de la salida de cada OT cerrada, en hora de Chile", async () => {
    const detail = await getFleetVehicleDetail(FLEET_SESSION, IDS.truckBio)
    expect(detail!.recentWorkOrders?.map((workOrder) => workOrder.id)).toEqual(["ot-mant", "ot-ejec", "ot-asig", "ot-sol", "ot-rep", "ot-feb"])

    const impact = (id: string) => detail!.workOrderConsumptionImpact.find((row) => row.workOrderId === id)!
    // Sólo las cerradas con salida: ni la que sigue en taller ni las pendientes.
    expect(detail!.workOrderConsumptionImpact.map((row) => row.workOrderId).sort()).toEqual(["ot-feb", "ot-mant", "ot-rep"])
    // Salida 02/03 (ventana 31/01–01/04). La carga del propio día de salida no cuenta ni antes ni después, y la del 05/04 queda fuera.
    expect(impact("ot-rep")).toMatchObject({ avgBefore: 5, avgAfter: 8 })
    // Salida 11/03 00:00 UTC = 10/03 21:00 en Chile: el día de salida es el 10/03, no el 11. Con UTC la carga del 10/03 caería «antes».
    expect(impact("ot-mant").avgBefore).toBeCloseTo((4 + 6 + 100) / 3, 5)
    expect(impact("ot-mant").avgAfter).toBe(8)
    // Salida 02/02 00:00 UTC = 01/02 21:00 en Chile.
    expect(impact("ot-feb").avgBefore).toBe(99)
    expect(impact("ot-feb").avgAfter).toBeCloseTo((4 + 6 + 100) / 3, 5)
  })

  it("sin mant:ot:view_* la ficha no trae OT", async () => {
    const detail = await getFleetVehicleDetail(NO_OT_SESSION, IDS.truckBio)
    expect(detail!.recentWorkOrders).toBeNull()
    expect(detail!.workOrderConsumptionImpact).toEqual([])
  })
})
