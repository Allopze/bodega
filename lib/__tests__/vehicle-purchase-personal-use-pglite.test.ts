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
 * Compras por OC sin los días de uso personal: una línea de OC cuyo equipo estaba en uso
 * personal el día de emisión de la OC (día de Chile) no cuenta en el costo por equipo.
 * Una línea sin equipo queda igual (`getWorksitePurchasesWithoutVehicle`).
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const {
  getVehiclePurchaseSummary,
  getVehiclePurchaseByDay,
  getWorksitePurchasesWithoutVehicle,
} = await import("@/lib/services/purchasing-module/vehicle-purchase-summary")

function session(): Session {
  return {
    user: { id: IDS.user, isGlobal: true, roles: [], worksiteIds: [], permissions: ["purchasing:view"] },
    expires: "2099-01-01",
  } as unknown as Session
}

const OCTOBER = { from: "2026-10-01", to: "2026-10-31" }

let seq = 0
async function addPurchase(input: { vehicle: string | null; issuedAt: string; subtotal: number }) {
  seq += 1
  const requestId = `vpp-req-${seq}`
  const itemId = `vpp-item-${seq}`
  const orderId = `vpp-oc-${seq}`
  await testDb.insert(schema.purchaseRequests).values({
    id: requestId, code: `VPP-SOL-${seq}`, worksiteId: IDS.wsA, requesterId: IDS.user, requestType: "repuestos", status: "approved",
  })
  await testDb.insert(schema.purchaseRequestItems).values({
    id: itemId, requestId, productNameFree: "Filtro de aceite", quantity: 1, status: "in_purchase_order", vehicleId: input.vehicle,
  })
  await testDb.insert(schema.purchaseOrders).values({
    id: orderId, code: `VPP-OC-${seq}`, worksiteId: IDS.wsA, supplierId: "vpp-supplier", createdBy: IDS.user, status: "sent", issuedAt: input.issuedAt,
  })
  await testDb.insert(schema.purchaseOrderItems).values({
    id: `vpp-line-${seq}`, purchaseOrderId: orderId, requestItemId: itemId, productNameFree: "Filtro de aceite", quantity: 1,
    unitPrice: input.subtotal, subtotal: input.subtotal, status: "issued",
  })
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)
  await testDb.insert(schema.suppliers).values({ id: "vpp-supplier", name: "Repuestos del Sur" })
  // vA: uso personal del 10 al 19 de octubre. vB: sin períodos.
  await testDb.insert(schema.fuelVehiclePersonalUsePeriods).values({ id: "vpp-pu-a", vehicleId: IDS.vA, startedOn: "2026-10-10", endedOn: "2026-10-19" })

  await addPurchase({ vehicle: IDS.vA, issuedAt: "2026-10-12T15:00:00.000Z", subtotal: 100_000 }) // dentro: no cuenta
  await addPurchase({ vehicle: IDS.vA, issuedAt: "2026-10-20T01:30:00.000Z", subtotal: 7_000 }) // 22:30 del 19 en Chile: dentro
  await addPurchase({ vehicle: IDS.vA, issuedAt: "2026-10-20T03:30:00.000Z", subtotal: 20_000 }) // 00:30 del 20: cuenta
  await addPurchase({ vehicle: IDS.vA, issuedAt: "2026-10-21T15:00:00.000Z", subtotal: 5_000 }) // el día siguiente: cuenta
  await addPurchase({ vehicle: IDS.vB, issuedAt: "2026-10-12T15:00:00.000Z", subtotal: 9_000 }) // otro equipo, mismo día: cuenta
  await addPurchase({ vehicle: null, issuedAt: "2026-10-12T15:00:00.000Z", subtotal: 70_000 }) // sin equipo: queda igual
}, 60_000)

describe("compras por OC sin uso personal", () => {
  it("el resumen por equipo omite las OC emitidas en el período, con el borde horario de Chile", async () => {
    const summary = await getVehiclePurchaseSummary(session(), OCTOBER, [IDS.vA, IDS.vB])
    expect(summary.get(IDS.vA)).toMatchObject({ purchaseAmount: 25_000, orderCount: 2 })
    expect(summary.get(IDS.vB)).toMatchObject({ purchaseAmount: 9_000, orderCount: 1 })
  })

  it("el detalle por día cuadra con el resumen", async () => {
    const rows = await getVehiclePurchaseByDay(session(), OCTOBER, [IDS.vA, IDS.vB])
    const ofA = rows.filter((r) => r.vehicleId === IDS.vA)
    expect(ofA.map((r) => r.day).sort()).toEqual(["2026-10-20", "2026-10-21"])
    expect(ofA.reduce((acc, r) => acc + r.amount, 0)).toBe(25_000)
  })

  it("una línea sin equipo queda igual", async () => {
    const map = await getWorksitePurchasesWithoutVehicle(session(), OCTOBER)
    expect(map.get(IDS.wsA)).toBe(70_000)
  })

  it("sin el período, todo vuelve a contar", async () => {
    await testDb.delete(schema.fuelVehiclePersonalUsePeriods)
    const summary = await getVehiclePurchaseSummary(session(), OCTOBER, [IDS.vA])
    expect(summary.get(IDS.vA)).toMatchObject({ purchaseAmount: 132_000, orderCount: 4 })
  })
})
