import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, seedControlFixtures } from "@/lib/combustibles/control/queries/test-fixtures"

/**
 * Costo por contrato (plan «Contratos dentro de la faena», Task 7).
 *
 * Contra Postgres de verdad: lo que decide la cifra es el SQL de las partidas por
 * día y su reparto en contratos. La prueba central es la cuadratura: sumando
 * todas las faenas, cada componente (combustible, OT, compras) debe dar lo mismo
 * que la columna correspondiente del Panel operacional.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const { getContractCostBreakdown, contractVehicleIds } = await import("@/lib/services/contracts/contract-costs")
const { getOperationalControlHub } = await import("@/lib/services/operational-control")

const ALL_PERMISSIONS = ["flota:view", "combustibles:view", "combustibles:view_costs", "mant:ot:view_all", "purchasing:view"]

function session(options: { global?: boolean; worksiteIds?: string[]; permissions?: string[] } = {}): Session {
  return {
    user: {
      id: IDS.user,
      isGlobal: options.global ?? true,
      roles: [],
      worksiteIds: options.worksiteIds ?? [],
      permissions: options.permissions ?? ALL_PERMISSIONS,
    },
    expires: "2099-01-01",
  } as unknown as Session
}

const MARCH = { from: "2026-03-01", to: "2026-03-31" }

const WS_SIN_CONTRATOS = "ws-cc-oficina"
const V_OFICINA = "veh-cc-oficina"
const CLIENT = "cli-cc-1"
const C_A1 = "ctr-cc-a1"
const C_A2 = "ctr-cc-a2"
const C_B1 = "ctr-cc-b1"
const C_C1 = "ctr-cc-c1"
const C_A_CERRADO = "ctr-cc-a-cerrado"

let seq = 0

async function addContract(input: { id: string; worksiteId: string; name: string; status?: "active" | "suspended" | "closed" }) {
  await testDb.insert(schema.contracts).values({
    id: input.id,
    code: `CTR-2026-${String(++seq).padStart(4, "0")}`,
    clientId: CLIENT,
    name: input.name,
    worksiteId: input.worksiteId,
    status: input.status ?? "active",
    billingCycle: "none",
  })
}

async function addAssignment(input: { contractId: string; vehicleId: string; validFrom: string; validTo?: string | null }) {
  await testDb.insert(schema.contractVehicleAssignments).values({
    id: `asg-cc-${++seq}`,
    contractId: input.contractId,
    vehicleId: input.vehicleId,
    validFrom: input.validFrom,
    validTo: input.validTo ?? null,
  })
}

async function addFuel(input: { vehicle: string; worksite: string; plate: string; date: string; amount: number; granularity?: "transaction" | "period_aggregate"; account?: string }) {
  seq += 1
  await testDb.insert(schema.fuelProviderTransactions).values({
    id: `cc-tx-${seq}`,
    syncRunId: "cc-run",
    provider: "copec",
    sourceAccount: input.account ?? "tct:diesel",
    identityKey: `cc-idk-${seq}`,
    fingerprint: `cc-fp-${seq}`,
    sourceRowKey: `cc-row-${seq}`,
    payloadHash: `cc-ph-${seq}`,
    worksiteId: input.worksite,
    vehicleId: input.vehicle,
    sourcePlate: input.plate,
    occurredAt: input.date,
    quantity: 100,
    amount: input.amount,
    status: "accepted",
    granularity: input.granularity ?? "transaction",
  })
}

async function addClosedWorkOrder(input: { vehicle: string; worksite: string; totalCost: number; closedAt: string }) {
  seq += 1
  await testDb.insert(schema.mantWorkOrders).values({
    id: `cc-ot-${seq}`,
    folio: `OT-CC-${seq}`,
    vehicleId: input.vehicle,
    worksiteId: input.worksite,
    equipmentSnapshot: { code: "KA-1", plate: "AA-0001", noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Faena A", unit: "km" },
    repair: true,
    maintenance: false,
    requestDate: "2026-03-01",
    requestedByUserId: IDS.user,
    requesterName: "QA",
    repairDescription: "Falla de frenos en la cabina",
    totalCost: input.totalCost,
    status: "cerrada",
    assignedToUserId: IDS.user,
    assignedByUserId: IDS.user,
    assignedAt: "2026-03-02T12:00:00Z",
    workshopKind: "interno",
    workshopEntryAt: "2026-03-03T12:00:00Z",
    estimatedDeliveryDate: "2026-03-20",
    startedAt: "2026-03-03T12:00:00Z",
    startedByUserId: IDS.user,
    workshopExitAt: "2026-03-10T12:00:00Z",
    finishedAt: "2026-03-10T12:00:00Z",
    finishedByUserId: IDS.user,
    receivedAt: "2026-03-10T12:00:00Z",
    receiverName: "Pedro Soto",
    receivedByUserId: IDS.user,
    receivedRecordedAt: "2026-03-10T12:00:00Z",
    faenaReceivedAt: input.closedAt,
    faenaReceiverName: "Admin Contrato",
    faenaReceivedByUserId: IDS.user,
    closedAt: input.closedAt,
  })
}

/** Una OC con una línea; `vehicle: null` = compra de la faena sin equipo. */
async function addPurchase(input: { worksite: string; vehicle: string | null; issuedAt: string; subtotal: number }) {
  seq += 1
  const requestId = `cc-req-${seq}`
  const itemId = `cc-item-${seq}`
  const orderId = `cc-oc-${seq}`
  await testDb.insert(schema.purchaseRequests).values({
    id: requestId, code: `CC-SOL-${seq}`, worksiteId: input.worksite, requesterId: IDS.user, requestType: "repuestos", status: "approved",
  })
  await testDb.insert(schema.purchaseRequestItems).values({
    id: itemId, requestId, productNameFree: "Filtro de aceite", quantity: 1, status: "in_purchase_order", vehicleId: input.vehicle,
  })
  await testDb.insert(schema.purchaseOrders).values({
    id: orderId, code: `CC-OC-${seq}`, worksiteId: input.worksite, supplierId: "cc-supplier", createdBy: IDS.user, status: "sent", issuedAt: input.issuedAt,
  })
  await testDb.insert(schema.purchaseOrderItems).values({
    id: `cc-line-${seq}`, purchaseOrderId: orderId, requestItemId: itemId, productNameFree: "Filtro de aceite", quantity: 1,
    unitPrice: input.subtotal, subtotal: input.subtotal, status: "issued",
  })
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)
  await testDb.insert(schema.suppliers).values({ id: "cc-supplier", name: "Repuestos del Sur" })
  await testDb.insert(schema.clients).values({ id: CLIENT, rut: "76123456-7", name: "Maderas Arauco" })
  await testDb.insert(schema.fuelProviderSyncRuns).values({
    id: "cc-run", provider: "copec", requestedFrom: "2026-03-01", requestedTo: "2026-03-31", correlationId: "corr-cc",
  })

  // Oficina Central: una faena con un equipo y sin contratos; no debe aparecer.
  await testDb.insert(schema.worksites).values({ id: WS_SIN_CONTRATOS, name: "Oficina Central", code: "CTL-OFI" })
  await testDb.insert(schema.fuelVehicles).values({
    id: V_OFICINA, plate: "DD-0004", code: "KD-4", type: "x", equipmentTypeId: IDS.eqType, meterType: "hour_meter",
    performanceUnit: "liters_per_hour", worksiteId: WS_SIN_CONTRATOS,
  })

  // Contratos: la faena A tiene dos vigentes y uno cerrado sin movimiento en el período.
  await addContract({ id: C_A1, worksiteId: IDS.wsA, name: "Movimiento de residuos" })
  await addContract({ id: C_A2, worksiteId: IDS.wsA, name: "Carga y descarga de madera" })
  await addContract({ id: C_A_CERRADO, worksiteId: IDS.wsA, name: "Contrato antiguo", status: "closed" })
  await addContract({ id: C_B1, worksiteId: IDS.wsB, name: "Transporte B" })
  await addContract({ id: C_C1, worksiteId: IDS.wsC, name: "Servicio C" })

  // vA cambia de contrato el 15 de marzo (retroactivo); vB tiene uno todo el mes; vC no tiene ninguno.
  await addAssignment({ contractId: C_A1, vehicleId: IDS.vA, validFrom: "2026-03-01", validTo: "2026-03-14" })
  await addAssignment({ contractId: C_A2, vehicleId: IDS.vA, validFrom: "2026-03-15" })
  await addAssignment({ contractId: C_B1, vehicleId: IDS.vB, validFrom: "2026-02-01" })

  // Combustible. vA: dos cargas diarias (una por contrato) y un agregado mensual que cruza el cambio.
  // El agregado va en otra cuenta TCT: con detalle de la misma cuenta, patente y mes el Panel lo descarta
  // (sumaría dos veces el mismo litro) y no habría nada que repartir.
  await addFuel({ vehicle: IDS.vA, worksite: IDS.wsA, plate: "AA-0001", date: "2026-03-08", amount: 200_000 })
  await addFuel({ vehicle: IDS.vA, worksite: IDS.wsA, plate: "AA-0001", date: "2026-03-20", amount: 50_000 })
  await addFuel({ vehicle: IDS.vA, worksite: IDS.wsA, plate: "AA-0001", date: "2026-03-01", amount: 1_000_000, granularity: "period_aggregate", account: "tct:gasolina" })
  // vB: agregado mensual con un solo contrato todo el mes.
  await addFuel({ vehicle: IDS.vB, worksite: IDS.wsB, plate: "BB-0002", date: "2026-03-01", amount: 300_000, granularity: "period_aggregate" })
  // vC: sin contrato.
  await addFuel({ vehicle: IDS.vC, worksite: IDS.wsC, plate: "CC-0003", date: "2026-03-05", amount: 40_000 })

  // Órdenes de trabajo cerradas.
  await addClosedWorkOrder({ vehicle: IDS.vA, worksite: IDS.wsA, totalCost: 30_000, closedAt: "2026-03-12T15:00:00Z" })
  await addClosedWorkOrder({ vehicle: IDS.vA, worksite: IDS.wsA, totalCost: 10_000, closedAt: "2026-03-20T15:00:00Z" })
  await addClosedWorkOrder({ vehicle: IDS.vB, worksite: IDS.wsB, totalCost: 5_000, closedAt: "2026-03-10T15:00:00Z" })
  await addClosedWorkOrder({ vehicle: IDS.vC, worksite: IDS.wsC, totalCost: 7_000, closedAt: "2026-03-02T15:00:00Z" })

  // Compras con equipo y compras de la faena sin equipo.
  await addPurchase({ worksite: IDS.wsA, vehicle: IDS.vA, issuedAt: "2026-03-10T15:00:00.000Z", subtotal: 100_000 })
  await addPurchase({ worksite: IDS.wsA, vehicle: IDS.vA, issuedAt: "2026-03-25T15:00:00.000Z", subtotal: 20_000 })
  await addPurchase({ worksite: IDS.wsB, vehicle: IDS.vB, issuedAt: "2026-03-12T15:00:00.000Z", subtotal: 15_000 })
  await addPurchase({ worksite: IDS.wsC, vehicle: IDS.vC, issuedAt: "2026-03-15T15:00:00.000Z", subtotal: 9_000 })
  await addPurchase({ worksite: IDS.wsA, vehicle: null, issuedAt: "2026-03-28T15:00:00.000Z", subtotal: 70_000 })
  await addPurchase({ worksite: WS_SIN_CONTRATOS, vehicle: null, issuedAt: "2026-03-28T15:00:00.000Z", subtotal: 1_234 })
}, 120_000)

type Hub = Awaited<ReturnType<typeof getOperationalControlHub>>

/** Los equipos que la página le pasa al desglose: los vehículos del hub. */
function vehiclesOf(hub: Hub) {
  return hub.assets.flatMap((asset) => (asset.kind === "vehicle" && asset.worksiteId ? [{ id: asset.id, worksiteId: asset.worksiteId }] : []))
}

async function breakdownFor(sess: Session, period = MARCH) {
  const hub = await getOperationalControlHub(sess, period, { includeAttention: false })
  return { hub, breakdown: await getContractCostBreakdown(sess, period, vehiclesOf(hub)) }
}

describe("getContractCostBreakdown", () => {
  it("reparte el costo del Panel entre contratos, Sin contrato y Por repartir sin perder ni duplicar", async () => {
    const { hub, breakdown } = await breakdownFor(session())
    const vehicles = hub.assets.filter((asset) => asset.kind === "vehicle")
    expect(vehicles.length).toBeGreaterThanOrEqual(4)

    const rows = breakdown.worksites.flatMap((worksite) => worksite.rows).filter((row) => row.kind !== "no_equipment")
    const sum = (pick: (row: (typeof rows)[number]) => number | null) => rows.reduce((acc, row) => acc + (pick(row) ?? 0), 0)
    const panel = (pick: (asset: (typeof vehicles)[number]) => number | null) => vehicles.reduce((acc, asset) => acc + (pick(asset) ?? 0), 0)

    expect(sum((row) => row.fuel)).toBe(panel((asset) => asset.fuelBilledAmount))
    expect(sum((row) => row.workOrders)).toBe(panel((asset) => asset.maintenanceCost))
    expect(sum((row) => row.purchases)).toBe(panel((asset) => asset.purchaseAmount))
    // Los montos sembrados no son cero: la igualdad no es trivial.
    expect(panel((asset) => asset.fuelBilledAmount)).toBe(1_590_000)
    expect(panel((asset) => asset.maintenanceCost)).toBe(52_000)
    expect(panel((asset) => asset.purchaseAmount)).toBe(144_000)

    const rowOf = (worksiteId: string, kind: string, contractId?: string) =>
      breakdown.worksites.find((w) => w.worksiteId === worksiteId)?.rows.find((r) => r.kind === kind && (contractId === undefined || r.contractId === contractId))
    // El cambio de contrato del 15 de marzo parte las cargas diarias, las OT y las compras de vA.
    expect(rowOf(IDS.wsA, "contract", C_A1)).toMatchObject({ fuel: 200_000, workOrders: 30_000, purchases: 100_000, total: 330_000, partial: false })
    expect(rowOf(IDS.wsA, "contract", C_A2)).toMatchObject({ fuel: 50_000, workOrders: 10_000, purchases: 20_000, total: 80_000 })
    // El agregado mensual que cruza el cambio queda sin repartir, no prorrateado.
    expect(rowOf(IDS.wsA, "pending")).toMatchObject({ label: "Por repartir", fuel: 1_000_000, workOrders: 0, purchases: 0 })
    expect(rowOf(IDS.wsB, "contract", C_B1)).toMatchObject({ fuel: 300_000, workOrders: 5_000, purchases: 15_000 })
    expect(rowOf(IDS.wsC, "unassigned")).toMatchObject({ label: "Sin contrato", fuel: 40_000, workOrders: 7_000, purchases: 9_000, vehicleCount: 1 })
  })

  it("omite faenas sin contratos", async () => {
    const { hub, breakdown } = await breakdownFor(session())

    // La faena sin contratos tiene un equipo y hasta una compra sin equipo, pero no se muestra.
    expect(vehiclesOf(hub).some((vehicle) => vehicle.worksiteId === WS_SIN_CONTRATOS)).toBe(true)
    expect(breakdown.worksites.map((worksite) => worksite.worksiteId).sort()).toEqual([IDS.wsA, IDS.wsB, IDS.wsC].sort())
    expect(breakdown.contractOptions.every((option) => !option.label.startsWith("Oficina Central"))).toBe(true)
  })

  it("sin combustibles:view_costs la columna de combustible es null y el total sale parcial", async () => {
    const permissions = ALL_PERMISSIONS.filter((permission) => permission !== "combustibles:view_costs")
    const { breakdown } = await breakdownFor(session({ permissions }))

    expect(breakdown.availability).toEqual({ fuel: false, workOrders: true, purchases: true })
    const a1 = breakdown.worksites.find((w) => w.worksiteId === IDS.wsA)!.rows.find((r) => r.contractId === C_A1)!
    expect(a1.fuel).toBeNull()
    // Total = lo conocido (OT + compras), nunca un $0 que parezca completo.
    expect(a1).toMatchObject({ workOrders: 30_000, purchases: 100_000, total: 130_000, partial: true })
    for (const worksite of breakdown.worksites) {
      expect(worksite.partial).toBe(true)
      for (const row of worksite.rows.filter((r) => r.kind !== "no_equipment")) {
        expect(row.fuel).toBeNull()
        expect(row.partial).toBe(true)
      }
    }
  })

  it("un usuario acotado no ve contratos de faenas fuera de su alcance", async () => {
    const { breakdown } = await breakdownFor(session({ global: false, worksiteIds: [IDS.wsA] }))

    expect(breakdown.worksites.map((worksite) => worksite.worksiteId)).toEqual([IDS.wsA])
    const ids = breakdown.contractOptions.map((option) => option.id)
    expect(ids).toEqual(expect.arrayContaining([C_A1, C_A2]))
    expect(ids).not.toContain(C_B1)
    expect(ids).not.toContain(C_C1)
    expect(breakdown.worksites[0]?.rows.some((row) => row.contractId === C_B1)).toBe(false)

    const nobody = await breakdownFor(session({ global: false, worksiteIds: [] }))
    expect(nobody.breakdown.worksites).toEqual([])
  })

  it("muestra Compras sin equipo con las OC de la faena sin equipo", async () => {
    const { breakdown } = await breakdownFor(session())

    const a = breakdown.worksites.find((w) => w.worksiteId === IDS.wsA)!
    const noEquipment = a.rows.filter((row) => row.kind === "no_equipment")
    expect(noEquipment).toHaveLength(1)
    expect(noEquipment[0]).toMatchObject({ label: "Compras sin equipo", contractId: null, fuel: null, workOrders: null, purchases: 70_000, total: 70_000 })
    // Va al final de la faena y sólo cuando es distinta de cero.
    expect(a.rows.at(-1)?.kind).toBe("no_equipment")
    expect(breakdown.worksites.find((w) => w.worksiteId === IDS.wsB)!.rows.some((row) => row.kind === "no_equipment")).toBe(false)
    // La fila de la faena suma todas sus cubetas.
    expect(a.total).toBe(a.rows.reduce((acc, row) => acc + (row.total ?? 0), 0))
  })

  it("lista los contratos vigentes o con movimiento, ordenados por nombre, antes de las cubetas", async () => {
    const { breakdown } = await breakdownFor(session())

    const a = breakdown.worksites.find((w) => w.worksiteId === IDS.wsA)!
    // El contrato cerrado y sin ventana en el período no sale de la fila; sí está en el filtro.
    expect(a.rows.map((row) => row.label)).toEqual([
      "Carga y descarga de madera",
      "Movimiento de residuos",
      "Por repartir",
      "Compras sin equipo",
    ])
    expect(a.rows[1]).toMatchObject({ kind: "contract", clientName: "Maderas Arauco", status: "active", vehicleCount: 1 })
    expect(breakdown.contractOptions.find((option) => option.id === C_A_CERRADO)?.label).toBe("Faena A · Contrato antiguo")
  })
})

describe("contractVehicleIds", () => {
  it("contractVehicleIds devuelve los equipos con ventana del contrato en el período", async () => {
    const { breakdown } = await breakdownFor(session())

    expect([...contractVehicleIds(breakdown.windows, C_A1, MARCH)]).toEqual([IDS.vA])
    expect([...contractVehicleIds(breakdown.windows, C_B1, MARCH)]).toEqual([IDS.vB])
    // La ventana de A1 terminó el 14: un período posterior no la toca; A2 sí.
    const abril = { from: "2026-04-01", to: "2026-04-30" }
    expect(contractVehicleIds(breakdown.windows, C_A1, abril).size).toBe(0)
    expect(contractVehicleIds(breakdown.windows, C_C1, MARCH).size).toBe(0)
    expect(contractVehicleIds([
      { vehicleId: "x", contractId: "c", worksiteId: "w", validFrom: "2026-04-10", validTo: null },
    ], "c", abril).has("x")).toBe(true)
  })
})
