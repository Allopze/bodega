import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, seedControlFixtures } from "@/lib/combustibles/control/queries/test-fixtures"

/**
 * Compras vinculadas al equipo en Control operacional (plan «Repuestos
 * vinculados al equipo y a la OT», T15): el costo por equipo suma, además del
 * combustible y la mano de obra de las OT, las líneas de OC de las solicitudes
 * que apuntan al vehículo (`purchase_request_items.vehicle_id`).
 *
 * Se prueban el agregado (`getVehiclePurchaseSummary`) y su integración con el
 * hub, contra Postgres de verdad: lo que decide la cifra es el SQL (estados,
 * `deleted_at`, fecha de emisión, alcance de faena), no una lectura mockeada.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const { getVehiclePurchaseSummary } = await import("@/lib/services/purchasing-module/vehicle-purchase-summary")
const { getOperationalControlHub } = await import("@/lib/services/operational-control")

function session(options: { global?: boolean; worksiteIds?: string[]; permissions?: string[] } = {}): Session {
  return {
    user: {
      id: IDS.user,
      isGlobal: options.global ?? true,
      roles: [],
      worksiteIds: options.worksiteIds ?? [],
      permissions: options.permissions ?? ["purchasing:view"],
    },
    expires: "2099-01-01",
  } as unknown as Session
}

const MARCH = { from: "2026-03-01", to: "2026-03-31" }

let seq = 0
/** Una OC reúne varias líneas: se crea con la primera y las demás la reutilizan. */
const createdOrders = new Set<string>()

/** Una solicitud con un ítem vinculado a un vehículo (o sin él) y su línea de OC. */
async function addPurchase(input: {
  /** Faena de la OC (la del alcance del agregado). */
  orderWorksite: string
  /** Vehículo de la solicitud; `null` = compra de bodega sin equipo. */
  vehicle: string | null
  orderId: string
  orderStatus?: "draft" | "sent" | "closed" | "cancelled"
  issuedAt?: string | null
  deletedAt?: string | null
  subtotal: number | null
  lineStatus?: "issued" | "cancelled"
  /** Sin ítem de solicitud (línea suelta de bodega). */
  withoutRequestItem?: boolean
}) {
  seq += 1
  const requestId = `ocp-req-${seq}`
  const itemId = `ocp-item-${seq}`
  await testDb.insert(schema.purchaseRequests).values({
    id: requestId,
    code: `OCP-SOL-${seq}`,
    worksiteId: input.orderWorksite,
    requesterId: IDS.user,
    requestType: "repuestos",
    status: "approved",
  })
  await testDb.insert(schema.purchaseRequestItems).values({
    id: itemId,
    requestId,
    productNameFree: "Filtro de aceite",
    quantity: 1,
    status: "in_purchase_order",
    vehicleId: input.vehicle,
  })
  if (!createdOrders.has(input.orderId)) {
    createdOrders.add(input.orderId)
    await testDb.insert(schema.purchaseOrders).values({
      id: input.orderId,
      code: `OCP-OC-${input.orderId}`,
      worksiteId: input.orderWorksite,
      supplierId: "ocp-supplier",
      createdBy: IDS.user,
      status: input.orderStatus ?? "sent",
      issuedAt: input.issuedAt === undefined ? "2026-03-10T15:00:00.000Z" : input.issuedAt,
      deletedAt: input.deletedAt ?? null,
    })
  }
  await testDb.insert(schema.purchaseOrderItems).values({
    id: `ocp-line-${seq}`,
    purchaseOrderId: input.orderId,
    requestItemId: input.withoutRequestItem ? null : itemId,
    productNameFree: "Filtro de aceite",
    quantity: 1,
    unitPrice: input.subtotal,
    subtotal: input.subtotal,
    status: input.lineStatus ?? "issued",
  })
}

/** Una OT cerrada con costo cargado a mano (mano de obra / taller externo). */
async function addClosedWorkOrder(input: { id: string; vehicle: string; worksite: string; totalCost: number; closedAt: string }) {
  await testDb.insert(schema.mantWorkOrders).values({
    id: input.id,
    folio: `OT-OCP-${input.id}`,
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

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)
  await testDb.insert(schema.suppliers).values({ id: "ocp-supplier", name: "Repuestos del Sur" })

  // vA (faena A), marzo: dos OC emitidas dentro del período suman 160.000.
  await addPurchase({ orderWorksite: IDS.wsA, vehicle: IDS.vA, orderId: "oc-a1", subtotal: 100_000 })
  await addPurchase({ orderWorksite: IDS.wsA, vehicle: IDS.vA, orderId: "oc-a1", subtotal: 50_000 })
  // Línea con costo pendiente (servicio sin precio): no suma ni rompe la suma.
  await addPurchase({ orderWorksite: IDS.wsA, vehicle: IDS.vA, orderId: "oc-a1", subtotal: null })
  // Línea anulada dentro de una OC vigente: no suma.
  await addPurchase({ orderWorksite: IDS.wsA, vehicle: IDS.vA, orderId: "oc-a1", subtotal: 999, lineStatus: "cancelled" })
  // Último día del período, con hora UTC: el día civil sigue siendo el 31.
  await addPurchase({ orderWorksite: IDS.wsA, vehicle: IDS.vA, orderId: "oc-a-borde", orderStatus: "closed", issuedAt: "2026-03-31T23:00:00.000Z", subtotal: 10_000 })
  // Fuera del período, por ambos lados.
  await addPurchase({ orderWorksite: IDS.wsA, vehicle: IDS.vA, orderId: "oc-a-feb", issuedAt: "2026-02-28T23:59:59.000Z", subtotal: 20_000 })
  await addPurchase({ orderWorksite: IDS.wsA, vehicle: IDS.vA, orderId: "oc-a-abr", issuedAt: "2026-04-01T00:00:00.000Z", subtotal: 30_000 })
  // OC anulada, eliminada (soft-delete) y borrador sin emitir: no son compras.
  await addPurchase({ orderWorksite: IDS.wsA, vehicle: IDS.vA, orderId: "oc-a-anulada", orderStatus: "cancelled", subtotal: 40_000 })
  await addPurchase({ orderWorksite: IDS.wsA, vehicle: IDS.vA, orderId: "oc-a-eliminada", deletedAt: "2026-03-12T00:00:00.000Z", subtotal: 50_000 })
  await addPurchase({ orderWorksite: IDS.wsA, vehicle: IDS.vA, orderId: "oc-a-borrador", orderStatus: "draft", issuedAt: null, subtotal: 60_000 })
  // Compra sin vehículo y línea suelta sin solicitud: no son de ningún equipo.
  await addPurchase({ orderWorksite: IDS.wsA, vehicle: null, orderId: "oc-a-sin-equipo", subtotal: 70_000 })
  await addPurchase({ orderWorksite: IDS.wsA, vehicle: IDS.vA, orderId: "oc-a-suelta", subtotal: 80_000, withoutRequestItem: true })

  // vB y vC viven en otras faenas.
  await addPurchase({ orderWorksite: IDS.wsB, vehicle: IDS.vB, orderId: "oc-b1", subtotal: 70_000 })
  await addPurchase({ orderWorksite: IDS.wsC, vehicle: IDS.vC, orderId: "oc-c1", subtotal: 90_000 })

  // Combustible y OT de vA para probar el costo total con las tres series.
  await testDb.insert(schema.fuelProviderSyncRuns).values({
    id: "ocp-run",
    provider: "copec",
    requestedFrom: "2026-03-01",
    requestedTo: "2026-03-31",
    correlationId: "corr-ocp",
  })
  await testDb.insert(schema.fuelProviderTransactions).values({
    id: "ocp-tx-1",
    syncRunId: "ocp-run",
    provider: "copec",
    sourceAccount: "tct:diesel",
    identityKey: "ocp-idk-1",
    fingerprint: "ocp-fp-1",
    sourceRowKey: "ocp-row-1",
    payloadHash: "ocp-ph-1",
    worksiteId: IDS.wsA,
    vehicleId: IDS.vA,
    sourcePlate: "AA-0001",
    occurredAt: "2026-03-08",
    quantity: 100,
    amount: 200_000,
    status: "accepted",
    granularity: "transaction",
  })
  await addClosedWorkOrder({ id: "ocp-ot-1", vehicle: IDS.vA, worksite: IDS.wsA, totalCost: 30_000, closedAt: "2026-03-12T15:00:00Z" })
}, 120_000)

afterEach(() => {
  vi.restoreAllMocks()
})

describe("getVehiclePurchaseSummary", () => {
  it("suma las líneas de OC emitidas en el período por vehículo y excluye anuladas, eliminadas y de otro mes", async () => {
    const summary = await getVehiclePurchaseSummary(session(), MARCH, [IDS.vA, IDS.vB, IDS.vC])

    // 100.000 + 50.000 (OC vigente, la línea sin precio y la anulada no suman) + 10.000 (31 de marzo).
    expect(summary.get(IDS.vA)).toMatchObject({ vehicleId: IDS.vA, purchaseAmount: 160_000, orderCount: 2 })
    expect(summary.get(IDS.vA)?.lastOrderAt).toBe("2026-03-31T23:00:00.000Z")
    expect(summary.get(IDS.vB)).toMatchObject({ purchaseAmount: 70_000, orderCount: 1 })
    expect(summary.get(IDS.vC)).toMatchObject({ purchaseAmount: 90_000, orderCount: 1 })
  })

  it("un equipo sin compras en el período vale 0 (la consulta corrió), no falta del mapa", async () => {
    const summary = await getVehiclePurchaseSummary(session(), { from: "2026-01-01", to: "2026-01-31" }, [IDS.vA, IDS.vA])

    expect([...summary.keys()]).toEqual([IDS.vA])
    expect(summary.get(IDS.vA)).toEqual({ vehicleId: IDS.vA, purchaseAmount: 0, orderCount: 0, lastOrderAt: null })
  })

  it("sin purchasing:view no consulta y deja el mapa vacío", async () => {
    const select = vi.spyOn(testDb, "select")

    const summary = await getVehiclePurchaseSummary(session({ permissions: ["flota:view", "combustibles:view_costs"] }), MARCH, [IDS.vA])

    expect(summary.size).toBe(0)
    expect(select).not.toHaveBeenCalled()
  })

  it("sin vehículos no consulta", async () => {
    const select = vi.spyOn(testDb, "select")

    const summary = await getVehiclePurchaseSummary(session(), MARCH, [])

    expect(summary.size).toBe(0)
    expect(select).not.toHaveBeenCalled()
  })

  it("respeta el alcance de faena de la OC", async () => {
    const scoped = session({ global: false, worksiteIds: [IDS.wsA] })

    const summary = await getVehiclePurchaseSummary(scoped, MARCH, [IDS.vA, IDS.vB])

    expect(summary.get(IDS.vA)?.purchaseAmount).toBe(160_000)
    // La OC de vB es de la faena B: fuera del alcance no aporta filas aunque su id venga en la lista.
    expect(summary.get(IDS.vB)).toMatchObject({ purchaseAmount: 0, orderCount: 0 })

    const nobody = await getVehiclePurchaseSummary(session({ global: false, worksiteIds: [] }), MARCH, [IDS.vA])
    expect(nobody.get(IDS.vA)?.purchaseAmount).toBe(0)
  })
})

describe("getOperationalControlHub · compras vinculadas", () => {
  const find = (hub: Awaited<ReturnType<typeof getOperationalControlHub>>, id: string) => hub.assets.find((asset) => asset.id === id)!

  it("con purchasing:view cada vehículo trae sus compras del período", async () => {
    const hub = await getOperationalControlHub(session({ permissions: ["flota:view", "purchasing:view"] }), MARCH, { includeAttention: false })

    expect(hub.permissions.canViewPurchaseCosts).toBe(true)
    expect(find(hub, IDS.vA).purchaseAmount).toBe(160_000)
    expect(find(hub, IDS.vB).purchaseAmount).toBe(70_000)
    expect(hub.assets.filter((asset) => asset.kind === "service_equipment").every((asset) => asset.purchaseAmount === null)).toBe(true)
  })

  it("sin purchasing:view la cifra es null (no 0) y no se pide a la base", async () => {
    const hub = await getOperationalControlHub(session({ permissions: ["flota:view"] }), MARCH, { includeAttention: false })

    expect(hub.permissions.canViewPurchaseCosts).toBe(false)
    expect(hub.assets.every((asset) => asset.purchaseAmount === null)).toBe(true)
  })

  it("el costo total exige las tres series: combustible + mano de obra + compras", async () => {
    const all = ["flota:view", "combustibles:view", "combustibles:view_costs", "mant:ot:view_all", "purchasing:view"]

    const complete = await getOperationalControlHub(session({ permissions: all }), MARCH, { includeAttention: false })
    const a = find(complete, IDS.vA)
    expect(a).toMatchObject({ fuelBilledAmount: 200_000, maintenanceCost: 30_000, purchaseAmount: 160_000 })
    expect(a.totalCost).toBe(390_000)

    // Un equipo sin OT cerradas con costo en el período aporta $0 de mano de obra:
    // el total existe igual (antes salía «—» para casi toda la flota).
    const b = find(complete, IDS.vB)
    expect(b.maintenanceCost).toBe(0)
    expect(b.purchaseAmount).toBe(70_000)
    expect(b.fuelBilledAmount).not.toBeNull()
    expect(b.totalCost).toBe((b.fuelBilledAmount ?? Number.NaN) + 70_000)

    // Sin la capacidad de compras no se publica un total que parezca completo.
    const withoutPurchases = await getOperationalControlHub(
      session({ permissions: all.filter((permission) => permission !== "purchasing:view") }),
      MARCH,
      { includeAttention: false },
    )
    expect(find(withoutPurchases, IDS.vA)).toMatchObject({ fuelBilledAmount: 200_000, maintenanceCost: 30_000, purchaseAmount: null, totalCost: null })
  })
})
