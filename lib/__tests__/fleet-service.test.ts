import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"

let selectCallCount = 0
const selectResults: Array<{ data: unknown[] }> = []
const findManyVehicles = vi.fn()
const findFirstVehicle = vi.fn()
const findManyDocuments = vi.fn()
const findManyMaintenance = vi.fn()
const findManyOperations = vi.fn()
const findManyIntervals = vi.fn()

const selectChains: Array<Record<string, ReturnType<typeof vi.fn>>> = []
const selectProjections: unknown[] = []

function createChain(data: unknown[] = []) {
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
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
      maintenanceRecords: { findMany: (...args: unknown[]) => findManyMaintenance(...args) },
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

import { getFleetOverview, getFleetVehicleDetail } from "@/lib/services/fleet"

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

const globalSession = { user: { id: "user-1", isGlobal: true, worksiteIds: [], permissions: ["flota:view", "combustibles:view", "mantenciones:view", "combustibles:view_costs"] } } as unknown as Session
const scopedSession = { user: { id: "user-2", isGlobal: false, worksiteIds: ["ws-1", "ws-2"], permissions: ["flota:view", "combustibles:view", "mantenciones:view"] } } as unknown as Session

beforeEach(() => {
  vi.clearAllMocks()
  selectCallCount = 0
  selectResults.length = 0
  selectChains.length = 0
  selectProjections.length = 0
})

describe("getFleetOverview", () => {
  it("operational cost = fuel + maintenance (no allocations)", async () => {
    findManyVehicles.mockResolvedValue([
      {
        id: "veh-1",
        plate: "AA-BB-11",
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
        worksite: { name: "Faena Uno" },
        responsibleUser: { name: "Jefe Mantención", email: "mantencion@chome.cl" },
      },
    ])
    selectResults.push(
      { data: [{ vehicleId: "veh-1", totalFuelAmount: 100_000, totalLiters: 80, loadCount: 2 }] },
      { data: [{ vehicleId: "veh-1", odometerReading: 10_000, hourMeterReading: null }] },
      { data: [{ vehicleId: "veh-1", odometerReading: 12_500, hourMeterReading: null }] },
      { data: [{ vehicleId: "veh-1", totalMaintenanceAmount: 250_000, maintenanceCount: 1, lastMaintenanceDate: "2026-06-01" }] },
      { data: [] },
    )

    const overview = await getFleetOverview(globalSession)

    expect(overview).toHaveLength(1)
    const vehicle = overview[0]!
    expect(vehicle.totalFuelAmount).toBe(100_000)
    expect(vehicle.totalMaintenanceAmount).toBe(250_000)
    expect(vehicle.totalOperationalCost).toBe(350_000)
    expect(vehicle.responsibleName).toBe("Jefe Mantención")
    expect(vehicle.operationalStatus).toBe("operativo")
    expect(vehicle.nextExpiryDate).toBe("2026-07-20")
    // La imputación de costos fue retirada: no debe existir ese campo.
    expect("totalAllocatedAmount" in vehicle).toBe(false)
    expect("allocationCount" in vehicle).toBe(false)
  })

  it("returns no rows when a scoped user has no visible vehicles", async () => {
    const withoutWorksites = { user: { id: "user-3", isGlobal: false, worksiteIds: [] } } as unknown as Session
    findManyVehicles.mockResolvedValue([])
    selectResults.push({ data: [] }, { data: [] })

    const overview = await getFleetOverview(withoutWorksites)
    expect(overview).toEqual([])
  })

  it("redacta costos y no referencia columnas monetarias sin view_costs", async () => {
    const noCostsSession = { user: { id: "user-no-costs", isGlobal: true, worksiteIds: [], permissions: ["flota:view", "combustibles:view", "mantenciones:view"] } } as unknown as Session
    findManyVehicles.mockResolvedValue([{ id: "veh-1", plate: "AA-BB-11", type: "camioneta", isActive: true, operationalStatus: "operativo", worksite: { name: "Faena" }, equipmentType: null, responsibleUser: null }])
    selectResults.push(
      { data: [{ vehicleId: "veh-1", totalFuelAmount: null, totalLiters: 80, loadCount: 2 }] },
      { data: [] },
      { data: [] },
      { data: [{ vehicleId: "veh-1", totalMaintenanceAmount: null, maintenanceCount: 1 }] },
      { data: [] },
    )

    const [vehicle] = await getFleetOverview(noCostsSession)

    expect(vehicle).toMatchObject({ totalFuelAmount: null, totalMaintenanceAmount: null, totalOperationalCost: null, costPerKm: null, costPerHour: null })
    // Orden real: fuelRows(0), firstReadingRows(1), lastReadingRows(2), maintenanceRows(3), documentExpiryRows(4).
    expect(sqlChunks((selectProjections[0] as { totalFuelAmount: unknown }).totalFuelAmount).join(" ").toLowerCase()).not.toContain("total_amount")
    expect(sqlChunks((selectProjections[3] as { totalMaintenanceAmount: unknown }).totalMaintenanceAmount).join(" ").toLowerCase()).not.toContain("total_amount")
  })

  it("no consulta datasets de combustible ni mantención con flota:view solamente", async () => {
    const fleetOnlySession = { user: { id: "fleet-only", isGlobal: true, worksiteIds: [], permissions: ["flota:view"] } } as unknown as Session
    findManyVehicles.mockResolvedValue([])

    await getFleetOverview(fleetOnlySession)

    expect(selectProjections).toHaveLength(1)
    // La vigencia dejó de ser un `MIN` sobre toda la pila: se leen los
    // documentos vigentes por tipo y la fecha se resuelve en memoria (CO-021).
    expect(selectProjections[0]).toHaveProperty("documentType")
    expect(selectProjections[0]).toHaveProperty("expiresAt")
  })

  // HALLAZGO 11: la faena elegida en el tablero tiene que reencuadrar las tres
  // consultas, no sólo el alcance del rol.
  it("acota las tres consultas a la faena elegida en el tablero", async () => {
    findManyVehicles.mockResolvedValue([])
    selectResults.push({ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] })

    await getFleetOverview(scopedSession, "ws-1")

    // La sesión ve ws-1 y ws-2; al elegir ws-1 en el tablero, ws-2 no puede
    // seguir apareciendo en ninguna de las tres consultas. Orden real:
    // fuelRows(0), firstReadingRows(1), lastReadingRows(2), maintenanceRows(3).
    for (const where of [
      findManyVehicles.mock.calls[0]![0].where,
      selectChains[0]!.where!.mock.calls[0]![0],
      selectChains[3]!.where!.mock.calls[0]![0],
    ]) {
      expect(sqlChunks(where)).toContain("ws-1")
      expect(sqlChunks(where)).not.toContain("ws-2")
    }
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
  // HALLAZGO 20: con `limit: 10` el orden ascendente devolvía las mantenciones
  // más antiguas y la última del vehículo era inalcanzable.
  it("pide las mantenciones de la más reciente a la más antigua", async () => {
    findFirstVehicle.mockResolvedValue({ id: "veh-1", worksiteId: "ws-1", plate: "AA-BB-11" })
    findManyDocuments.mockResolvedValue([])
    findManyMaintenance.mockResolvedValue([])
    findManyOperations.mockResolvedValue([])
    findManyIntervals.mockResolvedValue([])
    selectResults.push({ data: [] })

    await getFleetVehicleDetail(globalSession, "veh-1")

    const orderBy = findManyMaintenance.mock.calls[0]![0].orderBy as unknown[]
    expect(sqlChunks(orderBy[0]).join("")).toContain("desc")
    // Desempate por createdAt: `maintenance_date` es sólo fecha.
    expect(orderBy).toHaveLength(2)
    expect(sqlChunks(orderBy[1]).join("")).toContain("desc")
    expect(findManyMaintenance.mock.calls[0]![0].columns).not.toHaveProperty("totalAmount")
    expect(findManyMaintenance.mock.calls[0]![0].columns).not.toHaveProperty("netAmount")
    expect(findManyOperations.mock.calls[0]![0].columns).not.toHaveProperty("monto")
    expect(findManyOperations.mock.calls[0]![0].columns).not.toHaveProperty("precioLitro")
  })

  it("no consulta historial de combustible ni mantención con flota:view solamente", async () => {
    const fleetOnlySession = { user: { id: "fleet-only", isGlobal: true, worksiteIds: [], permissions: ["flota:view"] } } as unknown as Session
    findFirstVehicle.mockResolvedValue({ id: "veh-1", worksiteId: "ws-1", plate: "AA-BB-11" })
    findManyDocuments.mockResolvedValue([])
    findManyIntervals.mockResolvedValue([])

    const detail = await getFleetVehicleDetail(fleetOnlySession, "veh-1")

    expect(detail).not.toBeNull()
    expect(findManyMaintenance).not.toHaveBeenCalled()
    expect(findManyOperations).not.toHaveBeenCalled()
    expect(selectProjections).toHaveLength(0)
  })
})
