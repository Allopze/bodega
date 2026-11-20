import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, globalSession, seedControlFixtures, submission } from "@/lib/combustibles/control/queries/test-fixtures"

/**
 * Vistas de gestión de combustible sin los días de uso personal, contra Postgres de verdad:
 * resumen de Control operacional (cargas facturadas, TCT por faena y TAE), Consumo y operaciones.
 *
 * vA estuvo en uso personal del 10 al 19 de octubre; vB y los registros sin equipo no.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const { getFuelControlOverview } = await import("@/lib/combustibles/fuel-control-overview")
const { getConsumptionByEquipmentType, getConsumptionDashboard, getEvolutionByVehicle, getWorksiteEquipmentMatrix } = await import("@/lib/combustibles/consumption-dashboard")
const { getOperationsSummary, getScatterObservations } = await import("@/lib/combustibles/operations-dashboard")

const FROM = "2026-10-01"
const TO = "2026-10-31"
const USER = IDS.user

function costSession() {
  const base = globalSession()
  return { ...base, user: { ...base.user, permissions: ["combustibles:view", "combustibles:view_costs"] } } as ReturnType<typeof globalSession>
}

let seq = 0
async function addBilledLoad(vehicleId: string, worksiteId: string, loadDate: string, liters: number, totalAmount: number) {
  seq += 1
  await testDb.insert(schema.fuelLoads).values({
    id: `mv-fl-${seq}`, loadDate, month: loadDate.slice(0, 7), serviceType: "TCT", vehicleId, fuelSupplierId: "mv-sup", worksiteId,
    product: "PETROLEO DIESEL", productId: IDS.product, liters, baseAmount: totalAmount, totalAmount, status: "registered", createdBy: USER,
  })
}

async function addConsumption(input: { vehicleId: string | null; worksiteId: string; patente: string; cantidad: number; monto: number; from: string; to: string }) {
  seq += 1
  await testDb.insert(schema.fuelConsumptionRecords).values({
    id: `mv-cr-${seq}`, batchId: "mv-batch", worksiteId: input.worksiteId, vehicleId: input.vehicleId, patente: input.patente,
    numeroTransacciones: 4, cantidadUnidad: input.cantidad, monto: input.monto, periodoDesde: input.from, periodoHasta: input.to, fuente: "Copec",
  })
}

async function addOperation(input: { vehicleId: string | null; worksiteId: string; plate: string; fecha: string; liters: number; monto: number }) {
  seq += 1
  await testDb.insert(schema.fuelOperationRecords).values({
    id: `mv-op-${seq}`, batchId: "mv-op-batch", worksiteId: input.worksiteId, vehicleId: input.vehicleId, plate: input.plate,
    fecha: input.fecha, liters: input.liters, monto: input.monto, faenaNombre: "Faena", proveedorNombre: "Copec",
  })
}

async function addTae(vehicleId: string | null, loadedAt: string, liters: number) {
  await testDb.insert(schema.fuelTaeSubmissions).values(submission({ vehicleId, loadedAt, submittedAt: loadedAt, liters }))
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)
  await testDb.insert(schema.fuelSuppliers).values({ id: "mv-sup", name: "Copec" })
  await testDb.insert(schema.fuelVehiclePersonalUsePeriods).values({ id: "mv-pu-a", vehicleId: IDS.vA, startedOn: "2026-10-10", endedOn: "2026-10-19" })

  // Cargas facturadas (`fuel_loads.load_date`): la del 12 de vA cae en el período.
  await addBilledLoad(IDS.vA, IDS.wsA, "2026-10-05", 100, 120_000)
  await addBilledLoad(IDS.vA, IDS.wsA, "2026-10-12", 200, 240_000)
  await addBilledLoad(IDS.vA, IDS.wsA, "2026-10-25", 50, 60_000)
  await addBilledLoad(IDS.vB, IDS.wsB, "2026-10-12", 70, 84_000)

  // Consumo por período (TCT importado): vA todo octubre (10 de 31 días personales), vB y un registro sin equipo completos.
  await testDb.insert(schema.fuelImportBatches).values({
    id: "mv-batch", worksiteId: IDS.wsA, fuente: "Copec", periodoDesde: FROM, periodoHasta: TO, archivoNombre: "mv.xlsx", hashArchivo: "mv-hash", importadoPor: USER,
  })
  await addConsumption({ vehicleId: IDS.vA, worksiteId: IDS.wsA, patente: "AA-0001", cantidad: 310, monto: 310_000, from: FROM, to: TO })
  await addConsumption({ vehicleId: IDS.vB, worksiteId: IDS.wsB, patente: "BB-0002", cantidad: 100, monto: 100_000, from: FROM, to: TO })
  await addConsumption({ vehicleId: null, worksiteId: IDS.wsC, patente: "ZZ-9999", cantidad: 50, monto: 50_000, from: FROM, to: TO })

  // Log operacional (`fuel_operation_records.fecha`).
  await testDb.insert(schema.fuelOperationBatches).values({
    id: "mv-op-batch", archivoNombre: "mv-op.xlsx", hashArchivo: "mv-op-hash", periodoDesde: FROM, periodoHasta: TO, importadoPor: USER,
  })
  await addOperation({ vehicleId: IDS.vA, worksiteId: IDS.wsA, plate: "AA-0001", fecha: "2026-10-05", liters: 100, monto: 110_000 })
  await addOperation({ vehicleId: IDS.vA, worksiteId: IDS.wsA, plate: "AA-0001", fecha: "2026-10-12", liters: 200, monto: 220_000 })
  await addOperation({ vehicleId: IDS.vA, worksiteId: IDS.wsA, plate: "AA-0001", fecha: "2026-10-25", liters: 50, monto: 55_000 })
  await addOperation({ vehicleId: IDS.vB, worksiteId: IDS.wsB, plate: "BB-0002", fecha: "2026-10-12", liters: 70, monto: 77_000 })
  await addOperation({ vehicleId: null, worksiteId: IDS.wsC, plate: "ZZ-9999", fecha: "2026-10-12", liters: 30, monto: 33_000 })

  // Cargas en terreno (TAE): 22:30 del 19 en Chile (último día del período) se excluye; 00:30 del 20, no.
  await addTae(IDS.vA, "2026-10-05T15:00:00.000Z", 100)
  await addTae(IDS.vA, "2026-10-12T15:00:00.000Z", 200)
  await addTae(IDS.vA, "2026-10-20T01:30:00.000Z", 40)
  await addTae(IDS.vA, "2026-10-20T03:30:00.000Z", 30)
}, 60_000)

describe("resumen de Control operacional", () => {
  it("las cargas facturadas pierden las del período, en litros, monto y registros", async () => {
    const overview = await getFuelControlOverview(costSession(), { includeTae: false, filters: { fromDate: FROM, toDate: TO } })
    expect(overview.billed.liters).toBe(220) // 100 + 50 de vA, 70 de vB
    expect(overview.billed.amount).toBe(264_000)
    expect(overview.billed.records).toBe(3)
  })

  it("el consumo TCT por faena cuenta 21/31 del registro de vA y completos los demás", async () => {
    const overview = await getFuelControlOverview(costSession(), { includeTae: false, filters: { fromDate: FROM, toDate: TO } })
    const byId = new Map(overview.byWorksite.map((row) => [row.worksiteId, row]))
    expect(byId.get(IDS.wsA)!.tctLiters).toBeCloseTo(210, 6) // 310 × 21/31
    expect(byId.get(IDS.wsB)!.tctLiters).toBe(100)
    expect(byId.get(IDS.wsC)!.tctLiters).toBe(50) // sin equipo: completo
    expect(byId.get(IDS.wsA)!.billedLiters).toBe(150)
    expect(byId.get(IDS.wsB)!.billedLiters).toBe(70)
  })

  it("TAE: los litros, las cargas y los equipos excluyen el período; lo que hay que revisar sigue viendo todo", async () => {
    const overview = await getFuelControlOverview(costSession(), { includeTae: true, filters: { fromDate: FROM, toDate: TO } })
    expect(overview.tae).not.toBeNull()
    // 05 (100 L) y 00:30 del 20 (30 L): la del 12 y la de las 22:30 del 19 quedan fuera.
    expect(overview.tae!.liters).toBe(130)
    expect(overview.tae!.loads).toBe(2)
    // La cola de trabajo no se recorta: las cuatro cargas siguen por revisar.
    expect(overview.tae!.pendingReview).toBe(4)
    expect(overview.byWorksite.find((row) => row.worksiteId === IDS.wsA)!.taeLiters).toBe(130)
  })
})

describe("Consumo", () => {
  it("los KPI y el ranking cuentan 21/31 del registro con días personales", async () => {
    const data = await getConsumptionDashboard(costSession(), { fromDate: FROM, toDate: TO })
    expect(data.kpis.totalCantidad).toBeCloseTo(360, 6) // 210 + 100 + 50
    expect(data.kpis.totalMonto).toBeCloseTo(360_000, 4)
    const vA = data.topPatentesPorConsumo.find((row) => row.patente === "AA-0001")!
    expect(vA.cantidad).toBeCloseTo(210, 6)
    expect(vA.monto).toBeCloseTo(210_000, 4)
    expect(data.topPatentesPorConsumo.find((row) => row.patente === "ZZ-9999")!.cantidad).toBe(50)
    expect(data.seriesPorPeriodo).toHaveLength(1)
    expect(data.seriesPorPeriodo[0]!.cantidad).toBeCloseTo(360, 6)
  })

  it("por tipo de equipo, evolución y mapa de calor", async () => {
    const byType = await getConsumptionByEquipmentType(costSession(), { fromDate: FROM, toDate: TO })
    expect(byType).toHaveLength(1)
    expect(byType[0]!.totalLiters).toBeCloseTo(310, 6) // 210 de vA + 100 de vB (el registro sin equipo no tiene tipo)
    const evolution = await getEvolutionByVehicle(costSession(), { fromDate: FROM, toDate: TO })
    expect(evolution.find((point) => point.plate === "AA-0001")!.liters).toBeCloseTo(210, 6)
    expect(evolution.find((point) => point.plate === "AA-0001")!.amount).toBeCloseTo(210_000, 4)
    const matrix = await getWorksiteEquipmentMatrix(costSession(), { fromDate: FROM, toDate: TO })
    expect(matrix.find((cell) => cell.equipmentLabel.includes("AA-0001"))!.liters).toBeCloseTo(210, 6)
  })
})

describe("log operacional", () => {
  it("el resumen pierde las cargas del período y conserva las de equipos sin vincular", async () => {
    const summary = await getOperationsSummary(costSession(), { fromDate: FROM, toDate: TO })
    expect(summary).not.toBeNull()
    expect(summary!.totalLitros).toBe(250) // 100 + 50 + 70 + 30
    expect(summary!.totalMonto).toBe(275_000)
    expect(summary!.totalRegistros).toBe(4)
    expect(summary!.topEquiposPorGasto.find((row) => row.filterPatente === "AA-0001")!.cantidad).toBe(150)
    expect(summary!.porFaena.reduce((sum, row) => sum + row.litros, 0)).toBe(250)
    expect(summary!.porProveedor.reduce((sum, row) => sum + row.litros, 0)).toBe(250)
  })

  it("los puntos de dispersión (litros vs medidor) tampoco incluyen las cargas del período", async () => {
    await testDb.update(schema.fuelOperationRecords).set({ horometro: 1000, medidoPor: "hora" })
    const points = await getScatterObservations(costSession(), { fromDate: FROM, toDate: TO })
    expect(points.map((point) => point.liters).sort((a, b) => a - b)).toEqual([30, 50, 70, 100])
  })
})
