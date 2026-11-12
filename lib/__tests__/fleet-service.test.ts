import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"

let selectCallCount = 0
const selectResults: Array<{ data: unknown[] }> = []
const findManyVehicles = vi.fn()
const findFirstVehicle = vi.fn()
const findManyDocuments = vi.fn()
const findManyOperations = vi.fn()
const findManyIntervals = vi.fn()

const selectChains: Array<Record<string, ReturnType<typeof vi.fn>>> = []
const selectProjections: unknown[] = []

function createChain(data: unknown[] = []) {
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  chain.innerJoin = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  selectChains.push(chain as Record<string, ReturnType<typeof vi.fn>>)
  chain.groupBy = vi.fn(() => chain)
  chain.orderBy = vi.fn(() => chain)
  chain.limit = vi.fn(() => chain)
  chain.then = (resolve: (value: unknown[]) => void, reject?: (error: unknown) => void) =>
    Promise.resolve(data).then(resolve, reject)
  return chain
}

vi.mock("@/db", () => ({
  db: {
    query: {
      fuelVehicles: {
        findMany: (...args: unknown[]) => findManyVehicles(...args),
        findFirst: (...args: unknown[]) => findFirstVehicle(...args),
      },
      fleetVehicleDocuments: { findMany: (...args: unknown[]) => findManyDocuments(...args) },
      fuelOperationRecords: { findMany: (...args: unknown[]) => findManyOperations(...args) },
      fuelVehicleOperationalIntervals: { findMany: (...args: unknown[]) => findManyIntervals(...args) },
    },
    select: (projection: unknown) => {
      selectProjections.push(projection)
      const idx = selectCallCount++
      return createChain(selectResults[idx]?.data ?? [])
    },
    selectDistinctOn: (_columns: unknown, projection: unknown) => {
      selectProjections.push(projection)
      const idx = selectCallCount++
      return createChain(selectResults[idx]?.data ?? [])
    },
  },
}))

// El historial de compras tiene su propia suite PGlite (`vehicle-purchase-history-pglite`):
// acá sólo importa CUÁNDO la ficha lo pide y qué hace con el resultado.
const getVehiclePurchaseHistory = vi.fn()
vi.mock("@/lib/services/vehicle-purchase-history", () => ({
  getVehiclePurchaseHistory: (...args: unknown[]) => getVehiclePurchaseHistory(...args),
}))

import { getFleetOverview, getFleetVehicleDetail } from "@/lib/services/fleet"
import { addMonths, todayInChile } from "@/lib/utils"

/**
 * Texto de los trozos literales y de los parámetros de un predicado/orden de
 * Drizzle. Sirve para afirmar sobre la consulta sin levantar Postgres.
 */
function sqlChunks(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(node)
    return out
  }
  if (!node || typeof node !== "object") return out
  if (Array.isArray(node)) {
    for (const item of node) sqlChunks(item, out)
    return out
  }
  const candidate = node as { queryChunks?: unknown[]; value?: unknown }
  if (Array.isArray(candidate.queryChunks)) {
    for (const chunk of candidate.queryChunks) sqlChunks(chunk, out)
    return out
  }
  if (typeof candidate.value === "string") out.push(candidate.value)
  else if (Array.isArray(candidate.value)) {
    for (const part of candidate.value) if (typeof part === "string") out.push(part)
  }
  return out
}

const globalSession = { user: { id: "user-1", isGlobal: true, worksiteIds: [], permissions: ["flota:view", "combustibles:view", "combustibles:view_costs"] } } as unknown as Session
const scopedSession = { user: { id: "user-2", isGlobal: false, worksiteIds: ["ws-1", "ws-2"], permissions: ["flota:view", "combustibles:view"] } } as unknown as Session

beforeEach(() => {
  vi.clearAllMocks()
  selectCallCount = 0
  selectResults.length = 0
  selectChains.length = 0
  selectProjections.length = 0
})

describe("getFleetOverview", () => {
  it("returns fuel totals and readings without legacy maintenance costs", async () => {
    findManyVehicles.mockResolvedValue([
      {
        id: "veh-1",
        plate: "AA-BB-11",
        code: "KA-90",
        type: "camioneta",
        brand: "Toyota",
        model: "Hilux",
        year: 2022,
        isActive: true,
        operationalStatus: "operativo",
        soapExpiresAt: "2026-09-01",
        technicalReviewExpiresAt: "2026-08-15",
        circulationPermitExpiresAt: "2027-03-31",
        insuranceExpiresAt: "2026-07-20",
        performanceUnit: "km_per_liter",
        worksite: { name: "Faena Uno" },
        responsibleUser: { name: "Jefe Mantención", email: "mantencion@chome.cl" },
        // La ficha dice «operativo», pero el intervalo abierto es «mantención».
        operationalIntervals: [{ status: "mantencion" }],
      },
    ])
    // Orden real: combustible, lecturas de medidor, regla de salto, documentos.
    const today = todayInChile()
    const since = addMonths(today, -12)
    selectResults.push(
      { data: [{ vehicleId: "veh-1", totalFuelAmount: 100_000, totalLiters: 80, loadCount: 2 }] },
      { data: [
        { id: "mr-1", vehicleId: "veh-1", source: "copec_tct", meterType: "odometer", occurredAt: `${since}T12:00:00.000Z`, value: 10_000, acceptedReset: false },
        { id: "mr-2", vehicleId: "veh-1", source: "copec_tct", meterType: "odometer", occurredAt: `${today}T12:00:00.000Z`, value: 12_500, acceptedReset: false },
      ] },
      { data: [] },
      { data: [] },
    )

    const overview = await getFleetOverview(globalSession)

    expect(overview).toHaveLength(1)
    const vehicle = overview[0]!
    expect(vehicle.totalFuelAmount).toBe(100_000)
    expect(vehicle).not.toHaveProperty("totalMaintenanceAmount")
    expect(vehicle).not.toHaveProperty("totalOperationalCost")
    expect(vehicle.responsibleName).toBe("Jefe Mantención")
    expect(vehicle.operationalStatus).toBe("operativo")
    expect(vehicle.stateMismatch).toBe(true)
    expect(vehicle.nextExpiryDate).toBe("2026-07-20")
    // El tipo del documento al que pertenece esa fecha (el seguro es el que vence antes) y el código del equipo.
    expect(vehicle.nextExpiryDocumentType).toBe("Seguro")
    expect(vehicle.code).toBe("KA-90")
    // Las lecturas salen de `fuel_meter_readings` (Copec), no de `fuel_loads`.
    expect(vehicle).toMatchObject({ lastOdometerReading: 12_500, lastHourMeterReading: null, kmDriven: 2_500, hoursRun: null, meterSeriesIncomplete: false })
    // El cruce que faltaba: 100.000 de gasto del proveedor ÷ 2.500 km.
    expect(vehicle.fuelCostPerUnit).toBe(40)
    expect(vehicle.fuelCostPerUnitLabel).toBe("CLP/km")
    // La imputación de costos fue retirada: no debe existir ese campo.
    expect("totalAllocatedAmount" in vehicle).toBe(false)
    expect("allocationCount" in vehicle).toBe(false)
  })

  it("elige una fuente que cubra los 12 meses y no divide el gasto por una serie parcial", async () => {
    findManyVehicles.mockResolvedValue([{
      id: "veh-1", plate: "AA-BB-11", type: "camioneta", isActive: true, operationalStatus: "operativo",
      performanceUnit: "km_per_liter", worksite: { name: "Faena Uno" }, responsibleUser: null,
    }])
    const today = todayInChile()
    const since = addMonths(today, -12)
    const recent = addMonths(today, -1)
    selectResults.push(
      { data: [{ vehicleId: "veh-1", totalFuelAmount: 100_000, totalLiters: 80, loadCount: 2 }] },
      { data: [
        // Copec sólo tiene los últimos días: no puede dividir 12 meses de gasto.
        { id: "copec-1", vehicleId: "veh-1", source: "copec_tct", meterType: "odometer", occurredAt: `${recent}T12:00:00.000Z`, value: 11_000, acceptedReset: false },
        { id: "copec-2", vehicleId: "veh-1", source: "copec_tct", meterType: "odometer", occurredAt: `${today}T12:00:00.000Z`, value: 11_200, acceptedReset: false },
        // Wialon sí cubre la ventana completa.
        { id: "wialon-1", vehicleId: "veh-1", source: "gps_wialon", meterType: "odometer", occurredAt: `${since}T12:00:00.000Z`, value: 10_000, acceptedReset: false },
        { id: "wialon-2", vehicleId: "veh-1", source: "gps_wialon", meterType: "odometer", occurredAt: `${today}T12:00:00.000Z`, value: 12_500, acceptedReset: false },
      ] },
      { data: [] },
      { data: [] },
    )

    const [vehicle] = await getFleetOverview(globalSession)
    if (!vehicle) throw new Error("Se esperaba el vehículo")

    expect(vehicle).toMatchObject({ meterSource: "gps_wialon", meterSeriesCovered: true })
    expect(vehicle.fuelCostPerUnit).toBe(40)
  })

  it("deja el costo por km/h vacío si la única serie no cubre la ventana", async () => {
    findManyVehicles.mockResolvedValue([{
      id: "veh-1", plate: "AA-BB-11", type: "camioneta", isActive: true, operationalStatus: "operativo",
      performanceUnit: "km_per_liter", worksite: { name: "Faena Uno" }, responsibleUser: null,
    }])
    const today = todayInChile()
    const recent = addMonths(today, -1)
    selectResults.push(
      { data: [{ vehicleId: "veh-1", totalFuelAmount: 100_000, totalLiters: 80, loadCount: 2 }] },
      { data: [
        { id: "copec-1", vehicleId: "veh-1", source: "copec_tct", meterType: "odometer", occurredAt: `${recent}T12:00:00.000Z`, value: 11_000, acceptedReset: false },
        { id: "copec-2", vehicleId: "veh-1", source: "copec_tct", meterType: "odometer", occurredAt: `${today}T12:00:00.000Z`, value: 11_200, acceptedReset: false },
      ] },
      { data: [] },
      { data: [] },
    )

    const [vehicle] = await getFleetOverview(globalSession)
    if (!vehicle) throw new Error("Se esperaba el vehículo")

    expect(vehicle.meterSeriesCovered).toBe(false)
    expect(vehicle.fuelCostPerUnit).toBeNull()
    // La lectura igual se muestra: lo que no se publica es el costo del período.
    expect(vehicle.lastOdometerReading).toBe(11_200)
  })

  describe("OT abiertas por equipo", () => {
    const vehicle = (id: string) => ({
      id, plate: `PL-${id}`, type: "camioneta", brand: null, model: null, year: null, isActive: true, operationalStatus: "operativo",
      soapExpiresAt: null, technicalReviewExpiresAt: null, circulationPermitExpiresAt: null, insuranceExpiresAt: null,
      worksite: { name: "Faena Uno" }, responsibleUser: null,
    })
    const withOt = (...permissions: string[]) =>
      ({ user: { id: "user-ot", isGlobal: true, worksiteIds: [], permissions: ["flota:view", ...permissions] } }) as unknown as Session

    it("es opt-in: sin la opción no consulta OT y el campo queda en null", async () => {
      findManyVehicles.mockResolvedValue([vehicle("v1")])
      const [row] = await getFleetOverview(withOt("mant:ot:view_all"))

      expect(row!.openWorkOrders).toBeNull()
      expect(row!.inWorkshopNow).toBeNull()
      // Sólo la consulta de documentos de vencimiento: ninguna toca `mant_work_orders`.
      expect(selectCallCount).toBe(1)
    })

    it("sin mant:ot:view_* no consulta OT aunque se pida, y el campo no es un 0 engañoso", async () => {
      findManyVehicles.mockResolvedValue([vehicle("v1")])
      const [row] = await getFleetOverview(withOt(), undefined, undefined, { workOrders: true })

      expect(row!.openWorkOrders).toBeNull()
      expect(selectCallCount).toBe(1)
    })

    it("con la capacidad trae las abiertas y si está en taller; un equipo sin OT tiene 0", async () => {
      findManyVehicles.mockResolvedValue([vehicle("v1"), vehicle("v2")])
      // Sin `combustibles:view` quedan sólo documentos (1.ª consulta) y OT (2.ª).
      selectResults.push(
        { data: [] },
        { data: [{ vehicleId: "v1", openCount: 2, unassignedOpen: 1, inWorkshopNow: 1, closedInPeriod: 0, workshopHoursInPeriod: 0, repairClosedInPeriod: 0, repairClosedWorkshopHours: 0, lastExitAt: null, lastClosedWorkOrderId: null }] },
      )
      const rows = await getFleetOverview(withOt("mant:ot:view_worksite"), undefined, undefined, { workOrders: true })

      expect(rows.find((row) => row.id === "v1")).toMatchObject({ openWorkOrders: 2, inWorkshopNow: true })
      expect(rows.find((row) => row.id === "v2")).toMatchObject({ openWorkOrders: 0, inWorkshopNow: false })
    })
  })

  it("returns no rows when a scoped user has no visible vehicles", async () => {
    const withoutWorksites = { user: { id: "user-3", isGlobal: false, worksiteIds: [] } } as unknown as Session
    findManyVehicles.mockResolvedValue([])
    selectResults.push({ data: [] }, { data: [] })

    const overview = await getFleetOverview(withoutWorksites)
    expect(overview).toEqual([])
  })

  it("redacta costos y no referencia columnas monetarias sin view_costs", async () => {
    const noCostsSession = { user: { id: "user-no-costs", isGlobal: true, worksiteIds: [], permissions: ["flota:view", "combustibles:view"] } } as unknown as Session
    findManyVehicles.mockResolvedValue([{ id: "veh-1", plate: "AA-BB-11", type: "camioneta", isActive: true, operationalStatus: "operativo", worksite: { name: "Faena" }, equipmentType: null, responsibleUser: null }])
    selectResults.push(
      { data: [{ vehicleId: "veh-1", totalFuelAmount: null, totalLiters: 80, loadCount: 2 }] },
      { data: [] },
      { data: [] },
      { data: [] },
      { data: [] },
    )

    const [vehicle] = await getFleetOverview(noCostsSession)

    expect(vehicle).toMatchObject({ totalFuelAmount: null, totalLiters: 80 })
    // Orden real: fuelRows(0), meterRows(1), objectionRows(2), jumpRules(3), documentExpiryRows(4).
    expect(sqlChunks((selectProjections[0] as { totalFuelAmount: unknown }).totalFuelAmount).join(" ").toLowerCase()).not.toContain("total_amount")
  })

  it("no consulta datasets de combustible con flota:view solamente", async () => {
    const fleetOnlySession = { user: { id: "fleet-only", isGlobal: true, worksiteIds: [], permissions: ["flota:view"] } } as unknown as Session
    findManyVehicles.mockResolvedValue([])

    await getFleetOverview(fleetOnlySession)

    expect(selectProjections).toHaveLength(1)
    // La vigencia dejó de ser un `MIN` sobre toda la pila: se leen los
    // documentos vigentes por tipo y la fecha se resuelve en memoria (CO-021).
    expect(selectProjections[0]).toHaveProperty("documentType")
    expect(selectProjections[0]).toHaveProperty("expiresAt")
  })

  // HALLAZGO 11: la faena elegida en el tablero tiene que reencuadrar las consultas de
  // combustible, de lecturas de medidor y de documentos, no sólo el alcance del rol.
  it("acota las consultas con alcance a la faena elegida en el tablero", async () => {
    findManyVehicles.mockResolvedValue([])
    selectResults.push({ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] })

    await getFleetOverview(scopedSession, "ws-1")

    // Orden real: combustible(0), lecturas de medidor(1), casos abiertos sobre esas lecturas(2), regla de
    // salto(3), documentos(4). La regla `salto_medidor_implausible` es una configuración global, sin faena:
    // no entra al reencuadre.
    expect(selectChains).toHaveLength(5)
    const scopedWheres = selectChains.filter((_, index) => index !== 3).map((chain) => chain.where!.mock.calls[0]![0])
    // La sesión ve ws-1 y ws-2; al elegir ws-1 en el tablero, ws-2 no puede
    // seguir apareciendo en ninguna consulta de combustible ni documentos.
    for (const where of [findManyVehicles.mock.calls[0]![0].where, ...scopedWheres]) {
      expect(sqlChunks(where)).toContain("ws-1")
      expect(sqlChunks(where)).not.toContain("ws-2")
    }
    // Las lecturas ya no se filtran a Copec: se leen todas las fuentes y la
    // selección (Copec → Wialon → OnWay) ocurre en memoria.
    expect(sqlChunks(selectChains[1]!.where!.mock.calls[0]![0])).not.toContain("copec_tct")
    expect(sqlChunks(selectChains[2]!.where!.mock.calls[0]![0])).not.toContain("copec_tct")
  })

  it("no devuelve filas de una faena fuera del alcance del rol", async () => {
    findManyVehicles.mockResolvedValue([])
    selectResults.push({ data: [] }, { data: [] })

    await getFleetOverview(scopedSession, "ws-fuera-de-alcance")

    const where = sqlChunks(findManyVehicles.mock.calls[0]![0].where)
    expect(where).not.toContain("ws-fuera-de-alcance")
    expect(where).not.toContain("ws-1")
    expect(where.join("")).toContain("false")
  })
})

describe("getFleetVehicleDetail", () => {
  it("loads the latest fuel operations and no legacy maintenance history", async () => {
    findFirstVehicle.mockResolvedValue({ id: "veh-1", worksiteId: "ws-1", plate: "AA-BB-11" })
    findManyDocuments.mockResolvedValue([])
    findManyOperations.mockResolvedValue([])
    findManyIntervals.mockResolvedValue([])
    selectResults.push({ data: [] })

    await getFleetVehicleDetail(globalSession, "veh-1")

    const orderBy = findManyOperations.mock.calls[0]![0].orderBy as unknown[]
    expect(sqlChunks(orderBy[0]).join("")).toContain("desc")
    expect(orderBy).toHaveLength(2)
    expect(sqlChunks(orderBy[1]).join("")).toContain("desc")
    expect(findManyOperations.mock.calls[0]![0].columns).not.toHaveProperty("monto")
    expect(findManyOperations.mock.calls[0]![0].columns).not.toHaveProperty("precioLitro")
  })

  it("no consulta historial de combustible con flota:view solamente", async () => {
    const fleetOnlySession = { user: { id: "fleet-only", isGlobal: true, worksiteIds: [], permissions: ["flota:view"] } } as unknown as Session
    findFirstVehicle.mockResolvedValue({ id: "veh-1", worksiteId: "ws-1", plate: "AA-BB-11" })
    findManyDocuments.mockResolvedValue([])
    findManyIntervals.mockResolvedValue([])

    const detail = await getFleetVehicleDetail(fleetOnlySession, "veh-1")

    expect(detail).not.toBeNull()
    expect(findManyOperations).not.toHaveBeenCalled()
    expect(selectProjections).toHaveLength(0)
    // Sin `mant:ot:view_*` la ficha no sabe de OT: `null`, no «sin órdenes de trabajo».
    expect(detail!.recentWorkOrders).toBeNull()
    expect(detail!.workOrderConsumptionImpact).toEqual([])
    // Ídem para las compras: sin `purchasing:view` ni se consultan ni se dicen vacías.
    expect(detail!.recentPurchases).toBeNull()
    expect(getVehiclePurchaseHistory).not.toHaveBeenCalled()
  })

  it("con purchasing:view trae las compras vinculadas del equipo", async () => {
    const withPurchases = { user: { id: "buyer", isGlobal: true, worksiteIds: [], permissions: ["flota:view", "purchasing:view"] } } as unknown as Session
    findFirstVehicle.mockResolvedValue({ id: "veh-1", worksiteId: "ws-1", plate: "AA-BB-11" })
    findManyDocuments.mockResolvedValue([])
    findManyIntervals.mockResolvedValue([])
    getVehiclePurchaseHistory.mockResolvedValue([{ requestItemId: "item-1", itemName: "Filtro hidráulico" }])

    const detail = await getFleetVehicleDetail(withPurchases, "veh-1")

    expect(getVehiclePurchaseHistory).toHaveBeenCalledWith("veh-1")
    expect(detail!.recentPurchases).toEqual([{ requestItemId: "item-1", itemName: "Filtro hidráulico" }])
  })

  it("un vehículo fuera del alcance de faenas no consulta compras", async () => {
    const outOfScope = { user: { id: "buyer", isGlobal: false, worksiteIds: ["ws-otra"], permissions: ["flota:view", "purchasing:view"] } } as unknown as Session
    findFirstVehicle.mockResolvedValue({ id: "veh-1", worksiteId: "ws-1", plate: "AA-BB-11" })

    expect(await getFleetVehicleDetail(outOfScope, "veh-1")).toBeNull()
    expect(getVehiclePurchaseHistory).not.toHaveBeenCalled()
  })

  it("con mant:ot:view_* trae las últimas OT del equipo; el antes/después de rendimiento exige combustible y una OT cerrada", async () => {
    const withOt = { user: { id: "ot", isGlobal: true, worksiteIds: [], permissions: ["flota:view", "mant:ot:view_all"] } } as unknown as Session
    findFirstVehicle.mockResolvedValue({ id: "veh-1", worksiteId: "ws-1", plate: "AA-BB-11" })
    findManyDocuments.mockResolvedValue([])
    findManyIntervals.mockResolvedValue([])
    selectResults.push({ data: [
      { id: "ot-2", folio: "OT-BIO-0002", status: "en_ejecucion", repair: true, maintenance: false, requestDate: "2026-10-30", workshopEntryAt: "2026-10-31T12:00:00Z", workshopExitAt: null },
      { id: "ot-1", folio: "OT-BIO-0001", status: "cerrada", repair: true, maintenance: true, requestDate: "2026-10-01", workshopEntryAt: "2026-10-02T12:00:00Z", workshopExitAt: "2026-10-05T12:00:00Z" },
    ] })

    const detail = await getFleetVehicleDetail(withOt, "veh-1")

    expect(detail!.recentWorkOrders?.map((workOrder) => workOrder.folio)).toEqual(["OT-BIO-0002", "OT-BIO-0001"])
    // Sin `combustibles:view` no hay log de rendimiento que comparar.
    expect(detail!.workOrderConsumptionImpact).toEqual([])
    expect(selectProjections).toHaveLength(1)
  })
})
